import { ACTIVE, LANGUAGES, ManagementError, id, language, only, text } from './stream-management-model.ts';
import type { Language, Channel, AccountView, Profile, PrivateProfile } from './stream-management-model.ts';
import type { ManagementApi } from './stream-management-api.ts';
import { ingestServer } from './stream-management-api.ts';
export interface OAuthAccount {
    readonly configured: boolean;
    readonly channel: Channel | null;
    load(): Promise<void>;
    configure(raw: unknown): Promise<void>;
    signIn(resolve: (token: string) => Promise<Channel>): Promise<Channel>;
    token(): Promise<string>;
    forget(): Promise<void>;
    cancel(): void;
}
export interface EncryptedStore {
    load(): Promise<string | null>;
    save(value: string): Promise<void>;
    clear(): Promise<void>;
}
export interface AccountSlot {
    oauth: OAuthAccount;
    profileStore: EncryptedStore;
}
export interface AccountAccess {
    views(): AccountView[];
    authorized(language: Language, expectedChannel?: string): Promise<ManagementApi>;
    savedProfile(language: Language): Promise<PrivateProfile>;
}
export const publicProfile = (p: PrivateProfile): Profile => ({ id: p.id, channelId: p.channelId, title: p.title, status: p.status, reusable: p.reusable });
function decodeProfile(value: string): PrivateProfile {
    try {
        const p = only(JSON.parse(value), ['id', 'channelId', 'title', 'status', 'reusable', 'key', 'server']);
        if (p.reusable !== true || typeof p.key !== 'string' || !p.key || p.key.length > 2048 || /[\r\n\u0000]/.test(p.key))
            throw new Error();
        return { id: id(p.id), channelId: id(p.channelId), title: text(p.title, 500), status: text(p.status, 100), reusable: true, key: p.key, server: ingestServer(p.server) };
    }
    catch {
        throw new ManagementError('profile', 'The encrypted streaming profile is invalid. It has not been replaced.');
    }
}
/** One administrator access level. Credential material only leaves here on explicit reveal/copy. */
export class StreamAccounts implements AccountAccess {
    private profiles: Partial<Record<Language, Profile>> = {};
    constructor(private slots: Record<Language, AccountSlot>, private apiFactory: (token: () => Promise<string>) => ManagementApi, private encoderBusy: (language: Language) => boolean = () => false) { }
    async load(): Promise<void> {
        this.profiles = {};
        for (const lang of LANGUAGES) {
            await this.slots[lang].oauth.load();
            const saved = await this.slots[lang].profileStore.load();
            if (saved) {
                const p = decodeProfile(saved);
                if (p.channelId === this.slots[lang].oauth.channel?.id)
                    this.profiles[lang] = publicProfile(p);
            }
        }
    }
    views(): AccountView[] { return LANGUAGES.map(lang => ({ language: lang, configured: this.slots[lang].oauth.configured, channel: this.slots[lang].oauth.channel, profile: this.profiles[lang] ? { ...this.profiles[lang]! } : null, keySaved: !!this.profiles[lang] })); }
    async authorized(lang: Language, expected?: string): Promise<ManagementApi> {
        language(lang);
        const oauth = this.slots[lang].oauth, selected = oauth.channel;
        if (!selected || (expected && selected.id !== expected))
            throw new ManagementError('account', 'This destination is linked to a different or disconnected YouTube channel. Reconnect the original channel; existing events were not moved.');
        const api = this.apiFactory(() => oauth.token()), actual = await api.channel();
        if (actual.id !== selected.id)
            throw new ManagementError('account', 'Google returned a different channel. Reconnect before continuing.');
        return api;
    }
    private async idle(lang: Language): Promise<void> {
        if (this.encoderBusy(lang))
            throw new ManagementError('active', 'The encoder may be transmitting. Stop it before replacing or removing credentials.');
        if (!this.slots[lang].oauth.channel)
            return;
        const api = await this.authorized(lang);
        if ((await api.broadcasts()).some(b => ACTIVE.has(b.lifecycle)))
            throw new ManagementError('active', 'A live or testing broadcast protects this account from credential changes.');
        const selected = this.profiles[lang];
        if (selected && (await api.profile(selected.id)).status === 'active')
            throw new ManagementError('active', 'The saved ingestion profile is receiving video. Stop the encoder before changing it.');
    }
    async configure(lang: Language, raw: unknown): Promise<void> { language(lang); await this.idle(lang); await this.slots[lang].oauth.configure(raw); }
    async connect(lang: Language): Promise<void> {
        language(lang);
        const previous = this.slots[lang].oauth.channel;
        // Repair expired authorization without needing that expired token to pass a network check.
        // Reauthorization is pinned to the same channel; switching requires explicit disconnection.
        if (!previous && this.encoderBusy(lang))
            throw new ManagementError('active', 'Stop the encoder before connecting a new channel.');
        const channel = await this.slots[lang].oauth.signIn(async (token) => {
            const c = await this.apiFactory(async () => token).channel();
            if (previous && c.id !== previous.id)
                throw new ManagementError('account', 'Reconnect the same channel. To switch channels, disconnect explicitly when no broadcast is active.');
            if (LANGUAGES.some(other => other !== lang && this.slots[other].oauth.channel?.id === c.id))
                throw new ManagementError('account', 'German and Russian destinations must use separate YouTube channels.');
            return c;
        });
        if (this.profiles[lang]?.channelId !== channel.id) {
            await this.slots[lang].profileStore.clear();
            delete this.profiles[lang];
        }
    }
    async disconnect(lang: Language): Promise<void> {
        language(lang);
        await this.idle(lang);
        await this.slots[lang].oauth.forget();
        await this.slots[lang].profileStore.clear();
        delete this.profiles[lang];
    }
    async listProfiles(lang: Language): Promise<Profile[]> {
        const api = await this.authorized(lang), channel = this.slots[lang].oauth.channel!;
        return (await api.profiles()).filter(p => p.channelId === channel.id && p.reusable).map(publicProfile);
    }
    async selectProfile(lang: Language, profileId: string): Promise<void> {
        language(lang);
        id(profileId);
        await this.idle(lang);
        const api = await this.authorized(lang), p = await api.profile(profileId);
        if (p.channelId !== this.slots[lang].oauth.channel?.id || !p.reusable)
            throw new ManagementError('profile', 'Choose a reusable streaming profile owned by this channel.');
        if (p.status === 'active')
            throw new ManagementError('active', 'This profile is receiving video. Do not change its saved configuration during transmission.');
        await this.slots[lang].profileStore.save(JSON.stringify(decodeProfile(JSON.stringify(p))));
        this.profiles[lang] = publicProfile(p);
    }
    async clearProfile(lang: Language): Promise<void> { language(lang); await this.idle(lang); await this.slots[lang].profileStore.clear(); delete this.profiles[lang]; }
    async savedProfile(lang: Language): Promise<PrivateProfile> {
        language(lang);
        const value = await this.slots[lang].profileStore.load();
        if (!value)
            throw new ManagementError('profile', 'Select a reusable streaming profile in YouTube accounts first.');
        const p = decodeProfile(value);
        if (p.channelId !== this.slots[lang].oauth.channel?.id)
            throw new ManagementError('profile', 'The saved key belongs to another channel. Select the correct profile.');
        return p;
    }
    cancel(): void { for (const lang of LANGUAGES)
        this.slots[lang].oauth.cancel(); }
}
