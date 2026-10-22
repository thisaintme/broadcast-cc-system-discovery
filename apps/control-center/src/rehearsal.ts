import type {Workspace,RuntimeState,PreviewPort,Mode,Role} from './model.ts';
import {ROLES} from './model.ts';
import {selectService,text} from './workspace.ts';
import {assertPreviewSafe} from './inspect.ts';
import {assertOfflineSafe} from './offline.ts';
export interface Clock {now():number;set(fn:()=>void,ms:number):unknown;clear(handle:unknown):void}
const clock:Clock={now:()=>Date.now(),set:(fn,ms)=>setTimeout(fn,ms),clear:h=>clearTimeout(h as ReturnType<typeof setTimeout>)};
export class Rehearsal {
  runtime:RuntimeState;
  private generation=0;private timer:unknown=null;private serviceAudioInput='';
  private port:PreviewPort;private workspace:()=>Workspace;private emit:()=>void;private clock:Clock;
  constructor(workspace:()=>Workspace,port:PreviewPort,emit:()=>void,time:Clock=clock){
    this.workspace=workspace;this.port=port;this.emit=emit;this.clock=time;
    this.runtime={mode:'simulation',phase:'idle',selectedService:selectService(workspace()),overlay:'',returnAt:null,busy:false,events:[],serviceAudioEnabled:false};
  }
  log(message:string):void{this.runtime.events=[{at:new Date(this.clock.now()).toISOString(),message},...this.runtime.events].slice(0,150);this.emit();}
  cancel():void{this.generation++;if(this.timer!==null)this.clock.clear(this.timer);this.timer=null;this.runtime.returnAt=null;}
  interrupt(message:string):void{this.cancel();this.serviceAudioInput='';this.runtime.serviceAudioEnabled=false;this.runtime.mode='simulation';this.runtime.phase='idle';this.runtime.overlay='';this.log(message);}
  async setMode(mode:Mode,serviceAudioInput=''):Promise<void>{
    if(this.runtime.busy)throw new Error('An action is still in progress.');this.cancel();
    if(mode!=='simulation'){
      const w=this.workspace();
      if(!w.bindings.confirmed||ROLES.some(r=>!w.inventory?.scenes.includes(w.bindings.scenes[r])))throw new Error('Confirm all five scene mappings against the inspected collection first.');
      if(mode==='obs-preview')assertPreviewSafe(this.port.state(),w.inventory?.collection||'');
      else if(mode==='offline-program'){
        assertOfflineSafe(this.port.state(),w);if(!this.port.offline)throw new Error('Offline Program adapter is unavailable.');
        if(serviceAudioInput&&(serviceAudioInput!==w.bindings.audioInput||!w.inventory?.inputs.some(i=>i.name===serviceAudioInput)))
          throw new Error('Service-audio selection does not match the inspected input.');
      }else throw new Error('Unknown mode.');
    }
    this.serviceAudioInput=mode==='offline-program'?serviceAudioInput:'';
    this.runtime.serviceAudioEnabled=!!this.serviceAudioInput;
    this.runtime.mode=mode;this.runtime.phase='idle';this.runtime.overlay='';
    this.log(`Mode: ${mode}. Service-audio mute policy ${this.serviceAudioInput?'enabled for '+this.serviceAudioInput:'off'}. Streaming and hardware controls remain unavailable.`);
  }
  async command(command:string,value=''):Promise<void>{
    if(command==='reset'){this.interrupt('Rehearsal cancelled. Completed OBS scene, caption and mute changes were left unchanged.');return;}
    if(this.runtime.busy)throw new Error('An action is still in progress.');this.cancel();
    if(command==='select'){
      if(this.runtime.phase!=='idle')throw new Error('Reset the rehearsal before selecting another service.');
      if(!this.workspace().services.some(s=>s.id===value))throw new Error('Unknown service.');this.runtime.selectedService=value;this.emit();return;
    }
    const phase=this.runtime.phase;
    if(command==='prepare'){
      if(phase!=='idle'||!this.workspace().services.some(s=>s.id===this.runtime.selectedService))throw new Error('Select a scheduled service first.');
    }else{
      const permitted:Record<string,string[]>={intro:['prepared'],main:['intro','main','speaker','bible'],speaker:['main','speaker','bible'],bible:['main','speaker','bible'],outro:['intro','main','speaker','bible']};
      if(!permitted[command]?.includes(phase))throw new Error('That action is not available in this rehearsal phase.');
    }
    const overlay=text(value,500);
    if(['speaker','bible'].includes(command)&&!overlay.trim())throw new Error('Choose a speaker or enter a Bible reference first.');
    const token=this.generation;this.runtime.busy=true;this.emit();
    try{
      await this.apply(command as 'prepare'|Role,token,overlay);
      if(token!==this.generation)return;
      this.runtime.phase=command==='prepare'?'prepared':command as Role;this.runtime.overlay=['speaker','bible'].includes(command)?overlay:'';
      this.log(`${this.runtime.mode==='simulation'?'Simulated':this.runtime.mode==='obs-preview'?'OBS Preview':'Offline OBS Program'}: ${command}.`);
      if(command==='speaker'||command==='bible'){
        this.runtime.returnAt=this.clock.now()+10000;this.timer=this.clock.set(()=>{void this.returnMain(token);},10000);
      }
    }catch(error){this.interrupt('Action stopped. Completed scene, caption or mute changes may remain; review OBS before retrying.');throw error;}
    finally{this.runtime.busy=false;this.emit();}
  }
  private async apply(role:'prepare'|Role,token:number,value=''):Promise<void>{
    const mode=this.runtime.mode;if(mode==='simulation')return;
    const w=this.workspace();
    if(!w.bindings.confirmed)throw new Error('Unconfirmed scene mapping.');
    const valid=()=>token===this.generation&&this.runtime.mode===mode;
    if(mode==='offline-program'){
      if(!this.port.offline)throw new Error('Offline adapter unavailable.');
      // Only the deliberate Intro -> Main action opens audio. Timer/manual returns never do.
      const intent=this.serviceAudioInput?{inputName:this.serviceAudioInput,goOnAir:role==='main'&&this.runtime.phase==='intro'}:undefined;
      await this.port.offline(w,role,value,this.runtime.selectedService,valid,intent);return;
    }
    if(role==='prepare')return;
    const scene=w.bindings.scenes[role];if(!scene)throw new Error('Unconfirmed scene mapping.');
    await this.port.preview(scene,w.inventory?.collection||'',valid);
  }
  private async returnMain(token:number):Promise<void>{
    if(token!==this.generation||this.runtime.busy)return;this.runtime.busy=true;this.emit();
    try{await this.apply('main',token);if(token!==this.generation)return;
      this.runtime.phase='main';this.runtime.overlay='';this.runtime.returnAt=null;this.timer=null;this.log('Timed return to Main; service audio unchanged.');
    }catch{this.interrupt('Timed return cancelled: OBS state could not be verified.');}
    finally{this.runtime.busy=false;this.emit();}
  }
}
