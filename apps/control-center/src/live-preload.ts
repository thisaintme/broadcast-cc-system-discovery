import {contextBridge,ipcRenderer} from 'electron';
import type {LiveAppBridge,LiveSiteSnapshot} from './live-app.ts';
const onSite=(callback:(s:LiveSiteSnapshot)=>void)=>{const listener=(_event:unknown,s:LiveSiteSnapshot)=>callback(s);ipcRenderer.on('live:state',listener);return()=>ipcRenderer.removeListener('live:state',listener);};
const api:LiveAppBridge={
  site:()=>ipcRenderer.invoke('live:site'),snapshot:()=>ipcRenderer.invoke('live:snapshot'),
  onSite,onState:callback=>onSite(s=>callback(s.live)),
  connect:password=>ipcRenderer.invoke('live:connect',password),saveWorkspace:w=>ipcRenderer.invoke('live:save',w),
  changeServices:change=>ipcRenderer.invoke('live:services',change),
  importWorkspace:()=>ipcRenderer.invoke('live:import'),exportWorkspace:()=>ipcRenderer.invoke('live:export'),
  inspectCompanion:()=>ipcRenderer.invoke('live:companion'),
  enable:p=>ipcRenderer.invoke('live:enable',p),release:()=>ipcRenderer.invoke('live:release'),cancelReturn:()=>ipcRenderer.invoke('live:cancel-return'),
  selectService:id=>ipcRenderer.invoke('live:select',id),adoptPhase:phase=>ipcRenderer.invoke('live:phase',phase),
  command:(command,value)=>ipcRenderer.invoke('live:command',command,value),journal:()=>ipcRenderer.invoke('live:journal'),exportJournal:()=>ipcRenderer.invoke('live:export-journal'),advanced:()=>ipcRenderer.invoke('live:advanced'),
};
contextBridge.exposeInMainWorld('liveService',api);
