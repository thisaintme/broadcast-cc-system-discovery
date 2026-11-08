/* CI-only end-to-end test. No church data, real OBS instance or remote device is used. */
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {start}=require('../tests/mock-offline.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-offline-smoke-'));
app.setPath('userData',dir);
let peer,finished=false,consents=0,allow=false;
const timer=setTimeout(()=>finish(1,new Error('Offline interface test timed out')),60000);
// Native dialog substitution is confined to this isolated test process. No production bypass exists.
dialog.showMessageBox=async(_window,options)=>{
  assert.match(options.message,/BCC TEST/);assert.equal(options.defaultId,0);consents++;
  return {response:allow?1:0,checkboxChecked:false};
};
async function finish(code,error){if(finished)return;finished=true;clearTimeout(timer);if(error)console.error(error);if(peer)await peer.close();try{fs.rmSync(dir,{recursive:true,force:true});}catch{}app.exit(code);}
(async()=>{
  peer=await start();
  app.on('browser-window-created',(_event,win)=>{
    win.webContents.once('did-finish-load',async()=>{
      const evaluate=s=>win.webContents.executeJavaScript(s);
      try{
        await evaluate(`(async()=>{
          const api=window.controlCenter,w=(await api.snapshot()).workspace;
          w.obsUrl=${JSON.stringify(peer.url)};
          w.services=[{id:'one',title:'Synthetic service',startsAt:'2026-10-04T09:00:00Z'},{id:'two',title:'Next synthetic service',startsAt:'2026-10-08T16:00:00Z'}];
          w.speakers=['Speaker A','Speaker B'];await api.saveWorkspace(w);await api.inspect(${JSON.stringify(peer.password)});
          const next=(await api.snapshot()).workspace;
          next.bindings={...next.bindings,scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',confirmed:true};
          next.captions={testCollection:'BCC TEST - synthetic',speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'},confirmed:true};
          await api.saveWorkspace(next);await api.command('select','one');await api.mode('offline-program');
        })()`);
        assert.equal(consents,1);assert.equal(peer.state.writes.length,0);
        assert.equal(await evaluate('window.controlCenter.snapshot().then(s=>s.runtime.mode)'),'simulation');
        allow=true;
        await evaluate(`(async()=>{
          const api=window.controlCenter;await api.mode('offline-program');
          await api.command('prepare');await api.command('intro');await api.command('main');
          await api.command('speaker','Speaker B');await api.command('bible','Johannes Kap. 3 ab Vers 16');await api.command('outro');
          await new Promise(resolve=>setTimeout(resolve,100));
        })()`);
        const result=await evaluate(`(async()=>{const s=await window.controlCenter.snapshot();return {mode:s.runtime.mode,phase:s.runtime.phase,program:s.transport.program,stage:document.querySelector('.phase')?.textContent,cancel:!!document.getElementById('cancel-rehearsal')};})()`);
        assert.equal(consents,2);assert.equal(result.mode,'offline-program');assert.equal(result.phase,'outro');assert.equal(result.program,'Outro');assert.equal(result.stage,'Outro');assert.equal(result.cancel,true);
        assert.equal(peer.state.settings['Reference text'].text,'Johannes Kap. 3 ab Vers 16');
        assert.equal(peer.state.nodes.Reference.find(i=>i.sourceName==='Microphone').sceneItemEnabled,true);
        assert.equal(peer.state.nodes.Names.find(i=>i.sourceName==='Speaker icon').sceneItemEnabled,true);
        assert.ok(peer.state.writes.every(w=>['SetInputSettings','SetSceneItemEnabled','SetCurrentProgramScene'].includes(w.name)));
        fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/smoke-offline.png',(await win.webContents.capturePage()).toPNG());
        const count=peer.state.writes.length;await evaluate("window.controlCenter.command('reset')");assert.equal(peer.state.writes.length,count);
        assert.ok(!fs.readFileSync(path.join(dir,'workspace.json'),'utf8').includes(peer.password));
        console.log('Offline Electron test passed: explicit consent/cancel, IPC, caption/Program protocol against synthetic peer, unchanged audio/icon, and reset without rollback.');
        await finish(0);
      }catch(error){await finish(1,error);}
    });
  });
  require('../dist/main.cjs');
})().catch(error=>finish(1,error));
