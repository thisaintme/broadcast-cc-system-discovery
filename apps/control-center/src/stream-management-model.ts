/** Public, serializable stream-management contracts. No credentials belong here. */
export type Language = 'de' | 'ru';
export type Privacy = 'public' | 'unlisted' | 'private';
export type Scope = 'one' | 'following' | 'future';
export type TargetStage = 'pending' | 'creating' | 'ready' | 'failed' | 'uncertain' | 'updating' | 'deleting' | 'deleted' | 'missing';
export class ManagementError extends Error {
    constructor(public readonly code: string, message: string) { super(message); this.name = 'ManagementError'; }
}
export class RemoteError extends ManagementError {
    constructor(code: string, message: string, public readonly outcome: 'rejected' | 'unknown') { super(code, message); }
}
export class PersistenceError extends ManagementError {
    constructor() { super('storage', 'Local changes could not be saved. Stop here and reopen Stream Management after fixing storage; do not recreate events.'); }
}
export const message = (e: unknown): string => e instanceof ManagementError ? e.message : 'The operation could not be confirmed. Refresh before retrying. No automatic rollback was attempted.';
export interface Channel {
    id: string;
    title: string;
}
export interface Profile {
    id: string;
    channelId: string;
    title: string;
    status: string;
    reusable: boolean;
}
/** Main-process only. Never include in panel snapshots or diagnostics. */
export interface PrivateProfile extends Profile {
    key: string;
    server: string;
}
export interface AccountView {
    language: Language;
    configured: boolean;
    channel: Channel | null;
    profile: Profile | null;
    keySaved: boolean;
}
export interface RemoteBroadcast {
    id: string;
    channelId: string;
    etag: string;
    title: string;
    description: string;
    startsAt: string;
    endsAt?: string;
    privacy: Privacy;
    madeForKids?: boolean;
    lifecycle: string;
    streamId: string;
    autoStart: boolean;
    autoStop: boolean;
}
export interface TitleSpec {
    mode: 'dated' | 'custom';
    text: string;
}
export interface DestinationDraft {
    language: Language;
    title: TitleSpec;
    description: string;
    privacy: Privacy;
    madeForKids: boolean;
}
export interface Recurrence {
    startDate: string;
    time: string;
    timeZone: 'Europe/Berlin';
    weekdays: number[];
    intervalWeeks: number;
    count?: number;
    until?: string;
    excludeDates: string[];
}
export interface CreationPlan {
    requestId: string;
    name: string;
    destinations: DestinationDraft[];
    single?: {
        date: string;
        time: string;
    };
    recurrence?: Recurrence;
}
export interface PlannedDate {
    date: string;
    time: string;
    startsAt: string;
}
export interface Target {
    language: Language;
    channelId: string;
    draft: DestinationDraft;
    broadcastId: string;
    stage: TargetStage;
    operation?: 'create' | 'update' | 'delete';
    error: string;
    observed?: RemoteBroadcast;
    checkedAt?: string;
    override: boolean;
    retiredBroadcastIds?: string[];
}
export interface Occurrence {
    id: string;
    batchId: string;
    seriesId: string | null;
    originalDate: string;
    date: string;
    time: string;
    startsAt: string;
    targets: Target[];
    timeOverride: boolean;
}
export interface Batch {
    id: string;
    fingerprint: string;
    name: string;
    recurrence?: Recurrence;
    createdAt: string;
}
export interface Template {
    id: string;
    name: string;
    destinations: DestinationDraft[];
}
export interface ManagementState {
    version: 1;
    batches: Batch[];
    occurrences: Occurrence[];
    templates: Template[];
}
export interface EditRequest {
    occurrenceId: string;
    scope: Scope;
    date?: string;
    time?: string;
    destinations?: DestinationDraft[];
}
export interface ActionResult {
    occurrenceId: string;
    language: Language;
    stage: TargetStage;
    message: string;
}
export const emptyState = (): ManagementState => ({ version: 1, batches: [], occurrences: [], templates: [] });
export const LANGUAGES: Language[] = ['de', 'ru'];
export const UPCOMING = new Set(['created', 'ready']);
export const ACTIVE = new Set(['testing', 'testStarting', 'live', 'liveStarting']);
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new ManagementError('input', 'Invalid request.');
    return value as Record<string, unknown>;
}
export function only(value: unknown, allowed: string[]): Record<string, unknown> {
    const r = object(value);
    if (Object.keys(r).some(k => !allowed.includes(k)))
        throw new ManagementError('input', 'Unexpected request fields.');
    return r;
}
export function id(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
        throw new ManagementError('input', 'Invalid identifier.');
    return value;
}
export function language(value: unknown): Language {
    if (value !== 'de' && value !== 'ru')
        throw new ManagementError('input', 'Choose German or Russian.');
    return value;
}
export function text(value: unknown, max: number, required = true): string {
    if (typeof value !== 'string' || [...value].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (required && !value.trim()))
        throw new ManagementError('input', 'A text field is empty, invalid or too long.');
    return value.trim();
}
export function scope(value: unknown): Scope {
    if (value !== 'one' && value !== 'following' && value !== 'future')
        throw new ManagementError('input', 'Choose the scope of this change.');
    return value;
}
export function parseDestinations(raw: unknown): DestinationDraft[] {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2)
        throw new ManagementError('input', 'Choose one or two channel destinations.');
    const seen = new Set<Language>();
    return raw.map(item => {
        const r = only(item, ['language', 'title', 'description', 'privacy', 'madeForKids']), lang = language(r.language), t = only(r.title, ['mode', 'text']);
        if (seen.has(lang))
            throw new ManagementError('input', 'Each language can be selected only once.');
        seen.add(lang);
        if (t.mode !== 'dated' && t.mode !== 'custom')
            throw new ManagementError('input', 'Choose a date-prefixed or custom title.');
        const title = text(t.text, t.mode === 'dated' ? 89 : 100);
        if (/[<>]/.test(title))
            throw new ManagementError('input', 'YouTube titles cannot contain angle brackets.');
        if (!['public', 'unlisted', 'private'].includes(String(r.privacy)) || typeof r.madeForKids !== 'boolean')
            throw new ManagementError('input', 'Choose visibility and explicitly answer the made-for-kids question.');
        return { language: lang, title: { mode: t.mode, text: title }, description: text(r.description, 5000, false), privacy: r.privacy as Privacy, madeForKids: r.madeForKids };
    });
}
export const eventTitle = (date: string, title: TitleSpec): string => title.mode === 'dated' ? `${date.replaceAll('-', '')} - ${title.text}` : title.text;
export const watchUrl = (broadcastId: string): string => `https://www.youtube.com/watch?v=${encodeURIComponent(id(broadcastId))}`;
