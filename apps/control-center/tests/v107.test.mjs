import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseBibleReference} from '../src/bible-reference.ts';
import {ensureDissolve} from '../src/live-transition.ts';
import {scenePresentation,channelStatus,SCENES,operatorMessage} from '../src/v107-model.ts';
import {blankWorkspace} from '../src/model.ts';
import {validateWorkspace} from '../src/workspace.ts';
import {emptyObservation,liveMappingKey} from '../src/live-contract.ts';
import {blockedActions} from '../src/live-validation.ts';
import {DeskCueStore} from '../src/desk-cues.ts';
import {LiveController} from '../src/live-controller.ts';
import mock from './mock-live.cjs';

for(const [raw,expected] of [
  ['1 Kor 4, 12ff','1. Korinther Kap. 4 ab Vers 12'],
  ['1. Korinther Kap. 4 ab Vers 12','1. Korinther Kap. 4 ab Vers 12'],
  ['Joh 3:16-18','Johannes Kap. 3 Vers 16–18'],
  ['Röm 8,28','Römer Kap. 8 Vers 28'],
  ['1Mo 1','1. Mose Kap. 1'],
  ['Ps 23, 1–6','Psalm Kap. 23 Vers 1–6'],
])test(`V107 parses ${raw} without inventing verse text`,()=>assert.equal(parseBibleReference(raw)?.reference,expected));
for(const raw of ['J 3,16','1 Kor 17,1','Joh 0','Joh 3,18-16','Joh 3,0','Joh 3,16junk','Joh 3,999','Joh 3\n','<script>3'])test(`V107 does not guess malformed/ambiguous reference: ${JSON.stringify(raw)}`,()=>assert.equal(parseBibleReference(raw),null));

test('V107 active scene is red only with fresh confirmed transmission',()=>{
  const w=blankWorkspace();w.bindings.scenes.main='Main';const s={workspace:w,live:{pendingAction:'',observation:{...emptyObservation(),program:'Main',streaming:false,reconnecting:false}}};
  assert.deepEqual(scenePresentation(s,'main',true),{selected:true,onAir:false,requested:false});
  s.live.observation.streaming=true;assert.equal(scenePresentation(s,'main',true).onAir,true);
  assert.equal(scenePresentation(s,'main',false).onAir,false);
  s.live.observation.reconnecting=true;assert.equal(scenePresentation(s,'main',true).onAir,false);
  s.live.observation.reconnecting=false;s.live.pendingAction='on-air';assert.deepEqual(scenePresentation(s,'main',true),{selected:true,onAir:false,requested:true});
});
test('V107 requests do not optimistically select the target',()=>{
 const w=blankWorkspace();w.bindings.scenes.prayer='Prayer';const s={workspace:w,live:{pendingAction:'prayer-scene',observation:{...emptyObservation(),program:'Main',streaming:true,reconnecting:false}}};
 assert.deepEqual(scenePresentation(s,'prayer',true),{selected:false,onAir:false,requested:true});
 assert.equal(new Set(SCENES.map(s=>s.command)).size,8);
});
test('V107 channel tally requires independent fresh YouTube evidence',()=>{
 const p={accounts:[{language:'de',channel:{id:'de'}}],checkedAt:{de:1000},connectionErrors:{},remote:{de:[{lifecycle:'live'}]}};
 assert.equal(channelStatus(p,'de',1100).live,true);
 assert.equal(channelStatus(p,'ru',1100).live,false);
 assert.equal(channelStatus(p,'de',46000).live,false);
 assert.equal(channelStatus(p,'de',999).live,false);
 p.connectionErrors.de='offline';assert.equal(channelStatus(p,'de',1100).live,false);
});
test('V107 transition duration is optional, bounded and part of the authorization key',()=>{
 const w=blankWorkspace();assert.equal(validateWorkspace(w).transitionMs,undefined);
 const old=liveMappingKey(w);w.transitionMs=900;assert.equal(liveMappingKey(w),old);
 for(const ms of [300,600,900,1500,2500])assert.equal(validateWorkspace({...w,transitionMs:ms}).transitionMs,ms);
 for(const ms of [0,NaN,Infinity,700,'900',null])assert.throws(()=>validateWorkspace({...w,transitionMs:ms}));
 assert.notEqual(liveMappingKey({...w,transitionMs:1500}),old);
});
function transitionRig(){
 const calls=[],writes=[];let override={transitionName:'Schwarzblende',transitionDuration:400},ignore=false;
 const reader={async read(name,data){calls.push({name,data});if(name==='GetSceneTransitionList')return {transitions:[{transitionName:'Schwarzblende',transitionKind:'fade_to_color_transition'},{transitionName:'Überblenden',transitionKind:'fade_transition'}]};if(name==='GetSceneSceneTransitionOverride')return {...override};if(name==='GetCurrentSceneTransition')return {transitionKind:'fade_transition',transitionDuration:900};throw Error(name);}};
 return {calls,writes,reader,set(value){override=value;},ignore(){ignore=true;},async change(name,data){writes.push({name,data});if(!ignore)override={transitionName:data.transitionName,transitionDuration:data.transitionDuration};}};
}
test('V107 replaces a fade-to-black override with the actual locale-independent OBS dissolve',async()=>{
 const r=transitionRig();await ensureDissolve(r.reader,r.change,'Main',900);
 assert.deepEqual(r.writes,[{name:'SetSceneSceneTransitionOverride',data:{sceneName:'Main',transitionName:'Überblenden',transitionDuration:900}}]);
 assert.equal(r.calls.at(-1).name,'GetSceneSceneTransitionOverride');
});
test('V107 uses a confirmed existing dissolve without redundant mutation',async()=>{
 const r=transitionRig();r.set({transitionName:'Überblenden',transitionDuration:900});await ensureDissolve(r.reader,r.change,'Main',900);assert.equal(r.writes.length,0);
 r.set({transitionName:null,transitionDuration:null});await ensureDissolve(r.reader,r.change,'Main',900);assert.equal(r.writes.length,0);
});
test('V107 rejects an unacknowledged dissolve without retry',async()=>{
 const r=transitionRig();r.ignore();await assert.rejects(ensureDissolve(r.reader,r.change,'Main',900),/nicht bestätigt/);assert.equal(r.writes.length,1);
});
test('V107 rejects missing dissolve and invalid duration without a write',async()=>{
 const r=transitionRig();await assert.rejects(ensureDissolve({read:async()=>({transitions:[]})},r.change,'Main',900),/keine Überblendung/);
 await assert.rejects(ensureDissolve(r.reader,r.change,'Main',800),/Ungültige/);assert.equal(r.writes.length,0);
});
test('V107 rejects transition read failures rather than assuming a safe default',async()=>{
 let writes=0;await assert.rejects(ensureDissolve({read:async()=>{throw Error('disconnected');}},async()=>{writes++;},'Main',900));assert.equal(writes,0);
});
test('V107 editing a Bible cue persists, resets only its read marker, and never replays it',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'v107-cues-'));t.after(()=>rm(dir,{recursive:true,force:true}));const c=new DeskCueStore(join(dir,'cues.json'));await c.load();
 await c.change('one',{kind:'add',reference:'Johannes 3,16'},[]);await c.change('one',{kind:'add',reference:'Psalm 23'},[]);
 const id=c.snapshot('one').entries[0].id;await c.shown('one',id,123);
 const selected=c.snapshot('one').selected;
 await c.change('one',{kind:'edit',id,reference:'Johannes 3,16'},[]);assert.equal(c.snapshot('one').entries[0].shownAt,123);
 await c.change('one',{kind:'edit',id,reference:'Johannes 3,17'},[]);assert.equal(c.snapshot('one').entries[0].shownAt,null);assert.equal(c.snapshot('one').selected,selected);
 const reopened=new DeskCueStore(join(dir,'cues.json'));await reopened.load();assert.equal(reopened.snapshot('one').entries[0].reference,'Johannes 3,17');assert.equal(reopened.snapshot('two').entries.length,0);
 for(const patch of [{id:'missing',reference:'valid'},{id,reference:''},{id,reference:'x\ny'},{id,reference:'x',extra:true}])await assert.rejects(c.change('one',{kind:'edit',...patch},[]));
});
async function liveRig(t){
 const f=mock.fixture(),w=blankWorkspace();f.state.streaming=true;f.state.scenes.push('Chapter','Interlude','Singing','Prayer','Remote');for(const name of f.state.scenes)f.state.nodes[name]||=[];
 w.bindings.scenes={intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro',chapter:'Chapter',interlude:'Interlude',singing:'Singing',prayer:'Prayer',remote:'Remote'};w.bindings.audioInput='Microphone';
 w.services=[{id:'one',title:'Test',startsAt:'2027-01-01T10:00:00Z'}];w.inventory={origin:'live',collection:f.state.collection,scenes:f.state.scenes,inputs:[],nodes:[],audio:[],warnings:[],capturedAt:''};
 const port=mock.fakePort(f),live=new LiveController(()=>w,port,{append:async()=>{},entries:async()=>[]},()=>{});t.after(()=>live.disconnect());await live.connect('synthetic');const grant=await live.checkGrant({scenes:true,audio:true,stream:true});await live.grant({scenes:true,audio:true,stream:true},grant.ticket);return {f,w,port,live};
}
test('V107 extended scene routes stay selected and do not start/end transmission',async t=>{
 const r=await liveRig(t);for(const name of ['chapter','interlude','singing','prayer-scene','remote']){await r.live.command(name);assert.equal(r.live.snapshot().returnAt,null);assert.equal(r.f.state.streaming,true);}
 assert.ok(!r.f.state.writes.some(w=>['SetInputMute','StartStream','StopStream'].includes(w.name)));
 await r.live.command('intro-scene');assert.equal(r.f.state.program,'Intro');assert.equal(r.f.state.mutes.Microphone,true);assert.equal(r.f.state.streaming,true);
 await r.live.command('on-air');assert.equal(r.f.state.program,'Main');assert.equal(r.f.state.mutes.Microphone,false);
});
test('V107 cancellation during transition verification prevents the scene write',async t=>{
 const r=await liveRig(t);r.f.state.before=name=>{if(name==='GetSceneTransitionList')r.live.release();};
 await assert.rejects(r.live.command('chapter'));assert.equal(r.f.state.writes.length,0);
});
test('V107 unconfirmed transition preserves program and releases authorization',async t=>{
 const r=await liveRig(t);r.f.state.transition.transitionKind='cut_transition';r.f.state.ignoreTransition=true;
 await assert.rejects(r.live.command('chapter'),/nicht bestätigt/);assert.equal(r.f.state.program,'Main');assert.equal(r.live.snapshot().permissions.scenes,false);
 assert.deepEqual(r.f.state.writes.map(w=>w.name),['SetSceneSceneTransitionOverride']);
});
test('V107 unmapped optional scenes block only their own actions',()=>{
 const w=blankWorkspace();w.bindings.scenes.main='Main';w.bindings.audioInput='Microphone';const o={...emptyObservation(),checkedAt:1000,collection:'Test',profile:'Test',program:'Main',scenes:['Main'],streaming:true,reconnecting:false};
 const r=blockedActions(w,o,{scenes:true,audio:true,stream:true},true,false,'',1100);
 assert.equal(r['on-air'].length,0);assert.ok(r.chapter.some(x=>x.includes('chapter')));assert.equal(operatorMessage(r.chapter[0]),'Bitte die Szene „Kapitel“ zuordnen.');
});
