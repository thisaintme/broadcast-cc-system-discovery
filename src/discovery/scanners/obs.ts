import OBSWebSocket from 'obs-websocket-js';
import type { ObsReport } from '../types.js';

export async function scanObs(url = 'ws://127.0.0.1:4455', password?: string): Promise<ObsReport> {
  const obs = new OBSWebSocket();
  const base: ObsReport = { status: 'unavailable', url, scenes: [], inputs: [], sceneCollections: [], profiles: [], warnings: [] };
  try {
    const identification = await obs.connect(url, password || undefined, { rpcVersion: 1 });
    const [version, sceneList, inputList, collections, profiles, streamStatus] = await Promise.all([
      obs.call('GetVersion'), obs.call('GetSceneList'), obs.call('GetInputList'), obs.call('GetSceneCollectionList'), obs.call('GetProfileList'), obs.call('GetStreamStatus'),
    ]);
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
      scenes: sceneList.scenes.map((scene) => String(scene.sceneName)),
      inputs: inputList.inputs.map((input) => ({ name: String(input.inputName), kind: String(input.inputKind), unversionedKind: input.unversionedInputKind ? String(input.unversionedInputKind) : undefined })),
      sceneCollections: collections.sceneCollections.map(String),
      profiles: profiles.profiles.map(String),
      streaming: streamStatus.outputActive,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, error: message, warnings: /authentication|password|identify/i.test(message) ? ['OBS WebSocket appears to require a password. Enter it in the app and scan again.'] : [] };
  } finally {
    try { await obs.disconnect(); } catch { /* read-only cleanup */ }
  }
}
