import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {blankWorkspace} from '../src/model.ts';
import {applyServiceChange} from '../src/live-schedule.ts';
import {liveMappingKey} from '../src/live-contract.ts';
import {LiveController} from '../src/live-controller.ts';
import {loadWorkspace,saveWorkspace} from '../src/storage.ts';
import mock from './mock-live.cjs';

const all={scenes:true,audio:true,stream:true};
const entry=(id,startsAt)=>({id,title:id,startsAt});
const added=entry('future','2026-10-27T12:00:00.000Z');
function workspace(f=mock.fixture()){
  const w=blankWorkspace();
  w.inventory={origin:'live',collection:f.state.collection,scenes:f.state.scenes,inputs:[],nodes:[],audio:[],warnings:[],capturedAt:''};
  w.bindings={...w.bindings,scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone'};
  w.captions={testCollection:'',speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'},confirmed:false};
  w.speakers=['Speaker A','Speaker B'];
  w.services=[entry('one','2026-10-25T10:00:00.000Z'),entry('two','2026-10-29T17:00:00.000Z')];
  return w;
}
async function rig(t){
  const f=mock.fixture();f.state.streaming=true;
  let w=workspace(f);const port=mock.fakePort(f),timers=[];
  const clock={now:()=>1000,set:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},clear:h=>{h.cancelled=true;}};
  const journal={async append(){},async entries(){return[];}};
  const live=new LiveController(()=>w,port,journal,()=>{},clock);
  t.after(()=>live.disconnect());await live.connect('synthetic');live.selectService('one');
  const checked=await live.checkGrant(all);await live.grant(all,checked.ticket);
  return {f,port,timers,live,get workspace(){return w;},change:raw=>{w=applyServiceChange(w,raw,live.snapshot().selectedService);}};
}
async function flush(){for(let i=0;i<100;i++)await new Promise(resolve=>setImmediate(resolve));}

test('schedule add preserves every non-schedule field and the live mapping identity',()=>{
  const w=workspace(),before=JSON.stringify(w),key=liveMappingKey(w);
  const next=applyServiceChange(w,{type:'add',service:added},'one');
  assert.equal(JSON.stringify(w),before);
  assert.deepEqual(next.services.map(s=>s.id),['one','future','two']);
  assert.equal(liveMappingKey(next),key);
  for(const field of Object.keys(w).filter(k=>k!=='services'))assert.equal(next[field],w[field]);
  assert.equal(next.inventory.origin,'live');
});

test('schedule commands merge against current state rather than replacing a stale list',()=>{
  let w=workspace();
  w=applyServiceChange(w,{type:'add',service:added},'one');
  w=applyServiceChange(w,{type:'add',service:entry('later','2026-11-01T10:00:00+01:00')},'one');
  assert.deepEqual(w.services.map(s=>s.id),['one','future','two','later']);
  assert.equal(w.services.at(-1).startsAt,'2026-11-01T09:00:00.000Z');
  const without=applyServiceChange(w,{type:'remove',id:'two'},'one');
  assert.deepEqual(without.services.map(s=>s.id),['one','future','later']);
  assert.equal(w.services.length,4);
});

test('selected-service removal and duplicate or missing IDs are refused without mutation',()=>{
  const w=workspace(),before=JSON.stringify(w);
  for(const change of [{type:'remove',id:'one'},{type:'remove',id:'missing'},{type:'add',service:w.services[0]}])
    assert.throws(()=>applyServiceChange(w,change,'one'));
  assert.equal(JSON.stringify(w),before);
});

test('schedule-only payload rejects configuration and permission injection',()=>{
  const w=workspace(),before=JSON.stringify(w);
  const bad=[null,[],{},'add',{type:'edit',service:added},
    {type:'add',service:added,bindings:{audioInput:'Other input'}},
    {type:'add',service:added,permissions:all},
    {type:'add',service:added,inventory:{}},
    {type:'add',service:{...added,obsUrl:'ws://localhost:4455'}},
    {type:'remove',id:'two',services:[]},
    {type:'add',service:{...added,startsAt:null}},
    {type:'add',service:{...added,startsAt:42}},
    {type:'add',service:{...added,startsAt:'not-a-date'}},
    {type:'add',service:{...added,startsAt:'2026-13-27T12:00:00Z'}},
    {type:'add',service:{...added,title:'  '}},
    {type:'add',service:{...added,title:'x'.repeat(241)}},
    {type:'add',service:{...added,id:'x'.repeat(101)}}];
  for(const change of bad)assert.throws(()=>applyServiceChange(w,change,'one'));
  assert.equal(JSON.stringify(w),before);
});

test('schedule capacity refuses addition rather than truncating existing services',()=>{
  const w=workspace();w.services=Array.from({length:1000},(_,i)=>entry(String(i),'2026-10-25T10:00:00Z'));
  assert.throws(()=>applyServiceChange(w,{type:'add',service:added},'0'),/full/);
  assert.equal(w.services.length,1000);
});

test('adding during live speaker countdown preserves permission, timer, audio and transmission',async t=>{
  const r=await rig(t);
  await r.live.command('speaker','Speaker B');
  r.f.state.mutes.Microphone=true;r.port.onEvent('InputMuteStateChanged',{inputName:'Microphone',inputMuted:true});
  const before=r.live.snapshot(),ticket=r.live.ticket(),count=r.f.state.writes.length;
  const timer=r.timers.at(-1);
  r.change({type:'add',service:added});
  const after=r.live.snapshot();
  assert.deepEqual(after.permissions,before.permissions);assert.equal(r.live.ticket(),ticket);
  assert.equal(after.selectedService,'one');assert.equal(after.phase,'speaker');
  assert.equal(after.returnAt,before.returnAt);assert.equal(timer.cancelled,false);
  assert.equal(r.f.state.writes.length,count);assert.equal(r.f.state.streaming,true);
  assert.equal(r.f.state.mutes.Microphone,true);
  timer.fn();await flush();
  assert.equal(r.f.state.program,'Main');assert.equal(r.f.state.mutes.Microphone,true);
  assert.equal(r.live.snapshot().returnAt,null);assert.deepEqual(r.live.snapshot().permissions,all);
  assert.deepEqual(r.f.state.writes.slice(count).map(x=>x.name),['SetCurrentProgramScene']);
});

test('new next-service entry is used only by a subsequent deliberate Outro action',async t=>{
  const r=await rig(t),before=JSON.stringify(r.f.state.settings),count=r.f.state.writes.length;
  r.change({type:'add',service:added});
  assert.equal(JSON.stringify(r.f.state.settings),before);assert.equal(r.f.state.writes.length,count);
  await r.live.command('outro');
  assert.match(r.f.state.settings['Next date'].text,/27\.10\.2026/);
  assert.equal(r.f.state.streaming,true);
});

test('schedule edit persists across restart without persisting live authorization',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'bcc-schedule-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const w=applyServiceChange(workspace(),{type:'add',service:added},'one');
  const file=path.join(dir,'workspace.json');await saveWorkspace(file,w);
  const restored=await loadWorkspace(file);
  assert.deepEqual(restored.services,w.services);
  assert.equal(restored.bindings.confirmed,false);assert.equal(restored.captions.confirmed,false);
  assert.ok(!('permissions' in restored));
});
