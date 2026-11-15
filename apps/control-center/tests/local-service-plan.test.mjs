import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {planLocalServices} from '../src/local-service-plan.ts';
import {applyServiceChange} from '../src/live-schedule.ts';
import {blankWorkspace} from '../src/model.ts';
import {liveMappingKey} from '../src/live-contract.ts';
import {saveWorkspace,loadWorkspace} from '../src/storage.ts';

const single={requestId:'test-plan',title:'Gottesdienst',single:{date:'2020-01-05',time:'11:00'}};
const series={requestId:'test-series',title:'Andacht',recurrence:{startDate:'2027-03-14',time:'11:00',timeZone:'Europe/Berlin',weekdays:[7],intervalWeeks:1,count:4,excludeDates:[]}};
test('local service planning accepts an already started service without YouTube or OBS',()=>{
  assert.deepEqual(planLocalServices(single),[{id:'local-test-plan-2020-01-05',title:'20200105 - Gottesdienst',startsAt:'2020-01-05T10:00:00.000Z'}]);
});
test('local weekly series creates distinct real dates and keeps 11:00 Berlin across spring DST',()=>{
  const dates=planLocalServices(series);assert.equal(new Set(dates.map(x=>x.id)).size,4);
  assert.deepEqual(dates.map(x=>x.startsAt),['2027-03-14T10:00:00.000Z','2027-03-21T10:00:00.000Z','2027-03-28T09:00:00.000Z','2027-04-04T09:00:00.000Z']);
});
test('local weekly series keeps 11:00 Berlin across autumn DST',()=>{
  const dates=planLocalServices({...series,recurrence:{...series.recurrence,startDate:'2027-10-24',count:2}});
  assert.deepEqual(dates.map(x=>x.startsAt),['2027-10-24T09:00:00.000Z','2027-10-31T10:00:00.000Z']);
});
test('local recurrence honors weekday, fortnight and exclusion rules',()=>{
  const dates=planLocalServices({...series,recurrence:{...series.recurrence,startDate:'2027-03-15',weekdays:[3],intervalWeeks:2,count:2,excludeDates:['2027-03-17']}});
  assert.deepEqual(dates.map(x=>x.startsAt.slice(0,10)),['2027-03-31','2027-04-14']);
});
test('local title preserves custom Cyrillic text without a duplicate date prefix',()=>{
  assert.equal(planLocalServices({...single,title:'20200105 - Богослужение'})[0].title,'20200105 - Богослужение');
});
for(const plan of [null,{}, {...single,permissions:{scenes:true}}, {...single,destinations:[]}, {...single,requestId:'../key'}, {...single,title:'x'.repeat(221)}, {...single,title:'A\nB'}, {...single,single:{date:'2027-02-30',time:'11:00'}}, {...single,single:{date:'2027-03-28',time:'02:30'}}, {...single,single:{date:'2027-10-31',time:'02:30'}}, {...single,recurrence:series.recurrence}, {...series,recurrence:{...series.recurrence,count:105}}, {...series,recurrence:{...series.recurrence,weekdays:[]}}]){
  test('local planning rejects malformed, injected or ambiguous payload '+JSON.stringify(plan),()=>assert.throws(()=>planLocalServices(plan)));
}
test('local batch save is idempotent, bounded, atomic and does not change live mappings',()=>{
  const w=blankWorkspace(),before=JSON.stringify(w),key=liveMappingKey(w);
  const next=applyServiceChange(w,{type:'plan',plan:series},'');
  assert.equal(next.services.length,4);assert.equal(liveMappingKey(next),key);assert.equal(JSON.stringify(w),before);
  for(const k of Object.keys(w).filter(k=>k!=='services'))assert.equal(next[k],w[k]);
  assert.deepEqual(applyServiceChange(next,{type:'plan',plan:series},next.services[0].id).services,next.services);
  assert.deepEqual(applyServiceChange(next,{type:'plan',plan:{...series,requestId:'new-click'}},'').services,next.services);
  assert.throws(()=>applyServiceChange(next,{type:'plan',plan:{...series,title:'Changed'}},''));
  const full={...w,services:Array.from({length:999},(_,i)=>({id:String(i),title:String(i),startsAt:'2020-01-01T10:00:00.000Z'}))};
  assert.throws(()=>applyServiceChange(full,{type:'plan',plan:series},''),/voll/);assert.equal(full.services.length,999);
});
test('local single and series survive workspace restart, selected service stays protected',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'bcc-local-plan-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let w=applyServiceChange(blankWorkspace(),{type:'plan',plan:single},'');
  w=applyServiceChange(w,{type:'plan',plan:series},w.services[0].id);
  await saveWorkspace(path.join(dir,'workspace.json'),w);const restored=await loadWorkspace(path.join(dir,'workspace.json'));
  assert.deepEqual(restored.services,w.services);assert.throws(()=>applyServiceChange(restored,{type:'remove',id:w.services[0].id},w.services[0].id));
});

test('explicit local service selection survives OBS connect and reconnect; removed IDs fall back',async t=>{
  const {LiveController}=await import('../src/live-controller.ts');const {default:mock}=await import('./mock-live.cjs');
  const f=mock.fixture(),port=mock.fakePort(f);let w=applyServiceChange(blankWorkspace(),{type:'plan',plan:series},'');
  const live=new LiveController(()=>w,port,{append:async()=>{},entries:async()=>[]},()=>{});t.after(()=>live.disconnect());
  const chosen=w.services[2].id;live.selectService(chosen);assert.equal(live.snapshot().selectedService,chosen);
  await live.connect('synthetic');assert.equal(live.snapshot().selectedService,chosen);
  await live.disconnect();await live.connect('synthetic');assert.equal(live.snapshot().selectedService,chosen);
  w={...w,services:w.services.filter(s=>s.id!==chosen)};
  assert.notEqual(live.snapshot().selectedService,chosen);assert.ok(w.services.some(s=>s.id===live.snapshot().selectedService));
  w={...w,services:[]};assert.equal(live.snapshot().selectedService,'');
});
