import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioMonitor} from '../src/audio-monitor.ts';
import {normalizeAudioObservations} from '../src/audio-model.ts';
const hostile={toString:null};
function peer(){return {subscribe:async()=>{},read:async name=>name==='GetInputList'?{inputs:[{inputName:'Test mic',inputKind:'audio_input'}]}:name==='GetSceneCollectionList'?{currentSceneCollectionName:'Test'}:name==='GetSceneList'?{currentProgramSceneName:'Main'}:name==='GetInputMute'?{inputMuted:true}:name==='GetInputAudioMonitorType'?{monitorType:hostile}:{}};}
test('non-string enums cannot trigger object coercion or crash the meter event handler',async()=>{
  const monitor=new AudioMonitor();monitor.attach(peer());
  try{await monitor.start();assert.doesNotThrow(()=>monitor.event('InputAudioMonitorTypeChanged',{inputName:'Test mic',monitorType:hostile}));assert.equal(monitor.snapshot().rows[0].monitor.value,null);
    const notes=normalizeAudioObservations([{collection:'Test',inputName:'Test mic',listening:hostile}]);assert.equal(notes[0].listening,'not-tested');
  }finally{await monitor.stop();}
});
test('subscription failures never echo upstream messages even with a misleading prefix',async()=>{
  const monitor=new AudioMonitor(),session=peer();session.subscribe=async()=>{throw new Error('OBS audio SECRET_RAW_PAYLOAD');};monitor.attach(session);
  await assert.rejects(monitor.start(),error=>!error.message.includes('SECRET_RAW_PAYLOAD'));assert.ok(!JSON.stringify(monitor.snapshot()).includes('SECRET_RAW_PAYLOAD'));monitor.detach();
});
