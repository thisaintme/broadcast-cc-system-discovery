export {};

declare global {
  interface Window {
    broadcastDiscovery: {
      scan(options: import('../discovery/types.js').ScanOptions): Promise<import('../discovery/types.js').BroadcastSystemReport>;
      save(): Promise<{ saved: boolean; path?: string; reason?: string }>;
    };
  }
}
