import type {Workspace, RuntimeState, PreviewPort, Mode, Role} from './model.ts';
import {ROLES} from './model.ts';
import {selectService, text} from './workspace.ts';
import {assertPreviewSafe} from './inspect.ts';
export interface Clock {now():number; set(fn:()=>void,ms:number):unknown; clear(handle:unknown):void}
const clock:Clock={now:()=>Date.now(),set:(fn,ms)=>setTimeout(fn,ms),clear:h=>clearTimeout(h as ReturnType<typeof setTimeout>)};
export class Rehearsal {
  runtime:RuntimeState;
  private generation=0; private timer:unknown=null;
  private port:PreviewPort; private workspace:()=>Workspace; private emit:()=>void; private clock:Clock;
  constructor(workspace:()=>Workspace,port:PreviewPort,emit:()=>void,time:Clock=clock) {
    this.workspace=workspace;this.port=port;this.emit=emit;this.clock=time;
    this.runtime={mode:'simulation',phase:'idle',selectedService:selectService(workspace()),overlay:'',returnAt:null,busy:false,events:[]};
  }
  log(message:string):void {
    this.runtime.events=[{at:new Date(this.clock.now()).toISOString(),message},...this.runtime.events].slice(0,150);this.emit();
  }
  cancel():void {this.generation++;if(this.timer!==null)this.clock.clear(this.timer);this.timer=null;this.runtime.returnAt=null;}
  interrupt(message:string):void {
    this.cancel();this.runtime.mode='simulation';this.runtime.phase='idle';this.runtime.overlay='';this.log(message);
  }
  async setMode(mode:Mode):Promise<void> {
    if(this.runtime.busy) throw new Error('An action is still in progress.');
    this.cancel();
    if(mode==='obs-preview') {
      const w=this.workspace();
      if(!w.bindings.confirmed || ROLES.some(r=>!w.inventory?.scenes.includes(w.bindings.scenes[r])))
        throw new Error('Confirm all five scene mappings against the inspected collection first.');
      assertPreviewSafe(this.port.state(),w.inventory?.collection || '');
    }
    this.runtime.mode=mode;this.runtime.phase='idle';this.runtime.overlay='';this.log(`Mode: ${mode}. No streaming or hardware controls are enabled.`);
  }
  async command(command:string,value=''):Promise<void> {
    if(this.runtime.busy) throw new Error('An action is still in progress.');
    this.cancel();
    if(command==='reset') {this.interrupt('Rehearsal reset. No OBS state was restored or changed.');return;}
    if(command==='select') {
      if(this.runtime.phase!=='idle') throw new Error('Reset the rehearsal before selecting another service.');
      if(!this.workspace().services.some(s=>s.id===value)) throw new Error('Unknown service.');
      this.runtime.selectedService=value;this.emit();return;
    }
    const phase=this.runtime.phase;
    if(command==='prepare') {
      if(phase!=='idle' || !this.workspace().services.some(s=>s.id===this.runtime.selectedService)) throw new Error('Select a scheduled service first.');
      this.runtime.phase='prepared';this.log('Service prepared for rehearsal only.');return;
    }
    const permitted:Record<string,string[]>={intro:['prepared'],main:['intro','main','speaker','bible'],speaker:['main','speaker','bible'],bible:['main','speaker','bible'],outro:['intro','main','speaker','bible']};
    if(!permitted[command]?.includes(phase)) throw new Error('That action is not available in this rehearsal phase.');
    const overlay=text(value,500);
    if(['speaker','bible'].includes(command) && !overlay.trim()) throw new Error('Choose a speaker or enter a Bible reference first.');
    const token=this.generation;
    this.runtime.busy=true;this.emit();
    try {
      await this.apply(command as Role,token);
      if(token!==this.generation)return;
      this.runtime.phase=command as Role;this.runtime.overlay=['speaker','bible'].includes(command)?overlay:'';
      this.log(`${this.runtime.mode==='simulation'?'Simulated':'OBS Preview'}: ${command}.`);
      if(command==='speaker' || command==='bible') {
        this.runtime.returnAt=this.clock.now()+10000;
        this.timer=this.clock.set(()=>{void this.returnMain(token);},10000);
      }
    } catch(error) {this.interrupt('Action stopped. Check OBS connection and output status.');throw error;}
    finally {this.runtime.busy=false;this.emit();}
  }
  private async apply(role:Role,token:number):Promise<void> {
    if(this.runtime.mode==='simulation')return;
    const w=this.workspace(), scene=w.bindings.scenes[role];
    if(!scene || !w.bindings.confirmed)throw new Error('Unconfirmed scene mapping.');
    await this.port.preview(scene,w.inventory?.collection || '',()=>token===this.generation && this.runtime.mode==='obs-preview');
  }
  private async returnMain(token:number):Promise<void> {
    if(token!==this.generation || this.runtime.busy)return;
    this.runtime.busy=true;this.emit();
    try {
      await this.apply('main',token);
      if(token!==this.generation)return;
      this.runtime.phase='main';this.runtime.overlay='';this.runtime.returnAt=null;this.timer=null;this.log('Timed return to Main.');
    } catch {this.interrupt('Timed return cancelled: OBS state could not be verified.');}
    finally {this.runtime.busy=false;this.emit();}
  }
}
