import type { CompanionConnection, CompanionReport } from '../types.js';

function normalizeConnections(payload: unknown): CompanionConnection[] {
  const values = Array.isArray(payload) ? payload : payload && typeof payload === 'object' ? Object.values(payload as Record<string, unknown>) : [];
  return values.flatMap((raw): CompanionConnection[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const id = item.id ?? item.connectionId ?? item.uuid;
    if (typeof id !== 'string') return [];
    return [{
      id,
      label: typeof item.label === 'string' ? item.label : undefined,
      moduleId: typeof item.moduleId === 'string' ? item.moduleId : typeof item.module === 'string' ? item.module : undefined,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : undefined,
      status: item.status,
    }];
  });
}

export async function scanCompanion(baseUrl = 'http://127.0.0.1:8000'): Promise<CompanionReport> {
  const url = baseUrl.replace(/\/$/, '');
  try {
    const response = await fetch(`${url}/api/connections`, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { status: 'unavailable', url, connections: [], warnings: [`Companion returned HTTP ${response.status}.`] };
    const connections = normalizeConnections(await response.json());
    return { status: 'ok', url, connections, warnings: connections.length === 0 ? ['Companion responded but no connection records could be normalized.'] : [] };
  } catch (error) {
    return { status: 'unavailable', url, connections: [], warnings: [], error: error instanceof Error ? error.message : String(error) };
  }
}
