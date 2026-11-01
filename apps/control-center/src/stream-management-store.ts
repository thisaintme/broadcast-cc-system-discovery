import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ManagementError, PersistenceError, emptyState, only, id, language, text, parseDestinations } from './stream-management-model.ts';
import type { ManagementState, RemoteBroadcast, TargetStage } from './stream-management-model.ts';
import { dateNumber, clock, parseRecurrence, berlinInstant } from './stream-recurrence.ts';
export interface ManagementStore {
    load(): Promise<ManagementState>;
    save(state: ManagementState): Promise<void>;
}
const stages: TargetStage[] = ['pending', 'creating', 'ready', 'failed', 'uncertain', 'updating', 'deleting', 'deleted', 'missing'];
const iso = (v: unknown): string => { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)))
    throw new Error('date'); return v; };
function remote(raw: unknown): RemoteBroadcast {
    const r = only(raw, ['id', 'channelId', 'etag', 'title', 'description', 'startsAt', 'endsAt', 'privacy', 'madeForKids', 'lifecycle', 'streamId', 'autoStart', 'autoStop']);
    if (typeof r.autoStart !== 'boolean' || typeof r.autoStop !== 'boolean' || !['public', 'private', 'unlisted'].includes(String(r.privacy)) || (r.madeForKids !== undefined && typeof r.madeForKids !== 'boolean'))
        throw new Error('event');
    return { id: id(r.id), channelId: id(r.channelId), etag: text(r.etag, 500, false), title: text(r.title, 500), description: text(r.description, 5000, false), startsAt: r.startsAt === '' ? '' : iso(r.startsAt), ...(r.endsAt !== undefined ? { endsAt: iso(r.endsAt) } : {}), privacy: r.privacy as RemoteBroadcast['privacy'], ...(r.madeForKids !== undefined ? { madeForKids: r.madeForKids as boolean } : {}), lifecycle: text(r.lifecycle, 100), streamId: r.streamId === '' ? '' : id(r.streamId), autoStart: r.autoStart, autoStop: r.autoStop };
}
/** An allowlist schema prevents accidental credential fields from entering this unencrypted file. */
export function parseManagementState(raw: unknown): ManagementState {
    try {
        const r = only(raw, ['version', 'batches', 'occurrences', 'templates']);
        if (r.version !== 1 || !Array.isArray(r.batches) || r.batches.length > 2000 || !Array.isArray(r.occurrences) || r.occurrences.length > 5000 || !Array.isArray(r.templates) || r.templates.length > 100)
            throw new Error('shape');
        const batchIds = new Set<string>(), occurrenceIds = new Set<string>(), eventIds = new Set<string>(), templateIds = new Set<string>();
        const batches = r.batches.map(rawBatch => {
            const b = only(rawBatch, ['id', 'fingerprint', 'name', 'recurrence', 'createdAt']), batchId = id(b.id);
            if (batchIds.has(batchId) || typeof b.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(b.fingerprint))
                throw new Error('batch');
            batchIds.add(batchId);
            return { id: batchId, fingerprint: b.fingerprint, name: text(b.name, 100), createdAt: iso(b.createdAt), ...(b.recurrence !== undefined ? { recurrence: parseRecurrence(b.recurrence) } : {}) };
        });
        const occurrences = r.occurrences.map(rawOccurrence => {
            const o = only(rawOccurrence, ['id', 'batchId', 'seriesId', 'originalDate', 'date', 'time', 'startsAt', 'targets', 'timeOverride']), oid = id(o.id), batchId = id(o.batchId);
            if (occurrenceIds.has(oid) || !batchIds.has(batchId) || typeof o.timeOverride !== 'boolean' || !Array.isArray(o.targets) || !o.targets.length || o.targets.length > 2)
                throw new Error('occurrence');
            occurrenceIds.add(oid);
            if (o.seriesId !== null && (id(o.seriesId) !== batchId || !batches.find(b => b.id === batchId)?.recurrence))
                throw new Error('series');
            dateNumber(o.originalDate);
            dateNumber(o.date);
            clock(o.time);
            if (iso(o.startsAt) !== berlinInstant(o.date as string, o.time as string))
                throw new Error('time');
            const langs = new Set<string>();
            const targets = o.targets.map(rawTarget => {
                const t = only(rawTarget, ['language', 'channelId', 'draft', 'broadcastId', 'stage', 'operation', 'error', 'observed', 'checkedAt', 'override', 'retiredBroadcastIds']), lang = language(t.language), channelId = id(t.channelId);
                const draft = parseDestinations([t.draft])[0];
                if (langs.has(lang) || draft.language !== lang || !stages.includes(t.stage as TargetStage) || typeof t.override !== 'boolean')
                    throw new Error('target');
                langs.add(lang);
                if (t.operation !== undefined && !['create', 'update', 'delete'].includes(String(t.operation)))
                    throw new Error('operation');
                if (t.retiredBroadcastIds !== undefined && (!Array.isArray(t.retiredBroadcastIds) || t.retiredBroadcastIds.length > 100))
                    throw new Error('retired');
                const retiredBroadcastIds = t.retiredBroadcastIds === undefined ? undefined : (t.retiredBroadcastIds as unknown[]).map(id);
                const broadcastId = t.broadcastId === '' ? '' : id(t.broadcastId);
                if (broadcastId) {
                    const key = `${channelId}:${broadcastId}`;
                    if (eventIds.has(key))
                        throw new Error('duplicate');
                    eventIds.add(key);
                }
                const observed = t.observed !== undefined ? remote(t.observed) : undefined;
                if (observed && (observed.id !== broadcastId || observed.channelId !== channelId))
                    throw new Error('ownership');
                return { language: lang, channelId, draft, broadcastId, stage: t.stage as TargetStage, error: text(t.error, 1500, false), override: t.override, ...(retiredBroadcastIds ? { retiredBroadcastIds } : {}), ...(t.operation ? { operation: t.operation as 'create' | 'update' | 'delete' } : {}), ...(observed ? { observed } : {}), ...(t.checkedAt ? { checkedAt: iso(t.checkedAt) } : {}) };
            });
            return { id: oid, batchId, seriesId: o.seriesId as string | null, originalDate: o.originalDate as string, date: o.date as string, time: o.time as string, startsAt: o.startsAt as string, targets, timeOverride: o.timeOverride };
        });
        const templates = r.templates.map(rawTemplate => { const t = only(rawTemplate, ['id', 'name', 'destinations']), tid = id(t.id); if (templateIds.has(tid))
            throw new Error('template'); templateIds.add(tid); return { id: tid, name: text(t.name, 100), destinations: parseDestinations(t.destinations) }; });
        return { version: 1, batches, occurrences, templates };
    }
    catch {
        throw new ManagementError('state', 'Stream Management data is invalid. It has not been overwritten. Restore the local metadata file before making changes.');
    }
}
export class StreamManagementFile implements ManagementStore {
    constructor(private file: string) { }
    async load(): Promise<ManagementState> {
        try {
            if ((await stat(this.file)).size > 8 * 1024 * 1024)
                throw new Error('size');
            return parseManagementState(JSON.parse(await readFile(this.file, 'utf8')));
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return emptyState();
            if (e instanceof ManagementError)
                throw e;
            throw new ManagementError('state', 'Stream Management data could not be read. It has not been overwritten.');
        }
    }
    async save(value: ManagementState): Promise<void> {
        const payload = JSON.stringify(parseManagementState(value), null, 2) + '\n';
        if (Buffer.byteLength(payload) > 8 * 1024 * 1024)
            throw new PersistenceError();
        const dir = dirname(this.file), temporary = `${this.file}.${randomUUID()}.tmp`;
        let handle;
        try {
            await mkdir(dir, { recursive: true, mode: 0o700 });
            handle = await open(temporary, 'wx', 0o600);
            await handle.writeFile(payload);
            await handle.sync();
            await handle.close();
            handle = undefined;
            await rename(temporary, this.file);
            // On the deployed Mac, persist the rename as well as the file contents.
            if (process.platform !== 'win32') {
                const directory = await open(dir, 'r');
                try {
                    await directory.sync();
                }
                finally {
                    await directory.close();
                }
            }
        }
        catch {
            throw new PersistenceError();
        }
        finally {
            if (handle)
                await handle.close().catch(() => { });
            await unlink(temporary).catch(() => { });
        }
    }
}
