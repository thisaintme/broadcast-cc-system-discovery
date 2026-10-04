import test from 'node:test';
import assert from 'node:assert/strict';
import {blankWorkspace,disconnected} from '../src/model.ts';
import {captionSetupIssues,offlineEnableIssues,rehearsalHint} from '../src/readiness.ts';

function snapshot() {
  const workspace=blankWorkspace();
  workspace.services=[{id:'one',title:'Synthetic service',startsAt:'2026-10-04T09:00:00Z'}];
  return {version:'test',workspace,runtime:{mode:'simulation',phase:'idle',selectedService:'one',overlay:'',returnAt:null,busy:false,events:[],serviceAudioEnabled:false},transport:disconnected(),companionResult:''};
}
function ready() {
  const s=snapshot(),w=s.workspace;
  w.inventory={origin:'live',collection:'BCC TEST - synthetic',scenes:['Intro','Main','Speaker','Bible','Outro'],inputs:[],nodes:[{name:'Names',type:'group',items:[],warnings:[]}],audio:[],warnings:[],capturedAt:''};
  w.bindings={...w.bindings,scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',confirmed:true};
  w.captions={testCollection:'BCC TEST - synthetic',speakerGroup:'Names',speakerPool:['Speaker A'],speakerSources:{'Speaker A':'Speaker A'},confirmed:true};
  s.transport={...disconnected(),connected:true,collection:w.inventory.collection,streaming:false,recording:false,virtualCamera:false,replayBuffer:false};
  return s;
}
const codes=items=>items.map(x=>x.code);
test('simulation instructions remain usable with no OBS and no authorization',()=>{
  const s=snapshot();
  assert.match(rehearsalHint(s),/Simulation is ready: click 1/);
  assert.match(rehearsalHint(s),/does not require OBS/);
  assert.ok(offlineEnableIssues(s).length);
});
test('the generic unauthorized label is replaced by concrete empty-field reasons',()=>{
  const s=snapshot(),reasons=captionSetupIssues(s,s.workspace);
  for(const key of ['connection','inspection','test-name','bible-text','next-text','speaker-group','speaker-pool'])assert.ok(codes(reasons).includes(key));
  assert.match(reasons.find(x=>x.code==='test-name').message,/placeholder/);
  assert.ok(codes(offlineEnableIssues(s)).includes('caption-confirmation'));
});
test('current and inspected collection mismatches name the actual values',()=>{
  const s=ready();s.workspace.inventory.collection='Synthetic production';s.transport.collection='Different collection';
  const reasons=captionSetupIssues(s,s.workspace);
  assert.match(reasons.find(x=>x.code==='inspected-collection').message,/Synthetic production/);
  assert.match(reasons.find(x=>x.code==='current-collection').message,/Different collection/);
});
test('draft inspection is never trusted over the authoritative main-process snapshot',()=>{
  const s=ready(),draft=structuredClone(s.workspace);s.workspace.inventory.origin='report';
  assert.ok(codes(captionSetupIssues(s,draft)).includes('inspection'));
});
test('ready fields enable confirmation but saved confirmations are still separately required',()=>{
  const s=ready();s.workspace.bindings.confirmed=false;s.workspace.captions.confirmed=false;
  assert.deepEqual(captionSetupIssues(s,s.workspace),[]);
  assert.deepEqual(codes(offlineEnableIssues(s)),['scene-confirmation','caption-confirmation']);
  s.workspace.bindings.confirmed=true;s.workspace.captions.confirmed=true;
  assert.deepEqual(offlineEnableIssues(s),[]);
});
test('all original disabled-button conditions have an explanation',()=>{
  for(const mutate of [s=>s.runtime.busy=true,s=>s.transport.connected=false,s=>s.runtime.mode='obs-preview',s=>s.runtime.phase='prepared',s=>s.workspace.bindings.confirmed=false,s=>s.workspace.captions.confirmed=false]){
    const s=ready();mutate(s);assert.ok(offlineEnableIssues(s).length);
  }
  assert.ok(codes(offlineEnableIssues(ready(),true)).includes('busy'));
});
test('unknown outputs never appear ready and exact optional-unavailable classification is retained',()=>{
  const s=ready();s.transport.virtualCamera=null;s.transport.replayBuffer=null;
  assert.ok(codes(offlineEnableIssues(s)).includes('output-virtualCamera'));
  s.transport.unavailableOutputs=['virtualCamera','replayBuffer'];assert.deepEqual(offlineEnableIssues(s),[]);
  s.transport.streaming=null;assert.ok(codes(offlineEnableIssues(s)).includes('output-streaming'));
  s.transport.streaming=true;assert.match(offlineEnableIssues(s).find(x=>x.code==='output-streaming').message,/active/);
});
test('prepare, intro and outro phases explain the next action without changing state',()=>{
  const s=ready();s.runtime.phase='prepared';assert.match(rehearsalHint(s),/2 · Intro/);
  assert.ok(codes(offlineEnableIssues(s)).includes('phase'));
  s.runtime.phase='intro';assert.match(rehearsalHint(s),/3 · Main/);
  s.runtime.phase='outro';assert.match(rehearsalHint(s),/start another run/);
  const before=JSON.stringify(s);offlineEnableIssues(s);captionSetupIssues(s,s.workspace);rehearsalHint(s);assert.equal(JSON.stringify(s),before);
});
test('unmapped scenes and unknown groups have specific reasons',()=>{
  const s=ready();s.workspace.bindings.scenes.main='Missing';s.workspace.captions.speakerGroup='Missing';
  assert.ok(codes(captionSetupIssues(s,s.workspace)).includes('scene-main'));
  assert.ok(codes(captionSetupIssues(s,s.workspace)).includes('speaker-group'));
});
