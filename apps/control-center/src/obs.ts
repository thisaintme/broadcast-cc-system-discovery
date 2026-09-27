import OBSWebSocket,{EventSubscription} from 'obs-websocket-js/json';
import {disconnected} from './model.ts';
import type {CaptionWrite,PreviewPort,ReadRequest,Role,TransportState,Workspace} from './model.ts';
import {localEndpoint} from './workspace.ts';
import {assertPreviewSafe,readTransport} from './inspect.ts';
import {executeOffline,offlineOutputsOff} from './offline.ts';
import {connectionFailure,requestFailure,ObsFailure} from './obs-errors.ts';
import {AudioMonitor} from './audio-monitor.ts';
type Expected<T>={value:T;until:number};
export class ObsAdapter implements PreviewPort {
  readonly audio=new AudioMonitor();
  private socket:OBSWebSocket|null=null;
  private authenticated=false;
  private live=disconnected();
  private interval:ReturnType<typeof setInterval>|null=null;
  private expectedPreview:Expected<string[]>|null=null;
  private expectedProgram:Expected<string>|null=null;
  private expectedText=new Map<string,Expected<string>>();
  private expectedItems=new Map<string,Expected<boolean>>();
  private watchedText=new Set<string>();
  private polling=false;
  private epoch=0;
  private changing=false;
  onUnsafe:(reason:string)=>void=()=>{};
  onState:()=>void=()=>{};
  state():TransportState{return {...this.live,statusWarnings:[...(this.live.statusWarnings||[])],unavailableOutputs:[...(this.live.unavailableOutputs||[])]};}
  private expected<T>(entry:Expected<T>|null|undefined,value:T):boolean{return !!entry&&entry.until>=Date.now()&&entry.value===value;}
  async connect(url:string,password:string):Promise<void>{
    const endpoint=localEndpoint(url,'obs');await this.disconnect();
    const socket=new OBSWebSocket();this.socket=socket;
    const unsafe=(reason:string)=>{if(this.socket===socket){this.epoch++;this.onUnsafe(reason);}};
    socket.on('ConnectionClosed',()=>{
      if(this.socket!==socket)return;this.authenticated=false;this.live=disconnected();this.audio.detach();
      if(this.interval)clearInterval(this.interval);this.interval=null;
      unsafe('OBS disconnected; all pending rehearsal actions cancelled.');this.onState();
    });
    socket.on('ConnectionError',()=>{if(this.socket===socket)this.audio.detach();unsafe('OBS connection error; rehearsal disarmed.');});
    socket.on('CurrentPreviewSceneChanged',event=>{
      if(this.socket!==socket)return;
      const expected=this.expectedPreview;
      if(expected&&expected.until>=Date.now()&&expected.value.includes(event.sceneName))this.expectedPreview=null;
      else if(event.sceneName!==this.live.preview)unsafe('OBS Preview changed externally; timed return cancelled.');
      this.live.preview=event.sceneName;this.onState();
    });
    socket.on('CurrentProgramSceneChanged',event=>{
      if(this.socket!==socket)return;
      if(this.expected(this.expectedProgram,event.sceneName))this.expectedProgram=null;
      else if(event.sceneName!==this.live.program)unsafe('OBS Program changed externally; timed return cancelled.');
      this.live.program=event.sceneName;this.onState();
    });
    socket.on('SceneItemEnableStateChanged',event=>{
      if(this.socket!==socket)return;
      const key=JSON.stringify([event.sceneName,event.sceneItemId]);
      if(this.expected(this.expectedItems.get(key),event.sceneItemEnabled))this.expectedItems.delete(key);
      else unsafe('OBS source visibility changed externally; inspect before continuing.');
    });
    socket.on('InputSettingsChanged',event=>{
      if(this.socket!==socket||!this.watchedText.has(event.inputName))return;
      if(this.expected(this.expectedText.get(event.inputName),String(event.inputSettings?.text)))this.expectedText.delete(event.inputName);
      else unsafe('A controlled OBS caption changed externally; pending actions cancelled.');
    });
    const events=['CurrentSceneCollectionChanging','CurrentSceneCollectionChanged','SceneListChanged','SceneItemCreated','SceneItemRemoved','SceneItemListReindexed','InputNameChanged','InputRemoved','InputCreated','CurrentProfileChanging','StudioModeStateChanged','StreamStateChanged','RecordStateChanged','VirtualcamStateChanged','ReplayBufferStateChanged'] as const;
    for(const event of events)socket.on(event,()=>unsafe('OBS configuration or output state changed; rehearsal disarmed.'));
    const audioEvents=['InputVolumeMeters','InputMuteStateChanged','InputVolumeChanged','InputAudioTracksChanged','InputAudioMonitorTypeChanged','InputActiveStateChanged','CurrentSceneCollectionChanging','CurrentSceneCollectionChanged','InputCreated','InputRemoved','InputNameChanged','CurrentProfileChanging'] as const;
    for(const event of audioEvents)socket.on(event,payload=>{if(this.socket===socket&&this.authenticated)this.audio.event(event,payload);});
    try{await this.deadline(socket.connect(endpoint,password||undefined,{rpcVersion:1}),8000);}
    catch(error){if(this.socket===socket)await this.disconnect();throw connectionFailure(error,endpoint);}
    if(this.socket!==socket)throw new ObsFailure('OBS connection attempt was cancelled.');
    this.authenticated=true;
    this.audio.attach({
      read:async(name,data)=>{
        if(this.socket!==socket||!this.authenticated)throw new Error('OBS audio session is disconnected.');
        return await socket.call(name,data as never) as Record<string,unknown>;
      },
      subscribe:async enabled=>{
        if(this.socket!==socket||!this.authenticated)throw new Error('OBS audio session is disconnected.');
        // Subscription changes only: retain every normal event used by the accepted controller.
        await this.deadline(socket.reidentify({eventSubscriptions:EventSubscription.All|(enabled?EventSubscription.InputVolumeMeters|EventSubscription.InputActiveStateChanged:0)}),1800);
      },
    });
    this.live={...disconnected(),connected:true};this.onState();await this.refresh();
    if(this.socket===socket&&this.authenticated)this.interval=setInterval(()=>{void this.refresh().catch(()=>{});},2500);
  }
  async read(name:ReadRequest,data:Record<string,unknown>={}):Promise<Record<string,any>>{
    const socket=this.socket;if(!socket||!this.authenticated)throw new ObsFailure('OBS has no authenticated connection.');
    try{return await this.deadline(socket.call(name,data as never),3500) as Record<string,any>;}
    catch(error){throw requestFailure(error,name);}
  }
  async refresh():Promise<void>{
    if(this.polling||!this.socket||!this.authenticated)return;this.polling=true;
    const socket=this.socket,epoch=this.epoch;
    try{
      const next=await readTransport(this);
      if(this.socket!==socket||!this.authenticated||this.epoch!==epoch)return;
      if(!this.changing&&this.live.program&&next.program!==this.live.program){this.epoch++;this.onUnsafe('OBS Program changed outside the app; rehearsal disarmed.');}
      this.live=next;
      if(!offlineOutputsOff(next)){this.epoch++;this.onUnsafe('OBS has an active or unknown output. Rehearsal remains disarmed.');}
    }catch(error){
      if(this.socket===socket&&this.authenticated){this.live={...disconnected(),connected:true,statusWarnings:[requestFailure(error,'GetVersion').message]};this.epoch++;this.onUnsafe('OBS status is unavailable; rehearsal disarmed.');}
    }finally{this.polling=false;this.onState();}
  }
  async preview(scene:string,collection:string,valid:()=>boolean):Promise<void>{
    const socket=this.socket,epoch=this.epoch;if(!socket||!this.authenticated)throw new ObsFailure('OBS has no authenticated connection.');
    const state=await readTransport(this);this.live=state;assertPreviewSafe(state,collection);
    const list=await this.read('GetSceneList');
    if(!(list.scenes||[]).some((s:any)=>s.sceneName===scene))throw new Error('Mapped scene no longer exists.');
    if(!valid()||this.socket!==socket||this.epoch!==epoch||!this.authenticated)throw new Error('Action cancelled.');
    this.expectedPreview={value:[scene],until:Date.now()+8000};this.changing=true;
    try{
      try{await this.deadline(socket.call('SetCurrentPreviewScene',{sceneName:scene}),3500);}catch(error){throw requestFailure(error,'SetCurrentPreviewScene');}
      const after=await this.read('GetSceneList');
      if(!valid()||this.epoch!==epoch)throw new Error('Action cancelled.');
      if(after.currentPreviewSceneName!==scene)throw new Error('OBS did not confirm the requested Preview scene.');this.live.preview=scene;
    }finally{this.changing=false;this.onState();}
  }
  async offline(w:Workspace,role:'prepare'|Role,value:string,serviceId:string,valid:()=>boolean):Promise<void>{
    const socket=this.socket,epoch=this.epoch;
    if(!socket||!this.authenticated||this.changing)throw new Error('OBS is disconnected or busy.');
    const current=()=>valid()&&this.socket===socket&&this.authenticated&&this.epoch===epoch;
    this.watchedText=new Set([w.bindings.bibleText,w.bindings.nextServiceText,...w.captions.speakerPool].filter(Boolean));
    this.changing=true;
    try{
      await executeOffline({read:(name,data)=>this.read(name,data),change:async(name,data)=>{
        if(!current())throw new Error('Offline action cancelled.');await this.captionWrite(socket,name,data);
      }},w,role,value,serviceId,current);
      if(!current())throw new Error('Offline action interrupted.');this.live=await readTransport(this);
    }finally{this.changing=false;this.onState();}
  }
  private async captionWrite(socket:OBSWebSocket,name:CaptionWrite,data:Record<string,unknown>):Promise<void>{
    try{
      switch(name){
        case 'SetInputSettings':{
          const inputName=String(data.inputName),caption=String((data.inputSettings as {text:string}).text);
          this.expectedText.set(inputName,{value:caption,until:Date.now()+8000});
          await this.deadline(socket.call('SetInputSettings',{inputName,inputSettings:{text:caption},overlay:true}),3500);break;
        }
        case 'SetSceneItemEnabled':{
          const sceneName=String(data.sceneName),sceneItemId=Number(data.sceneItemId),sceneItemEnabled=data.sceneItemEnabled===true;
          this.expectedItems.set(JSON.stringify([sceneName,sceneItemId]),{value:sceneItemEnabled,until:Date.now()+8000});
          await this.deadline(socket.call('SetSceneItemEnabled',{sceneName,sceneItemId,sceneItemEnabled}),3500);break;
        }
        case 'SetCurrentProgramScene':{
          const sceneName=String(data.sceneName);this.expectedProgram={value:sceneName,until:Date.now()+10000};
          this.expectedPreview={value:[this.live.program,sceneName],until:Date.now()+10000};
          await this.deadline(socket.call('SetCurrentProgramScene',{sceneName}),3500);break;
        }
        default:throw new Error('Unsupported caption command.');
      }
    }catch(error){throw requestFailure(error,name);}
  }
  async disconnect():Promise<void>{
    this.audio.detach();
    if(this.interval)clearInterval(this.interval);this.interval=null;this.epoch++;
    const old=this.socket;this.socket=null;this.authenticated=false;this.live=disconnected();this.expectedPreview=null;this.expectedProgram=null;this.expectedText.clear();this.expectedItems.clear();this.watchedText.clear();
    if(old)try{await this.deadline(old.disconnect(),1000);}catch{/* Never stop outputs or restore scene state. */}this.onState();
  }
  private async deadline<T>(promise:Promise<T>,ms:number):Promise<T>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new ObsFailure('OBS operation timed out.','BCC_TIMEOUT')),ms);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
}
