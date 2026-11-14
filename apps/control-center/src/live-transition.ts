import type {OperatorReader} from './obs-operator.ts';
import type {LiveWrite} from './live-contract.ts';
import {LiveFailure} from './live-contract.ts';

/** Never approximate a dissolve with a black frame or a renderer animation. */
export async function ensureDissolve(
  reader:OperatorReader,
  change:(name:LiveWrite,data:Record<string,unknown>)=>Promise<void>,
  sceneName:string,
  durationMs:number,
):Promise<void>{
  if(![300,600,900,1500,2500].includes(durationMs))throw new LiveFailure('Ungültige Überblenddauer.');
  const list=await reader.read('GetSceneTransitionList');
  const fade=Array.isArray(list.transitions)?list.transitions.find((t:Record<string,unknown>)=>t&&t.transitionKind==='fade_transition'&&typeof t.transitionName==='string'&&t.transitionName):null;
  if(!fade)throw new LiveFailure('OBS hat keine Überblendung gemeldet. Bitte eine Überblendung in OBS einrichten.');
  const override=await reader.read('GetSceneSceneTransitionOverride',{sceneName});
  if(override.transitionName===null){
    const current=await reader.read('GetCurrentSceneTransition');
    if(current.transitionKind==='fade_transition'&&current.transitionDuration===durationMs)return;
  }else if(override.transitionName===fade.transitionName&&override.transitionDuration===durationMs)return;
  // A target-scene override also protects against an existing fade-to-black override.
  await change('SetSceneSceneTransitionOverride',{sceneName,transitionName:fade.transitionName,transitionDuration:durationMs});
  const confirmed=await reader.read('GetSceneSceneTransitionOverride',{sceneName});
  if(confirmed.transitionName!==fade.transitionName||confirmed.transitionDuration!==durationMs)throw new LiveFailure('Die Überblendung wurde nicht bestätigt. Die Szene wurde nicht gewechselt.');
}
