import {SCENE_LABELS} from './v107-model.ts';
import {ObsCredentialVault} from './obs-credentials.ts';
import {YouTubeSecretFile} from './youtube-storage.ts';
import {DeskCueStore} from './desk-cues.ts';
import {ProgramMonitor} from './program-monitor.ts';
import {app,BrowserWindow,dialog,ipcMain,Menu,powerMonitor,protocol,session,safeStorage} from 'electron';
import type {IpcMainInvokeEvent} from 'electron';
import {readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {blankWorkspace} from './model.ts';
import type {Workspace} from './model.ts';
import {validateWorkspace,importWorkspace,text} from './workspace.ts';
import {inspectObs} from './inspect.ts';
import {inspectCompanion} from './companion.ts';
import {loadWorkspace,saveWorkspace} from './storage.ts';
import {LiveObs} from './live-obs.ts';
import {LiveController} from './live-controller.ts';
import {LiveJournal} from './live-journal.ts';
import {LiveFailure,LIVE_COMMANDS,normalizePermissions,safeLiveError} from './live-contract.ts';
import type {LiveCommand,LivePhase} from './live-contract.ts';
import type {LiveSiteSnapshot} from './live-app.ts';
import {applyServiceChange} from './live-schedule.ts';
import {parseOperatorAction,describeOperatorAction} from './obs-operator.ts';
import {YouTubeManager} from './youtube-main.ts';
import {youtubeError} from './youtube-model.ts';
protocol.registerSchemesAsPrivileged([{scheme:'bcc',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let window:BrowserWindow|null=null,workspace:Workspace=blankWorkspace(),busy=false,quitting=false,companionResult='Nicht geprüft';
let youtube:YouTubeManager|null=null;
let credentials:ObsCredentialVault|null=null,cues:DeskCueStore|null=null,reconnectTimer:ReturnType<typeof setInterval>|null=null,suspended=false;
const peer=new LiveObs();
const journal=new LiveJournal(()=>path.join(app.getPath('userData'),'logs','live-service.jsonl'));
const live=new LiveController(()=>workspace,peer,journal,emit);
const store=()=>path.join(app.getPath('userData'),'workspace.json');
function state():LiveSiteSnapshot{const snapshot=live.snapshot();return {version:app.getVersion(),workspace,end:youtube?.endState(),broadcast:youtube?.deskStatus(),credentials:credentials?.status(),cues:cues?.snapshot(snapshot.selectedService),live:{...snapshot,busy:busy||snapshot.busy},companionResult};}
function emit():void{youtube?.checkEnd();if(window&&!window.isDestroyed())window.webContents.send('live:state',state());youtube?.emit();}
function sender(event:IpcMainInvokeEvent):void{
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame?.url!=='bcc://app/live.html')throw new LiveFailure('Untrusted request.');
}
function editable():void{if(live.authorized||live.busy)throw new LiveFailure('Release live control before changing configuration. OBS will remain untouched.');}
async function exclusive<T>(action:()=>Promise<T>):Promise<T>{
  if(busy||live.busy)throw new LiveFailure('An operation is already in progress. Release control remains available.');
  busy=true;emit();try{return await action();}finally{busy=false;emit();}
}
function handle(name:string,action:(...args:any[])=>Promise<unknown>):void{
  ipcMain.handle(name,async(event,...args)=>{
    sender(event);if(busy||live.busy)throw new Error('An operation is already in progress. Release control remains available.');busy=true;emit();
    try{return await action(...args);}catch(e){throw new Error(safeLiveError(e));}finally{busy=false;emit();}
  });
}
async function save(next:Workspace):Promise<void>{try{await saveWorkspace(store(),next);}catch{throw new LiveFailure('The local workspace could not be saved. Existing OBS state was not changed.');}workspace=next;emit();}
async function exportText(defaultPath:string,content:string,title:string):Promise<string>{
  const pick=await dialog.showSaveDialog(window!,{title,defaultPath,filters:[{name:'JSON',extensions:['json']}]});
  if(pick.canceled||!pick.filePath)return 'Export cancelled.';
  await writeFile(pick.filePath,content,{encoding:'utf8',mode:0o600});return 'Export saved. Review private site names before sharing.';
}
app.whenReady().then(async()=>{
  protocol.handle('bcc',async request=>{
    const url=new URL(request.url),types:Record<string,string>={'/live.html':'text/html','/live-renderer.js':'text/javascript','/youtube.html':'text/html','/youtube-renderer.js':'text/javascript','/stream-management.html':'text/html','/stream-management-renderer.js':'text/javascript','/stream-management.css':'text/css','/desk-tokens.css':'text/css','/styles.css':'text/css','/live.css':'text/css','/konzept-b.css':'text/css','/v107.css':'text/css'};
    if(url.host!=='app'||!types[url.pathname])return new Response('Not found',{status:404});
    const body=await readFile(path.join(__dirname,'renderer',url.pathname.slice(1)));
    return new Response(new Uint8Array(body),{headers:{'Content-Type':types[url.pathname]}});
  });
  session.defaultSession.setPermissionRequestHandler((_w,_p,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  try{workspace=await loadWorkspace(store());}catch{live.release('Saved workspace could not be read. It has not been overwritten; import a valid workspace.');}
  const encrypted=()=>safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text');
  credentials=new ObsCredentialVault(new YouTubeSecretFile(path.join(app.getPath('userData'),'credentials','obs.enc'),{available:encrypted,encrypt:v=>safeStorage.encryptString(v),decrypt:v=>safeStorage.decryptString(v)}),encrypted);
  await credentials.load();
  cues=new DeskCueStore(path.join(app.getPath('userData'),'desk-cues.json'));
  try{await cues.load();}catch{live.release('Das lokale Bibelstellen-Protokoll ist nicht lesbar. Die Datei wurde nicht überschrieben.');}
  const monitor=new ProgramMonitor(peer,()=>workspace,()=>live.snapshot().observation.program,()=>busy||live.busy);
  ipcMain.handle('live:monitor',async(event,slot)=>{sender(event);return monitor.frame(slot);});
  // Loading saved grants and refreshing tokens is read-only. No Google login opens automatically.
  youtube=new YouTubeManager({workspace:()=>workspace,parent:()=>window,live,peer,journal,exclusive,notify:emit,saveService:async service=>{
    await exclusive(async()=>{
      const previous=workspace.services.find(s=>s.id===service.id);
      if(previous&&previous.title===service.title&&previous.startsAt===service.startsAt)return;
      if(previous&&live.snapshot().selectedService===service.id)throw new LiveFailure('The selected operator service cannot be changed. Select another service before updating its schedule.');
      let next=workspace;
      if(previous)next=applyServiceChange(next,{type:'remove',id:service.id},live.snapshot().selectedService);
      next=applyServiceChange(next,{type:'add',service},live.snapshot().selectedService);await save(next);
    });
  }});
  // Fixed, read-only navigation from the trusted desk; no encoder or account action.
  ipcMain.handle('live:open-stream-management',async event=>{
    sender(event);
    if(!youtube)throw new Error('YouTube-Planung ist noch nicht bereit.');
    try{await youtube.open();}catch{throw new Error('YouTube-Planung konnte nicht geöffnet werden. Versuchen Sie es nach der laufenden Aktion erneut.');}
  });
  ipcMain.handle('live:broadcast',async(event,kind)=>{sender(event);if(!youtube)throw new Error('YouTube noch nicht bereit.');await youtube.runDesk(kind);});
  ipcMain.handle('live:schedule-end',async(event,scope)=>{sender(event);if(!youtube)throw new Error('YouTube noch nicht bereit.');await youtube.scheduleEnd(scope);});
  ipcMain.handle('live:cancel-end',event=>{sender(event);youtube?.cancel();emit();});
  ipcMain.handle('live:site',event=>{sender(event);return state();});
  ipcMain.handle('live:snapshot',event=>{sender(event);return live.snapshot();});
  // Release/cancel never wait behind a device request, Google request or a native dialog.
  ipcMain.handle('live:release',event=>{sender(event);youtube?.cancel();live.release();return live.snapshot();});
  ipcMain.handle('live:cancel-return',event=>{sender(event);live.cancelReturn();return live.snapshot();});
  ipcMain.handle('live:operator-data',async(event,query:unknown)=>{
    sender(event);if(busy||live.busy)throw new Error('An action is in progress; operator status will refresh afterwards.');
    try{return await live.operatorData(query);}catch(e){throw new Error(safeLiveError(e));}
  });
  handle('live:connect',async(password:unknown)=>{
    editable();if(typeof password!=='string'||password.length>512)throw new LiveFailure('Invalid password input.');
    youtube?.cancel();await connectAndInspect(password);return state();
  });
  async function connectAndInspect(password:string):Promise<void>{
    await live.connect(password);
    try{const inventory=await inspectObs(peer);await save({...workspace,inventory});await live.refresh();}
    catch{live.release('Inspection did not complete. Observe only; no settings changed.');throw new LiveFailure('OBS connected but full inspection did not complete. Retry inspection; no settings were changed.');}
  }
  handle('live:save-credential',async(password:unknown,automatic:unknown)=>{editable();await credentials!.save(workspace.obsUrl,password,automatic);return state();});
  handle('live:forget-credential',async()=>{
    const pick=await dialog.showMessageBox(window!,{type:'warning',message:'Gespeicherten OBS-Zugang entfernen?',detail:'Nur die Zugangsdaten auf diesem Mac werden entfernt. OBS und eine laufende Übertragung bleiben unverändert.',buttons:['Abbrechen','Zugang entfernen'],defaultId:0,cancelId:0});
    if(pick.response===1)await credentials!.forget();return state();
  });
  handle('live:connect-saved',async()=>{editable();await credentials!.load();const password=credentials!.passwordFor(workspace.obsUrl);if(password===null)throw new LiveFailure('Für diese OBS-Adresse ist kein entsperrter Zugang gespeichert.');youtube?.cancel();await connectAndInspect(password);return state();});
  handle('live:cue',async(change:unknown)=>{await cues!.change(live.snapshot().selectedService,change,workspace.speakers);return state();});
  const reconnect=async()=>{
    if(quitting||suspended||!window||window.isDestroyed()||busy||live.busy||live.authorized||live.snapshot().connected||youtube?.busy)return;
    const password=credentials!.passwordFor(workspace.obsUrl,true);if(password===null)return;
    try{await exclusive(()=>connectAndInspect(password));}catch{/* Sanitized connection status is already reported by the controller. Never start output. */}
  };

  handle('live:save',async(raw:unknown)=>{
    editable();let next:Workspace;try{next=validateWorkspace(raw);}catch{throw new LiveFailure('Workspace values are invalid. Check dates, names and local connection URLs.');}
    next.inventory=workspace.inventory;next.connections=workspace.connections;next.audioObservations=workspace.audioObservations;
    next.services=workspace.services;next.bindings.confirmed=false;next.captions.confirmed=false;
    youtube?.cancel();live.release('Configuration saved locally; enabling live control is a separate action.');
    if(next.obsUrl!==workspace.obsUrl)await live.disconnect();await save(next);await live.refresh();return state();
  });
  handle('live:services',async(change:unknown)=>{
    const next=applyServiceChange(workspace,change,live.snapshot().selectedService);await save(next);return state();
  });
  handle('live:import',async()=>{
    editable();const pick=await dialog.showOpenDialog(window!,{title:'Import local workspace or discovery report',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});
    if(pick.canceled)return state();if((await stat(pick.filePaths[0])).size>8*1024*1024)throw new LiveFailure('Import limit is 8 MiB.');
    let next:Workspace;try{next=importWorkspace(JSON.parse(await readFile(pick.filePaths[0],'utf8')));}catch{throw new LiveFailure('Select a valid workspace or discovery JSON. No configuration was imported.');}
    youtube?.cancel();await live.disconnect();await save(next);return state();
  });
  handle('live:export',async()=>exportText('broadcast-cc-workspace.json',JSON.stringify(validateWorkspace(workspace,true),null,2)+'\n','Export workspace without credentials or live authorization'));
  handle('live:companion',async()=>{
    editable();const pick=await dialog.showMessageBox(window!,{type:'question',buttons:['Abbrechen','Lokale Konfiguration lesen'],defaultId:0,cancelId:0,message:'Companion-Konfiguration prüfen?',detail:'Nur ausgewählte Verbindungsdaten werden übernommen. Zugangsdaten und Rohdaten werden nicht gespeichert.'});
    if(pick.response!==1)return state();const result=await inspectCompanion(workspace.companionUrl);
    await save({...workspace,connections:result.connections});companionResult=`Companion ${result.build}: Konfiguration gelesen; Gerätezustand nicht bestätigt.`;return state();
  });
  handle('live:enable',async(raw:unknown)=>{
    const permissions=normalizePermissions(raw),checked=await live.checkGrant(permissions),w=workspace;
    const summary=`Sammlung: ${checked.collection}\nProfil: ${checked.profile}\nSzenen und Einblendungen: ${permissions.scenes?'freigegeben':'aus'}\nSendeton: ${permissions.audio?w.bindings.audioInput:'aus'}\nOBS starten / beenden: ${permissions.stream?'freigegeben':'aus'}\nErweitertes OBS-Pult: ${permissions.operator?'freigegeben — Bildwahl, Tonpegel, Quellen, Medien und Aufnahme benötigen jeweils eine Bestätigung.':'aus'}\n\nSzenen: ${Object.entries(w.bindings.scenes).map(([r,n])=>((SCENE_LABELS as Record<string,string>)[r]||r)+' = '+(n||'nicht zugeordnet')).join('; ')}\nÜberblenden: ${(w.transitionMs??900)/1000} Sekunden. Die App prüft die Überblendung und setzt bei Bedarf eine OBS-Übergangsüberschreibung für die Zielszene.\nBibelstelle: ${w.bindings.bibleText||'nicht zugeordnet'}\nFolgetermin: ${w.bindings.nextServiceText||'nicht zugeordnet'}\nSprecherquellen: ${w.captions.speakerPool.join(', ')||'nicht eingerichtet'}\n\nDie Freigabe verändert noch keine Ausgabe. Danach können Aktionen die laufende Übertragung verändern. OBS-Steuerung bestätigt keine YouTube-Veröffentlichung. Fehlende Zuordnungen sperren nur betroffene Aktionen. OBS und Stream Deck bleiben unabhängig bedienbar.`;
    const pick=await dialog.showMessageBox(window!,{type:'warning',buttons:['Abbrechen','Ausgewählte Steuerung freigeben'],defaultId:0,cancelId:0,message:'Steuerung für diese OBS-Sitzung freigeben?',detail:summary});
    if(pick.response===1)await live.grant(permissions,checked.ticket);return live.snapshot();
  });
  handle('live:select',async(id:unknown)=>{if(typeof id!=='string'||id.length>100)throw new LiveFailure('Invalid service selection.');live.selectService(id);return live.snapshot();});
  handle('live:phase',async(phase:unknown)=>{if(typeof phase!=='string')throw new LiveFailure('Choose a phase.');live.adoptPhase(phase as LivePhase);return live.snapshot();});
  handle('live:command',async(command:unknown,value:unknown)=>{
    if(typeof command!=='string'||!LIVE_COMMANDS.includes(command as LiveCommand)||(value!==undefined&&typeof value!=='string'))throw new LiveFailure('Invalid operator action.');
    if(command==='operator'){
      const action=parseOperatorAction(value),ticket=live.ticket(),s=live.snapshot(),reasons=s.reasons.operator;
      if(reasons.length)throw new LiveFailure(reasons.join(' '));
      if(action.collection!==s.observation.collection||action.profile!==s.observation.profile)throw new LiveFailure('OBS target changed. Refresh the operator panel.');
      const pick=await dialog.showMessageBox(window!,{type:'warning',buttons:['Cancel','Apply OBS operator action'],defaultId:0,cancelId:0,message:'Apply this OBS operator action?',detail:`Collection: ${action.collection}\nProfile: ${action.profile}\n\n${describeOperatorAction(action)}\n\nThis is a real OBS action. It cancels any pending automatic caption return after confirmation. It does not change stream keys or YouTube events. Keep manual OBS control available.`});
      if(pick.response!==1)return live.snapshot();if(ticket!==live.ticket())throw new LiveFailure('OBS or pending automation changed during confirmation. Refresh and review again.');
      await live.command('operator',JSON.stringify(action));return live.snapshot();
    }
    if(['start','stop','outro'].includes(command)){
      const ticket=live.ticket(),s=live.snapshot(),reason=s.reasons[command as LiveCommand];if(reason.length)throw new LiveFailure(reason.join(' '));
      const message=command==='start'?'Eingerichtete OBS-Übertragung starten?':command==='stop'?'OBS-Übertragung jetzt beenden?':'Sendeton ausschalten und Outro zeigen?';
      const detail=command==='start'?'Schaltet den Sendeton aus, zeigt Intro und startet das in OBS eingerichtete Ziel. Ein verwalteter YouTube-Termin wird dabei nicht veröffentlicht. Nutzen Sie dafür „Deutsch mit Intro starten“.':command==='stop'?'Beendet nur die OBS-Übertragung. Ein verwaltetes YouTube-Event bleibt unverändert. Für den gemeinsamen Abschluss nutzen Sie „Beenden“. Es erfolgt kein automatischer Neustart.':'Schaltet den Sendeton aus, aktualisiert den Folgetermin und zeigt Outro. Die Übertragung läuft weiter.';
      const pick=await dialog.showMessageBox(window!,{type:'warning',buttons:['Abbrechen',command==='start'?'OBS-Übertragung starten':command==='stop'?'OBS-Übertragung beenden':'Outro zeigen'],defaultId:0,cancelId:0,message,detail});
      if(pick.response!==1)return live.snapshot();if(ticket!==live.ticket())throw new LiveFailure('OBS or control state changed during confirmation. Review and try the intended action again.');
    }
    const service=live.snapshot().selectedService,deck=cues!.snapshot(service),entry=deck.entries.find(e=>e.id===deck.selected);
    await live.command(command as LiveCommand,text(value,500));
    if(command==='bible'&&entry&&entry.reference===text(value,500).trim())await cues!.shown(service,entry.id);
    return live.snapshot();
  });
  handle('live:journal',async()=>journal.entries());
  handle('live:export-journal',async()=>exportText('broadcast-cc-live-log.json',JSON.stringify(await journal.entries(),null,2)+'\n','Export local activity log'));
  const advanced=()=>{youtube?.cancel();live.release();app.relaunch({args:[...process.argv.slice(1).filter(a=>a!=='--bcc-advanced'),'--bcc-advanced']});app.quit();};
  handle('live:advanced',async()=>{advanced();});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:app.name,submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'YouTube',submenu:[{label:'Stream Management…',click:()=>{void youtube?.open().catch(e=>dialog.showErrorBox('YouTube manager',youtubeError(e)));}}]},{label:'View',submenu:[{role:'reload'},{role:'togglefullscreen'},{type:'separator'},{label:'Advanced offline rehearsal…',click:advanced}]}]));
  powerMonitor.on('resume',()=>{suspended=false;void reconnect();});
  powerMonitor.on('suspend',()=>{suspended=true;youtube?.cancel();live.release('Mac suspended. Pending controls cancelled; no output shutdown was requested.');});
  window=new BrowserWindow({width:1280,height:900,minWidth:1024,minHeight:720,title:'Broadcast Control Center — Live Service Alpha',webPreferences:{preload:path.join(__dirname,'live-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.on('render-process-gone',()=>{youtube?.cancel();live.release('Interface closed unexpectedly. Pending actions cancelled; OBS left unchanged.');});
  window.webContents.on('did-start-loading',()=>{youtube?.cancel();live.release('Interface loading. Live permissions were cleared; OBS left unchanged.');});
  window.on('closed',()=>{youtube?.close();window=null;live.release();});await window.loadURL('bcc://app/live.html');
  void youtube.initialize().then(()=>youtube?.observe()).catch(()=>{});
  void reconnect();reconnectTimer=setInterval(()=>{if(!suspended&&!quitting){void reconnect();void youtube?.observe();}},15000);reconnectTimer.unref();
});
app.on('before-quit',event=>{
  if(quitting)return;event.preventDefault();quitting=true;if(reconnectTimer)clearInterval(reconnectTimer);youtube?.cancel();live.release('Application closing. Pending actions cancelled; OBS left unchanged.');
  void Promise.allSettled([live.disconnect(),journal.entries()]).then(()=>app.exit(0));
});
app.on('window-all-closed',()=>app.quit());
