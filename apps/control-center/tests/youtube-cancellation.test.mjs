import test from 'node:test';import assert from 'node:assert/strict';
import {YouTubeClient} from '../src/youtube-api.ts';import {YouTubeFailure} from '../src/youtube-model.ts';import {LiveObs} from '../src/live-obs.ts';

test('YouTube cancellation during token refresh prevents a later lifecycle mutation',async()=>{
  let resolveToken,started,allowed=true,calls=0;
  const waiting=new Promise(r=>{started=r;});
  const client=new YouTubeClient(async()=>{started();return await new Promise(r=>{resolveToken=r;});},async()=>{calls++;return new Response('{}');});
  const action=client.transition('EVENT_SYNTHETIC','live',()=>{if(!allowed)throw new YouTubeFailure('Cancelled before send');});
  await waiting;allowed=false;resolveToken('INVENTED_TOKEN');await assert.rejects(action,/Cancelled before send/);assert.equal(calls,0);
});
test('release during the final secret-bearing OBS read prevents a later StartStream',async()=>{
  const peer=new LiveObs(),expected={server:'rtmps://a.rtmps.youtube.com/live2',key:'INVENTED_KEY'},writes=[];
  let resolveRead,started,valid=true;const waiting=new Promise(r=>{started=r;});
  peer.request=async name=>{
    if(name==='GetStreamServiceSettings'){started();await new Promise(r=>{resolveRead=r;});return {streamServiceType:'rtmp_common',streamServiceSettings:expected};}
    writes.push(name);return {};
  };
  const action=peer.withYouTubeDestination(expected,()=>peer.change('StartStream'),()=>valid);
  await waiting;valid=false;resolveRead();await assert.rejects(action,/cancelled during destination verification/);assert.deepEqual(writes,[]);
});
