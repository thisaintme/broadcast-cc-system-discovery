import { BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { YouTubeOAuth } from './youtube-oauth.ts';
import { YouTubeSecretFile } from './youtube-storage.ts';
import { YouTubeFailure } from './youtube-model.ts';
import { StreamManagementApi } from './stream-management-api.ts';
import { StreamManagementFile } from './stream-management-store.ts';
import { StreamManagementService } from './stream-management-service.ts';
import { AccountSetup } from './stream-account-setup.ts';
import { object } from './stream-management-model.ts';
import { StreamAccounts } from './stream-accounts.ts';
import { ManagementError, PersistenceError, eventTitle, id, language, message, only, parseDestinations, scope, watchUrl } from './stream-management-model.ts';
import type { Language, Occurrence, Profile, RemoteBroadcast } from './stream-management-model.ts';
import type { ManagementPanel, ManagementReply } from './stream-management-contract.ts';
interface Dependencies {
    directory: string;
    parent(): BrowserWindow | null;
    germanOAuth: YouTubeOAuth;
    externalBusy(): boolean;
    encoderBusy(language: Language): boolean;
    openControls(): Promise<void>;
    useOnDesk(occurrence: Occurrence): Promise<void>;
}
/** Trusted main-process coordinator. This window never starts an encoder automatically. */
export class StreamManagementWindow {
    private window: BrowserWindow | null = null;
    private opening: Promise<void> | null = null;
    private generation = 0;
    private ready = false;
    private working = false;
    private error = '';
    private notice = 'Scheduling does not start OBS or Web Presenter. All times use Europe/Berlin.';
    private remote: Partial<Record<Language, RemoteBroadcast[]>> = {};
    private accounts: StreamAccounts;
    private setup: AccountSetup;
    private service: StreamManagementService;
    constructor(private d: Dependencies) {
        const secret = (name: string) => new YouTubeSecretFile(path.join(d.directory, name), {
            available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
            encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value),
        });
        this.accounts = new StreamAccounts({
            de: { oauth: d.germanOAuth, profileStore: secret('stream-profile-de.enc') },
            ru: { oauth: new YouTubeOAuth(secret('google-credentials-ru.enc'), url => shell.openExternal(url)), profileStore: secret('stream-profile-ru.enc') },
        }, token => new StreamManagementApi(token), d.encoderBusy);
        this.setup = new AccountSetup(this.accounts, {de:secret('pending-stream-key-de.enc'),ru:secret('pending-stream-key-ru.enc')});
        this.service = new StreamManagementService(new StreamManagementFile(path.join(d.directory, 'stream-management.json')), this.accounts, () => this.emit());
        const sender = (event: IpcMainInvokeEvent) => {
            if (!this.window || event.sender !== this.window.webContents || event.senderFrame !== this.window.webContents.mainFrame || event.senderFrame?.url !== 'bcc://app/stream-management.html')
                throw new Error('Untrusted Stream Management request.');
        };
        ipcMain.handle('stream-management:panel', event => { sender(event); return this.panel(); });
        ipcMain.handle('stream-management:preview', (event, raw) => { sender(event); try {
            return this.service.preview(raw).dates;
        }
        catch (e) {
            throw new Error(message(e));
        } });
        ipcMain.handle('stream-management:cancel', event => { sender(event); this.cancel(); });
        ipcMain.handle('stream-management:action', async (event, raw): Promise<ManagementReply> => {
            sender(event);
            if (!this.ready || this.working || d.externalBusy())
                throw new Error('Wait for the current operation to finish or cancel it. Reopen this window if local data could not be loaded.');
            this.working = true;
            this.error = '';
            this.emit();
            let profiles: Profile[] | undefined;
            try {
                profiles = await this.action(raw);
            }
            catch (e) {
                if (e instanceof PersistenceError)
                    this.ready = false;
                this.error = e instanceof YouTubeFailure ? e.message : message(e);
            }
            finally {
                this.working = false;
                this.emit();
            }
            return { panel: this.panel(), ...(profiles ? { profiles } : {}) };
        });
    }
    get busy(): boolean { return this.working; }
    panel(): ManagementPanel { return { state: this.service.snapshot(), accounts: this.accounts.views().map(a=>({...a,keyPending:this.setup.hasPending(a.language)})), busy: this.working, ready: this.ready, error: this.error, notice: this.notice, remote: structuredClone(this.remote) }; }
    emit(): void { if (this.window && !this.window.isDestroyed())
        this.window.webContents.send('stream-management:state', this.panel()); }
    cancel(): void { this.generation++; this.service.cancel(); if (this.working) {this.accounts.cancel(); this.notice = 'Pending follow-up cancelled. Completed remote changes remain. No encoder was stopped.';} this.emit(); }
    close(): void { this.cancel(); this.window?.close(); }
    async open(): Promise<void> {
        if (this.window && !this.window.isDestroyed()) {
            this.window.focus();
            return;
        }
        if (this.opening)
            return this.opening;
        if (this.working || this.d.externalBusy())
            throw new ManagementError('busy', 'An operation is already in progress. Open Stream Management after it finishes.');
        this.opening = this.openWindow();
        try {
            await this.opening;
        }
        finally {
            this.opening = null;
        }
    }
    private async openWindow(): Promise<void> {
        if (!this.ready)
            try {
                await this.accounts.load();
                await this.setup.load();
                await this.service.load();
                this.ready = true;
                this.error = '';
            }
            catch (e) {
                if (e instanceof PersistenceError)
                    this.ready = false;
                this.error = e instanceof YouTubeFailure ? e.message : message(e);
            }
        this.window = new BrowserWindow({ width: 1260, height: 900, minWidth: 940, minHeight: 700, title: 'Broadcast Control Center — Stream Management', parent: this.d.parent() || undefined, webPreferences: { preload: path.join(__dirname, 'stream-management-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
        this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        this.window.webContents.on('will-navigate', event => event.preventDefault());
        this.window.webContents.on('render-process-gone', () => this.cancel());
        this.window.webContents.on('did-start-loading', () => { if (this.working) this.cancel(); });
        this.window.on('closed', () => { this.cancel(); this.window = null; });
        await this.window.loadURL('bcc://app/stream-management.html');
    }
    private async confirm(title: string, detail: string, button = 'Confirm'): Promise<boolean> {
        const generation = this.generation;
        const result = await dialog.showMessageBox(this.window!, { type: 'warning', message: title, detail, buttons: ['Cancel', button], defaultId: 0, cancelId: 0 });
        return result.response === 1 && generation === this.generation && !!this.window && !this.window.isDestroyed();
    }
    private known(lang: Language, broadcastId: string): string {
        const channelId = this.accounts.views().find(a => a.language === lang)?.channel?.id;
        const known = this.service.snapshot().occurrences.some(o => o.targets.some(t => t.language === lang && t.channelId === channelId && t.broadcastId === broadcastId)) || this.remote[lang]?.some(b => b.channelId === channelId && b.id === broadcastId);
        if (!known)
            throw new ManagementError('event', 'Select a known event on the connected channel.');
        return id(broadcastId);
    }
    private async action(raw: unknown): Promise<Profile[] | undefined> {
        // Keep secret-bearing inputs out of all generic review and error formatting.
        const kind = object(raw).kind, epoch = this.generation;
        const guard = () => { if (epoch !== this.generation || !this.window || this.window.isDestroyed()) throw new ManagementError('cancelled','Setup cancelled.'); };
        if (kind === 'stage-key' || kind === 'verify-key' || kind === 'discard-key') {
            const body = only(raw, kind === 'stage-key' ? ['kind','language','key'] : ['kind','language']);
            const lang = language(body.language), label = lang === 'de' ? 'German · OBS' : 'Russian · Web Presenter';
            if (kind === 'stage-key') {
                if (await this.confirm('Save this key on this Mac?', label+' · Only the encrypted, unverified key is saved or replaced. No active profile or encoder is changed.', 'Save local key')) {
                    await this.setup.stage(lang,body.key,guard); this.notice=label+' · Key saved on this Mac. Verify it after connecting YouTube.';
                }
            } else if (kind === 'verify-key') {
                if (await this.confirm('Verify and use this key?', label+' · Only an exact match on this channel can replace its verified profile. No encoder setting changes.', 'Verify and use')) {
                    await this.setup.verify(lang,guard); this.notice=label+' · Key verified against the channel and saved as its streaming profile.';
                }
            } else if (await this.confirm('Forget this unverified key?',label+' · Your verified profile, YouTube and the encoder stay unchanged.','Forget local key')) {
                await this.setup.discard(lang);this.notice=label+' · Unverified key removed.';
            }
            return;
        }
        if(kind === 'setup-client' || kind === 'setup-client-file') {
            const body=only(raw,kind==='setup-client'?['kind','clientId','clientSecret']:['kind']);
            let config:unknown;
            if(kind==='setup-client-file') {
                const pick=await dialog.showOpenDialog(this.window!,{title:'Choose Google Desktop app credentials from this Mac',properties:['openFile'],filters:[{name:'Google Desktop app JSON',extensions:['json']}]});
                if(pick.canceled)return;guard();
                if((await stat(pick.filePaths[0])).size>65536)throw new ManagementError('file','Choose a Desktop client JSON under 64 KiB.');
                try{config=JSON.parse(await readFile(pick.filePaths[0],'utf8'));}catch{throw new ManagementError('file','This is not a readable Desktop client JSON.');}
            }else {config={installed:{client_id:body.clientId,client_secret:body.clientSecret}};}
            guard();
            if(await this.confirm('Save Google sign-in setup?', 'The Desktop client will be saved in encrypted storage for unconnected destinations on this Mac. Linked channels are not changed. This is not a Google account password.', 'Save setup')) {
                await this.setup.configureSignIn(config,guard); this.notice='Google sign-in setup saved. Choose Connect YouTube on the destination you want to link.';
            }
            return;
        }
        const r = only(raw, ['kind', 'plan', 'draft', 'edit', 'occurrenceId', 'scope', 'language', 'broadcastId', 'profileId', 'madeForKids', 'template', 'germanOnly']);
        const lang = r.language !== undefined ? language(r.language) : undefined;
        const needLang = () => { if (!lang)
            throw new ManagementError('input', 'Choose a destination.'); return lang; };
        if (r.kind === 'create') {
            const { plan, dates } = this.service.preview(r.plan);
            const destination = plan.destinations.map(t => `${t.language.toUpperCase()}: ${this.accounts.views().find(a => a.language === t.language)?.channel?.title || '(not connected)'} • ${t.privacy} • Made for kids: ${t.madeForKids ? 'yes' : 'no'}\n${eventTitle(dates[0].date, t.title)}\nDescription: ${t.description || '(empty)'}`).join('\n\n');
            if (await this.confirm(`Create ${dates.length * plan.destinations.length} YouTube event(s)?`, `${destination}\n\n${dates.map(d => `${d.date} ${d.time}`).join('\n')}\nEurope/Berlin\n\nThese events will be created on YouTube now. Scheduling does not start equipment or send notifications.`, 'Create on YouTube')) {
                const result = await this.service.create(plan);
                this.notice = `Creation finished: ${result.filter(t => t.stage === 'ready').length} confirmed. Review each destination below; failed or uncertain work was not silently repeated.`;
            }
        }
        else if (r.kind === 'add-destination') {
            const draft = parseDestinations([r.draft])[0];
            if (await this.confirm('Create an additional destination for this occurrence?', `${draft.language.toUpperCase()} • ${draft.privacy} • Made for kids: ${draft.madeForKids ? 'yes' : 'no'}\nTitle: ${draft.title.text}\nDescription: ${draft.description || '(empty)'}\n\nA new YouTube event will be created. Any previously deleted event stays deleted; its old link is not reused.`, 'Create destination'))
                await this.service.addDestination(id(r.occurrenceId), draft);
        }
        else if (r.kind === 'edit') {
            const edit = only(r.edit, ['occurrenceId', 'scope', 'date', 'time', 'destinations']);
            const affected = this.service.affected(id(edit.occurrenceId), scope(edit.scope));
            if (await this.confirm('Update these scheduled broadcasts?', `${affected.map(o => `${o.date} ${o.time} • ${o.targets.map(t => t.language.toUpperCase()).join(' / ')}`).join('\n')}\n\nRequested changes:\n${JSON.stringify(edit, null, 2)}\n\nExisting YouTube IDs and viewing links are kept. Individual series exceptions are preserved.`, 'Update events')) {
                await this.service.edit(edit);
                this.notice = 'Update finished. Review the separate destination results below.';
            }
        }
        else if (r.kind === 'remove') {
            const oid = id(r.occurrenceId), selection = scope(r.scope), affected = this.service.affected(oid, selection);
            if (await this.confirm('Delete upcoming events from YouTube?', `${affected.map(o => `${o.date} ${o.time} • ${o.targets.filter(t => !lang || lang === t.language).map(t => `${t.language.toUpperCase()}: ${t.observed?.title || eventTitle(o.date, t.draft.title)}`).join(' / ')}`).join('\n')}\n\nThis is not just removal from the app. Live events and recordings are protected. Stream keys will not be deleted. Deleted occurrences remain excluded from the series.`, 'Delete upcoming events')) {
                await this.service.remove(oid, selection, lang);
                this.notice = 'Deletion finished. Review each destination; any failures remain visible.';
            }
        }
        else if (r.kind === 'retry') {
            await this.service.retry(id(r.occurrenceId), needLang());
            this.notice = 'Only this failed or pending destination was retried.';
        }
        else if (r.kind === 'refresh') {
            this.remote[needLang()] = await this.service.refresh(needLang());
            this.notice = `${needLang().toUpperCase()} refreshed from YouTube. External events are not adopted automatically.`;
        }
        else if (r.kind === 'recover') {
            if (await this.confirm('Use this existing event for recovery?', `${needLang().toUpperCase()} event ${id(r.broadcastId)}\nThe existing event is retained, not recreated. Current metadata is reviewed. An unresolved time change can be retried only against that same known ID.`))
                await this.service.recover(id(r.occurrenceId), needLang(), id(r.broadcastId));
        }
        else if (r.kind === 'adopt') {
            if (typeof r.madeForKids !== 'boolean')
                throw new ManagementError('audience', 'Answer the audience question.');
            if (await this.confirm('Manage this existing YouTube event in the app?', `${needLang().toUpperCase()} • ${id(r.broadcastId)}\nNo duplicate event or stream key will be created.`))
                await this.service.adopt(needLang(), id(r.broadcastId), r.madeForKids);
        }
        else if (r.kind === 'prepare') {
            if (await this.confirm('Prepare this event with the saved streaming profile?', `${needLang().toUpperCase()} • Only this event will be bound to its saved account profile. No encoder settings are changed and nothing goes live.`, 'Prepare event')) {
                await this.service.prepare(id(r.occurrenceId), needLang());
                this.notice = 'Streaming profile binding checked. Starting the broadcast remains an explicit action.';
            }
        }
        else if (r.kind === 'configure') {
            const generation = this.generation;
            const pick = await dialog.showOpenDialog(this.window!, { title: `Import ${needLang().toUpperCase()} Google Desktop OAuth client`, properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
            if (!pick.canceled && generation === this.generation) {
                if ((await stat(pick.filePaths[0])).size > 64 * 1024)
                    throw new ManagementError('file', 'OAuth client files must be smaller than 64 KiB.');
                let value;
                try {
                    value = JSON.parse(await readFile(pick.filePaths[0], 'utf8'));
                }
                catch {
                    throw new ManagementError('file', 'The OAuth client file is not valid JSON.');
                }
                if (generation !== this.generation)
                    return;
                await this.accounts.configure(needLang(), value);
            }
        }
        else if (r.kind === 'connect') {
            await this.accounts.connect(needLang());
            delete this.remote[needLang()];
            this.notice = 'Account connected. Verify the channel name and select its reusable streaming profile.';
        }
        else if (r.kind === 'disconnect') {
            if (await this.confirm('Remove this account connection from this Mac?', `${needLang().toUpperCase()} • Local authorization and saved profile will be removed. Existing YouTube events and equipment settings stay unchanged. Google permission revocation is separate.`, 'Disconnect locally')) {
                await this.accounts.disconnect(needLang());
                await this.setup.discard(needLang());
                delete this.remote[needLang()];
            }
        }
        else if (r.kind === 'profiles')
            return await this.accounts.listProfiles(needLang());
        else if (r.kind === 'select-profile') {
            if (await this.confirm('Save this reusable streaming profile securely?', `${needLang().toUpperCase()} • Profile ${id(r.profileId)}\nIts key is encrypted on this Mac. No encoder will be reconfigured. After a YouTube key reset, update the encoder with the refreshed key.`, 'Save profile'))
                await this.accounts.selectProfile(needLang(), id(r.profileId));
        }
        else if (r.kind === 'forget-key') {
            if (await this.confirm('Forget the locally saved stream key?', `${needLang().toUpperCase()} • This does not reset or delete the key on YouTube or in the encoder.`, 'Forget local key'))
                await this.accounts.clearProfile(needLang());
        }
        else if (['reveal-key', 'copy-key', 'copy-server'].includes(String(r.kind))) {
            if (await this.confirm(r.kind === 'reveal-key' ? 'Reveal the stream key?' : r.kind === 'copy-key' ? 'Copy the stream key to the clipboard?' : 'Copy the ingestion server?', 'Anyone with a stream key can send video to that stream. Clipboard contents may be accessible to other apps. Do not include credentials in screenshots or support reports.')) {
                const p = await this.accounts.savedProfile(needLang());
                if (r.kind === 'reveal-key')
                    await dialog.showMessageBox(this.window!, { type: 'info', message: 'Stream key — sensitive', detail: p.key, buttons: ['Close'], defaultId: 0 });
                else {
                    const value = r.kind === 'copy-key' ? p.key : p.server;
                    await clipboard.writeText(value);
                    if (r.kind === 'copy-key') {
                        const timer = setTimeout(async () => { try { if (await clipboard.readText() === value) await clipboard.clear(); } catch { /* Clipboard ownership may have changed or the app may be shutting down. */ } }, 30000);
                        timer.unref();
                    }
                    this.notice = 'Copied. A copied key is cleared after 30 seconds only if the clipboard is unchanged.';
                }
            }
        }
        else if (r.kind === 'template') {
            await this.service.saveTemplate(r.template);
            this.notice = 'Template saved locally. No YouTube event was created.';
        }
        else if (r.kind === 'open' || r.kind === 'copy-link') {
            const url = watchUrl(this.known(needLang(), id(r.broadcastId)));
            if (r.kind === 'open')
                await shell.openExternal(url);
            else
                await clipboard.writeText(url);
        }
        else if (r.kind === 'operator') {
            const generation = this.generation, occurrence = this.service.snapshot().occurrences.find(o => o.id === id(r.occurrenceId)), german = occurrence?.targets.find(t => t.language === 'de');
            if (!occurrence || !german?.broadcastId || german.stage !== 'ready')
                throw new ManagementError('operator', 'Create or recover the German event first.');
            const russian = occurrence.targets.find(t => t.language === 'ru' && t.stage !== 'deleted');
            if (russian && r.germanOnly !== true)
                throw new ManagementError('operator', 'This handoff controls German/OBS only. Explicitly choose Continue with German only; Russian remains independently scheduled and manually operated.');
            if (await this.confirm('Use this German event on the operator desk?', `${eventTitle(occurrence.date, german.draft.title)}\n${occurrence.date} ${occurrence.time} Europe/Berlin\n\nThe event will be bound to the saved profile and checked against OBS’s current destination. It will not go live. ${russian ? 'Russian is not started or stopped by this handoff.' : ''}`, russian ? 'Continue with German only' : 'Use on operator desk')) {
                await this.service.prepare(occurrence.id, 'de');
                if (generation !== this.generation)
                    return;
                await this.d.useOnDesk(occurrence);
                this.notice = 'German event linked to the local service. Select that service on the operator desk; use the guarded Start with Intro action to go live.';
            }
        }
        else if (r.kind === 'legacy-controls')
            await this.d.openControls();
        else
            throw new ManagementError('input', 'Unknown Stream Management action.');
        return undefined;
    }
}
