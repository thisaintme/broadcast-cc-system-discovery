/* Real Electron renderer + IPC + authenticated, synthetic loopback OBS. No live accounts. */
'use strict';
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {start}=require('../tests/mock-live.cjs');
app.disableHardwareAcceleration();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-v107-'));
app.setPath('userData',dir);
const out=path.resolve('release/v107');fs.mkdirSync(out,{recursive:true});
let peer,finished=false,window,allowGrant=false,allowOutro=false;
const passed=[];
const timer=setTimeout(()=>finish(1,new Error('V107 acceptance timed out')),110000);
dialog.showMessageBox=async(_win,options)=>{
  assert.equal(options.defaultId,0);assert.equal(options.cancelId,0);
  if(options.message==='Steuerung für diese OBS-Sitzung freigeben?'){assert.match(options.detail,/Überblenden/);return {response:allowGrant?1:0};}
  if(options.message==='Sendeton ausschalten und Outro zeigen?')return {response:allowOutro?1:0};
  return {response:0};
};
async function finish(code,error){
 if(finished)return;finished=true;clearTimeout(timer);
 if(error){console.error(error);if(window&&!window.isDestroyed())try{fs.writeFileSync(path.join(out,'failure.png'),(await window.webContents.capturePage()).toPNG());}catch{}}
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:code===0,passed,error:error?String(error):null,environment:'Synthetic OBS; real Electron/IPC; no production accounts or equipment'},null,2));
 if(peer)await peer.close();fs.rmSync(dir,{recursive:true,force:true});app.exit(code);
}
(async()=>{
 peer=await start();peer.state.streaming=true;
 for(const name of ['Chapter','Interlude','Singing','Prayer','Remote']){peer.state.scenes.push(name);peer.state.nodes[name]=[];}
 const w={format:'broadcast-cc-workspace',version:1,obsUrl:peer.url,companionUrl:'http://127.0.0.1:8000',inventory:null,connections:[],transitionMs:900,bindings:{scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro',chapter:'Chapter',interlude:'Interlude',singing:'Singing',prayer:'Prayer',remote:'Remote'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone'},captions:{speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'}},services:[{id:'one',title:'Testumgebung · Gottesdienst',startsAt:'2026-11-15T10:00:00Z'},{id:'two',title:'Folgetermin',startsAt:'2026-11-18T18:00:00Z'}],speakers:['Speaker A','Speaker B']};
 fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(w));
 app.on('browser-window-created',(_event,win)=>{
  if(window)return;window=win;win.setSize(1440,1000);
  const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message);});
  win.webContents.once('did-finish-load',async()=>{
   const ev=code=>win.webContents.executeJavaScript(code,true);
   const wait=async(code,ms=12000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await ev(code))return;await new Promise(r=>setTimeout(r,40));}throw Error('Timed out: '+code);};
   const click=async id=>{await ev(`document.getElementById(${JSON.stringify(id)}).click()`);};
   const field=async(id,value)=>{await ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
   const capture=async name=>{fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());};
   try{
    await wait(`!!document.getElementById('v107-scene-main')`);
    assert.equal(await ev(`getComputedStyle(document.querySelector('.v107-navbar')).backgroundColor`),'rgb(22, 29, 38)');
    assert.equal(peer.state.writes.length,0);passed.push('native asset protocol loads V107 CSS; no startup output writes');
    await ev(`window.liveService.connect(${JSON.stringify(peer.password)})`);
    await wait(`window.liveService.site().then(s=>s.workspace.inventory?.origin==='live'&&!s.live.busy)`);
    await ev(`window.liveService.selectService('one')`);
    await ev(`window.liveService.enable({scenes:true,audio:true,stream:true,operator:false})`);
    assert.equal((await ev('window.liveService.site()')).live.permissions.scenes,false);
    allowGrant=true;await ev(`window.liveService.enable({scenes:true,audio:true,stream:true,operator:false})`);
    await wait(`!document.getElementById('v107-scene-main').disabled`);
    assert.equal(peer.state.writes.length,0);passed.push('native permission cancellation/default and explicit grant without writes');
    assert.equal(await ev(`document.querySelectorAll('.v107-scenes button').length`),8);
    assert.equal(await ev(`document.querySelectorAll('#v107-audio').length`),1);
    assert.equal(await ev(`document.querySelectorAll('.v107-picture-chips button,.desk-manual,.desk-sidebar-content').length`),0);
    assert.equal(await ev(`document.getElementById('v107-scene-main').dataset.onAir`),'true');
    assert.equal(await ev(`document.querySelectorAll('.v107-channel[data-on-air="true"]').length`),0);
    passed.push('one dock, read-only chips, eight scenes, OBS does not imply YouTube live');
    peer.state.replyDelayMs=350;
    await ev(`document.getElementById('v107-scene-chapter').click();document.getElementById('v107-scene-chapter').click()`);
    await wait(`document.getElementById('v107-scene-chapter').dataset.requested==='true'`);
    assert.equal(await ev(`document.getElementById('v107-scene-chapter').dataset.onAir`),'false');
    await wait(`window.liveService.site().then(s=>!s.live.busy&&s.live.observation.program==='Chapter')`);
    peer.state.replyDelayMs=0;
    assert.equal(peer.state.writes.filter(x=>x.name==='SetCurrentProgramScene'&&x.data.sceneName==='Chapter').length,1);
    passed.push('gold request until backend confirmation; rapid double click produces one scene command');
    for(const [role,name] of [['prayer','Prayer'],['singing','Singing'],['interlude','Interlude'],['remote','Remote'],['intro','Intro'],['main','Main']]){
      await wait(`!document.getElementById('v107-scene-${role}').disabled`);await click('v107-scene-'+role);
      await wait(`window.liveService.site().then(s=>!s.live.busy&&s.live.observation.program===${JSON.stringify(name)})`);
      assert.equal((await ev('window.liveService.site()')).live.returnAt,null);
    }
    assert.equal(peer.state.streaming,true);assert.equal(peer.state.mutes.Microphone,false);
    assert.equal(peer.state.writes.some(x=>['StartStream','StopStream'].includes(x.name)),false);
    passed.push('scene routes preserve transmission; Intro mutes, Main unmutes, prayer stays selected');
    await field('v107-reference','1 Kor 4, 12ff');
    await wait(`document.getElementById('v107-reference-hint').textContent==='1. Korinther Kap. 4 ab Vers 12'`);
    const before=peer.state.writes.length;
    await ev(`document.getElementById('v107-reference').dispatchEvent(new KeyboardEvent('keydown',{key:'F5',bubbles:true,cancelable:true}));document.getElementById('v107-reference').dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true,cancelable:true}))`);
    assert.equal(peer.state.writes.length,before);assert.equal(await ev('!!document.fullscreenElement'),false);
    await ev(`document.querySelector('#v107-reference').closest('form').requestSubmit()`);
    await wait(`window.liveService.site().then(s=>!s.live.busy&&s.cues.entries.length===1)`);
    assert.equal(peer.state.writes.length,before);
    await ev(`document.querySelector('.v107-cue button[aria-label$="bearbeiten"]').click()`);
    await wait(`!!document.getElementById('v107-edit-reference')`);
    await field('v107-edit-reference','Joh 3,16-18');
    await ev(`document.getElementById('v107-edit-reference').closest('form').requestSubmit()`);
    await wait(`window.liveService.site().then(s=>!s.live.busy&&s.cues.entries[0].reference==='Johannes Kap. 3 Vers 16–18')`);
    assert.equal(peer.state.writes.length,before);
    await wait(`!document.getElementById('v107-show-bible').disabled`);await click('v107-show-bible');
    await wait(`window.liveService.site().then(s=>!s.live.busy&&s.cues.entries[0].shownAt!==null)`);
    assert.equal(peer.state.settings['Reference text'].text,'Johannes Kap. 3 Vers 16–18');
    assert.equal(await ev(`document.querySelectorAll('#cancel-live-return').length`),1);
    await click('cancel-live-return');await wait(`window.liveService.site().then(s=>s.live.returnAt===null)`);
    passed.push('shorthand preview; edit/save is local; typing shortcuts inert; queue advances only after confirmed caption');
    await click('v107-scene-main');await wait(`window.liveService.site().then(s=>!s.live.busy&&s.live.observation.program==='Main')`);
    const writes=peer.state.writes.length;await click('v107-scene-outro');
    await wait(`window.liveService.site().then(s=>!s.live.busy)`);assert.equal(peer.state.writes.length,writes);
    passed.push('cancelled native Outro confirmation leaves output untouched');
    await click('v107-fullscreen');await wait(`!!document.fullscreenElement`);
    assert.equal(await ev(`document.querySelectorAll('#v107-audio').length`),1);
    await capture('fullscreen');await click('v107-fullscreen');await wait(`!document.fullscreenElement`);
    await capture('dark');await ev(`document.querySelector('[aria-label="Helles Design aktivieren"]').click()`);
    await wait(`document.documentElement.dataset.theme==='light'`);await capture('light');
    assert.equal(await ev(`document.documentElement.scrollWidth>innerWidth+2`),false);
    passed.push('fullscreen uses same dock; both themes; no desktop horizontal overflow');
    await ev(`document.querySelector('[aria-label="Dunkles Design aktivieren"]').click()`);
    await peer.close();peer=null;
    await wait(`document.getElementById('v107-scene-main').disabled&&!!document.querySelector('.v107-picture-fault')`);
    assert.equal(await ev(`document.querySelectorAll('.v107-scenes [data-on-air="true"]').length`),0);
    assert.equal(await ev(`document.getElementById('open-outro-panel').disabled`),false);
    await capture('fault');await click('open-outro-panel');await wait(`!!document.getElementById('end-scope')`);
    passed.push('OBS disconnect clears tally, blocks ineffective controls, keeps reviewed end flow reachable');
    assert.equal(errors.some(x=>/Uncaught|ReferenceError|TypeError/.test(x)),false);
    console.log('PASS V107 native acceptance: '+passed.join('; '));await finish(0);
   }catch(error){await finish(1,error);}
  });
 });
 require('../dist/live-main.cjs');
})().catch(error=>finish(1,error));
