import dgram from 'node:dgram';
import crypto from 'node:crypto';
import type { OnvifDevice, OnvifReport } from '../types.js';

const MULTICAST_ADDRESS = '239.255.255.250';
const MULTICAST_PORT = 3702;

function probeMessage(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
 xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
 xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:${crypto.randomUUID()}</w:MessageID>
    <w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>
</e:Envelope>`;
}

function tagValues(xml: string, localName: string): string[] {
  const pattern = new RegExp(`<(?:(?:\\w+):)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${localName}>`, 'gi');
  return [...xml.matchAll(pattern)].map((match) => match[1]?.replace(/<[^>]+>/g, '').trim()).filter((value): value is string => Boolean(value));
}

function parseResponse(xml: string, remoteAddress: string): OnvifDevice | null {
  const xaddrs = tagValues(xml, 'XAddrs').flatMap((value) => value.split(/\s+/)).filter(Boolean);
  if (xaddrs.length === 0) return null;
  return {
    remoteAddress,
    xaddrs,
    types: tagValues(xml, 'Types').flatMap((value) => value.split(/\s+/)).filter(Boolean),
    scopes: tagValues(xml, 'Scopes').flatMap((value) => value.split(/\s+/)).filter(Boolean),
    endpointReference: tagValues(xml, 'Address')[0],
  };
}

export async function scanOnvif(timeoutMs = 3000): Promise<OnvifReport> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const devices = new Map<string, OnvifDevice>();
    let settled = false;
    const finish = (status: OnvifReport['status'], error?: string) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* noop */ }
      resolve({ status, devices: [...devices.values()], warnings: [], error });
    };
    socket.on('message', (message, remote) => {
      const device = parseResponse(message.toString('utf8'), remote.address);
      if (!device) return;
      devices.set(device.endpointReference ?? `${remote.address}|${device.xaddrs.join(',')}`, device);
    });
    socket.on('error', (error) => finish('error', error.message));
    socket.bind(0, () => {
      const payload = Buffer.from(probeMessage(), 'utf8');
      socket.send(payload, MULTICAST_PORT, MULTICAST_ADDRESS, (error) => { if (error) finish('error', error.message); });
      setTimeout(() => finish('ok'), timeoutMs).unref();
    });
  });
}
