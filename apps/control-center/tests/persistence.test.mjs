import test from 'node:test';
import assert from 'node:assert/strict';
import {blankWorkspace} from '../src/model.ts';
import {validateWorkspace} from '../src/workspace.ts';

test('workspace exports retain allowlisted historical audio and ports, never raw settings',()=>{
  const w=blankWorkspace();w.inventory={origin:'live',collection:'Test',scenes:[],inputs:[],nodes:[],audio:[],warnings:[],capturedAt:''};w.inventory.audio=[{name:'Microphone',muted:false,volumeDb:-6,monitor:'OBS_MONITORING_TYPE_NONE',tracks:{'1':true,'2':false,secret:'SENSITIVE'},warnings:['GetInputVolume unavailable.'],password:'SENSITIVE'}];
  w.connections=[{label:'Camera',module:'generic',version:'1',host:'camera.local',port:5678,enabled:true,health:'unknown'}];
  const saved=validateWorkspace(w,true);
  assert.equal(saved.inventory.origin,'report');assert.equal(saved.inventory.audio.length,1);
  assert.equal(saved.inventory.audio[0].muted,false);assert.equal(saved.inventory.audio[0].volumeDb,-6);
  assert.deepEqual(saved.inventory.audio[0].tracks,{'1':true,'2':false});assert.equal(saved.connections[0].port,5678);
  assert.ok(!JSON.stringify(saved).includes('SENSITIVE'));
});
