/* CI-only smoke test. Loads the real compiled app with an isolated temporary workspace. */
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-smoke-'));
app.setPath('userData',dir);
const deadline=setTimeout(()=>{console.error('Electron smoke test timed out.');app.exit(1);},40000);
let done=false;
function finish(code){if(done)return;done=true;clearTimeout(deadline);try{fs.rmSync(dir,{recursive:true,force:true});}catch{}app.exit(code);}
app.on('browser-window-created',(_event,win)=>{
  win.webContents.on('render-process-gone',()=>{console.error('Renderer exited unexpectedly.');finish(1);});
  win.webContents.once('did-finish-load',async()=>{
    try {
      const result=await win.webContents.executeJavaScript(`(async()=>{
        const api=window.controlCenter;
        const initial=await api.snapshot();
        if(initial.runtime.mode!=='simulation')throw new Error('Startup was not simulation.');
        const w=initial.workspace;
        w.services=[{id:'ci-service',title:'Rehearsal test service',startsAt:'2026-10-04T09:00:00.000Z'},
          {id:'ci-next',title:'Next test service',startsAt:'2026-10-11T09:00:00.000Z'}];
        w.speakers=['Test speaker'];
        await api.saveWorkspace(w);
        await api.command('select','ci-service');
        await api.command('prepare');
        await api.command('intro');
        await api.command('main');
        await api.command('speaker','Test speaker');
        await api.command('bible','Johannes Kap. 3 ab Vers 16');
        await api.command('outro');
        await new Promise(resolve=>setTimeout(resolve,200));
        const state=await api.snapshot();
        return {mode:state.runtime.mode,phase:state.runtime.phase,connected:state.transport.connected,
          heading:document.querySelector('h1')?.textContent,stage:document.querySelector('.phase')?.textContent,
          buttons:document.querySelectorAll('button').length};
      })()`);
      assert.equal(result.mode,'simulation');assert.equal(result.phase,'outro');assert.equal(result.connected,false);
      assert.equal(result.heading,'Service rehearsal');assert.equal(result.stage,'Outro');assert.ok(result.buttons>=10);
      fs.mkdirSync('release',{recursive:true});
      fs.writeFileSync('release/smoke-test.png',(await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript("window.controlCenter.command('reset')");
      console.log('Electron smoke test passed: renderer, IPC, local persistence and simulated service sequence.');
      finish(0);
    } catch(error) {console.error(error);finish(1);}
  });
});
require('../dist/main.cjs');
