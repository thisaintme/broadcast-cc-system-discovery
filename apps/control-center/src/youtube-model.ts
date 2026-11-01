/** YouTube public data contracts. Never include tokens, stream names/keys or raw API replies here. */
export class YouTubeFailure extends Error {
  constructor(message:string){super(message);this.name='YouTubeFailure';}
}
export const youtubeError=(e:unknown):string=>e instanceof YouTubeFailure?e.message:'YouTube operation was not confirmed. Check the event in YouTube Studio before retrying; completed changes may remain.';
export type Privacy='private'|'unlisted'|'public';
export interface Channel {id:string;title:string}
export interface Broadcast {
  id:string;channelId:string;title:string;description:string;scheduledStartTime:string;
  privacy:Privacy;lifeCycle:string;streamId:string;autoStart:boolean|null;autoStop:boolean|null;monitor:boolean|null;
}
/** Main-process-only data, not an IPC response. */
export interface Ingest {id:string;channelId:string;key:string;status:string;reusable:boolean;health:string}
export interface Destination {server:string;key:string}
export interface BroadcastDraft {serviceId:string;channelId:string;title:string;description:string;startsAt:string;privacy:Privacy;madeForKids:boolean}
export interface BroadcastLink {serviceId:string;channelId:string;broadcastId:string;streamId:string;stage:'creating'|'created'|'ready';updatedAt:string}
export interface YouTubeState {version:1;links:BroadcastLink[]}
export const blankYouTubeState=():YouTubeState=>({version:1,links:[]});
export interface YouTubePanel {
  channel:Channel|null;credentialsConfigured:boolean;services:{id:string;title:string;startsAt:string}[];selectedService:string;
  links:BroadcastLink[];broadcasts:Broadcast[];checkedAt:number|null;error:string;busy:boolean;notice:string;
  obs:{connected:boolean;streaming:boolean|null;program:string;muted:boolean|null;permissionsReady:boolean};
}
export type YouTubeCommand={kind:'create';draft:BroadcastDraft}|{kind:'link';serviceId:string;broadcastId:string}|{kind:'start'|'publish-intro'|'end';serviceId:string};
export interface YouTubeBridge {
  panel():Promise<YouTubePanel>;refresh():Promise<YouTubePanel>;configure():Promise<YouTubePanel>;signIn():Promise<YouTubePanel>;
  disconnect():Promise<YouTubePanel>;command(command:YouTubeCommand):Promise<YouTubePanel>;cancel():Promise<void>;
  openBroadcast(id:string):Promise<void>;copyLink(id:string):Promise<void>;
}
export function record(x:unknown):Record<string,any>{return x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,any>:{};}
export function exact(x:unknown,keys:string[]):Record<string,any>{
  const r=record(x);if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))throw new YouTubeFailure('Unexpected YouTube request fields.');return r;
}
export function identifier(x:unknown):string{
  if(typeof x!=='string'||!x||x.length>128||!/^[A-Za-z0-9_-]+$/.test(x))throw new YouTubeFailure('Invalid service, channel or broadcast identifier.');return x;
}
export function plain(x:unknown,max:number,required=true):string{
  if(typeof x!=='string'||[...x].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)||(required&&!x.trim()))throw new YouTubeFailure('Invalid title or description.');return x.trim();
}
export function parseDraft(raw:unknown,now=Date.now()):BroadcastDraft{
  const d=exact(raw,['serviceId','channelId','title','description','startsAt','privacy','madeForKids']);
  const title=plain(d.title,100),description=plain(d.description,5000,false),date=new Date(d.startsAt);
  if(/[<>]/.test(title))throw new YouTubeFailure('YouTube titles cannot contain angle brackets.');
  if(typeof d.startsAt!=='string'||!Number.isFinite(date.getTime())||date.getTime()<now)throw new YouTubeFailure('Choose a future YouTube start time. The local service schedule is not changed automatically.');
  if(!['private','unlisted','public'].includes(d.privacy)||typeof d.madeForKids!=='boolean')throw new YouTubeFailure('Choose visibility and explicitly answer the made-for-kids question.');
  return {serviceId:identifier(d.serviceId),channelId:identifier(d.channelId),title,description,startsAt:date.toISOString(),privacy:d.privacy,madeForKids:d.madeForKids};
}
export function parseCommand(raw:unknown):YouTubeCommand{
  const r=record(raw);
  if(r.kind==='create'){exact(r,['kind','draft']);return {kind:'create',draft:parseDraft(r.draft)};}
  if(r.kind==='link'){exact(r,['kind','serviceId','broadcastId']);return {kind:'link',serviceId:identifier(r.serviceId),broadcastId:identifier(r.broadcastId)};}
  if(['start','publish-intro','end'].includes(r.kind)){exact(r,['kind','serviceId']);return {kind:r.kind,serviceId:identifier(r.serviceId)};}
  throw new YouTubeFailure('Choose an explicit YouTube action.');
}
export function parseState(raw:unknown):YouTubeState{
  const s=record(raw);if(s.version!==1||!Array.isArray(s.links)||s.links.length>1000)throw new YouTubeFailure('YouTube association file is invalid; it has not been replaced.');
  const seen=new Set<string>();
  const links:BroadcastLink[]=s.links.map((x:unknown)=>{
    const r=exact(x,['serviceId','channelId','broadcastId','streamId','stage','updatedAt']);
    const serviceId=identifier(r.serviceId);if(seen.has(serviceId))throw new YouTubeFailure('Duplicate YouTube service association.');seen.add(serviceId);
    if(!['creating','created','ready'].includes(r.stage)||typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt)))throw new YouTubeFailure('Invalid YouTube association state.');
    return {serviceId,channelId:identifier(r.channelId),broadcastId:r.broadcastId===''?'':identifier(r.broadcastId),streamId:identifier(r.streamId),stage:r.stage,updatedAt:r.updatedAt};
  });return {version:1,links};
}
export function youtubeServer(server:unknown):string{
  if(typeof server!=='string')throw new YouTubeFailure('OBS does not expose a verifiable YouTube ingest server.');
  let u:URL;try{u=new URL(server);}catch{throw new YouTubeFailure('Configure an explicit YouTube RTMP/RTMPS server in OBS before using managed broadcasts.');}
  if(!['rtmp:','rtmps:'].includes(u.protocol)||!((u.protocol==='rtmps:'?/^[a-z0-9-]+\.rtmps\.youtube\.com$/i:/^[a-z0-9-]+\.rtmp\.youtube\.com$/i).test(u.hostname))||(u.port!==''&&u.port!==(u.protocol==='rtmps:'?'443':'1935'))||u.username||u.password||u.search||u.hash||!['/live2','/live2/'].includes(u.pathname))throw new YouTubeFailure('OBS is not configured for a supported YouTube ingest server. No destination settings were changed.');
  return u.href;
}
export const watchUrl=(id:string)=>`https://www.youtube.com/watch?v=${encodeURIComponent(identifier(id))}`;
