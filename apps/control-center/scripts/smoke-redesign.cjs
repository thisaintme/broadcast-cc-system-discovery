/* Native Electron/Keychain acceptance test, synthetic loopback OBS only. */
'use strict';
const {app,dialog,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {start}=require('../tests/mock-live.cjs');
app.disableHardwareAcceleration();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-redesign-'));app.setPath('userData',dir);
let peer,finished=false;
const timer=setTimeout(()=>finish(1,new Error('Redesign acceptance timed out')),60000);
dialog.showMessageBox=async(_win,o)=>{assert.equal(o.defaultId,0);return {response:o.message==='Enable live control of this OBS session?'?1:0};};
async function finish(code,e){if(finished)return;finished=true;clearTimeout(timer);if(e)console.error(e);if(peer)await peer.close();fs.rmSync(dir,{recursive:true,force:true});app.exit(code);}
(async()=>{
 peer=await start();peer.state.scenes.push('Prayer');peer.state.nodes.Prayer=[];
 const workspace={format:'broadcast-cc-workspace',version:1,obsUrl:peer.url,companionUrl:'http://127.0.0.1:8000',inventory:null,connections:[],bindings:{scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro',prayer:'Prayer'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone'},captions:{speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'}},services:[{id:'one',title:'Synthetic service',startsAt:new Date(Date.now()+86400000).toISOString()}],speakers:['Speaker A','Speaker B']};
 fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(workspace));
 // This callback is registered before live-main: use the real OS-backed encryption API.
 app.whenReady().then(()=>{assert.equal(safeStorage.isEncryptionAvailable(),true);fs.mkdirSync(path.join(dir,'credentials'),{mode:0o700});fs.writeFileSync(path.join(dir,'credentials','obs.enc'),safeStorage.encryptString(JSON.stringify({version:1,endpoint:peer.url,password:peer.password,autoConnect:true})),{mode:0o600});});
 app.on('browser-window-created',(_e,win)=>win.webContents.once('did-finish-load',async()=>{
  const ev=x=>win.webContents.executeJavaScript(x);
  const wait=async(x)=>{const end=Date.now()+15000;while(Date.now()<end){if(await ev(x))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+x);};
  try{
   await wait(`window.liveService?.site().then(s=>s.workspace.inventory?.origin==='live'&&!s.live.busy)`);
   const first=await ev('window.liveService.site()');assert.equal(first.credentials.saved,true);assert.equal(first.credentials.autoConnect,true);assert.equal(first.live.permissions.scenes,false);assert.equal(peer.state.writes.length,0);assert.equal(peer.state.streaming,false);
   assert.equal(JSON.stringify(first).includes(peer.password),false);assert.equal(fs.readFileSync(path.join(dir,'credentials','obs.enc')).includes(Buffer.from(peer.password)),false);
   await ev(`window.liveService.selectService('one')`);
   await ev(`window.liveService.cue({kind:'speaker',name:'Speaker B'})`);
   await ev(`window.liveService.cue({kind:'add',reference:'Johannes 3,16'})`);
   await ev(`window.liveService.cue({kind:'add',reference:'Psalm 23,1–6'})`);
   assert.equal(peer.state.writes.length,0);
   await ev(`window.liveService.enable({scenes:true,audio:false,stream:false,operator:false})`);
   await ev(`window.liveService.command('bible','Johannes 3,16')`);
   let s=await ev('window.liveService.site()');assert.equal(s.live.observation.program,'Bible');assert.equal(s.cues.entries[0].shownAt>0,true);assert.equal(s.cues.selected,s.cues.entries[1].id);
   await ev(`window.liveService.command('prayer')`);
   s=await ev('window.liveService.site()');assert.equal(s.live.observation.program,'Prayer');assert.ok(s.live.returnAt>Date.now()+12000);assert.equal(peer.state.mutes.Microphone,false);
   await ev('window.liveService.cancelReturn()');await ev('window.liveService.release()');
   await wait('window.streamManagement.panel().then(p=>p.ready&&!p.busy)');
   const year=new Date().getUTCFullYear()+1;
   const series={id:'native-service',name:'Gottesdienst',kind:'service',anchorDate:year+'-01-01',time:'11:00',timeZone:'Europe/Berlin',weekdays:[7],intervalWeeks:1,excludeDates:[],destinations:[{language:'de',title:{mode:'dated',text:'Gottesdienst'},description:'',privacy:'private',madeForKids:false}]};
   const reply=await ev(`window.streamManagement.action(${JSON.stringify({kind:'series-save',series})})`);assert.equal(reply.panel.error,'');assert.equal(reply.panel.state.series.some(s=>s.id===series.id),true);
   const range={requestId:'native-preview',seriesId:series.id,from:year+'-01-01',until:year+'-01-31'};
   const preview=await ev(`window.streamManagement.seriesPreview(${JSON.stringify(range)})`);assert.ok(preview.newCount>=4&&preview.newCount<=5);assert.equal(await ev(`window.streamManagement.panel().then(p=>p.state.occurrences.length)`),0);
   await ev(`document.getElementById('nav-setup').click()`);await wait(`!!document.getElementById('connect-saved-obs')`);
   assert.equal(await ev(`document.getElementById('live-obs-password').value`),'');
   assert.equal(await ev(`document.querySelectorAll('.bcc-rail .desk-sidebar-content').length`),1);
   assert.equal(await ev(`document.documentElement.scrollWidth>innerWidth+2`),false);
   fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/native-redesign.png',(await win.webContents.capturePage()).toPNG());
   console.log('PASS native redesign: real Keychain ciphertext reused at startup; zero startup output writes; speaker/queue state; confirmed Bible advancement; Prayer return; local series preview; persistent sidebar. No real accounts or equipment used.');await finish(0);
  }catch(e){await finish(1,e);}
 }));
 require('../dist/live-main.cjs');
})().catch(e=>finish(1,e));
