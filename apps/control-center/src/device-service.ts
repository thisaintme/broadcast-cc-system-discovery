import type {Workspace} from './model.ts';
import type {DeviceConfig,PresentationRole} from './presentation-model.ts';
import {defaultPresentation,deviceHost} from './presentation-model.ts';
import {LiveFailure} from './live-contract.ts';
import {readPresenter,reviewPresenter,changePresenter,readCamera,recallCamera,readMixer,muteMixer,readLight,setLight,devicePause} from './device-transport.ts';
import type {Guard,PresenterStatus,PresenterTarget} from './device-transport.ts';
export type DeviceId='webPresenter'|'front'|'side'|'mixer'|'light'|'switcher';
export interface DeviceReading {enabled:boolean;status:'unknown'|'ready'|'warning';message:string;observedAt:number|null;detail:string;stream?:PresenterStatus;program:number|null;preview:number|null}
export interface EndStep {id:string;label:string;status:'pending'|'running'|'done'|'failed'|'skipped';message:string}
export interface DeviceSnapshot {granted:boolean;busy:boolean;readings:Record<DeviceId,DeviceReading>;end:EndStep[]}
const keys:DeviceId[]=['webPresenter','front','side','mixer','light','switcher'];
const names:Record<DeviceId,string>={webPresenter:'Web Presenter',front:'Kamera vorne',side:'Kamera seitlich',mixer:'Mischpult',light:'Licht',switcher:'Bildmischer'};
const blank=(enabled=false):DeviceReading=>({enabled,status:'unknown',message:enabled?'Noch nicht geprüft':'Nicht verwendet',observedAt:null,detail:'',program:null,preview:null});
export class DeviceService {
  private epoch=0;private mutation=0;private grantKey='';private busy=false;private checks=false;private poll:ReturnType<typeof setInterval>|null=null;
  private atem:any=null;private atemKey='';private atemConnected=false;
  private readings=Object.fromEntries(keys.map(k=>[k,blank()])) as Record<DeviceId,DeviceReading>;private end:EndStep[]=[];
  constructor(private readonly workspace:()=>Workspace,private readonly changed:()=>void,private readonly journal:(message:string)=>Promise<void>){}
  config():DeviceConfig{return this.workspace().presentation?.devices||defaultPresentation().devices;}
  key(){return JSON.stringify(this.config());}
  snapshot():DeviceSnapshot {const current=this.config(),now=Date.now();const readings=structuredClone(this.readings);for(const key of keys){const d=readings[key];if(!current[key].enabled)readings[key]=blank();else if(d.observedAt===null||now-d.observedAt>12000||d.observedAt>now){readings[key]={...blank(true),message:'Zustand nicht aktuell'};}}return {granted:this.grantKey===this.key(),busy:this.busy,readings,end:structuredClone(this.end)};}
  grant(){this.grantKey=this.key();this.epoch++;this.changed();}
  release(){this.grantKey='';this.epoch++;this.changed();}
  changedConfig(){this.release();this.readings=Object.fromEntries(keys.map(k=>[k,blank(this.config()[k].enabled)])) as Record<DeviceId,DeviceReading>;void this.configureAtem();this.changed();}
  private guard(external:Guard=async()=>{},grant=true):Guard{const epoch=this.epoch,key=this.key();return async()=>{if(epoch!==this.epoch||key!==this.key()||grant&&this.grantKey!==key)throw new LiveFailure('Gerätesteuerung wurde aufgehoben. Keine weitere Aktion wurde gesendet.');await external();if(epoch!==this.epoch||key!==this.key()||grant&&this.grantKey!==key)throw new LiveFailure('Gerätesteuerung wurde aufgehoben.');};}
  start(){if(this.poll)return;void this.check();this.poll=setInterval(()=>void this.check(),5000);}
  async close(){if(this.poll)clearInterval(this.poll);this.poll=null;this.release();const a=this.atem;this.atem=null;this.atemConnected=false;try{await a?.destroy();}catch{}}
  private success(id:DeviceId,detail:string,extra:Partial<DeviceReading>={}){this.readings[id]={...blank(true),status:'ready',message:'Bestätigt',observedAt:Date.now(),detail,...extra};this.changed();}
  private failure(id:DeviceId){this.readings[id]={...blank(true),status:'warning',message:'Nicht bestätigt · Gerät und Verbindung prüfen'};this.changed();}
  private async configureAtem(){const d=this.config().switcher,key=JSON.stringify(d);if(key===this.atemKey)return;this.atemKey=key;const old=this.atem;this.atem=null;this.atemConnected=false;try{await old?.destroy();}catch{}if(!d.enabled)return;
    try{const {Atem}=await import('atem-connection');if(this.atemKey!==key)return;const a=new Atem({disableMultithreaded:true});this.atem=a;
      a.on('connected',()=>{if(this.atem!==a)return;this.atemConnected=true;this.updateTally();});
      a.on('disconnected',()=>{if(this.atem!==a)return;this.atemConnected=false;this.failure('switcher');});
      a.on('error',()=>{if(this.atem===a){this.atemConnected=false;this.failure('switcher');}});
      a.on('stateChanged',()=>{if(this.atem===a)this.updateTally();});
      await a.connect(deviceHost(d.host),d.port);
    }catch{this.failure('switcher');}}
  private updateTally(){const me=this.atemConnected?this.atem?.state?.video?.mixEffects?.[0]:null;if(!me||!Number.isInteger(me.programInput)||!Number.isInteger(me.previewInput)){this.failure('switcher');return;}this.success('switcher',`Programm: Eingang ${me.programInput}`,{program:me.programInput,preview:me.previewInput});}
  /** Check is strictly read-only. No connection check may move a camera or mute a bus. */
  async check(){if(this.checks||this.busy)return this.snapshot();this.checks=true;const mutation=this.mutation,key=this.key(),c=structuredClone(this.config());try{await this.configureAtem();await Promise.all(keys.map(async id=>{if(!c[id].enabled){this.readings[id]=blank();return;}if(id==='switcher'){this.updateTally();return;}try{
      let detail='',extra:Partial<DeviceReading>={};
      if(id==='webPresenter'){const stream=await readPresenter(c.webPresenter);detail=stream.state==='Idle'?'Sendet nicht':stream.state==='Streaming'?'Encoder sendet':'Verbindung wird hergestellt oder ist unterbrochen';extra={stream,status:['Idle','Streaming'].includes(stream.state)?'ready':'warning'};}
      else if(id==='front'||id==='side'){const camera=await readCamera(c[id]);detail=camera.power?'Eingeschaltet':'Bereitschaft';}
      else if(id==='light'){detail=(await readLight(c.light)).on?'Licht an':'Licht aus';}
      else{const mixer=await readMixer(c.mixer,c.mixer.buses);detail=Object.entries(mixer.muted).map(([bus,muted])=>`Bus ${bus}: ${muted?'stumm':'an'}`).join(' · ');}
      if(key===this.key()&&mutation===this.mutation)this.success(id,detail,extra);
    }catch{if(key===this.key()&&mutation===this.mutation)this.failure(id);}}));}finally{this.checks=false;this.changed();}return this.snapshot();}
  async camera(slot:'front'|'side',presetId:string,external:Guard=async()=>{}){if(this.busy)throw new LiveFailure('Eine Geräteaktion läuft bereits.');const guard=this.guard(external),d=this.config()[slot],preset=d.presets.find(p=>p.id===presetId);if(!d.enabled||!preset)throw new LiveFailure('Diese Kameraposition ist nicht eingerichtet.');this.busy=true;this.mutation++;this.changed();try{await guard();await this.journal(`Kameraposition angefordert: ${slot}, ${preset.number}`);await guard();const result=await recallCamera(d,preset.number,guard);await guard();this.success(slot,`${preset.name}: Fahrt bestätigt · Position ${result.position}`);}catch(error){this.failure(slot);throw error;}finally{this.busy=false;this.changed();}}
  async scene(role:PresentationRole,guard:Guard){const selected=this.workspace().presentation?.scenes[role]?.camera;if(!selected)return;const match=selected.match(/^(front|side):([\w-]+)$/);if(!match)throw new LiveFailure('Ungültige Kamerazuordnung.');await this.camera(match[1] as 'front'|'side',match[2],guard);}
  async light(on:boolean){if(this.busy)throw new LiveFailure('Eine Geräteaktion läuft bereits.');const guard=this.guard();this.busy=true;this.mutation++;this.changed();try{await guard();await this.journal(on?'Licht einschalten angefordert.':'Licht ausschalten angefordert.');await guard();await setLight(this.config().light,on,guard);this.success('light',on?'Licht an':'Licht aus');}catch(error){this.failure('light');throw error;}finally{this.busy=false;this.changed();}}
  async reviewRussian(key:string){return reviewPresenter(this.config().webPresenter,key);}
  async russian(action:'Start'|'Stop',target:PresenterTarget,external:Guard){this.mutation++;const guard=this.guard(external,false);await guard();await this.journal(`Russischer Encoder: ${action==='Start'?'Start':'Ende'} angefordert.`);await guard();try{const stream=await changePresenter(this.config().webPresenter,action,target,guard);await guard();this.success('webPresenter',stream.state==='Streaming'?'Encoder sendet':'Sendet nicht',{stream});return stream;}catch(error){this.failure('webPresenter');throw error;}}
  async allOutputsOff(obsOff:Guard){await obsOff();if(this.config().webPresenter.enabled){const p=await readPresenter(this.config().webPresenter);if(p.state!=='Idle')throw new LiveFailure('Russisch sendet noch oder ist nicht bestätigt. Gemeinsame Geräte bleiben unverändert.');}await obsOff();}
  plannedEnd():string[]{const c=this.config(),a:string[]=[];if(c.end.recording)a.push('OBS-Aufnahme beenden');if(c.end.cameras){for(const slot of ['front','side'] as const)if(c[slot].enabled)a.push(`${names[slot]} in Ruheposition ${c[slot].sleepPreset}`);}if(c.end.mixer&&c.mixer.enabled)a.push(`Mischpult-Busse ${c.mixer.buses.join(', ')} stummschalten`);if(c.end.light&&c.light.enabled)a.push('Licht ausschalten');return a;}
  skipEnd(message:string){this.end=this.plannedEnd().map((label,i)=>({id:String(i),label,status:'skipped',message}));this.changed();}
  async finish(obsOff:Guard,stopRecording:Guard,external:Guard){const c=structuredClone(this.config()),guard=this.guard(async()=>{await external();await this.allOutputsOff(obsOff);},false);
    const steps:{id:string;label:string;run:()=>Promise<unknown>}[]=[];
    if(c.end.recording)steps.push({id:'recording',label:'Aufnahme beenden',run:stopRecording});
    if(c.end.cameras)for(const slot of ['front','side'] as const)if(c[slot].enabled)steps.push({id:slot,label:`${names[slot]} · Ruheposition`,run:()=>recallCamera(c[slot],c[slot].sleepPreset,guard)});
    if(c.end.mixer&&c.mixer.enabled)steps.push({id:'mixer',label:'Mischpult stummschalten',run:()=>muteMixer(c.mixer,c.mixer.buses,guard)});
    if(c.end.light&&c.light.enabled)steps.push({id:'light',label:'Licht ausschalten',run:()=>setLight(c.light,false,guard)});
    this.end=steps.map(s=>({id:s.id,label:s.label,status:'pending',message:''}));this.changed();
    for(let i=0;i<steps.length;i++){try{await guard();this.end[i].status='running';this.changed();await this.journal(`Ende-Automatik: ${steps[i].label} angefordert.`);await guard();await steps[i].run();await guard();this.end[i].status='done';this.end[i].message='Bestätigt';}
      catch{this.end[i].status='failed';this.end[i].message='Nicht bestätigt; bitte am Gerät prüfen.';for(let j=i+1;j<steps.length;j++){this.end[j].status='skipped';this.end[j].message='Nach Fehler nicht ausgeführt.';}this.changed();throw new LiveFailure('Übertragung beendet, Geräteabschluss aber nicht vollständig bestätigt. Bitte die Ende-Checkliste prüfen.');}this.changed();}
  }
}
