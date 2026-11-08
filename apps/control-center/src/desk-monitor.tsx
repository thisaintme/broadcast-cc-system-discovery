import React,{memo,useEffect,useState} from 'react';
import type {LiveAppBridge} from './live-app.ts';
import {MONITOR_INTERVAL} from './program-monitor.ts';
import type {MonitorFrame,MonitorSlot} from './program-monitor.ts';
import {Icon} from './live-design.tsx';
/** A local update loop keeps large image strings out of global desk state and IPC snapshots. */
export const DeskMonitor=memo(function DeskMonitor({slot,label,api,sourceKey}:{slot:MonitorSlot;label:string;api:LiveAppBridge;sourceKey:string}){
 const [frame,setFrame]=useState<MonitorFrame|null>(null),[message,setMessage]=useState('Vorschau wird geladen …'),[now,setNow]=useState(Date.now());
 useEffect(()=>{
  let stopped=false,waiting=false,timer:ReturnType<typeof setTimeout>|undefined,failures=0;
  setFrame(null);setMessage('Vorschau wird geladen …');
  const interval=MONITOR_INTERVAL[slot];
  const schedule=(ms:number)=>{clearTimeout(timer);if(!stopped)timer=setTimeout(()=>void tick(),ms);};
  async function tick(){
   if(stopped||waiting)return;
   if(document.hidden){schedule(1000);return;}
   waiting=true;const start=performance.now();let ok=false;
   try{const next=await api.monitor(slot);if(!stopped){setMessage(next.message);setFrame(old=>next.image?next:old?.source===next.source?old:next);setNow(Date.now());ok=!!next.image;}}
   catch{if(!stopped){setMessage('Vorschau nicht verfügbar. OBS bleibt unverändert.');setNow(Date.now());}}
   finally{waiting=false;failures=ok?0:Math.min(failures+1,5);const elapsed=performance.now()-start;
    // Back off on a slow OBS; never accumulate requests or replay old frames.
    const period=failures?Math.min(1500,interval*failures):Math.max(interval,Math.min(1500,elapsed*1.5));
    schedule(Math.max(40,period-elapsed));
   }
  }
  const visibility=()=>{setNow(Date.now());if(!document.hidden&&!waiting)schedule(0);};
  document.addEventListener('visibilitychange',visibility);
  schedule(slot==='side'?120:slot==='front'?60:0);
  return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};
 },[slot,api,sourceKey]);
 const fresh=!!frame?.image&&frame.capturedAt!==null&&now-frame.capturedAt<3000;
 return <figure className={`desk-monitor desk-monitor--${slot}`} data-stale={!fresh}><div className="desk-monitor-image">{frame?.image?<img src={frame.image} decoding="async" alt={`${label}: ${frame.source}`}/>:<div className="desk-monitor-placeholder"><Icon name="image"/><strong>{label}</strong><span>{message}</span></div>}{frame?.image&&!fresh&&<span className="desk-frame-stale">Vorschau veraltet · kein Live-Nachweis</span>}</div><figcaption><strong>{label}</strong><span>{frame?.source||'Keine Quelle'}</span><small>{fresh?'OBS-Vorschau · kein YouTube-Player':message}</small></figcaption></figure>;
});
