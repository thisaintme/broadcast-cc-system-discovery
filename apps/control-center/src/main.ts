import {app,BrowserWindow,dialog,ipcMain,protocol,session} from 'electron';
import type {IpcMainInvokeEvent} from 'electron';
import path from 'node:path';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {blankWorkspace} from './model.ts';
import type {Workspace,Snapshot,Mode} from './model.ts';
import {validateWorkspace,importWorkspace,text,selectService,suggestBindings} from './workspace.ts';
import {inspectObs} from './inspect.ts';
import {inspectCompanion} from './companion.ts';
import {ObsAdapter} from './obs.ts';
import {Rehearsal} from './rehearsal.ts';
import {loadWorkspace,saveWorkspace} from './storage.ts';

protocol.registerSchemesAsPrivileged([{scheme:'bcc',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let window:BrowserWindow|null=null;
let workspace:Workspace=blankWorkspace();
let busy=false, companionResult='Not checked';
const obs=new ObsAdapter();
const rehearsal=new Rehearsal(()=>workspace,obs,emit);
const state=():Snapshot=>({version:app.getVersion(),workspace,runtime:{...rehearsal.runtime,busy:busy || rehearsal.runtime.busy},transport:obs.state(),companionResult});
function emit():void {if(window && !window.isDestroyed())window.webContents.send('cc:state',state());}
const store=()=>path.join(app.getPath('userData'),'workspace.json');
obs.onState=emit;
obs.onUnsafe=reason=>{if(rehearsal.runtime.mode==='obs-preview')rehearsal.interrupt(reason);};
function validSender(event:IpcMainInvokeEvent):void {
  if(!window || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame || event.senderFrame?.url!=='bcc://app/index.html')
    throw new Error('Untrusted request.');
}
function editable():void {
  if(rehearsal.runtime.mode!=='simulation' || rehearsal.runtime.phase!=='idle')throw new Error('Reset to simulation before changing setup.');
}
function handle(name:string,action:(...args:any[])=>Promise<unknown>):void {
  ipcMain.handle(name,async(event,...args)=>{
    validSender(event);
    if(busy)throw new Error('Setup is already busy.');
    busy=true;emit();
    try{return await action(...args);}finally{busy=false;emit();}
  });
}
async function importFile():Promise<Snapshot> {
  editable();
  const pick=await dialog.showOpenDialog(window!,{title:'Import discovery report or site profile',properties:['openFile'],filters:[{name:'JSON configuration',extensions:['json']}]});
  if(pick.canceled)return state();
  if((await stat(pick.filePaths[0])).size>8*1024*1024)throw new Error('Import limit is 8 MiB.');
  let raw:unknown;
  try{raw=JSON.parse(await readFile(pick.filePaths[0],'utf8'));}catch{throw new Error('The selected file is not valid JSON.');}
  const next=importWorkspace(raw);
  await saveWorkspace(store(),next);
  await obs.disconnect();
  workspace=next;companionResult='Imported configuration only; device health unknown';
  rehearsal.runtime.selectedService=selectService(workspace);
  rehearsal.interrupt('Profile imported locally. Inspect OBS and confirm scene mappings.');
  return state();
}
app.whenReady().then(async()=>{
  // Serve only bundled resources. No arbitrary paths, renderer networking, or external navigation.
  protocol.handle('bcc',async(request)=>{
    const url=new URL(request.url);
    const files:Record<string,string>={'/index.html':'text/html','/renderer.js':'text/javascript','/styles.css':'text/css'};
    if(url.host!=='app' || !files[url.pathname])return new Response('Not found',{status:404});
    const body=await readFile(path.join(__dirname,'renderer',url.pathname.slice(1)));
    return new Response(new Uint8Array(body),{headers:{'Content-Type':files[url.pathname]}});
  });
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  try{workspace=await loadWorkspace(store());}catch{rehearsal.log('Saved workspace could not be read. It has not been overwritten. Import a valid workspace to recover.');}
  rehearsal.runtime.selectedService=selectService(workspace);
  ipcMain.handle('cc:snapshot',event=>{validSender(event);return state();});
  handle('cc:import',importFile);
  handle('cc:save-workspace',async(raw:unknown)=>{
    editable();const next=validateWorkspace(raw);
    // The renderer may edit bindings and schedule, not forge inspected inventory or connection health.
    next.inventory=workspace.inventory;next.connections=workspace.connections;
    if(next.obsUrl!==workspace.obsUrl){await obs.disconnect();next.bindings.confirmed=false;}
    await saveWorkspace(store(),next);workspace=next;
    if(!workspace.services.some(s=>s.id===rehearsal.runtime.selectedService))rehearsal.runtime.selectedService=selectService(workspace);
    rehearsal.log('Local setup and schedule saved.');return state();
  });
  handle('cc:inspect',async(password:unknown)=>{
    editable();if(typeof password!=='string' || password.length>512)throw new Error('Invalid password input.');
    await obs.connect(workspace.obsUrl,password);
    const result=await inspectObs(obs);
    workspace.inventory=result;
    if(!Object.values(workspace.bindings.scenes).some(Boolean))workspace.bindings=suggestBindings(result);
    workspace.bindings.confirmed=false;
    await saveWorkspace(store(),workspace);
    rehearsal.log('OBS inspected: nested scenes, groups and audio state captured. No settings changed.');return state();
  });
  handle('cc:companion',async()=>{
    editable();
    const consent=await dialog.showMessageBox(window!,{type:'question',buttons:['Cancel','Inspect locally'],defaultId:0,cancelId:0,
      message:'Read Companion configuration?',detail:'This reads the local full-export endpoint. Raw bytes may contain credentials and are processed only in memory; only allowlisted connection metadata is retained. No buttons are pressed.'});
    if(consent.response!==1)return state();
    const result=await inspectCompanion(workspace.companionUrl);
    workspace.connections=result.connections;companionResult=`Companion ${result.build}: export read. Device health remains unknown.`;
    await saveWorkspace(store(),workspace);rehearsal.log('Companion configuration inspected without operating hardware.');return state();
  });
  handle('cc:mode',async(mode:Mode)=>{
    if(!['simulation','obs-preview'].includes(mode))throw new Error('Unknown mode.');
    if(mode==='obs-preview'){
      if(workspace.inventory?.origin!=='live')throw new Error('Inspect OBS in this session before arming Preview rehearsal.');
      await obs.refresh();
      const consent=await dialog.showMessageBox(window!,{type:'warning',buttons:['Cancel','Enable OBS Preview rehearsal'],defaultId:0,cancelId:0,
        message:'Allow changes to OBS Preview?',detail:'Use only outside a service. OBS must be in Studio Mode with streaming, recording, replay buffer and virtual camera off. Buttons select Preview scenes, including timed returns. Program, audio, source text and hardware are not changed. External automation can still transition Preview to Program; disable it for this test.'});
      if(consent.response!==1)return state();
    }
    await rehearsal.setMode(mode);return state();
  });
  handle('cc:command',async(command:unknown,value:unknown)=>{
    if(typeof command!=='string' || (value!==undefined && typeof value!=='string'))throw new Error('Invalid command.');
    await rehearsal.command(command,text(value,500));return state();
  });
  handle('cc:export',async()=>{
    const pick=await dialog.showSaveDialog(window!,{title:'Export local workspace (contains site names and addresses)',defaultPath:'broadcast-cc-workspace.json',filters:[{name:'JSON',extensions:['json']}]});
    if(pick.canceled || !pick.filePath)return 'Export cancelled.';
    await writeFile(pick.filePath,JSON.stringify(validateWorkspace(workspace),null,2)+'\n',{encoding:'utf8',mode:0o600});
    return 'Workspace exported. Review site names and network addresses before sharing.';
  });
  createWindow();
  app.on('activate',()=>{if(!window)createWindow();});
});
function createWindow():void {
  window=new BrowserWindow({width:1220,height:860,minWidth:1000,minHeight:700,title:'Broadcast Control Center Preview',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.on('closed',()=>{window=null;rehearsal.interrupt('Window closed: rehearsal disarmed without output changes.');void obs.disconnect();});
  void window.loadURL('bcc://app/index.html');
}
app.on('before-quit',()=>{rehearsal.cancel();void obs.disconnect();});
app.on('window-all-closed',()=>app.quit());
