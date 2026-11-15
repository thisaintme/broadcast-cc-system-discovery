import React,{useRef,useState} from 'react';
import type {LiveAppBridge,LiveSiteSnapshot} from './live-app.ts';
import type {LocalServicePlan} from './local-service-plan.ts';
import {planLocalServices} from './local-service-plan.ts';
import {localParts} from './stream-recurrence.ts';
import {formatBerlinDate} from './live-ui-model.ts';

const weekdays=['Mo','Di','Mi','Do','Fr','Sa','So'];
const clean=(e:unknown)=>{
  const message=(e instanceof Error?e.message:'Der Termin konnte nicht gespeichert werden.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
  return message==='The local workspace could not be saved. Existing OBS state was not changed.'?'Die Termine konnten nicht lokal gespeichert werden. Bitte den Speicherort prüfen. Der bisherige Kalender und OBS bleiben unverändert.':message;
};
export function LocalServicePlanner({s,api,locked,onSaved,onSelect}:{
  s:LiveSiteSnapshot;api:LiveAppBridge;locked:boolean;
  onSaved:(next:LiveSiteSnapshot)=>void;onSelect:(id:string)=>Promise<void>;
}){
  const [preset,setPreset]=useState('Gottesdienst'),[custom,setCustom]=useState('');
  const [date,setDate]=useState(()=>localParts(Date.now()).date),[time,setTime]=useState('11:00');
  const [repeat,setRepeat]=useState(false),[days,setDays]=useState([7]),[interval,setInterval]=useState(1),[count,setCount]=useState(8);
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID()),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const flight=useRef(false),disabled=locked||pending;
  const title=preset==='custom'?custom:preset;
  const plan:LocalServicePlan={requestId,title,...(repeat?{recurrence:{startDate:date,time,timeZone:'Europe/Berlin' as const,weekdays:days,intervalWeeks:interval,count,excludeDates:[]}}:{single:{date,time}})};
  let entries:ReturnType<typeof planLocalServices>=[],validation='';
  try{entries=planLocalServices(plan);}catch(e){validation=clean(e);}
  const changed=()=>{setRequestId(crypto.randomUUID());setNotice('');setError('');};
  async function persist(change:Parameters<LiveAppBridge['changeServices']>[0]){
    await api.changeServices(change);
    // Mutation replies were captured while the main-process action was busy.
    // Read again after completion so that an old reply cannot relock the form.
    return api.site();
  }
  async function run(action:()=>Promise<void>){
    if(flight.current||disabled)return;flight.current=true;setPending(true);setError('');setNotice('');
    try{await action();}catch(e){setError(clean(e));}finally{flight.current=false;setPending(false);}
  }
  return <section className="v107-local-calendar" aria-label="Lokale Sendetermine">
    <article><h2>Sendung planen</h2><p>Einzeltermin oder Reihe für die Auswahl am Sendepult.</p>
      <form id="local-service-form" onSubmit={e=>{e.preventDefault();if(validation)return;void run(async()=>{
        const next=await persist({type:'plan',plan});onSaved(next);
        const added=next.workspace.services.filter(x=>!s.workspace.services.some(old=>old.id===x.id)).length;
        setNotice(added===0?'Diese Termine sind bereits im lokalen Kalender.':`${added===1?'1 Termin':`${added} Termine`} lokal gespeichert. Wählen Sie unten „Für Sendung auswählen“.`);
      });}}>
        <div className="two-col"><label>Titelvorlage<select id="service-title-preset" disabled={disabled} value={preset} onChange={e=>{changed();setPreset(e.target.value);}}><option>Gottesdienst</option><option>Andacht</option><option value="custom">Eigener Titel</option></select></label>
          {preset==='custom'&&<label>Eigener Titel<input id="new-service-custom-title" required maxLength={220} disabled={disabled} value={custom} onChange={e=>{changed();setCustom(e.target.value);}}/></label>}
          <label>Datum · Europe/Berlin<input id="new-service-date" type="date" required min="2000-01-01" max="2100-12-31" disabled={disabled} value={date} onChange={e=>{changed();setDate(e.target.value);}}/></label>
          <label>Uhrzeit · Europe/Berlin<input id="new-service-time" type="time" required disabled={disabled} value={time} onChange={e=>{changed();setTime(e.target.value);}}/></label></div>
        <label className="check-label"><input id="local-service-repeat" type="checkbox" disabled={disabled} checked={repeat} onChange={e=>{changed();setRepeat(e.target.checked);}}/>Als Reihe planen</label>
        {repeat&&<fieldset disabled={disabled}><legend>Sendereihe · lokale Termine</legend><div className="series-weekdays">{weekdays.map((name,i)=><label className="check-label" key={name}><input type="checkbox" aria-label={name} checked={days.includes(i+1)} onChange={e=>{changed();setDays(e.target.checked?[...days,i+1].sort((a,b)=>a-b):days.filter(d=>d!==i+1));}}/>{name}</label>)}</div>
          <div className="two-col"><label>Alle … Wochen<input id="local-service-interval" type="number" min={1} max={52} required value={interval} onChange={e=>{changed();setInterval(Number(e.target.value));}}/></label><label>Anzahl der Termine<input id="local-service-count" type="number" min={1} max={104} required value={count} onChange={e=>{changed();setCount(Number(e.target.value));}}/></label></div>
        </fieldset>}
        {validation?<p role="status">{validation}</p>:<div id="local-service-preview"><p>{entries.length===1?'1 Termin':`${entries.length} Termine`} · Europe/Berlin</p>{entries.slice(0,8).map(x=><div key={x.id}>{formatBerlinDate(x.startsAt)} · {x.title}</div>)}{entries.length>8&&<small>… und {entries.length-8} weitere Termine</small>}</div>}
        <button id="add-live-service" type="submit" className="primary" disabled={disabled||!!validation}>{pending?'Wird gespeichert …':repeat?'Reihe lokal speichern':'Termin lokal speichern'}</button>
        <p className="hint">Keine YouTube-Anmeldung nötig. OBS, Konten und die laufende Sendung bleiben beim Speichern unverändert. Auch ein bereits begonnener heutiger Gottesdienst kann angelegt werden.</p>
      </form>
      {error&&<p className="alert" role="alert">{error}</p>}{notice&&<p id="local-service-notice" className="notice" role="status">{notice}</p>}
    </article>
    <article><h2>Geplante Sendungen</h2>{s.workspace.services.length===0&&<p>Noch keine Termine gespeichert.</p>}
      {s.workspace.services.map(x=><div className="list-row" key={x.id}><div><strong>{x.title}</strong><p>{formatBerlinDate(x.startsAt)}</p>{x.id===s.live.selectedService&&<small>Für die aktuelle Sendung ausgewählt</small>}</div>
        <div className="toolbar"><button type="button" data-select-service={x.id} disabled={disabled} onClick={()=>void run(()=>onSelect(x.id))}>Für Sendung auswählen</button>
          <button type="button" data-remove-service={x.id} disabled={disabled||x.id===s.live.selectedService} aria-label={`Termin ${x.title} entfernen`} title={x.id===s.live.selectedService?'Der ausgewählte Termin ist geschützt.':'Entfernt nur den lokalen Termin.'} onClick={()=>void run(async()=>{onSaved(await persist({type:'remove',id:x.id}));setNotice('Termin lokal entfernt.');})}>Entfernen</button></div>
      </div>)}
    </article>
  </section>;
}
