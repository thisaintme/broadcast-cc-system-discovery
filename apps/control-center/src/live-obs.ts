import OBSWebSocket from 'obs-websocket-js/json';
import type {LivePort,LiveRead,LiveWrite} from './live-contract.ts';
import {LiveFailure} from './live-contract.ts';
import {localEndpoint} from './workspace.ts';
import {obsErrorCode} from './obs-errors.ts';
const READS=new Set(['GetVersion','GetProfileList','GetSceneList','GetGroupList','GetInputList','GetSceneCollectionList','GetSceneItemList','GetGroupSceneItemList','GetSceneItemEnabled','GetStreamStatus','GetRecordStatus','GetVirtualCamStatus','GetReplayBufferStatus','GetStudioModeEnabled','GetInputMute','GetInputVolume','GetInputAudioMonitorType','GetInputAudioTracks','GetInputSettings','GetInputDefaultSettings']);
const WRITES=new Set(['SetCurrentProgramScene','SetInputSettings','SetSceneItemEnabled','SetInputMute','StartStream','StopStream']);
export class LiveObs implements LivePort{
  private socket:OBSWebSocket|null=null;private authenticated=false;
  onEvent:(name:string,data:Record<string,any>)=>void=()=>{};onDisconnect:()=>void=()=>{};
  isConnected():boolean{return !!this.socket&&this.authenticated;}
  async connect(url:string,password:string):Promise<void>{
    await this.disconnect();const socket=new OBSWebSocket();this.socket=socket;
    const events=['CurrentProgramSceneChanged','CurrentSceneCollectionChanging','CurrentSceneCollectionChanged','CurrentProfileChanging','CurrentProfileChanged','InputMuteStateChanged','InputSettingsChanged','SceneItemEnableStateChanged','SceneListChanged','SceneItemCreated','SceneItemRemoved','SceneItemListReindexed','InputNameChanged','InputRemoved','InputCreated','StreamStateChanged'] as const;
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
  async change(name:LiveWrite,data:Record<string,unknown>={}):Promise<void>{
    if(!WRITES.has(name))throw new LiveFailure('Unsupported live command.');
    // Transport also enforces payload shapes; no arbitrary settings or stream destination writes.
    if(name==='SetInputSettings'&&(data.overlay!==true||Object.keys(data.inputSettings as object||{}).join(',')!=='text'||typeof (data.inputSettings as any)?.text!=='string'))throw new LiveFailure('Only caption text may be changed.');
    if(name==='SetInputMute'&&typeof data.inputMuted!=='boolean')throw new LiveFailure('Mute must be explicitly true or false.');
    await this.request(name,data);
  }
  private async request(name:string,data:Record<string,unknown>):Promise<Record<string,any>>{
    const socket=this.socket;if(!socket||!this.authenticated)throw new LiveFailure('OBS is disconnected; use its manual controls.');
    try{const result=await this.deadline(socket.call(name as any,data as never),3500);if(socket!==this.socket||!this.authenticated)throw new LiveFailure('OBS disconnected during the request.');return result as Record<string,any>;}
    catch(error){const code=obsErrorCode(error);throw new LiveFailure(`OBS ${name} was not confirmed${code===undefined?'':` (code ${code})`}. No automatic retry was made.`);}
  }
  private async deadline<T>(promise:Promise<T>,ms:number):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new LiveFailure('OBS request timed out.')),ms);})]);}finally{if(timer)clearTimeout(timer);}}
}
