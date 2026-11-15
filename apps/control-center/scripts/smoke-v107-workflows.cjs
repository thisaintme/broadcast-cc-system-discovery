/* Real Electron UI/preload/IPC; a synthetic local OBS peer only. No accounts or hardware. */
'use strict';
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const base=require('../tests/mock-live.cjs'),operator=require('../tests/mock-operator.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-workflows-')),out=path.resolve('release/v107-workflows');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',dir);app.disableHardwareAcceleration();
let peer,window,finished=false;const passed=[];
const timer=setTimeout(()=>finish(1,Error('Local calendar / direct switching acceptance timed out')),120000);
dialog.showMessageBox=async(_w,o)=>{assert.equal(o.defaultId,0);assert.equal(o.cancelId,0);return {response:o.message==='Steuerung für diese OBS-Sitzung freigeben?'?1:0};};
async function finish(code,error){
 if(finished)return;finished=true;clearTimeout(timer);
 if(error){console.error(error);if(window&&!window.isDestroyed())try{fs.writeFileSync(path.join(out,'failure.png'),(await window.webContents.capturePage()).toPNG());}catch{}}
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:code===0,passed,error:error?String(error):null,environment:'Real Electron/preload/IPC; synthetic authenticated OBS already in Studio Mode; no production hardware or accounts'},null,2));
 await peer?.close();console.log((code===0?'PASS':'FAIL')+' local calendar / direct switching: '+passed.join('; '));app.exit(code);
}
(async()=>{
 peer=await base.start(()=>{const f=operator.fixture();f.state.studio=true;f.state.streaming=true;f.state.program='Intro';f.state.preview='Main';f.state.mutes.Microphone=true;return f;});
 const file=path.join(dir,'workspace.json');
 const w={format:'broadcast-cc-workspace',version:1,obsUrl:peer.url,companionUrl:'http://127.0.0.1:8000',bindings:{scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro',singing:'Singing',prayer:'Prayer',interlude:'Break'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone'},captions:{speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'}},services:[],speakers:['Speaker A','Speaker B']};
 fs.writeFileSync(file,JSON.stringify(w));
 app.on('browser-window-created',(_e,win)=>{
  if(window)return;window=win;win.setSize(1440,1000);
  win.webContents.once('did-finish-load',async()=>{
   const ev=c=>win.webContents.executeJavaScript(c,true),api=c=>ev(`window.liveService.${c}`);
   const wait=async(c,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await ev(c))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+c);};
   const click=async selector=>{await wait(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&!e.disabled;})()`);await ev(`document.querySelector(${JSON.stringify(selector)}).click()`);};
   const field=async(id,value)=>{await ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
   const capture=async name=>fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());
   try{
    await wait("!!document.getElementById('nav-schedule')");await click('#nav-schedule');await wait("!!document.getElementById('local-service-form')");
    assert.equal((await api('site()')).live.connected,false);assert.equal(peer.state.writes.length,0);
    await field('new-service-date','2020-01-05');await field('new-service-time','11:00');await click('#add-live-service');
    await wait("window.liveService.site().then(s=>!s.live.busy&&s.workspace.services.length===1)");
    await wait("document.getElementById('local-service-notice')?.textContent.includes('1 Termin lokal gespeichert')");
    let s=await api('site()');const single=s.workspace.services[0];assert.equal(single.title,'20200105 - Gottesdienst');assert.equal(single.startsAt,'2020-01-05T10:00:00.000Z');
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).services.length,1);assert.equal(peer.state.writes.length,0);
    passed.push('Create an already-started local single service through the UI without OBS or YouTube');
    await field('new-service-date','2027-03-14');await click('#local-service-repeat');await field('local-service-count','4');
    await click('#add-live-service');await wait("window.liveService.site().then(s=>!s.live.busy&&s.workspace.services.length===5)");
    s=await api('site()');const planned=s.workspace.services.filter(x=>x.id!==single.id);
    assert.deepEqual(planned.map(x=>x.startsAt),['2027-03-14T10:00:00.000Z','2027-03-21T10:00:00.000Z','2027-03-28T09:00:00.000Z','2027-04-04T09:00:00.000Z']);
    await click('#add-live-service');await wait("document.getElementById('local-service-notice')?.textContent.includes('bereits im lokalen Kalender')");
    assert.equal((await api('site()')).workspace.services.length,5);assert.equal(peer.state.writes.length,0);await capture('local-calendar');
    passed.push('Create a four-week local series across DST; repeated save does not duplicate');
    // Genuine disk failure: rename cannot overwrite a directory. Never mark this as saved.
    fs.renameSync(file,file+'.kept');fs.mkdirSync(file);
    try{
     await field('new-service-date','2028-01-02');await click('#add-live-service');
     await wait("!!document.querySelector('.v107-local-calendar [role=alert]')");
     assert.equal((await api('site()')).workspace.services.length,5);
     assert.equal(await ev("!!document.getElementById('local-service-notice')"),false);
    }finally{fs.rmdirSync(file);fs.renameSync(file+'.kept',file);}
    passed.push('Persistence failure is visible and retains the old calendar without false success');
    const chosen=planned[2];await click(`[data-select-service="${chosen.id}"]`);
    await wait("document.querySelector('#bcc-content').dataset.tab==='live'");
    assert.equal((await api('site()')).live.selectedService,chosen.id);assert.equal(await ev("document.querySelector('#live-service').value"),chosen.id);assert.equal(peer.state.writes.length,0);
    passed.push('Select a generated occurrence directly for broadcasting without a device write');
    await api(`connect(${JSON.stringify(peer.password)})`);assert.equal((await api('site()')).live.selectedService,chosen.id);
    passed.push('Connecting OBS preserves the explicitly selected occurrence');
    await api('enable({scenes:true,audio:true,stream:false,operator:false})');
    assert.equal((await api('site()')).live.observation.studio,true);
    await click('#v107-scene-main');await wait("window.liveService.site().then(s=>!s.live.busy&&s.live.observation.program==='Main')");
    assert.equal(peer.state.mutes.Microphone,false);assert.equal(peer.state.studio,true);
    assert.equal(peer.state.writes.some(x=>['SetCurrentPreviewScene','SetStudioModeEnabled','TriggerStudioModeTransition','StartStream','StopStream'].includes(x.name)),false);
    await click('#v107-scene-intro');await wait("window.liveService.site().then(s=>!s.live.busy&&s.live.observation.program==='Intro')");assert.equal(peer.state.mutes.Microphone,true);
    await click('#v107-scene-main');await wait("window.liveService.site().then(s=>!s.live.busy&&s.live.observation.program==='Main')");assert.equal(peer.state.mutes.Microphone,false);
    await capture('direct-switching');passed.push('Direct tiles change Program and audio with OBS Studio Mode already enabled; no operator permission needed');
    // Local planning during a service must not release its grants or mutate output.
    const before=await api('site()'),writes=peer.state.writes.length;
    await click('#nav-schedule');await field('new-service-date','2028-02-06');await click('#add-live-service');
    await wait("window.liveService.site().then(s=>!s.live.busy&&s.workspace.services.length===6)");
    s=await api('site()');assert.deepEqual(s.live.permissions,before.live.permissions);assert.equal(s.live.selectedService,before.live.selectedService);assert.equal(peer.state.writes.length,writes);
    passed.push('Saving while broadcasting preserves selected service, permissions, audio and Program');
    await click('#nav-live');await api('release()');await api('enable({scenes:true,audio:true,stream:false,operator:true})');
    await click('#v107-studio-mode');await wait("document.getElementById('v107-studio-mode').checked");
    await click('#v107-scene-interlude');await wait("window.liveService.site().then(s=>!s.live.busy&&s.live.observation.preview==='Break')");assert.equal(peer.state.program,'Main');
    await click('#v107-take');await wait("window.liveService.site().then(s=>!s.live.busy&&s.live.observation.program==='Break')");
    await click('#v107-studio-mode');assert.equal(peer.state.studio,true);
    await click('#v107-scene-main');await wait("window.liveService.site().then(s=>!s.live.busy&&s.live.observation.program==='Main')");
    passed.push('Explicit preview opt-in still stages and Takes; opting out leaves OBS Studio Mode enabled');
    await click('#v107-studio-mode');await wait("document.getElementById('v107-studio-mode').checked");await api('release()');await wait("!document.getElementById('v107-studio-mode').checked");
    // Renderer reload re-reads the persisted calendar; live grant never persists.
    await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
    await wait("!!document.querySelector('#live-service')");await click('#nav-schedule');await wait("document.querySelectorAll('[data-select-service]').length===6");
    assert.equal((await api('site()')).live.permissions.scenes,false);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).services.length,6);
    assert.equal((await ev('window.streamManagement.panel()')).state.occurrences.length,0);
    passed.push('Release resets preview opt-in; all local dates reload; no YouTube events created');
    await finish(0);
   }catch(e){await finish(1,e);}
  });
 });
 require('../dist/live-main.cjs');
})().catch(e=>finish(1,e));
