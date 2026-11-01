import type {LiveSnapshot} from './live-contract.ts';
import type {Service} from './model.ts';

/** Presentation only. A scene, permission or command is never proof of transmission. */
export const TELEMETRY_MAX_AGE_MS = 6000;
export function hasFreshTelemetry(live: LiveSnapshot, now: number, receivedAt: number): boolean {
  const checkedAt = live.observation.checkedAt;
  return live.connected && checkedAt !== null && Number.isFinite(checkedAt) &&
    now >= checkedAt && now - checkedAt < TELEMETRY_MAX_AGE_MS &&
    now >= receivedAt && now - receivedAt < TELEMETRY_MAX_AGE_MS;
}
export function transmissionStatus(live: LiveSnapshot, fresh: boolean): string {
  if (!fresh || live.observation.streaming === null) return 'UNKNOWN';
  if (live.pendingAction === 'start') return 'STARTING';
  if (live.pendingAction === 'stop') return 'STOPPING';
  if (live.observation.reconnecting) return 'RECONNECTING';
  return live.observation.streaming ? 'TRANSMITTING' : 'OFF';
}
export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return 'Unbekannt';
  const seconds = Math.floor(milliseconds / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
}
export function formatBerlinDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Ungültiges Datum';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}
export function nextService(services: readonly Service[], selectedId: string): Service | undefined {
  const selected = services.find(s => s.id === selectedId);
  if (!selected) return undefined;
  const after = Date.parse(selected.startsAt);
  return services.filter(s => Number.isFinite(Date.parse(s.startsAt)) && Date.parse(s.startsAt) > after)
    .slice().sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
}
export function upcomingService(services: readonly Service[], now: number): Service | undefined {
  return services.filter(s => Date.parse(s.startsAt) >= now)
    .slice().sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
}
export function remainingReturnSeconds(returnAt: number | null, now: number): number | null {
  return returnAt === null || !Number.isFinite(returnAt) ? null : Math.max(0, Math.ceil((returnAt - now) / 1000));
}
