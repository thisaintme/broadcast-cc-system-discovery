import {createHash} from 'node:crypto';
import type {YouTubeApi} from './youtube-api.ts';
import type {StateStore} from './youtube-storage.ts';
import {YouTubeFailure,blankYouTubeState,parseCommand,youtubeServer} from './youtube-model.ts';
import type {Broadcast,BroadcastLink,Channel,Destination,Ingest,YouTubeCommand,YouTubeState} from './youtube-model.ts';
export interface BroadcastHost {
  services():{id:string;title:string;startsAt:string}[];selected():string;
  state():{connected:boolean;streaming:boolean|null;reconnecting:boolean|null;program:string;muted:boolean|null;intro:string;outro:string;permissionsReady:boolean};
  ticket():number;cancelAutomation():void;destination():Promise<Destination>;
  startWithIntro(destination:Destination):Promise<void>;stopTransmission(destination:Destination):Promise<void>;
  log(action:string,stage:string,detail:string):Promise<void>;
}
/** Review objects stay in the main process: they contain private ingest data. */
export interface BroadcastReview {command:YouTubeCommand;channel:Channel;ingest:Ingest;destination:Destination;broadcast:Broadcast|null;stamp:string;detail:string;epoch:number}
const pending=new Set(['live','liveStarting','testing','testStarting']);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const berlin=(s:string)=>new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
export function assertReviewedMetadata(before:Broadcast,after:Broadcast):void{
  if(before.id!==after.id||before.channelId!==after.channelId||before.privacy!==after.privacy||before.title!==after.title||before.scheduledStartTime!==after.scheduledStartTime)throw new YouTubeFailure('YouTube event identity, title, start time or visibility changed after review. Confirm the updated event before publishing.');
}
export class YouTubeController {
  private state:YouTubeState=blankYouTubeState();private epoch=0;private loaded=false;
  constructor(private api:YouTubeApi,private store:StateStore,private host:BroadcastHost,private expectedChannel:()=>Channel|null,private sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){}
  async load():Promise<void>{this.loaded=false;this.state=await this.store.load();this.loaded=true;}
  links():BroadcastLink[]{return this.state.links.map(x=>({...x}));}
  cancel():void{this.epoch++;}
  private owned(b:Broadcast,c:Channel):void{if(b.channelId!==c.id)throw new YouTubeFailure('The YouTube event belongs to a different channel. No action was sent.');}
  private policy(b:Broadcast):void{if(b.autoStart!==false||b.autoStop!==false||b.monitor!==false)throw new YouTubeFailure('This event must have automatic start/stop and monitor-stream testing disabled. Review it in YouTube Studio; the app will not silently change those settings.');}
  private async save(link:BroadcastLink):Promise<void>{
    const next:YouTubeState={version:1,links:[...this.state.links.filter(x=>x.serviceId!==link.serviceId),link]};await this.store.save(next);this.state=next;
  }
  private async channel():Promise<Channel>{
    const selected=this.expectedChannel();if(!selected)throw new YouTubeFailure('Connect Google and verify the YouTube channel first.');
    const current=await this.api.channel();if(current.id!==selected.id)throw new YouTubeFailure('The authorized YouTube channel changed. Reconnect and review it before continuing.');return current;
  }
  private async destination():Promise<Destination>{
    const d=await this.host.destination();youtubeServer(d.server);
    if(typeof d.key!=='string'||!d.key||d.key.length>2048)throw new YouTubeFailure('OBS did not expose a verifiable stream key. Configure the intended YouTube destination in OBS; nothing has been changed automatically.');return d;
  }
  private async matching(c:Channel,id?:string):Promise<{ingest:Ingest;destination:Destination}>{
    const destination=await this.destination(),streams=id?[await this.api.stream(id)]:await this.api.streams();
    const matching=streams.filter(s=>s.channelId===c.id&&s.key===destination.key&&(!id||s.id===id));
    if(matching.length!==1)throw new YouTubeFailure('OBS’s current stream key does not uniquely match an ingest stream on this YouTube channel. No key or server was changed.');
    const ingest=matching[0];if(!ingest.reusable)throw new YouTubeFailure('Choose a reusable YouTube stream key in OBS for scheduled service broadcasts.');return {ingest,destination};
  }
  private async noOtherBroadcast(c:Channel,streamId:string,except:string):Promise<void>{
    const events=await this.api.broadcasts();if(events.some(b=>b.channelId===c.id&&b.id!==except&&b.streamId===streamId&&pending.has(b.lifeCycle)))throw new YouTubeFailure('Another YouTube broadcast is using this ingest stream. No start or stop command was sent.');
  }
  private requireOutput(serviceId:string):void{
    const o=this.host.state();if(!o.connected||o.streaming===null||!o.program||!o.permissionsReady)throw new YouTubeFailure('Connect OBS and enable Scenes and captions, Service audio and OBS start/stop on Live Service first.');
    if(this.host.selected()!==serviceId)throw new YouTubeFailure('Select this same service on Live Service before starting or ending its broadcast.');
  }
  async review(raw:unknown):Promise<BroadcastReview>{
    if(!this.loaded)throw new YouTubeFailure('Saved YouTube associations could not be loaded. No event can be created until that local data is recovered.');
    const epoch=this.epoch,command=parseCommand(raw),serviceId=command.kind==='create'?command.draft.serviceId:command.serviceId;
    if(!this.host.services().some(s=>s.id===serviceId))throw new YouTubeFailure('Select a service from the local schedule.');
    const channel=await this.channel();let broadcast:Broadcast|null=null,ingest:Ingest,destination:Destination,detail='';const link=this.state.links.find(x=>x.serviceId===serviceId);
    if(command.kind==='create'){
      if(command.draft.channelId!==channel.id)throw new YouTubeFailure('Review the selected YouTube channel again.');
      if(link)throw new YouTubeFailure(link.broadcastId?'This service already has a YouTube event. Use its existing event; do not create a duplicate.':'An earlier creation was not confirmed. Refresh the event list and link the event created in YouTube Studio before retrying.');
      if(this.state.links.length>=1000)throw new YouTubeFailure('The current YouTube association limit has been reached.');
      ({ingest,destination}=await this.matching(channel));
      detail=`Create a scheduled event on ${channel.title}\nChannel: ${channel.id}\nTitle: ${command.draft.title}\nStart: ${berlin(command.draft.startsAt)} (Europe/Berlin)\nVisibility: ${command.draft.privacy}\nMade for kids: ${command.draft.madeForKids?'YES':'NO'}\n\nDescription:\n${command.draft.description||'(empty)'}\n\nReuse OBS’s verified current YouTube ingest key. No OBS settings, scene, audio or transmission will change. Auto-start and auto-stop will be disabled.`;
    }else if(command.kind==='link'){
      if(link?.broadcastId&&link.broadcastId!==command.broadcastId)throw new YouTubeFailure('This service is already linked to another event. Review the existing association rather than replacing it during a service.');
      broadcast=await this.api.broadcast(command.broadcastId);this.owned(broadcast,channel);this.policy(broadcast);
      if(!['created','ready'].includes(broadcast.lifeCycle))throw new YouTubeFailure('Only an upcoming, not-yet-live event can be linked here.');
      ({ingest,destination}=await this.matching(channel,broadcast.streamId||undefined));
      detail=`Link ${broadcast.title} (${broadcast.privacy}) on ${channel.title} to the selected local service. ${broadcast.streamId?'Keep its existing verified ingest binding.':'Bind it to OBS’s verified existing YouTube ingest stream.'} No OBS output changes will be made.`;
    }else{
      if(!link?.broadcastId||link.stage!=='ready'||link.channelId!==channel.id)throw new YouTubeFailure('Create or link a verified YouTube event for this service first.');
      broadcast=await this.api.broadcast(link.broadcastId);this.owned(broadcast,channel);this.policy(broadcast);
      if(broadcast.streamId!==link.streamId)throw new YouTubeFailure('The event’s ingest binding changed in YouTube. Stop and review it.');
      ({ingest,destination}=await this.matching(channel,link.streamId));this.requireOutput(serviceId);
      await this.noOtherBroadcast(channel,ingest.id,broadcast.id);const o=this.host.state();
      if(command.kind==='start'){
        if(o.streaming!==false||o.reconnecting!==false)throw new YouTubeFailure('OBS is already transmitting, reconnecting or unknown. Do not restart it. Refresh the event; use Publish current Intro only for a confirmed pending start.');
        if(broadcast.lifeCycle!=='ready'||!['created','ready','inactive'].includes(ingest.status))throw new YouTubeFailure('This event is not ready to start, or its ingest is already active/unknown. Review YouTube Studio.');
      }else if(command.kind==='publish-intro'){
        if(o.streaming!==true||o.reconnecting!==false||o.program!==o.intro||o.muted!==true||ingest.status!=='active'||!['ready','liveStarting'].includes(broadcast.lifeCycle))throw new YouTubeFailure('Recovery requires OBS transmitting the mapped Intro with muted service audio, the matching ingest active, and this event awaiting publication.');
      }else if(!['live','complete'].includes(broadcast.lifeCycle)||o.streaming!==true||o.program!==o.outro||o.muted!==true)throw new YouTubeFailure('Show Outro and confirm service audio is muted before ending this linked YouTube broadcast. An already-completed event may then be used to finish stopping OBS.');
      detail=`Channel: ${channel.title} (${channel.id})\nEvent: ${broadcast.title}\nVisibility: ${broadcast.privacy}\nYouTube state: ${broadcast.lifeCycle}\n\n`+(command.kind==='start'?'Mute service audio, put Intro on Program, start the verified OBS destination, wait for YouTube ingest, then make this event live. Viewers allowed by the selected visibility will see Intro. On Air remains a separate Main + unmute action.':command.kind==='publish-intro'?'Continue publishing the currently transmitting Intro. Do not restart OBS, change its picture or unmute audio.':'Complete this YouTube event, verify completion, then stop the matching OBS transmission. This is irreversible for the YouTube event. Outro remains displayed.');
    }
    if(epoch!==this.epoch)throw new YouTubeFailure('YouTube review was cancelled.');
    const stamp=hash({command,channel:channel.id,broadcast,streamId:ingest.id,destination,outputTicket:['start','publish-intro','end'].includes(command.kind)?this.host.ticket():null});
    return {command,channel,broadcast,ingest,destination,stamp,detail,epoch};
  }
  async execute(review:BroadcastReview):Promise<void>{
    if(review.epoch!==this.epoch)throw new YouTubeFailure('YouTube action cancelled.');
    const fresh=await this.review(review.command);if(fresh.stamp!==review.stamp)throw new YouTubeFailure('The event, channel, destination or OBS state changed during confirmation. Review again.');
    const {command,channel,ingest,destination}=fresh,serviceId=command.kind==='create'?command.draft.serviceId:command.serviceId,epoch=this.epoch;
    const local=()=>{
      if(epoch!==this.epoch)throw new YouTubeFailure('YouTube action cancelled. Completed remote changes may remain; no rollback was attempted.');
      if(!this.host.services().some(s=>s.id===serviceId))throw new YouTubeFailure('The local service was removed. No further YouTube commands were sent.');
    };
    await this.host.log(`youtube.${command.kind}`,'approved','Operator confirmed the channel, event and effect.');local();
    if(command.kind==='create'||command.kind==='link'){
      let b=fresh.broadcast;
      if(command.kind==='create'){
        await this.save({serviceId,channelId:channel.id,broadcastId:'',streamId:ingest.id,stage:'creating',updatedAt:new Date().toISOString()});local();
        b=await this.api.create(command.draft,local);
        // Save an acknowledged ID even when cancellation happened during the remote request.
        await this.save({serviceId,channelId:channel.id,broadcastId:b.id,streamId:ingest.id,stage:'created',updatedAt:new Date().toISOString()});local();
        if(b.privacy!==command.draft.privacy||b.title!==command.draft.title||Date.parse(b.scheduledStartTime)!==Date.parse(command.draft.startsAt))throw new YouTubeFailure('YouTube created an event with different metadata or visibility. Review and link that existing event; do not create another.');
      }
      if(!b)throw new YouTubeFailure('Event creation was not confirmed.');this.owned(b,channel);this.policy(b);
      if(b.streamId&&b.streamId!==ingest.id)throw new YouTubeFailure('Unexpected YouTube ingest binding.');
      if(!b.streamId){local();await this.api.bind(b.id,ingest.id,local);local();}
      const verified=await this.api.broadcast(b.id);local();this.owned(verified,channel);this.policy(verified);assertReviewedMetadata(b,verified);
      if(verified.streamId!==ingest.id||verified.lifeCycle!=='ready')throw new YouTubeFailure('YouTube event binding is not confirmed ready. Refresh and recover this existing event rather than creating another.');
      await this.save({serviceId,channelId:channel.id,broadcastId:b.id,streamId:ingest.id,stage:'ready',updatedAt:new Date().toISOString()});
      await this.host.log(`youtube.${command.kind}`,'completed','Event association and ingest binding verified; no OBS writes.');return;
    }
    this.host.cancelAutomation();let ticket=this.host.ticket();
    const guard=()=>{local();if(this.host.ticket()!==ticket)throw new YouTubeFailure('OBS control changed. YouTube follow-up cancelled; no automatic stop or restart was sent.');this.requireOutput(serviceId);};
    const ownObs=async(action:()=>Promise<void>)=>{guard();const before=ticket;await action();if(this.host.ticket()!==before+1)throw new YouTubeFailure('OBS operation was interrupted. Check OBS and YouTube.');ticket=this.host.ticket();guard();};
    const b=fresh.broadcast!;
    if(command.kind==='end'){
      if(b.lifeCycle!=='complete'){guard();await this.api.transition(b.id,'complete',guard);guard();}
      await this.waitForBroadcast(b,channel,'complete',guard);guard();
      await this.noOtherBroadcast(channel,ingest.id,b.id);guard();await this.matching(channel,ingest.id);guard();
      await ownObs(()=>this.host.stopTransmission(destination));
      await this.host.log('youtube.end','completed','YouTube completion and OBS transmission stop verified.');return;
    }
    if(command.kind==='start')await ownObs(()=>this.host.startWithIntro(destination));
    let active=false;
    for(let i=0;i<30;i++){
      guard();const stream=await this.api.stream(ingest.id);guard();
      if(stream.channelId!==channel.id||stream.key!==destination.key)throw new YouTubeFailure('YouTube ingest identity changed.');
      if(stream.status==='active'){active=true;break;}await this.sleep(2000);
    }
    if(!active)throw new YouTubeFailure('OBS started but YouTube ingest was not confirmed active. OBS was left running. Refresh and use Publish current Intro when the feed is ready.');
    guard();const current=await this.api.broadcast(b.id);guard();this.owned(current,channel);this.policy(current);assertReviewedMetadata(b,current);
    if(current.streamId!==ingest.id)throw new YouTubeFailure('The event binding changed before publication.');
    await this.noOtherBroadcast(channel,ingest.id,b.id);guard();await this.matching(channel,ingest.id);guard();
    const publicationGuard=()=>{
      guard();const o=this.host.state();if(o.streaming!==true||o.reconnecting!==false||o.program!==o.intro||o.muted!==true)throw new YouTubeFailure('Intro or mute verification changed. YouTube was not deliberately made live.');
    };
    publicationGuard();
    if(current.lifeCycle==='ready'){await this.api.transition(b.id,'live',publicationGuard);guard();}
    else if(!['liveStarting','live'].includes(current.lifeCycle))throw new YouTubeFailure('YouTube no longer permits starting this event.');
    await this.waitForBroadcast(b,channel,'live',guard);
    await this.host.log('youtube.start','completed','YouTube reports live. Intro remains on Program; On Air is a separate action.');
  }
  private async waitForBroadcast(b:Broadcast,c:Channel,target:string,guard:()=>void):Promise<void>{
    for(let i=0;i<30;i++){
      guard();const current=await this.api.broadcast(b.id);guard();this.owned(current,c);
      if(current.streamId!==b.streamId)throw new YouTubeFailure('YouTube ingest binding changed while awaiting confirmation.');
      if(current.lifeCycle===target)return;if(['revoked','complete'].includes(current.lifeCycle)&&current.lifeCycle!==target)break;await this.sleep(2000);
    }throw new YouTubeFailure(`YouTube ${target} state is not confirmed. Refresh before acting again. OBS was not automatically stopped or restarted.`);
  }
}
