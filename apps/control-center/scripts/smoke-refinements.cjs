/* Exercise real Electron IPC, renderer and a synthetic authenticated OBS server. */
'use strict';
const {app,dialog,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {start}=require('../tests/mock-live.cjs');
app.disableHardwareAcceleration();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-refinements-'));app.setPath('userData',dir);
let peer,finished=false,dialogs=0;
const timer=setTimeout(()=>finish(1,new Error('Refinement acceptance timed out')),120000);
dialog.showMessageBox=async(_win,o)=>{dialogs++;return {response:o.message==='Enable live control of this OBS session?'?1:0};};
async function finish(code,error){if(finished)return;finished=true;clearTimeout(timer);if(error)console.error(error);if(peer)await peer.close();fs.rmSync(dir,{recursive:true,force:true});app.exit(code);}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 peer=await start();peer.state.streaming=true;peer.state.scenes.push('Prayer');peer.state.nodes.Prayer=[];
 peer.state.screenshotData='data:image/jpeg;base64,'+nativeImage.createFromBitmap(Buffer.from([30,35,40,255,30,35,40,255,30,35,40,255,30,35,40,255]),{width:2,height:2}).toJPEG(55).toString('base64');
 const workspace={format:'broadcast-cc-workspace',version:1,obsUrl:peer.url,companionUrl:'http://127.0.0.1:8000',inventory:null,connections:[],bindings:{scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro',prayer:'Prayer'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone'},captions:{speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'}},services:[{id:'one',title:'Synthetic service',startsAt:new Date(Date.now()+86400000).toISOString()}],speakers:['Speaker A','Speaker B']};
 fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(workspace));
 app.on('browser-window-created',(_e,win)=>win.webContents.once('did-finish-load',async()=>{
  const ev=x=>win.webContents.executeJavaScript(x);
  const wait=async(x,ms=22000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await ev(x))return;await pause(60);}throw Error('Timed out: '+x);};
  const click=async id=>{await ev(`document.getElementById(${JSON.stringify(id)}).click()`);await pause(80);};
  const field=async value=>{await ev(`(()=>{const e=document.getElementById('live-bible-reference');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(80);};
  const top=()=>ev(`document.querySelector('.desk-video-layout').getBoundingClientRect().top`);
  try{
   await wait(`!!window.liveService&&!!document.getElementById('nav-live')`);
   await ev(`window.liveService.connect(${JSON.stringify(peer.password)})`);await ev(`window.liveService.selectService('one')`);await ev(`window.liveService.enable({scenes:true,audio:true,stream:true,operator:false})`);await pause(300);
   assert.equal(peer.state.writes.length,0);
   assert.equal(await ev(`document.querySelectorAll('.desk-automation-status').length`),1);
   assert.equal(await ev(`document.querySelectorAll('.desk-return,.bcc-global-return,.desk-end-status').length`),0);
   const baseline=await top();
   await ev(`window.liveService.cue({kind:'speaker',name:'Speaker B'})`);await click('live-speaker');await wait(`window.liveService.snapshot().then(s=>s.returnAt!==null&&!s.busy)`);assert.ok(Math.abs(await top()-baseline)<1,'overlay must not shift video');
   await click('return-main-now');await wait(`window.liveService.snapshot().then(s=>s.observation.program==='Main'&&!s.busy)`);assert.ok(Math.abs(await top()-baseline)<1);
   await click('open-bible-panel');await field('1 Kor 4, 12ff');assert.match(await ev(`document.getElementById('bible-reference-preview').textContent`),/1\. Korinther Kap\. 4 ab Vers 12/);
   const writes=peer.state.writes.length;await click('add-bible-reference');await wait(`window.liveService.site().then(s=>s.cues.entries.length===1)`);assert.equal(peer.state.writes.length,writes);
   const cue=await ev(`window.liveService.site().then(s=>s.cues.entries[0])`);await ev(`document.querySelector('.desk-cue-edit').click()`);await wait(`!!document.getElementById('save-bible-reference')`);await field('1 Kor 4, 13ff');await click('save-bible-reference');await wait(`window.liveService.site().then(s=>s.cues.entries[0].reference==='1. Korinther Kap. 4 ab Vers 13')`);assert.equal(peer.state.writes.length,writes);assert.equal(await ev(`window.liveService.site().then(s=>s.cues.entries[0].id)`),cue.id);
   await click('live-bible');await wait(`window.liveService.snapshot().then(s=>s.observation.program==='Bible'&&!s.busy)`);assert.equal(peer.state.settings['Reference text'].text,'1. Korinther Kap. 4 ab Vers 13');assert.ok(Math.abs(await top()-baseline)<1);
   await click('return-main-now');await wait(`window.liveService.snapshot().then(s=>s.observation.program==='Main'&&!s.busy)`);
   await click('live-prayer');await wait(`window.liveService.snapshot().then(s=>s.observation.program==='Prayer'&&!s.busy)`);
   assert.equal(await ev(`document.querySelector('#live-prayer svg path').getAttribute('d')`),'M11 3.5c-1.2 1-2 3-2 5.5v5L4 19l3 3 5-5');assert.ok(Math.abs(await top()-baseline)<1);
   fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/alpha7-prayer-dark.png',(await win.webContents.capturePage()).toPNG());
   await click('return-main-now');await wait(`window.liveService.snapshot().then(s=>s.observation.program==='Main'&&!s.busy)`);
   const count=()=>peer.state.calls.filter(x=>x.name==='GetSourceScreenshot').length;await pause(800);const before=count();await pause(2000);const rate=count()-before;assert.ok(rate>=6&&rate<=12,'bounded faster preview: '+rate);await click('nav-setup');await pause(400);const hidden=count();await pause(1300);assert.equal(count(),hidden,'preview stops outside Sendung');await click('nav-live');await pause(300);
   const noDialog=dialogs;await click('scene-outro');await wait(`window.liveService.site().then(s=>s.end.status==='countdown'&&s.live.observation.program==='Outro'&&!s.live.busy)`);assert.equal(dialogs,noDialog);assert.equal(peer.state.streaming,true);assert.equal(peer.state.mutes.Microphone,true);assert.ok(Math.abs(await top()-baseline)<1,'Outro must not shift video');const oldUntil=await ev(`window.liveService.site().then(s=>s.end.until)`);
   await pause(1800);await click('scene-main');await wait(`window.liveService.site().then(s=>s.end.status==='cancelled'&&s.live.observation.program==='Main'&&!s.live.busy)`);assert.equal(peer.state.streaming,true);assert.equal(peer.state.mutes.Microphone,false);
   await click('scene-outro');await wait(`window.liveService.site().then(s=>s.end.status==='countdown'&&!s.live.busy)`);const until=await ev(`window.liveService.site().then(s=>s.end.until)`);assert.ok(until>oldUntil+1500);
   await pause(Math.max(0,oldUntil+300-Date.now()));assert.equal(peer.state.streaming,true,'cancelled older timer cannot stop the new session');
   await wait(`window.liveService.site().then(s=>s.end.status==='completed')`);assert.equal(peer.state.streaming,false);assert.equal(peer.state.writes.filter(x=>x.name==='StopStream').length,1);assert.equal(peer.state.program,'Outro');assert.equal(dialogs,noDialog);
   console.log('PASS alpha7: one fixed-height countdown; fuzzy Bible add/edit with no output writes; design prayer paths; preview '+rate+' frames/2s, paused on navigation; immediate Outro with no dialog; Main restores audio and cancels old Stop; exactly one confirmed Stop after the new 15s deadline. Synthetic OBS only.');await finish(0);
  }catch(error){fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/alpha7-failure.png',(await win.webContents.capturePage()).toPNG());await finish(1,error);}
 }));
 require('../dist/live-main.cjs');
})().catch(e=>finish(1,e));
