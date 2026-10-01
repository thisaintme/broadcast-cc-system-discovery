import OBSWebSocket,{EventSubscription} from 'obs-websocket-js/json';
import {disconnected} from './model.ts';
import type {CaptionWrite,PreviewPort,ReadRequest,Role,TransportState,Workspace} from './model.ts';
import {localEndpoint} from './workspace.ts';
import {assertPreviewSafe,readTransport} from './inspect.ts';
import {assertOfflineSafe,offlineOutputsOff} from './offline.ts';
import {connectionFailure,requestFailure,ObsFailure} from './obs-errors.ts';
import {AudioMonitor} from './audio-monitor.ts';
import {executeWithServiceAudio,serviceMuteTarget,unknownServiceAudio,verifyServiceInput} from './service-audio.ts';
import type {ServiceAudioIntent,ServiceAudioStatus} from './service-audio.ts';
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
  private polling=false;private epoch=0;private changing=false;
  private serviceMute=unknownServiceAudio();
  private muteRevision=0;private expectedMute:Expected<boolean>|null=null;
  onUnsafe:(reason:string)=>void=()=>{};
  onState:()=>void=()=>{};
  state():TransportState{return {...this.live,statusWarnings:[...(this.live.statusWarnings||[])],unavailableOutputs:[...(this.live.unavailableOutputs||[])]};}
  serviceAudioState():ServiceAudioStatus {
    if(!this.authenticated)return unknownServiceAudio(this.serviceMute.inputName,'OBS disconnected; mute state unknown.');
    if(this.serviceMute.phase==='confirmed'&&(this.serviceMute.checkedAt===null||Date.now()-this.serviceMute.checkedAt>6000))
      return unknownServiceAudio(this.serviceMute.inputName,'Mute status is stale; not confirmed.');
    return {...this.serviceMute};
  }
  private expected<T>(entry:Expected<T>|null|undefined,value:T):boolean{return !!entry&&entry.until>=Date.now()&&entry.value===value;}
  async verifyServiceAudio(w:Workspace):Promise<void> {
    const socket=this.socket,epoch=this.epoch;
    if(!socket||!this.authenticated)throw new Error('Connect to OBS before enabling service audio.');
    assertOfflineSafe(await readTransport(this),w);
    const inputName=w.bindings.audioInput;
    this.serviceMute=unknownServiceAudio(inputName);this.muteRevision++;
    const revision=this.muteRevision;
    const valid=()=>this.socket===socket&&this.authenticated&&this.epoch===epoch&&this.muteRevision===revision;
    try {
      const muted=await verifyServiceInput(this,w,inputName,valid);
      if(!valid())throw new Error('Audio confirmation was interrupted.');
      this.serviceMute={inputName,muted,checkedAt:Date.now(),phase:'confirmed',note:'Observed OBS input mute state. Enabling the mode does not change it.'};
    }catch(error){if(this.socket===socket)this.serviceMute=unknownServiceAudio(inputName,'Service-input verification failed.');throw error;}
    finally{this.onState();}
  }
  private async refreshServiceMute(socket:OBSWebSocket):Promise<void> {
    const observed=this.serviceMute;
    const name=observed.inputName,revision=this.muteRevision,epoch=this.epoch;
    if(!name||this.changing||observed.phase==='pending')return;
    try {
      const result=await this.read('GetInputMute',{inputName:name});
      // A delayed poll must not replace a newer event, pending command or successful readback.
      if(this.socket!==socket||!this.authenticated||revision!==this.muteRevision||epoch!==this.epoch||this.changing||this.serviceMute!==observed)return;
      if(typeof result.inputMuted!=='boolean')throw new Error('Unknown mute state.');
      this.serviceMute={inputName:name,muted:result.inputMuted,checkedAt:Date.now(),phase:'confirmed',note:'Observed OBS input mute state; not a final-stream sound measurement.'};
    }catch{
      if(this.socket===socket&&revision===this.muteRevision&&!this.changing&&this.serviceMute===observed)this.serviceMute=unknownServiceAudio(name,'Mute status read failed; not confirmed.');
    }
  }
  async connect(url:string,password:string):Promise<void>{
    const endpoint=localEndpoint(url,'obs');await this.disconnect();
    const socket=new OBSWebSocket();this.socket=socket;
    const unsafe=(reason:string)=>{if(this.socket===socket){this.epoch++;this.onUnsafe(reason);}};
    socket.on('ConnectionClosed',()=>{
      if(this.socket!==socket)return;this.authenticated=false;this.live=disconnected();this.audio.detach();
      this.serviceMute=unknownServiceAudio(this.serviceMute.inputName,'OBS disconnected; no audio command replayed.');this.muteRevision++;
      if(this.interval)clearInterval(this.interval);this.interval=null;
      unsafe('OBS disconnected; all pending rehearsal actions cancelled.');this.onState();
    });
    socket.on('ConnectionError',()=>{
      if(this.socket===socket){this.audio.detach();this.serviceMute=unknownServiceAudio(this.serviceMute.inputName,'OBS connection error; mute state unknown.');this.muteRevision++;}
      unsafe('OBS connection error; rehearsal disarmed.');
    });
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
    socket.on('InputMuteStateChanged',event=>{
      if(this.socket!==socket||!this.authenticated||event.inputName!==this.serviceMute.inputName)return;
      if(this.expected(this.expectedMute,event.inputMuted))this.expectedMute=null;
      else this.muteRevision++;
      // Manual mute changes do not disarm caption timers and are never automatically reversed.
      if(this.serviceMute.phase!=='pending')this.serviceMute=typeof event.inputMuted==='boolean'?
        {inputName:event.inputName,muted:event.inputMuted,checkedAt:Date.now(),phase:'confirmed',note:'OBS reported an input mute change.'}:
        unknownServiceAudio(event.inputName,'Invalid mute event; state unknown.');
      this.onState();
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
    for(const event of events)socket.on(event,()=>{
      if(this.socket===socket&&['CurrentSceneCollectionChanging','CurrentSceneCollectionChanged','InputNameChanged','InputRemoved','CurrentProfileChanging'].includes(event)){
        this.serviceMute=unknownServiceAudio();this.expectedMute=null;this.muteRevision++;
      }
      unsafe('OBS configuration or output state changed; rehearsal disarmed.');
    });
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
      await this.refreshServiceMute(socket);
    }catch(error){
      if(this.socket===socket&&this.authenticated){this.live={...disconnected(),connected:true,statusWarnings:[requestFailure(error,'GetVersion').message]};this.serviceMute=unknownServiceAudio(this.serviceMute.inputName,'OBS status unavailable.');this.epoch++;this.onUnsafe('OBS status is unavailable; rehearsal disarmed.');}
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
  async offline(w:Workspace,role:'prepare'|Role,value:string,serviceId:string,valid:()=>boolean,intent?:ServiceAudioIntent):Promise<void>{
    const socket=this.socket,epoch=this.epoch;
    if(!socket||!this.authenticated||this.changing)throw new Error('OBS is disconnected or busy.');
    const audioAction=serviceMuteTarget(role,intent)!==null;
    if(audioAction&&this.serviceMute.inputName!==intent!.inputName){this.serviceMute=unknownServiceAudio(intent!.inputName);this.muteRevision++;}
    const muteRevision=this.muteRevision;
    const current=()=>valid()&&this.socket===socket&&this.authenticated&&this.epoch===epoch&&(!audioAction||this.muteRevision===muteRevision);
    this.watchedText=new Set([w.bindings.bibleText,w.bindings.nextServiceText,...w.captions.speakerPool].filter(Boolean));
    this.changing=true;
    try{
      await executeWithServiceAudio({read:(name,data)=>this.read(name,data),change:async(name,data)=>{
        if(!current())throw new Error('Offline action cancelled.');await this.captionWrite(socket,name,data);
      },mute:async(inputName,muted)=>{
        if(!audioAction||inputName!==intent?.inputName||inputName!==w.bindings.audioInput||!current())throw new Error('Audio action cancelled or input mismatch.');
        this.expectedMute={value:muted,until:Date.now()+4000};
        try{await this.deadline(socket.call('SetInputMute',{inputName,inputMuted:muted}),3500);}
        catch(error){throw requestFailure(error,'SetInputMute');}
      }},w,role,value,serviceId,current,intent,status=>{
        if(this.socket===socket){this.serviceMute=status;this.onState();}
      });
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
    if(this.interval)clearInterval(this.interval);this.interval=null;this.epoch++;this.muteRevision++;
    const old=this.socket;this.socket=null;this.authenticated=false;this.live=disconnected();this.expectedPreview=null;this.expectedProgram=null;this.expectedText.clear();this.expectedItems.clear();this.watchedText.clear();
    this.expectedMute=null;this.serviceMute=unknownServiceAudio();
    if(old)try{await this.deadline(old.disconnect(),1000);}catch{/* Never stop outputs, restore a mute or replay a command. */}this.onState();
  }
  private async deadline<T>(promise:Promise<T>,ms:number):Promise<T>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new ObsFailure('OBS operation timed out.','BCC_TIMEOUT')),ms);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
}
