import type {ReadRequest,Workspace} from './model.ts';
export type LiveRead = ReadRequest | 'GetProfileList' | 'GetCurrentPreviewScene' | 'GetCurrentSceneTransition' | 'GetMediaInputStatus' | 'GetLastReplayBufferReplay';
export type LiveWrite = 'SetCurrentProgramScene'|'SetInputSettings'|'SetSceneItemEnabled'|'SetInputMute'|'StartStream'|'StopStream'|'SetCurrentPreviewScene'|'TriggerStudioModeTransition'|'SetStudioModeEnabled'|'SetInputVolume'|'StartRecord'|'StopRecord'|'PauseRecord'|'ResumeRecord'|'StartReplayBuffer'|'StopReplayBuffer'|'SaveReplayBuffer'|'StartVirtualCam'|'StopVirtualCam'|'TriggerMediaInputAction';
export const LIVE_COMMANDS=['prepare','intro','start','on-air','main','speaker','bible','outro','mute','unmute','stop','operator'] as const;
export type LiveCommand=typeof LIVE_COMMANDS[number];
export type LivePhase='unknown'|'prepared'|'intro'|'main'|'speaker'|'bible'|'outro';
// Optional for compatibility with older clients. It is never loaded from disk.
export interface LivePermissions{scenes:boolean;audio:boolean;stream:boolean;operator?:boolean}
export const noPermissions=():LivePermissions=>({scenes:false,audio:false,stream:false});
export interface LiveObservation{
  checkedAt:number|null;collection:string;profile:string;program:string;scenes:string[];
  streaming:boolean|null;reconnecting:boolean|null;durationMs:number|null;bytes:number|null;skippedFrames:number|null;totalFrames:number|null;
  inputName:string;muted:boolean|null;warnings:string[];
}
export const emptyObservation=():LiveObservation=>({checkedAt:null,collection:'',profile:'',program:'',scenes:[],streaming:null,reconnecting:null,durationMs:null,bytes:null,skippedFrames:null,totalFrames:null,inputName:'',muted:null,warnings:[]});
export interface LiveSnapshot{
  connected:boolean;observation:LiveObservation;permissions:LivePermissions;boundCollection:string;
  phase:LivePhase;selectedService:string;busy:boolean;pendingAction:string;returnAt:number|null;
  notice:string;lastError:string;journalError:string;reasons:Record<LiveCommand,string[]>;
}
export interface JournalEntry{at:string;action:string;stage:string;detail:string}
export interface JournalPort{append(action:string,stage:string,detail:string):Promise<void>;entries():Promise<JournalEntry[]>}
export interface LivePort{
  isConnected():boolean;connect(url:string,password:string):Promise<void>;disconnect():Promise<void>;
  read(name:LiveRead,data?:Record<string,unknown>):Promise<Record<string,any>>;
  change(name:LiveWrite,data?:Record<string,unknown>):Promise<void>;
  onEvent:(name:string,data:Record<string,any>)=>void;
  onDisconnect:()=>void;
}
export class LiveFailure extends Error {constructor(message:string){super(message);this.name='LiveFailure';}}
export function safeLiveError(error:unknown):string{return error instanceof LiveFailure?error.message:'The operation did not complete. OBS may retain partial changes; check OBS before retrying.';}
export function normalizePermissions(raw:unknown):LivePermissions{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new LiveFailure('Choose the live-control permissions.');
  const p=raw as Record<string,unknown>;
  if(['scenes','audio','stream'].some(k=>typeof p[k]!=='boolean')||('operator' in p&&typeof p.operator!=='boolean'))throw new LiveFailure('Permissions must be explicit yes/no selections.');
  return {scenes:p.scenes===true,audio:p.audio===true,stream:p.stream===true,...('operator' in p?{operator:p.operator===true}:{})};
}
export interface LiveBridge{
  snapshot():Promise<LiveSnapshot>;onState(callback:(s:LiveSnapshot)=>void):()=>void;
  enable(permissions:LivePermissions):Promise<LiveSnapshot>;release():Promise<LiveSnapshot>;cancelReturn():Promise<LiveSnapshot>;
  selectService(id:string):Promise<LiveSnapshot>;adoptPhase(phase:LivePhase):Promise<LiveSnapshot>;
  command(command:LiveCommand,value?:string):Promise<LiveSnapshot>;
  journal():Promise<JournalEntry[]>;exportJournal():Promise<string>;advanced():Promise<void>;
}
/** Local labels only: no YouTube title or stream destination is changed. */
export function serviceTitle(title:string,startsAt:string):string{
  const d=new Date(startsAt);if(!Number.isFinite(d.getTime()))throw new LiveFailure('Choose a valid service date.');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const part=(name:string)=>parts.find(p=>p.type===name)!.value;
  const value=title.replace(/^\d{8}\s*-\s*/,'').trim().slice(0,220);
  if(!value)throw new LiveFailure('Enter a service title.');
  return `${part('year')}${part('month')}${part('day')} - ${value}`;
}
export function liveMappingKey(w:Workspace):string{
  return JSON.stringify({url:w.obsUrl,collection:w.inventory?.collection,scenes:w.bindings.scenes,bible:w.bindings.bibleText,next:w.bindings.nextServiceText,audio:w.bindings.audioInput,group:w.captions.speakerGroup,pool:w.captions.speakerPool,sources:w.captions.speakerSources,speakers:w.speakers});
}
