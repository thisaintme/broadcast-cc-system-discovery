/* Real Electron UI + IPC against an authenticated invented loopback OBS peer only. */
const {app,dialog}=require('electron');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {start}=require('../tests/mock-operator.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-operator-smoke-'));app.setPath('userData',dir);
let peer,finished=false,allowOperator=false,operatorDialogs=0,holdDialog=false,resolveDialog;
const timer=setTimeout(()=>finish(1,new Error('Operator UI test timed out')),120000);
dialog.showMessageBox=async(_window,options)=>{
  assert.equal(options.defaultId,0);assert.equal(options.cancelId,0);
  if(options.message==='Enable live control of this OBS session?'){assert.match(options.detail,/operator desk: ENABLED/);return {response:1};}
  if(options.message==='Apply this OBS operator action?'){operatorDialogs++;assert.match(options.detail,/Synthetic production collection/);assert.match(options.detail,/Synthetic profile/);if(holdDialog)return new Promise(resolve=>resolveDialog=resolve);return {response:allowOperator?1:0};}
  return {response:0};
};
async function finish(code,error){if(finished)return;finished=true;clearTimeout(timer);if(error)console.error(error);if(peer)await peer.close();try{fs.rmSync(dir,{recursive:true,force:true});}catch{}app.exit(code);}
(async()=>{
  peer=await start();peer.state.streaming=true;
  const w={format:'broadcast-cc-workspace',version:1,obsUrl:peer.url,companionUrl:'http://127.0.0.1:8000',inventory:null,connections:[],bindings:{scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone'},captions:{speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'}},services:[{id:'one',title:'Synthetic service',startsAt:'2026-10-25T10:00:00Z'},{id:'two',title:'Next service',startsAt:'2026-10-29T17:00:00Z'}],speakers:['Speaker A','Speaker B']};
  fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(w));
  app.on('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
    const evaluate=code=>win.webContents.executeJavaScript(code);
    const wait=async(code,timeout=15000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,60));}throw new Error('Operator UI condition timed out: '+code);};
    const click=async id=>{await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);await new Promise(r=>setTimeout(r,120));};
    const field=async(id,value,type='input')=>{await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(${type==='select'?'HTMLSelectElement':type==='textarea'?'HTMLTextAreaElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(type==='select'?'change':'input')},{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,100));};
    const idle=()=>wait("window.liveService.site().then(s=>!s.live.busy)");
    const available=id=>wait(`!!document.getElementById(${JSON.stringify(id)})&&!document.getElementById(${JSON.stringify(id)}).disabled`);
    try{
      await wait("!!document.getElementById('nav-setup')");await click('nav-setup');await field('live-obs-password',peer.password);await click('connect-live-obs');await wait("window.liveService.site().then(s=>s.workspace.inventory?.origin==='live'&&!s.live.busy)");
      await click('nav-operator');await wait("document.getElementById('operator-scene')?.options.length>5");assert.equal(peer.state.writes.length,0);assert.equal(await evaluate("document.getElementById('operator-program').disabled"),true);
      await click('nav-live');await click('permission-operator');await click('enable-live');await wait("window.liveService.snapshot().then(s=>s.permissions.operator===true)");
      assert.equal(peer.state.writes.length,0);assert.equal(await evaluate("window.liveService.snapshot().then(s=>s.permissions.stream)"),false);
      await click('nav-operator');await wait("document.getElementById('operator-scene')?.options.length>5");await field('operator-scene','Prayer','select');await available('operator-program');await click('operator-program');await idle();assert.equal(operatorDialogs,1);assert.equal(peer.state.writes.length,0);
      allowOperator=true;await available('operator-program');await click('operator-program');await wait("window.liveService.snapshot().then(s=>s.observation.program==='Prayer'&&!s.busy)");assert.equal(peer.state.streaming,true);
      await field('operator-scene','Singing','select');await available('operator-preview');await click('operator-preview');await idle();await wait("document.getElementById('operator-preview-status').textContent==='Singing'");assert.equal(peer.state.program,'Prayer');await available('operator-take');await click('operator-take');await wait("window.liveService.snapshot().then(s=>s.observation.program==='Singing'&&!s.busy)");
      await field('operator-audio-input','Other input','select');await click('operator-read-audio');await available('operator-volume-apply');await field('operator-volume','-9');await click('operator-volume-apply');await idle();assert.equal(peer.state.volumes['Other input'],-9);assert.equal(peer.state.volumes.Microphone,-12);
      await click('operator-read-audio');await available('operator-mute');await click('operator-mute');await idle();assert.equal(peer.state.mutes['Other input'],true);assert.equal(peer.state.mutes.Microphone,false);
      await field('operator-container','g:Reference','select');await click('operator-read-items');await available('operator-hide-203');await click('operator-hide-203');await idle();assert.equal(peer.state.nodes.Reference.find(i=>i.sceneItemId===203).sceneItemEnabled,false);assert.equal(peer.state.nodes.Reference.find(i=>i.sceneItemId===202).sceneItemEnabled,true);
      await field('operator-text-input','Reference text','select');await click('operator-read-text');await available('operator-text-apply');await field('operator-text-value','New synthetic reference','textarea');await click('operator-text-apply');await idle();assert.equal(peer.state.settings['Reference text'].text,'New synthetic reference');assert.deepEqual(peer.state.settings['Reference text'].font,{size:28});
      for(const [id,state] of [['operator-record-start','Active'],['operator-record-pause','Paused'],['operator-record-resume','Active'],['operator-record-stop','Off']]){await available(id);await click(id);await idle();await wait(`document.getElementById('operator-record-status').textContent.includes(${JSON.stringify(state)})`);}
      assert.equal(peer.state.recording,false);assert.equal(peer.state.streaming,true);
      await available('operator-virtual-start');await click('operator-virtual-start');await idle();assert.equal(peer.state.virtualCamera,true);await available('operator-virtual-stop');await click('operator-virtual-stop');await idle();assert.equal(peer.state.virtualCamera,false);
      await field('operator-media-input','Media clip','select');await click('operator-read-media');await available('operator-media-play');await click('operator-media-play');await idle();assert.equal(peer.state.media,'OBS_MEDIA_STATE_PLAYING');assert.equal(peer.state.mutes['Media clip'],true);
      assert.ok(peer.state.writes.every(x=>!['StartStream','StopStream','SetStreamServiceSettings','SetSceneItemTransform'].includes(x.name)));
      await available('operator-program');const count=peer.state.writes.length;holdDialog=true;await click('operator-program');assert.ok(resolveDialog);await click('release-live');resolveDialog({response:1});await idle();assert.equal(peer.state.writes.length,count);assert.equal(peer.state.streaming,true);assert.equal(await evaluate("window.liveService.snapshot().then(s=>s.permissions.operator===true)"),false);
      const shape=await evaluate("({overflow:document.documentElement.scrollWidth>innerWidth+2,mode:document.getElementById('live-mode').textContent})");assert.equal(shape.overflow,false);assert.equal(shape.mode,'OBSERVE ONLY');
      fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/smoke-operator.png',(await win.webContents.capturePage()).toPNG());
      const stored=fs.readFileSync(path.join(dir,'workspace.json'),'utf8');assert.ok(!stored.includes(peer.password));assert.ok(!stored.includes('operator'));
      console.log('Operator UI passed: observe without writes, independent permission, cancelled/approved target confirmations, all scenes, Preview/Take, input level/mute, nested visibility, text-only updates, recording lifecycle, Virtual Camera, media, release during confirmation, stream preservation and layout width.');await finish(0);
    }catch(error){await finish(1,error);}
  }));
  require('../dist/live-main.cjs');
})().catch(error=>finish(1,error));
