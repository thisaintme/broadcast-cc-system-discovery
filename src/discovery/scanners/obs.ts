import OBSWebSocket from 'obs-websocket-js';
import type { ObsReport, ObsSceneDetail, ObsSceneItem } from '../types.js';

function normalizeSceneItem(raw: unknown): ObsSceneItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = Number(item.sceneItemId);
  const sourceName = typeof item.sourceName === 'string' ? item.sourceName : '';
  if (!Number.isFinite(id) || !sourceName) return null;

  return {
    sceneItemId: id,
    sourceName,
    sourceType: typeof item.sourceType === 'string' ? item.sourceType : undefined,
    inputKind: typeof item.inputKind === 'string' ? item.inputKind : item.inputKind === null ? null : undefined,
    enabled: typeof item.sceneItemEnabled === 'boolean' ? item.sceneItemEnabled : undefined,
    locked: typeof item.sceneItemLocked === 'boolean' ? item.sceneItemLocked : undefined,
    blendMode: typeof item.sceneItemBlendMode === 'string' ? item.sceneItemBlendMode : undefined,
  };
}

export async function scanObs(url = 'ws://127.0.0.1:4455', password?: string): Promise<ObsReport> {
  const obs = new OBSWebSocket();
  const base: ObsReport = {
    status: 'unavailable',
    url,
    scenes: [],
    sceneDetails: [],
    inputs: [],
    sceneCollections: [],
    profiles: [],
    warnings: [],
  };

  try {
    const identification = await obs.connect(url, password || undefined, { rpcVersion: 1 });
    const [version, sceneList, inputList, collections, profiles, streamStatus] = await Promise.all([
      obs.call('GetVersion'),
      obs.call('GetSceneList'),
      obs.call('GetInputList'),
      obs.call('GetSceneCollectionList'),
      obs.call('GetProfileList'),
      obs.call('GetStreamStatus'),
    ]);

    const sceneNames = sceneList.scenes.map((scene) => String(scene.sceneName));
    const sceneDetails: ObsSceneDetail[] = [];

    for (const sceneName of sceneNames) {
      try {
        const response = await obs.call('GetSceneItemList', { sceneName });
        const items = response.sceneItems
          .map((item) => normalizeSceneItem(item))
          .filter((item): item is ObsSceneItem => item !== null);
        sceneDetails.push({ name: sceneName, items, warnings: [] });
      } catch (error) {
        sceneDetails.push({
          name: sceneName,
          items: [],
          warnings: [`Could not enumerate scene items: ${error instanceof Error ? error.message : String(error)}`],
        });
      }
    }

    return {
      ...base,
      status: 'ok',
      obsVersion: version.obsVersion,
      obsWebSocketVersion: version.obsWebSocketVersion,
      rpcVersion: identification.negotiatedRpcVersion,
      currentProgramScene: sceneList.currentProgramSceneName,
      currentPreviewScene: sceneList.currentPreviewSceneName ?? null,
      currentSceneCollection: collections.currentSceneCollectionName,
      currentProfile: profiles.currentProfileName,
      scenes: sceneNames,
      sceneDetails,
      inputs: inputList.inputs.map((input) => ({
        name: String(input.inputName),
        kind: String(input.inputKind),
        unversionedKind: input.unversionedInputKind ? String(input.unversionedInputKind) : undefined,
      })),
      sceneCollections: collections.sceneCollections.map(String),
      profiles: profiles.profiles.map(String),
      streaming: streamStatus.outputActive,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      error: message,
      warnings: /authentication|password|identify/i.test(message)
        ? ['OBS WebSocket appears to require a password. Enter it in the app and scan again.']
        : [],
    };
  } finally {
    try { await obs.disconnect(); } catch { /* read-only cleanup */ }
  }
}
