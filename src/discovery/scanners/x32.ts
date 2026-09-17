import dgram from 'node:dgram';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { X32Device, X32Report } from '../types.js';

const execFileAsync = promisify(execFile);
const X32_PORT = 10023;

function pad4(buffer: Buffer): Buffer {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding)]) : buffer;
}

function oscString(value: string): Buffer {
  return pad4(Buffer.from(`${value}\0`, 'utf8'));
}

function oscMessage(address: string): Buffer {
  return Buffer.concat([oscString(address), oscString(',')]);
}

function parseOscStrings(buffer: Buffer): string[] {
  const values: string[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const end = buffer.indexOf(0, offset);
    if (end < 0) break;
    const value = buffer.subarray(offset, end).toString('utf8');
    if (value) values.push(value);
    offset = end + 1;
    while (offset % 4 !== 0) offset += 1;
  }
  return values;
}

async function arpCandidates(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  try {
    const { stdout } = await execFileAsync('/usr/sbin/arp', ['-an'], { timeout: 2000, maxBuffer: 1024 * 1024 });
    const hosts = new Set<string>();
    for (const match of stdout.matchAll(/\((\d{1,3}(?:\.\d{1,3}){3})\)/g)) if (match[1]) hosts.add(match[1]);
    return [...hosts];
  } catch {
    return [];
  }
}

async function probeHost(address: string, timeoutMs = 400): Promise<X32Device | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = (device: X32Device | null) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* noop */ }
      resolve(device);
    };
    socket.on('message', (message, remote) => {
      if (remote.address !== address) return;
      const strings = parseOscStrings(message);
      if (!strings.includes('/info')) return;
      finish({ address, port: X32_PORT, response: strings, model: strings.find((value) => /^(X32|M32)/i.test(value)), firmware: strings.find((value) => /^\d+\.\d+/.test(value)) });
    });
    socket.once('error', () => finish(null));
    socket.send(oscMessage('/info'), X32_PORT, address, (error) => { if (error) finish(null); });
    setTimeout(() => finish(null), timeoutMs).unref();
  });
}

export async function scanX32(configuredHosts: string[] = []): Promise<X32Report> {
  const candidates = [...new Set([...configuredHosts.map((host) => host.trim()).filter(Boolean), ...await arpCandidates()])];
  const warnings: string[] = [];
  if (candidates.length === 0) return { status: 'ok', devices: [], probedAddresses: [], warnings: ['No X32 candidates were available. Add the mixer IP in Connection settings if needed.'] };
  const devices = (await Promise.all(candidates.map((address) => probeHost(address)))).filter((device): device is X32Device => device !== null);
  if (devices.length === 0) warnings.push('No X32/M32 replied to the read-only OSC /info probe.');
  return { status: 'ok', devices, probedAddresses: candidates, warnings };
}
