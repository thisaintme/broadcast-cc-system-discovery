/* Real Electron renderer + IPC with a synthetic authenticated loopback OBS peer. */
const {app}=require('electron');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
const mockAudio=require('../tests/mock-audio.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-audio-smoke-'));app.setPath('userData',dir);
let peer,done=false;
const deadline=setTimeout(()=>{console.error('Audio smoke test timeout');finish(1);},70000);
async function finish(code){if(done)return;done=true;clearTimeout(deadline);if(peer)await peer.close();try{fs.rmSync(dir,{recursive:true,force:true});}catch{}app.exit(code);}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.on('browser-window-created',(_event,win)=>{
  win.webContents.on('render-process-gone',()=>{console.error('Audio renderer terminated');void finish(1);});
  win.webContents.once('did-finish-load',async()=>{
    try{
      await win.webContents.executeJavaScript(`(async()=>{const api=window.controlCenter;const s=await api.snapshot();s.workspace.obsUrl=${JSON.stringify(peer.url)};await api.saveWorkspace(s.workspace);await api.inspect(${JSON.stringify(peer.password)});await new Promise(r=>setTimeout(r,100));[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Audio verification').click();})()`);
      await delay(150);await win.webContents.executeJavaScript("document.getElementById('audio-start').click()");
      let good=false;
      for(let i=0;i<120;i++){good=await win.webContents.executeJavaScript("(async()=>{const s=await window.controlCenter.audioSnapshot();return s.running&&!s.starting&&s.rows.some(r=>r.meterState==='live')&&document.querySelectorAll('.audio-input meter').length===4;})()");if(good)break;await delay(50);}
      assert.equal(good,true);
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('h1').textContent"),'Audio verification');
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('.audio-mute').textContent"),'Muted');
      await win.webContents.executeJavaScript(`(()=>{const card=document.querySelector('.audio-input');card.querySelector('details').open=true;const input=card.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Synthetic observation typed during live updates.');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await delay(1200);
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('.audio-input textarea').value"),'Synthetic observation typed during live updates.');
      await win.webContents.executeJavaScript("document.querySelector('.save-audio-note').click()");
      let saved=false;
      for(let i=0;i<100;i++){saved=await win.webContents.executeJavaScript("(async()=>{const s=await window.controlCenter.snapshot();return s.workspace.audioObservations.some(n=>n.notes==='Synthetic observation typed during live updates.');})()");if(saved)break;await delay(30);}
      assert.equal(saved,true);
      fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/smoke-audio.png',(await win.webContents.capturePage()).toPNG());
      peer.state.sendMeters=false;await delay(2600);
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('.meter-state').textContent"),'Stale — unknown');
      assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.audio-input meter').length"),0);
      await win.webContents.executeJavaScript("document.getElementById('audio-stop').click()");await delay(2800);
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('.audio-input textarea').disabled"),false);
      await win.webContents.executeJavaScript(`(()=>{const input=document.querySelector('.audio-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Observation completed after stopping meters.');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await delay(50);await win.webContents.executeJavaScript("document.querySelector('.save-audio-note').click()");
      for(let i=0;i<100;i++){saved=await win.webContents.executeJavaScript("(async()=>{const s=await window.controlCenter.snapshot();return s.workspace.audioObservations.some(n=>n.notes==='Observation completed after stopping meters.');})()");if(saved)break;await delay(30);}
      assert.equal(saved,true);
      peer.disconnect();await delay(200);
      assert.match(await win.webContents.executeJavaScript("document.getElementById('audio-health').textContent"),/OBS disconnected/);
      const persisted=fs.readFileSync(path.join(dir,'workspace.json'),'utf8');const w=JSON.parse(persisted);
      assert.equal(w.audioObservations.length,1);assert.equal(w.audioObservations[0].basis,'operator-reported');assert.equal(w.bindings.confirmed,false);assert.equal(w.captions.confirmed,false);
      assert.equal(w.audioObservations[0].notes,'Observation completed after stopping meters.');
      assert.ok(!persisted.includes(peer.password));assert.ok(!persisted.includes('inputLevelsMul'));assert.ok(!persisted.includes('inputPeakDb'));
      assert.ok(peer.state.requests.every(r=>r.name.startsWith('Get')));
      console.log('Audio smoke test passed: opt-in meters, mute state, stale/disconnected UI, unsaved text, post-stop note persistence, no device writes.');await finish(0);
    }catch(error){console.error(error);await finish(1);}
  });
});
mockAudio().then(value=>{peer=value;require('../dist/main.cjs');}).catch(error=>{console.error(error);void finish(1);});
