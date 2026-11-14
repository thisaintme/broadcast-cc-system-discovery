import type {LivePort} from './live-contract.ts';
import type {Workspace} from './model.ts';
export type MonitorSlot='program'|'preview'|'front'|'side';
export interface MonitorFrame {slot:MonitorSlot;source:string;image:string|null;capturedAt:number|null;message:string}
/** Read-only, bounded screenshot requests. No arbitrary source or RPC comes from the renderer. */
export class ProgramMonitor {
  private pending=new Set<MonitorSlot>();
  private last=new Map<MonitorSlot,number>();
  constructor(private peer:LivePort,private workspace:()=>Workspace,private program:()=>string,private busy:()=>boolean){}
  async frame(raw:unknown):Promise<MonitorFrame>{
    if(!['program','preview','front','side'].includes(String(raw)))throw new Error('Unknown monitor slot.');
    const slot=raw as MonitorSlot,w=this.workspace();let source=slot==='program'?this.program():slot==='preview'?'':w.hardwareNotes[slot==='front'?'frontInput':'sideInput'];
    if(slot==='preview'&&this.peer.isConnected())try{if((await this.peer.read('GetStudioModeEnabled')).studioModeEnabled===true)source=String((await this.peer.read('GetCurrentPreviewScene')).currentPreviewSceneName||'');}catch{/* An unconfirmed preview is never a substitute for program. */}
    const unavailable=(message:string):MonitorFrame=>({slot,source,image:null,capturedAt:null,message});
    if(!source)return unavailable('Keine Videoquelle zugeordnet.');
    if(!this.peer.isConnected())return unavailable('OBS ist nicht verbunden.');
    if(this.busy()||this.pending.has(slot)||Date.now()-(this.last.get(slot)||0)<700)return unavailable('Vorschau wird nach der laufenden Aktion aktualisiert.');
    if(!['program','preview'].includes(slot)&&!w.inventory?.inputs.some(i=>i.name===source))return unavailable('Die Kameraquelle ist nicht im geprüften OBS-Inventar vorhanden.');
    this.pending.add(slot);this.last.set(slot,Date.now());
    try{const r=await this.peer.read('GetSourceScreenshot',{sourceName:source,imageFormat:'jpg',imageWidth:slot==='program'?1280:480,imageCompressionQuality:65});
      if(typeof r.imageData!=='string'||r.imageData.length>5*1024*1024||!/^data:image\/(?:jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(r.imageData))return unavailable('OBS hat kein gültiges Vorschaubild geliefert.');
      // Discard a reply from a previous program/source after a scene or mapping change.
      if((slot==='program'?this.program():slot==='preview'?String((await this.peer.read('GetCurrentPreviewScene')).currentPreviewSceneName||''):this.workspace().hardwareNotes[slot==='front'?'frontInput':'sideInput'])!==source)return unavailable('Die Videoquelle hat gewechselt.');
      return {slot,source,image:r.imageData,capturedAt:Date.now(),message:'OBS-Vorschau · nicht die YouTube-Wiedergabe'};
    }catch{return unavailable('Vorschau nicht verfügbar. Die Übertragung wird nicht verändert.');}
    finally{this.pending.delete(slot);}
  }
}
