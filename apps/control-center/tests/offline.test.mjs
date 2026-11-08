import test from 'node:test';
import assert from 'node:assert/strict';
import mock from './mock-offline.cjs';
import {blankWorkspace,disconnected} from '../src/model.ts';
import {executeOffline,assertOfflineSafe,offlineOutputsOff,nextServiceCaption} from '../src/offline.ts';
import {readTransport,inspectObs} from '../src/inspect.ts';
import {ObsAdapter} from '../src/obs.ts';
import {Rehearsal} from '../src/rehearsal.ts';
import {importWorkspace,validateWorkspace} from '../src/workspace.ts';

async function setup(reader){
  const w=blankWorkspace();w.inventory=await inspectObs(reader);
  w.bindings={...w.bindings,scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',confirmed:true};
  w.speakers=['Speaker A','Speaker B','Guest'];
  w.captions={testCollection:'BCC TEST - synthetic',speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B',Guest:''},confirmed:true};
  w.services=[{id:'one',title:'Service',startsAt:'2026-09-27T09:00:00.000Z'},{id:'two',title:'Midweek service',startsAt:'2026-10-01T16:00:00.000Z'}];
  return w;
}
async function rig(){
  const {state,request}=mock.fixture();const port={read:async(n,d)=>request(n,d),change:async(n,d)=>{request(n,d);}};
  return {state,port,w:await setup(port)};
}
test('old workspace imports acquire empty, unauthorized caption settings',()=>{
  const old=blankWorkspace();delete old.captions;const w=importWorkspace(old);
  assert.equal(w.captions.confirmed,false);assert.deepEqual(w.captions.speakerPool,[]);
});
test('export and restart cannot retain caption authorization or inject unrelated properties',async()=>{
  const {w}=await rig();w.captions.password='PRIVATE';w.captions.speakerSources.password='PRIVATE';
  const imported=importWorkspace(w);assert.equal(imported.captions.confirmed,false);assert.equal(imported.bindings.confirmed,false);
  assert.ok(!JSON.stringify(validateWorkspace(w,true)).includes('PRIVATE'));
});
test('Program controls require the named test collection, a live inspection, and both confirmations',async()=>{
  for(const modify of [w=>w.captions.testCollection='Production',w=>w.inventory.origin='report',w=>w.captions.confirmed=false,w=>w.bindings.confirmed=false]){
    const {w,port,state}=await rig();modify(w);await assert.rejects(executeOffline(port,w,'main','','one',()=>true));assert.deepEqual(state.writes,[]);
  }
});
test('active or unknown streaming/recording always blocks real writes',async()=>{
  for(const key of ['streaming','recording'])for(const value of [true,null]){
    const {w,port,state}=await rig();state[key]=value;await assert.rejects(executeOffline(port,w,'main','','one',()=>true));assert.deepEqual(state.writes,[]);
  }
});
test('only explicit optional-resource absence is distinguished from unknown',async()=>{
  const {w,port,state}=await rig();let s=await readTransport(port);
  assert.equal(s.replayBuffer,null);assert.ok(s.unavailableOutputs.includes('replayBuffer'));assertOfflineSafe(s,w);
  for(const code of [204,500,'BCC_TIMEOUT']){
    state.unavailable.clear();state.failures.set('GetReplayBufferStatus',{code});s=await readTransport(port);
    assert.equal(offlineOutputsOff(s),false);assert.throws(()=>assertOfflineSafe(s,w));
  }
});
test('Prepare updates only next-service text, preserving fonts and all audio',async()=>{
  const {w,port,state}=await rig(),before=structuredClone(state.nodes);
  await executeOffline(port,w,'prepare','','one',()=>true);
  assert.deepEqual(state.writes.map(x=>x.name),['SetInputSettings']);
  assert.match(state.settings['Next date'].text,/01\.10\.2026/);assert.match(state.settings['Next date'].text,/18:00/);
  assert.deepEqual(state.settings['Next date'].font,{size:26});assert.deepEqual(state.nodes,before);assert.equal(state.program,'Main');
});
test('no next service replaces stale date with an honest fallback',async()=>{
  const {w}=await rig();assert.equal(nextServiceCaption(w,'two'),'Nächster Termin folgt.');
});
test('Bible changes only its mapped text and then Program; group audio and icon remain untouched',async()=>{
  const {w,port,state}=await rig(),before=structuredClone(state.nodes.Reference);
  await executeOffline(port,w,'bible','Johannes Kap. 3 ab Vers 16','one',()=>true);
  assert.deepEqual(state.writes.map(x=>x.name),['SetInputSettings','SetCurrentProgramScene']);
  assert.deepEqual(state.nodes.Reference,before);assert.deepEqual(state.settings['Reference text'].font,{size:28});assert.equal(state.program,'Bible');
});
test('speaker switch hides every other reviewed name, leaves icons unchanged, and never rewrites names',async()=>{
  const {w,port,state}=await rig();state.nodes.Names[2].sceneItemEnabled=true;
  const before=structuredClone(state.settings);
  await executeOffline(port,w,'speaker','Speaker B','one',()=>true);
  assert.deepEqual(state.nodes.Names.filter(i=>i.sceneItemEnabled).map(i=>i.sourceName),['Speaker B','Speaker icon']);
  assert.deepEqual(state.settings,before);assert.equal(state.program,'Speaker');
  assert.ok(state.writes.filter(x=>x.name==='SetSceneItemEnabled').every(x=>[101,102,103].includes(x.data.sceneItemId)));
});
test('unmapped guest is refused without touching any OBS state',async()=>{
  const {w,port,state}=await rig();await assert.rejects(executeOffline(port,w,'speaker','Guest','one',()=>true),/mapped/);assert.deepEqual(state.writes,[]);
});
test('new group text requires review rather than silently being hidden',async()=>{
  const {w,port,state}=await rig();state.nodes.Names.push({...state.nodes.Names[0],sceneItemId:999,sourceName:'Unreviewed text'});
  await assert.rejects(executeOffline(port,w,'speaker','Speaker B','one',()=>true),/review/);assert.deepEqual(state.writes,[]);
});
test('hidden or ambiguous caption paths are rejected before writing',async()=>{
  for(const modify of [s=>s.nodes.Bible[0].sceneItemEnabled=false,s=>s.nodes.Reference.push({...s.nodes.Reference[0],sceneItemId:909})]){
    const {w,port,state}=await rig();modify(state);await assert.rejects(executeOffline(port,w,'bible','Reference','one',()=>true),/path/);assert.deepEqual(state.writes,[]);
  }
});
test('file-backed text is not changed and no file setting is toggled',async()=>{
  const {w,port,state}=await rig();state.settings['Reference text'].from_file=true;
  await assert.rejects(executeOffline(port,w,'bible','Reference','one',()=>true),/File-backed/);assert.deepEqual(state.writes,[]);
});
test('collection switch just before mutation is caught by fresh guard',async()=>{
  const {w,port,state}=await rig();state.before=n=>{if(n==='GetInputDefaultSettings')state.collection='Production';};
  await assert.rejects(executeOffline(port,w,'bible','Reference','one',()=>true));assert.deepEqual(state.writes,[]);
});
test('cancellation after text write stops Program without automatic rollback',async()=>{
  const {w,port,state}=await rig();let valid=true;state.afterWrite=()=>{valid=false;};
  await assert.rejects(executeOffline(port,w,'bible','New reference','one',()=>valid),/interrupted/);
  assert.equal(state.writes.length,1);assert.equal(state.program,'Main');assert.equal(state.settings['Reference text'].text,'New reference');
});
test('failure partway through speaker visibility stops before Program',async()=>{
  const {w,port,state}=await rig();state.afterWrite=()=>state.failures.set('SetSceneItemEnabled',{code:500});
  await assert.rejects(executeOffline(port,w,'speaker','Speaker B','one',()=>true));
  assert.equal(state.writes.length,1);assert.equal(state.program,'Main');assert.equal(state.nodes.Names[0].sceneItemEnabled,false);
});
test('negative text readback prevents scene advance',async()=>{
  const {w,port,state}=await rig();state.afterWrite=(n)=>{if(n==='SetInputSettings')state.settings['Reference text'].text='Changed elsewhere';};
  await assert.rejects(executeOffline(port,w,'bible','New reference','one',()=>true),/confirm/);assert.equal(state.program,'Main');
});
test('real WebSocket adapter confirms own caption events without self-interruption',async()=>{
  const peer=await mock.start(),adapter=new ObsAdapter(),interruptions=[];
  adapter.onUnsafe=reason=>interruptions.push(reason);
  try{
    await adapter.connect(peer.url,peer.password);const w=await setup(adapter);interruptions.length=0;
    await adapter.offline(w,'prepare','','one',()=>true);
    await adapter.offline(w,'speaker','Speaker B','one',()=>true);
    await adapter.offline(w,'bible','New reference','one',()=>true);
    assert.equal(adapter.state().program,'Bible');assert.deepEqual(interruptions,[]);
    assert.ok(peer.state.writes.every(x=>['SetInputSettings','SetSceneItemEnabled','SetCurrentProgramScene'].includes(x.name)));
  }finally{await adapter.disconnect();await peer.close();}
});
test('external Program change disarms and makes an old timer harmless',async()=>{
  const peer=await mock.start(),adapter=new ObsAdapter(),timers=[];
  try{
    await adapter.connect(peer.url,peer.password);const w=await setup(adapter);
    const clock={now:()=>100,set:fn=>{timers.push(fn);return fn;},clear:()=>{}};
    const r=new Rehearsal(()=>w,adapter,()=>{},clock);
    adapter.onUnsafe=reason=>{if(r.runtime.mode!=='simulation')r.interrupt(reason);};
    await r.setMode('offline-program');await r.command('prepare');await r.command('intro');await r.command('main');await r.command('speaker','Speaker B');
    peer.state.program='Outro';peer.emit('CurrentProgramSceneChanged',{sceneName:'Outro'});await new Promise(resolve=>setTimeout(resolve,30));
    const count=peer.state.writes.length;timers[0]();await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(r.runtime.mode,'simulation');assert.equal(peer.state.writes.length,count);
  }finally{await adapter.disconnect();await peer.close();}
});
test('actual offline timed return changes Program to Main after ten-second scheduling',async()=>{
  const {w,port,state}=await rig();const timers=[];
  const p={...port,state:()=>({...disconnected(),connected:true,streaming:false,recording:false,virtualCamera:false,replayBuffer:false,studio:true,collection:w.inventory.collection}),preview:async()=>{},offline:(...args)=>executeOffline(port,...args)};
  const r=new Rehearsal(()=>w,p,()=>{},{now:()=>0,set:(fn,ms)=>{timers.push({fn,ms});return fn;},clear:()=>{}});
  await r.setMode('offline-program');await r.command('prepare');await r.command('intro');await r.command('main');await r.command('bible','Reference');
  assert.equal(timers[0].ms,10000);timers[0].fn();
  for(let i=0;i<20&&r.runtime.busy;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(state.program,'Main');assert.equal(r.runtime.phase,'main');
});
