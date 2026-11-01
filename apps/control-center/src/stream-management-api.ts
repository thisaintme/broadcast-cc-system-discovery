import { ManagementError, RemoteError, object, id } from './stream-management-model.ts';
import type { Channel, PrivateProfile, RemoteBroadcast, Privacy } from './stream-management-model.ts';
export interface EventInput {
    title: string;
    description: string;
    startsAt: string;
    privacy: Privacy;
    madeForKids: boolean;
}
export interface ManagementApi {
    channel(): Promise<Channel>;
    broadcasts(): Promise<RemoteBroadcast[]>;
    broadcast(id: string): Promise<RemoteBroadcast | null>;
    profiles(): Promise<PrivateProfile[]>;
    profile(id: string): Promise<PrivateProfile>;
    create(input: EventInput, guard?: () => void): Promise<RemoteBroadcast>;
    update(before: RemoteBroadcast, input: EventInput, guard?: () => void): Promise<RemoteBroadcast>;
    delete(before: RemoteBroadcast, guard?: () => void): Promise<void>;
    bind(before: RemoteBroadcast, profileId: string, guard?: () => void): Promise<RemoteBroadcast>;
}
const ROOT = 'https://www.googleapis.com/youtube/v3/';
const PARTS = 'id,snippet,status,contentDetails';
const errors: Record<string, string> = {
    liveStreamingNotEnabled: 'Live streaming is not enabled for this channel.',
    livePermissionBlocked: 'YouTube has blocked live streaming for this channel. Review YouTube Studio.',
    insufficientPermissions: 'Reconnect this account with YouTube management permission.',
    insufficientLivePermissions: 'This account cannot manage live broadcasts on the selected channel.',
    quotaExceeded: 'The YouTube API quota is exhausted. No write was retried.',
    dailyLimitExceeded: 'The YouTube API quota is exhausted. No write was retried.',
    userBroadcastsExceedLimit: 'YouTube rejected this event because the channel has too many scheduled broadcasts.',
    userRequestsExceedRateLimit: 'YouTube rate-limited this request. Retry the failed destination later.',
    rateLimitExceeded: 'YouTube rate-limited this request. Retry the failed destination later.',
    invalidScheduledStartTime: 'YouTube refused this scheduled start time. Choose a future date closer to today.',
    invalidScheduledEndTime: 'YouTube refused the scheduled end time. Review the event in YouTube Studio.',
    accessNotConfigured: 'Enable YouTube Data API v3 for the imported Google OAuth client.',
    conditionNotMet: 'The event changed since it was read. Refresh and review it again.',
};
const read = (v: unknown): Record<string, any> => object(v);
function event(raw: unknown): RemoteBroadcast {
    const r = read(raw), s = read(r.snippet), st = read(r.status), c = read(r.contentDetails ?? {});
    if (!['public', 'unlisted', 'private'].includes(st.privacyStatus) || typeof s.title !== 'string' || typeof st.lifeCycleStatus !== 'string')
        throw new ManagementError('response', 'YouTube returned incomplete event metadata.');
    return { id: id(r.id), channelId: id(s.channelId), etag: typeof r.etag === 'string' ? r.etag : '', title: s.title, description: typeof s.description === 'string' ? s.description : '', startsAt: typeof s.scheduledStartTime === 'string' ? s.scheduledStartTime : '', ...(typeof s.scheduledEndTime === 'string' ? { endsAt: s.scheduledEndTime } : {}), privacy: st.privacyStatus, ...(typeof st.selfDeclaredMadeForKids === 'boolean' ? { madeForKids: st.selfDeclaredMadeForKids } : {}), lifecycle: st.lifeCycleStatus, streamId: typeof c.boundStreamId === 'string' ? c.boundStreamId : '', autoStart: c.enableAutoStart !== false, autoStop: c.enableAutoStop !== false };
}
export function ingestServer(value: unknown): string {
    let u: URL;
    try {
        u = new URL(String(value));
    }
    catch {
        throw new ManagementError('profile', 'YouTube did not return a supported ingestion server.');
    }
    if (!['rtmp:', 'rtmps:'].includes(u.protocol) || !(u.protocol === 'rtmps:' ? /^[a-z0-9-]+\.rtmps\.youtube\.com$/i : /^[a-z0-9-]+\.rtmp\.youtube\.com$/i).test(u.hostname) || !!(u.port && u.port !== (u.protocol === 'rtmps:' ? '443' : '1935')) || u.username || u.password || u.search || u.hash || !['/live2', '/live2/'].includes(u.pathname))
        throw new ManagementError('profile', 'Unsupported YouTube ingestion server. No encoder configuration was changed.');
    return u.href;
}
function profile(raw: unknown): PrivateProfile {
    const r = read(raw), s = read(r.snippet), cdn = read(r.cdn), info = read(cdn.ingestionInfo), status = read(r.status);
    if (typeof info.streamName !== 'string' || !info.streamName || info.streamName.length > 2048 || /[\r\n\u0000]/.test(info.streamName))
        throw new ManagementError('profile', 'YouTube did not return a valid stream key.');
    return { id: id(r.id), channelId: id(s.channelId), title: typeof s.title === 'string' ? s.title : 'YouTube stream', status: typeof status.streamStatus === 'string' ? status.streamStatus : 'unknown', reusable: read(r.contentDetails ?? {}).isReusable === true, key: info.streamName, server: ingestServer(info.rtmpsIngestionAddress || info.ingestionAddress) };
}
/** Fixed Google endpoints; no raw replies, tokens or stream keys are logged. Never retries a write. */
export class StreamManagementApi implements ManagementApi {
    constructor(private token: () => Promise<string>, private http: typeof fetch = fetch) { }
    private async request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', resource: string, query: Record<string, string>, body?: unknown, guard?: () => void, etag?: string): Promise<Record<string, any>> {
        const url = new URL(resource, ROOT);
        url.search = new URLSearchParams(query).toString();
        let response: Response;
        // A token error occurs before any remote mutation and is therefore a definite rejection.
        let token: string;
        try {
            token = await this.token();
        }
        catch {
            throw new RemoteError('authorization', 'Reconnect this YouTube account before continuing.', 'rejected');
        }
        guard?.();
        try {
            response = await this.http(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
        }
        catch {
            throw new RemoteError('transport', method === 'GET' ? 'YouTube status could not be read.' : 'YouTube did not confirm this write. It may have succeeded. Refresh and recover the existing event; do not create a duplicate.', 'unknown');
        }
        if (response.status === 204 && response.ok)
            return {};
        let raw: Record<string, any>;
        try {
            raw = read(await response.json());
        }
        catch {
            throw new RemoteError('response', 'YouTube returned an unreadable response. Reconcile before retrying.', 'unknown');
        }
        if (!response.ok) {
            const e = raw.error && typeof raw.error === 'object' ? raw.error : {}, reason = Array.isArray(e.errors) ? e.errors[0]?.reason : '';
            const code = response.status === 401 ? 'authorization' : response.status === 412 ? 'conditionNotMet' : (typeof reason === 'string' && Object.hasOwn(errors, reason) ? reason : `http_${response.status}`);
            const detail = code === 'authorization' ? 'Google access expired or was revoked. Reconnect this account.' : errors[code] || `YouTube rejected the request (HTTP ${response.status}).`;
            throw new RemoteError(code, detail, response.status >= 500 ? 'unknown' : 'rejected');
        }
        return raw;
    }
    private async list(resource: string, query: Record<string, string>): Promise<unknown[]> {
        const out: unknown[] = [], seen = new Set<string>();
        let next = '';
        for (let page = 0; page < 100; page++) {
            const r = await this.request('GET', resource, { ...query, maxResults: '50', ...(next ? { pageToken: next } : {}) });
            if (!Array.isArray(r.items))
                throw new ManagementError('pagination', 'YouTube returned an incomplete list. No missing-event conclusions were made.');
            out.push(...r.items);
            if (!r.nextPageToken)
                return out;
            if (typeof r.nextPageToken !== 'string' || seen.has(r.nextPageToken))
                throw new ManagementError('pagination', 'YouTube pagination was not confirmed.');
            next = r.nextPageToken;
            seen.add(next);
        }
        throw new ManagementError('pagination', 'This account exceeds the inspection limit. The partial list was not used.');
    }
    async channel(): Promise<Channel> {
        const r = await this.request('GET', 'channels', { part: 'id,snippet', mine: 'true' });
        if (!Array.isArray(r.items) || r.items.length !== 1)
            throw new ManagementError('channel', 'Authorize exactly one YouTube channel or Brand Account.');
        return { id: id(r.items[0].id), title: String(r.items[0].snippet?.title || 'YouTube channel').slice(0, 200) };
    }
    async broadcasts(): Promise<RemoteBroadcast[]> { return (await this.list('liveBroadcasts', { part: PARTS, mine: 'true', broadcastType: 'all' })).map(event); }
    async broadcast(broadcastId: string): Promise<RemoteBroadcast | null> {
        const r = await this.request('GET', 'liveBroadcasts', { part: PARTS, id: id(broadcastId) });
        if (!Array.isArray(r.items) || r.items.length > 1)
            throw new ManagementError('response', 'YouTube returned invalid event results.');
        return r.items.length ? event(r.items[0]) : null;
    }
    async profiles(): Promise<PrivateProfile[]> { return (await this.list('liveStreams', { part: 'id,snippet,cdn,status,contentDetails', mine: 'true' })).map(profile); }
    async profile(profileId: string): Promise<PrivateProfile> {
        const r = await this.request('GET', 'liveStreams', { part: 'id,snippet,cdn,status,contentDetails', id: id(profileId) });
        if (!Array.isArray(r.items) || r.items.length !== 1)
            throw new ManagementError('profile', 'This YouTube streaming profile no longer exists.');
        return profile(r.items[0]);
    }
    async create(input: EventInput, guard?: () => void): Promise<RemoteBroadcast> {
        return event(await this.request('POST', 'liveBroadcasts', { part: PARTS }, { snippet: { title: input.title, description: input.description, scheduledStartTime: input.startsAt }, status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: input.madeForKids }, contentDetails: { enableAutoStart: false, enableAutoStop: false, monitorStream: { enableMonitorStream: false, broadcastStreamDelayMs: 0 } } }, guard));
    }
    async update(before: RemoteBroadcast, input: EventInput, guard?: () => void): Promise<RemoteBroadcast> {
        // Updating a part replaces its writable fields. Preserve the event's planned duration.
        const duration = before.endsAt ? Date.parse(before.endsAt) - Date.parse(before.startsAt) : 0;
        const snippet = { title: input.title, description: input.description, scheduledStartTime: input.startsAt, ...(duration > 0 ? { scheduledEndTime: new Date(Date.parse(input.startsAt) + duration).toISOString() } : {}) };
        return event(await this.request('PUT', 'liveBroadcasts', { part: 'id,snippet,status' }, { id: before.id, snippet, status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: input.madeForKids } }, guard, before.etag));
    }
    async delete(before: RemoteBroadcast, guard?: () => void): Promise<void> { await this.request('DELETE', 'liveBroadcasts', { id: id(before.id) }, undefined, guard, before.etag); }
    async bind(before: RemoteBroadcast, profileId: string, guard?: () => void): Promise<RemoteBroadcast> {
        return event(await this.request('POST', 'liveBroadcasts/bind', { part: PARTS, id: id(before.id), streamId: id(profileId) }, undefined, guard, before.etag));
    }
}
