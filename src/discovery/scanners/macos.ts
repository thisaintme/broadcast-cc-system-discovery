import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MacReport, NetworkInterfaceAddress } from '../types.js';

const execFileAsync = promisify(execFile);

async function isRunning(pattern: string): Promise<boolean> {
  try {
    await execFileAsync('/usr/bin/pgrep', ['-if', pattern], { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function hardwareInfo(): Promise<{ model?: string; cpu?: string }> {
  if (process.platform !== 'darwin') return {};
  try {
    const { stdout } = await execFileAsync('/usr/sbin/system_profiler', ['SPHardwareDataType', '-json'], {
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as Record<string, Array<Record<string, unknown>>>;
    const item = parsed.SPHardwareDataType?.[0] ?? {};
    return {
      model: typeof item.machine_model === 'string' ? item.machine_model : undefined,
      cpu: typeof item.chip_type === 'string' ? item.chip_type : typeof item.processor_name === 'string' ? item.processor_name : undefined,
    };
  } catch {
    return {};
  }
}

export async function scanMac(): Promise<MacReport> {
  const interfaces: NetworkInterfaceAddress[] = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' && address.family !== 'IPv6') continue;
      interfaces.push({ name, family: address.family, address: address.address, netmask: address.netmask, internal: address.internal, mac: address.mac });
    }
  }

  const [hardware, obs, companion] = await Promise.all([hardwareInfo(), isRunning('OBS'), isRunning('Companion')]);
  return {
    status: 'ok', hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(),
    model: hardware.model, cpu: hardware.cpu, memoryBytes: os.totalmem(), interfaces,
    runningApps: { obs, companion }, warnings: process.platform === 'darwin' ? [] : ['This discovery app is intended for macOS.'],
  };
}
