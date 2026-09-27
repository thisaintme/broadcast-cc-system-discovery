import {app,BrowserWindow,dialog,ipcMain,protocol,session} from 'electron';
import type {IpcMainInvokeEvent} from 'electron';
import path from 'node:path';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {blankWorkspace} from './model.ts';
import type {Workspace,Snapshot,Mode} from './model.ts';
import {validateWorkspace,importWorkspace,text,selectService,suggestBindings} from './workspace.ts';
import {normalizeAudioObservations} from './audio-model.ts';
import {inspectObs} from './inspect.ts';
import {assertOfflineSafe} from './offline.ts';
import {inspectCompanion} from './companion.ts';
import {ObsAdapter} from './obs.ts';
import {Rehearsal} from './rehearsal.ts';
import {loadWorkspace,saveWorkspace} from './storage.ts';

protocol.registerSchemesAsPrivileged([{scheme:'bcc',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let window:BrowserWindow|null=null;
let workspace:Workspace=blankWorkspace();
let busy=false,companionResult='Not checked';
const obs=new ObsAdapter(),rehearsal=new Rehearsal(()=>workspace,obs,emit);
const state=():Snapshot=>({version:app.getVersion(),workspace,runtime:{...rehearsal.runtime,busy:busy||rehearsal.runtime.busy},transport:obs.state(),companionResult});
function emit():void{if(window&&!window.isDestroyed())window.webContents.send('cc:state',state());}
const store=()=>path.join(app.getPath('userData'),'workspace.json');
obs.onState=emit;
// Meter samples have a separate bounded-rate channel, never repeated full workspace snapshots.
obs.audio.onUpdate=()=>{if(window&&!window.isDestroyed())window.webContents.send('cc:audio',obs.audio.snapshot());};
obs.onUnsafe=reason=>{
  if(rehearsal.runtime.mode!=='simulation'){
    workspace.bindings.confirmed=false;workspace.captions.confirmed=false;rehearsal.interrupt(reason);
  }
};
function validSender(event:IpcMainInvokeEvent):void{
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame?.url!=='bcc://app/index.html')throw new Error('Untrusted request.');
}
function editable():void{
  if(rehearsal.runtime.mode!=='simulation'||rehearsal.runtime.phase!=='idle'||rehearsal.runtime.busy)throw new Error('Reset to simulation before changing setup.');
}
function handle(name:string,action:(...args:any[])=>Promise<unknown>):void{
  ipcMain.handle(name,async(event,...args)=>{
    validSender(event);
    if(name==='cc:command'&&args[0]==='reset'){
      await rehearsal.command('reset');return state();
    }
    // Stopping read-only observation is available even during an outstanding read.
    if(name==='cc:audio-control'&&args[0]==='stop'){await obs.audio.stop();return obs.audio.snapshot();}
    if(busy)throw new Error('Setup is already busy.');busy=true;emit();
    try{return await action(...args);}finally{busy=false;emit();}
  });
}
async function importFile():Promise<Snapshot>{
  editable();
  const pick=await dialog.showOpenDialog(window!,{title:'Import discovery report or site profile',properties:['openFile'],filters:[{name:'JSON configuration',extensions:['json']}]});
  if(pick.canceled)return state();
  if((await stat(pick.filePaths[0])).size>8*1024*1024)throw new Error('Import limit is 8 MiB.');
  let raw:unknown;try{raw=JSON.parse(await readFile(pick.filePaths[0],'utf8'));}catch{throw new Error('The selected file is not valid JSON.');}
  const next=importWorkspace(raw);await saveWorkspace(store(),next);await obs.disconnect();workspace=next;
  companionResult='Imported configuration only; device health unknown';rehearsal.runtime.selectedService=selectService(workspace);
  rehearsal.interrupt('Profile imported locally. Inspect OBS and confirm mappings.');return state();
}
app.whenReady().then(async()=>{
  protocol.handle('bcc',async(request)=>{
    const url=new URL(request.url),files:Record<string,string>={'/index.html':'text/html','/renderer.js':'text/javascript','/styles.css':'text/css','/audio.css':'text/css'};
    if(url.host!=='app'||!files[url.pathname])return new Response('Not found',{status:404});
    const body=await readFile(path.join(__dirname,'renderer',url.pathname.slice(1)));
    return new Response(new Uint8Array(body),{headers:{'Content-Type':files[url.pathname]}});
  });
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  try{workspace=await loadWorkspace(store());}catch{rehearsal.log('Saved workspace could not be read. It has not been overwritten. Import a valid workspace to recover.');}
  rehearsal.runtime.selectedService=selectService(workspace);
  ipcMain.handle('cc:snapshot',event=>{validSender(event);return state();});
  ipcMain.handle('cc:audio-snapshot',event=>{validSender(event);return obs.audio.snapshot();});
  handle('cc:audio-control',async(action:unknown)=>{
    if(action!=='start')throw new Error('Unknown audio observation action.');
    editable();await obs.audio.start();rehearsal.log('Read-only audio observation started. No audio settings changed.');return obs.audio.snapshot();
  });
  handle('cc:audio-note',async(raw:unknown)=>{
    editable();const note=normalizeAudioObservations([raw])[0],audio=obs.audio.snapshot();
    if(!note||!audio.connected||note.collection!==audio.collection||!audio.rows.some(r=>r.name===note.inputName))throw new Error('Start audio observation for this input before saving a routing note.');
    note.updatedAt=new Date().toISOString();
    const notes=workspace.audioObservations.filter(n=>n.collection!==note.collection||n.inputName!==note.inputName);
    const next={...workspace,audioObservations:normalizeAudioObservations([...notes,note])};
    await saveWorkspace(store(),next);workspace=next;
    rehearsal.log('Operator audio observation saved locally. Routing and control remain unverified.');return state();
  });
  handle('cc:import',importFile);
  handle('cc:save-workspace',async(raw:unknown)=>{
    editable();const next=validateWorkspace(raw);
    next.inventory=workspace.inventory;next.connections=workspace.connections;
    // Audio notes have their own explicit save action; other edits cannot overwrite a newer note.
    next.audioObservations=workspace.audioObservations;
    if(next.obsUrl!==workspace.obsUrl){await obs.disconnect();next.bindings.confirmed=false;next.captions.confirmed=false;}
    if(next.captions.confirmed&&(next.inventory?.origin!=='live'||next.captions.testCollection!==next.inventory.collection))throw new Error('Inspect the selected test collection before confirming captions.');
    await saveWorkspace(store(),next);workspace=next;
    if(!workspace.services.some(s=>s.id===rehearsal.runtime.selectedService))rehearsal.runtime.selectedService=selectService(workspace);
    rehearsal.log('Local setup and schedule saved.');return state();
  });
  handle('cc:inspect',async(password:unknown)=>{
    editable();if(typeof password!=='string'||password.length>512)throw new Error('Invalid password input.');
    workspace.bindings.confirmed=false;workspace.captions.confirmed=false;
    await obs.connect(workspace.obsUrl,password);
    const result=await inspectObs(obs);workspace.inventory=result;
    if(!Object.values(workspace.bindings.scenes).some(Boolean))workspace.bindings=suggestBindings(result);
    await saveWorkspace(store(),workspace);
    rehearsal.log('OBS inspected: nested scenes, groups and audio snapshot captured. No settings changed.');return state();
  });
  handle('cc:companion',async()=>{
    editable();
    const consent=await dialog.showMessageBox(window!,{type:'question',buttons:['Cancel','Inspect locally'],defaultId:0,cancelId:0,message:'Read Companion configuration?',detail:'The local full export is processed in memory. Only selected connection metadata is retained. No buttons are pressed.'});
    if(consent.response!==1)return state();
    const result=await inspectCompanion(workspace.companionUrl);workspace.connections=result.connections;
    companionResult=`Companion ${result.build}: export read. Device health remains unknown.`;
    await saveWorkspace(store(),workspace);rehearsal.log('Companion inspected without operating hardware.');return state();
  });
  handle('cc:mode',async(mode:Mode)=>{
    if(!['simulation','obs-preview','offline-program'].includes(mode))throw new Error('Unknown mode.');
    if(mode!=='simulation'){
      editable();await obs.audio.stop('Meters stopped before rehearsal. No audio setting changed.');
      if(workspace.inventory?.origin!=='live')throw new Error('Inspect OBS in this session before enabling controls.');
      await obs.refresh();if(mode==='offline-program')assertOfflineSafe(obs.state(),workspace);
      const offline=mode==='offline-program';
      const consent=await dialog.showMessageBox(window!,{type:'warning',buttons:['Cancel',offline?'Enable offline Program & captions':'Enable OBS Preview rehearsal'],defaultId:0,cancelId:0,
        message:offline?'Allow real changes in your BCC TEST collection?':'Allow changes to OBS Preview?',
        detail:offline?
          'Use a DUPLICATED and backed-up BCC TEST collection, outside any service. This changes real Program scenes, caption text, and reviewed speaker-name visibility, including timed returns. Changes remain after reset/exit. Scene changes may activate media/audio already present. No mute/fader, streaming, camera or switcher commands are sent. Stop external encoders and disable automation manually: only OBS built-in outputs can be checked. I have prepared this isolated test setup.':
          'Use outside a service. Studio Mode must be on and all checked outputs off. Only Preview scenes change. Text remains simulated. Disable external automation that could transition Preview to Program.'});
      if(consent.response!==1)return state();await obs.refresh();
    }
    await rehearsal.setMode(mode);return state();
  });
  handle('cc:command',async(command:unknown,value:unknown)=>{
    if(typeof command!=='string'||(value!==undefined&&typeof value!=='string'))throw new Error('Invalid command.');
    await rehearsal.command(command,text(value,500));return state();
  });
  handle('cc:export',async()=>{
    const pick=await dialog.showSaveDialog(window!,{title:'Export local workspace (contains site names and addresses)',defaultPath:'broadcast-cc-workspace.json',filters:[{name:'JSON',extensions:['json']}]});
    if(pick.canceled||!pick.filePath)return 'Export cancelled.';
    await writeFile(pick.filePath,JSON.stringify(validateWorkspace(workspace,true),null,2)+'\n',{encoding:'utf8',mode:0o600});
    return 'Workspace exported with operator audio notes, without live meter samples, credentials or control authorization. Review site names and addresses before sharing.';
  });
  createWindow();app.on('activate',()=>{if(!window)createWindow();});
});
function createWindow():void{
  window=new BrowserWindow({width:1220,height:860,minWidth:1000,minHeight:700,title:'Broadcast Control Center Preview',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
  window.on('closed',()=>{window=null;rehearsal.interrupt('Window closed: pending actions cancelled. OBS changes were not undone.');void obs.disconnect();});
  void window.loadURL('bcc://app/index.html');
}
app.on('before-quit',()=>{rehearsal.cancel();void obs.disconnect();});app.on('window-all-closed',()=>app.quit());
