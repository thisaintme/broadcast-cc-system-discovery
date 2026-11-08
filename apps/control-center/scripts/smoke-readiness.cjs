/* Actual renderer/IPC regression using synthetic localhost OBS only. No site data. */
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {start}=require('../tests/mock-offline.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-readiness-smoke-'));
app.setPath('userData',dir);
fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify({format:'broadcast-cc-workspace',version:1,services:[{id:'one',title:'Synthetic rehearsal',startsAt:'2026-10-04T09:00:00Z'}],speakers:['Speaker A','Speaker B']}));
let peer,finished=false,consents=0;
const timer=setTimeout(()=>finish(1,new Error('Readiness interface test timed out')),60000);
dialog.showMessageBox=async(_win,options)=>{assert.match(options.message,/BCC TEST/);consents++;return {response:0,checkboxChecked:false};};
async function finish(code,error){if(finished)return;finished=true;clearTimeout(timer);if(error)console.error(error);if(peer)await peer.close();try{fs.rmSync(dir,{recursive:true,force:true});}catch{}app.exit(code);}
(async()=>{
  peer=await start();
  app.on('browser-window-created',(_event,win)=>{
    win.webContents.once('did-finish-load',async()=>{
      const js=source=>win.webContents.executeJavaScript(source);
      const until=async(expression)=>{for(let n=0;n<140;n++){if(await js(expression))return;await new Promise(r=>setTimeout(r,40));}throw new Error('UI condition did not become true: '+expression);};
      const click=async(id)=>{assert.equal(await js(`!!document.getElementById(${JSON.stringify(id)}) && !document.getElementById(${JSON.stringify(id)}).disabled`),true,`${id} must be enabled`);await js(`document.getElementById(${JSON.stringify(id)}).click()`);};
      const fill=async(id,value,tag='input')=>{await js(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw new Error('Missing input');const proto=${tag==='select'?'HTMLSelectElement':'HTMLInputElement'}.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(tag==='select'?'change':'input')},{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,60));};
      const nav=async(label)=>{await js(`Array.from(document.querySelectorAll('nav button')).find(x=>x.textContent===${JSON.stringify(label)}).click()`);await new Promise(r=>setTimeout(r,80));};
      try{
        await until(`!!document.getElementById('prepare-service')`);
        assert.equal(await js(`document.getElementById('enable-offline').disabled`),true);
        assert.match(await js(`document.getElementById('offline-readiness').textContent`),/OBS is not connected/);
        assert.match(await js(`document.getElementById('rehearsal-next-step').textContent`),/Simulation is ready/);
        await click('prepare-service');
        await until(`document.querySelector('.phase')?.textContent==='Service prepared' && !document.getElementById('show-intro').disabled`);
        assert.equal(await js(`document.getElementById('show-main').disabled`),true);
        assert.match(await js(`document.getElementById('rehearsal-next-step').textContent`),/2 · Intro/);
        await click('show-intro');await until(`!document.getElementById('show-main').disabled`);
        await click('show-main');await until(`document.querySelector('.phase')?.textContent==='Main / On Air'`);
        assert.equal(peer.state.writes.length,0);
        await click('cancel-rehearsal');await until(`!document.getElementById('prepare-service').disabled`);
        await click('open-readiness-setup');await until(`!!document.getElementById('caption-setup-readiness')`);
        assert.match(await js(`document.getElementById('caption-setup-readiness').textContent`),/placeholder/);
        assert.equal(await js(`document.getElementById('confirm-captions').disabled`),true);
        await fill('obs-url',peer.url);await fill('obs-password',peer.password);await click('inspect-obs');
        await until(`window.controlCenter.snapshot().then(s=>s.workspace.inventory?.origin==='live' && !s.runtime.busy)`);
        await until(`!document.getElementById('speaker-group').disabled`);
        await fill('caption-bibleText','Reference text','select');await fill('caption-nextServiceText','Next date','select');
        await fill('speaker-group','Names','select');await fill('test-collection','BCC TEST - different');
        assert.equal(await js(`document.getElementById('confirm-captions').disabled`),true);
        assert.match(await js(`document.getElementById('caption-setup-readiness').textContent`),/last inspected collection.*BCC TEST - synthetic/);
        await fill('test-collection','BCC TEST - synthetic');
        await until(`!document.getElementById('confirm-captions').disabled`);
        await click('confirm-captions');
        await until(`window.controlCenter.snapshot().then(s=>s.workspace.captions.confirmed && s.workspace.bindings.confirmed && !s.runtime.busy)`);
        await nav('Service rehearsal');await until(`!document.getElementById('enable-offline').disabled`);
        await click('enable-offline');await until(`window.controlCenter.snapshot().then(s=>!s.runtime.busy)`);
        assert.equal(consents,1);assert.equal(await js(`window.controlCenter.snapshot().then(s=>s.runtime.mode)`),'simulation');
        assert.equal(peer.state.writes.length,0,'Readiness and cancelled consent must not send writes');
        await nav('Connections & mappings');await fill('obs-password',peer.password);await click('inspect-obs');
        await until(`window.controlCenter.snapshot().then(s=>s.workspace.inventory?.origin==='live' && !s.workspace.captions.confirmed && !s.runtime.busy)`);
        await nav('Service rehearsal');await until(`document.getElementById('enable-offline')?.disabled===true`);
        assert.equal(await js(`document.getElementById('prepare-service').disabled`),false);
        assert.match(await js(`document.getElementById('offline-readiness').textContent`),/Caption mappings have not been confirmed/);
        fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/smoke-readiness.png',(await win.webContents.capturePage()).toPNG());
        assert.equal(peer.state.writes.length,0);
        assert.ok(!fs.readFileSync(path.join(dir,'workspace.json'),'utf8').includes(peer.password));
        console.log('Readiness Electron test passed: simulation without OBS, next-step gating, actual draft fields, collection mismatch, explicit confirmation, cancelled consent, reconnect invalidation and zero device writes.');
        await finish(0);
      }catch(error){await finish(1,error);}
    });
  });
  require('../dist/main.cjs');
})().catch(error=>finish(1,error));
