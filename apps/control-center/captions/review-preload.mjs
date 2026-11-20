import {ipcRenderer,contextBridge} from 'electron';
contextBridge.exposeInMainWorld('captions',Object.freeze({status:()=>ipcRenderer.invoke('caption:status'),arm:v=>ipcRenderer.invoke('caption:arm',v),review:id=>ipcRenderer.invoke('caption:review',id),apply:(title,description)=>ipcRenderer.invoke('caption:apply',{title,description})}));
