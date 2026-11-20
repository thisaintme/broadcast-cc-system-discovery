import {randomUUID} from 'node:crypto';
import {readLocalJson,writeLocalJson} from './local-state.ts';
import {LiveFailure} from './live-contract.ts';
export interface BibleCue {id:string;reference:string;shownAt:number|null}
export interface DeskCues {speaker:string;selected:string;entries:BibleCue[]}
export type CueChange = {kind:'speaker';name:string}|{kind:'add';reference:string}|{kind:'edit';id:string;reference:string}|{kind:'select'|'remove';id:string};
const blank=():DeskCues=>({speaker:'',selected:'',entries:[]});
const validText=(s:unknown,n:number):s is string=>typeof s==='string'&&s.length<=n&&!/[\u0000-\u001f]/.test(s);
export class DeskCueStore {
  private sessions=new Map<string,DeskCues>();private ready=false;
  constructor(private file:string){}
  async load():Promise<void>{
    this.ready=false;const sessions=new Map<string,DeskCues>();
    const raw=await readLocalJson(this.file);
    if(raw!==null){const r=raw as {version:number;sessions:[string,DeskCues][]};if(r.version!==1||!Array.isArray(r.sessions)||r.sessions.length>200)throw new LiveFailure('Das Bibelstellen-Protokoll ist nicht lesbar.');
      for(const pair of r.sessions){if(!Array.isArray(pair)||pair.length!==2||!validText(pair[0],100))throw new LiveFailure('Ungültiges Bibelstellen-Protokoll.');const[key,c]=pair;
        if(!c||!validText(c.speaker,240)||!validText(c.selected,128)||!Array.isArray(c.entries)||c.entries.length>100||c.entries.some(e=>!e||!validText(e.id,128)||!validText(e.reference,500)||!e.reference.trim()||(e.shownAt!==null&&(!Number.isFinite(e.shownAt)||e.shownAt<0)))||new Set(c.entries.map(e=>e.id)).size!==c.entries.length||(c.selected&&!c.entries.some(e=>e.id===c.selected))||sessions.has(key))throw new LiveFailure('Ungültiges Bibelstellen-Protokoll.');
        sessions.set(key,{speaker:c.speaker,selected:c.selected,entries:c.entries.map(e=>({id:e.id,reference:e.reference,shownAt:e.shownAt}))});
      }
    }this.sessions=sessions;this.ready=true;
  }
  snapshot(service:string):DeskCues{return structuredClone(this.sessions.get(service)||blank());}
  private async commit(service:string,next:DeskCues):Promise<void>{
    if(!this.ready)throw new LiveFailure('Das Bibelstellen-Protokoll ist nicht verfügbar. Bestehende Daten wurden nicht überschrieben.');
    if(!validText(service,100)||(!this.sessions.has(service)&&this.sessions.size>=200))throw new LiveFailure('Das lokale Protokoll hat seine Kapazität erreicht.');
    const sessions=new Map(this.sessions);sessions.set(service,next);
    try{await writeLocalJson(this.file,{version:1,sessions:[...sessions]});}catch{throw new LiveFailure('Bibelstellen-Protokoll konnte nicht gespeichert werden. Eine bereits bestätigte OBS-Aktion bleibt bestehen.');}
    this.sessions=sessions;
  }
  async change(service:string,raw:unknown,speakers:string[]):Promise<void>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new LiveFailure('Ungültige Auswahl.');
    const r=raw as Record<string,unknown>,next=this.snapshot(service);
    if(r.kind==='speaker'&&Object.keys(r).sort().join(',')==='kind,name'&&typeof r.name==='string'&&speakers.includes(r.name))next.speaker=r.name;
    else if(r.kind==='add'&&Object.keys(r).sort().join(',')==='kind,reference'&&validText(r.reference,500)&&r.reference.trim()){
      if(next.entries.length>=100)throw new LiveFailure('Höchstens 100 Bibelstellen pro Sendung.');
      const id=randomUUID();next.entries.push({id,reference:r.reference.trim(),shownAt:null});if(!next.selected)next.selected=id;
    }else if(r.kind==='edit'&&Object.keys(r).sort().join(',')==='id,kind,reference'&&typeof r.id==='string'&&validText(r.reference,500)&&r.reference.trim()&&next.entries.some(e=>e.id===r.id)){
      const entry=next.entries.find(e=>e.id===r.id)!;
      if(entry.reference!==r.reference.trim()){entry.reference=r.reference.trim();entry.shownAt=null;}
    }else if((r.kind==='select'||r.kind==='remove')&&Object.keys(r).sort().join(',')==='id,kind'&&typeof r.id==='string'&&next.entries.some(e=>e.id===r.id)){
      if(r.kind==='select')next.selected=r.id;
      else {next.entries=next.entries.filter(e=>e.id!==r.id);if(next.selected===r.id)next.selected=next.entries.find(e=>e.shownAt===null)?.id||'';}
    }else throw new LiveFailure('Wählen Sie einen gespeicherten Sprecher oder eine gültige Bibelstelle.');
    await this.commit(service,next);
  }
  async shown(service:string,id:string,now=Date.now()):Promise<void>{
    const next=this.snapshot(service),index=next.entries.findIndex(e=>e.id===id);if(index<0)return;
    next.entries[index].shownAt=now;
    const ordered=[...next.entries.slice(index+1),...next.entries.slice(0,index)];
    if(next.selected===id)next.selected=ordered.find(e=>e.shownAt===null)?.id||'';
    await this.commit(service,next);
  }
}
