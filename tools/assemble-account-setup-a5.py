from pathlib import Path
root=Path('apps/control-center'); src=root/'src'
def edit(path,a,b):
 s=path.read_text(); assert s.count(a)==1,(path,a); path.write_text(s.replace(a,b))
e=src/'stream-accounts.ts'
edit(e,'private async idle(', 'async assertIdle(')
s=e.read_text().replace('this.idle(', 'this.assertIdle(');e.write_text(s)
edit(e,'async configure(lang: Language, raw: unknown): Promise<void> { language(lang); await this.assertIdle(lang); await',"async configure(lang: Language, raw: unknown, guard = () => {}): Promise<void> { language(lang); await this.assertIdle(lang); guard(); if(this.encoderBusy(lang)) throw new ManagementError('active','Encoder state changed. No configuration was saved.'); await")
edit(e,'async selectProfile(lang: Language, profileId: string):','async selectProfile(lang: Language, profileId: string, expectedKey?: string, guard = () => {}):')
edit(e,'if (p.channelId !== this.slots[lang].oauth.channel?.id || !p.reusable)',"guard();\n        if (this.encoderBusy(lang) || (expectedKey !== undefined && (!['created','ready','inactive'].includes(p.status) || expectedKey !== p.key)))\n            throw new ManagementError('profile', 'The key or encoder state changed. The saved profile was not replaced.');\n        if (p.id !== profileId || p.channelId !== this.slots[lang].oauth.channel?.id || !p.reusable)")
e=src/'stream-management-model.ts';edit(e,'    keySaved: boolean;', '    keySaved: boolean;\n    keyPending?: boolean;')
e=src/'stream-management-contract.ts';edit(e,'export type ManagementAction = {', "export type ManagementAction = {kind:'stage-key';language:Language;key:string} | {kind:'verify-key'|'discard-key';language:Language} | {kind:'setup-client';clientId:string;clientSecret:string} | {kind:'setup-client-file'} | {")
e=src/'stream-management-main.ts';edit(e,"import { StreamAccounts }", "import { AccountSetup } from './stream-account-setup.ts';\nimport { object } from './stream-management-model.ts';\nimport { StreamAccounts }");edit(e,'    private accounts: StreamAccounts;', '    private accounts: StreamAccounts;\n    private setup: AccountSetup;');edit(e,'        this.service = new StreamManagementService(',"        this.setup = new AccountSetup(this.accounts, {de:secret('pending-stream-key-de.enc'),ru:secret('pending-stream-key-ru.enc')});\n        this.service = new StreamManagementService(");edit(e,'accounts: this.accounts.views(), busy:', 'accounts: this.accounts.views().map(a=>({...a,keyPending:this.setup.hasPending(a.language)})), busy:');edit(e,'await this.accounts.load();','await this.accounts.load();\n                await this.setup.load();');edit(e,"if (this.working)\n        this.accounts.cancel(); this.notice = 'Pending follow-up cancelled. Completed remote changes remain. No encoder was stopped.'; this.emit();", "if (this.working) {this.accounts.cancel(); this.notice = 'Pending follow-up cancelled. Completed remote changes remain. No encoder was stopped.';} this.emit();")
edit(e,"        const r = only(raw, ['kind', 'plan',", """        // Keep secret-bearing inputs out of all generic review and error formatting.
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
        const r = only(raw, ['kind', 'plan',""")
edit(e,'await this.accounts.disconnect(needLang());','await this.accounts.disconnect(needLang());\n                await this.setup.discard(needLang());')
e=src/'stream-management-renderer.tsx';edit(e,"const bridge = window.streamManagement;", "const bridge = window.streamManagement;");s=e.read_text();e.write_text("import { SignInSetup, ManualKey } from './stream-account-forms.tsx';\n"+s);edit(e,'<h2>YouTube account management</h2>','<h2>YouTube account management</h2><SignInSetup panel={panel} run={run}/>');edit(e,'<button disabled={panel.busy} onClick={() => void run({ kind: \'configure\', language: a.language })}>Import OAuth client</button>','');edit(e,'<hr /><p>Saved profile:', '<hr /><ManualKey account={a} run={run} disabled={panel.busy || !panel.ready}/><hr /><h4>Connected YouTube profile</h4><p>Saved profile:');edit(e,'<p>Stream key: <code>', '<p>Verified stream key: <code>');edit(e,'>Refresh profiles</button>', '>Refresh profiles</button>');edit(e,'<small>{a.channel?.id}</small>',"<small>{a.channel?.id || (a.configured?'Sign-in is configured. Choose Connect YouTube.':'Complete Google sign-in setup above to enable Connect YouTube.')}</small>")
e=root/'scripts/smoke-stream-management.cjs';edit(e,"dialog.showMessageBox = async () => { unexpectedDialogs++; return { response: 0, checkboxChecked: false }; };", "const setupDialogs=[];\ndialog.showMessageBox = async (_window,opts) => { if(['Save this key on this Mac?','Save Google sign-in setup?'].includes(opts?.message)){setupDialogs.push(opts.message);return {response:1,checkboxChecked:false};} unexpectedDialogs++;return {response:0,checkboxChecked:false}; };")
edit(e,"await tab('Accounts'); await tab('Create');", """await tab('Accounts');
  await wait(()=>run('!!document.querySelector("#key-form-de input[type=password]") && !!document.querySelector("#key-form-ru input[type=password]")'),'both offline key fields');
  assert.ok(!panel.notice.includes('cancelled'));
  if(process.platform==='darwin') {
    const snapshot=()=>run('window.streamManagement.panel()');
    await run(`(()=>{const f=document.querySelector('#key-form-de');f.elements.streamKey.value='SYNTHETIC-KEY-NOT-REAL';f.requestSubmit()})()`);
    await wait(async()=>{const p=await snapshot();if(p.error)throw Error(p.error);return p.accounts[0].keyPending},'encrypted offline save on macOS');
    const p=await snapshot();assert.equal(p.accounts[0].keySaved,false);assert.equal(p.accounts[1].keyPending,false);assert.ok(!JSON.stringify(p).includes('SYNTHETIC-KEY-NOT-REAL'));
    assert.equal(await run(`document.querySelector('#key-form-de input').value`),'');
    const b=fs.readFileSync(path.join(profile,'youtube','pending-stream-key-de.enc'));assert.ok(b.length>0 && !b.includes('SYNTHETIC-KEY-NOT-REAL'));
    await run(`(()=>{const f=document.querySelector('#desktop-client-setup');f.elements.clientId.value='synthetic.apps.googleusercontent.com';f.elements.clientSecret.value='FAKE-CLIENT-SECRET';f.requestSubmit()})()`);
    await wait(async()=>{const p=await snapshot();if(p.error)throw Error(p.error);return p.accounts.every(a=>a.configured&&!a.channel)},'shared no-file Desktop setup');
    assert.deepEqual(setupDialogs,['Save this key on this Mac?','Save Google sign-in setup?']);
    assert.ok(!(await run('document.body.innerText')).includes('SYNTHETIC-KEY-NOT-REAL'));
    console.log('PASS: unlinked destination saved an encrypted local key; Desktop fields configured both slots without a file, a Google call or an encoder change.');
  }
  await tab('Create');""")
e=root/'scripts/check-mounted-preview.cjs';edit(e,"    await tab('Create');", "    assert.equal(await m(`document.querySelectorAll('form[id^=key-form-] input[type=password]:not(:disabled)').length`),2);assert.ok(await m(`!!document.querySelector('#desktop-client-setup input[name=clientId]')`));\n    await tab('Create');")
edit(root/'package.json','0.3.0-alpha.4','0.3.0-alpha.5')
w=Path('.github/workflows/stream-management-preview.yml');s=w.read_text();assert s.count('0.3.0-alpha.4')==1
Path('workflow-a5.txt').write_text(s.replace('0.3.0-alpha.4','0.3.0-alpha.5').replace('Stream Management menu, account slots and eight Sundays across DST','Encrypted manual key, file-free Google setup, both account slots and eight Sundays').replace('Broadcast-CC-Redesign-YouTube-macOS-universal','Broadcast-CC-Accounts-Preview-macOS-universal'))
