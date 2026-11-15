import type {Service} from './model.ts';
import type {Recurrence} from './stream-management-model.ts';
import {berlinInstant, expand, parseRecurrence} from './stream-recurrence.ts';
import {LiveFailure, serviceTitle} from './live-contract.ts';

/** Local calendar only. No YouTube account, API client, encoder or permissions. */
export interface LocalServicePlan {
  requestId:string;
  title:string;
  single?:{date:string;time:string};
  recurrence?:Recurrence;
}
function object(raw:unknown,allowed:string[]):Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!allowed.includes(k)))
    throw new LiveFailure('Ungültige lokale Terminplanung.');
  return raw as Record<string,unknown>;
}
export function planLocalServices(raw:unknown):Service[]{
  const p=object(raw,['requestId','title','single','recurrence']);
  if(typeof p.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(p.requestId))throw new LiveFailure('Ungültige Planungskennung.');
  if(typeof p.title!=='string'||!p.title.trim()||p.title.trim().length>220||/[\u0000-\u001f\u007f]/.test(p.title))throw new LiveFailure('Bitte einen Titel mit höchstens 220 Zeichen eingeben.');
  if((p.single!==undefined)===(p.recurrence!==undefined))throw new LiveFailure('Bitte Einzeltermin oder Reihe wählen.');
  try{
    const dates=p.single!==undefined?(()=>{
      const s=object(p.single,['date','time']);
      if(typeof s.date!=='string'||typeof s.time!=='string')throw new LiveFailure('Bitte Datum und Uhrzeit eingeben.');
      return [{date:s.date,startsAt:berlinInstant(s.date,s.time)}];
    })():expand(parseRecurrence(p.recurrence));
    // Today's service may have already started. Local planning must not inherit
    // YouTube's future-only publication rule. IDs are stable across retries.
    return dates.map(d=>({id:`local-${p.requestId}-${d.date}`,title:serviceTitle(p.title as string,d.startsAt),startsAt:d.startsAt}));
  }catch(error){
    if(error instanceof LiveFailure)throw error;
    const code=(error as {code?:string})?.code;
    if(code==='dst')throw new LiveFailure('Diese Uhrzeit ist bei der Zeitumstellung in Berlin nicht eindeutig oder nicht vorhanden. Bitte eine andere Uhrzeit wählen.');
    if(code==='date'||code==='time')throw new LiveFailure('Bitte ein gültiges Datum und eine Uhrzeit eingeben. Es gilt Europe/Berlin.');
    throw new LiveFailure('Bitte Wochentage, Wochenabstand und Anzahl prüfen: höchstens 104 Termine innerhalb von zwei Jahren.');
  }
}
