import test from 'node:test';
import assert from 'node:assert/strict';
import mockObs from './mock-obs.cjs';
import OBSWebSocket from 'obs-websocket-js/json';
import {ObsAdapter} from '../src/obs.ts';
import {readTransport,inspectObs,assertPreviewSafe} from '../src/inspect.ts';
import {obsErrorCode,connectionFailure,requestFailure} from '../src/obs-errors.ts';

test('regression: alpha.1 all-or-nothing status check rejects after successful authentication',async()=>{
  const peer=await mockObs(),client=new OBSWebSocket();
  try {
    await client.connect(peer.url,peer.password,{rpcVersion:1});
    assert.equal(peer.state.identified,1);
    await assert.rejects(Promise.all(['GetStreamStatus','GetRecordStatus','GetVirtualCamStatus','GetReplayBufferStatus','GetStudioModeEnabled','GetSceneList','GetSceneCollectionList'].map(n=>client.call(n))),e=>e.code===604);
  } finally {await client.disconnect();await peer.close();}
});
test('authenticated adapter stays connected and inspects nested groups with unavailable optional outputs',async()=>{
  const peer=await mockObs(),adapter=new ObsAdapter();
  try {
    await adapter.connect(peer.url,peer.password);
    const state=adapter.state();
    assert.equal(state.connected,true);assert.equal(state.streaming,false);assert.equal(state.recording,false);
    assert.equal(state.replayBuffer,null);assert.equal(state.virtualCamera,null);
    assert.ok(state.statusWarnings.some(w=>w.includes('GetReplayBufferStatus') && w.includes('604')));
    const inventory=await inspectObs(adapter);
    assert.equal(inventory.origin,'live');assert.equal(inventory.scenes.length,5);
    assert.ok(inventory.nodes.some(n=>n.type==='group' && n.items[0]?.source==='Synthetic text'));
    assert.throws(()=>assertPreviewSafe(state,inventory.collection),/unknown/);
    await assert.rejects(adapter.preview('Main',inventory.collection,()=>true),/unknown/);
    assert.ok(peer.state.requests.every(n=>n.startsWith('Get')));
    assert.ok(!JSON.stringify({inventory,state}).includes(peer.password));
    assert.ok(!JSON.stringify(state).includes('RAW_DIAGNOSTIC_MUST_NOT_LEAK'));
  } finally {await adapter.disconnect();await peer.close();}
});
test('wrong password is distinguished from a status-check error and a subsequent retry succeeds',async()=>{
  const peer=await mockObs(),adapter=new ObsAdapter();
  try {
    await assert.rejects(adapter.connect(peer.url,'wrong'),e=>e.code===4009 && /authentication/.test(e.message));
    assert.equal(adapter.state().connected,false);assert.equal(peer.state.requests.length,0);
    await adapter.connect(peer.url,peer.password);assert.equal(adapter.state().connected,true);
    assert.equal(peer.state.identified,1);
  } finally {await adapter.disconnect();await peer.close();}
});
test('inspection failure is named, not mislabeled as a connection/password failure',async()=>{
  const peer=await mockObs(),adapter=new ObsAdapter();
  try {
    await adapter.connect(peer.url,peer.password);
    peer.state.failures.set('GetInputList',{code:702,comment:'RAW_DIAGNOSTIC_MUST_NOT_LEAK'});
    await assert.rejects(inspectObs(adapter),e=>e.code===702 && e.message.includes('GetInputList') && !e.message.includes('RAW_DIAGNOSTIC_MUST_NOT_LEAK'));
    assert.equal(adapter.state().connected,true);
  } finally {await adapter.disconnect();await peer.close();}
});
test('refresh can recover optional status without reauthenticating or issuing controls',async()=>{
  const peer=await mockObs(),adapter=new ObsAdapter();
  try {
    await adapter.connect(peer.url,peer.password);peer.state.unavailable.clear();await adapter.refresh();
    const state=adapter.state();assert.equal(state.replayBuffer,false);assert.equal(state.virtualCamera,false);
    assert.deepEqual(state.statusWarnings,[]);assert.equal(peer.state.identified,1);
    assertPreviewSafe(state,'Synthetic collection');assert.ok(peer.state.requests.every(n=>n.startsWith('Get')));
  } finally {await adapter.disconnect();await peer.close();}
});
test('all failed capability checks remain unknown, not false',async()=>{
  const reader={read:async name=>{if(name==='GetVersion')return {};throw Object.assign(new Error('RAW_DIAGNOSTIC_MUST_NOT_LEAK'),{code:604});}};
  const state=await readTransport(reader);
  assert.equal(state.connected,true);
  for(const key of ['streaming','recording','virtualCamera','replayBuffer','studio'])assert.equal(state[key],null);
  assert.equal(state.statusWarnings.length,7);assert.ok(!JSON.stringify(state).includes('RAW_DIAGNOSTIC_MUST_NOT_LEAK'));
  assert.throws(()=>assertPreviewSafe(state,'Synthetic collection'));
});
test('malformed success flags are never coerced to off',async()=>{
  const reader={read:async name=>name==='GetSceneCollectionList'?{currentSceneCollectionName:'Synthetic collection'}:{outputActive:0,studioModeEnabled:'true'}};
  const state=await readTransport(reader);
  assert.equal(state.streaming,null);assert.equal(state.studio,null);
  assert.throws(()=>assertPreviewSafe(state,'Synthetic collection'),/unknown/);
});
test('liveness failure is not swallowed by optional request handling',async()=>{
  const reader={read:async()=>{throw Object.assign(new Error('timeout'),{code:'BCC_TIMEOUT'});}};
  await assert.rejects(readTransport(reader),e=>e.code==='BCC_TIMEOUT');
});
test('safe diagnostics preserve only allowlisted codes and never upstream messages',()=>{
  const secret='RAW_DIAGNOSTIC_MUST_NOT_LEAK';
  for(const error of [{code:4009,message:secret},{code:604,message:secret},{code:'ECONNREFUSED',message:secret},{code:secret,message:secret},{cause:{code:'ETIMEDOUT',message:secret}}]){
    assert.ok(!connectionFailure(error,'ws://127.0.0.1:4455').message.includes(secret));
    assert.ok(!requestFailure(error,'GetInputList').message.includes(secret));
  }
  assert.equal(obsErrorCode({code:secret}),undefined);
  assert.equal(obsErrorCode({errors:[{code:'ECONNREFUSED'}]}),'ECONNREFUSED');
});
