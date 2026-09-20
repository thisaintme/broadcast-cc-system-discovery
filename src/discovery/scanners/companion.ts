import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  CompanionAction,
  CompanionButtonMapping,
  CompanionConnection,
  CompanionReport,
} from '../types.js';

const execFileAsync = promisify(execFile);
const SENSITIVE_KEY = /(pass(word)?|secret|token|credential|authorization|cookie|api[_-]?key)/i;

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key) || key === 'png64') continue;
    result[key] = sanitizeValue(child);
  }
  return result;
}

function normalizeConnections(payload: unknown): CompanionConnection[] {
  const values = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? Object.entries(payload as Record<string, unknown>).map(([id, value]) => ({ id, value }))
      : [];

  return values.flatMap((entry): CompanionConnection[] => {
    const raw = entry && typeof entry === 'object' && 'value' in entry
      ? (entry as { id: string; value: unknown })
      : { id: '', value: entry };

    if (!raw.value || typeof raw.value !== 'object') return [];
    const item = raw.value as Record<string, unknown>;
    const config = item.config && typeof item.config === 'object' ? item.config as Record<string, unknown> : {};
    const id = raw.id || String(item.id ?? item.connectionId ?? item.uuid ?? '');
    if (!id) return [];

    const hostCandidate = config.host ?? config.ipAddress ?? config.address;
    const portCandidate = config.port;

    return [{
      id,
      label: typeof item.label === 'string' ? item.label : undefined,
      moduleId:
        typeof item.instance_type === 'string' ? item.instance_type :
        typeof item.moduleId === 'string' ? item.moduleId :
        typeof item.module === 'string' ? item.module : undefined,
      moduleVersion: typeof item.moduleVersionId === 'string' ? item.moduleVersionId : undefined,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : undefined,
      status: item.status,
      host: typeof hostCandidate === 'string' ? hostCandidate : undefined,
      port: typeof portCandidate === 'string' || typeof portCandidate === 'number' ? portCandidate : undefined,
    }];
  });
}

function normalizeButtons(pages: unknown): CompanionButtonMapping[] {
  if (!pages || typeof pages !== 'object') return [];
  const result: CompanionButtonMapping[] = [];

  for (const [pageKey, pageRaw] of Object.entries(pages as Record<string, unknown>)) {
    if (!pageRaw || typeof pageRaw !== 'object') continue;
    const controls = (pageRaw as Record<string, unknown>).controls;
    if (!controls || typeof controls !== 'object') continue;

    for (const [rowKey, rowRaw] of Object.entries(controls as Record<string, unknown>)) {
      if (!rowRaw || typeof rowRaw !== 'object') continue;

      for (const [columnKey, controlRaw] of Object.entries(rowRaw as Record<string, unknown>)) {
        if (!controlRaw || typeof controlRaw !== 'object') continue;
        const control = controlRaw as Record<string, unknown>;
        if (control.type !== 'button') continue;

        const style = control.style && typeof control.style === 'object' ? control.style as Record<string, unknown> : {};
        const steps = control.steps && typeof control.steps === 'object' ? control.steps as Record<string, unknown> : {};
        const actions: CompanionAction[] = [];

        for (const stepRaw of Object.values(steps)) {
          if (!stepRaw || typeof stepRaw !== 'object') continue;
          const actionSets = (stepRaw as Record<string, unknown>).action_sets;
          if (!actionSets || typeof actionSets !== 'object') continue;

          for (const [event, actionList] of Object.entries(actionSets as Record<string, unknown>)) {
            if (!Array.isArray(actionList)) continue;
            for (const actionRaw of actionList) {
              if (!actionRaw || typeof actionRaw !== 'object') continue;
              const action = actionRaw as Record<string, unknown>;
              actions.push({
                event,
                connectionId: typeof action.connectionId === 'string' ? action.connectionId : undefined,
                definitionId: typeof action.definitionId === 'string' ? action.definitionId : undefined,
                options: action.options && typeof action.options === 'object'
                  ? sanitizeValue(action.options) as Record<string, unknown>
                  : undefined,
              });
            }
          }
        }

        const label = typeof style.text === 'string' && style.text.trim() ? style.text.trim() : undefined;
        if (!label && actions.length === 0) continue;

        result.push({
          page: Number(pageKey),
          row: Number(rowKey),
          column: Number(columnKey),
          label,
          actions,
        });
      }
    }
  }

  return result;
}

function responsePrefix(text: string): string | undefined {
  const trimmed = text.trimStart();
  if (!trimmed) return undefined;
  const prefix = trimmed.slice(0, 160).replace(/[\r\n\t]+/g, ' ');
  return prefix.replace(/("(?:pass(?:word)?|secret|token|credential|authorization|cookie|api[_-]?key)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"');
}

async function readCompanionExport(baseUrl: string): Promise<{
  json: Record<string, unknown>;
  httpStatus?: number;
  contentType?: string;
  bytes: number;
  prefix?: string;
}> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'broadcast-cc-companion-'));
  const headersFile = path.join(tempDir, 'headers.txt');
  const bodyFile = path.join(tempDir, 'body.json');
  const exportUrl = `${baseUrl.replace(/\/$/, '')}/int/export/full?format=json`;

  try {
    const { stdout } = await execFileAsync('/usr/bin/curl', [
      '--silent',
      '--show-error',
      '--location',
      '--max-time', '10',
      '--dump-header', headersFile,
      '--output', bodyFile,
      '--write-out', '%{http_code}\n%{content_type}',
      exportUrl,
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });

    const [body, headers] = await Promise.all([
      readFile(bodyFile, 'utf8'),
      readFile(headersFile, 'utf8').catch(() => ''),
    ]);

    const [statusLine, contentTypeLine] = stdout.trim().split(/\r?\n/);
    const httpStatus = Number(statusLine);
    const headerType = headers.match(/^content-type:\s*([^\r\n]+)/im)?.[1]?.trim();
    const contentType = contentTypeLine || headerType;

    if (!body.trim()) throw new Error(`Companion export returned an empty body (HTTP ${httpStatus || 'unknown'}).`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      const prefix = responsePrefix(body);
      throw new Error(
        `Companion export was not valid JSON (HTTP ${httpStatus || 'unknown'}, content-type ${contentType || 'unknown'}, ${Buffer.byteLength(body)} bytes${prefix ? `, prefix: ${prefix}` : ''}). ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Companion export JSON was not an object.');
    }

    return {
      json: parsed as Record<string, unknown>,
      httpStatus: Number.isFinite(httpStatus) ? httpStatus : undefined,
      contentType: contentType || undefined,
      bytes: Buffer.byteLength(body),
      prefix: responsePrefix(body),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readConnectionsApi(baseUrl: string): Promise<CompanionConnection[]> {
  const root = baseUrl.replace(/\/$/, '');
  for (const route of ['/api/connections', '/api/v1/connections']) {
    try {
      const response = await fetch(`${root}${route}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) continue;
      const text = await response.text();
      const payload = JSON.parse(text);
      const normalized = normalizeConnections(payload);
      if (normalized.length) return normalized;
    } catch {
      // Companion API shape varies by version. Full export is the primary path.
    }
  }
  return [];
}

export async function scanCompanion(baseUrl = 'http://127.0.0.1:8000'): Promise<CompanionReport> {
  const url = baseUrl.replace(/\/$/, '');
  const exportUrl = `${url}/int/export/full?format=json`;

  try {
    const exported = await readCompanionExport(url);
    const build = typeof exported.json.companionBuild === 'string' ? exported.json.companionBuild : undefined;
    const connections = normalizeConnections(exported.json.instances);
    const buttons = normalizeButtons(exported.json.pages);

    return {
      status: 'ok',
      url,
      connections,
      buttons,
      diagnostics: {
        source: 'full-export',
        companionBuild: build,
        exportUrl,
        exportHttpStatus: exported.httpStatus,
        exportContentType: exported.contentType,
        exportBytes: exported.bytes,
      },
      warnings: [
        ...(connections.length === 0 ? ['Companion export contained no connection records that could be normalized.'] : []),
        ...(buttons.length === 0 ? ['Companion export contained no button/action mappings that could be normalized.'] : []),
      ],
    };
  } catch (exportError) {
    const apiConnections = await readConnectionsApi(url);
    if (apiConnections.length) {
      return {
        status: 'ok',
        url,
        connections: apiConnections,
        buttons: [],
        diagnostics: { source: 'api', exportUrl },
        warnings: [`Full Companion export failed; using lightweight connection API only: ${exportError instanceof Error ? exportError.message : String(exportError)}`],
      };
    }

    return {
      status: 'unavailable',
      url,
      connections: [],
      buttons: [],
      diagnostics: { exportUrl },
      warnings: [],
      error: exportError instanceof Error ? exportError.message : String(exportError),
    };
  }
}
