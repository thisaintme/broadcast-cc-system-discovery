import type {Workspace,Role,Reader} from './model.ts';
import {selectService} from './workspace.ts';
import {executeLiveAction} from './live-actions.ts';
import {blockedActions,commandPermissions,requireAudio} from './live-validation.ts';
import {expectedStreamEvent,duplicateTerminalStreamEvent} from './live-events.ts';
import {LIVE_COMMANDS,LiveFailure,emptyObservation,noPermissions,normalizePermissions,safeLiveError,liveMappingKey} from './live-contract.ts';
import type {LiveCommand,LiveObservation,LivePermissions,LivePhase,LivePort,LiveRead,LiveSnapshot,LiveWrite,JournalPort} from './live-contract.ts';
export interface LiveClock{now():number;set(fn:()=>void,ms:number):unknown;clear(handle:unknown):void}
const realClock:LiveClock={now:()=>Date.now(),set:(fn,ms)=>setTimeout(fn,ms),clear:h=>clearTimeout(h as ReturnType<typeof setTimeout>)};
const str=(x:unknown)=>typeof x==='string'?x:'';
const num=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
const flag=(x:unknown)=>typeof x==='boolean'?x:null;
/** Live control has its own session. Legacy offline guards remain unchanged. */
export class LiveController{
  private observed=emptyObservation();private permissions=noPermissions();
  private collection='';private profile='';private mapping='';private phase:LivePhase='unknown';private selected='';
  private working=false;private operation='';private returnAt:number|null=null;private timer:unknown=null;
  private generation=0;private revision=0;private connection=0;private polling=false;
  private interval:ReturnType<typeof setInterval>|null=null;
  private expected=new Map<string,{value:unknown;until:number}>();private available=new Set<string>();
  private audioChanging=false;private audioRevision=0;
  private notice='Observe only. Connecting never changes OBS outputs.';private lastError='';private journalError='';
  constructor(private workspace:()=>Workspace,private port:LivePort,private journal:JournalPort,private emit:()=>void,private clock:LiveClock=realClock){
    port.onEvent=(name,data)=>this.event(name,data);
    port.onDisconnect=()=>{this.connection++;this.observed=emptyObservation();this.release('OBS disconnected. Pending actions cancelled; outputs were not stopped.');};
  }
  get authorized():boolean{return this.permissions.scenes||this.permissions.audio||this.permissions.stream;}
  get busy():boolean{return this.working;}
  ticket():number{return this.generation;}
  private serviceId():string{return this.selected||selectService(this.workspace());}
  snapshot():LiveSnapshot{
    const o=this.observed,fresh=this.port.isConnected()&&o.checkedAt!==null&&this.clock.now()-o.checkedAt<6000;
    const observation=fresh?{...o,muted:this.working&&this.audioChanging?null:o.muted,scenes:[...o.scenes],warnings:[...o.warnings]}:{...o,streaming:null,reconnecting:null,muted:null,warnings:[...o.warnings,'Status is disconnected, pending verification or stale; not confirmed off.']};
    return {connected:this.port.isConnected(),observation,permissions:{...this.permissions},boundCollection:this.collection,phase:this.phase,selectedService:this.serviceId(),busy:this.working,pendingAction:this.operation,returnAt:this.returnAt,notice:this.notice,lastError:this.lastError,journalError:this.journalError,
      reasons:blockedActions(this.workspace(),o,this.permissions,this.port.isConnected(),this.working,this.serviceId(),this.clock.now(),this.journalError)};
  }
  private async record(action:string,stage:string,detail:string):Promise<void>{
    try{await this.journal.append(action,stage,detail);}catch{this.journalError='Local activity log could not be written. Live changes are blocked; use OBS manually.';this.emit();throw new LiveFailure(this.journalError);}
  }
  private note(action:string,detail:string):void{void this.record(action,'observed',detail).catch(()=>{});}
  private cancelTimer():void{if(this.timer!==null)this.clock.clear(this.timer);this.timer=null;this.returnAt=null;}
  release(message='Control released. OBS picture, audio and transmission were left unchanged.'):void{
    this.generation++;this.cancelTimer();this.permissions=noPermissions();this.collection='';this.profile='';this.mapping='';this.expected.clear();this.notice=message;
    if(this.working)this.observed={...this.observed,checkedAt:null};
    this.note('release',message);this.emit();
  }
  cancelReturn():void{this.generation++;this.cancelTimer();this.expected.clear();this.notice='Pending automation cancelled. Completed OBS changes remain.';if(this.working)this.observed={...this.observed,checkedAt:null};this.note('cancel',this.notice);this.emit();}
  async disconnect():Promise<void>{this.release();if(this.interval)clearInterval(this.interval);this.interval=null;await this.port.disconnect();}
  async connect(password:string):Promise<void>{
    this.release('Connecting in Observe only mode.');this.connection++;if(this.interval)clearInterval(this.interval);this.interval=null;
    try{
      await this.port.connect(this.workspace().obsUrl,password);
      const version=await this.port.read('GetVersion');this.available=new Set(Array.isArray(version.availableRequests)?version.availableRequests.filter((x:unknown)=>typeof x==='string'):[]);
      this.selected=selectService(this.workspace());await this.refresh();
      if(this.port.isConnected())this.interval=setInterval(()=>{void this.refresh().catch(()=>{});},2000);
      this.notice='Connected in Observe only mode. Existing stream, scene and mute state were not changed.';
      await this.record('connect','observed',this.notice);this.emit();
    }catch(error){await this.disconnect();throw error;}
  }
  private async query():Promise<LiveObservation>{
    const input=this.workspace().bindings.audioInput;
    const queries:[LiveRead,Record<string,unknown>][]=[['GetSceneCollectionList',{}],['GetProfileList',{}],['GetSceneList',{}],['GetStreamStatus',{}]];
    if(input)queries.push(['GetInputMute',{inputName:input}]);
    const results=await Promise.allSettled(queries.map(([n,d])=>this.port.read(n,d))),warnings:string[]=[];
    const values=results.map((r,i)=>{if(r.status==='fulfilled'&&r.value&&typeof r.value==='object')return r.value;warnings.push(`${queries[i][0]} unavailable; its state is unknown.`);return{};});
    const stream=values[3];if(typeof stream.outputActive!=='boolean')warnings.push('OBS streaming state is unknown.');
    return {checkedAt:this.clock.now(),collection:str(values[0].currentSceneCollectionName),profile:str(values[1].currentProfileName),program:str(values[2].currentProgramSceneName),scenes:Array.isArray(values[2].scenes)?values[2].scenes.slice(0,1000).map((s:any)=>str(s.sceneName)).filter(Boolean):[],
      streaming:flag(stream.outputActive),reconnecting:flag(stream.outputReconnecting),durationMs:num(stream.outputDuration),bytes:num(stream.outputBytes),skippedFrames:num(stream.outputSkippedFrames),totalFrames:num(stream.outputTotalFrames),inputName:input,muted:input?flag(values[4]?.inputMuted):null,warnings};
  }
  private infer(program:string):LivePhase{
    const matches=Object.entries(this.workspace().bindings.scenes).filter(([,name])=>name===program);
    return matches.length===1?matches[0][0] as Role:'unknown';
  }
  async refresh():Promise<void>{
    if(this.polling||this.working||!this.port.isConnected())return;this.polling=true;
    const revision=this.revision,connection=this.connection;
    try{
      const next=await this.query();if(!this.port.isConnected()||revision!==this.revision||connection!==this.connection||this.working)return;
      if(this.authorized&&(next.collection!==this.collection||next.profile!==this.profile))this.release('OBS collection/profile changed. Inspect and enable control again.');
      if(this.observed.program&&next.program!==this.observed.program)this.interruptAutomation('External Program change detected; pending return cancelled.');
      if(this.observed.streaming!==null&&(next.streaming!==this.observed.streaming||next.reconnecting!==this.observed.reconnecting))this.interruptAutomation('OBS transmission changed; pending automation cancelled.');
      if(next.program!==this.observed.program||this.phase==='unknown')this.phase=this.infer(next.program);
      this.observed=next;
      if(this.authorized&&(!next.collection||!next.profile||!next.program||next.streaming===null))this.release('Required OBS status is unknown. Control released without changing outputs.');
    }finally{this.polling=false;this.emit();}
  }
  private interruptAutomation(message:string):void{this.generation++;this.cancelTimer();this.expected.clear();this.notice=message;if(this.working)this.observed={...this.observed,checkedAt:null};this.note('manual-priority',message);}
  private expectedEvent(key:string,value:unknown):boolean{
    const e=this.expected.get(key);if(e&&e.until>=this.clock.now()&&JSON.stringify(e.value)===JSON.stringify(value)){this.expected.delete(key);return true;}return false;
  }
  private event(name:string,d:Record<string,any>):void{
    if(!this.port.isConnected())return;
    if(name==='CurrentProgramSceneChanged'){
      this.revision++;const program=str(d.sceneName);
      if(!this.expectedEvent('program',program)&&program!==this.observed.program)this.interruptAutomation('OBS Program changed manually; pending app actions cancelled.');
      this.observed={...this.observed,program};this.phase=this.infer(program);this.emit();return;
    }
    if(name==='InputMuteStateChanged'&&d.inputName===this.workspace().bindings.audioInput){
      this.revision++;const known=this.expectedEvent('mute',d.inputMuted);
      if(!known&&(typeof d.inputMuted!=='boolean'||d.inputMuted!==this.observed.muted)){
        this.audioRevision++;if(this.audioChanging)this.interruptAutomation('Manual mute change took priority over the pending audio action.');
      }
      this.observed={...this.observed,muted:flag(d.inputMuted)};this.emit();return;
    }
    if(name==='StreamStateChanged'){
      this.revision++;const target=this.expected.get('stream');
      const ours=!!target&&target.until>=this.clock.now()&&typeof target.value==='boolean'&&expectedStreamEvent(target.value,d);
      if(!ours&&!duplicateTerminalStreamEvent(this.observed.streaming,d))this.interruptAutomation('OBS transmission state changed externally; pending automation cancelled.');
      this.observed={...this.observed,streaming:flag(d.outputActive),reconnecting:d.outputState==='OBS_WEBSOCKET_OUTPUT_RECONNECTING'?true:['OBS_WEBSOCKET_OUTPUT_RECONNECTED','OBS_WEBSOCKET_OUTPUT_STARTED','OBS_WEBSOCKET_OUTPUT_STOPPED'].includes(d.outputState)?false:this.observed.reconnecting};this.emit();return;
    }
    if(name==='InputSettingsChanged'){
      const w=this.workspace();if(![w.bindings.bibleText,w.bindings.nextServiceText,...w.captions.speakerPool].includes(d.inputName))return;
      if(!this.expectedEvent('text:'+d.inputName,d.inputSettings?.text))this.interruptAutomation('A controlled caption changed externally; pending app actions cancelled.');this.emit();return;
    }
    if(name==='SceneItemEnableStateChanged'){
      if(!this.expectedEvent('item:'+JSON.stringify([d.sceneName,d.sceneItemId]),d.sceneItemEnabled))this.interruptAutomation('OBS source visibility changed manually; pending app actions cancelled.');this.emit();return;
    }
    if(['CurrentSceneCollectionChanging','CurrentSceneCollectionChanged','CurrentProfileChanging','CurrentProfileChanged','SceneListChanged','SceneItemCreated','SceneItemRemoved','SceneItemListReindexed','InputNameChanged','InputRemoved','InputCreated'].includes(name)){
      this.revision++;this.release('OBS configuration changed. Inspect and enable control again; outputs remain untouched.');this.observed={...this.observed,checkedAt:null};this.emit();
    }
  }
  async checkGrant(raw:LivePermissions):Promise<{ticket:number;collection:string;profile:string}>{
    if(this.working)throw new LiveFailure('An action is still in progress.');
    const p=normalizePermissions(raw);if(!p.scenes&&!p.audio&&!p.stream)throw new LiveFailure('Select at least one control permission.');
    if(this.journalError)throw new LiveFailure(this.journalError);
    const ticket=this.generation,connection=this.connection,o=await this.query(),w=this.workspace();
    const valid=()=>ticket===this.generation&&connection===this.connection&&this.port.isConnected();
    if(!valid())throw new LiveFailure('OBS changed during authorization. Review its current state again.');
    if(!o.collection||!o.profile||!o.program||o.streaming===null)throw new LiveFailure('The current collection, profile, Program and transmission state must be known.');
    if(w.inventory?.origin!=='live'||w.inventory.collection!==o.collection)throw new LiveFailure('Connect & inspect the current OBS collection first. Live Service does not require a test collection.');
    if(p.scenes&&!Object.values(w.bindings.scenes).some(n=>o.scenes.includes(n)))throw new LiveFailure('Map at least one current scene before enabling scene controls.');
    if(p.audio)await requireAudio({read:(n,d={})=>this.read(n,d,valid)},w);
    if(p.stream&&!['StartStream','StopStream','GetStreamStatus'].every(n=>this.available.has(n)))throw new LiveFailure('OBS did not advertise the required stream-control requests. Enable scene/audio permissions separately.');
    if(!valid())throw new LiveFailure('Authorization was interrupted.');this.observed=o;this.emit();return {ticket,collection:o.collection,profile:o.profile};
  }
  async grant(raw:LivePermissions,ticket:number):Promise<void>{
    if(ticket!==this.generation)throw new LiveFailure('Authorization was cancelled.');
    const p=normalizePermissions(raw),checked=await this.checkGrant(p);
    if(ticket!==checked.ticket)throw new LiveFailure('OBS changed during authorization.');
    await this.record('permissions','approved',`Scenes/captions: ${p.scenes}; service audio: ${p.audio}; OBS start/stop: ${p.stream}. Enabling sends no output changes.`);
    if(ticket!==this.generation)throw new LiveFailure('Authorization was cancelled.');
    this.permissions=p;this.collection=checked.collection;this.profile=checked.profile;this.mapping=liveMappingKey(this.workspace());
    this.phase=this.infer(this.observed.program);this.lastError='';this.notice='Live control enabled. Current OBS state adopted without changing the broadcast.';this.emit();
  }
  selectService(id:string):void{if(this.working)throw new LiveFailure('An action is still in progress.');if(!this.workspace().services.some(s=>s.id===id))throw new LiveFailure('Select a scheduled service.');this.cancelReturn();this.selected=id;this.notice='Service selected locally. OBS and YouTube were not changed.';this.emit();}
  adoptPhase(phase:LivePhase):void{if(this.working||!['unknown','intro','main','speaker','bible','outro'].includes(phase))throw new LiveFailure('Choose the current service phase.');this.cancelReturn();this.phase=phase;this.notice='Phase recorded only. No scene, audio or stream command was sent.';this.emit();}
  private async read(name:LiveRead,data:Record<string,unknown>,valid:()=>boolean):Promise<Record<string,any>>{
    if(!valid())throw new LiveFailure('Action cancelled.');const r=await this.port.read(name,data);if(!valid())throw new LiveFailure('Action interrupted.');return r;
  }
  async command(command:LiveCommand,value=''):Promise<void>{
    if(!LIVE_COMMANDS.includes(command))throw new LiveFailure('Unknown live action.');
    await this.refresh();const reasons=this.snapshot().reasons[command];if(reasons.length)throw new LiveFailure(reasons.join(' '));
    this.cancelTimer();const token=++this.generation,connection=this.connection;
    this.working=true;this.operation=command;this.lastError='';this.emit();
    const w=this.workspace(),key=liveMappingKey(w),serviceId=this.serviceId();
    this.audioChanging=commandPermissions(command).audio;const audioRevision=this.audioRevision;let streamIssued=false;
    let permittedPrograms=new Set([this.observed.program]),pendingProgram:string|null=null;
    const valid=()=>token===this.generation&&connection===this.connection&&this.port.isConnected()&&liveMappingKey(this.workspace())===key&&this.mapping===key&&(!this.audioChanging||audioRevision===this.audioRevision);
    const reader:Reader={read:(n,d={})=>this.read(n,d,valid)};
    const check=async():Promise<LiveObservation>=>{
      if(!valid())throw new LiveFailure('Action interrupted; no further commands sent.');
      const o=await this.query();if(!valid())throw new LiveFailure('Action interrupted.');
      if(o.collection!==this.collection||o.profile!==this.profile||!o.program||o.streaming===null)throw new LiveFailure('OBS target or status changed. No further commands sent.');
      if(!permittedPrograms.has(o.program))throw new LiveFailure('Program changed outside this action. No further commands sent.');
      if(pendingProgram&&o.program===pendingProgram){permittedPrograms=new Set([pendingProgram]);pendingProgram=null;}
      if((command==='prepare'||command==='intro'||(command==='start'&&!streamIssued))&&(o.streaming!==false||o.reconnecting!==false))throw new LiveFailure('OBS is transmitting, reconnecting, or its reconnect state is unknown. Preparation stopped; it was not restarted.');
      this.observed=o;this.emit();return o;
    };
    const change=async(name:LiveWrite,data:Record<string,unknown>={})=>{
      await check();const p=this.permissions;
      if((['SetInputSettings','SetSceneItemEnabled','SetCurrentProgramScene'].includes(name)&&!p.scenes)||(name==='SetInputMute'&&!p.audio)||(['StartStream','StopStream'].includes(name)&&!p.stream))throw new LiveFailure('Permission was released.');
      if(name==='SetInputMute'&&(data.inputName!==w.bindings.audioInput||typeof data.inputMuted!=='boolean'))throw new LiveFailure('Service-input mismatch.');
      if(name==='StartStream'&&command!=='start')throw new LiveFailure('Start requires its separate confirmed action.');
      if(name==='StopStream'&&command!=='stop')throw new LiveFailure('Stop requires its separate confirmed action.');
      await this.record(command,'requested',name);await check();
      if(name==='SetCurrentProgramScene'){
        pendingProgram=String(data.sceneName);permittedPrograms.add(pendingProgram);
        this.expected.set('program',{value:data.sceneName,until:this.clock.now()+12000});
      }
      if(name==='SetInputSettings')this.expected.set('text:'+data.inputName,{value:(data.inputSettings as any).text,until:this.clock.now()+5000});
      if(name==='SetSceneItemEnabled')this.expected.set('item:'+JSON.stringify([data.sceneName,data.sceneItemId]),{value:data.sceneItemEnabled,until:this.clock.now()+5000});
      if(name==='SetInputMute')this.expected.set('mute',{value:data.inputMuted,until:this.clock.now()+5000});
      if(name==='StartStream'||name==='StopStream'){streamIssued=true;this.expected.set('stream',{value:name==='StartStream',until:this.clock.now()+20000});}
      if(!valid())throw new LiveFailure('Action cancelled before transmission.');
      await this.port.change(name,data);if(!valid())throw new LiveFailure('Action interrupted after a request; check OBS.');
      await this.record(command,'acknowledged',name);
    };
    try{
      await this.record(command,'began','Operator action started.');await check();
      const phase=await executeLiveAction({workspace:w,reader,serviceId,permissions:()=>({...this.permissions}),check,change,verified:detail=>this.record(command,'verified',detail)},command,value);
      await check();await this.record(command,'completed','Requested action completed and read back.');
      if(!valid())throw new LiveFailure('Action was interrupted.');if(phase)this.phase=phase;
      if(command==='speaker'||command==='bible'){
        const expectedScene=w.bindings.scenes[command];this.returnAt=this.clock.now()+10000;
        this.timer=this.clock.set(()=>{void this.returnMain(token,expectedScene);},10000);
      }
      this.notice=command==='prepare'?'Preflight completed without changing OBS. Each feature has its own readiness check.':'Action confirmed by OBS. No automatic retry or rollback is scheduled.';
    }catch(error){
      this.lastError=safeLiveError(error);this.observed={...this.observed,checkedAt:null};this.release('Action stopped. Completed changes may remain in OBS. Review before enabling control again.');
      await this.record(command,'failed',this.lastError).catch(()=>{});throw new LiveFailure(this.lastError);
    }finally{this.expected.delete('stream');this.audioChanging=false;this.working=false;this.operation='';this.emit();}
  }
  private async returnMain(token:number,expectedScene:string):Promise<void>{
    if(token!==this.generation||this.working||!this.permissions.scenes)return;this.cancelTimer();
    try{await this.refresh();if(token!==this.generation||this.observed.program!==expectedScene||!this.permissions.scenes)return;await this.command('main');}
    catch{/* No retry or compensation. Any partial result remains in OBS. */}this.emit();
  }
}
