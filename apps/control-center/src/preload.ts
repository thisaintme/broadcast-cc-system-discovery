import {contextBridge,ipcRenderer} from 'electron';
import type {Bridge,Snapshot} from './model.ts';
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
};
contextBridge.exposeInMainWorld('controlCenter',api);
