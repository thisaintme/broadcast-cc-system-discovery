import {YouTubeFailure,record,identifier} from './youtube-model.ts';
import type {Broadcast,BroadcastDraft,Channel,Ingest,Privacy} from './youtube-model.ts';
export interface YouTubeApi {
  channel():Promise<Channel>;broadcasts():Promise<Broadcast[]>;broadcast(id:string):Promise<Broadcast>;
  streams():Promise<Ingest[]>;stream(id:string):Promise<Ingest>;
  create(draft:BroadcastDraft,beforeSend?:()=>void):Promise<Broadcast>;bind(id:string,streamId:string,beforeSend?:()=>void):Promise<Broadcast>;
  transition(id:string,status:'live'|'complete',beforeSend?:()=>void):Promise<Broadcast>;
}
const ROOT='https://www.googleapis.com/youtube/v3/';
const messages:Record<string,string>={
  liveStreamingNotEnabled:'Live streaming is not enabled for this YouTube channel.',
  livePermissionBlocked:'YouTube has blocked live streaming for this channel. Review YouTube Studio.',
  insufficientLivePermissions:'This Google authorization cannot manage broadcasts on the selected channel.',
  insufficientPermissions:'Reconnect Google with the requested YouTube permission.',
  quotaExceeded:'The Google API project quota is exhausted. Use YouTube Studio; no automatic retry was made.',
  dailyLimitExceeded:'The Google API project quota is exhausted. Use YouTube Studio.',
  userRequestsExceedRateLimit:'YouTube rate-limited the request. Refresh later; no write was retried.',
  errorStreamInactive:'YouTube is not receiving the selected video feed yet.',
  invalidTransition:'YouTube refused this lifecycle transition. Refresh its current status.',
  redundantTransition:'YouTube reports this transition is already complete or in progress. Refresh status.',
  liveBroadcastNotFound:'The selected YouTube event no longer exists or is not accessible.',
  liveStreamNotFound:'The bound YouTube ingest stream is unavailable.',
  accessNotConfigured:'Enable YouTube Data API v3 in the Google Cloud project.',
};
function broadcast(raw:unknown):Broadcast{
  const r=record(raw),s=record(r.snippet),st=record(r.status),c=record(r.contentDetails);
  const flag=(x:unknown)=>typeof x==='boolean'?x:null;
  if(!['public','private','unlisted'].includes(st.privacyStatus)||typeof s.title!=='string')throw new YouTubeFailure('YouTube returned incomplete event metadata.');
  return {id:identifier(r.id),channelId:identifier(s.channelId),title:s.title.slice(0,500),description:typeof s.description==='string'?s.description.slice(0,5000):'',scheduledStartTime:typeof s.scheduledStartTime==='string'?s.scheduledStartTime:'',privacy:st.privacyStatus as Privacy,lifeCycle:typeof st.lifeCycleStatus==='string'?st.lifeCycleStatus:'unknown',streamId:typeof c.boundStreamId==='string'?c.boundStreamId:'',autoStart:flag(c.enableAutoStart),autoStop:flag(c.enableAutoStop),monitor:flag(record(c.monitorStream).enableMonitorStream)};
}
function ingest(raw:unknown):Ingest{
  const r=record(raw),s=record(r.snippet),cdn=record(r.cdn),st=record(r.status),info=record(cdn.ingestionInfo);
  if(typeof info.streamName!=='string'||!info.streamName||info.streamName.length>2048)throw new YouTubeFailure('YouTube did not supply a verifiable ingest key.');
  return {id:identifier(r.id),channelId:identifier(s.channelId),key:info.streamName,status:typeof st.streamStatus==='string'?st.streamStatus:'unknown',reusable:record(r.contentDetails).isReusable===true,health:typeof record(st.healthStatus).status==='string'?st.healthStatus.status:'unknown'};
}
/** Only this main-process client sees bearer tokens and ingest credentials. Mutations are never automatically retried. */
export class YouTubeClient implements YouTubeApi {
  constructor(private token:()=>Promise<string>,private http:typeof fetch=fetch){}
  private async request(method:'GET'|'POST',resource:string,query:Record<string,string>,body?:unknown,beforeSend?:()=>void):Promise<Record<string,any>>{
    const u=new URL(resource,ROOT);u.search=new URLSearchParams(query).toString();
    let response:Response;
    try{
      const token=await this.token();
      // A token refresh may have awaited the network. Recheck cancellation after it,
      // immediately before issuing a remote mutation, not only in the caller.
      if(method==='POST')beforeSend?.();
      response=await this.http(u,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(12000)});
    }catch(e){
      if(e instanceof YouTubeFailure)throw e;
      throw new YouTubeFailure(method==='POST'?'YouTube did not confirm the write. It may have succeeded. Refresh or recover the existing event; do not create another one blindly.':'YouTube status could not be read. Its state is unknown.');
    }
    let r:Record<string,any>;try{r=record(await response.json());}catch{throw new YouTubeFailure('YouTube returned an unreadable response. Refresh before any further action.');}
    if(!response.ok){
      const error=record(r.error),reason=Array.isArray(error.errors)?record(error.errors[0]).reason:'';
      if(response.status===401)throw new YouTubeFailure('Google authorization expired or was revoked. Reconnect Google; the broadcast was not automatically stopped.');
      throw new YouTubeFailure((typeof reason==='string'&&Object.hasOwn(messages,reason)?messages[reason]:'')||`YouTube rejected the request (HTTP ${response.status}). No automatic retry was made.`);
    }return r;
  }
  private async list(resource:string,query:Record<string,string>):Promise<unknown[]>{
    const out:unknown[]=[];let pageToken='';const seen=new Set<string>();
    for(let page=0;page<20;page++){
      const r=await this.request('GET',resource,{...query,maxResults:'50',...(pageToken?{pageToken}:{})});
      if(!Array.isArray(r.items))throw new YouTubeFailure('YouTube returned an incomplete list.');out.push(...r.items);
      if(!r.nextPageToken)return out;if(typeof r.nextPageToken!=='string'||seen.has(r.nextPageToken))throw new YouTubeFailure('YouTube pagination was not confirmed.');
      pageToken=r.nextPageToken;seen.add(pageToken);
    }throw new YouTubeFailure('This account has more results than the current inspection limit. No incomplete list was treated as authoritative.');
  }
  async channel():Promise<Channel>{
    const r=await this.request('GET','channels',{part:'id,snippet',mine:'true'});
    if(!Array.isArray(r.items)||r.items.length!==1)throw new YouTubeFailure('Sign in to exactly one YouTube channel/Brand Account with broadcast-management access.');
    const c=record(r.items[0]);return {id:identifier(c.id),title:String(record(c.snippet).title||'YouTube channel').slice(0,200)};
  }
  async broadcasts():Promise<Broadcast[]>{return (await this.list('liveBroadcasts',{part:'id,snippet,status,contentDetails',mine:'true',broadcastType:'all'})).map(broadcast);}
  async broadcast(id:string):Promise<Broadcast>{const r=await this.request('GET','liveBroadcasts',{part:'id,snippet,status,contentDetails',id:identifier(id)});if(!Array.isArray(r.items)||r.items.length!==1)throw new YouTubeFailure('YouTube event not found.');return broadcast(r.items[0]);}
  async streams():Promise<Ingest[]>{return (await this.list('liveStreams',{part:'id,snippet,cdn,status,contentDetails',mine:'true'})).map(ingest);}
  async stream(id:string):Promise<Ingest>{const r=await this.request('GET','liveStreams',{part:'id,snippet,cdn,status,contentDetails',id:identifier(id)});if(!Array.isArray(r.items)||r.items.length!==1)throw new YouTubeFailure('YouTube ingest stream not found.');return ingest(r.items[0]);}
  async create(d:BroadcastDraft,beforeSend?:()=>void):Promise<Broadcast>{return broadcast(await this.request('POST','liveBroadcasts',{part:'id,snippet,status,contentDetails'},{snippet:{title:d.title,description:d.description,scheduledStartTime:d.startsAt},status:{privacyStatus:d.privacy,selfDeclaredMadeForKids:d.madeForKids},contentDetails:{enableAutoStart:false,enableAutoStop:false,monitorStream:{enableMonitorStream:false,broadcastStreamDelayMs:0}}},beforeSend));}
  async bind(id:string,streamId:string,beforeSend?:()=>void):Promise<Broadcast>{return broadcast(await this.request('POST','liveBroadcasts/bind',{part:'id,snippet,status,contentDetails',id:identifier(id),streamId:identifier(streamId)},undefined,beforeSend));}
  async transition(id:string,status:'live'|'complete',beforeSend?:()=>void):Promise<Broadcast>{return broadcast(await this.request('POST','liveBroadcasts/transition',{part:'id,snippet,status,contentDetails',id:identifier(id),broadcastStatus:status},undefined,beforeSend));}
}
