import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { scanSystem } from './discovery/scan.js';
import type { BroadcastSystemReport, ScanOptions } from './discovery/types.js';

let latestReport: BroadcastSystemReport | null = null;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 760,
    minHeight: 600,
    title: 'Broadcast CC System Discovery',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('discovery:scan', async (_event, options: ScanOptions) => {
    latestReport = await scanSystem(app.getVersion(), options);
    return latestReport;
  });

  ipcMain.handle('discovery:save', async () => {
    if (!latestReport) return { saved: false, reason: 'No scan has been run yet.' };
    const result = await dialog.showSaveDialog({
      title: 'Export Broadcast System Report',
      defaultPath: 'broadcast-system-report.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await writeFile(result.filePath, `${JSON.stringify(latestReport, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { saved: true, path: result.filePath };
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
