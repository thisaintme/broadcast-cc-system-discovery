import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {blankWorkspace,disconnected} from '../src/model.ts';
import {importWorkspace,validateWorkspace,localEndpoint,candidates,selectService} from '../src/workspace.ts';
import {inspectObs,assertPreviewSafe} from '../src/inspect.ts';
import {parseCompanionExport} from '../src/companion.ts';
import {Rehearsal} from '../src/rehearsal.ts';
import {saveWorkspace,loadWorkspace} from '../src/storage.ts';

function ready(){
  const w=blankWorkspace();
  w.inventory={origin:'live',collection:'Test collection',scenes:['Intro','Main','Speaker','Bible','Outro'],inputs:[],nodes:[],audio:[],warnings:[],capturedAt:''};
  w.bindings.scenes={intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'};w.bindings.confirmed=true;
  w.services=[{id:'service-a',title:'Test service',startsAt:'2026-09-20T09:00:00.000Z'}];
  return w;
}
function safe(){return {...disconnected(),connected:true,streaming:false,recording:false,virtualCamera:false,replayBuffer:false,studio:true,collection:'Test collection'};}
function rig(){
  const w=ready(), writes=[], scheduled=[];
  let transport=safe();
  const port={state:()=>transport,read:async()=>({}),preview:async(scene,collection,valid)=>{
    assertPreviewSafe(transport,collection);if(!valid())throw new Error('Cancelled');writes.push(scene);
  }};
  const time={now:()=>1000,set:(fn,ms)=>{const h={fn,ms,cancelled:false};scheduled.push(h);return h;},clear:h=>{h.cancelled=true;}};
  const r=new Rehearsal(()=>w,port,()=>{},time);
  return {w,r,writes,scheduled,setTransport:x=>{transport=x;}};
}
async function main(r){await r.command('prepare');await r.command('intro');await r.command('main');}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('localhost URL normalization accepts an export path without duplicating it',()=>{
  assert.equal(localEndpoint('http://127.0.0.1:8000/int/export/full?format=json','companion'),'http://127.0.0.1:8000');
  assert.equal(localEndpoint('http://localhost:8000/api/connections','companion'),'http://localhost:8000');
  assert.equal(localEndpoint('ws://127.0.0.1:4455','obs'),'ws://127.0.0.1:4455');
});
test('URL validation rejects credentials, remote hosts, arbitrary paths and query secrets',()=>{
  for(const u of ['http://user:secret@localhost:8000','http://example.com','file:///etc/passwd','http://localhost:8000/import','http://localhost:8000/?token=secret'])
    assert.throws(()=>localEndpoint(u,'companion'));
});
test('discovery import projects fields and never confirms or executes mappings',()=>{
  const raw={schemaVersion:2,obs:{scenes:['Intro','Main'],inputs:[],sceneDetails:[],currentSceneCollection:'Test',password:'SENSITIVE'},companion:{connections:[{id:'x',label:'Camera',moduleId:'generic',host:'test.local',enabled:true,config:{pass:'SENSITIVE'},secrets:{token:'SENSITIVE'}}]}};
  const w=importWorkspace(raw);
  assert.equal(w.bindings.scenes.main,'Main');assert.equal(w.bindings.confirmed,false);
  assert.equal(w.connections[0].health,'unknown');assert.ok(!JSON.stringify(w).includes('SENSITIVE'));
});
test('draft imports are explicitly unverified and contain no embedded observed configuration',()=>{
  const w=importWorkspace({format:'broadcast-cc-site-profile-draft',observations:{obs:{sceneNames:['Main'],sceneCollection:'Test'},companion:{connections:[]}},proposalsNotYetApplied:{switcherProgramFeedbackVerified:true},secret:'SENSITIVE'});
  assert.equal(w.inventory.origin,'draft');assert.equal(w.bindings.confirmed,false);assert.ok(!JSON.stringify(w).includes('SENSITIVE'));
});
test('raw Companion configuration is not accepted as an executable site profile',()=>{
  assert.throws(()=>importWorkspace({type:'full',companionBuild:'4.2',instances:{}}));
});
test('full Companion parser allowlists metadata and drops free-form actions and secrets',()=>{
  const parsed=parseCompanionExport(JSON.stringify({type:'full',companionBuild:'4.2.0',instances:{x:{label:'Camera',instance_type:'generic',config:{host:'camera.local',password:'SENSITIVE',url:'http://secret@host'},status:{token:'SENSITIVE'},enabled:true}},pages:{1:{actions:{script:'SENSITIVE'}}}}));
  assert.equal(parsed.connections.length,1);assert.equal(parsed.connections[0].host,'camera.local');
  assert.ok(!JSON.stringify(parsed).includes('SENSITIVE'));assert.equal(parsed.connections[0].health,'unknown');
});
test('malformed Companion response errors never echo body or parse-error fragments',()=>{
  for(const value of ['<html>SENSITIVE</html>','{"password":"SENSITIVE"','{}'])
    assert.throws(()=>parseCompanionExport(value),e=>!e.message.includes('SENSITIVE'));
  assert.throws(()=>parseCompanionExport(' '.repeat(8*1024*1024+1)));
});
test('saved workspace imports reset confirmation and retain validated local schedule',()=>{
  const w=ready();w.secret='SENSITIVE';w.bindings.password='SENSITIVE';
  const result=importWorkspace(w);assert.equal(result.bindings.confirmed,false);assert.equal(result.services.length,1);
  assert.ok(!JSON.stringify(result).includes('SENSITIVE'));
});
test('schedule rejects duplicate IDs and invalid dates',()=>{
  const w=ready();w.services.push({...w.services[0]});assert.throws(()=>validateWorkspace(w));
  w.services=[{id:'x',title:'Test',startsAt:'not-a-date'}];assert.throws(()=>validateWorkspace(w));
});
test('default service selection uses Europe/Berlin dates, then next future service',()=>{
  const w=ready();w.services=[{id:'a',title:'Early',startsAt:'2026-09-19T22:30:00.000Z'},{id:'b',title:'Next',startsAt:'2026-09-21T09:00:00.000Z'}];
  assert.equal(selectService(w,new Date('2026-09-20T07:00:00Z')),'a');
  assert.equal(selectService(w,new Date('2026-09-21T07:00:00Z')),'b');
});
test('simulation performs the service sequence without any device writes',async()=>{
  const {r,writes,scheduled}=rig();await main(r);await r.command('speaker','Guest speaker');
  assert.equal(r.runtime.overlay,'Guest speaker');assert.equal(scheduled[0].ms,10000);
  scheduled[0].fn();await flush();assert.equal(r.runtime.phase,'main');assert.deepEqual(writes,[]);
});
test('phase guards refuse speaker display before Main',async()=>{
  const {r}=rig();await assert.rejects(r.command('speaker','Test'));assert.equal(r.runtime.phase,'idle');
});
test('explicit manual action cancels the old timed return, even if its callback runs',async()=>{
  const {r,scheduled}=rig();await main(r);await r.command('speaker','Test');
  await r.command('outro');assert.equal(scheduled[0].cancelled,true);
  scheduled[0].fn();await flush();assert.equal(r.runtime.phase,'outro');
});
test('a newer overlay invalidates the earlier generation',async()=>{
  const {r,scheduled}=rig();await main(r);await r.command('speaker','Test');await r.command('bible','Test reference');
  scheduled[0].fn();await flush();assert.equal(r.runtime.phase,'bible');
  scheduled[1].fn();await flush();assert.equal(r.runtime.phase,'main');
});
test('external interruption disarms and cancels timed returns',async()=>{
  const {r,writes,scheduled}=rig();await r.setMode('obs-preview');await main(r);await r.command('speaker','Test');
  r.interrupt('External operator change');const count=writes.length;
  scheduled[0].fn();await flush();assert.equal(r.runtime.mode,'simulation');assert.equal(writes.length,count);
});
test('all output states must explicitly be off before Preview mode can be armed',async()=>{
  for(const key of ['streaming','recording','virtualCamera','replayBuffer'])for(const value of [true,null]){
    const {r,setTransport,writes}=rig();setTransport({...safe(),[key]:value});await assert.rejects(r.setMode('obs-preview'));assert.deepEqual(writes,[]);
  }
});
test('scene collection and Studio Mode are checked',()=>{
  assert.throws(()=>assertPreviewSafe({...safe(),studio:false},'Test collection'));
  assert.throws(()=>assertPreviewSafe(safe(),'Different collection'));
  assert.throws(()=>assertPreviewSafe(disconnected(),'Test collection'));
});
test('active output during timed return fails closed without a new write',async()=>{
  const {r,setTransport,scheduled,writes}=rig();await r.setMode('obs-preview');await main(r);await r.command('bible','Test reference');
  const count=writes.length;setTransport({...safe(),streaming:true});scheduled[0].fn();await flush();
  assert.equal(writes.length,count);assert.equal(r.runtime.mode,'simulation');assert.equal(r.runtime.phase,'idle');
});
test('rehearsal reset never restores scenes or issues shutdown commands',async()=>{
  const {r,writes}=rig();await r.setMode('obs-preview');await main(r);const count=writes.length;await r.command('reset');assert.equal(writes.length,count);assert.equal(r.runtime.mode,'simulation');
});
test('recursive inspection distinguishes groups, preserves paths and bounds cycles',async()=>{
  const calls=[];
  const items={Main:[{sceneItemId:1,sourceName:'Names',sourceType:'OBS_SOURCE_TYPE_SCENE',isGroup:true,sceneItemEnabled:true}],Names:[{sceneItemId:2,sourceName:'Name text',inputKind:'text_ft2_source_v2',sourceType:'OBS_SOURCE_TYPE_INPUT',sceneItemEnabled:true},{sceneItemId:3,sourceName:'Main',sourceType:'OBS_SOURCE_TYPE_SCENE',sceneItemEnabled:false}]};
  const reader={read:async(name,data={})=>{
    calls.push([name,data]);
    if(name==='GetSceneList')return {scenes:[{sceneName:'Main'}]};
    if(name==='GetGroupList')return {groups:['Names']};
    if(name==='GetInputList')return {inputs:[{inputName:'Name text',inputKind:'text_ft2_source_v2'}]};
    if(name==='GetSceneCollectionList')return {currentSceneCollectionName:'Test'};
    if(['GetSceneItemList','GetGroupSceneItemList'].includes(name))return {sceneItems:items[data.sceneName]};
    throw new Error('Unsupported');
  }};
  const inv=await inspectObs(reader);assert.equal(inv.nodes.length,2);
  assert.ok(calls.some(([n,d])=>n==='GetGroupSceneItemList' && d.sceneName==='Names'));
  const c=candidates(inv,'Main');assert.equal(c.length,1);assert.equal(c[0].path,'Main → Names → Name text');assert.equal(c[0].enabled,true);
  assert.ok(calls.every(([n])=>n.startsWith('Get')));
});
test('partial group inspection reports missing children rather than claiming success',async()=>{
  const reader={read:async(name)=>{
    if(name==='GetSceneList')return {scenes:[{sceneName:'Main'}]};
    if(name==='GetGroupList')return {groups:['Unavailable group']};
    if(name==='GetInputList')return {inputs:[]};
    if(name==='GetSceneCollectionList')return {currentSceneCollectionName:'Test'};
    if(name==='GetSceneItemList')return {sceneItems:[]};
    throw new Error('Unavailable');
  }};
  const inv=await inspectObs(reader);assert.equal(inv.nodes[1].type,'unknown');assert.equal(inv.nodes[1].warnings.length,1);
});
test('local persistence writes a valid workspace and resets confirmation on restart',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'bcc-test-'));
  try{const file=path.join(dir,'workspace.json');await saveWorkspace(file,ready());const w=await loadWorkspace(file);assert.equal(w.bindings.confirmed,false);assert.equal(w.services.length,1);assert.equal(JSON.parse(await readFile(file,'utf8')).version,1);}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('the OBS adapter contains exactly one explicit write: Preview selection',async()=>{
  const source=await readFile(new URL('../src/obs.ts',import.meta.url),'utf8');
  const calls=[...source.matchAll(/\.call\('(Set|Start|Stop|Toggle|Trigger)[^']*'/g)].map(x=>x[0]);
  assert.deepEqual(calls,[".call('SetCurrentPreviewScene'"]);
});
