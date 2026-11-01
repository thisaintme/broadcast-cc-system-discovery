import { contextBridge, ipcRenderer } from 'electron';
import type { ManagementBridge, ManagementPanel } from './stream-management-contract.ts';
const bridge: ManagementBridge = {
    panel: () => ipcRenderer.invoke('stream-management:panel'),
    preview: value => ipcRenderer.invoke('stream-management:preview', value),
    action: value => ipcRenderer.invoke('stream-management:action', value),
    cancel: () => ipcRenderer.invoke('stream-management:cancel'),
    subscribe: callback => {
        const listener = (_event: Electron.IpcRendererEvent, panel: ManagementPanel) => callback(panel);
        ipcRenderer.on('stream-management:state', listener);
        return () => ipcRenderer.removeListener('stream-management:state', listener);
    },
};
contextBridge.exposeInMainWorld('streamManagement', Object.freeze(bridge));
