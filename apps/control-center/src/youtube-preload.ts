import {contextBridge,ipcRenderer} from 'electron';
import type {YouTubeBridge} from './youtube-model.ts';
const api:YouTubeBridge={
  panel:()=>ipcRenderer.invoke('youtube:panel'),refresh:()=>ipcRenderer.invoke('youtube:refresh'),
  configure:()=>ipcRenderer.invoke('youtube:configure'),signIn:()=>ipcRenderer.invoke('youtube:sign-in'),disconnect:()=>ipcRenderer.invoke('youtube:disconnect'),
  command:command=>ipcRenderer.invoke('youtube:command',command),cancel:()=>ipcRenderer.invoke('youtube:cancel'),
  openBroadcast:id=>ipcRenderer.invoke('youtube:open',id),copyLink:id=>ipcRenderer.invoke('youtube:copy-link',id),
};
contextBridge.exposeInMainWorld('youtubeBroadcasts',api);
