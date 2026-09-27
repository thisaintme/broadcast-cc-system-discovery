import type {CaptionWrite,Reader,Role,SceneNode,TransportState,Workspace} from './model.ts';
import {ROLES} from './model.ts';
import {readTransport} from './inspect.ts';
import {object,text} from './workspace.ts';

export const isCaptionKind=(kind:string):boolean=>/^text_(ft2|gdiplus)_source(?:_v\d+)?$/.test(kind);
export function offlineOutputsOff(s:TransportState):boolean{
  const absent=s.unavailableOutputs||[];
  return s.streaming===false && s.recording===false &&
    (s.virtualCamera===false || (s.virtualCamera===null&&absent.includes('virtualCamera'))) &&
    (s.replayBuffer===false || (s.replayBuffer===null&&absent.includes('replayBuffer')));
}
export function assertOfflineSafe(s:TransportState,w:Workspace):void{
  const c=w.captions;
  if(!c || !/^BCC TEST(?:$|[ -])/.test(c.testCollection))throw new Error('Use a duplicated OBS collection named BCC TEST (or BCC TEST - …).');
  if(!s.connected || s.collection!==c.testCollection || w.inventory?.origin!=='live' || w.inventory.collection!==c.testCollection)
    throw new Error('Connect and inspect the chosen BCC TEST collection in this session.');
  if(!w.bindings.confirmed || !c.confirmed)throw new Error('Confirm scene and caption mappings before enabling offline Program control.');
  if(!offlineOutputsOff(s))throw new Error('Offline Program control is blocked: an output is active or its state is unknown.');
}
/** A narrow internal port, never exposed through IPC. */
export interface CaptionPort extends Reader {change(name:CaptionWrite,data:Record<string,unknown>):Promise<void>}
export async function readCaptionGraph(reader:Reader,root:string):Promise<SceneNode[]>{
  const listed=await reader.read('GetGroupList');
  if(!Array.isArray(listed.groups))throw new Error('OBS group inventory is unavailable.');
  const groups=new Set<string>(listed.groups.filter((v:unknown):v is string=>typeof v==='string'));
  const queue=[root],seen=new Set<string>(),nodes:SceneNode[]=[];
  while(queue.length){
    const name=queue.shift()!;if(seen.has(name))continue;seen.add(name);
    if(seen.size>180)throw new Error('Caption graph is too large to verify.');
    const group=groups.has(name),result=await reader.read(group?'GetGroupSceneItemList':'GetSceneItemList',{sceneName:name});
    if(!Array.isArray(result.sceneItems)||result.sceneItems.length>1000)throw new Error('Invalid OBS scene-item inventory.');
    const node:SceneNode={name,type:group?'group':'scene',warnings:[],items:result.sceneItems.map((r:any,index:number)=>({
      id:r.sceneItemId,source:text(r.sourceName),kind:text(r.inputKind)||null,group:r.isGroup===true||groups.has(r.sourceName),
      container:r.sourceType==='OBS_SOURCE_TYPE_SCENE',enabled:r.sceneItemEnabled===true,index,
    }))};
    if(node.items.some(i=>!i.source||!Number.isInteger(i.id)||i.id<0))throw new Error('OBS returned an invalid scene item.');
    nodes.push(node);
    for(const i of node.items)if(i.group||i.container)queue.push(i.source);
  }
  return nodes;
}
function enabledPaths(nodes:SceneNode[],root:string,target:string):number{
  function walk(name:string,trail:string[]):number{
    if(trail.includes(name)||trail.length>20)return 0;
    const n=nodes.find(n=>n.name===name);if(!n)throw new Error('Caption container is unresolved.');
    return n.items.reduce((count,item)=>!item.enabled?count:count+(item.source===target?1:0)+
      ((item.container||item.group)?walk(item.source,[...trail,name]):0),0);
  }
  return walk(root,[]);
}
function sameNames(a:string[],b:string[]):boolean{return JSON.stringify([...a].sort())===JSON.stringify([...b].sort());}
async function verifiedGroup(reader:Reader,w:Workspace):Promise<SceneNode>{
  const c=w.captions,root=w.bindings.scenes.speaker;
  if(!c.speakerGroup||!c.speakerPool.length)throw new Error('Choose and confirm the speaker-name group first.');
  const nodes=await readCaptionGraph(reader,root),group=nodes.find(n=>n.name===c.speakerGroup&&n.type==='group');
  if(!group||enabledPaths(nodes,root,c.speakerGroup)!==1)throw new Error('The speaker group must have exactly one enabled path in the speaker scene.');
  const names=group.items.filter(i=>i.kind?.startsWith('text_'));
  if(names.some(i=>!isCaptionKind(i.kind!))||!sameNames(names.map(i=>i.source),c.speakerPool)||new Set(names.map(i=>i.source)).size!==names.length)
    throw new Error('Speaker text sources changed or are ambiguous. Inspect and review the entire speaker-name pool again.');
  return group;
}
async function captionSettings(reader:Reader,name:string):Promise<Record<string,any>>{
  const r=await reader.read('GetInputSettings',{inputName:name});
  if(!isCaptionKind(text(r.inputKind)))throw new Error('Only built-in text inputs may be updated by caption controls.');
  const defaults=await reader.read('GetInputDefaultSettings',{inputKind:r.inputKind});
  const settings={...object(defaults.defaultInputSettings),...object(r.inputSettings)};
  const key=String(r.inputKind).startsWith('text_ft2_')?'from_file':'read_from_file';
  if(settings[key]!==false)throw new Error('File-backed or unverified text sources cannot be edited. Use a normal text input in the test collection.');
  return settings;
}
async function verifyText(reader:Reader,w:Workspace,role:'bible'|'outro'):Promise<string>{
  const name=role==='bible'?w.bindings.bibleText:w.bindings.nextServiceText;
  if(!name)throw new Error(`Choose the ${role==='bible'?'Bible-reference':'next-service'} text source first.`);
  const nodes=await readCaptionGraph(reader,w.bindings.scenes[role]);
  if(enabledPaths(nodes,w.bindings.scenes[role],name)!==1)throw new Error('The mapped caption must have exactly one enabled path in its scene.');
  await captionSettings(reader,name);return name;
}
export function nextServiceCaption(w:Workspace,id:string):string{
  const selected=w.services.find(s=>s.id===id);if(!selected)throw new Error('Select a service first.');
  const next=[...w.services].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)).find(s=>s.startsAt>selected.startsAt);
  return next?new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',weekday:'long',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(next.startsAt))+' Uhr':'Nächster Termin folgt.';
}
/** No rollback on interruption: further writes stop, leaving the test collection for manual review. */
export async function executeOffline(port:CaptionPort,w:Workspace,role:'prepare'|Role,value:string,serviceId:string,valid:()=>boolean):Promise<void>{
  const guard=async()=>{
    if(!valid())throw new Error('Offline action cancelled.');
    const state=await readTransport(port);
    if(!valid())throw new Error('Offline action cancelled.');
    assertOfflineSafe(state,w);
    return state;
  };
  const change=async(name:CaptionWrite,data:Record<string,unknown>)=>{await guard();if(!valid())throw new Error('Offline action cancelled.');await port.change(name,data);if(!valid())throw new Error('Offline action interrupted.');};
  await guard();
  const scenes=await port.read('GetSceneList');
  if(!Array.isArray(scenes.scenes)||ROLES.some(r=>!scenes.scenes.some((s:any)=>s.sceneName===w.bindings.scenes[r])))throw new Error('A mapped scene is missing. Inspect again.');
  if(role==='prepare'){
    await verifiedGroup(port,w);await verifyText(port,w,'bible');
  }
  if(role==='prepare'||role==='outro'||role==='bible'){
    const targetRole=role==='bible'?'bible':'outro';
    const name=await verifyText(port,w,targetRole);
    const caption=role==='bible'?text(value,500):nextServiceCaption(w,serviceId);
    if(role==='bible'&&!caption.trim())throw new Error('Enter a Bible reference first.');
    await change('SetInputSettings',{inputName:name,inputSettings:{text:caption},overlay:true});
    const after=await captionSettings(port,name);
    if(after.text!==caption)throw new Error('OBS did not confirm the caption text. Program was not advanced.');
  }
  if(role==='speaker'){
    if(!w.speakers.includes(value))throw new Error('Choose a saved speaker.');
    const mapped=w.captions.speakerSources[value];
    if(!mapped||!w.captions.speakerPool.includes(mapped))throw new Error('No speaker display is mapped for this person.');
    let group=await verifiedGroup(port,w);
    // Disable other reviewed name items first; never toggle the containing group, icons or audio.
    const ordered=[...w.captions.speakerPool.filter(n=>n!==mapped),mapped];
    for(const source of ordered){
      group=await verifiedGroup(port,w);
      const item=group.items.find(i=>i.source===source)!;const enabled=source===mapped;
      if(item.enabled===enabled)continue;
      await change('SetSceneItemEnabled',{sceneName:group.name,sceneItemId:item.id,sceneItemEnabled:enabled});
      const readback=await port.read('GetSceneItemEnabled',{sceneName:group.name,sceneItemId:item.id});
      if(readback.sceneItemEnabled!==enabled)throw new Error('OBS did not confirm speaker visibility. Program was not advanced.');
    }
    group=await verifiedGroup(port,w);
    const active=group.items.filter(i=>w.captions.speakerPool.includes(i.source)&&i.enabled).map(i=>i.source);
    if(active.length!==1||active[0]!==mapped)throw new Error('Speaker selection could not be verified.');
  }
  if(role!=='prepare'){
    const target=w.bindings.scenes[role];
    const before=await guard();
    if(before.program!==target)await change('SetCurrentProgramScene',{sceneName:target});
    // Transitions can report the new Program scene asynchronously. Do not start the timer early.
    let confirmed=false;
    for(let i=0;i<60;i++){
      const state=await guard();
      if(state.program===target){confirmed=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!confirmed)throw new Error('OBS did not confirm the requested Program scene.');
  }
  await guard();
}
