import type {LiveSnapshot,LiveCommand} from './live-contract.ts';
import {LiveFailure} from './live-contract.ts';
import type {EndCountdown} from './end-countdown.ts';
export interface DeskOutroHost {
 snapshot():LiveSnapshot;ticket():number;outroScene():string;
 command(command:LiveCommand):Promise<void>;refresh():Promise<void>;
 exclusive<T>(fn:()=>Promise<T>):Promise<T>;
 /** Pin the current managed event, or explicitly select OBS-only stopping. Never fall back on an error. */
 prepare(guard:()=>void):Promise<{execute:(valid:()=>void)=>Promise<void>;completed:string}>;
}
/** Immediate picture change, interruptible deadline, no Google request on the critical picture path. */
export class DeskOutro {
 private epoch=0;private preparing=false;private resume:{ticket:number;muted:boolean|null}|null=null;
 constructor(private host:DeskOutroHost,private ending:EndCountdown){}
 get starting(){return this.preparing;}
 invalidate(){this.epoch++;this.resume=null;}
 mainCommand():'main'|'on-air'{
  const restore=this.ending.active&&this.resume?.ticket===this.host.ticket()&&this.resume.muted===false&&this.host.snapshot().observation.program===this.host.outroScene();
  this.invalidate();this.ending.cancel('Hauptbild gewählt. Automatisches Ende abgebrochen.');return restore?'on-air':'main';
 }
 async start():Promise<void>{
  if(this.preparing||this.ending.active)throw new LiveFailure('Ein Abschluss ist bereits vorgemerkt.');
  this.preparing=true;const epoch=++this.epoch;this.resume=null;
  try{await this.host.exclusive(async()=>{
   await this.host.refresh();const before=structuredClone(this.host.snapshot());
   if(epoch!==this.epoch)throw new LiveFailure('Outro abgebrochen.');
   if(before.reasons.outro.length)throw new LiveFailure(before.reasons.outro.join(' '));
   if(before.observation.streaming!==false&&before.observation.streaming!==true)throw new LiveFailure('OBS-Sendezustand unbekannt. Kein automatisches Ende.');
   if(before.observation.streaming&&before.reasons.stop.length)throw new LiveFailure(before.reasons.stop.join(' '));
   await this.host.command('outro');
   if(epoch!==this.epoch)throw new LiveFailure('Outro abgebrochen. Bereits bestätigte Änderungen bleiben bestehen.');
   // Offline rehearsal is allowed, but never arms a future Stop for a new transmission.
   if(!before.observation.streaming)return;
   const ticket=this.host.ticket(),service=before.selectedService,collection=before.observation.collection,profile=before.observation.profile,outro=this.host.outroScene();
   this.resume={ticket,muted:before.observation.muted};
   const guard=()=>{
    const s=this.host.snapshot(),o=s.observation;
    if(epoch!==this.epoch||ticket!==this.host.ticket()||service!==s.selectedService||!s.connected||!s.permissions.scenes||!s.permissions.audio||!s.permissions.stream||o.collection!==collection||o.profile!==profile||o.program!==outro||o.streaming!==true||o.reconnecting!==false||o.muted!==true)throw new LiveFailure('Sendung, Outro oder Steuerung geändert. Kein automatisches Ende.');
   };
   let prepared:Awaited<ReturnType<DeskOutroHost['prepare']>>|null=null;
   this.ending.arm('de',guard,async valid=>{
    valid();guard();if(!prepared)throw new LiveFailure('Zielprüfung nicht rechtzeitig abgeschlossen. Stream läuft weiter.');
    await prepared.execute(()=>{valid();guard();});valid();
    return prepared.completed;
   },{countdown:'Deutsch endet nach 15 Sekunden. Hauptbild bricht ab und stellt den vorherigen Sendeton wieder her. Русский bleibt unverändert.'});
   // Preparation is read-only and does not hold the OBS command lock. Cancel and Main remain usable.
   void this.host.prepare(guard).then(result=>{guard();if(this.ending.snapshot().status==='countdown')prepared=result;}).catch(()=>{
    if(epoch===this.epoch&&this.ending.snapshot().status==='countdown')this.ending.fail('Zielprüfung fehlgeschlagen. Kein automatisches Ende; Outro bleibt sichtbar. Prüfen Sie die Kontoverbindung oder kehren Sie zum Hauptbild zurück.');
   });
  });}finally{this.preparing=false;}
 }
}
