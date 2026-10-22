import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioMonitor} from '../src/audio-monitor.ts';
import {parseAudioChannels,normalizeAudioObservations} from '../src/audio-model.ts';
import {blankWorkspace} from '../src/model.ts';
import {validateWorkspace,importWorkspace} from '../src/workspace.ts';
const allTracks={'1':true,'2':false,'3':false,'4':false,'5':false,'6':false};
function rig(override){
  let now=1000;const calls=[],subscriptions=[];
  const session={subscribe:async value=>{subscriptions.push(value);},read:async(name,data={})=>{
    calls.push({name,data});const custom=override?.(name,data);if(custom!==undefined)return await custom;
    if(name==='GetInputList')return {inputs:[{inputName:'Test microphone',inputKind:'coreaudio_input_capture'},{inputName:'Test capture',inputKind:'vendor_plugin'}]};
    if(name==='GetSceneCollectionList')return {currentSceneCollectionName:'Audio test collection'};
    if(name==='GetSceneList')return {currentProgramSceneName:'Main'};
    if(name==='GetVersion')return {obsVersion:'32.0'};
    if(name==='GetInputMute')return {inputMuted:true};
    if(name==='GetInputVolume')return {inputVolumeDb:-6};
    if(name==='GetInputAudioTracks')return {inputAudioTracks:allTracks};
    if(name==='GetInputAudioMonitorType')return {monitorType:'OBS_MONITORING_TYPE_NONE'};
    if(name==='GetSourceActive'){assert.ok(data.sourceName);assert.equal(data.inputName,undefined);return {videoActive:true};}
    throw new Error('Unexpected request');
  }};
  const meter=new AudioMonitor(()=>now);meter.attach(session);
  return {meter,calls,subscriptions,session,advance:ms=>now+=ms};
}
const packet=(values=[[0,0,0.5]])=>({inputs:[{inputName:'Test microphone',inputLevelsMul:values}]});
test('meter tuples distinguish before-mute and after-mute peaks for every channel',()=>{
  const channels=parseAudioChannels([[0,0,0.5],[0.1,0.25,1]]);
  assert.ok(Math.abs(channels[0].inputPeakDb+6.0206)<0.001);assert.equal(channels[0].outputPeakDb,-100);
  assert.equal(channels[1].inputPeakDb,0);assert.ok(Math.abs(channels[1].outputPeakDb+12.0412)<0.001);
});
test('zeros are measured floor; malformed, missing, infinite and negative tuples are rejected',()=>{
  assert.deepEqual(parseAudioChannels([[0,0,0]]),[{inputPeakDb:-100,outputPeakDb:-100}]);
  for(const raw of [null,[],[[]],[[0,0]],[[0,0,null]],[[0,0,'0']],[[0,0,-1]],[[0,0,NaN]],[[0,0,Infinity]],Array(9).fill([0,0,0])])assert.equal(parseAudioChannels(raw),null);
});
test('observer is opt-in, uses only getters, discovers plugin audio without a kind-name guess',async()=>{
  const {meter,calls,subscriptions}=rig();
  try{assert.equal(calls.length,0);await meter.stop();assert.deepEqual(subscriptions,[]);await meter.start();
    assert.deepEqual(subscriptions,[true]);assert.equal(meter.snapshot().rows.length,2);
    assert.ok(calls.every(c=>c.name.startsWith('Get')));assert.equal(meter.snapshot().rows[0].muted.value,true);
  }finally{await meter.stop();}
});
test('muted input may have an incoming peak; inactive/missing meter is not silence',async()=>{
  const {meter}=rig();try{await meter.start();meter.event('InputVolumeMeters',packet());
    const [a,b]=meter.snapshot().rows;assert.equal(a.muted.value,true);assert.equal(a.meterState,'live');assert.equal(a.channels[0].outputPeakDb,-100);
    assert.equal(b.meterState,'not-reporting');assert.deepEqual(b.channels,[]);
    meter.event('InputVolumeMeters',{inputs:[]});assert.equal(meter.snapshot().rows[0].meterState,'not-reporting');assert.deepEqual(meter.snapshot().rows[0].channels,[]);
  }finally{await meter.stop();}
});
test('per-input sample freshness expires and stale readings disappear',async()=>{
  const {meter,advance}=rig();try{await meter.start();meter.event('InputVolumeMeters',packet());advance(2100);
    assert.equal(meter.snapshot().rows[0].meterState,'stale');assert.deepEqual(meter.snapshot().rows[0].channels,[]);
    advance(6000);assert.equal(meter.snapshot().rows[0].muted.value,null);assert.equal(meter.snapshot().rows[0].muted.fresh,false);
    meter.event('InputVolumeMeters',packet([[0,0,0]]));assert.equal(meter.snapshot().rows[0].meterState,'live');
  }finally{await meter.stop();}
});
test('invalid readings do not replace missing data with reassuring zeros',async()=>{
  const {meter}=rig();try{await meter.start();meter.event('InputVolumeMeters',packet([[0,0,null]]));assert.equal(meter.snapshot().rows[0].meterState,'invalid');
    meter.event('InputMuteStateChanged',{inputName:'Test microphone',inputMuted:0});assert.equal(meter.snapshot().rows[0].muted.value,null);
    meter.event('InputVolumeMeters',{inputs:'bad'});assert.deepEqual(meter.snapshot().rows[0].channels,[]);
  }finally{await meter.stop();}
});
test('a later mute event wins over an older outstanding getter response',async()=>{
  let release,started;const waiting=new Promise(resolve=>started=resolve);
  const {meter}=rig((name,data)=>name==='GetInputMute'&&data.inputName==='Test microphone'?new Promise(resolve=>{release=resolve;started();}):undefined);
  try{const operation=meter.start();await waiting;meter.event('InputMuteStateChanged',{inputName:'Test microphone',inputMuted:false});release({inputMuted:true});await operation;assert.equal(meter.snapshot().rows[0].muted.value,false);
  }finally{await meter.stop();}
});
test('optional status errors are unknown while valid meters continue; raw errors are not exported',async()=>{
  const {meter}=rig(name=>name==='GetInputAudioMonitorType'?Promise.reject(Object.assign(new Error('SECRET_RAW_PAYLOAD'),{code:604})):undefined);
  try{await meter.start();meter.event('InputVolumeMeters',packet());const row=meter.snapshot().rows[0];assert.equal(row.monitor.value,null);assert.equal(row.meterState,'live');assert.ok(!JSON.stringify(meter.snapshot()).includes('SECRET_RAW_PAYLOAD'));
  }finally{await meter.stop();}
});
test('stop cancels in-flight reads and late events cannot revive old telemetry',async()=>{
  let release,started;const waiting=new Promise(resolve=>started=resolve);
  const {meter}=rig(name=>name==='GetInputList'?new Promise(resolve=>{release=resolve;started();}):undefined);
  const operation=meter.start();await waiting;await meter.stop();release({inputs:[]});await operation;
  meter.event('InputVolumeMeters',packet());assert.equal(meter.snapshot().running,false);assert.equal(meter.snapshot().rows.length,0);
});
test('collection changes stop observation; reconnect never resumes old levels',async()=>{
  const {meter,session}=rig();try{await meter.start();meter.event('InputVolumeMeters',packet());meter.event('CurrentSceneCollectionChanging',{});
    assert.equal(meter.snapshot().running,false);assert.deepEqual(meter.snapshot().rows[0].channels,[]);
    meter.detach();assert.equal(meter.snapshot().connected,false);meter.attach(session);assert.equal(meter.snapshot().running,false);assert.deepEqual(meter.snapshot().rows,[]);
  }finally{await meter.stop();}
});
test('live meter events are published at a bounded tick rate rather than one IPC per event',async()=>{
  const {meter}=rig();try{await meter.start();let events=0;meter.onUpdate=()=>events++;
    for(let i=0;i<100;i++)meter.event('InputVolumeMeters',packet());assert.equal(events,0);assert.equal(meter.snapshot().rows[0].meterState,'live');
  }finally{await meter.stop();}
});
test('saved observations are allowlisted historical statements, never telemetry or control permission',()=>{
  const note={collection:'Test',inputName:'Mic',role:'service-audio',respondsTo:['pulpit','secret'],listening:'heard',monitoringPoint:'Existing monitor',notes:'One microphone test',basis:'automatic',confirmed:true,updatedAt:'2026-09-27T10:00:00Z',password:'SECRET',channels:[{secret:'SECRET'}],control:{mute:true}};
  const w=blankWorkspace();w.audioObservations=[note];w.audioTelemetry={password:'SECRET'};const saved=validateWorkspace(w,true);
  assert.equal(saved.audioObservations[0].basis,'operator-reported');assert.deepEqual(saved.audioObservations[0].respondsTo,['pulpit']);assert.equal(saved.captions.confirmed,false);
  assert.ok(!JSON.stringify(saved).includes('SECRET'));assert.ok(!('control' in saved.audioObservations[0]));assert.equal(importWorkspace(saved).audioObservations[0].listening,'heard');
  const old={...w};delete old.audioObservations;assert.deepEqual(validateWorkspace(old).audioObservations,[]);
  assert.deepEqual(normalizeAudioObservations({}),[]);
});
