import test from 'node:test';
import assert from 'node:assert/strict';
import mock from './mock-service-audio.cjs';
import {blankWorkspace} from '../src/model.ts';
import {inspectObs} from '../src/inspect.ts';
import {executeOffline,nextServiceCaption} from '../src/offline.ts';
import {executeLiveAction} from '../src/live-actions.ts';

const current={id:'one',title:'Synthetic service',startsAt:'2026-01-01T09:00:00.000Z'};
// Exact strings catch weekday prefixes, unwanted seconds and host-timezone dependence.
for(const [startsAt,expected] of [
  ['2026-07-06T16:00:00.000Z','06.07.2026, 18:00 Uhr'],
  ['2026-07-07T16:00:00.000Z','07.07.2026, 18:00 Uhr'],
  ['2026-07-08T16:00:00.000Z','08.07.2026, 18:00 Uhr'],
  ['2026-07-09T16:00:00.000Z','09.07.2026, 18:00 Uhr'],
  ['2026-07-10T16:00:00.000Z','10.07.2026, 18:00 Uhr'],
  ['2026-07-11T16:00:00.000Z','11.07.2026, 18:00 Uhr'],
  ['2026-07-12T16:00:00.000Z','12.07.2026, 18:00 Uhr'],
  ['2026-03-29T00:30:00.000Z','29.03.2026, 01:30 Uhr'],
  ['2026-03-29T01:30:00.000Z','29.03.2026, 03:30 Uhr'],
  ['2026-10-25T00:30:00.000Z','25.10.2026, 02:30 Uhr'],
  ['2026-10-25T01:30:00.000Z','25.10.2026, 02:30 Uhr'],
  ['2026-07-05T22:15:00.000Z','06.07.2026, 00:15 Uhr'],
  ['2026-12-31T23:15:00.000Z','01.01.2027, 00:15 Uhr'],
])test(`next-service caption is compact Berlin date/time: ${startsAt}`,()=>{
  const w=blankWorkspace();w.services=[current,{id:'two',title:'Next service',startsAt}];
  assert.equal(nextServiceCaption(w,'one'),expected);
});

test('next-service formatting preserves schedule order and chooses the next later service',()=>{
  const w=blankWorkspace();w.services=[
    {id:'last',title:'Later',startsAt:'2026-10-04T09:00:00.000Z'},
    {id:'next',title:'Next',startsAt:'2026-10-01T16:00:00.000Z'},
    current,
  ];
  const before=structuredClone(w.services);
  assert.equal(nextServiceCaption(w,'one'),'01.10.2026, 18:00 Uhr');
  assert.deepEqual(w.services,before);
  assert.equal(nextServiceCaption(w,'last'),'Nächster Termin folgt.');
  assert.throws(()=>nextServiceCaption(w,'missing'),/Select a service/);
});

async function rig(kind,grouped){
  const {state,request}=mock.fixture();
  state.settings['Next date']={
    text:'Old date',from_file:false,font:{face:'Helvetica',size:26,style:'Bold',flags:1},
    custom_width:640,word_wrap:true,outline:true,drop_shadow:false,color1:0xffffffff,color2:0xffffffff,
  };
  const label=state.nodes.Outro[0];label.inputKind=kind;
  label.sceneItemTransform={positionX:120,positionY:850,rotation:0,scaleX:0.75,scaleY:0.75,
    alignment:5,boundsType:'OBS_BOUNDS_SCALE_INNER',boundsAlignment:0,boundsWidth:640,boundsHeight:72,
    cropLeft:0,cropRight:0,cropTop:0,cropBottom:0};
  if(grouped){
    state.groups.push('Outro caption');state.nodes['Outro caption']=[label];
    state.nodes.Outro=[{sceneItemId:301,sourceName:'Outro caption',inputKind:null,sceneItemEnabled:true,
      sourceType:'OBS_SOURCE_TYPE_SCENE',isGroup:true,
      sceneItemTransform:{positionX:40,positionY:60,scaleX:1,scaleY:1,boundsType:'OBS_BOUNDS_NONE'}}];
  }
  const port={
    read:async(name,data={})=>{
      const result=request(name,data);
      if(name==='GetInputSettings'&&data.inputName==='Next date')result.inputKind=kind;
      if(name==='GetInputList')result.inputs.find(i=>i.inputName==='Next date').inputKind=kind;
      return result;
    },
    change:async(name,data)=>{request(name,data);},
  };
  const w=blankWorkspace();w.inventory=await inspectObs(port);
  w.bindings={...w.bindings,scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},
    bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone',confirmed:true};
  w.speakers=['Speaker A','Speaker B'];
  w.captions={testCollection:state.collection,speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],
    speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'},confirmed:true};
  w.services=[current,{id:'two',title:'Next synthetic service',startsAt:'2026-10-01T16:00:00.000Z'}];
  return {state,port,w};
}

for(const kind of ['text_ft2_source','text_ft2_source_v2'])for(const grouped of [false,true]){
  for(const mode of ['prepare','offline-outro','live-outro']){
    test(`${mode}: compact caption preserves font, extents and transforms (${kind}, grouped=${grouped})`,async()=>{
      const {state,port,w}=await rig(kind,grouped);
      const settingsBefore=structuredClone(state.settings),nodesBefore=structuredClone(state.nodes);
      if(mode==='live-outro'){
        const phase=await executeLiveAction({workspace:w,reader:port,serviceId:'one',
          permissions:()=>({scenes:true,audio:true,stream:false}),
          check:async()=>({program:state.program,streaming:state.streaming,reconnecting:false}),
          change:port.change,verified:async()=>{},
        },'outro');
        assert.equal(phase,'outro');
      }else await executeOffline(port,w,mode==='prepare'?'prepare':'outro','','one',()=>true);
      const expected='01.10.2026, 18:00 Uhr';
      assert.deepEqual(state.settings,{...settingsBefore,'Next date':{...settingsBefore['Next date'],text:expected}});
      assert.deepEqual(state.nodes,nodesBefore);
      assert.deepEqual(state.writes.filter(x=>x.name==='SetInputSettings'),[
        {name:'SetInputSettings',data:{inputName:'Next date',inputSettings:{text:expected},overlay:true}},
      ]);
      assert.deepEqual(state.writes.map(x=>x.name),mode==='live-outro'
        ?['SetInputMute','SetInputSettings','SetCurrentProgramScene']
        :mode==='prepare'?['SetInputSettings']:['SetInputSettings','SetCurrentProgramScene']);
      assert.equal(state.program,mode==='prepare'?'Main':'Outro');
      assert.equal(state.mutes.Microphone,mode==='live-outro');
      assert.equal(state.mutes['Other input'],false);
      assert.equal(state.streaming,false);
    });
  }
}

test('live outro fallback replaces stale date without changing layout or stopping the stream',async()=>{
  const {state,port,w}=await rig('text_ft2_source_v2',true);state.streaming=true;
  const settingsBefore=structuredClone(state.settings),nodesBefore=structuredClone(state.nodes);
  await executeLiveAction({workspace:w,reader:port,serviceId:'two',
    permissions:()=>({scenes:true,audio:true,stream:false}),
    check:async()=>({program:state.program,streaming:state.streaming,reconnecting:false}),
    change:port.change,verified:async()=>{},
  },'outro');
  assert.deepEqual(state.settings,{...settingsBefore,'Next date':{...settingsBefore['Next date'],text:'Nächster Termin folgt.'}});
  assert.deepEqual(state.nodes,nodesBefore);
  assert.equal(state.program,'Outro');assert.equal(state.mutes.Microphone,true);assert.equal(state.streaming,true);
  assert.deepEqual(state.writes.map(x=>x.name),['SetInputMute','SetInputSettings','SetCurrentProgramScene']);
});
