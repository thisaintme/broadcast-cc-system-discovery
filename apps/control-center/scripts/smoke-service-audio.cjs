/* CI-only real Electron UI/IPC test with a synthetic authenticated loopback OBS server. */
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {start}=require('../tests/mock-service-audio.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-service-audio-smoke-'));
app.setPath('userData',dir);
let peer,done=false,allow=false,includeAudio=false,dialogs=0;
const timer=setTimeout(()=>finish(1,new Error('Service audio smoke test timed out')),70000);
// Substitute only native dialogs in this isolated test process, never production consent code.
dialog.showMessageBox=async(_window,options)=>{
  assert.match(options.message,/BCC TEST/);assert.equal(options.defaultId,0);
  assert.equal(options.checkboxChecked,false);assert.match(options.checkboxLabel,/Microphone/);dialogs++;
  return {response:allow?1:0,checkboxChecked:includeAudio};
};
async function finish(code,error){if(done)return;done=true;clearTimeout(timer);if(error)console.error(error);if(peer)await peer.close();try{fs.rmSync(dir,{recursive:true,force:true});}catch{}app.exit(code);}
(async()=>{
  peer=await start();
  app.on('browser-window-created',(_event,win)=>{
    win.webContents.once('did-finish-load',async()=>{
      const evaluate=s=>win.webContents.executeJavaScript(s);
      const wait=async(expression,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,40));}throw new Error('UI condition timed out: '+expression);};
      try{
        await evaluate(`(async()=>{
          const api=window.controlCenter,w=(await api.snapshot()).workspace;w.obsUrl=${JSON.stringify(peer.url)};
          w.services=[{id:'one',title:'Synthetic service',startsAt:'2026-10-04T09:00:00Z'},{id:'two',title:'Next',startsAt:'2026-10-08T16:00:00Z'}];
          w.speakers=['Speaker A','Speaker B'];await api.saveWorkspace(w);await api.inspect(${JSON.stringify(peer.password)});
          const next=(await api.snapshot()).workspace;
          next.bindings={...next.bindings,scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone',confirmed:true};
          next.captions={testCollection:'BCC TEST - synthetic',speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'},confirmed:true};
          await api.saveWorkspace(next);await api.command('select','one');await api.mode('offline-program');
        })()`);
        assert.equal(dialogs,1);assert.equal(peer.state.writes.length,0);
        assert.equal(await evaluate('window.controlCenter.snapshot().then(s=>s.runtime.serviceAudioEnabled)'),false);
        // Explicitly enabling Program mode without the checkbox must preserve alpha.3 behavior.
        allow=true;
        await evaluate("(async()=>{const a=window.controlCenter;await a.mode('offline-program');await a.command('prepare');await a.command('intro');await a.command('main');await a.command('reset');})()");
        assert.equal(peer.state.writes.filter(w=>w.name==='SetInputMute').length,0);
        includeAudio=true;
        await wait("!document.getElementById('enable-offline').disabled");
        await evaluate("document.getElementById('enable-offline').click()");
        await wait("window.controlCenter.snapshot().then(s=>s.runtime.serviceAudioEnabled===true&&!s.runtime.busy)");
        assert.equal(peer.state.mutes.Microphone,false); // Consent alone never mutes.
        for(const [index,phase,muted]of [[0,'prepared',true],[1,'intro',true],[2,'main',false]]){
          await wait(`!document.querySelectorAll('.flow button')[${index}].disabled`);
          await evaluate(`document.querySelectorAll('.flow button')[${index}].click()`);
          await wait(`window.controlCenter.snapshot().then(s=>s.runtime.phase===${JSON.stringify(phase)}&&!s.runtime.busy)`);
          assert.equal(peer.state.mutes.Microphone,muted);
        }
        await wait("document.getElementById('service-audio-status').textContent.includes('Unmuted — OBS confirmed')");
        peer.state.mutes.Microphone=true;peer.emit('InputMuteStateChanged',{inputName:'Microphone',inputMuted:true});
        await wait("document.getElementById('service-audio-status').textContent.includes('Muted — OBS confirmed')");
        const muteCount=peer.state.writes.filter(w=>w.name==='SetInputMute').length;
        await evaluate(`(()=>{const el=document.querySelector('select[aria-label="Speaker"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'Speaker B');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Show speaker · 10 seconds'&&!b.disabled)");
        await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Show speaker · 10 seconds').click()");
        await wait("window.controlCenter.snapshot().then(s=>s.runtime.phase==='speaker'&&!s.runtime.busy)");
        await wait("window.controlCenter.snapshot().then(s=>s.runtime.phase==='main'&&!s.runtime.busy)");
        assert.equal(peer.state.mutes.Microphone,true);assert.equal(peer.state.writes.filter(w=>w.name==='SetInputMute').length,muteCount);
        await evaluate("document.querySelectorAll('.flow button')[3].click()");
        await wait("window.controlCenter.snapshot().then(s=>s.runtime.phase==='outro'&&!s.runtime.busy)");
        assert.equal(peer.state.mutes.Microphone,true);assert.equal(peer.state.mutes['Other input'],false);
        const count=peer.state.writes.length;
        await evaluate("document.getElementById('cancel-rehearsal').click()");
        await wait("window.controlCenter.snapshot().then(s=>s.runtime.mode==='simulation'&&!s.runtime.serviceAudioEnabled&&!s.runtime.busy)");
        assert.equal(peer.state.writes.length,count);
        assert.ok(peer.state.writes.every(w=>['SetInputSettings','SetSceneItemEnabled','SetCurrentProgramScene','SetInputMute'].includes(w.name)));
        const saved=fs.readFileSync(path.join(dir,'workspace.json'),'utf8');assert.ok(!saved.includes(peer.password));assert.ok(!saved.includes('serviceAudioEnabled'));
        fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/smoke-service-audio.png',(await win.webContents.capturePage()).toPNG());
        console.log('Service audio Electron test passed: native opt-in, real buttons, verified mute order, actual ten-second return preserving a manual mute, unchanged other input, and cancel without rollback.');
        await finish(0);
      }catch(error){await finish(1,error);}
    });
  });
  require('../dist/main.cjs');
})().catch(error=>finish(1,error));
