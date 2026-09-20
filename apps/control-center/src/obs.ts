import OBSWebSocket from 'obs-websocket-js';
import {disconnected} from './model.ts';
import type {PreviewPort,ReadRequest,TransportState} from './model.ts';
import {localEndpoint} from './workspace.ts';
import {assertPreviewSafe,readTransport} from './inspect.ts';
export class ObsAdapter implements PreviewPort {
  private socket:OBSWebSocket|null=null;
  private live=disconnected();
  private interval:ReturnType<typeof setInterval>|null=null;
  private expectedPreview:string|null=null;
  private polling=false;
  onUnsafe:(reason:string)=>void=()=>{};
  onState:()=>void=()=>{};
  state():TransportState {return {...this.live};}
  async connect(url:string,password:string):Promise<void> {
    await this.disconnect();
    const socket=new OBSWebSocket();this.socket=socket;
    const unsafe=(reason:string)=>{if(this.socket===socket)this.onUnsafe(reason);};
    socket.on('ConnectionClosed',()=>{if(this.socket===socket){this.live=disconnected();unsafe('OBS disconnected; rehearsal disarmed.');this.onState();}});
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
      await this.deadline(socket.connect(localEndpoint(url,'obs'),password || undefined,{rpcVersion:1}),8000);
      this.live=await readTransport(this);
      this.interval=setInterval(()=>{void this.refresh().catch(()=>{});},2500);
      this.onState();
    } catch {await this.disconnect();throw new Error('Could not connect to OBS. Check the WebSocket port, password and server setting.');}
  }
  async read(name:ReadRequest,data:Record<string,unknown>={}):Promise<Record<string,any>> {
    if(!this.socket)throw new Error('OBS is disconnected.');
    return await this.deadline(this.socket.call(name,data as never),3500) as Record<string,any>;
  }
  async refresh():Promise<void> {
    if(this.polling || !this.socket)return;
    this.polling=true;
    const socket=this.socket;
    try {
      const next=await readTransport(this);
      if(this.socket!==socket)return;
      this.live=next;
      if([this.live.streaming,this.live.recording,this.live.virtualCamera,this.live.replayBuffer].some(v=>v!==false))
        this.onUnsafe('OBS has an active or unknown output. Rehearsal remains disarmed.');
    } catch {if(this.socket===socket){this.live=disconnected();this.onUnsafe('OBS status is unavailable; rehearsal disarmed.');}}
    finally{this.polling=false;this.onState();}
  }
  async preview(scene:string,collection:string,valid:()=>boolean):Promise<void> {
    const socket=this.socket;
    if(!socket)throw new Error('OBS is disconnected.');
    const state=await readTransport(this);this.live=state;
    assertPreviewSafe(state,collection);
    const list=await this.read('GetSceneList');
    if(!(list.scenes || []).some((s:any)=>s.sceneName===scene))throw new Error('Mapped scene no longer exists.');
    if(!valid() || this.socket!==socket)throw new Error('Action cancelled.');
    this.expectedPreview=scene;
    try {
      // The ONLY outbound OBS write in this application. No Program, text, audio or output writes.
      await this.deadline(socket.call('SetCurrentPreviewScene',{sceneName:scene}),3500);
      const after=await this.read('GetSceneList');
      if(after.currentPreviewSceneName!==scene)throw new Error('OBS did not confirm the requested Preview scene.');
      this.live.preview=scene;
    } finally {this.expectedPreview=null;this.onState();}
  }
  async disconnect():Promise<void> {
    if(this.interval)clearInterval(this.interval);this.interval=null;
    const old=this.socket;this.socket=null;this.live=disconnected();
    if(old)try{await old.disconnect();}catch{/* no output shutdown */}
  }
  private async deadline<T>(promise:Promise<T>,ms:number):Promise<T> {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error('OBS request timed out.')),ms);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
}
