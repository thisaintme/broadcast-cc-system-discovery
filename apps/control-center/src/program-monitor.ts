import type {LivePort} from './live-contract.ts';
import type {Workspace} from './model.ts';
export type MonitorSlot='program'|'front'|'side';
export interface MonitorFrame {slot:MonitorSlot;source:string;image:string|null;capturedAt:number|null;message:string}
export const MONITOR_INTERVAL={program:200,front:1000,side:1000} as const;
/** One screenshot in flight across all slots; preview requests never queue behind one another. */
export class ProgramMonitor {
  private pending=false;
  private last=new Map<MonitorSlot,{at:number;identity:string}>();
  constructor(private peer:LivePort,private workspace:()=>Workspace,private program:()=>string,private busy:()=>boolean,private epoch:()=>number=()=>0,private now:()=>number=Date.now){}
  async frame(raw:unknown):Promise<MonitorFrame>{
    if(typeof raw!=='string'||!['program','front','side'].includes(raw))throw new Error('Unknown monitor slot.');
    const slot=raw as MonitorSlot,w=this.workspace(),source=slot==='program'?this.program():w.hardwareNotes[slot==='front'?'frontInput':'sideInput'];
    const unavailable=(message:string):MonitorFrame=>({slot,source,image:null,capturedAt:null,message});
    if(!source)return unavailable('Keine Videoquelle zugeordnet.');
    if(!this.peer.isConnected())return unavailable('OBS ist nicht verbunden.');
    const epoch=this.epoch(),started=this.now(),identity=JSON.stringify([epoch,w.obsUrl,w.inventory?.collection,source]),last=this.last.get(slot);
    if(this.busy()||this.pending||(last?.identity===identity&&started-last.at<MONITOR_INTERVAL[slot]-20))return unavailable('Vorschau wird nach der laufenden Aktion aktualisiert.');
    if(slot!=='program'&&!w.inventory?.inputs.some(i=>i.name===source))return unavailable('Die Kameraquelle ist nicht im geprüften OBS-Inventar vorhanden.');
    this.pending=true;this.last.set(slot,{at:started,identity});
    try{
      const r=await this.peer.read('GetSourceScreenshot',{sourceName:source,imageFormat:'jpg',imageWidth:slot==='program'?960:320,imageCompressionQuality:slot==='program'?55:45});
      if(typeof r.imageData!=='string'||r.imageData.length>2*1024*1024||!/^data:image\/(?:jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(r.imageData))return unavailable('OBS hat kein gültiges Vorschaubild geliefert.');
      const current=this.workspace();
      if(!this.peer.isConnected()||this.busy()||this.epoch()!==epoch||current.obsUrl!==w.obsUrl||current.inventory?.collection!==w.inventory?.collection||(slot==='program'?this.program():current.hardwareNotes[slot==='front'?'frontInput':'sideInput'])!==source||this.now()-started>2000)return unavailable('Veraltetes Vorschaubild verworfen.');
      // Timestamp the request, not its eventual reply: a slow capture must not look fresh.
      return {slot,source,image:r.imageData,capturedAt:started,message:'OBS-Vorschau · nicht die YouTube-Wiedergabe'};
    }catch{return unavailable('Vorschau nicht verfügbar. Die Übertragung wird nicht verändert.');}
    finally{this.pending=false;}
  }
}
