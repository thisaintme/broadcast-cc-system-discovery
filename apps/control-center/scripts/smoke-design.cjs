/* Native Electron renderer/IPC design regression; synthetic OBS only, no user devices. */
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {start}=require('../tests/mock-live.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-design-smoke-'));app.setPath('userData',dir);
let peer,finished=false;
dialog.showMessageBox=async(_window,options)=>({response:options.message==='Enable live control of this OBS session?'?1:0});
const timer=setTimeout(()=>finish(1,new Error('Design UI test timed out')),90000);
async function finish(code,error){if(finished)return;finished=true;clearTimeout(timer);if(error)console.error(error);if(peer)await peer.close();try{fs.rmSync(dir,{recursive:true,force:true});}catch{}app.exit(code);}
(async()=>{
 peer=await start();peer.state.streaming=true;
 const workspace={format:'broadcast-cc-workspace',version:1,obsUrl:peer.url,companionUrl:'http://127.0.0.1:8000',inventory:null,connections:[],bindings:{scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone'},captions:{speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'}},services:[{id:'one',title:'Synthetic service',startsAt:'2026-10-25T10:00:00Z'},{id:'two',title:'Next service',startsAt:'2026-11-01T10:00:00Z'}],speakers:['Speaker A','Speaker B']};
 fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(workspace));
 app.on('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
  const evaluate=code=>win.webContents.executeJavaScript(code);
  const wait=async(code)=>{const until=Date.now()+10000;while(Date.now()<until){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,50));}throw Error('Design condition timed out: '+code);};
  const click=async id=>{await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);await new Promise(r=>setTimeout(r,80));};
  const field=async(id,value,select=false)=>{await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(${select?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${select?'"change"':'"input"'},{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,80));};
  try{
   await wait("!!document.getElementById('nav-setup')");await click('nav-setup');await field('live-obs-password',peer.password);await click('connect-live-obs');await wait("window.liveService.site().then(s=>s.workspace.inventory?.origin==='live'&&!s.live.busy)");
   await click('nav-live');assert.match(await evaluate("document.getElementById('enable-live').textContent"),/aktivieren/);assert.match(await evaluate("document.getElementById('release-live').textContent"),/abgeben/);await field('live-service','one',true);await click('permission-scenes');await click('enable-live');await wait("window.liveService.snapshot().then(s=>s.permissions.scenes)");
   const writes=peer.state.writes.length;
   for(const cue of ['speaker','bible','outro']){await click('open-'+cue+'-panel');assert.equal(peer.state.writes.length,writes);await click('close-cue-panel');}
   await evaluate("document.getElementById('open-speaker-panel').focus()");await click('open-speaker-panel');
   await evaluate("document.querySelector('.bcc-cue-panel').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
   await wait("!document.getElementById('live-speaker-select')");assert.equal(await evaluate('document.activeElement.id'),'open-speaker-panel');
   await click('open-speaker-panel');await field('live-speaker-select','Speaker B',true);await click('live-speaker');await wait("window.liveService.snapshot().then(s=>s.returnAt!==null&&!s.busy)");
   await click('nav-schedule');assert.equal(await evaluate("!!document.getElementById('cancel-live-return')"),true);await click('cancel-live-return');await wait("window.liveService.snapshot().then(s=>s.returnAt===null)");
   await click('nav-live');await click('release-live');assert.equal(peer.state.streaming,true);
   for(const width of [1440,1200,1024,768,540]){
    win.setMinimumSize(360,600);win.setContentSize(width,900);await new Promise(r=>setTimeout(r,80));
    for(const tab of ['overview','live','schedule','setup']){
     await click('nav-'+tab);
     const shape=await evaluate("({overflow:document.documentElement.scrollWidth>innerWidth+2,duplicates:[...document.querySelectorAll('[id]')].map(x=>x.id).filter((x,i,a)=>a.indexOf(x)!==i)})");assert.equal(shape.overflow,false,`${width}/${tab}`);assert.deepEqual(shape.duplicates,[]);
    }
   }
   win.setContentSize(1440,1000);await click('nav-live');await click('open-bible-panel');
   fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/smoke-design-dark.png',(await win.webContents.capturePage()).toPNG());
   await evaluate("document.querySelector('.bcc-theme').click()");await wait("document.documentElement.dataset.theme==='light'");
   fs.writeFileSync('release/smoke-design-light.png',(await win.webContents.capturePage()).toPNG());
   assert.equal(peer.state.streaming,true);
   console.log('Design UI passed: side-effect-free panels, Escape focus restoration, global return cancellation, responsive navigation, unique IDs, theme switch and stream preservation.');await finish(0);
  }catch(error){await finish(1,error);}
 }));
 require('../dist/live-main.cjs');
})().catch(error=>finish(1,error));
