/** In-memory only. A restart must never resume a destructive end action. */
export type EndScope='de'|'ru'|'both';
export interface EndState {scope:EndScope|null;until:number|null;status:'idle'|'countdown'|'ending'|'completed'|'cancelled'|'failed';message:string}
interface Clock {now():number;set(fn:()=>void,ms:number):unknown;clear(timer:unknown):void}
const clock:Clock={now:()=>Date.now(),set:(fn,ms)=>setTimeout(fn,ms),clear:t=>clearTimeout(t as ReturnType<typeof setTimeout>)};
export class EndCountdown {
  private value:EndState={scope:null,until:null,status:'idle',message:''};private timer:unknown=null;private epoch=0;private guard:(()=>void)|null=null;
  constructor(private emit:()=>void,private time:Clock=clock){}
  snapshot():EndState{return {...this.value};}
  get active():boolean{return ['countdown','ending'].includes(this.value.status);}
  cancel(message='Abgebrochen. Bereits abgeschlossene Aktionen bleiben bestehen; noch laufende Streams werden nicht beendet.'):void{
    this.epoch++;if(this.timer!==null)this.time.clear(this.timer);this.timer=null;this.guard=null;
    if(this.active){this.value={...this.value,until:null,status:'cancelled',message};this.emit();}
  }
  fail(message:string):void{this.cancel();this.value={...this.value,status:'failed',until:null,message};this.emit();}
  check():void{if(this.value.status==='countdown')try{this.guard?.();}catch{this.cancel('Steuerung oder Ziel geändert. Automatisches Ende abgebrochen; Streams bleiben unverändert.');}}
  arm(scope:EndScope,guard:()=>void,execute:(stillValid:()=>void)=>Promise<void|string>,messages:{countdown?:string}={}):void{
    if(this.active)throw new Error('Ein Abschluss ist bereits vorgemerkt.');guard();const token=++this.epoch;
    this.guard=guard;this.value={scope,until:this.time.now()+15000,status:'countdown',message:messages.countdown||'Automatisches Ende nach 15 Sekunden. Abbrechen lässt die Streams weiterlaufen.'};this.emit();
    this.timer=this.time.set(()=>{void this.finish(token,execute);},15000);
  }
  private async finish(token:number,execute:(valid:()=>void)=>Promise<void|string>):Promise<void>{
    if(token!==this.epoch)return;this.timer=null;
    const valid=()=>{if(token!==this.epoch)throw new Error('Abschluss abgebrochen.');};
    try{valid();this.guard?.();this.value={...this.value,until:null,status:'ending',message:'Abschluss wird geprüft und ausgeführt …'};this.emit();const message=await execute(valid);valid();this.value={...this.value,status:'completed',message:message||'Die ausgewählten YouTube-Events sind beendet. Web Presenter und Kameras bitte manuell prüfen.'};}
    catch{if(token!==this.epoch)return;this.value={...this.value,until:null,status:'failed',message:'Das Ende konnte nicht vollständig bestätigt werden. Bereits beendete Events bleiben beendet. Prüfen Sie DE und RU; es wird nicht automatisch erneut versucht.'};}
    finally{if(token===this.epoch){this.guard=null;this.emit();}}
  }
}
