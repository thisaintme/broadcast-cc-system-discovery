import type {Reader, Inventory, SceneNode, AudioState, ReadRequest, TransportState} from './model.ts';
import {object, text} from './workspace.ts';
/** Read-only graph traversal. Groups have a separate OBS request; cycles are never expanded twice. */
export async function inspectObs(reader: Reader): Promise<Inventory> {
  const [scenes, inputs, collections] = await Promise.all([
    reader.read('GetSceneList'),reader.read('GetInputList'),reader.read('GetSceneCollectionList'),
  ]);
  const warnings:string[]=[];
  let groups:string[]=[];
  try { groups=(await reader.read('GetGroupList')).groups.map(String); }
  catch { warnings.push('Group list unavailable; using per-item group flags. Unresolved containers remain marked.'); }
  const names=(scenes.scenes || []).map((s:any)=>text(s.sceneName));
  const queue=[...names,...groups].map(name=>({name,group:groups.includes(name)}));
  const visited=new Set<string>(); const nodes:SceneNode[]=[];
  while(queue.length && nodes.length<180) {
    const next=queue.shift()!;
    if(visited.has(next.name)) continue;
    visited.add(next.name);
    const node:SceneNode={name:next.name,type:next.group?'group':'scene',items:[],warnings:[]};
    try {
      const result=await reader.read(next.group?'GetGroupSceneItemList':'GetSceneItemList',{sceneName:next.name});
      node.items=(result.sceneItems || []).slice(0,1000).map((x:any,index:number)=>({
        id:Number(x.sceneItemId), source:text(x.sourceName), kind:text(x.inputKind) || null,
        group:x.isGroup===true || groups.includes(x.sourceName),
        container:x.sourceType==='OBS_SOURCE_TYPE_SCENE', enabled:x.sceneItemEnabled===true,
        index:Number.isInteger(x.sceneItemIndex)?x.sceneItemIndex:index,
      }));
      for(const item of node.items) if(item.group || item.container) queue.push({name:item.source,group:item.group});
    } catch { node.type='unknown'; node.warnings.push('Could not read this container. No changes were made.'); }
    nodes.push(node);
  }
  if(queue.length) warnings.push('Container limit reached. Inspection is incomplete.');
  const audio:AudioState[]=[];
  const inputList=(inputs.inputs || []).slice(0,150).map((x:any)=>({name:text(x.inputName),kind:text(x.inputKind)}));
  for(const input of inputList) {
    // Includes capture sources with embedded audio, not just explicitly named microphones.
    if(!/audio|capture|avcapture|ffmpeg|vlc|browser/.test(input.kind)) continue;
    let mute:Record<string,any>;
    try { mute=await reader.read('GetInputMute',{inputName:input.name}); } catch { continue; }
    const a:AudioState={name:input.name, muted:typeof mute.inputMuted==='boolean'?mute.inputMuted:null,
      volumeDb:null, monitor:null,tracks:{},warnings:[]};
    for(const name of ['GetInputVolume','GetInputAudioMonitorType','GetInputAudioTracks'] as ReadRequest[]) {
      try {
        const result=await reader.read(name,{inputName:input.name});
        if(name==='GetInputVolume') a.volumeDb=Number.isFinite(result.inputVolumeDb)?result.inputVolumeDb:null;
        if(name==='GetInputAudioMonitorType') a.monitor=text(result.monitorType);
        if(name==='GetInputAudioTracks') for(const [k,v] of Object.entries(object(result.inputAudioTracks)))
          if(/^[1-6]$/.test(k) && typeof v==='boolean') a.tracks[k]=v;
      } catch { a.warnings.push(`${name} unavailable.`); }
    }
    audio.push(a);
  }
  const finish=await reader.read('GetSceneCollectionList');
  if(finish.currentSceneCollectionName!==collections.currentSceneCollectionName)
    throw new Error('Scene collection changed during inspection. Inspect again.');
  return {origin:'live',collection:text(collections.currentSceneCollectionName),scenes:names,
    inputs:inputList,nodes,audio,warnings,capturedAt:new Date().toISOString()};
}
export async function readTransport(reader:Reader): Promise<TransportState> {
  const [stream,record,virtual,replay,studio,scenes,collection]=await Promise.all([
    reader.read('GetStreamStatus'),reader.read('GetRecordStatus'),reader.read('GetVirtualCamStatus'),
    reader.read('GetReplayBufferStatus'),reader.read('GetStudioModeEnabled'),reader.read('GetSceneList'),reader.read('GetSceneCollectionList'),
  ]);
  const flag=(v:unknown)=>typeof v==='boolean'?v:null;
  return {connected:true,streaming:flag(stream.outputActive),recording:flag(record.outputActive),
    virtualCamera:flag(virtual.outputActive),replayBuffer:flag(replay.outputActive),studio:flag(studio.studioModeEnabled),
    preview:text(scenes.currentPreviewSceneName),program:text(scenes.currentProgramSceneName),
    collection:text(collection.currentSceneCollectionName)};
}
export function assertPreviewSafe(state:TransportState, collection:string): void {
  if(!state.connected || !collection || state.collection!==collection) throw new Error('Connect and inspect the expected OBS scene collection first.');
  if([state.streaming,state.recording,state.virtualCamera,state.replayBuffer].some(v=>v!==false))
    throw new Error('Preview rehearsal is blocked: an OBS output is active or its status is unknown.');
  if(state.studio!==true) throw new Error('Enable OBS Studio Mode manually before Preview rehearsal.');
}
