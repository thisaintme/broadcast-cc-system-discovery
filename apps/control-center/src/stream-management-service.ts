import { createHash, randomUUID } from 'node:crypto';
import { ACTIVE, UPCOMING, ManagementError, PersistenceError, RemoteError, emptyState, eventTitle, message, id, language, only, scope as parseScope, parseDestinations, text } from './stream-management-model.ts';
import type { ManagementState, Occurrence, Target, Language, Scope, DestinationDraft, RemoteBroadcast, ActionResult, EditRequest, Template } from './stream-management-model.ts';
import type { ManagementStore } from './stream-management-store.ts';
import type { AccountAccess } from './stream-accounts.ts';
import type { ManagementApi, EventInput } from './stream-management-api.ts';
import { parsePlan, dateNumber, clock, berlinInstant, shiftDate, localParts } from './stream-recurrence.ts';
const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const input = (o: Occurrence, t: Target): EventInput => ({ title: eventTitle(o.date, t.draft.title), description: t.draft.description, startsAt: o.startsAt, privacy: t.draft.privacy, madeForKids: t.draft.madeForKids });
const matches = (b: RemoteBroadcast, value: EventInput): boolean => b.title === value.title && b.description === value.description && Date.parse(b.startsAt) === Date.parse(value.startsAt) && b.privacy === value.privacy && (b.madeForKids === undefined || b.madeForKids === value.madeForKids);
export class StreamManagementService {
    private state = emptyState();
    private loaded = false;
    private poisoned = false;
    private epoch = 0;
    private tail: Promise<void> = Promise.resolve();
    constructor(private store: ManagementStore, private accounts: AccountAccess, private changed: () => void = () => { }, private now: () => number = Date.now) { }
    async load(): Promise<void> {
        this.loaded = false;
        const value = await this.store.load();
        // A process may have died after a remote write but before its acknowledgement reached disk.
        for (const o of value.occurrences)
            for (const t of o.targets)
                if (['creating', 'updating', 'deleting'].includes(t.stage)) {
                    t.stage = 'uncertain';
                    t.error = 'The previous operation was interrupted. Refresh and reconcile before retrying.';
                }
        this.state = value;
        this.loaded = true;
        this.poisoned = false;
    }
    snapshot(): ManagementState { return structuredClone(this.state); }
    cancel(): void { this.epoch++; }
    private guard(epoch: number): void { if (epoch !== this.epoch)
        throw new ManagementError('cancelled', 'Remaining work was cancelled. Already completed YouTube changes remain.'); }
    private async locked<T>(fn: () => Promise<T>): Promise<T> {
        const previous = this.tail;
        let release!: () => void;
        this.tail = new Promise<void>(r => { release = r; });
        await previous;
        try {
            if (!this.loaded || this.poisoned)
                throw new ManagementError('state', 'Stream Management is not writable. Reopen it after fixing local storage.');
            return await fn();
        }
        finally {
            release();
        }
    }
    private async commit(change: (next: ManagementState) => void): Promise<void> {
        const next = structuredClone(this.state);
        change(next);
        try {
            await this.store.save(next);
        }
        catch {
            this.poisoned = true;
            throw new PersistenceError();
        }
        this.state = next;
        this.changed();
    }
    private occurrence(occurrenceId: string): Occurrence { const o = this.state.occurrences.find(o => o.id === id(occurrenceId)); if (!o)
        throw new ManagementError('missing', 'Select an existing managed service.'); return o; }
    private target(occurrenceId: string, lang: Language): Target { const t = this.occurrence(occurrenceId).targets.find(t => t.language === language(lang)); if (!t)
        throw new ManagementError('missing', 'This service has no such destination.'); return t; }
    private async patchTarget(occurrenceId: string, lang: Language, change: (t: Target) => void): Promise<void> { await this.commit(s => { const t = s.occurrences.find(o => o.id === occurrenceId)!.targets.find(t => t.language === lang)!; change(t); }); }
    private owned(b: RemoteBroadcast, target: Target): void { if (b.channelId !== target.channelId || (target.broadcastId && b.id !== target.broadcastId))
        throw new ManagementError('ownership', 'The remote event does not match this destination. No further action was sent.'); }
    private async current(api: ManagementApi, target: Target): Promise<RemoteBroadcast> {
        const b = await api.broadcast(target.broadcastId);
        if (!b)
            throw new ManagementError('missing', 'This event was removed from YouTube. It will not be recreated automatically.');
        this.owned(b, target);
        return b;
    }
    private upcoming(b: RemoteBroadcast): void { if (!UPCOMING.has(b.lifecycle))
        throw new ManagementError('lifecycle', `This event is ${b.lifecycle}. Only not-yet-live events can be edited or deleted here.`); }
    private unresolved(t: Target): void { if (['creating', 'updating', 'deleting', 'uncertain'].includes(t.stage))
        throw new ManagementError('uncertain', 'Resolve the previous uncertain operation before changing this event.'); }
    private async failure(occurrenceId: string, lang: Language, e: unknown, operation: 'create' | 'update' | 'delete'): Promise<void> {
        if (e instanceof PersistenceError)
            throw e;
        await this.patchTarget(occurrenceId, lang, t => { t.operation = operation; t.stage = e instanceof RemoteError && e.outcome === 'rejected' ? 'failed' : e instanceof ManagementError && ['cancelled', 'account', 'authorization', 'lifecycle', 'missing'].includes(e.code) ? 'failed' : 'uncertain'; t.error = message(e); });
    }
    private result(occurrenceId: string, lang: Language): ActionResult { const t = this.target(occurrenceId, lang); return { occurrenceId, language: lang, stage: t.stage, message: t.error || 'Confirmed' }; }
    private async createTarget(occurrenceId: string, lang: Language, epoch: number): Promise<void> {
        const o = this.occurrence(occurrenceId), t = this.target(occurrenceId, lang);
        if (t.broadcastId || !['pending', 'failed'].includes(t.stage) || (t.operation && t.operation !== 'create'))
            return;
        try {
            this.guard(epoch);
            const api = await this.accounts.authorized(lang, t.channelId);
            this.guard(epoch);
            await this.patchTarget(occurrenceId, lang, t => { t.stage = 'creating'; t.operation = 'create'; t.error = ''; });
            const created = await api.create(input(o, t), () => this.guard(epoch));
            // Persist the ID first, even if cancellation happened while the request was in flight.
            await this.patchTarget(occurrenceId, lang, t => { t.broadcastId = created.id; t.stage = 'uncertain'; });
            this.owned(created, this.target(occurrenceId, lang));
            if (!matches(created, input(o, t)) || created.autoStart || created.autoStop)
                throw new ManagementError('mismatch', 'YouTube returned different event settings. Recover the acknowledged event; do not create another.');
            await this.patchTarget(occurrenceId, lang, t => { t.stage = 'ready'; t.observed = created; t.checkedAt = new Date(this.now()).toISOString(); delete t.operation; t.error = ''; });
        }
        catch (e) {
            await this.failure(occurrenceId, lang, e, 'create');
        }
    }
    preview(raw: unknown): ReturnType<typeof parsePlan> { return parsePlan(raw, this.now()); }
    async create(raw: unknown): Promise<ActionResult[]> {
        return this.locked(async () => {
            const { plan, dates } = parsePlan(raw, this.now()), print = fingerprint(plan), existing = this.state.batches.find(b => b.id === plan.requestId);
            if (existing) {
                if (existing.fingerprint !== print)
                    throw new ManagementError('duplicate', 'This request ID already belongs to a different creation request.');
                return this.state.occurrences.filter(o => o.batchId === existing.id).flatMap(o => o.targets.map(t => this.result(o.id, t.language)));
            }
            if (this.state.occurrences.length + dates.length > 5000)
                throw new ManagementError('limit', 'The local management limit has been reached.');
            const epoch = this.epoch, channels = new Map<Language, string>();
            for (const d of plan.destinations) {
                const c = this.accounts.views().find(a => a.language === d.language)?.channel;
                if (!c)
                    throw new ManagementError('account', `Connect the ${d.language.toUpperCase()} YouTube account first.`);
                await this.accounts.authorized(d.language, c.id);
                channels.set(d.language, c.id);
                this.guard(epoch);
            }
            const occurrences: Occurrence[] = dates.map(date => ({ id: randomUUID(), batchId: plan.requestId, seriesId: plan.recurrence ? plan.requestId : null, originalDate: date.date, ...date, timeOverride: false, targets: plan.destinations.map(d => ({ language: d.language, channelId: channels.get(d.language)!, draft: structuredClone(d), broadcastId: '', stage: 'pending', error: '', override: false })) }));
            await this.commit(s => { s.batches.push({ id: plan.requestId, fingerprint: print, name: plan.name, createdAt: new Date(this.now()).toISOString(), ...(plan.recurrence ? { recurrence: plan.recurrence } : {}) }); s.occurrences.push(...occurrences); });
            return this.createRemaining(occurrences.map(o => o.id), epoch);
        });
    }
    private async createRemaining(ids: string[], epoch: number): Promise<ActionResult[]> {
        const results: ActionResult[] = [], paused = new Set<Language>();
        for (const oid of ids)
            for (const lang of this.occurrence(oid).targets.map(t => t.language)) {
                if (epoch !== this.epoch)
                    return results;
                if (paused.has(lang))
                    continue;
                await this.createTarget(oid, lang, epoch);
                const result = this.result(oid, lang);
                results.push(result);
                if (/quota|rate.limit|too many scheduled/i.test(result.message))
                    paused.add(lang);
            }
        return results;
    }
    async retry(occurrenceId: string, lang: Language): Promise<ActionResult> {
        return this.locked(async () => {
            const t = this.target(occurrenceId, lang);
            this.unresolved(t);
            if (!['pending', 'failed'].includes(t.stage))
                throw new ManagementError('retry', 'Only a failed or pending destination can be retried.');
            if (t.operation === 'delete')
                await this.deleteTarget(occurrenceId, lang, this.epoch);
            else if (t.broadcastId)
                await this.updateTarget(occurrenceId, lang, this.epoch);
            else
                await this.createTarget(occurrenceId, lang, this.epoch);
            return this.result(occurrenceId, lang);
        });
    }
    async addDestination(occurrenceId: string, rawDraft: unknown): Promise<ActionResult> {
        return this.locked(async () => {
            const o = this.occurrence(occurrenceId), draft = parseDestinations([rawDraft])[0], previous = o.targets.find(t => t.language === draft.language), epoch = this.epoch;
            if (Date.parse(o.startsAt) <= this.now())
                throw new ManagementError('past', 'Only future services can receive a new destination.');
            if (previous && previous.stage !== 'deleted')
                throw new ManagementError('duplicate', 'This destination already exists. Recover or retry it instead of creating another.');
            const channel = this.accounts.views().find(a => a.language === draft.language)?.channel;
            if (!channel)
                throw new ManagementError('account', 'Connect this destination first.');
            await this.accounts.authorized(draft.language, channel.id);
            this.guard(epoch);
            for (const t of o.targets.filter(t => t.stage !== 'deleted' && t.broadcastId)) {
                const api = await this.accounts.authorized(t.language, t.channelId);
                this.upcoming(await this.current(api, t));
                this.guard(epoch);
            }
            const retiredBroadcastIds = [...(previous?.retiredBroadcastIds || []), ...(previous?.broadcastId ? [previous.broadcastId] : [])];
            if (retiredBroadcastIds.length > 100)
                throw new ManagementError('limit', 'This occurrence has reached the explicit destination-replacement limit.');
            const target: Target = { language: draft.language, channelId: channel.id, draft, broadcastId: '', stage: 'pending', error: '', override: true, ...(retiredBroadcastIds.length ? { retiredBroadcastIds } : {}) };
            await this.commit(s => { const entry = s.occurrences.find(x => x.id === o.id)!; entry.targets = [...entry.targets.filter(t => t.language !== draft.language), target]; });
            await this.createTarget(o.id, draft.language, epoch);
            return this.result(o.id, draft.language);
        });
    }
    affected(occurrenceId: string, selection: Scope): Occurrence[] {
        const anchor = this.occurrence(occurrenceId);
        parseScope(selection);
        if (selection === 'one' || !anchor.seriesId)
            return [structuredClone(anchor)];
        return this.state.occurrences.filter(o => o.seriesId === anchor.seriesId && Date.parse(o.startsAt) > this.now() && (selection === 'future' || o.originalDate >= anchor.originalDate)).map(o => structuredClone(o));
    }
    async edit(raw: unknown): Promise<ActionResult[]> {
        return this.locked(async () => {
            const r = only(raw, ['occurrenceId', 'scope', 'date', 'time', 'destinations']);
            const request: EditRequest = { occurrenceId: id(r.occurrenceId), scope: parseScope(r.scope), ...(r.date !== undefined ? { date: (dateNumber(r.date), r.date as string) } : {}), ...(r.time !== undefined ? { time: clock(r.time) } : {}), ...(r.destinations !== undefined ? { destinations: parseDestinations(r.destinations) } : {}) };
            const anchor = this.occurrence(request.occurrenceId), offset = request.date ? (dateNumber(request.date) - dateNumber(anchor.date)) / 86400000 : 0, epoch = this.epoch, results: ActionResult[] = [];
            for (const item of this.affected(anchor.id, request.scope)) {
                if (epoch !== this.epoch)
                    break;
                const date = item.timeOverride && request.scope !== 'one' ? item.date : shiftDate(item.date, offset), time = item.timeOverride && request.scope !== 'one' ? item.time : request.time || item.time, startsAt = berlinInstant(date, time);
                if (Date.parse(startsAt) <= this.now())
                    throw new ManagementError('past', 'Rescheduling must leave affected services in the future.');
                const drafts = new Map<Language, DestinationDraft>(), reviewed = new Map<Language, RemoteBroadcast>();
                // Preflight the complete paired occurrence before changing either side.
                for (const t of item.targets.filter(t => t.stage !== 'deleted')) {
                    this.unresolved(t);
                    const api = await this.accounts.authorized(t.language, t.channelId);
                    this.guard(epoch);
                    const before = t.broadcastId ? await this.current(api, t) : undefined;
                    if (before) {
                        this.upcoming(before);
                        reviewed.set(t.language, before);
                    }
                    let draft = structuredClone(t.draft);
                    if (before) {
                        draft.description = before.description;
                        draft.privacy = before.privacy;
                        draft.madeForKids = before.madeForKids ?? draft.madeForKids;
                        if (before.title !== eventTitle(item.date, draft.title))
                            draft.title = { mode: 'custom', text: before.title };
                    }
                    const replacement = request.destinations?.find(d => d.language === t.language);
                    if (replacement && !(request.scope !== 'one' && t.override)) {
                        const custom = draft.title.mode === 'custom' && request.scope !== 'one';
                        draft = { ...structuredClone(replacement), title: custom ? draft.title : structuredClone(replacement.title) };
                    }
                    drafts.set(t.language, draft);
                }
                this.guard(epoch);
                await this.commit(s => { const o = s.occurrences.find(o => o.id === item.id)!; o.date = date; o.time = time; o.startsAt = startsAt; if (request.scope === 'one' && (request.date || request.time))
                    o.timeOverride = true; for (const t of o.targets) {
                    const draft = drafts.get(t.language);
                    if (draft) {
                        t.draft = draft;
                        t.stage = 'pending';
                        t.error = '';
                        t.operation = t.broadcastId ? 'update' : 'create';
                        if (request.scope === 'one' && request.destinations)
                            t.override = true;
                    }
                } });
                for (const lang of drafts.keys()) {
                    if (epoch !== this.epoch)
                        break;
                    if (this.target(item.id, lang).broadcastId)
                        await this.updateTarget(item.id, lang, epoch, reviewed.get(lang));
                    else
                        await this.createTarget(item.id, lang, epoch);
                    results.push(this.result(item.id, lang));
                }
            }
            return results;
        });
    }
    private async updateTarget(occurrenceId: string, lang: Language, epoch: number, reviewed?: RemoteBroadcast): Promise<void> {
        const o = this.occurrence(occurrenceId), t = this.target(occurrenceId, lang);
        try {
            this.guard(epoch);
            const api = await this.accounts.authorized(lang, t.channelId), before = await this.current(api, t);
            this.upcoming(before);
            this.guard(epoch);
            if (reviewed && fingerprint(reviewed) !== fingerprint(before))
                throw new RemoteError('concurrent', 'The YouTube event changed during this operation. Refresh and review it again.', 'rejected');
            await this.patchTarget(occurrenceId, lang, t => { t.stage = 'updating'; t.operation = 'update'; t.error = ''; });
            await api.update(before, input(o, t), () => this.guard(epoch));
            const after = await this.current(api, t);
            if (!matches(after, input(o, t)))
                throw new ManagementError('mismatch', 'The edited event could not be verified. Refresh and review its current settings.');
            await this.patchTarget(occurrenceId, lang, t => { t.stage = 'ready'; t.error = ''; t.observed = after; t.checkedAt = new Date(this.now()).toISOString(); delete t.operation; });
        }
        catch (e) {
            await this.failure(occurrenceId, lang, e, 'update');
        }
    }
    async remove(occurrenceId: string, selection: Scope, lang?: Language): Promise<ActionResult[]> {
        return this.locked(async () => {
            if (lang)
                language(lang);
            const epoch = this.epoch, out: ActionResult[] = [];
            for (const o of this.affected(occurrenceId, selection))
                for (const t of o.targets.filter(t => !lang || t.language === lang)) {
                    if (epoch !== this.epoch)
                        return out;
                    await this.deleteTarget(o.id, t.language, epoch);
                    out.push(this.result(o.id, t.language));
                }
            return out;
        });
    }
    private async deleteTarget(occurrenceId: string, lang: Language, epoch: number): Promise<void> {
        const t = this.target(occurrenceId, lang);
        if (t.stage === 'deleted')
            return;
        this.unresolved(t);
        try {
            this.guard(epoch);
            if (t.broadcastId) {
                const api = await this.accounts.authorized(lang, t.channelId), before = await api.broadcast(t.broadcastId);
                this.guard(epoch);
                if (before) {
                    this.owned(before, t);
                    this.upcoming(before);
                    await this.patchTarget(occurrenceId, lang, t => { t.stage = 'deleting'; t.operation = 'delete'; t.error = ''; });
                    await api.delete(before, () => this.guard(epoch));
                }
            }
            await this.patchTarget(occurrenceId, lang, t => { t.stage = 'deleted'; t.error = ''; delete t.operation; t.checkedAt = new Date(this.now()).toISOString(); });
            // Tombstones remain in the series. No recurrence refresh can recreate them.
        }
        catch (e) {
            await this.failure(occurrenceId, lang, e, 'delete');
        }
    }
    async refresh(lang: Language): Promise<RemoteBroadcast[]> {
        return this.locked(async () => {
            const api = await this.accounts.authorized(lang), channelId = this.accounts.views().find(a => a.language === lang)!.channel!.id;
            const remote = await api.broadcasts(), byId = new Map(remote.filter(b => b.channelId === channelId).map(b => [b.id, b]));
            await this.commit(s => {
                for (const o of s.occurrences)
                    for (const t of o.targets) {
                        if (t.language !== lang || t.channelId !== channelId || !t.broadcastId || t.stage === 'deleted')
                            continue;
                        const b = byId.get(t.broadcastId);
                        t.checkedAt = new Date(this.now()).toISOString();
                        if (!b) {
                            t.stage = t.operation === 'delete' ? 'deleted' : 'missing';
                            t.error = t.stage === 'missing' ? 'This event is no longer on YouTube. It will not be recreated.' : '';
                            if (t.stage === 'deleted')
                                delete t.operation;
                            continue;
                        }
                        t.observed = b;
                        if (t.operation === 'delete') {
                            t.stage = 'failed';
                            t.error = 'Deletion was not confirmed. Review the current event before retrying.';
                        }
                        else if (t.operation && !matches(b, input(o, t))) {
                            t.stage = 'uncertain';
                            t.error = 'The remote settings differ from the requested change. Review or explicitly recover this event.';
                        }
                        else {
                            t.stage = 'ready';
                            t.error = '';
                            delete t.operation;
                        }
                    }
            });
            return remote.filter(b => b.channelId === channelId);
        });
    }
    async recover(occurrenceId: string, lang: Language, broadcastId: string): Promise<void> {
        return this.locked(async () => {
            const t = this.target(occurrenceId, lang), api = await this.accounts.authorized(lang, t.channelId), b = await api.broadcast(id(broadcastId));
            if (!b)
                throw new ManagementError('missing', 'The selected recovery event no longer exists.');
            this.owned(b, { ...t, broadcastId: '' });
            this.upcoming(b);
            if (t.broadcastId && t.broadcastId !== b.id)
                throw new ManagementError('ownership', 'A known event ID cannot be replaced with another event.');
            if (this.state.occurrences.some(o => o.targets.some(other => other !== t && other.channelId === b.channelId && other.broadcastId === b.id)))
                throw new ManagementError('duplicate', 'This YouTube event is already managed elsewhere.');
            if (Date.parse(b.startsAt) !== Date.parse(this.occurrence(occurrenceId).startsAt)) {
                if (!t.broadcastId)
                    throw new ManagementError('recovery', 'The recovery event must have the reviewed scheduled start time.');
                await this.patchTarget(occurrenceId, lang, t => { t.stage = 'failed'; t.operation = 'update'; t.observed = b; t.checkedAt = new Date(this.now()).toISOString(); t.error = 'The existing event has a different time. Retry deliberately to apply the requested schedule to this same event ID; no replacement will be created.'; });
                return;
            }
            await this.patchTarget(occurrenceId, lang, t => { t.broadcastId = b.id; t.stage = 'ready'; t.observed = b; t.error = ''; t.draft = { ...t.draft, title: b.title === eventTitle(this.occurrence(occurrenceId).date, t.draft.title) ? t.draft.title : { mode: 'custom', text: b.title }, description: b.description, privacy: b.privacy, madeForKids: b.madeForKids ?? t.draft.madeForKids }; delete t.operation; t.checkedAt = new Date(this.now()).toISOString(); });
        });
    }
    async adopt(lang: Language, broadcastId: string, madeForKids: boolean): Promise<void> {
        return this.locked(async () => {
            if (typeof madeForKids !== 'boolean')
                throw new ManagementError('input', 'Answer the audience question.');
            const api = await this.accounts.authorized(lang), b = await api.broadcast(id(broadcastId));
            if (!b)
                throw new ManagementError('missing', 'This YouTube event no longer exists.');
            this.upcoming(b);
            if (b.channelId !== this.accounts.views().find(a => a.language === lang)?.channel?.id)
                throw new ManagementError('ownership', 'The event belongs to another channel.');
            if (this.state.occurrences.some(o => o.targets.some(t => t.channelId === b.channelId && t.broadcastId === b.id)))
                throw new ManagementError('duplicate', 'This event is already managed.');
            const p = localParts(b.startsAt);
            dateNumber(p.date);
            const batchId = randomUUID();
            await this.commit(s => { s.batches.push({ id: batchId, name: b.title.slice(0, 100), fingerprint: fingerprint({ channel: b.channelId, event: b.id }), createdAt: new Date(this.now()).toISOString() }); s.occurrences.push({ id: randomUUID(), batchId, seriesId: null, originalDate: p.date, ...p, startsAt: berlinInstant(p.date, p.time), timeOverride: false, targets: [{ language: lang, channelId: b.channelId, broadcastId: b.id, draft: { language: lang, title: { mode: 'custom', text: b.title }, description: b.description, privacy: b.privacy, madeForKids: b.madeForKids ?? madeForKids }, stage: 'ready', observed: b, checkedAt: new Date(this.now()).toISOString(), error: '', override: true }] }); });
        });
    }
    async prepare(occurrenceId: string, lang: Language): Promise<void> {
        return this.locked(async () => {
            const epoch = this.epoch, t = this.target(occurrenceId, lang);
            this.unresolved(t);
            if (!t.broadcastId || t.stage !== 'ready')
                throw new ManagementError('prepare', 'Recover or create this event first.');
            const api = await this.accounts.authorized(lang, t.channelId), b = await this.current(api, t);
            this.upcoming(b);
            if (b.autoStart || b.autoStop)
                throw new ManagementError('prepare', 'Disable automatic start and stop for this event in YouTube Studio before preparing it.');
            const saved = await this.accounts.savedProfile(lang), current = await api.profile(saved.id);
            if (current.channelId !== t.channelId || current.key !== saved.key || !current.reusable)
                throw new ManagementError('profile', 'The saved stream key no longer matches YouTube. Refresh it in account management and update the encoder.');
            if (b.streamId && b.streamId !== saved.id)
                throw new ManagementError('prepare', 'This event is bound to another streaming profile. Review it rather than silently replacing its destination.');
            if ((await api.broadcasts()).some(other => other.id !== b.id && other.streamId === saved.id && ACTIVE.has(other.lifecycle)))
                throw new ManagementError('active', 'Another live or testing event is using this streaming profile.');
            this.guard(epoch);
            if (!b.streamId)
                await api.bind(b, saved.id, () => this.guard(epoch));
            const after = await this.current(api, t);
            if (after.streamId !== saved.id)
                throw new ManagementError('prepare', 'YouTube did not confirm the selected ingestion binding. Refresh before starting.');
            await this.patchTarget(occurrenceId, lang, t => { t.observed = after; t.checkedAt = new Date(this.now()).toISOString(); });
        });
    }
    async saveTemplate(raw: unknown): Promise<void> {
        return this.locked(async () => { const r = only(raw, ['id', 'name', 'destinations']), value: Template = { id: id(r.id), name: text(r.name, 100), destinations: parseDestinations(r.destinations) }; await this.commit(s => { s.templates = [...s.templates.filter(t => t.id !== value.id), value]; }); });
    }
}
