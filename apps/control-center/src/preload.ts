import {contextBridge,ipcRenderer} from 'electron';
import type {Bridge,Snapshot} from './model.ts';
import type {AudioSnapshot} from './audio-model.ts';
const api:Bridge={
  snapshot:()=>ipcRenderer.invoke('cc:snapshot'),
  importFile:()=>ipcRenderer.invoke('cc:import'),
  exportFile:()=>ipcRenderer.invoke('cc:export'),
  saveWorkspace:w=>ipcRenderer.invoke('cc:save-workspace',w),
  inspect:p=>ipcRenderer.invoke('cc:inspect',p),
  companion:()=>ipcRenderer.invoke('cc:companion'),
  mode:m=>ipcRenderer.invoke('cc:mode',m),
  command:(c,v)=>ipcRenderer.invoke('cc:command',c,v),
  onState:callback=>{const listener=(_event:unknown,s:Snapshot)=>callback(s);ipcRenderer.on('cc:state',listener);return()=>{ipcRenderer.removeListener('cc:state',listener);};},
  audioSnapshot:()=>ipcRenderer.invoke('cc:audio-snapshot'),
  audioControl:action=>ipcRenderer.invoke('cc:audio-control',action),
  saveAudioObservation:note=>ipcRenderer.invoke('cc:audio-note',note),
  onAudio:callback=>{const listener=(_event:unknown,s:AudioSnapshot)=>callback(s);ipcRenderer.on('cc:audio',listener);return()=>{ipcRenderer.removeListener('cc:audio',listener);};},
};
contextBridge.exposeInMainWorld('controlCenter',api);
