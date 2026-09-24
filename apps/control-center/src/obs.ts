import OBSWebSocket from 'obs-websocket-js/json';
import {disconnected} from './model.ts';
import type {PreviewPort,ReadRequest,TransportState} from './model.ts';
import {localEndpoint} from './workspace.ts';
import {assertPreviewSafe,readTransport} from './inspect.ts';
import {connectionFailure,requestFailure,ObsFailure} from './obs-errors.ts';

export class ObsAdapter implements PreviewPort {
  private socket:OBSWebSocket|null=null;
  private authenticated=false;
  private live=disconnected();
  private interval:ReturnType<typeof setInterval>|null=null;
  private expectedPreview:string|null=null;
  private polling=false;
  onUnsafe:(reason:string)=>void=()=>{};
  onState:()=>void=()=>{};
  state():TransportState {return {...this.live,statusWarnings:[...(this.live.statusWarnings || [])]};}
  async connect(url:string,password:string):Promise<void> {
    const endpoint=localEndpoint(url,'obs');
    await this.disconnect();
    const socket=new OBSWebSocket();this.socket=socket;
    const unsafe=(reason:string)=>{if(this.socket===socket)this.onUnsafe(reason);};
    socket.on('ConnectionClosed',()=>{
      if(this.socket!==socket)return;
      this.authenticated=false;this.live=disconnected();
      if(this.interval)clearInterval(this.interval);this.interval=null;
      unsafe('OBS disconnected; rehearsal disarmed.');this.onState();
    });
    socket.on('ConnectionError',()=>unsafe('OBS connection error; rehearsal disarmed.'));
    socket.on('CurrentPreviewSceneChanged',(event)=>{
      if(this.socket!==socket)return;
      this.live.preview=event.sceneName;
      if(event.sceneName!==this.expectedPreview)unsafe('OBS Preview changed externally; timed return cancelled.');
      this.onState();
    });
    socket.on('CurrentProgramSceneChanged',()=>unsafe('OBS Program changed externally; rehearsal disarmed.'));
    socket.on('CurrentSceneCollectionChanging',()=>unsafe('OBS scene collection is changing; inspect again.'));
    socket.on('CurrentSceneCollectionChanged',()=>unsafe('OBS scene collection changed; inspect again.'));
    socket.on('SceneListChanged',()=>unsafe('OBS scenes changed; inspect and confirm mappings again.'));
    socket.on('StudioModeStateChanged',()=>unsafe('OBS Studio Mode changed; rehearsal disarmed.'));
    socket.on('StreamStateChanged',()=>unsafe('OBS stream state changed; rehearsal disarmed.'));
    socket.on('RecordStateChanged',()=>unsafe('OBS recording state changed; rehearsal disarmed.'));
    socket.on('VirtualcamStateChanged',()=>unsafe('OBS virtual camera state changed; rehearsal disarmed.'));
    socket.on('ReplayBufferStateChanged',()=>unsafe('OBS replay buffer state changed; rehearsal disarmed.'));
    try {
      // This catch covers ONLY the WebSocket handshake/authentication, never capability inspection.
      await this.deadline(socket.connect(endpoint,password || undefined,{rpcVersion:1}),8000);
    } catch(error) {
      if(this.socket===socket)await this.disconnect();
      throw connectionFailure(error,endpoint);
    }
    if(this.socket!==socket)throw new ObsFailure('OBS connection attempt was cancelled.');
    this.authenticated=true;
    this.live={...disconnected(),connected:true};this.onState();
    await this.refresh();
    if(this.socket===socket && this.authenticated)
      this.interval=setInterval(()=>{void this.refresh().catch(()=>{});},2500);
  }
  async read(name:ReadRequest,data:Record<string,unknown>={}):Promise<Record<string,any>> {
    const socket=this.socket;
    if(!socket || !this.authenticated)throw new ObsFailure('OBS has no authenticated connection.');
    try {return await this.deadline(socket.call(name,data as never),3500) as Record<string,any>;}
    catch(error){throw requestFailure(error,name);}
  }
  async refresh():Promise<void> {
    if(this.polling || !this.socket || !this.authenticated)return;
    this.polling=true;
    const socket=this.socket;
    try {
      const next=await readTransport(this);
      if(this.socket!==socket || !this.authenticated)return;
      this.live=next;
      if([next.streaming,next.recording,next.virtualCamera,next.replayBuffer].some(v=>v!==false))
        this.onUnsafe('OBS has an active or unknown output. Rehearsal remains disarmed.');
    } catch(error) {
      if(this.socket===socket && this.authenticated){
        // The session can be authenticated while state reads are temporarily unavailable.
        this.live={...disconnected(),connected:true,statusWarnings:[requestFailure(error,'GetVersion').message]};
        this.onUnsafe('OBS status is unavailable; rehearsal disarmed.');
      }
    } finally {this.polling=false;this.onState();}
  }
  async preview(scene:string,collection:string,valid:()=>boolean):Promise<void> {
    const socket=this.socket;
    if(!socket || !this.authenticated)throw new ObsFailure('OBS has no authenticated connection.');
    const state=await readTransport(this);
    if(this.socket!==socket || !this.authenticated)throw new ObsFailure('OBS connection changed during safety checks.');
    this.live=state;assertPreviewSafe(state,collection);
    const list=await this.read('GetSceneList');
    if(!(list.scenes || []).some((s:any)=>s.sceneName===scene))throw new Error('Mapped scene no longer exists.');
    if(!valid() || this.socket!==socket || !this.authenticated)throw new Error('Action cancelled.');
    this.expectedPreview=scene;
    try {
      // The ONLY outbound OBS write. No Program, text, audio or output writes.
      try {await this.deadline(socket.call('SetCurrentPreviewScene',{sceneName:scene}),3500);}
      catch(error){throw requestFailure(error,'SetCurrentPreviewScene');}
      const after=await this.read('GetSceneList');
      if(after.currentPreviewSceneName!==scene)throw new Error('OBS did not confirm the requested Preview scene.');
      this.live.preview=scene;
    } finally {this.expectedPreview=null;this.onState();}
  }
  async disconnect():Promise<void> {
    if(this.interval)clearInterval(this.interval);this.interval=null;
    const old=this.socket;this.socket=null;this.authenticated=false;this.live=disconnected();this.expectedPreview=null;
    if(old)try{await this.deadline(old.disconnect(),1000);}catch{/* no output shutdown */}
    this.onState();
  }
  private async deadline<T>(promise:Promise<T>,ms:number):Promise<T> {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new ObsFailure('OBS operation timed out.','BCC_TIMEOUT')),ms);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
}
