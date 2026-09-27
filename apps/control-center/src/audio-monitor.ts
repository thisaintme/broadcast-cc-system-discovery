import type {AudioChannel,AudioRow,AudioSnapshot,Reading,MeterState} from './audio-model.ts';
import {parseAudioChannels} from './audio-model.ts';

export type AudioRead = 'GetVersion'|'GetInputList'|'GetSceneList'|'GetSceneCollectionList'|'GetInputMute'|'GetInputVolume'|'GetInputAudioTracks'|'GetInputAudioMonitorType'|'GetSourceActive';
export interface AudioSession {
  read(name:AudioRead,data?:Record<string,unknown>):Promise<Record<string,unknown>>;
  subscribe(enabled:boolean):Promise<void>;
}
interface Field<T>{value:T|null;at:number|null;revision:number}
interface Row {
  name:string;kind:string;candidate:boolean;channels:AudioChannel[];sampleAt:number|null;sampleKind:'waiting'|'live'|'not-reporting'|'invalid';
  muted:Field<boolean>;volumeDb:Field<number>;tracks:Field<Record<string,boolean>>;monitor:Field<string>;active:Field<boolean>;
}
const field=<T>():Field<T>=>({value:null,at:null,revision:0});
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const name=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=240?v:'';
const age=(now:number,at:number|null)=>at===null?null:Math.max(0,now-at);
const tracks=(raw:unknown):Record<string,boolean>|null=>{
  const r=object(raw),out:Record<string,boolean>={};
  for(let i=1;i<=6;i++){const key=String(i);if(typeof r[key]!=='boolean')return null;out[key]=r[key] as boolean;}
  return out;
};
const monitor=(v:unknown)=>['OBS_MONITORING_TYPE_NONE','OBS_MONITORING_TYPE_MONITOR_ONLY','OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'].includes(String(v))?String(v):null;
const requestCode=(e:unknown)=>{const code=object(e).code;return typeof code==='number'&&Number.isInteger(code)&&code>=0&&code<5000?` (code ${code})`:'';};
/** A separate observer; it cannot select a scene, change gain/mute, or start an output. */
export class AudioMonitor {
  onUpdate:()=>void=()=>{};
  private session:AudioSession|null=null;
  private generation=0;
  private rows=new Map<string,Row>();
  private running=false;
  private starting=false;
  private collection='';
  private program='';
  private message='Connect to OBS, then start read-only meters.';
  private eventAt:number|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;
  private pollTimer:ReturnType<typeof setTimeout>|null=null;
  private now:()=>number;
  constructor(now:()=>number=()=>performance.now()){this.now=now;}
  attach(session:AudioSession):void{this.detach();this.session=session;this.message='Connected. Start read-only meters to observe audio.';this.onUpdate();}
  detach():void{
    this.halt('OBS disconnected. Start meters again after reconnecting.');this.session=null;
    this.collection='';this.program='';this.rows.clear();this.onUpdate();
  }
  private halt(message:string):void{
    this.generation++;this.running=false;this.starting=false;this.eventAt=null;this.message=message;
    if(this.timer)clearInterval(this.timer);if(this.pollTimer)clearTimeout(this.pollTimer);this.timer=null;this.pollTimer=null;
    for(const row of this.rows.values())this.invalidate(row);
    this.onUpdate();
  }
  async stop(message='Meters stopped. No OBS settings were changed.'):Promise<void>{
    const session=this.session,wasStarted=this.running||this.starting;this.halt(message);
    if(session&&wasStarted)try{await this.timeout(session.subscribe(false));}catch{/* Observation stops locally even when the connection is gone. */}
  }
  private invalidate(row:Row):void{
    row.channels=[];row.sampleAt=null;row.sampleKind='waiting';
    for(const key of ['muted','volumeDb','tracks','monitor','active'] as const){row[key].value=null;row[key].at=null;row[key].revision++;}
  }
  async start():Promise<void>{
    if(!this.session)throw new Error('Connect & inspect OBS before starting audio meters.');
    if(this.running||this.starting)return;
    const session=this.session,token=++this.generation;
    const valid=()=>this.session===session&&this.generation===token;
    this.rows.clear();this.eventAt=null;this.collection='';this.program='';this.starting=true;this.message='Reading current audio-capable inputs…';this.onUpdate();
    try{
      const [list,collection]=await Promise.all([this.query(session,'GetInputList'),this.query(session,'GetSceneCollectionList')]);
      if(!valid())return;
      const collectionName=name(collection.currentSceneCollectionName);
      if(!collectionName||!Array.isArray(list.inputs))throw new Error('OBS audio inventory is unavailable. Connect & inspect OBS again.');
      this.collection=collectionName;
      if(list.inputs.length>256)throw new Error('OBS audio observation is limited to 256 inputs. No settings changed.');
      for(const raw of list.inputs){
        const item=object(raw),inputName=name(item.inputName),kind=name(item.inputKind);if(!inputName||this.rows.has(inputName))continue;
        this.rows.set(inputName,{name:inputName,kind,candidate:/audio|capture|ffmpeg|vlc|browser/.test(kind),channels:[],sampleAt:null,sampleKind:'waiting',
          muted:field(),volumeDb:field(),tracks:field(),monitor:field(),active:field()});
      }
      this.running=true;
      await this.timeout(session.subscribe(true));
      if(!valid())return;
      this.timer=setInterval(()=>this.onUpdate(),200);
      this.message='Read-only observation. Meter activity does not prove the broadcast route.';
      await this.refresh(token);
      if(!valid())return;
      this.starting=false;this.onUpdate();this.schedule(token);
    }catch(error){
      if(!valid())return;
      this.halt(error instanceof Error&&error.message.startsWith('OBS audio')?error.message:'Audio observation could not start. Reconnect OBS and retry.');
      try{await this.timeout(session.subscribe(false));}catch{}
      throw new Error(this.message);
    }
  }
  private schedule(token:number):void{
    if(!this.running||token!==this.generation)return;
    this.pollTimer=setTimeout(()=>{void this.refresh(token).finally(()=>this.schedule(token));},2000);
  }
  private async refresh(token:number):Promise<void>{
    const session=this.session;if(!session)return;
    const valid=()=>this.running&&this.session===session&&token===this.generation;
    try{
      const [version,collection,scenes]=await Promise.all([this.query(session,'GetVersion'),this.query(session,'GetSceneCollectionList'),this.query(session,'GetSceneList')]);
      void version;if(!valid())return;
      if(name(collection.currentSceneCollectionName)!==this.collection){await this.stop('OBS collection changed. Start meters again for the new collection.');return;}
      this.program=name(scenes.currentProgramSceneName);
      const pending=[...this.rows.values()];
      const worker=async()=>{
        while(valid()&&pending.length){
          const row=pending.shift()!;
          const revision=row.muted.revision;
          let muted:Record<string,unknown>;
          try{muted=await this.query(session,'GetInputMute',{inputName:row.name});}
          catch{if(valid()&&row.muted.revision===revision){row.muted.value=null;row.muted.at=null;}continue;}
          if(!valid())return;
          if(typeof muted.inputMuted==='boolean')row.candidate=true;
          if(row.muted.revision===revision)this.set(row.muted,typeof muted.inputMuted==='boolean'?muted.inputMuted:null);
          if(!row.candidate)continue;
          await Promise.all([
            this.setting(session,row,'GetInputVolume','volumeDb',r=>typeof r.inputVolumeDb==='number'&&Number.isFinite(r.inputVolumeDb)?r.inputVolumeDb:null,valid),
            this.setting(session,row,'GetInputAudioTracks','tracks',r=>tracks(r.inputAudioTracks),valid),
            this.setting(session,row,'GetInputAudioMonitorType','monitor',r=>monitor(r.monitorType),valid),
            this.setting(session,row,'GetSourceActive','active',r=>typeof r.videoActive==='boolean'?r.videoActive:null,valid),
          ]);
        }
      };
      await Promise.all([worker(),worker(),worker(),worker()]);
      if(valid())this.message='Read-only observation. Meter activity does not prove the broadcast route.';
    }catch{
      if(valid()){
        this.eventAt=null;this.program='';
        for(const row of this.rows.values())this.invalidate(row);
        this.message='OBS audio status is unavailable. Readings are unknown; no settings changed.';
      }
    }
    if(valid())this.onUpdate();
  }
  private async setting(session:AudioSession,row:Row,request:AudioRead,key:'volumeDb'|'tracks'|'monitor'|'active',parse:(raw:Record<string,unknown>)=>unknown,valid:()=>boolean):Promise<void>{
    const target=row[key] as Field<unknown>,revision=target.revision;
    const data=request==='GetSourceActive'?{sourceName:row.name}:{inputName:row.name};
    let value:unknown=null;
    try{value=parse(await this.query(session,request,data));}catch{}
    if(valid()&&target.revision===revision)this.set(target,value);
  }
  private set<T>(target:Field<T>,value:T|null):void{target.value=value;target.at=value===null?null:this.now();}
  /** Called by the existing authenticated socket; raw events are never retained. */
  event(type:string,raw:unknown):void{
    if(!this.running)return;
    if(['CurrentSceneCollectionChanging','CurrentSceneCollectionChanged','InputCreated','InputRemoved','InputNameChanged','CurrentProfileChanging'].includes(type)){
      void this.stop('OBS inputs or collection changed. Restart read-only meters to refresh the list.');return;
    }
    if(type==='ConnectionClosed'||type==='ConnectionError'){this.detach();return;}
    const payload=object(raw),now=this.now();
    if(type==='InputVolumeMeters'){
      if(!Array.isArray(payload.inputs)||payload.inputs.length>256){this.eventAt=null;for(const row of this.rows.values()){row.channels=[];row.sampleKind='invalid';}return;}
      this.eventAt=now;const seen=new Set<string>();
      for(const input of payload.inputs){
        const item=object(input),row=this.rows.get(name(item.inputName));if(!row)continue;
        row.candidate=true;seen.add(row.name);
        const channels=parseAudioChannels(item.inputLevelsMul);
        row.channels=channels||[];row.sampleAt=now;row.sampleKind=channels?'live':'invalid';
      }
      for(const row of this.rows.values())if(!seen.has(row.name)){row.channels=[];row.sampleKind='not-reporting';}
      return;
    }
    const row=this.rows.get(name(payload.inputName));if(!row)return;
    const update=<T>(f:Field<T>,value:T|null)=>{f.revision++;this.set(f,value);};
    if(type==='InputMuteStateChanged')update(row.muted,typeof payload.inputMuted==='boolean'?payload.inputMuted:null);
    if(type==='InputVolumeChanged')update(row.volumeDb,typeof payload.inputVolumeDb==='number'&&Number.isFinite(payload.inputVolumeDb)?payload.inputVolumeDb:null);
    if(type==='InputAudioTracksChanged')update(row.tracks,tracks(payload.inputAudioTracks));
    if(type==='InputAudioMonitorTypeChanged')update(row.monitor,monitor(payload.monitorType));
    if(type==='InputActiveStateChanged')update(row.active,typeof payload.videoActive==='boolean'?payload.videoActive:null);
  }
  snapshot():AudioSnapshot{
    const now=this.now(),connected=!!this.session;
    const reading=<T>(f:Field<T>):Reading<T>=>{const ageMs=age(now,f.at),fresh=connected&&this.running&&ageMs!==null&&ageMs<=8000;return {value:fresh?f.value:null,fresh,ageMs};};
    const rows:AudioRow[]=[...this.rows.values()].filter(r=>r.candidate).map(r=>{
      const meterAgeMs=age(now,r.sampleAt),eventAge=age(now,this.eventAt);
      let meterState:MeterState=!connected?'disconnected':!this.running?'stopped':r.sampleKind;
      if(this.running&&((eventAge!==null&&eventAge>2000)||(r.sampleKind==='live'&&meterAgeMs!==null&&meterAgeMs>2000)))meterState='stale';
      return {name:r.name,kind:r.kind,meterState,meterAgeMs,channels:meterState==='live'?r.channels.map(c=>({...c})):[],
        muted:reading(r.muted),volumeDb:reading(r.volumeDb),tracks:reading(r.tracks),monitor:reading(r.monitor),active:reading(r.active)};
    });
    return {connected,running:this.running,starting:this.starting,collection:this.collection,program:this.program,message:this.message,generatedAt:Date.now(),meterEventAgeMs:age(now,this.eventAt),rows};
  }
  private async query(session:AudioSession,request:AudioRead,data?:Record<string,unknown>):Promise<Record<string,unknown>>{
    try{return await this.timeout(session.read(request,data));}catch(error){throw new Error(`OBS audio ${request} unavailable${requestCode(error)}.`);}
  }
  private async timeout<T>(promise:Promise<T>):Promise<T>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Audio read timeout')),1800);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
}
