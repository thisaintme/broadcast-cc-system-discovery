import test from 'node:test';import assert from 'node:assert/strict';
import {assertReviewedMetadata,YouTubeController} from '../src/youtube-controller.ts';
const original={id:'SYNTHETIC_EVENT',channelId:'UC_SYNTHETIC',title:'Synthetic private event',privacy:'private',scheduledStartTime:'2030-01-06T10:00:00.000Z',streamId:'SYNTHETIC_INGEST',lifeCycle:'ready',description:'',autoStart:false,autoStop:false,monitor:false};
test('publication does not silently accept a private-to-public change after review',()=>{assert.throws(()=>assertReviewedMetadata(original,{...original,privacy:'public'}),/visibility changed/);});
test('reviewed identity, title and start time remain fixed while lifecycle/binding can advance',()=>{
  for(const change of [{id:'OTHER_EVENT'},{channelId:'UC_OTHER'},{title:'Other title'},{scheduledStartTime:'2030-01-07T10:00:00Z'}])assert.throws(()=>assertReviewedMetadata(original,{...original,...change}));
  assert.doesNotThrow(()=>assertReviewedMetadata(original,{...original,lifeCycle:'live',streamId:'SYNTHETIC_INGEST'}));
});
test('failed association loading blocks remote creation rather than assuming an empty store',async()=>{
  let reads=0;const client={async channel(){reads++;throw new Error('must not read');}},store={async load(){throw new Error('corrupt local state');},async save(){throw new Error('must not replace');}};
  const c=new YouTubeController(client,store,{},()=>null);await assert.rejects(c.load());await assert.rejects(c.review({kind:'start',serviceId:'service-one'}),/could not be loaded/);assert.equal(reads,0);
});
