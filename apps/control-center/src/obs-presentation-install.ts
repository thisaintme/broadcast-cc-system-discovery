import {LiveFailure} from './live-contract.ts';
import {PRESENTATION_ROLES} from './presentation-model.ts';
import type {PresentationRole} from './presentation-model.ts';
export const OWNED_SCENE_NAMES:Record<PresentationRole,string>={intro:'BCC · Intro',main:'BCC · Main',chapter:'BCC · Kapitel',interlude:'BCC · Zwischenbild',singing:'BCC · Singen',prayer:'BCC · Beten',remote:'BCC · Stream',outro:'BCC · Outro'};
export interface InstallerPort {read(name:string,data?:Record<string,unknown>):Promise<Record<string,any>>;write(name:string,data:Record<string,unknown>):Promise<Record<string,any>>}
export interface InstallPlan {collection:string;profile:string;cameraScene:string;remoteScene:string;inputs:Record<PresentationRole,{name:string;url:string}>}
/** Offline-only, narrowly defined creation. Never replaces an existing source, scene, layout or stream destination. */
export async function installPresentation(port:InstallerPort,plan:InstallPlan,valid:()=>boolean,record:(detail:string)=>Promise<void>):Promise<Record<PresentationRole,string>>{
  const check=async()=>{if(!valid())throw new LiveFailure('Die Einrichtung wurde abgebrochen.');const [collections,profiles,stream,recording]=await Promise.all([port.read('GetSceneCollectionList'),port.read('GetProfileList'),port.read('GetStreamStatus'),port.read('GetRecordStatus')]);if(!valid()||collections.currentSceneCollectionName!==plan.collection||profiles.currentProfileName!==plan.profile||stream.outputActive!==false||stream.outputReconnecting!==false||recording.outputActive!==false)throw new LiveFailure('Die Einrichtung benötigt bestätigte, gestoppte Übertragung und Aufnahme sowie dieselbe OBS-Sammlung.');};
  await check();
  const scenes=await port.read('GetSceneList'),inputs=await port.read('GetInputList'),video=await port.read('GetVideoSettings');
  if(!Array.isArray(scenes.scenes)||!Array.isArray(inputs.inputs)||!scenes.scenes.some((s:any)=>s.sceneName===plan.cameraScene)||Object.values(OWNED_SCENE_NAMES).includes(plan.cameraScene))throw new LiveFailure('Bitte die vorhandene Kameraszene als Grundlage auswählen.');
  if(plan.remoteScene&&(!scenes.scenes.some((s:any)=>s.sceneName===plan.remoteScene)||Object.values(OWNED_SCENE_NAMES).includes(plan.remoteScene)))throw new LiveFailure('Bitte eine vorhandene Zuschaltungsszene wählen.');
  if(!Number.isInteger(video.baseWidth)||!Number.isInteger(video.baseHeight)||video.baseWidth<320||video.baseWidth>7680||video.baseHeight<180||video.baseHeight>4320)throw new LiveFailure('Die OBS-Leinwand konnte nicht geprüft werden.');
  // A collision stops the entire plan before the first creation: no guessing ownership.
  if(scenes.scenes.some((s:any)=>Object.values(OWNED_SCENE_NAMES).includes(s.sceneName))||inputs.inputs.some((i:any)=>Object.values(plan.inputs).some(p=>p.name===i.inputName)))throw new LiveFailure('BCC-Szenen oder -Quellen sind bereits vorhanden. Bestehende Einrichtung weiterverwenden oder die gemeldeten BCC-Elemente nach Sicherung in OBS entfernen. Nichts wurde überschrieben.');
  const write=async(name:string,data:Record<string,unknown>)=>{await check();await record(`${name}: ${String(data.sceneName||data.inputName||'BCC')}`);await check();const result=await port.write(name,data);if(!valid())throw new LiveFailure('Einrichtung unterbrochen. Bereits angelegte BCC-Elemente bleiben zur Prüfung erhalten.');return result;};
  const result={...OWNED_SCENE_NAMES};
  for(const role of PRESENTATION_ROLES){
    if(role==='remote'&&!plan.remoteScene){result.remote='';continue;}
    const sceneName=OWNED_SCENE_NAMES[role],source=plan.inputs[role];
    if(!source.name.startsWith('BCC')||!/^http:\/\/127\.0\.0\.1:\d+\/overlay\/(intro|main|chapter|interlude|singing|prayer|remote|outro)\?key=[a-f0-9]{64}$/.test(source.url))throw new LiveFailure('Ungültiger interner Einblendungsplan.');
    await write('CreateScene',{sceneName});
    if(['main','singing','prayer','remote'].includes(role))await write('CreateSceneItem',{sceneName,sourceName:role==='remote'?plan.remoteScene:plan.cameraScene,sceneItemEnabled:true});
    const made=await write('CreateInput',{sceneName,inputName:source.name,inputKind:'browser_source',inputSettings:{url:source.url,width:1920,height:1080,shutdown:false,restart_when_active:false,reroute_audio:false,fps:30,css:'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }'},sceneItemEnabled:true});
    if(!Number.isInteger(made.sceneItemId))throw new LiveFailure('Die erzeugte Browserquelle wurde nicht bestätigt.');
    await write('SetSceneItemTransform',{sceneName,sceneItemId:made.sceneItemId,sceneItemTransform:{positionX:0,positionY:0,alignment:5,boundsType:'OBS_BOUNDS_SCALE_INNER',boundsAlignment:0,boundsWidth:video.baseWidth,boundsHeight:video.baseHeight}});
    const verified=await port.read('GetInputSettings',{inputName:source.name});
    if(verified.inputKind!=='browser_source'||verified.inputSettings?.url!==source.url)throw new LiveFailure('Die erzeugte Quelle stimmt nicht mit dem Plan überein.');
  }
  await check();return result;
}
