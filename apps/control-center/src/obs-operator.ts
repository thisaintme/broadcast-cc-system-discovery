import {LiveFailure} from './live-contract.ts';
import type {LiveRead,LiveWrite,LivePhase} from './live-contract.ts';
import type {LiveActionContext} from './live-actions.ts';
import {textSettings} from './live-validation.ts';

export type OperatorAction = {collection:string;profile:string} & (
  {kind:'program'|'preview'|'take';scene:string} |
  {kind:'studio'|'virtual-camera';enabled:boolean} |
  {kind:'mute';input:string;muted:boolean} |
  {kind:'volume';input:string;db:number} |
  {kind:'visibility';container:string;group:boolean;itemId:number;source:string;enabled:boolean} |
  {kind:'text';input:string;text:string} |
  {kind:'record';state:'start'|'stop'|'pause'|'resume'} |
  {kind:'replay';state:'start'|'stop'|'save'} |
  {kind:'media';input:string;action:'play'|'pause'|'stop'|'restart'}
);
export interface OperatorQuery {section:'overview'|'audio'|'items'|'text'|'media';input?:string;container?:string;group?:boolean}
export interface OperatorView {
  section:OperatorQuery['section'];checkedAt:number;collection:string;profile:string;warnings:string[];
  available:string[];scenes:string[];groups:string[];inputs:{name:string;kind:string}[];
  studio:boolean|null;preview:string;recording:boolean|null;paused:boolean|null;replay:boolean|null;virtualCamera:boolean|null;
  input:string;muted:boolean|null;volumeDb:number|null;caption:string|null;mediaState:string;
  items:{id:number;source:string;enabled:boolean}[];
}
export interface OperatorReader {read(name:LiveRead,data?:Record<string,unknown>):Promise<Record<string,any>>}
const obj=(x:unknown):Record<string,any>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw new LiveFailure('Invalid OBS operator request.');return x as Record<string,any>;};
const named=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=240&&!/[\u0000-\u001f]/.test(x);
const bool=(x:unknown):boolean|null=>typeof x==='boolean'?x:null;
const finite=(x:unknown):number|null=>typeof x==='number'&&Number.isFinite(x)?x:null;
const shapes:Record<string,string[]>={program:['scene'],preview:['scene'],take:['scene'],studio:['enabled'],'virtual-camera':['enabled'],mute:['input','muted'],volume:['input','db'],visibility:['container','group','itemId','source','enabled'],text:['input','text'],record:['state'],replay:['state'],media:['input','action']};
/** Exact semantic schema: never an arbitrary OBS RPC or a replacement settings object. */
export function parseOperatorAction(value:unknown):OperatorAction{
  let raw:unknown=value;
  if(typeof value==='string'){if(value.length>6000)throw new LiveFailure('Operator request is too large.');try{raw=JSON.parse(value);}catch{throw new LiveFailure('Invalid operator request.');}}
  const a=obj(raw),fields=typeof a.kind==='string'?shapes[a.kind]:undefined;
  if(!fields||!named(a.collection)||!named(a.profile)||Object.keys(a).some(k=>!['kind','collection','profile',...fields].includes(k))||fields.some(k=>!Object.hasOwn(a,k)))throw new LiveFailure('Invalid or unrelated operator fields.');
  for(const k of ['scene','input','container','source'])if(fields.includes(k)&&!named(a[k]))throw new LiveFailure('Choose a current OBS target.');
  for(const k of ['enabled','muted','group'])if(fields.includes(k)&&typeof a[k]!=='boolean')throw new LiveFailure('Use an explicit on/off value, not a toggle.');
  if(a.kind==='volume'&&(finite(a.db)===null||a.db< -100||a.db>0))throw new LiveFailure('Choose an input level between -100 and 0 dB. Boost above 0 dB is not offered in this alpha.');
  if(a.kind==='visibility'&&(!Number.isSafeInteger(a.itemId)||a.itemId<0))throw new LiveFailure('Choose a valid scene item.');
  if(a.kind==='text'&&(typeof a.text!=='string'||a.text.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(a.text)))throw new LiveFailure('Text must contain at most 2000 characters.');
  if(a.kind==='record'&&!['start','stop','pause','resume'].includes(a.state))throw new LiveFailure('Choose a recording action.');
  if(a.kind==='replay'&&!['start','stop','save'].includes(a.state))throw new LiveFailure('Choose a Replay Buffer action.');
  if(a.kind==='media'&&!['play','pause','stop','restart'].includes(a.action))throw new LiveFailure('Choose a media action.');
  return a as OperatorAction;
}
export function describeOperatorAction(a:OperatorAction):string{
  switch(a.kind){
    case 'program':return `Show "${a.scene}" on Program. No mute/unmute command or automatic return is added; scene media/audio can activate as configured in OBS.`;
    case 'preview':return `Select "${a.scene}" in Studio Preview only. Shared sources can still affect Program.`;
    case 'take':return `Transition the currently selected Preview "${a.scene}" to Program using OBS's current transition. Audio controls are unchanged.`;
    case 'studio':return `${a.enabled?'Enable':'Disable'} OBS Studio Mode. This changes the OBS working interface.`;
    case 'mute':return `${a.muted?'Mute':'Unmute'} OBS input "${a.input}". This can affect every scene using it.`;
    case 'volume':return `Set OBS input "${a.input}" to ${a.db} dB. Its mute, track and monitoring settings are unchanged.`;
    case 'visibility':return `${a.enabled?'Show':'Hide'} "${a.source}" in ${a.group?'group':'scene'} "${a.container}". Shared groups/sources can affect Program and audio.`;
    case 'text':return `Replace the text in "${a.input}". Font, size, bounds and transforms are not changed. Shared uses update too.\n\nNew text:\n${a.text}`;
    case 'record':return `${a.state} OBS recording only. Stream transmission is not stopped. Uses existing OBS recording settings.`;
    case 'replay':return `${a.state} the OBS Replay Buffer. Uses existing OBS configuration; an unavailable buffer is not automatically configured.`;
    case 'virtual-camera':return `${a.enabled?'Start':'Stop'} the OBS Virtual Camera only. Other applications may use this output.`;
    case 'media':return `${a.action} media input "${a.input}". Playback can be visible/audible on Program.`;
  }
}
const recordWrite={start:'StartRecord',stop:'StopRecord',pause:'PauseRecord',resume:'ResumeRecord'} as const;
const replayWrite={start:'StartReplayBuffer',stop:'StopReplayBuffer',save:'SaveReplayBuffer'} as const;
export function operatorRequests(a:OperatorAction):string[]{
  switch(a.kind){
    case 'program':return ['GetSceneList','SetCurrentProgramScene'];
    case 'preview':return ['GetSceneList','GetStudioModeEnabled','GetCurrentPreviewScene','SetCurrentPreviewScene'];
    case 'take':return ['GetSceneList','GetStudioModeEnabled','GetCurrentPreviewScene','TriggerStudioModeTransition'];
    case 'studio':return ['GetStudioModeEnabled','SetStudioModeEnabled'];
    case 'mute':return ['GetInputList','GetInputMute','SetInputMute'];
    case 'volume':return ['GetInputList','GetInputVolume','SetInputVolume'];
    case 'visibility':return [a.group?'GetGroupList':'GetSceneList',a.group?'GetGroupSceneItemList':'GetSceneItemList','GetSceneItemEnabled','SetSceneItemEnabled'];
    case 'text':return ['GetInputList','GetInputSettings','GetInputDefaultSettings','SetInputSettings'];
    case 'record':return ['GetRecordStatus',recordWrite[a.state]];
    case 'replay':return ['GetReplayBufferStatus',replayWrite[a.state],...(a.state==='save'?['GetLastReplayBufferReplay']:[])];
    case 'virtual-camera':return ['GetVirtualCamStatus',a.enabled?'StartVirtualCam':'StopVirtualCam'];
    case 'media':return ['GetInputList','GetMediaInputStatus','TriggerMediaInputAction'];
  }
}
function validateQuery(raw:unknown):OperatorQuery{
  const q=obj(raw);
  if(!['overview','audio','items','text','media'].includes(q.section)||Object.keys(q).some(k=>!['section','input','container','group'].includes(k)))throw new LiveFailure('Invalid operator inspection.');
  if(['audio','text','media'].includes(q.section)&&!named(q.input))throw new LiveFailure('Select an input first.');
  if(q.section==='items'&&(!named(q.container)||typeof q.group!=='boolean'))throw new LiveFailure('Select a scene or group first.');
  return q as OperatorQuery;
}
export async function readOperatorView(reader:OperatorReader,raw:unknown):Promise<OperatorView>{
  const q=validateQuery(raw);
  const [version,collection,profile]=await Promise.all([reader.read('GetVersion'),reader.read('GetSceneCollectionList'),reader.read('GetProfileList')]);
  if(!named(collection.currentSceneCollectionName)||!named(profile.currentProfileName))throw new LiveFailure('Current OBS collection/profile is not confirmed.');
  const v:OperatorView={section:q.section,checkedAt:Date.now(),collection:collection.currentSceneCollectionName,profile:profile.currentProfileName,warnings:[],available:Array.isArray(version.availableRequests)?version.availableRequests.filter((x:unknown)=>typeof x==='string'):[],scenes:[],groups:[],inputs:[],studio:null,preview:'',recording:null,paused:null,replay:null,virtualCamera:null,input:q.input||'',muted:null,volumeDb:null,caption:null,mediaState:'',items:[]};
  const optional=async(name:LiveRead,data:Record<string,unknown>={})=>{
    if(!v.available.includes(name)){v.warnings.push(`${name}: not advertised by OBS.`);return {};}
    try{return await reader.read(name,data);}catch{v.warnings.push(`${name}: unavailable or not confirmed; not treated as off.`);return {};}
  };
  if(q.section==='overview'){
    const [scenes,groups,inputs,studio,record,replay,virtual]=await Promise.all([reader.read('GetSceneList'),optional('GetGroupList'),reader.read('GetInputList'),optional('GetStudioModeEnabled'),optional('GetRecordStatus'),optional('GetReplayBufferStatus'),optional('GetVirtualCamStatus')]);
    v.scenes=Array.isArray(scenes.scenes)?scenes.scenes.map((s:any)=>s.sceneName).filter(named).slice(0,1000):[];
    v.groups=Array.isArray(groups.groups)?groups.groups.filter(named).slice(0,1000):[];
    v.inputs=Array.isArray(inputs.inputs)?inputs.inputs.filter((i:any)=>named(i.inputName)&&named(i.inputKind)).map((i:any)=>({name:i.inputName,kind:i.inputKind})).slice(0,1000):[];
    v.studio=bool(studio.studioModeEnabled);if(v.studio===true){const p=await optional('GetCurrentPreviewScene');v.preview=named(p.currentPreviewSceneName)?p.currentPreviewSceneName:'';}
    v.recording=bool(record.outputActive);v.paused=bool(record.outputPaused);v.replay=bool(replay.outputActive);v.virtualCamera=bool(virtual.outputActive);
  }else if(q.section==='audio'){
    const [mute,volume]=await Promise.all([optional('GetInputMute',{inputName:q.input}),optional('GetInputVolume',{inputName:q.input})]);v.muted=bool(mute.inputMuted);v.volumeDb=finite(volume.inputVolumeDb);
  }else if(q.section==='items'){
    const r=await reader.read(q.group?'GetGroupSceneItemList':'GetSceneItemList',{sceneName:q.container});
    if(!Array.isArray(r.sceneItems))throw new LiveFailure('Scene items could not be inspected.');
    v.items=r.sceneItems.filter((i:any)=>Number.isSafeInteger(i.sceneItemId)&&named(i.sourceName)&&typeof i.sceneItemEnabled==='boolean').slice(0,1000).map((i:any)=>({id:i.sceneItemId,source:i.sourceName,enabled:i.sceneItemEnabled}));
  }else if(q.section==='text'){v.caption=(await textSettings(reader,q.input!)).text; if(typeof v.caption!=='string')v.caption='';}
  else{const r=await optional('GetMediaInputStatus',{inputName:q.input});v.mediaState=typeof r.mediaState==='string'?r.mediaState:'';}
  const [endCollection,endProfile]=await Promise.all([reader.read('GetSceneCollectionList'),reader.read('GetProfileList')]);
  if(endCollection.currentSceneCollectionName!==v.collection||endProfile.currentProfileName!==v.profile)throw new LiveFailure('OBS target changed during inspection. Refresh the operator panel.');
  v.checkedAt=Date.now();return v;
}
/** Single operator intent, checked/read back through the existing serialized live controller. */
export async function executeOperatorAction(ctx:LiveActionContext,a:OperatorAction):Promise<LivePhase|null>{
  const reader=ctx.reader;
  const current=await ctx.check();
  if(current.collection!==a.collection||current.profile!==a.profile)throw new LiveFailure('This operator panel belongs to another OBS collection/profile. Refresh it.');
  const version=await reader.read('GetVersion'),available=new Set<string>(Array.isArray(version.availableRequests)?version.availableRequests:[]);
  const missing=operatorRequests(a).filter(n=>!available.has(n));if(missing.length)throw new LiveFailure(`OBS does not advertise: ${missing.join(', ')}. Other controls remain available.`);
  const check=async()=>{if(!ctx.permissions().operator)throw new LiveFailure('Enable OBS operator desk permission.');await ctx.check();};
  const write=async(n:LiveWrite,d:Record<string,unknown>={})=>{await check();await ctx.change(n,d);};
  const until=async(test:()=>Promise<boolean>,message:string)=>{for(let i=0;i<100;i++){await check();if(await test())return;await new Promise(r=>setTimeout(r,100));}throw new LiveFailure(message+' No automatic retry was made.');};
  if('input' in a){const inputs=await reader.read('GetInputList');if(!Array.isArray(inputs.inputs)||inputs.inputs.filter((i:any)=>i.inputName===a.input).length!==1)throw new LiveFailure('The selected input no longer exists or is ambiguous.');}
  switch(a.kind){
    case 'program':case 'preview':case 'take':{
      const list=await reader.read('GetSceneList');if(!Array.isArray(list.scenes)||!list.scenes.some((s:any)=>s.sceneName===a.scene))throw new LiveFailure('The selected scene no longer exists.');
      if(a.kind!=='program'&&(await reader.read('GetStudioModeEnabled')).studioModeEnabled!==true)throw new LiveFailure('Enable Studio Mode in OBS before using Preview/Transition.');
      if(a.kind==='take'&&(await reader.read('GetCurrentPreviewScene')).currentPreviewSceneName!==a.scene)throw new LiveFailure('Preview changed since inspection. Refresh and confirm the intended scene.');
      if(a.kind==='program'){await write('SetCurrentProgramScene',{sceneName:a.scene});await until(async()=>(await ctx.check()).program===a.scene,'Program was not confirmed.');}
      else if(a.kind==='preview'){await write('SetCurrentPreviewScene',{sceneName:a.scene});if((await reader.read('GetCurrentPreviewScene')).currentPreviewSceneName!==a.scene)throw new LiveFailure('Preview selection was not confirmed.');}
      else{await write('TriggerStudioModeTransition');await until(async()=>(await ctx.check()).program===a.scene,'Transition result was not confirmed.');}
      break;
    }
    case 'studio':await write('SetStudioModeEnabled',{studioModeEnabled:a.enabled});if((await reader.read('GetStudioModeEnabled')).studioModeEnabled!==a.enabled)throw new LiveFailure('Studio Mode change was not confirmed.');break;
    case 'mute':{
      const before=await reader.read('GetInputMute',{inputName:a.input});if(typeof before.inputMuted!=='boolean')throw new LiveFailure('Input mute state is unknown.');
      await write('SetInputMute',{inputName:a.input,inputMuted:a.muted});if((await reader.read('GetInputMute',{inputName:a.input})).inputMuted!==a.muted)throw new LiveFailure('Input mute result was not confirmed.');break;
    }
    case 'volume':{
      if(finite((await reader.read('GetInputVolume',{inputName:a.input})).inputVolumeDb)===null)throw new LiveFailure('Input volume is unknown.');
      await write('SetInputVolume',{inputName:a.input,inputVolumeDb:a.db});const result=finite((await reader.read('GetInputVolume',{inputName:a.input})).inputVolumeDb);
      if(result===null||Math.abs(result-a.db)>0.1)throw new LiveFailure('Input volume result was not confirmed.');break;
    }
    case 'visibility':{
      const containers=await reader.read(a.group?'GetGroupList':'GetSceneList'),names=a.group?containers.groups:containers.scenes?.map((s:any)=>s.sceneName);
      if(!Array.isArray(names)||!names.includes(a.container))throw new LiveFailure('The selected scene/group no longer exists.');
      const r=await reader.read(a.group?'GetGroupSceneItemList':'GetSceneItemList',{sceneName:a.container});
      if(!Array.isArray(r.sceneItems)||r.sceneItems.filter((i:any)=>i.sceneItemId===a.itemId&&i.sourceName===a.source).length!==1)throw new LiveFailure('The source identity changed. Refresh the item list.');
      await write('SetSceneItemEnabled',{sceneName:a.container,sceneItemId:a.itemId,sceneItemEnabled:a.enabled});
      if((await reader.read('GetSceneItemEnabled',{sceneName:a.container,sceneItemId:a.itemId})).sceneItemEnabled!==a.enabled)throw new LiveFailure('Source visibility result was not confirmed.');break;
    }
    case 'text':await textSettings(reader,a.input);await write('SetInputSettings',{inputName:a.input,inputSettings:{text:a.text},overlay:true});if((await textSettings(reader,a.input)).text!==a.text)throw new LiveFailure('Text result was not confirmed.');break;
    case 'record':{
      const r=await reader.read('GetRecordStatus');if(typeof r.outputActive!=='boolean')throw new LiveFailure('Recording state is unknown.');
      if(a.state==='start'&&r.outputActive)throw new LiveFailure('Recording is already active; it was not restarted.');
      if(a.state!=='start'&&!r.outputActive)throw new LiveFailure('Recording is not active.');
      if(['pause','resume'].includes(a.state)&&typeof r.outputPaused!=='boolean')throw new LiveFailure('Recording pause state is unknown.');
      await write(recordWrite[a.state]);await until(async()=>{const x=await reader.read('GetRecordStatus');return a.state==='start'?x.outputActive===true:a.state==='stop'?x.outputActive===false:x.outputActive===true&&x.outputPaused===(a.state==='pause');},'Recording result was not confirmed.');break;
    }
    case 'replay':{
      const r=await reader.read('GetReplayBufferStatus');if(typeof r.outputActive!=='boolean')throw new LiveFailure('Replay Buffer is unavailable or unknown. Configure it in OBS separately.');
      if(a.state==='start'&&r.outputActive)throw new LiveFailure('Replay Buffer is already active.');
      if(a.state!=='start'&&!r.outputActive)throw new LiveFailure('Replay Buffer is not active.');
      let previous='';if(a.state==='save')try{previous=(await reader.read('GetLastReplayBufferReplay')).savedReplayPath||'';}catch{/* First save has no prior file. */}
      await write(replayWrite[a.state]);
      await until(async()=>{if(a.state!=='save')return (await reader.read('GetReplayBufferStatus')).outputActive===(a.state==='start');const p=(await reader.read('GetLastReplayBufferReplay')).savedReplayPath;return typeof p==='string'&&p.length>0&&p!==previous;},'Replay Buffer result was not confirmed.');break;
    }
    case 'virtual-camera':{
      const r=await reader.read('GetVirtualCamStatus');if(typeof r.outputActive!=='boolean')throw new LiveFailure('Virtual Camera is unavailable or unknown.');
      if(r.outputActive===a.enabled)throw new LiveFailure('Virtual Camera is already in the requested state.');
      await write(a.enabled?'StartVirtualCam':'StopVirtualCam');await until(async()=>(await reader.read('GetVirtualCamStatus')).outputActive===a.enabled,'Virtual Camera result was not confirmed.');break;
    }
    case 'media':{
      const r=await reader.read('GetMediaInputStatus',{inputName:a.input});if(typeof r.mediaState!=='string')throw new LiveFailure('This input does not report media playback state.');
      await write('TriggerMediaInputAction',{inputName:a.input,mediaAction:'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_'+a.action.toUpperCase()});
      const expected=a.action==='pause'?'OBS_MEDIA_STATE_PAUSED':a.action==='stop'?'OBS_MEDIA_STATE_STOPPED':'OBS_MEDIA_STATE_PLAYING';
      await until(async()=>(await reader.read('GetMediaInputStatus',{inputName:a.input})).mediaState===expected,'Playback state was not confirmed (short media may have already ended).');break;
    }
  }
  await ctx.verified(`OBS operator ${a.kind} result confirmed. No stream lifecycle or automatic return was added.`);return null;
}
