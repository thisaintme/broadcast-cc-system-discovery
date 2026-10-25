/** Read-only audio telemetry is session-only. Only explicit operator observations are saved. */
export const AUDIO_ROLES = ['unclassified','service-audio','music','unused','possible-duplicate'] as const;
export const AUDIO_SIGNALS = ['pulpit','choir-1','choir-2','music'] as const;
export type AudioRole = typeof AUDIO_ROLES[number];
export interface AudioObservation {
  collection:string; inputName:string; role:AudioRole;
  respondsTo:(typeof AUDIO_SIGNALS[number])[];
  listening:'not-tested'|'heard'|'not-heard'|'uncertain';
  monitoringPoint:string; notes:string; updatedAt:string; basis:'operator-reported';
}
export interface Reading<T> {value:T|null; fresh:boolean; ageMs:number|null}
export interface AudioChannel {inputPeakDb:number; outputPeakDb:number}
export type MeterState = 'live'|'waiting'|'stale'|'not-reporting'|'invalid'|'stopped'|'disconnected';
export interface AudioRow {
  name:string; kind:string; channels:AudioChannel[]; meterState:MeterState; meterAgeMs:number|null;
  muted:Reading<boolean>; volumeDb:Reading<number>; tracks:Reading<Record<string,boolean>>;
  monitor:Reading<string>; active:Reading<boolean>;
}
export interface AudioSnapshot {
  connected:boolean; running:boolean; starting:boolean; collection:string; program:string;
  message:string; generatedAt:number; meterEventAgeMs:number|null; rows:AudioRow[];
}
export const emptyAudioSnapshot=():AudioSnapshot=>({connected:false,running:false,starting:false,collection:'',program:'',message:'Connect to OBS, then start read-only meters.',generatedAt:Date.now(),meterEventAgeMs:null,rows:[]});
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown,max=240)=>typeof v==='string'?v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,max):'';
export function normalizeAudioObservations(raw:unknown):AudioObservation[]{
  if(!Array.isArray(raw))return [];
  const out=new Map<string,AudioObservation>();
  for(const value of raw.slice(0,256)){
    const r=object(value), collection=text(r.collection),inputName=text(r.inputName);
    if(!collection||!inputName)continue;
    const role=AUDIO_ROLES.includes(r.role as AudioRole)?r.role as AudioRole:'unclassified';
    const respondsTo=AUDIO_SIGNALS.filter(x=>Array.isArray(r.respondsTo)&&r.respondsTo.includes(x));
    const listening=typeof r.listening==='string'&&['heard','not-heard','uncertain'].includes(r.listening)?r.listening as AudioObservation['listening']:'not-tested';
    const parsed=typeof r.updatedAt==='string'?Date.parse(r.updatedAt):NaN;
    out.set(JSON.stringify([collection,inputName]),{collection,inputName,role,respondsTo,listening,
      monitoringPoint:text(r.monitoringPoint,400),notes:text(r.notes,1200),updatedAt:Number.isFinite(parsed)?new Date(parsed).toISOString():'',basis:'operator-reported'});
  }
  return [...out.values()];
}
/** Zero is a measured floor, not missing data. Null/malformed samples are rejected. */
export function parseAudioChannels(raw:unknown):AudioChannel[]|null{
  if(!Array.isArray(raw)||raw.length===0||raw.length>8)return null;
  const channels:AudioChannel[]=[];
  const db=(n:number)=>n===0?-100:Math.max(-100,20*Math.log10(n));
  for(const tuple of raw){
    if(!Array.isArray(tuple)||tuple.length!==3||!tuple.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000000))return null;
    channels.push({inputPeakDb:db(tuple[2]),outputPeakDb:db(tuple[1])});
  }
  return channels;
}
export function meterLabel(state:MeterState):string{
  return {live:'Live reading',waiting:'Waiting for a sample',stale:'Stale — unknown',
    'not-reporting':'No current sample (input may be inactive)',invalid:'Invalid sample — unknown',stopped:'Meters stopped',disconnected:'OBS disconnected'}[state];
}
