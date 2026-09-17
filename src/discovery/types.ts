export type ScanStatus = 'ok' | 'unavailable' | 'error';

export interface NetworkInterfaceAddress {
  name: string;
  family: 'IPv4' | 'IPv6';
  address: string;
  netmask: string;
  internal: boolean;
  mac?: string;
}

export interface MacReport {
  status: ScanStatus;
  hostname?: string;
  platform?: string;
  release?: string;
  arch?: string;
  model?: string;
  cpu?: string;
  memoryBytes?: number;
  interfaces: NetworkInterfaceAddress[];
  runningApps: { obs: boolean; companion: boolean };
  warnings: string[];
}

export interface ObsReport {
  status: ScanStatus;
  url: string;
  obsVersion?: string;
  obsWebSocketVersion?: string;
  rpcVersion?: number;
  currentProgramScene?: string;
  currentPreviewScene?: string | null;
  currentSceneCollection?: string;
  currentProfile?: string;
  scenes: string[];
  inputs: Array<{ name: string; kind: string; unversionedKind?: string }>;
  sceneCollections: string[];
  profiles: string[];
  streaming?: boolean;
  warnings: string[];
  error?: string;
}

export interface CompanionConnection {
  id: string;
  label?: string;
  moduleId?: string;
  enabled?: boolean;
  status?: unknown;
}

export interface CompanionReport {
  status: ScanStatus;
  url: string;
  connections: CompanionConnection[];
  warnings: string[];
  error?: string;
}

export interface OnvifDevice {
  remoteAddress: string;
  xaddrs: string[];
  types: string[];
  scopes: string[];
  endpointReference?: string;
}

export interface OnvifReport {
  status: ScanStatus;
  devices: OnvifDevice[];
  warnings: string[];
  error?: string;
}

export interface X32Device {
  address: string;
  port: number;
  response?: string[];
  model?: string;
  firmware?: string;
}

export interface X32Report {
  status: ScanStatus;
  devices: X32Device[];
  probedAddresses: string[];
  warnings: string[];
  error?: string;
}

export interface BroadcastSystemReport {
  schemaVersion: 1;
  scannerVersion: string;
  generatedAt: string;
  safety: { readOnly: true; secretsIncluded: false };
  host: MacReport;
  obs: ObsReport;
  companion: CompanionReport;
  onvif: OnvifReport;
  x32: X32Report;
}

export interface ScanOptions {
  obsUrl?: string;
  obsPassword?: string;
  companionUrl?: string;
  x32Hosts?: string[];
}
