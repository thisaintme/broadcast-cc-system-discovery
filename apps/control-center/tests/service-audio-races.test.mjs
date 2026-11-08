import test from 'node:test';
import assert from 'node:assert/strict';
import {ObsAdapter} from '../src/obs.ts';
import {inspectObs} from '../src/inspect.ts';
import {blankWorkspace} from '../src/model.ts';
import {importWorkspace} from '../src/workspace.ts';
import mock from './mock-service-audio.cjs';
async function setup(adapter,peer){
  await adapter.connect(peer.url,peer.password);
  const w=blankWorkspace();w.inventory=await inspectObs(adapter);
  w.bindings={...w.bindings,scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone',confirmed:true};
  w.captions={testCollection:peer.state.collection,speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A'},confirmed:true};
  w.services=[{id:'one',title:'Test',startsAt:'2026-10-04T09:00:00Z'}];w.speakers=['Speaker A'];
  await adapter.verifyServiceAudio(w);return w;
}
for(const failOldRead of [false,true])test(`delayed ${failOldRead?'failed':'successful'} poll cannot replace a newer mute readback`,async()=>{
  const peer=await mock.start(),adapter=new ObsAdapter();let release;
  try{
    const w=await setup(adapter,peer),original=adapter.read.bind(adapter);
    let entered,delay=true;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
    adapter.read=async(name,data)=>{
      const value=await original(name,data);
      if(delay&&name==='GetInputMute'){delay=false;entered();await gate;if(failOldRead)throw new Error('Delayed read failed');}
      return value;
    };
    const poll=adapter.refresh();await started;
    await adapter.offline(w,'intro','','one',()=>true,{inputName:'Microphone',goOnAir:false});
    assert.equal(adapter.serviceAudioState().muted,true);release();await poll;
    assert.equal(adapter.serviceAudioState().muted,true);assert.equal(adapter.serviceAudioState().phase,'confirmed');
  }finally{release?.();await adapter.disconnect();await peer.close();}
});
test('service mute read errors and expired observations are not displayed as confirmed',async()=>{
  const peer=await mock.start(),adapter=new ObsAdapter();
  try{
    await setup(adapter,peer);peer.state.failures.set('GetInputMute',{code:500});await adapter.refresh();
    assert.equal(adapter.serviceAudioState().muted,null);assert.equal(adapter.serviceAudioState().phase,'unknown');
    peer.state.failures.delete('GetInputMute');await adapter.refresh();assert.equal(adapter.serviceAudioState().phase,'confirmed');
    const realNow=Date.now;try{const later=realNow()+7000;Date.now=()=>later;assert.equal(adapter.serviceAudioState().phase,'unknown');}finally{Date.now=realNow;}
  }finally{await adapter.disconnect();await peer.close();}
});
test('discovery connection metadata still never establishes live device health',()=>{
  const w=importWorkspace({schemaVersion:2,obs:{scenes:[],inputs:[]},companion:{connections:[{label:'Synthetic device',moduleId:'generic',host:'device.local',enabled:true,status:'ok',health:'verified'}]}});
  assert.equal(w.connections[0].health,'unknown');
});
