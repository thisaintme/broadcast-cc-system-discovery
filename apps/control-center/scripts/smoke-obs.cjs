/* CI-only end-to-end test: real Electron renderer + IPC + authenticated synthetic OBS peer. */
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const mockObs=require('../tests/mock-obs.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-obs-smoke-'));
app.setPath('userData',dir);
const peerPromise=mockObs();
let done=false;
const deadline=setTimeout(()=>{console.error('OBS connection smoke test timed out.');finish(1);},60000);
function finish(code){if(done)return;done=true;clearTimeout(deadline);try{fs.rmSync(dir,{recursive:true,force:true});}catch{}app.exit(code);}
function uiScenario(url,password){
  return (async()=>{
    const api=window.controlCenter;
    const sleep=()=>new Promise(resolve=>setTimeout(resolve,30));
    async function until(predicate,label){const end=Date.now()+15000;while(Date.now()<end){if(await predicate())return;await sleep();}throw new Error('UI check timed out: '+label);}
    async function input(id,value){
      const field=document.getElementById(id);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);
      field.dispatchEvent(new Event('input',{bubbles:true}));await sleep();
    }
    await until(()=>document.querySelector('nav'),'navigation');
    [...document.querySelectorAll('nav button')].find(b=>b.textContent==='Connections & mappings').click();
    await until(()=>document.getElementById('obs-password'),'password field');
    await input('obs-url',url);await input('obs-password','synthetic-wrong-password');
    document.getElementById('inspect-obs').click();
    await until(()=>document.querySelector('[role="alert"]')?.textContent.includes('4009') && !document.getElementById('inspect-obs').disabled,'authentication failure');
    if(document.getElementById('obs-password').value!=='synthetic-wrong-password')throw new Error('Password was cleared on failed authentication.');
    if((await api.snapshot()).transport.connected)throw new Error('Failed authentication was marked connected.');
    await input('obs-password',password);document.getElementById('inspect-obs').click();
    await until(async()=>{
      const s=await api.snapshot();
      return s.workspace.inventory?.origin==='live' && s.transport.connected && !document.getElementById('inspect-obs').disabled;
    },'successful authenticated inspection');
    if(document.getElementById('obs-password').value!=='')throw new Error('Password was not cleared after success.');
    const state=await api.snapshot();
    if(state.transport.replayBuffer!==null || state.transport.virtualCamera!==null)throw new Error('Unavailable output was treated as off.');
    if(!document.getElementById('obs-status-warnings')?.textContent.includes('604'))throw new Error('Status diagnostics were not displayed.');
    if(!state.workspace.inventory.nodes.some(n=>n.type==='group' && n.items.length===1))throw new Error('Nested group was not inspected.');
    if(JSON.stringify(state).includes(password))throw new Error('Password leaked to snapshot.');
    await input('obs-password','synthetic-clear-test');document.getElementById('clear-obs-password').click();await sleep();
    if(document.getElementById('obs-password').value!=='')throw new Error('Explicit password clear failed.');
    return {connected:state.transport.connected,scenes:state.workspace.inventory.scenes.length,statusWarnings:state.transport.statusWarnings.length};
  })();
}
function failedInspectionScenario(password){
  return (async()=>{
    const sleep=()=>new Promise(resolve=>setTimeout(resolve,30));
    const field=document.getElementById('obs-password');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,password);
    field.dispatchEvent(new Event('input',{bubbles:true}));await sleep();
    document.getElementById('inspect-obs').click();
    const end=Date.now()+15000;
    while(Date.now()<end){
      const alert=document.querySelector('[role="alert"]')?.textContent || '';
      if(alert.includes('GetInputList') && alert.includes('702') && !document.getElementById('inspect-obs').disabled){
        if(field.value!==password)throw new Error('Password was cleared after inspection failed.');
        const state=await window.controlCenter.snapshot();
        if(!state.transport.connected)throw new Error('Inspection failure dropped authenticated connection.');
        if(alert.includes('RAW_DIAGNOSTIC_MUST_NOT_LEAK'))throw new Error('Raw server diagnostic leaked.');
        document.getElementById('clear-obs-password').click();await sleep();return true;
      }
      await sleep();
    }
    throw new Error('Inspection failure was not reported separately.');
  })();
}
app.on('browser-window-created',(_event,win)=>{
  win.webContents.on('render-process-gone',()=>{console.error('Renderer exited unexpectedly.');finish(1);});
  win.webContents.once('did-finish-load',async()=>{
    let peer;
    try{
      peer=await peerPromise;
      const result=await win.webContents.executeJavaScript(`(${uiScenario.toString()})(${JSON.stringify(peer.url)},${JSON.stringify(peer.password)})`);
      assert.equal(result.connected,true);assert.equal(result.scenes,5);assert.equal(result.statusWarnings,2);
      peer.state.failures.set('GetInputList',{code:702,comment:'RAW_DIAGNOSTIC_MUST_NOT_LEAK'});
      assert.equal(await win.webContents.executeJavaScript(`(${failedInspectionScenario.toString()})(${JSON.stringify(peer.password)})`),true);
      assert.ok(peer.state.requests.every(n=>n.startsWith('Get')),'Inspection issued a control request.');
      const saved=fs.readFileSync(path.join(dir,'workspace.json'),'utf8');
      assert.ok(!saved.includes(peer.password));assert.ok(!saved.includes('synthetic-wrong-password'));
      fs.mkdirSync('release',{recursive:true});
      fs.writeFileSync('release/obs-connection-smoke.png',(await win.webContents.capturePage()).toPNG());
      console.log('Authenticated OBS smoke test passed: UI password retry, handshake, optional-output failures, recursive inspection, separate request diagnostics, no writes and no persisted credentials.');
      await peer.close();finish(0);
    }catch(error){console.error(error);if(peer)await peer.close();finish(1);}
  });
});
require('../dist/main.cjs');
