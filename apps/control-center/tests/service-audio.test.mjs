import test from 'node:test';
import assert from 'node:assert/strict';
import {blankWorkspace} from '../src/model.ts';
import {validateWorkspace} from '../src/workspace.ts';
import {inspectObs,readTransport} from '../src/inspect.ts';
import {executeWithServiceAudio,serviceMuteTarget} from '../src/service-audio.ts';
import {Rehearsal} from '../src/rehearsal.ts';
import {ObsAdapter} from '../src/obs.ts';
import mock from './mock-service-audio.cjs';

function workspace(){
  const w=blankWorkspace();
  w.inventory={origin:'live',collection:'BCC TEST - synthetic',scenes:['Intro','Main','Speaker','Bible','Outro'],inputs:[{name:'Microphone',kind:'coreaudio_input_capture'}],nodes:[],audio:[],warnings:[],capturedAt:''};
  w.bindings={...w.bindings,scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone',confirmed:true};
  w.captions={testCollection:'BCC TEST - synthetic',speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'},confirmed:true};
  w.services=[{id:'one',title:'Test',startsAt:'2026-10-04T09:00:00Z'},{id:'two',title:'Next',startsAt:'2026-10-08T16:00:00Z'}];w.speakers=['Speaker A','Speaker B'];return w;
}
function rig(){
  const f=mock.fixture(),w=workspace(),reports=[];let valid=true;
  const port={read:async(n,d)=>f.request(n,d),change:async(n,d)=>f.request(n,d),mute:async(inputName,inputMuted)=>f.request('SetInputMute',{inputName,inputMuted})};
  const run=(role,value='',goOnAir=false,enabled=true)=>executeWithServiceAudio(port,w,role,value,'one',()=>valid,enabled?{inputName:w.bindings.audioInput,goOnAir}:undefined,s=>reports.push(s));
  return {...f,w,port,reports,run,cancel:()=>{valid=false;}};
}
const muteWrites=s=>s.writes.filter(x=>x.name==='SetInputMute');
const waitFor=async predicate=>{for(let i=0;i<400;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Test condition timed out');};

test('mute policy distinguishes the initial On Air action from every kind of Main return',()=>{
  const ordinary={inputName:'Microphone',goOnAir:false};
  for(const role of ['prepare','intro','outro'])assert.equal(serviceMuteTarget(role,ordinary),true);
  for(const role of ['main','speaker','bible'])assert.equal(serviceMuteTarget(role,ordinary),null);
  assert.equal(serviceMuteTarget('main',{...ordinary,goOnAir:true}),false);
  assert.equal(serviceMuteTarget('intro'),null);
  assert.throws(()=>serviceMuteTarget('speaker',{...ordinary,goOnAir:true}));
});
test('Prepare and Intro mute before edits; Main is confirmed before unmute; Outro mutes first',async()=>{
  const x=rig();await x.run('prepare');assert.equal(x.state.writes[0].name,'SetInputMute');assert.equal(x.state.mutes.Microphone,true);
  x.state.writes=[];await x.run('intro');assert.equal(x.state.writes[0].name,'SetInputMute');assert.equal(x.state.program,'Intro');
  x.state.writes=[];await x.run('main','',true);
  assert.deepEqual(x.state.writes.map(x=>x.name),['SetCurrentProgramScene','SetInputMute']);assert.equal(x.state.mutes.Microphone,false);
  const calls=x.state.calls,lastMute=calls.map(c=>c.name).lastIndexOf('SetInputMute');assert.equal(calls[lastMute+1].name,'GetInputMute');
  await x.run('speaker','Speaker B');await x.run('bible','Test reference');
  x.state.writes=[];await x.run('outro');assert.equal(x.state.writes[0].name,'SetInputMute');assert.equal(x.state.mutes.Microphone,true);
  assert.equal(x.state.mutes['Other input'],false);assert.equal(x.state.settings['Reference text'].font.size,28);
  assert.equal(x.state.nodes.Reference.find(i=>i.sourceName==='Microphone').sceneItemEnabled,true);
  assert.equal(x.reports.at(-1).phase,'confirmed');
});
test('without the optional intent, the entire caption workflow issues no mute writes',async()=>{
  const x=rig();for(const [role,value]of [['prepare',''],['intro',''],['main',''],['speaker','Speaker B'],['bible','Test'],['outro','']])await x.run(role,value,false,false);
  assert.deepEqual(muteWrites(x.state),[]);assert.equal(x.state.mutes.Microphone,false);
});
test('caption actions and manual Main returns preserve an existing manual mute',async()=>{
  const x=rig();x.state.mutes.Microphone=true;
  await x.run('speaker','Speaker B');await x.run('bible','Test');await x.run('main');
  assert.deepEqual(muteWrites(x.state),[]);assert.equal(x.state.mutes.Microphone,true);
});
test('active, unknown or production outputs refuse all audio writes',async()=>{
  for(const [key,value]of [['streaming',true],['streaming',null],['recording',null],['collection','Production']]){
    const x=rig();x.state[key]=value;await assert.rejects(x.run('intro'));assert.deepEqual(x.state.writes,[]);
  }
});
test('missing, mismatched and malformed service input states never guess a fallback',async()=>{
  let x=rig();x.w.bindings.audioInput='Missing';await assert.rejects(x.run('intro'));assert.deepEqual(x.state.writes,[]);
  x=rig();await assert.rejects(executeWithServiceAudio(x.port,x.w,'intro','','one',()=>true,{inputName:'Other input',goOnAir:false}));assert.deepEqual(x.state.writes,[]);
  for(const inputMuted of [null,0,'false']){x=rig();x.state.muteReply={inputMuted};await assert.rejects(x.run('intro'));assert.deepEqual(x.state.writes,[]);}
});
test('failed mute and failed readback prevent advancing to Intro and mark unknown',async()=>{
  let x=rig();x.state.failures.set('SetInputMute',{code:500});await assert.rejects(x.run('intro'));assert.equal(x.state.program,'Main');assert.equal(x.reports.at(-1).phase,'unknown');
  x=rig();x.state.ignoreMuteWrite=true;await assert.rejects(x.run('intro'),/did not confirm/);assert.equal(muteWrites(x.state).length,1);assert.equal(x.state.program,'Main');assert.equal(x.reports.at(-1).muted,null);
});
test('failed Main transition never unmutes the service input',async()=>{
  const x=rig();x.state.mutes.Microphone=true;x.state.program='Intro';x.state.failures.set('SetCurrentProgramScene',{code:500});
  await assert.rejects(x.run('main','',true));assert.deepEqual(muteWrites(x.state),[]);assert.equal(x.state.mutes.Microphone,true);
});
test('cancellation after a completed mute does not compensate or issue the next scene write',async()=>{
  const x=rig();x.state.afterWrite=name=>{if(name==='SetInputMute')x.cancel();};
  await assert.rejects(x.run('intro'),/interrupted|cancelled/);assert.equal(x.state.writes.length,1);assert.equal(x.state.mutes.Microphone,true);assert.equal(x.reports.at(-1).phase,'unknown');
});
test('cancel or manual mute after Main selection prevents subsequent unmute',async()=>{
  for(const cancel of [true,false]){
    const x=rig();x.state.program='Intro';x.state.mutes.Microphone=false;
    x.state.afterWrite=name=>{if(name==='SetCurrentProgramScene'){if(cancel)x.cancel();else x.state.mutes.Microphone=true;}};
    await assert.rejects(x.run('main','',true));assert.deepEqual(muteWrites(x.state),[]);
    if(!cancel)assert.equal(x.state.mutes.Microphone,true);
  }
});
test('new output activation between reads is caught before the mute write',async()=>{
  const x=rig();let muteReads=0;x.state.before=name=>{if(name==='GetInputMute'&&++muteReads===2)x.state.streaming=true;};
  await assert.rejects(x.run('intro'),/output/);assert.deepEqual(x.state.writes,[]);
});
test('state machine authorizes unmute only on Intro to Main and never in a timed return',async()=>{
  const x=rig(),scheduled=[],intents=[];
  const transport=await readTransport(x.port);
  const port={...x.port,state:()=>transport,preview:async()=>{},offline:async(w,role,value,id,valid,intent)=>{intents.push({role,intent});await executeWithServiceAudio(x.port,w,role,value,id,valid,intent);}};
  const clock={now:()=>1000,set:(fn,ms)=>{const h={fn,ms};scheduled.push(h);return h;},clear:()=>{}};
  const r=new Rehearsal(()=>x.w,port,()=>{},clock);
  await r.setMode('offline-program','Microphone');await r.command('prepare');await r.command('intro');await r.command('main');
  x.state.mutes.Microphone=true;await r.command('speaker','Speaker B');scheduled.at(-1).fn();await waitFor(()=>!r.runtime.busy&&r.runtime.phase==='main');
  assert.equal(x.state.mutes.Microphone,true);assert.equal(intents.at(-1).intent.goOnAir,false);
  await r.command('bible','Test');await r.command('main');assert.equal(x.state.mutes.Microphone,true);
  assert.equal(intents.filter(i=>i.intent?.goOnAir).length,1);
  const count=x.state.writes.length;await r.command('reset');assert.equal(x.state.writes.length,count);assert.equal(r.runtime.serviceAudioEnabled,false);
});
test('new sessions and saved/imported workspaces never retain audio authorization',()=>{
  const w=workspace();w.serviceAudioEnabled=true;w.serviceAudio={inputName:'Microphone',enabled:true};
  const imported=validateWorkspace(w,true);assert.equal('serviceAudio' in imported,false);assert.equal('serviceAudioEnabled' in imported,false);
  const r=new Rehearsal(()=>imported,{state:()=>({}),read:async()=>({}),preview:async()=>{}},()=>{});assert.equal(r.runtime.serviceAudioEnabled,false);
});
test('authenticated adapter verifies mute, accepts manual mutes during captions and reconnects without replay',async()=>{
  const peer=await mock.start(),adapter=new ObsAdapter();
  try{
    await adapter.connect(peer.url,peer.password);const w=workspace();w.inventory=await inspectObs(adapter);await adapter.verifyServiceAudio(w);
    const r=new Rehearsal(()=>w,adapter,()=>{});adapter.onUnsafe=reason=>r.interrupt(reason);
    await r.setMode('offline-program','Microphone');await r.command('prepare');await r.command('intro');await r.command('main');
    assert.equal(adapter.serviceAudioState().muted,false);assert.equal(adapter.serviceAudioState().phase,'confirmed');
    peer.state.mutes.Microphone=true;peer.emit('InputMuteStateChanged',{inputName:'Microphone',inputMuted:true});await waitFor(()=>adapter.serviceAudioState().muted===true);
    await r.command('speaker','Speaker B');await r.command('main');assert.equal(peer.state.mutes.Microphone,true);assert.equal(r.runtime.mode,'offline-program');
    const count=muteWrites(peer.state).length;await r.command('reset');await adapter.disconnect();assert.equal(adapter.serviceAudioState().muted,null);
    await adapter.connect(peer.url,peer.password);assert.equal(muteWrites(peer.state).length,count);assert.equal(r.runtime.serviceAudioEnabled,false);
    assert.ok(!JSON.stringify(adapter.serviceAudioState()).includes(peer.password));
  }finally{await adapter.disconnect();await peer.close();}
});
test('authenticated setter errors are named and sanitized; no false confirmation',async()=>{
  const peer=await mock.start(),adapter=new ObsAdapter();
  try{
    await adapter.connect(peer.url,peer.password);const w=workspace();w.inventory=await inspectObs(adapter);
    peer.state.failures.set('SetInputMute',{code:500});
    await assert.rejects(adapter.offline(w,'intro','','one',()=>true,{inputName:'Microphone',goOnAir:false}),e=>e.message.includes('SetInputMute')&&!e.message.includes('PRIVATE_DIAGNOSTIC'));
    assert.equal(adapter.serviceAudioState().muted,null);assert.equal(adapter.serviceAudioState().phase,'unknown');
  }finally{await adapter.disconnect();await peer.close();}
});
