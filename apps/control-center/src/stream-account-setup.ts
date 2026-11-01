import { desktopClient } from './youtube-oauth.ts';
import { LANGUAGES, ManagementError, language as checkLanguage } from './stream-management-model.ts';
import type { Language } from './stream-management-model.ts';
import type { EncryptedStore, StreamAccounts } from './stream-accounts.ts';

function keyText(raw: unknown): string {
    const value = typeof raw === 'string' && raw.length <= 2056 ? raw.trim() : '';
    if (!/^[A-Za-z0-9_-]{4,2048}$/.test(value)) throw new ManagementError('key', 'Paste only the stream key from YouTube Studio, not a URL or an OAuth credential.');
    return value;
}
/** Pending keys are private, per destination, and never supplied to an encoder or event. */
export class AccountSetup {
    private present = new Set<Language>();
    constructor(private accounts: StreamAccounts, private stores: Record<Language, EncryptedStore>) {}
    async load(): Promise<void> {
        this.present.clear();
        for (const lang of LANGUAGES) {
            const value = await this.stores[lang].load();
            if (value !== null) { keyText(value); this.present.add(lang); }
        }
    }
    hasPending(lang: Language): boolean { return this.present.has(lang); }
    async stage(lang: Language, raw: unknown, guard: () => void): Promise<void> {
        checkLanguage(lang); const key = keyText(raw);
        await this.accounts.assertIdle(lang); guard();
        await this.stores[lang].save(key); this.present.add(lang);
    }
    async verify(lang: Language, guard: () => void): Promise<void> {
        checkLanguage(lang);
        const raw = await this.stores[lang].load();
        if (raw === null) throw new ManagementError('key', 'Save a key on this Mac first.');
        const key = keyText(raw), channel = this.accounts.views().find(v => v.language === lang)?.channel;
        if (!channel) throw new ManagementError('account', 'Connect this YouTube channel first. The saved key is unchanged.');
        const api = await this.accounts.authorized(lang, channel.id); guard();
        const matches = (await api.profiles()).filter(p => p.reusable && p.channelId === channel.id && p.key === key); guard();
        if (matches.length !== 1) throw new ManagementError('key', 'This key did not match exactly one reusable profile on the connected channel. Check the channel and key. The existing profile is unchanged.');
        // Read the specific profile again; a rotation between list and verification is not accepted.
        await this.accounts.selectProfile(lang, matches[0].id, key, guard);
        await this.discard(lang);
    }
    async discard(lang: Language): Promise<void> { checkLanguage(lang); await this.stores[lang].clear(); this.present.delete(lang); }
    async configureSignIn(raw: unknown, guard: () => void): Promise<void> {
        const {clientId, clientSecret} = desktopClient(raw);
        const eligible = this.accounts.views().filter(a => !a.channel);
        if (!eligible.length) throw new ManagementError('account', 'Both channels are linked. Their authorization has not been changed.');
        const client = {installed:{client_id:clientId, client_secret:clientSecret}};
        for (const a of eligible) { guard(); await this.accounts.configure(a.language, client, guard); }
    }
}
