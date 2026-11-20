import React from 'react';
import type {LiveAppBridge,LiveSiteSnapshot} from './live-app.ts';
import {Icon} from './live-design.tsx';
const names={webPresenter:'Web Presenter · RU',front:'Kamera vorne',side:'Kamera seitlich',mixer:'Mischpult',light:'Licht',switcher:'Bildmischer'};
export function DeviceDesk({s,api,act,locked}:{s:LiveSiteSnapshot;api:LiveAppBridge;act:(fn:()=>Promise<unknown>)=>Promise<void>;locked:boolean}){
  const state=s.devices,cfg=s.workspace.presentation?.devices;
  if(!state||!cfg)return null;
  const enabled=Object.entries(state.readings).filter(([,v])=>v.enabled),warning=enabled.some(([,v])=>v.status!=='ready');
  return <details className="v107-device-note" open={state.end.some(step=>step.status==='failed')||undefined}><summary><Icon name="sliders"/>Geräte{warning?' · Prüfung nötig':enabled.length?' · verbunden':' · keine eingerichtet'}</summary>
    <div className="v107-device-readings">{enabled.length?enabled.map(([id,device])=><div key={id} data-state={device.status}><b>{names[id as keyof typeof names]}</b><span>{device.status==='ready'?device.detail:device.message}</span></div>):<p>Geräte werden in der Einrichtung aktiviert. Ohne Gerät werden keine Befehle gesendet.</p>}</div>
    <div className="v107-input-row"><button id="v107-check-devices" disabled={locked} onClick={()=>void act(()=>api.checkDevices())}>Verbindungen prüfen</button>{!state.granted&&<button id="v107-grant-devices" disabled={locked||!enabled.length} onClick={()=>void act(()=>api.grantDevices())}>Geräte freigeben …</button>}</div>
    {(['front','side'] as const).map(slot=>cfg[slot].enabled&&<fieldset key={slot} disabled={locked||state.busy||!state.granted}><legend>{names[slot]} · Position</legend><div className="v107-camera-presets">{cfg[slot].presets.map(p=><button key={p.id} onClick={()=>void act(()=>api.deviceAction({kind:'camera',slot,preset:p.id}))}>{p.name}</button>)}</div></fieldset>)}
    {cfg.light.enabled&&<fieldset disabled={locked||state.busy||!state.granted}><legend>Licht</legend><button onClick={()=>void act(()=>api.deviceAction({kind:'light',on:state.readings.light.detail!=='Licht an'}))}>{state.readings.light.detail==='Licht an'?'Licht ausschalten':'Licht einschalten'}</button></fieldset>}
    {!!state.end.length&&<section aria-label="Abschluss der Geräte"><h3>Abschluss</h3>{state.end.map(step=><div className="v107-end-step" data-state={step.status} key={step.id}><strong>{step.status==='done'?'✓':step.status==='running'?'…':step.status==='failed'?'!':'–'} {step.label}</strong><small>{step.message||{pending:'Wartet',running:'Wird bestätigt',done:'Bestätigt',failed:'Nicht bestätigt',skipped:'Ausgelassen'}[step.status]}</small></div>)}</section>}
  </details>;
}
