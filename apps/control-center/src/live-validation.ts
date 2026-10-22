import type {Reader,Role,SceneNode,Workspace} from './model.ts';
import {readCaptionGraph,manualTextSettings,isCaptionKind} from './offline.ts';
import {LiveFailure,LIVE_COMMANDS} from './live-contract.ts';
import type {LiveCommand,LiveObservation,LivePermissions} from './live-contract.ts';
export function enabledPaths(nodes:SceneNode[],root:string,target:string):number{
  const walk=(name:string,trail:string[]):number=>{
    if(trail.includes(name)||trail.length>20)return 0;
    const n=nodes.find(x=>x.name===name);if(!n)throw new LiveFailure('A caption container is unavailable. Inspect OBS again.');
    return n.items.reduce((sum,i)=>sum+(!i.enabled?0:(i.source===target?1:0)+((i.group||i.container)?walk(i.source,[...trail,name]):0)),0);
  };return walk(root,[]);
}
export async function requireScene(reader:Reader,w:Workspace,role:Role):Promise<string>{
  const name=w.bindings.scenes[role],list=await reader.read('GetSceneList');
  if(!name||!Array.isArray(list.scenes)||!list.scenes.some((s:any)=>s.sceneName===name))throw new LiveFailure(`Map an existing ${role} scene in Connections & mappings.`);
  return name;
}
export async function textSettings(reader:Reader,name:string):Promise<Record<string,any>>{
  const r=await reader.read('GetInputSettings',{inputName:name});
  if(!isCaptionKind(typeof r.inputKind==='string'?r.inputKind:''))throw new LiveFailure('Choose a built-in OBS text source for this caption.');
  const defaults=await reader.read('GetInputDefaultSettings',{inputKind:r.inputKind});
  try{return manualTextSettings(r.inputKind,r.inputSettings,defaults.defaultInputSettings);}catch{throw new LiveFailure('Caption is file-backed or its settings cannot be verified. No text was changed.');}
}
export async function requireText(reader:Reader,w:Workspace,role:'bible'|'outro'):Promise<string>{
  const root=await requireScene(reader,w,role),name=role==='bible'?w.bindings.bibleText:w.bindings.nextServiceText;
  if(!name)throw new LiveFailure(`Select the ${role==='bible'?'Bible-reference':'next-service'} text source.`);
  const nodes=await readCaptionGraph(reader,root);
  if(enabledPaths(nodes,root,name)!==1)throw new LiveFailure('This caption needs exactly one enabled path in its mapped scene. Review its mapping.');
  await textSettings(reader,name);return name;
}
export async function requireSpeakerGroup(reader:Reader,w:Workspace):Promise<SceneNode>{
  const root=await requireScene(reader,w,'speaker'),c=w.captions;
  if(!c.speakerGroup||!c.speakerPool.length)throw new LiveFailure('Select and review the speaker-name group and pool first.');
  const nodes=await readCaptionGraph(reader,root),group=nodes.find(n=>n.type==='group'&&n.name===c.speakerGroup);
  if(!group||enabledPaths(nodes,root,c.speakerGroup)!==1)throw new LiveFailure('The speaker-name group needs exactly one enabled path in the Speaker scene.');
  const names=group.items.filter(i=>i.kind?.startsWith('text_'));
  const sorted=(xs:string[])=>JSON.stringify([...xs].sort());
  if(names.some(i=>!isCaptionKind(i.kind!))||new Set(names.map(i=>i.source)).size!==names.length||sorted(names.map(i=>i.source))!==sorted(c.speakerPool))throw new LiveFailure('The speaker-name pool changed. Review its text items before selecting a speaker.');
  return group;
}
export async function requireAudio(reader:Reader,w:Workspace):Promise<boolean>{
  const inputName=w.bindings.audioInput;if(!inputName)throw new LiveFailure('Select the service-audio input.');
  const list=await reader.read('GetInputList');
  if(!Array.isArray(list.inputs)||list.inputs.filter((i:any)=>i.inputName===inputName).length!==1)throw new LiveFailure('The selected service input is missing or ambiguous.');
  const r=await reader.read('GetInputMute',{inputName});
  if(typeof r.inputMuted!=='boolean')throw new LiveFailure('OBS did not report a valid mute state.');return r.inputMuted;
}
export const commandPermissions=(c:LiveCommand):LivePermissions=>({
  scenes:['prepare','intro','start','on-air','main','speaker','bible','outro'].includes(c),
  audio:['intro','start','on-air','outro','mute','unmute'].includes(c),stream:c==='start'||c==='stop',
});
/** Missing features block their own actions, not unrelated mapped functions. */
export function blockedActions(w:Workspace,o:LiveObservation,p:LivePermissions,connected:boolean,busy:boolean,serviceId:string,now:number,journalError=''):Record<LiveCommand,string[]>{
  return Object.fromEntries(LIVE_COMMANDS.map(c=>{
    const reasons:string[]=[],need=commandPermissions(c);
    if(busy)reasons.push('An action is in progress. Release control remains available.');
    if(!connected)reasons.push('Connect & inspect OBS.');
    if(o.checkedAt===null||now-o.checkedAt>=6000||!o.collection||!o.profile||!o.program||o.streaming===null)reasons.push('Wait for confirmed OBS status; unknown is not off.');
    if(journalError)reasons.push(journalError);
    if(need.scenes&&!p.scenes)reasons.push('Enable Scenes and captions permission.');
    if(need.audio&&!p.audio)reasons.push('Enable Service audio permission.');
    if(need.stream&&!p.stream)reasons.push('Enable OBS start/stop permission.');
    const role:Role|undefined=c==='start'||c==='prepare'?'intro':c==='on-air'?'main':['intro','main','speaker','bible','outro'].includes(c)?c as Role:undefined;
    if(role&&(!w.bindings.scenes[role]||!o.scenes.includes(w.bindings.scenes[role])))reasons.push(`Map the ${role} scene.`);
    if((c==='speaker'||c==='bible')&&!o.scenes.includes(w.bindings.scenes.main))reasons.push('Map Main for the timed return.');
    if(c==='speaker'&&(!w.captions.speakerGroup||!w.captions.speakerPool.length))reasons.push('Review the speaker-name group and pool in setup.');
    if(c==='bible'&&!w.bindings.bibleText)reasons.push('Map the Bible-reference text source.');
    if(c==='outro'&&!w.bindings.nextServiceText)reasons.push('Map the next-service text source.');
    if(need.audio&&!w.bindings.audioInput)reasons.push('Select the confirmed service-audio input.');
    if(['prepare','intro','start'].includes(c)&&(o.streaming!==false||o.reconnecting===true))reasons.push('OBS is transmitting or reconnecting. Joining a service must not run Intro preparation.');
    if(c==='stop'&&o.streaming!==true&&o.reconnecting!==true)reasons.push('OBS is not confirmed transmitting.');
    if(['prepare','start','outro'].includes(c)&&!w.services.some(s=>s.id===serviceId))reasons.push('Select a service from the local schedule.');
    return [c,[...new Set(reasons)]];
  })) as Record<LiveCommand,string[]>;
}
