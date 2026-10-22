import {app,BrowserWindow,dialog,ipcMain,Menu,powerMonitor,protocol,session} from 'electron';
import type {IpcMainInvokeEvent} from 'electron';
import {readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {blankWorkspace} from './model.ts';
import type {Workspace} from './model.ts';
import {validateWorkspace,importWorkspace,suggestBindings,text} from './workspace.ts';
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
protocol.registerSchemesAsPrivileged([{scheme:'bcc',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let window:BrowserWindow|null=null,workspace:Workspace=blankWorkspace(),busy=false,quitting=false,companionResult='Not inspected';
const peer=new LiveObs();
const journal=new LiveJournal(()=>path.join(app.getPath('userData'),'logs','live-service.jsonl'));
const live=new LiveController(()=>workspace,peer,journal,emit);
const store=()=>path.join(app.getPath('userData'),'workspace.json');
function state():LiveSiteSnapshot{const snapshot=live.snapshot();return {version:app.getVersion(),workspace,live:{...snapshot,busy:busy||snapshot.busy},companionResult};}
function emit():void{if(window&&!window.isDestroyed())window.webContents.send('live:state',state());}
function sender(event:IpcMainInvokeEvent):void{
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame?.url!=='bcc://app/live.html')throw new LiveFailure('Untrusted request.');
}
function editable():void{if(live.authorized||live.busy)throw new LiveFailure('Release live control before changing configuration. OBS will remain untouched.');}
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
    const url=new URL(request.url),types:Record<string,string>={'/live.html':'text/html','/live-renderer.js':'text/javascript','/styles.css':'text/css','/live.css':'text/css'};
    if(url.host!=='app'||!types[url.pathname])return new Response('Not found',{status:404});
    const body=await readFile(path.join(__dirname,'renderer',url.pathname.slice(1)));
    return new Response(new Uint8Array(body),{headers:{'Content-Type':types[url.pathname]}});
  });
  session.defaultSession.setPermissionRequestHandler((_w,_p,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  try{workspace=await loadWorkspace(store());}catch{live.release('Saved workspace could not be read. It has not been overwritten; import a valid workspace.');}
  ipcMain.handle('live:site',event=>{sender(event);return state();});
  ipcMain.handle('live:snapshot',event=>{sender(event);return live.snapshot();});
  // These never wait behind a running OBS request or a native confirmation dialog.
  ipcMain.handle('live:release',event=>{sender(event);live.release();return live.snapshot();});
  ipcMain.handle('live:cancel-return',event=>{sender(event);live.cancelReturn();return live.snapshot();});
  handle('live:connect',async(password:unknown)=>{
    editable();if(typeof password!=='string'||password.length>512)throw new LiveFailure('Invalid password input.');
    await live.connect(password);
    try{const inventory=await inspectObs(peer);await save({...workspace,inventory});await live.refresh();}
    catch{live.release('Inspection did not complete. Observe only; no settings changed.');throw new LiveFailure('OBS connected but full inspection did not complete. Retry inspection; no settings were changed.');}
    return state();
  });
  handle('live:save',async(raw:unknown)=>{
    editable();let next:Workspace;try{next=validateWorkspace(raw);}catch{throw new LiveFailure('Workspace values are invalid. Check dates, names and local connection URLs.');}
    next.inventory=workspace.inventory;next.connections=workspace.connections;next.audioObservations=workspace.audioObservations;
    // Schedule commands use the latest main-process state, not a stale mapping draft.
    next.services=workspace.services;
    // Live permissions do not use or persist the legacy offline confirmation flags.
    next.bindings.confirmed=false;next.captions.confirmed=false;
    live.release('Configuration saved locally; enabling live control is a separate action.');
    if(next.obsUrl!==workspace.obsUrl)await live.disconnect();await save(next);await live.refresh();return state();
  });
  handle('live:services',async(change:unknown)=>{
    // Local schedule editing is independent of OBS transmission and live permissions.
    // The existing operation mutex serializes saves. A caption countdown is not a
    // configuration edit and is deliberately neither cancelled nor restarted here.
    const next=applyServiceChange(workspace,change,live.snapshot().selectedService);
    await save(next);return state();
  });
  handle('live:import',async()=>{
    editable();const pick=await dialog.showOpenDialog(window!,{title:'Import local workspace or discovery report',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});
    if(pick.canceled)return state();if((await stat(pick.filePaths[0])).size>8*1024*1024)throw new LiveFailure('Import limit is 8 MiB.');
    let next:Workspace;try{next=importWorkspace(JSON.parse(await readFile(pick.filePaths[0],'utf8')));}catch{throw new LiveFailure('Select a valid workspace or discovery JSON. No configuration was imported.');}
    await live.disconnect();await save(next);return state();
  });
  handle('live:export',async()=>exportText('broadcast-cc-workspace.json',JSON.stringify(validateWorkspace(workspace,true),null,2)+'\n','Export workspace without credentials or live authorization'));
  handle('live:companion',async()=>{
    editable();const pick=await dialog.showMessageBox(window!,{type:'question',buttons:['Cancel','Read local configuration'],defaultId:0,cancelId:0,message:'Inspect Companion without executing actions?',detail:'Only selected connection metadata is retained. Credentials and raw exports are not saved.'});
    if(pick.response!==1)return state();const result=await inspectCompanion(workspace.companionUrl);
    await save({...workspace,connections:result.connections});companionResult=`Companion ${result.build}: configuration read; device health is not verified.`;return state();
  });
  handle('live:enable',async(raw:unknown)=>{
    const permissions=normalizePermissions(raw),checked=await live.checkGrant(permissions),w=workspace;
    const summary=`Collection: ${checked.collection}\nProfile: ${checked.profile}\nScenes/captions: ${permissions.scenes?'ENABLED':'off'}\nService audio: ${permissions.audio?w.bindings.audioInput:'off'}\nOBS start/stop: ${permissions.stream?'ENABLED':'off'}\n\nScene mappings: ${Object.entries(w.bindings.scenes).map(([r,n])=>r+' = '+(n||'unmapped')).join('; ')}\nBible: ${w.bindings.bibleText||'unmapped'}\nNext service: ${w.bindings.nextServiceText||'unmapped'}\nReviewed speaker-name pool: ${w.captions.speakerPool.join(', ')||'not configured'}\n\nEnabling does not change any output. Commands after this can affect the actual broadcast. YouTube destination/event status is not independently verified. Missing features remain individually unavailable. Manual OBS/Stream Deck control remains available.`;
    const pick=await dialog.showMessageBox(window!,{type:'warning',buttons:['Cancel','Enable selected live controls'],defaultId:0,cancelId:0,message:'Enable live control of this OBS session?',detail:summary});
    if(pick.response===1)await live.grant(permissions,checked.ticket);return live.snapshot();
  });
  handle('live:select',async(id:unknown)=>{if(typeof id!=='string'||id.length>100)throw new LiveFailure('Invalid service selection.');live.selectService(id);return live.snapshot();});
  handle('live:phase',async(phase:unknown)=>{if(typeof phase!=='string')throw new LiveFailure('Choose a phase.');live.adoptPhase(phase as LivePhase);return live.snapshot();});
  handle('live:command',async(command:unknown,value:unknown)=>{
    if(typeof command!=='string'||!LIVE_COMMANDS.includes(command as LiveCommand)||(value!==undefined&&typeof value!=='string'))throw new LiveFailure('Invalid operator action.');
    if(['start','stop','outro'].includes(command)){
      const ticket=live.ticket(),s=live.snapshot(),reason=s.reasons[command as LiveCommand];if(reason.length)throw new LiveFailure(reason.join(' '));
      const message=command==='start'?'Start the configured OBS stream?':command==='stop'?'Stop OBS transmission now?':'Mute service audio and show Outro?';
      const detail=command==='start'?'This will mute the selected service input, put Intro on Program, then start the existing OBS destination. Verify the correct YouTube event in OBS/YouTube first; it may go public automatically.':command==='stop'?'This stops OBS transmission only. It does not show Outro or confirm that YouTube has ended the event. No automatic restart will be attempted.':'This mutes the selected OBS service input, updates next-service text and shows Outro. It does not stop transmission.';
      const pick=await dialog.showMessageBox(window!,{type:'warning',buttons:['Cancel',command==='start'?'Start OBS stream':command==='stop'?'Stop OBS stream':'Show Outro'],defaultId:0,cancelId:0,message,detail});
      if(pick.response!==1)return live.snapshot();if(ticket!==live.ticket())throw new LiveFailure('OBS or control state changed during confirmation. Review and try the intended action again.');
    }
    await live.command(command as LiveCommand,text(value,500));return live.snapshot();
  });
  handle('live:journal',async()=>journal.entries());
  handle('live:export-journal',async()=>exportText('broadcast-cc-live-log.json',JSON.stringify(await journal.entries(),null,2)+'\n','Export local activity log'));
  const advanced=()=>{live.release();app.relaunch({args:[...process.argv.slice(1).filter(a=>a!=='--bcc-advanced'),'--bcc-advanced']});app.quit();};
  handle('live:advanced',async()=>{advanced();});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:app.name,submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'View',submenu:[{role:'reload'},{role:'togglefullscreen'},{type:'separator'},{label:'Advanced offline rehearsal…',click:advanced}]}]));
  powerMonitor.on('suspend',()=>live.release('Mac suspended. Pending controls cancelled; no output shutdown was requested.'));
  window=new BrowserWindow({width:1280,height:900,minWidth:1024,minHeight:720,title:'Broadcast Control Center — Live Service Alpha',webPreferences:{preload:path.join(__dirname,'live-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.on('render-process-gone',()=>live.release('Interface closed unexpectedly. Pending actions cancelled; OBS left unchanged.'));
  window.webContents.on('did-start-loading',()=>live.release('Interface loading. Live permissions were cleared; OBS left unchanged.'));
  window.on('closed',()=>{window=null;live.release();});await window.loadURL('bcc://app/live.html');
});
app.on('before-quit',event=>{
  if(quitting)return;event.preventDefault();quitting=true;live.release('Application closing. Pending actions cancelled; OBS left unchanged.');
  void Promise.allSettled([live.disconnect(),journal.entries()]).then(()=>app.exit(0));
});
app.on('window-all-closed',()=>app.quit());
