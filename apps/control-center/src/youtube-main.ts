import {app,BrowserWindow,clipboard,dialog,ipcMain,safeStorage,shell} from 'electron';
import type {IpcMainInvokeEvent} from 'electron';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import type {Workspace} from './model.ts';
import type {LiveController} from './live-controller.ts';
import type {LiveObs} from './live-obs.ts';
import type {JournalPort} from './live-contract.ts';
import {YouTubeClient} from './youtube-api.ts';
import {YouTubeController} from './youtube-controller.ts';
import type {BroadcastHost} from './youtube-controller.ts';
import {YouTubeOAuth} from './youtube-oauth.ts';
import {StreamManagementWindow} from './stream-management-main.ts';
import type {Occurrence} from './stream-management-model.ts';
import {YouTubeFileState,YouTubeSecretFile} from './youtube-storage.ts';
import {YouTubeFailure,youtubeError,identifier,parseCommand,watchUrl} from './youtube-model.ts';
import type {Broadcast,Destination,YouTubePanel} from './youtube-model.ts';
interface Dependencies {
  workspace():Workspace;parent():BrowserWindow|null;live:LiveController;peer:LiveObs;journal:JournalPort;
  exclusive<T>(fn:()=>Promise<T>):Promise<T>;notify():void;
  saveService(service:{id:string;title:string;startsAt:string}):Promise<void>;
}
/** Separate UI/preload; all credentials and endpoint matching stay in this process. */
export class YouTubeManager {
  private window:BrowserWindow|null=null;private loaded=false;private working=false;private outputOperation=false;private opening:Promise<void>|null=null;
  private error='';private notice='Staged YouTube integration. No event is created or started by opening this screen.';
  private broadcasts:Broadcast[]=[];private checkedAt:number|null=null;
  private management:StreamManagementWindow;
  private oauth:YouTubeOAuth;private api:YouTubeClient;private controller:YouTubeController;private host:BroadcastHost;
  constructor(private d:Dependencies){
    const directory=path.join(app.getPath('userData'),'youtube');
    const secrets=new YouTubeSecretFile(path.join(directory,'google-credentials.enc'),{
      available:()=>safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text'),
      encrypt:s=>safeStorage.encryptString(s),decrypt:b=>safeStorage.decryptString(b),
    });
    this.oauth=new YouTubeOAuth(secrets,url=>shell.openExternal(url));this.api=new YouTubeClient(()=>this.oauth.token());
    this.host={
      services:()=>d.workspace().services,selected:()=>d.live.snapshot().selectedService,
      state:()=>{const s=d.live.snapshot(),o=s.observation,w=d.workspace();return {connected:s.connected,streaming:o.streaming,reconnecting:o.reconnecting,program:o.program,muted:o.muted,intro:w.bindings.scenes.intro,outro:w.bindings.scenes.outro,permissionsReady:s.permissions.scenes&&s.permissions.audio&&s.permissions.stream};},
      ticket:()=>d.live.ticket(),cancelAutomation:()=>d.live.cancelReturn(),destination:()=>d.peer.youtubeDestination(),
      startWithIntro:destination=>this.obsCommand('start',destination),stopTransmission:destination=>this.obsCommand('stop',destination),
      log:(action,stage,detail)=>d.journal.append(action,stage,detail),
    };
    this.controller=new YouTubeController(this.api,new YouTubeFileState(path.join(directory,'broadcasts.json')),this.host,()=>this.oauth.channel);
    this.management=new StreamManagementWindow({directory,parent:d.parent,germanOAuth:this.oauth,externalBusy:()=>this.working||d.live.busy,encoderBusy:lang=>{const s=d.live.snapshot();return lang==='de'&&s.connected&&(s.observation.streaming!==false||s.observation.reconnecting!==false);},openControls:()=>this.openLegacy(),useOnDesk:occurrence=>this.useManagedService(occurrence)});
    const sender=(event:IpcMainInvokeEvent)=>{
      if(!this.window||event.sender!==this.window.webContents||event.senderFrame!==this.window.webContents.mainFrame||event.senderFrame?.url!=='bcc://app/youtube.html')throw new Error('Untrusted YouTube request.');
    };
    ipcMain.handle('youtube:panel',event=>{sender(event);return this.panel();});
    ipcMain.handle('youtube:cancel',event=>{sender(event);this.cancel();});
    const handle=(name:string,fn:(value?:unknown)=>Promise<unknown>)=>ipcMain.handle(name,async(event,value)=>{
      sender(event);if(this.working||this.management.busy)throw new Error('A YouTube operation is in progress. Cancel remains available.');
      if(['youtube:configure','youtube:sign-in','youtube:disconnect'].includes(name))throw new Error('Use YouTube → Stream Management → Accounts to manage credentials.');
      this.working=true;this.error='';this.emit();
      try{return await fn(value);}catch(e){this.error=youtubeError(e);this.checkedAt=null;this.emit();throw new Error(this.error);}finally{this.working=false;this.emit();}
    });
    handle('youtube:refresh',async()=>{await this.refresh();return this.panel();});
    handle('youtube:configure',async()=>{
      const pick=await dialog.showOpenDialog(this.window!,{title:'Import Google OAuth Desktop app client',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});
      if(pick.canceled)return this.panel();
      if((await stat(pick.filePaths[0])).size>64*1024)throw new YouTubeFailure('OAuth client files must be smaller than 64 KiB.');
      let value:unknown;try{value=JSON.parse(await readFile(pick.filePaths[0],'utf8'));}catch{throw new YouTubeFailure('The selected OAuth client file is not valid JSON.');}
      await this.oauth.configure(value);this.notice='Desktop OAuth client saved in encrypted local storage. Connect Google next.';return this.panel();
    });
    handle('youtube:sign-in',async()=>{
      await this.oauth.signIn(token=>new YouTubeClient(async()=>token).channel());this.broadcasts=[];this.checkedAt=null;
      await this.refresh();this.notice='Google connected. Verify the displayed channel before creating a broadcast.';return this.panel();
    });
    handle('youtube:disconnect',async()=>{
      const pick=await dialog.showMessageBox(this.window!,{type:'question',message:'Forget Google sign-in on this Mac?',detail:'Existing YouTube events, live broadcasts and OBS outputs are left untouched. This removes local credentials only; revoke app access separately in your Google Account if needed.',buttons:['Cancel','Forget local sign-in'],defaultId:0,cancelId:0});
      if(pick.response===1){this.controller.cancel();await this.oauth.forget();this.broadcasts=[];this.checkedAt=null;this.notice='Local Google sign-in removed. No outputs were stopped.';}return this.panel();
    });
    handle('youtube:command',async(raw:unknown)=>{
      if(raw&&typeof raw==='object'&&'kind' in raw&&raw.kind==='create')throw new YouTubeFailure('Create and schedule events in Stream Management, then choose Use on operator desk.');
      const command=parseCommand(raw),output=['start','publish-intro','end'].includes(command.kind);
      const execute=async()=>{
        this.outputOperation=output;this.checkedAt=null;this.emit();
        try{
          const review=await this.controller.review(command);
          const pick=await dialog.showMessageBox(this.window!,{type:'warning',message:command.kind==='create'?'Create this scheduled YouTube broadcast?':command.kind==='link'?'Use this existing YouTube event?':command.kind==='end'?'End YouTube broadcast and stop OBS?':'Start this YouTube broadcast with Intro?',detail:review.detail,buttons:['Cancel',command.kind==='end'?'End broadcast and stop OBS':'Confirm YouTube action'],defaultId:0,cancelId:0});
          if(pick.response!==1){this.notice='YouTube action cancelled before execution.';return;}
          await this.controller.execute(review);
          this.notice=output?'YouTube action completed and checked. Use Live Service → On Air for Main + service audio; Outro and End remain deliberate separate actions.':'YouTube event linked to this service. No OBS scene, mute or transmission changes were made.';
          await this.refresh();
        }finally{this.outputOperation=false;}
      };
      if(output)await d.exclusive(execute);else await execute();return this.panel();
    });
    handle('youtube:open',async value=>{await shell.openExternal(watchUrl(this.knownBroadcast(value)));});
    handle('youtube:copy-link',async value=>{clipboard.writeText(watchUrl(this.knownBroadcast(value)));});
  }
  private obsCommand(command:'start'|'stop',destination:Destination):Promise<void>{
    const before=this.d.live.ticket();
    return this.d.peer.withYouTubeDestination(destination,()=>this.d.live.command(command),()=>this.d.live.ticket()===before+1&&this.host.state().permissionsReady);
  }
  private knownBroadcast(raw:unknown):string{
    const id=identifier(raw);if(!this.broadcasts.some(b=>b.id===id&&b.channelId===this.oauth.channel?.id))throw new YouTubeFailure('Refresh the connected channel and select one of its broadcasts.');return id;
  }
  async open():Promise<void>{await this.management.open();}
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
  private async openLegacy():Promise<void>{
    if(this.window&&!this.window.isDestroyed()){this.window.focus();return;}
    if(this.opening)return this.opening;this.opening=this.openWindow();try{await this.opening;}finally{this.opening=null;}
  }
  private async openWindow():Promise<void>{
    if(!this.loaded){try{await this.oauth.load();await this.controller.load();this.loaded=true;}catch(e){this.error=youtubeError(e);}}
    this.window=new BrowserWindow({width:1120,height:880,minWidth:900,minHeight:700,title:'Broadcast Control Center — YouTube (staged)',parent:this.d.parent()||undefined,webPreferences:{preload:path.join(__dirname,'youtube-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));this.window.webContents.on('will-navigate',e=>e.preventDefault());
    this.window.webContents.on('render-process-gone',()=>this.cancel());this.window.webContents.on('did-start-loading',()=>this.cancel());
    this.window.on('closed',()=>{this.cancel();this.window=null;});await this.window.loadURL('bcc://app/youtube.html');
  }
  panel():YouTubePanel{
    const o=this.host.state();return {channel:this.oauth.channel,credentialsConfigured:this.oauth.configured,services:this.d.workspace().services.map(({id,title,startsAt})=>({id,title,startsAt})),selectedService:this.d.live.snapshot().selectedService,links:this.controller.links(),broadcasts:this.broadcasts.map(b=>({...b})),checkedAt:this.working?null:this.checkedAt,error:this.error,busy:this.working,notice:this.notice,obs:{connected:o.connected,streaming:o.streaming,program:o.program,muted:o.muted,permissionsReady:o.permissionsReady}};
  }
  emit():void{this.management?.emit();if(this.window&&!this.window.isDestroyed())this.window.webContents.send('youtube:state',this.panel());}
  cancel():void{
    this.management?.cancel();this.controller.cancel();this.oauth.cancel();if(this.outputOperation)this.d.live.cancelReturn();
    this.notice='Pending YouTube follow-up cancelled. Already completed changes remain; OBS and YouTube were not automatically stopped.';this.checkedAt=null;this.emit();
  }
  close():void{this.management.close();this.cancel();this.window?.close();}
  private async refresh():Promise<void>{
    const c=this.oauth.channel;if(!c)throw new YouTubeFailure('Connect Google first.');
    const observed=await this.api.channel();if(c.id!==observed.id)throw new YouTubeFailure('Google returned a different YouTube channel. Reconnect before continuing.');
    this.broadcasts=(await this.api.broadcasts()).filter(b=>b.channelId===c.id);this.checkedAt=Date.now();this.error='';this.emit();
  }
}
