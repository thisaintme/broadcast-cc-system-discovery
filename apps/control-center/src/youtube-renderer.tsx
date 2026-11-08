import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {YouTubeBridge,YouTubePanel,Privacy} from './youtube-model.ts';
declare global {interface Window{youtubeBroadcasts:YouTubeBridge}}
const api=window.youtubeBroadcasts;
const localInput=(s:string)=>{const d=new Date(s);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;};
function App(){
  const [panel,setPanel]=useState<YouTubePanel|null>(null),[serviceId,setService]=useState(''),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[startsAt,setStart]=useState('');
  const [privacy,setPrivacy]=useState<Privacy>('private'),[kids,setKids]=useState(''),[existing,setExisting]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false),[now,setNow]=useState(Date.now());
  useEffect(()=>{let stopped=false;const update=()=>void api.panel().then(p=>{if(!stopped){setPanel(p);setNow(Date.now());}}).catch(()=>{});update();const timer=setInterval(update,1000);return()=>{stopped=true;clearInterval(timer);};},[]);
  useEffect(()=>{if(panel&&!serviceId){const id=panel.selectedService||panel.services[0]?.id||'',s=panel.services.find(v=>v.id===id);setService(id);if(s){setTitle(s.title);setStart(localInput(s.startsAt));}}},[panel,serviceId]);
  async function act(fn:()=>Promise<unknown>){setWorking(true);setError('');try{await fn();setPanel(await api.panel());}catch(e){setError((e instanceof Error?e.message:'Operation failed.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}finally{setWorking(false);}}
  if(!panel)return <main><h1>YouTube broadcasts</h1><p>Reading local state…</p></main>;
  const locked=working||panel.busy,linked=panel.links.find(l=>l.serviceId===serviceId),event=panel.broadcasts.find(b=>b.id===linked?.broadcastId),fresh=panel.checkedAt!==null&&now-panel.checkedAt<60000;
  function chooseService(id:string){setService(id);const s=panel!.services.find(v=>v.id===id);if(s){setTitle(s.title);setStart(localInput(s.startsAt));}setExisting('');}
  const needsControls=serviceId!==panel.selectedService||!panel.obs.permissionsReady;
  return <main>
    <header><div><div className="eyebrow">STAGED • NOT RELEASE-VALIDATED</div><h1>YouTube broadcasts</h1></div><button onClick={()=>void act(()=>api.cancel())}>Cancel pending YouTube action</button></header>
    <section className="live-banner"><h2>{panel.channel?panel.channel.title:'Google not connected'}</h2>{panel.channel&&<p>Channel ID: {panel.channel.id}</p>}
      <p>OBS: <strong>{panel.obs.streaming===true?'Transmitting':panel.obs.streaming===false?'Off':'Unknown'}</strong> · Program: {panel.obs.program||'Unknown'} · Service audio: {panel.obs.muted===true?'Muted':panel.obs.muted===false?'Unmuted':'Unknown'}</p>
      <p>YouTube event: <strong>{fresh&&event?event.lifeCycle:'Unknown / refresh required'}</strong>{event&&` · ${event.privacy} · ${event.title}`}</p>
      <p>OBS transmission and YouTube publication are checked separately. Confirm the actual viewer picture and sound.</p>
    </section>
    {(error||panel.error)&&<div className="alert" role="alert">{error||panel.error}</div>}<p className="hint" role="status">{panel.notice}</p>
    <article><h2>Google connection</h2><p>Import a Google Cloud OAuth <b>Desktop app</b> client once. Sign in through your browser to the intended YouTube channel. No Google password, token or stream key is shown or included in workspace exports.</p>
      <div className="toolbar"><button disabled={locked||!!panel.channel} onClick={()=>void act(()=>api.configure())}>Import Desktop OAuth client…</button><button disabled={locked||!panel.credentialsConfigured} onClick={()=>void act(()=>api.signIn())}>Connect Google…</button><button disabled={locked||!panel.channel} onClick={()=>void act(()=>api.refresh())}>Refresh YouTube status</button><button disabled={locked||!panel.channel} onClick={()=>void act(()=>api.disconnect())}>Forget local Google sign-in…</button></div>
      <small>Account and live-streaming access must be enabled by Google/YouTube. An API key alone is not sufficient. Unsigned app updates may prompt for Keychain access again.</small>
    </article>
    <section className="service-bar"><label>Local service<select value={serviceId} disabled={locked} onChange={e=>chooseService(e.target.value)}><option value="">Choose service…</option>{panel.services.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label><small>Add services in the main window. Selecting one here does not change OBS or the main window’s current service.</small></section>
    <article><h2>Create scheduled YouTube event</h2><p>The existing OBS YouTube ingest key is matched privately to the connected channel. This version does not change stream keys, encoder settings or the destination.</p>
      <label>Title<input value={title} maxLength={100} disabled={locked||!!linked} onChange={e=>setTitle(e.target.value)}/></label>
      <label>Description<textarea value={description} maxLength={5000} disabled={locked||!!linked} onChange={e=>setDescription(e.target.value)}/></label>
      <label>YouTube scheduled start<input type="datetime-local" value={startsAt} disabled={locked||!!linked} onChange={e=>setStart(e.target.value)}/></label><small>Entry uses this Mac’s timezone. Confirmation shows Europe/Berlin. A changed YouTube time does not change the local service date.</small>
      <div className="two-col"><label>Visibility<select value={privacy} disabled={locked||!!linked} onChange={e=>setPrivacy(e.target.value as Privacy)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label><label>Is this event made for kids?<select value={kids} disabled={locked||!!linked} onChange={e=>setKids(e.target.value)}><option value="">Choose explicitly…</option><option value="no">No</option><option value="yes">Yes</option></select></label></div>
      <button className="primary" disabled={locked||!panel.channel||!serviceId||!title.trim()||!startsAt||!kids||!!linked} onClick={()=>void act(()=>api.command({kind:'create',draft:{serviceId,channelId:panel.channel!.id,title,description,startsAt:new Date(startsAt).toISOString(),privacy,madeForKids:kids==='yes'}}))}>Create scheduled event…</button>
      {linked&&<p>This service already has an association ({linked.stage}). Event ID: {linked.broadcastId||'creation result unconfirmed'}. Refresh and recover the existing event below; do not create duplicates.</p>}
    </article>
    <article><h2>Use or recover an existing event</h2><label>Upcoming event<select value={existing} disabled={locked} onChange={e=>setExisting(e.target.value)}><option value="">Refresh and select an upcoming event…</option>{panel.broadcasts.filter(b=>['created','ready'].includes(b.lifeCycle)).map(b=><option key={b.id} value={b.id}>{b.title} · {b.privacy} · {b.id}</option>)}</select></label>
      <button disabled={locked||!serviceId||!existing||!panel.channel} onClick={()=>void act(()=>api.command({kind:'link',serviceId,broadcastId:existing}))}>Link selected event…</button><small>Existing events must have automatic start/stop and monitor-stream testing disabled. A different bound ingest key will not be silently replaced.</small>
    </article>
    <article><h2>Broadcast operation</h2>
      {needsControls&&<p className="notice">In the main window select this same service, then enable Scenes and captions, Service audio and OBS start/stop. Enabling permissions does not start a broadcast.</p>}
      <div className="toolbar"><button className="primary" disabled={locked||!linked||linked.stage!=='ready'||needsControls||!panel.channel} onClick={()=>void act(()=>api.command({kind:'start',serviceId}))}>Start broadcast with Intro…</button>
      <button disabled={locked||!linked||linked.stage!=='ready'||needsControls||!panel.channel} onClick={()=>void act(()=>api.command({kind:'publish-intro',serviceId}))}>Publish current Intro — recovery…</button>
      <button className="danger" disabled={locked||!linked||linked.stage!=='ready'||needsControls||!panel.channel} onClick={()=>void act(()=>api.command({kind:'end',serviceId}))}>End YouTube broadcast and stop OBS…</button></div>
      <p><b>Start</b> verifies muted service audio and Intro, starts OBS, waits for the matching YouTube feed and publishes the selected event. <b>Live Service → On Air</b> then switches to Main and unmutes. <b>Outro</b> mutes and displays the next service without ending the broadcast. Use <b>End</b> after Outro.</p>
      <p>Do not start again when joining an existing transmission. After an uncertain result, refresh first. Recovery never restarts OBS; it only publishes a verified, already-transmitting Intro. Cancellation and closing this window do not stop running outputs.</p>
      {event&&<div className="toolbar"><button disabled={locked} onClick={()=>void act(()=>api.openBroadcast(event.id))}>Open viewer page</button><button disabled={locked} onClick={()=>void act(()=>api.copyLink(event.id))}>Copy viewer link</button></div>}
    </article><footer>DE / main OBS broadcast only. Russian encoder, link distribution and Bible-description updates are not implemented in this staged change.</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
