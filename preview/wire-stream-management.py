"""One-time source import; refuses to write unless the generated Git blob hashes match the reviewed app."""
import hashlib
from pathlib import Path
root=Path('apps/control-center')
def edit(file, changes, expected):
    p=root/file; s=p.read_text()
    for a,b in changes:
        assert s.count(a)==1,(file,a)
        s=s.replace(a,b)
    data=s.encode(); sha=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    assert sha==expected,(file,sha,expected)
    p.write_bytes(data)
edit('scripts/build.mjs',[("['youtube-preload','youtube-preload']","['youtube-preload','youtube-preload'],['stream-management-preload','stream-management-preload']"),("'live-renderer','youtube-renderer']","'live-renderer','youtube-renderer','stream-management-renderer']"),("'youtube.html','audio.css'","'youtube.html','stream-management.html','stream-management.css','audio.css'")],'47ebc3461444887d52b15fe2bdba8cfe1d52f99c')
edit('src/youtube-model.ts',[(r'!(/^[a-z0-9-]+\.rtmp\.youtube\.com$/i.test(u.hostname))',r"!((u.protocol==='rtmps:'?/^[a-z0-9-]+\.rtmps\.youtube\.com$/i:/^[a-z0-9-]+\.rtmp\.youtube\.com$/i).test(u.hostname))||(u.port!==''&&u.port!==(u.protocol==='rtmps:'?'443':'1935'))")],'d21a0d06fd62c838eb34c268f1f6d5fff50e259e')
edit('src/live-main.ts',[("label:'Broadcast manager…'","label:'Stream Management…'"),('YouTube → Broadcast manager → Start broadcast with Intro.','YouTube → Stream Management → Broadcast controls → Start broadcast with Intro.'),("'/youtube-renderer.js':'text/javascript',","'/youtube-renderer.js':'text/javascript','/stream-management.html':'text/html','/stream-management-renderer.js':'text/javascript','/stream-management.css':'text/css',"),('live,peer,journal,exclusive,notify:emit});', '''live,peer,journal,exclusive,notify:emit,saveService:async service=>{
    await exclusive(async()=>{
      const previous=workspace.services.find(s=>s.id===service.id);
      if(previous&&previous.title===service.title&&previous.startsAt===service.startsAt)return;
      if(previous&&live.snapshot().selectedService===service.id)throw new LiveFailure('The selected operator service cannot be changed. Select another service before updating its schedule.');
      let next=workspace;
      if(previous)next=applyServiceChange(next,{type:'remove',id:service.id},live.snapshot().selectedService);
      next=applyServiceChange(next,{type:'add',service},live.snapshot().selectedService);await save(next);
    });
  }});''')],'a3b00b67506fff61d8c8fb5fb213d485622d492a')
edit('src/youtube-main.ts',[("from './youtube-oauth.ts';","from './youtube-oauth.ts';\nimport {StreamManagementWindow} from './stream-management-main.ts';\nimport type {Occurrence} from './stream-management-model.ts';"),('notify():void;','notify():void;\n  saveService(service:{id:string;title:string;startsAt:string}):Promise<void>;'),('private oauth:YouTubeOAuth;','private management:StreamManagementWindow;\n  private oauth:YouTubeOAuth;'),("this.host,()=>this.oauth.channel);","this.host,()=>this.oauth.channel);\n    this.management=new StreamManagementWindow({directory,parent:d.parent,germanOAuth:this.oauth,externalBusy:()=>this.working||d.live.busy,encoderBusy:lang=>{const s=d.live.snapshot();return lang==='de'&&s.connected&&(s.observation.streaming!==false||s.observation.reconnecting!==false);},openControls:()=>this.openLegacy(),useOnDesk:occurrence=>this.useManagedService(occurrence)});"),("sender(event);if(this.working)throw new Error('A YouTube operation is in progress. Cancel remains available.');","sender(event);if(this.working||this.management.busy)throw new Error('A YouTube operation is in progress. Cancel remains available.');\n      if(['youtube:configure','youtube:sign-in','youtube:disconnect'].includes(name))throw new Error('Use YouTube → Stream Management → Accounts to manage credentials.');"),('const command=parseCommand(raw),output=',"if(raw&&typeof raw==='object'&&'kind' in raw&&raw.kind==='create')throw new YouTubeFailure('Create and schedule events in Stream Management, then choose Use on operator desk.');\n      const command=parseCommand(raw),output="),('async open():Promise<void>{',r'''async open():Promise<void>{await this.management.open();}
  private async useManagedService(occurrence:Occurrence):Promise<void>{
    const target=occurrence.targets.find(t=>t.language==='de');
    if(!target?.broadcastId||target.stage!=='ready')throw new YouTubeFailure('A confirmed German event is required.');
    if(!this.loaded){await this.oauth.load();await this.controller.load();this.loaded=true;}
    const serviceId=`stream_${occurrence.id}`;
    await this.d.saveService({id:serviceId,title:target.draft.title.text,startsAt:occurrence.startsAt});
    const review=await this.controller.review({kind:'link',serviceId,broadcastId:target.broadcastId});
    const options={type:'warning' as const,message:'Link this event to the operator desk?',detail:review.detail+'\n\nNo encoder is started. Select the new local service before Start with Intro.',buttons:['Cancel','Link existing event'],defaultId:0,cancelId:0};
    const parent=this.d.parent(),pick=parent?await dialog.showMessageBox(parent,options):await dialog.showMessageBox(options);
    if(pick.response!==1)throw new YouTubeFailure('Operator-desk handoff cancelled. The scheduled event and local service remain.');
    await this.controller.execute(review);await this.refresh();await this.openLegacy();
  }
  private async openLegacy():Promise<void>{'''),('emit():void{if(this.window','emit():void{this.management?.emit();if(this.window'),('this.controller.cancel();this.oauth.cancel();if(this.outputOperation)','this.management?.cancel();this.controller.cancel();this.oauth.cancel();if(this.outputOperation)'),('close():void{this.cancel();this.window?.close();}','close():void{this.management.close();this.cancel();this.window?.close();}')],'64e57ec9a947f02a345922ef5225ed92889c5d04')
