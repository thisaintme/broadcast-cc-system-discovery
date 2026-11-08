import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyObservation,noPermissions} from '../src/live-contract.ts';
import {hasFreshTelemetry,transmissionStatus,formatDuration,formatBerlinDate,nextService,upcomingService,remainingReturnSeconds} from '../src/live-ui-model.ts';
const snapshot=()=>({connected:true,observation:{...emptyObservation(),checkedAt:10000,streaming:false},permissions:noPermissions(),phase:'main',pendingAction:''});
test('UI telemetry requires a connected, recent and non-future observation and receipt',()=>{
  const live=snapshot(); assert.equal(hasFreshTelemetry(live,10010,10005),true);
  for(const [now,receipt] of [[16000,10005],[16010,16000],[10010,4000],[9999,9998],[10010,10011]])assert.equal(hasFreshTelemetry(live,now,receipt),false);
  live.connected=false;assert.equal(hasFreshTelemetry(live,10010,10005),false);
  live.connected=true;live.observation.checkedAt=null;assert.equal(hasFreshTelemetry(live,10010,10005),false);
});
test('UI never infers transmission from scene, phase or permissions',()=>{
  const live=snapshot();live.permissions={scenes:true,audio:true,stream:true};
  assert.equal(transmissionStatus(live,true),'OFF');
  live.observation.streaming=true;assert.equal(transmissionStatus(live,true),'TRANSMITTING');
  assert.equal(transmissionStatus(live,false),'UNKNOWN');
  live.observation.streaming=null;assert.equal(transmissionStatus(live,true),'UNKNOWN');
});
test('pending output actions are not shown as confirmed, and reconnecting is distinct',()=>{
  const live=snapshot();live.pendingAction='start';assert.equal(transmissionStatus(live,true),'STARTING');
  live.pendingAction='stop';assert.equal(transmissionStatus(live,true),'STOPPING');
  assert.equal(transmissionStatus(live,false),'UNKNOWN');
  live.pendingAction='';live.observation.reconnecting=true;assert.equal(transmissionStatus(live,true),'RECONNECTING');
});
test('duration and countdown labels handle unknown, zero and expired values',()=>{
  for(const value of [null,NaN,Infinity,-1])assert.equal(formatDuration(value),'Unbekannt');
  assert.equal(formatDuration(0),'00:00:00');assert.equal(formatDuration(3661001),'01:01:01');
  assert.equal(remainingReturnSeconds(null,10000),null);assert.equal(remainingReturnSeconds(20000,10001),10);
  assert.equal(remainingReturnSeconds(20000,20001),0);
});
test('next service is chronological even with unsorted timezone-offset dates, and does not mutate input',()=>{
  const services=[{id:'late',startsAt:'2026-11-08T12:00:00Z'},{id:'one',startsAt:'2026-10-25T10:00:00Z'},{id:'next',startsAt:'2026-10-29T18:00:00+01:00'},{id:'bad',startsAt:'bad'}];
  const original=JSON.stringify(services);
  assert.equal(nextService(services,'one').id,'next');assert.equal(nextService(services,'unknown'),undefined);
  assert.equal(upcomingService(services,Date.parse('2026-10-29T17:00:00Z')).id,'next');
  assert.equal(upcomingService(services,Date.parse('2027-01-01T00:00:00Z')),undefined);
  assert.equal(JSON.stringify(services),original);
});
test('date labels explicitly use Berlin daylight-saving rules',()=>{
  assert.match(formatBerlinDate('2026-10-25T10:00:00Z'),/25\.10\.2026.*11:00/);
  assert.match(formatBerlinDate('2026-07-01T10:00:00Z'),/01\.07\.2026.*12:00/);
  assert.equal(formatBerlinDate('bad'),'Ungültiges Datum');
});
