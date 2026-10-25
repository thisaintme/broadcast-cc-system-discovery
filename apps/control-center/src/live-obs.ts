import OBSWebSocket from 'obs-websocket-js/json';
import type {LivePort,LiveRead,LiveWrite} from './live-contract.ts';
import {LiveFailure} from './live-contract.ts';
import {localEndpoint} from './workspace.ts';
import {obsErrorCode} from './obs-errors.ts';
import {YouTubeFailure,youtubeServer} from './youtube-model.ts';
import type {Destination} from './youtube-model.ts';
const READS=new Set(['GetVersion','GetProfileList','GetSceneList','GetGroupList','GetInputList','GetSceneCollectionList','GetSceneItemList','GetGroupSceneItemList','GetSceneItemEnabled','GetStreamStatus','GetRecordStatus','GetVirtualCamStatus','GetReplayBufferStatus','GetStudioModeEnabled','GetInputMute','GetInputVolume','GetInputAudioMonitorType','GetInputAudioTracks','GetInputSettings','GetInputDefaultSettings','GetCurrentPreviewScene','GetCurrentSceneTransition','GetMediaInputStatus','GetLastReplayBufferReplay']);
const WRITES=new Set(['SetCurrentProgramScene','SetInputSettings','SetSceneItemEnabled','SetInputMute','StartStream','StopStream','SetCurrentPreviewScene','TriggerStudioModeTransition','SetStudioModeEnabled','SetInputVolume','StartRecord','StopRecord','PauseRecord','ResumeRecord','StartReplayBuffer','StopReplayBuffer','SaveReplayBuffer','StartVirtualCam','StopVirtualCam','TriggerMediaInputAction']);
export function validateLivePayload(name:string,data:Record<string,unknown>):void{
  if(!WRITES.has(name))throw new LiveFailure('Unsupported live command.');
  const exact=(keys:string[])=>Object.keys(data).length===keys.length&&Object.keys(data).every(k=>keys.includes(k));
  if(name==='SetInputSettings'&&(data.overlay!==true||Object.keys(data.inputSettings as object||{}).join(',')!=='text'||typeof (data.inputSettings as any)?.text!=='string'))throw new LiveFailure('Only caption text may be changed.');
  if(name==='SetInputMute'&&typeof data.inputMuted!=='boolean')throw new LiveFailure('Mute must be explicitly true or false.');
  if(name==='SetInputVolume'&&(!exact(['inputName','inputVolumeDb'])||typeof data.inputName!=='string'||typeof data.inputVolumeDb!=='number'||!Number.isFinite(data.inputVolumeDb)||data.inputVolumeDb< -100||data.inputVolumeDb>0))throw new LiveFailure('Input level must be explicit and between -100 and 0 dB.');
  if(name==='SetStudioModeEnabled'&&(!exact(['studioModeEnabled'])||typeof data.studioModeEnabled!=='boolean'))throw new LiveFailure('Studio Mode must be explicit.');
  if(name==='SetCurrentPreviewScene'&&(!exact(['sceneName'])||typeof data.sceneName!=='string'||!data.sceneName))throw new LiveFailure('Choose a Preview scene.');
  if(['StartStream','StopStream','StartRecord','StopRecord','PauseRecord','ResumeRecord','StartReplayBuffer','StopReplayBuffer','SaveReplayBuffer','StartVirtualCam','StopVirtualCam','TriggerStudioModeTransition'].includes(name)&&!exact([]))throw new LiveFailure('Output commands do not accept configuration or destination settings.');
  if(name==='TriggerMediaInputAction'&&(!exact(['inputName','mediaAction'])||typeof data.inputName!=='string'||!['OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY','OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE','OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP','OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'].includes(String(data.mediaAction))))throw new LiveFailure('Choose an explicit playback action.');
}
export class LiveObs implements LivePort{
  private socket:OBSWebSocket|null=null;private authenticated=false;
  private youtubeGuard:{destination:Destination;valid:()=>boolean}|null=null;
  onEvent:(name:string,data:Record<string,any>)=>void=()=>{};onDisconnect:()=>void=()=>{};
  isConnected():boolean{return !!this.socket&&this.authenticated;}
  async connect(url:string,password:string):Promise<void>{
    await this.disconnect();const socket=new OBSWebSocket();this.socket=socket;
    const events=['CurrentProgramSceneChanged','CurrentPreviewSceneChanged','StudioModeStateChanged','InputVolumeChanged','CurrentSceneCollectionChanging','CurrentSceneCollectionChanged','CurrentProfileChanging','CurrentProfileChanged','InputMuteStateChanged','InputSettingsChanged','SceneItemEnableStateChanged','SceneListChanged','SceneItemCreated','SceneItemRemoved','SceneItemListReindexed','InputNameChanged','InputRemoved','InputCreated','StreamStateChanged'] as const;
    for(const name of events)socket.on(name,data=>{if(this.socket===socket&&this.authenticated)this.onEvent(name,data);});
    const lost=()=>{if(this.socket===socket){this.authenticated=false;this.onDisconnect();}};
    socket.on('ConnectionClosed',lost);socket.on('ConnectionError',lost);
    try{await this.deadline(socket.connect(localEndpoint(url,'obs'),password||undefined,{rpcVersion:1}),8000);}
    catch(error){await this.disconnect();const code=obsErrorCode(error);throw new LiveFailure(code===4009?'OBS rejected the password (4009). It was not saved.':`OBS live connection failed${code===undefined?'':` (${code})`}. Check the local WebSocket settings.`);}
    if(this.socket!==socket)throw new LiveFailure('Connection was cancelled.');this.authenticated=true;
  }
  async disconnect():Promise<void>{
    const old=this.socket;this.socket=null;this.authenticated=false;this.onDisconnect();
    if(old)try{await this.deadline(old.disconnect(),1000);}catch{/* Never stop or restore OBS outputs. */}
  }
  async read(name:LiveRead,data:Record<string,unknown>={}):Promise<Record<string,any>>{
    if(!READS.has(name))throw new LiveFailure('Unsupported read request.');return await this.request(name,data);
  }
  /** Secret-bearing read is deliberately outside the general read/IPC/inspection allowlist. */
  async youtubeDestination():Promise<Destination>{
    const r=await this.request('GetStreamServiceSettings',{}),s=r.streamServiceSettings;
    if(!['rtmp_common','rtmp_custom'].includes(r.streamServiceType)||!s||typeof s!=='object'||typeof s.key!=='string'||!s.key||s.key.length>2048)throw new YouTubeFailure('OBS does not expose a supported YouTube stream-key configuration. No settings were changed.');
    return {server:youtubeServer(s.server),key:s.key};
  }
  /** Main-process callers also supply their current live-control ticket/permission check. */
  async withYouTubeDestination<T>(expected:Destination,action:()=>Promise<T>,valid:()=>boolean=()=>true):Promise<T>{
    if(this.youtubeGuard)throw new YouTubeFailure('A verified broadcast operation is already in progress.');
    this.youtubeGuard={destination:{...expected},valid};try{return await action();}finally{this.youtubeGuard=null;}
  }
  async change(name:LiveWrite,data:Record<string,unknown>={}):Promise<void>{
    validateLivePayload(name,data);
    if(this.youtubeGuard&&(name==='StartStream'||name==='StopStream')){
      const guard=this.youtubeGuard;
      if(!guard.valid())throw new LiveFailure('YouTube start/stop authorization was cancelled. No output command was sent.');
      const current=await this.youtubeDestination();
      if(this.youtubeGuard!==guard||!guard.valid())throw new LiveFailure('YouTube start/stop authorization was cancelled during destination verification.');
      if(current.key!==guard.destination.key||current.server!==guard.destination.server)throw new LiveFailure('The verified YouTube destination changed. No stream start/stop request was sent.');
    }
    await this.request(name,data);
  }
  private async request(name:string,data:Record<string,unknown>):Promise<Record<string,any>>{
    const socket=this.socket;if(!socket||!this.authenticated)throw new LiveFailure('OBS is disconnected; use its manual controls.');
    try{const result=await this.deadline(socket.call(name as any,data as never),3500);if(socket!==this.socket||!this.authenticated)throw new LiveFailure('OBS disconnected during the request.');return result as Record<string,any>;}
    catch(error){const code=obsErrorCode(error);throw new LiveFailure(`OBS ${name} was not confirmed${code===undefined?'':` (code ${code})`}. No automatic retry was made.`);}
  }
  private async deadline<T>(promise:Promise<T>,ms:number):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new LiveFailure('OBS request timed out.')),ms);})]);}finally{if(timer)clearTimeout(timer);}}
}
