import type { BroadcastSystemReport, ScanOptions } from './types.js';
import { scanMac } from './scanners/macos.js';
import { scanObs } from './scanners/obs.js';
import { scanCompanion } from './scanners/companion.js';
import { scanOnvif } from './scanners/onvif.js';
import { scanX32 } from './scanners/x32.js';

export async function scanSystem(scannerVersion: string, options: ScanOptions = {}): Promise<BroadcastSystemReport> {
  const host = await scanMac();
  const [obs, companion, onvif, x32] = await Promise.all([
    scanObs(options.obsUrl || 'ws://127.0.0.1:4455', options.obsPassword),
    scanCompanion(options.companionUrl || 'http://127.0.0.1:8000'),
    scanOnvif(),
    scanX32(options.x32Hosts ?? []),
  ]);

  return {
    schemaVersion: 2,
    scannerVersion,
    generatedAt: new Date().toISOString(),
    safety: { readOnly: true, secretsIncluded: false },
    host,
    obs,
    companion,
    onvif,
    x32,
  };
}
