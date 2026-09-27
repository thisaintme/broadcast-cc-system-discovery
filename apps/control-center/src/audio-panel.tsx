import React,{useEffect,useState} from 'react';
import type {Bridge,Snapshot} from './model.ts';
import type {AudioObservation,AudioRow,AudioSnapshot,Reading} from './audio-model.ts';
import {AUDIO_ROLES,AUDIO_SIGNALS,emptyAudioSnapshot,meterLabel} from './audio-model.ts';
const roleLabel:Record<string,string>={'unclassified':'Unclassified','service-audio':'Service audio / mix',music:'Music',unused:'Unused (operator observation)','possible-duplicate':'Possible duplicate (not verified)'};
const signalLabel:Record<string,string>={pulpit:'Pulpit', 'choir-1':'Choir microphone 1','choir-2':'Choir microphone 2',music:'Music'};
const errorText=(e:unknown)=>(e instanceof Error?e.message:'Audio observation failed.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
const db=(n:number)=>n<=-100?'≤ −100 dBFS':`${n.toFixed(1)} dBFS`;
function Observation({api,row,collection,saved,editable}:{api:Bridge;row:AudioRow;collection:string;saved?:AudioObservation;editable:boolean}){
  const blank=():AudioObservation=>({collection,inputName:row.name,role:'unclassified',respondsTo:[],listening:'not-tested',monitoringPoint:'',notes:'',updatedAt:'',basis:'operator-reported'});
  const [note,setNote]=useState<AudioObservation>(saved||blank),[pending,setPending]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{setNote(saved||blank());},[saved?.updatedAt,collection,row.name]);
  async function save(){setPending(true);setMessage('');try{await api.saveAudioObservation(note);setMessage('Saved as an operator observation. No controls enabled.');}catch(e){setMessage(errorText(e));}finally{setPending(false);}}
  return <details className="audio-notes"><summary>My routing observations {saved?.updatedAt?'· saved':''}</summary>
    <p>These are your observations, not automatically detected routing. Leave unchecked tests unverified.</p>
    <label>Likely role<select value={note.role} disabled={!editable||pending} onChange={e=>setNote({...note,role:e.target.value as AudioObservation['role']})}>{AUDIO_ROLES.map(r=><option key={r} value={r}>{roleLabel[r]}</option>)}</select></label>
    <fieldset disabled={!editable||pending}><legend>I observed an incoming response to</legend>{AUDIO_SIGNALS.map(signal=><label className="audio-check" key={signal}><input type="checkbox" checked={note.respondsTo.includes(signal)} onChange={e=>setNote({...note,respondsTo:e.target.checked?[...note.respondsTo,signal]:note.respondsTo.filter(x=>x!==signal)})}/>{signalLabel[signal]}</label>)}</fieldset>
    <label>Listening check<select value={note.listening} disabled={!editable||pending} onChange={e=>setNote({...note,listening:e.target.value as AudioObservation['listening']})}><option value="not-tested">Not tested</option><option value="heard">Heard at the monitoring point below</option><option value="not-heard">Not heard at the monitoring point below</option><option value="uncertain">Uncertain</option></select></label>
    <label>Where did you listen?<input value={note.monitoringPoint} disabled={!editable||pending} maxLength={400} placeholder="Describe your existing monitoring arrangement" onChange={e=>setNote({...note,monitoringPoint:e.target.value})}/></label>
    <label>Notes<textarea value={note.notes} disabled={!editable||pending} maxLength={1200} rows={3} placeholder="Other inputs responding, uncertain routing, or no response. Do not enter passwords." onChange={e=>setNote({...note,notes:e.target.value})}/></label>
    <button className="save-audio-note" disabled={!editable||pending} onClick={()=>void save()}>Save observation</button>
    {saved?.updatedAt&&<small>Operator-reported · {new Date(saved.updatedAt).toLocaleString()}. Historical, not live verification.</small>}
    {message&&<p role="status">{message}</p>}
  </details>;
}
export function AudioPanel({api,s}:{api:Bridge;s:Snapshot}){
  const [audio,setAudio]=useState<AudioSnapshot>(emptyAudioSnapshot),[received,setReceived]=useState(Date.now()),[now,setNow]=useState(Date.now());
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState('');
  useEffect(()=>{
    let mounted=true;
    const accept=(value:AudioSnapshot)=>{if(mounted){setAudio(value);setReceived(Date.now());}};
    const off=api.onAudio(accept);void api.audioSnapshot().then(accept).catch(()=>setError('Audio status could not be read.'));
    const timer=setInterval(()=>setNow(Date.now()),250);
    return()=>{mounted=false;off();clearInterval(timer);void api.audioControl('stop').catch(()=>{});};
  },[api]);
  const editable=s.runtime.mode==='simulation'&&s.runtime.phase==='idle'&&!s.runtime.busy;
  const fresh=now-received<=2500&&s.transport.connected&&audio.connected;
  async function control(action:'start'|'stop'){
    setPending(true);setError('');try{const value=await api.audioControl(action);setAudio(value);setReceived(Date.now());}catch(e){setError(errorText(e));}finally{setPending(false);}
  }
  const field=<T,>(reading:Reading<T>,format:(v:T)=>string)=>fresh&&audio.running&&reading.fresh&&reading.value!==null?format(reading.value):'Unknown';
  const rows=audio.rows.filter(row=>row.name.toLowerCase().includes(query.toLowerCase()));
  return <div id="audio-verification">
    <section className="notice"><strong>READ-ONLY AUDIO VERIFICATION</strong><p>Start meters, speak into one microphone at a time, and watch the incoming peak. Listen using your existing monitoring arrangement. This screen does not play audio, mute inputs, change volume, switch scenes, or record samples.</p><p>Do this setup test outside a service. A meter is not proof that YouTube receives the sound. Track assignment and OBS source activity do not prove the physical route.</p></section>
    <section className="toolbar"><button id="audio-start" className="primary" disabled={!editable||!s.transport.connected||audio.running||audio.starting||pending} onClick={()=>void control('start')}>Start read-only meters</button><button id="audio-stop" disabled={!audio.running&&!audio.starting} onClick={()=>void control('stop')}>Stop meters</button><button id="audio-export" disabled={s.runtime.busy||pending} onClick={()=>{void api.exportFile().then(message=>setError(message)).catch(e=>setError(errorText(e)));}}>Export workspace with observations…</button></section>
    {!s.transport.connected&&<p className="notice">First open Connections & mappings → Connect & inspect OBS. No caption mapping or BCC TEST authorization is required to read meters.</p>}
    {!editable&&<p>Return to Simulation and reset the rehearsal before starting meters or saving notes.</p>}
    {error&&<div role="status" className="notice">{error}</div>}
    <div id="audio-health" role="status" className="audio-health"><strong>{!s.transport.connected||!audio.connected?'OBS disconnected':audio.running&&!fresh?'Updates stale — readings unknown':audio.starting?'Reading input states…':audio.running?'Read-only meters running':'Meters stopped'}</strong><span>{audio.message}</span><span>Collection: {audio.collection||'Not observed'} · Program: {audio.program||'Unknown'}</span></div>
    <p className="hint">Incoming peak is before OBS input volume/mute. After volume/mute is that input’s peak after these controls, not a final stream mix. Missing samples are never drawn as zero. OBS may omit inactive inputs. “≤ −100 dBFS” is the display floor, not confirmed silence.</p>
    <label>Find an input<input id="audio-filter" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter input names…"/></label>
    {!audio.rows.length&&<article><h2>No current audio inputs</h2><p>Connect to OBS and start read-only meters. Historical discovery readings are not presented as live measurements.</p></article>}
    <div className="audio-grid">{rows.map(row=>{
      const live=fresh&&audio.running&&row.meterState==='live';
      const label=!s.transport.connected?'OBS disconnected':audio.running&&!fresh?'Updates stale — readings unknown':meterLabel(row.meterState);
      return <article className="audio-input" key={`${audio.collection}/${row.name}`} data-input-name={row.name}>
        <h2>{row.name}</h2><small>{row.kind}</small><p className="meter-state">{label}</p>
        {live?row.channels.map((channel,index)=><div className="audio-channel" key={index}><strong>Channel {index+1}</strong><div className="audio-meter-line"><span>Incoming peak</span><meter aria-label={`${row.name} channel ${index+1} incoming peak`} min={-100} max={0} value={Math.min(0,channel.inputPeakDb)}/><output>{db(channel.inputPeakDb)}</output></div><div className="audio-meter-line"><span>After volume/mute</span><meter aria-label={`${row.name} channel ${index+1} after mute peak`} min={-100} max={0} value={Math.min(0,channel.outputPeakDb)}/><output>{db(channel.outputPeakDb)}</output></div></div>):<div className="audio-no-sample">No current level reading — not confirmed silence.</div>}
        <dl className="audio-settings"><dt>OBS mute</dt><dd className="audio-mute">{field(row.muted,v=>v?'Muted':'Not muted')}</dd><dt>Input volume setting</dt><dd>{field(row.volumeDb,v=>`${v.toFixed(1)} dB`)}</dd><dt>Source active</dt><dd>{field(row.active,v=>v?'Yes':'No')}</dd><dt>Assigned tracks</dt><dd>{field(row.tracks,v=>Object.entries(v).filter(([,on])=>on).map(([k])=>k).join(', ')||'None')}</dd><dt>OBS monitoring</dt><dd>{field(row.monitor,v=>v.replace('OBS_MONITORING_TYPE_','').replaceAll('_',' ').toLowerCase())}</dd></dl>
        <Observation api={api} row={row} collection={audio.collection} saved={s.workspace.audioObservations.find(n=>n.collection===audio.collection&&n.inputName===row.name)} editable={editable&&fresh}/>
      </article>;
    })}</div>
    <details><summary>Saved observations from all collections ({s.workspace.audioObservations.length})</summary><p>Historical operator statements only; an input may have been renamed or removed since the observation.</p>{s.workspace.audioObservations.map(n=><p key={JSON.stringify([n.collection,n.inputName])}><strong>{n.inputName}</strong> · {n.collection} · {roleLabel[n.role]} · {n.respondsTo.map(v=>signalLabel[v]).join(', ')||'No response tests recorded'} · listening: {n.listening}</p>)}</details>
    <p className="hint">Only explicitly saved observations are included in workspace exports. No meter samples, recordings, or OBS passwords are saved. Observations never unlock audio control. Leaving this screen stops meter observation.</p>
  </div>;
}
