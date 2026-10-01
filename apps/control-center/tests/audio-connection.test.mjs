import test from 'node:test';
import assert from 'node:assert/strict';
import {EventSubscription} from 'obs-websocket-js/json';
import {ObsAdapter} from '../src/obs.ts';
import mockAudio from './mock-audio.cjs';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await wait(30);}throw new Error('Synthetic audio condition timed out');}
test('authenticated observer subscribes explicitly, receives stereo meters and sends no controls',async()=>{
  const peer=await mockAudio(),adapter=new ObsAdapter();
  try{
    await adapter.connect(peer.url,peer.password);assert.equal(peer.state.identified,1);assert.equal(adapter.audio.snapshot().running,false);
    await adapter.audio.start();await until(()=>adapter.audio.snapshot().rows[0]?.meterState==='live');
    const row=adapter.audio.snapshot().rows[0];assert.equal(row.muted.value,true);assert.equal(row.channels.length,2);assert.equal(row.channels[0].outputPeakDb,-100);assert.equal(row.active.value,true);
    assert.equal(adapter.audio.snapshot().rows[1].meterState,'not-reporting');
    const mask=peer.state.subscriptions[0];assert.ok(mask&EventSubscription.InputVolumeMeters);assert.equal(mask&EventSubscription.All,EventSubscription.All);
    peer.state.muted=false;peer.broadcast('InputMuteStateChanged',{inputName:row.name,inputMuted:false});
    await until(()=>adapter.audio.snapshot().rows[0].muted.value===false);
    assert.ok(!JSON.stringify(adapter.audio.snapshot()).includes(peer.password));
    await adapter.audio.stop();assert.equal(peer.state.subscriptions.at(-1),EventSubscription.All);assert.equal(adapter.audio.snapshot().running,false);
    assert.equal(adapter.state().connected,true);assert.equal(peer.state.identified,1);assert.ok(peer.state.requests.every(r=>r.name.startsWith('Get')));
  }finally{await adapter.disconnect();await peer.close();}
});
test('connection loss invalidates audio independently of the prior observed levels',async()=>{
  const peer=await mockAudio(),adapter=new ObsAdapter();
  try{await adapter.connect(peer.url,peer.password);await adapter.audio.start();await until(()=>adapter.audio.snapshot().rows[0]?.meterState==='live');peer.disconnect();await until(()=>!adapter.audio.snapshot().connected);assert.equal(adapter.audio.snapshot().running,false);assert.equal(adapter.audio.snapshot().rows.length,0);}
  finally{await adapter.disconnect();await peer.close();}
});
