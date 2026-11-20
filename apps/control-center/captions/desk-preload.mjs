import '../src/live-preload.ts';
import {ipcRenderer} from 'electron';
// No new API is exposed to the web page. Program is never inferred from OBS Preview.
ipcRenderer.on('live:state',(_,s)=>{
 if(!s?.live?.observation||!s.workspace)return;
 const {live,workspace,cues}=s,o=live.observation,b=workspace.bindings,service=workspace.services.find(x=>x.id===live.selectedService);
 const role=['main','speaker','bible','prayer','chapter'].find(k=>b.scenes?.[k]&&b.scenes[k]===o.program)||'';
 ipcRenderer.send('caption:observation',{service:service?.id||'',startsAt:service?.startsAt||'',connected:live.connected,checkedAt:o.checkedAt,streaming:o.streaming,reconnecting:o.reconnecting,muted:o.muted,input:o.inputName,program:o.program,role,busy:live.busy,allowed:!!role&&b.confirmed===true&&!!b.audioInput&&b.audioInput===o.inputName&&o.program!==b.scenes.outro&&o.program!==b.scenes.intro&&o.collection===workspace.inventory?.collection,reference:(cues?.entries||[]).filter(x=>x.shownAt!==null).map(x=>x.reference).slice(-10),speaker:role==='speaker'?cues?.speaker||'':''});
});
