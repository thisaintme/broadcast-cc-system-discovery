import {contextBridge,ipcRenderer} from 'electron';
import type {LiveAppBridge,LiveSiteSnapshot} from './live-app.ts';
const onSite=(callback:(s:LiveSiteSnapshot)=>void)=>{const listener=(_event:unknown,s:LiveSiteSnapshot)=>callback(s);ipcRenderer.on('live:state',listener);return()=>ipcRenderer.removeListener('live:state',listener);};
const api:LiveAppBridge={
  outro:()=>ipcRenderer.invoke('live:outro'),
  broadcast:kind=>ipcRenderer.invoke('live:broadcast',kind),
  scheduleEnd:scope=>ipcRenderer.invoke('live:schedule-end',scope),
  cancelEnd:()=>ipcRenderer.invoke('live:cancel-end'),
  saveObsCredential:(password,autoConnect)=>ipcRenderer.invoke('live:save-credential',password,autoConnect),
  forgetObsCredential:()=>ipcRenderer.invoke('live:forget-credential'),
  connectSaved:()=>ipcRenderer.invoke('live:connect-saved'),
  cue:change=>ipcRenderer.invoke('live:cue',change),
  monitor:slot=>ipcRenderer.invoke('live:monitor',slot),
  openStreamManagement:()=>ipcRenderer.invoke('live:open-stream-management'),
  site:()=>ipcRenderer.invoke('live:site'),snapshot:()=>ipcRenderer.invoke('live:snapshot'),
  onSite,onState:callback=>onSite(s=>callback(s.live)),
  connect:password=>ipcRenderer.invoke('live:connect',password),saveWorkspace:w=>ipcRenderer.invoke('live:save',w),
  changeServices:change=>ipcRenderer.invoke('live:services',change),operatorData:query=>ipcRenderer.invoke('live:operator-data',query),
  importWorkspace:()=>ipcRenderer.invoke('live:import'),exportWorkspace:()=>ipcRenderer.invoke('live:export'),
  inspectCompanion:()=>ipcRenderer.invoke('live:companion'),
  enable:p=>ipcRenderer.invoke('live:enable',p),release:()=>ipcRenderer.invoke('live:release'),cancelReturn:()=>ipcRenderer.invoke('live:cancel-return'),
  selectService:id=>ipcRenderer.invoke('live:select',id),adoptPhase:phase=>ipcRenderer.invoke('live:phase',phase),
  command:(command,value)=>ipcRenderer.invoke('live:command',command,value),journal:()=>ipcRenderer.invoke('live:journal'),exportJournal:()=>ipcRenderer.invoke('live:export-journal'),advanced:()=>ipcRenderer.invoke('live:advanced'),
};
contextBridge.exposeInMainWorld('liveService',api);

// The live desk receives only the same narrowly scoped management API as its dedicated window.
contextBridge.exposeInMainWorld('streamManagement',Object.freeze({
  panel:()=>ipcRenderer.invoke('stream-management:panel'),
  preview: (value:unknown)=>ipcRenderer.invoke('stream-management:preview',value),
  seriesPreview: (value:unknown)=>ipcRenderer.invoke('stream-management:series-preview',value),
  action:(value:unknown)=>ipcRenderer.invoke('stream-management:action',value),
  cancel:()=>ipcRenderer.invoke('stream-management:cancel'),
  subscribe:(callback:(value:unknown)=>void)=>{const listener=(_event:unknown,value:unknown)=>callback(value);ipcRenderer.on('stream-management:state',listener);return()=>ipcRenderer.removeListener('stream-management:state',listener);},
}));
