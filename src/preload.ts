import { contextBridge, ipcRenderer } from 'electron';
import type { BroadcastSystemReport, ScanOptions } from './discovery/types.js';

type SaveResult = { saved: boolean; path?: string; reason?: string };

contextBridge.exposeInMainWorld('broadcastDiscovery', {
  scan: (options: ScanOptions): Promise<BroadcastSystemReport> => ipcRenderer.invoke('discovery:scan', options),
  save: (): Promise<SaveResult> => ipcRenderer.invoke('discovery:save'),
});
