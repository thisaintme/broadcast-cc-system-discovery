import test from 'node:test';
import assert from 'node:assert/strict';
import {manualTextSettings} from '../src/offline.ts';
import {ObsAdapter} from '../src/obs.ts';
import {inspectObs} from '../src/inspect.ts';
import {blankWorkspace} from '../src/model.ts';
import mock from './mock-offline.cjs';

test('built-in FreeType text supports the actual omitted file-reading default',()=>{
  const r=manualTextSettings('text_ft2_source_v2',{text:'Reference'},{font:{size:256},color1:4294967295});
  assert.equal(r.text,'Reference');assert.deepEqual(r.font,{size:256});assert.equal(r.from_file,undefined);
});
test('explicit file mode and malformed flags remain blocked',()=>{
  for(const value of [true,'false',0,null])assert.throws(()=>manualTextSettings('text_ft2_source_v2',{from_file:value},{}));
  assert.throws(()=>manualTextSettings('text_ft2_source_v2',{},{from_file:true}));
  assert.throws(()=>manualTextSettings('browser_source',{text:'Reference'},{}));
  assert.throws(()=>manualTextSettings('text_ft2_source_v2',null,{}));
  assert.throws(()=>manualTextSettings('text_ft2_source_v2',{},null));
});
test('unrelated countdown updates do not cancel a controlled caption sequence',async()=>{
  const peer=await mock.start(),adapter=new ObsAdapter(),interruptions=[];
  adapter.onUnsafe=r=>interruptions.push(r);
  try{
    await adapter.connect(peer.url,peer.password);const w=blankWorkspace();w.inventory=await inspectObs(adapter);
    w.bindings={...w.bindings,scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',confirmed:true};
    w.captions={testCollection:'BCC TEST - synthetic',speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{},confirmed:true};
    w.services=[{id:'one',title:'Synthetic service',startsAt:'2026-10-04T09:00:00Z'}];
    peer.state.before=name=>{if(name==='GetInputSettings')peer.emit('InputSettingsChanged',{inputName:'Unrelated countdown',inputSettings:{text:'09:59'}});};
    await adapter.offline(w,'bible','New reference','one',()=>true);
    assert.equal(adapter.state().program,'Bible');assert.deepEqual(interruptions,[]);
    peer.emit('InputSettingsChanged',{inputName:'Reference text',inputSettings:{text:'Foreign edit'}});
    await new Promise(resolve=>setTimeout(resolve,30));assert.ok(interruptions.some(r=>r.includes('caption')));
  }finally{await adapter.disconnect();await peer.close();}
});
