// Synthetic data only. These staged tests must be executed with the consolidated release; no Google account or OBS device is contacted.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {parseDraft,parseCommand,parseState,blankYouTubeState,youtubeServer,watchUrl,YouTubeFailure} from '../src/youtube-model.ts';
import {YouTubeController} from '../src/youtube-controller.ts';import {YouTubeClient} from '../src/youtube-api.ts';
import {desktopClient,pkce,sameState,YouTubeOAuth} from '../src/youtube-oauth.ts';
import {YouTubeFileState,YouTubeSecretFile} from '../src/youtube-storage.ts';import {LiveObs} from '../src/live-obs.ts';
const clone=x=>JSON.parse(JSON.stringify(x));
const draft=()=>({serviceId:'service-one',channelId:'UC_SYNTHETIC',title:'20300106 - Gottesdienst',description:'Synthetic service only',startsAt:'2030-01-06T10:00:00.000Z',privacy:'private',madeForKids:false});
async function rig(){
  const calls=[],events=new Map(),channel={id:'UC_SYNTHETIC',title:'Synthetic channel'},ingest={id:'INGEST_ONE',channelId:channel.id,key:'INVENTED_INGEST_KEY',status:'ready',reusable:true,health:'good'};
  const destination={server:'rtmps://a.rtmps.youtube.com/live2',key:ingest.key};
  const obs={connected:true,streaming:false,reconnecting:false,program:'Main',muted:false,intro:'Intro',outro:'Outro',permissionsReady:true};
  let saved=blankYouTubeState(),ticket=0,failSave=false,unknownCreate=false,noIngest=false,cancelAfterStart=false,controller;
  const store={async load(){return clone(saved);},async save(s){if(failSave)throw new YouTubeFailure('Synthetic disk failure');saved=clone(s);}};
  const api={
    async channel(){return {...channel};},async broadcasts(){return [...events.values()].map(clone);},async broadcast(id){if(!events.has(id))throw new YouTubeFailure('Missing synthetic event');return clone(events.get(id));},
    async streams(){return [clone(ingest)];},async stream(id){assert.equal(id,ingest.id);return clone(ingest);},
    async create(d){calls.push('create');const b={id:'EVENT_ONE',channelId:channel.id,title:d.title,description:d.description,scheduledStartTime:d.startsAt,privacy:d.privacy,lifeCycle:'created',streamId:'',autoStart:false,autoStop:false,monitor:false};events.set(b.id,b);if(unknownCreate)throw new YouTubeFailure('Synthetic unconfirmed create');return clone(b);},
    async bind(id,streamId){calls.push('bind');const b=events.get(id);b.streamId=streamId;b.lifeCycle='ready';return clone(b);},
    async transition(id,state){calls.push('youtube:'+state);const b=events.get(id);b.lifeCycle=state;return clone(b);},
  };
  const host={
    services:()=>[{id:'service-one',title:'Synthetic service',startsAt:draft().startsAt}],selected:()=> 'service-one',state:()=>({...obs}),ticket:()=>ticket,cancelAutomation:()=>{ticket++;},destination:async()=>({...destination}),
    async startWithIntro(d){assert.deepEqual(d,destination);ticket++;calls.push('obs:start-intro-muted');obs.streaming=true;obs.program='Intro';obs.muted=true;if(!noIngest)ingest.status='active';if(cancelAfterStart)controller.cancel();},
    async stopTransmission(d){assert.deepEqual(d,destination);ticket++;calls.push('obs:stop');obs.streaming=false;ingest.status='inactive';},async log(){},
  };
  controller=new YouTubeController(api,store,host,()=>({...channel}),async()=>{});await controller.load();
  const run=async cmd=>controller.execute(await controller.review(cmd));
  return {api,host,controller,run,calls,events,channel,ingest,destination,obs,store,saved:()=>saved,failSave:()=>{failSave=true;},uncertainCreate:()=>{unknownCreate=true;},noIngest:()=>{noIngest=true;},cancelStart:()=>{cancelAfterStart=true;},externalChange:()=>{ticket++;}};
}
async function scheduled(){const r=await rig();await r.run({kind:'create',draft:draft()});return r;}

test('YouTube draft requires explicit visibility and audience, and rejects secret/config fields',()=>{
  assert.equal(parseDraft(draft(),0).privacy,'private');
  for(const extra of [{madeForKids:undefined},{privacy:'default'},{title:'x'.repeat(101)},{startsAt:'bad'}])assert.throws(()=>parseDraft({...draft(),...extra},0));
  assert.throws(()=>parseCommand({kind:'create',draft:{...draft(),streamKey:'private'}}));
  assert.throws(()=>parseCommand({kind:'start',serviceId:'service-one',url:'https://example.invalid'}));
});
test('YouTube endpoints and watch links cannot be replaced by renderer-supplied URLs',()=>{
  assert.equal(youtubeServer('rtmps://a.rtmps.youtube.com/live2'),'rtmps://a.rtmps.youtube.com/live2');
  for(const u of ['https://a.rtmp.youtube.com/live2','rtmp://youtube.com.evil.invalid/live2','rtmp://a.rtmp.youtube.com/live2?secret=x','auto','rtmp://user:pass@a.rtmp.youtube.com/live2'])assert.throws(()=>youtubeServer(u));
  assert.equal(watchUrl('TEST_ID'),'https://www.youtube.com/watch?v=TEST_ID');assert.throws(()=>watchUrl('../redirect'));
});
test('Desktop OAuth import rejects service accounts and ignores supplied endpoint URLs',()=>{
  assert.throws(()=>desktopClient({web:{client_id:'x.apps.googleusercontent.com'}}));
  assert.throws(()=>desktopClient({type:'service_account'}));
  assert.deepEqual(desktopClient({installed:{client_id:'test.apps.googleusercontent.com',client_secret:'invented',auth_uri:'https://evil.invalid',token_uri:'https://evil.invalid'}}),{clientId:'test.apps.googleusercontent.com',clientSecret:'invented'});
});
test('PKCE uses S256 and OAuth state comparisons reject unequal values or lengths',()=>{
  assert.equal(pkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk').challenge,'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(sameState('abc','abc'),true);assert.equal(sameState('abc','abd'),false);assert.equal(sameState('abc','ab'),false);
});
test('opening/loading a YouTube controller performs no remote or OBS writes',async()=>{const r=await rig();assert.deepEqual(r.calls,[]);assert.deepEqual(r.controller.links(),[]);});
test('create and bind persist a ready event without changing OBS',async()=>{
  const r=await rig(),before=clone(r.obs);const review=await r.controller.review({kind:'create',draft:draft()});assert.deepEqual(r.calls,[]);
  assert.ok(!review.detail.includes(r.ingest.key));await r.controller.execute(review);
  assert.deepEqual(r.calls,['create','bind']);assert.deepEqual(r.obs,before);assert.equal(r.saved().links[0].stage,'ready');assert.ok(!JSON.stringify(r.saved()).includes(r.ingest.key));
});
test('future scheduling remains independent of an active OBS service',async()=>{const r=await rig();r.obs.streaming=true;r.obs.program='Speaker';r.ingest.status='active';await r.run({kind:'create',draft:draft()});assert.equal(r.obs.program,'Speaker');assert.equal(r.obs.streaming,true);assert.deepEqual(r.calls,['create','bind']);});
test('an existing association blocks duplicate create, including after restart',async()=>{
  const r=await scheduled();await assert.rejects(r.run({kind:'create',draft:draft()}),/already/);
  const next=new YouTubeController(r.api,r.store,r.host,()=>r.channel,async()=>{});await next.load();await assert.rejects(next.review({kind:'create',draft:draft()}),/already/);assert.equal(r.calls.filter(x=>x==='create').length,1);
});
test('unconfirmed create retains a write-ahead marker and recovers by linking, not recreating',async()=>{
  const r=await rig();r.uncertainCreate();await assert.rejects(r.run({kind:'create',draft:draft()}));assert.equal(r.saved().links[0].stage,'creating');
  await assert.rejects(r.run({kind:'create',draft:draft()}),/earlier creation/);
  await r.run({kind:'link',serviceId:'service-one',broadcastId:'EVENT_ONE'});assert.equal(r.saved().links[0].stage,'ready');assert.equal(r.calls.filter(x=>x==='create').length,1);
});
test('failed write-ahead persistence prevents event creation',async()=>{const r=await rig();r.failSave();await assert.rejects(r.run({kind:'create',draft:draft()}));assert.deepEqual(r.calls,[]);});
test('wrong channel or current OBS key cannot create or start an event',async()=>{
  const r=await rig();await assert.rejects(r.run({kind:'create',draft:{...draft(),channelId:'UC_OTHER'}}));
  r.destination.key='WRONG_KEY';await assert.rejects(r.run({kind:'create',draft:draft()}),/does not uniquely match/);assert.deepEqual(r.calls,[]);
});
test('start orders muted Intro and OBS transmission before YouTube publication; Main is separate',async()=>{
  const r=await scheduled();r.calls.length=0;await r.run({kind:'start',serviceId:'service-one'});
  assert.deepEqual(r.calls,['obs:start-intro-muted','youtube:live']);assert.equal(r.obs.program,'Intro');assert.equal(r.obs.muted,true);assert.equal(r.events.get('EVENT_ONE').lifeCycle,'live');
});
test('an already-running OBS encoder cannot be restarted by YouTube Start',async()=>{const r=await scheduled();r.obs.streaming=true;r.ingest.status='active';r.calls.length=0;await assert.rejects(r.run({kind:'start',serviceId:'service-one'}),/already transmitting/);assert.deepEqual(r.calls,[]);});
test('missing ingest confirmation leaves OBS running and supports explicit publication recovery',async()=>{
  const r=await scheduled();r.noIngest();r.calls.length=0;await assert.rejects(r.run({kind:'start',serviceId:'service-one'}),/ingest was not confirmed/);
  assert.deepEqual(r.calls,['obs:start-intro-muted']);assert.equal(r.obs.streaming,true);r.ingest.status='active';await r.run({kind:'publish-intro',serviceId:'service-one'});
  assert.deepEqual(r.calls,['obs:start-intro-muted','youtube:live']);
});
test('publication recovery refuses an unmuted or non-Intro scene',async()=>{
  const r=await scheduled();r.obs.streaming=true;r.ingest.status='active';r.obs.muted=false;r.calls.length=0;
  await assert.rejects(r.run({kind:'publish-intro',serviceId:'service-one'}),/Recovery requires/);assert.deepEqual(r.calls,[]);
});
test('cancel after OBS has started does not publish, stop or roll back',async()=>{
  const r=await scheduled();r.cancelStart();r.calls.length=0;await assert.rejects(r.run({kind:'start',serviceId:'service-one'}),/cancelled/);assert.deepEqual(r.calls,['obs:start-intro-muted']);assert.equal(r.obs.streaming,true);
});
test('changing visibility during confirmation invalidates approval',async()=>{
  const r=await scheduled(),review=await r.controller.review({kind:'start',serviceId:'service-one'});r.events.get('EVENT_ONE').privacy='public';r.calls.length=0;await assert.rejects(r.controller.execute(review),/changed during confirmation/);assert.deepEqual(r.calls,[]);
});
test('another live broadcast using the same key blocks coordinated start/stop',async()=>{
  const r=await scheduled();r.events.set('EVENT_OTHER',{...r.events.get('EVENT_ONE'),id:'EVENT_OTHER',lifeCycle:'live'});r.calls.length=0;
  await assert.rejects(r.run({kind:'start',serviceId:'service-one'}),/Another YouTube broadcast/);assert.deepEqual(r.calls,[]);
});
test('auto-start or auto-stop events are not silently adopted',async()=>{const r=await scheduled();r.events.get('EVENT_ONE').autoStart=true;r.calls.length=0;await assert.rejects(r.run({kind:'start',serviceId:'service-one'}),/automatic start/);assert.deepEqual(r.calls,[]);});
test('end verifies Outro and completes YouTube before stopping OBS',async()=>{
  const r=await scheduled();await r.run({kind:'start',serviceId:'service-one'});r.calls.length=0;
  await assert.rejects(r.run({kind:'end',serviceId:'service-one'}),/Show Outro/);assert.deepEqual(r.calls,[]);
  r.obs.program='Outro';await r.run({kind:'end',serviceId:'service-one'});assert.deepEqual(r.calls,['youtube:complete','obs:stop']);assert.equal(r.obs.program,'Outro');assert.equal(r.obs.muted,true);
});
test('a completed YouTube event can finish a previously interrupted OBS stop without retransitioning',async()=>{
  const r=await scheduled();r.events.get('EVENT_ONE').lifeCycle='complete';r.obs.streaming=true;r.obs.program='Outro';r.obs.muted=true;r.ingest.status='active';r.calls.length=0;
  await r.run({kind:'end',serviceId:'service-one'});assert.deepEqual(r.calls,['obs:stop']);
});
test('YouTube transport sanitizes errors and never retries a failed mutation',async()=>{
  let count=0;const client=new YouTubeClient(async()=> 'INVENTED_TOKEN',async()=>{count++;throw new Error('INVENTED_TOKEN private upstream');});
  await assert.rejects(client.create(draft()),e=>e instanceof YouTubeFailure&&!e.message.includes('INVENTED_TOKEN'));assert.equal(count,1);
});
test('OAuth refresh uses fixed endpoint and form body, not URLs from imported config',async()=>{
  const calls=[],vault={async load(){return JSON.stringify({clientId:'test.apps.googleusercontent.com',clientSecret:'invented-client',refreshToken:'INVENTED_REFRESH',channel:{id:'UC_SYNTHETIC',title:'Synthetic'}});},async save(){},async clear(){}};
  const auth=new YouTubeOAuth(vault,async()=>{},async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({access_token:'INVENTED_ACCESS',expires_in:3600,token_type:'Bearer'}),{status:200});});
  await auth.load();assert.equal(await auth.token(),'INVENTED_ACCESS');assert.equal(await auth.token(),'INVENTED_ACCESS');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://oauth2.googleapis.com/token');assert.equal(calls[0].options.body.get('refresh_token'),'INVENTED_REFRESH');
});
test('association persistence rejects injected credentials and encrypted store refuses plaintext fallback',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'bcc-youtube-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const state=new YouTubeFileState(path.join(directory,'broadcasts.json')),r=await scheduled();await state.save(r.saved());assert.deepEqual(await state.load(),r.saved());
  const invalid=clone(r.saved());invalid.links[0].token='INVENTED_SECRET';assert.throws(()=>parseState(invalid));assert.ok(!(await readFile(path.join(directory,'broadcasts.json'),'utf8')).includes('INVENTED_SECRET'));
  const secretFile=path.join(directory,'credentials.enc'),secret=new YouTubeSecretFile(secretFile,{available:()=>false,encrypt:()=>{throw new Error('must not encrypt');},decrypt:()=>''});
  await assert.rejects(secret.save('INVENTED_REFRESH'),/Secure credential storage/);await assert.rejects(access(secretFile));
});
test('secret-bearing OBS read is not exposed through the generic read allowlist',async()=>{const peer=new LiveObs();await assert.rejects(peer.read('GetStreamServiceSettings'),/Unsupported read/);});
test('verified OBS start guard detects a key change immediately before transmission',async()=>{
  const peer=new LiveObs(),writes=[],expected={server:'rtmps://a.rtmps.youtube.com/live2',key:'EXPECTED_KEY'};
  peer.request=async(name)=>{if(name==='GetStreamServiceSettings')return {streamServiceType:'rtmp_common',streamServiceSettings:{server:expected.server,key:'OTHER_KEY'}};writes.push(name);return {};};
  await assert.rejects(peer.withYouTubeDestination(expected,()=>peer.change('StartStream')),/destination changed/);assert.deepEqual(writes,[]);
});
