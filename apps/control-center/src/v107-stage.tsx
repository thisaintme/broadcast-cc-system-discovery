import React,{useEffect,useRef,useState} from 'react';
import type {LiveAppBridge,LiveSiteSnapshot} from './live-app.ts';
import type {LiveCommand} from './live-contract.ts';
import type {ManagementUI} from './desk-management.tsx';
import type {MonitorFrame,MonitorSlot} from './program-monitor.ts';
import {Icon} from './live-design.tsx';
import {SceneIcon} from './v107-icons.tsx';
import {ChannelStatus} from './v107-shell.tsx';
import {SCENES,SCENE_LABELS,scenePresentation,operatorMessage} from './v107-model.ts';
import {parseBibleReference} from './bible-reference.ts';
import {remainingReturnSeconds} from './live-ui-model.ts';

type Act=(fn:()=>Promise<unknown>)=>Promise<void>;
interface Props {s:LiveSiteSnapshot;manager:ManagementUI;fresh:boolean;locked:boolean;reasons:(command:LiveCommand,extra?:string)=>string[];command:(command:LiveCommand,value?:string)=>Promise<void>;openPanel:(kind:'speaker'|'bible'|'outro')=>void;api:LiveAppBridge;now:number;act:Act;navigate:(tab:string)=>void}

/** Read-only OBS frames, never a simulated video or a proof of YouTube delivery. */
function Monitor({slot,api,now,source,connected}:{slot:MonitorSlot;api:LiveAppBridge;now:number;source:string;connected:boolean}){
  const [frame,setFrame]=useState<MonitorFrame|null>(null);
  const [message,setMessage]=useState('Vorschau wird geladen …');
  useEffect(()=>{
    let stopped=false,waiting=false;
    setFrame(null);
    if(!connected||!source){setMessage(!connected?'OBS ist nicht verbunden.':'Keine Videoquelle zugeordnet.');return;}
    async function tick(){
      if(stopped||waiting||document.hidden)return;
      waiting=true;
      try{const next=await api.monitor(slot);if(!stopped){setMessage(next.message);setFrame(old=>next.image&&next.source===source?next:old?.source===next.source?old:null);}}
      catch{if(!stopped)setMessage('Vorschau nicht verfügbar.');}
      finally{waiting=false;}
    }
    void tick();const timer=setInterval(()=>void tick(),slot==='program'?900:2500);
    return()=>{stopped=true;clearInterval(timer);};
  },[api,slot,source,connected]);
  const current=!!frame?.image&&frame.source===source&&connected;
  const recent=current&&frame.capturedAt!==null&&now>=frame.capturedAt&&now-frame.capturedAt<5000;
  return <div className={`v107-monitor v107-monitor--${slot}`} data-stale={!recent}>
    {current?<img src={frame.image!} alt={`${slot==='program'?'OBS-Programmbild':'Kameravorschau'}: ${source}`}/>:<div className="v107-placeholder"><Icon name="image"/><strong>{slot==='program'?'Programmbild':'Kameravorschau'}</strong><span>{message}</span></div>}
    {current&&!recent&&<span className="v107-frame-note">Vorschaubild veraltet</span>}
  </div>;
}

export function LiveStage({s,manager,fresh,locked,reasons,command,openPanel,api,now,act,navigate}:Props){
  const stage=useRef<HTMLDivElement>(null),flight=useRef(false);
  const [full,setFull]=useState(false),[panels,setPanels]=useState(true),[help,setHelp]=useState(false),[localError,setLocalError]=useState('');
  const [reference,setReference]=useState(''),[editId,setEditId]=useState(''),[editingReference,setEditingReference]=useState('');
  const o=s.live.observation,cues=s.cues||{speaker:'',selected:'',entries:[]};
  const selected=cues.entries.find(entry=>entry.id===cues.selected);
  const parsed=parseBibleReference(reference),edited=parseBibleReference(editingReference);
  const fault=!fresh||o.streaming===null||o.reconnecting!==false;
  const cueLocked=locked||!s.live.selectedService;
  const confirmedScene=SCENES.find(scene=>scenePresentation(s,scene.role,fresh).selected);
  const audioKnown=fresh&&typeof o.muted==='boolean',audioCommand=o.muted?'unmute':'mute';
  const audioReasons=reasons(audioCommand).map(operatorMessage);
  const speakerReasons=reasons('speaker',cues.speaker?'':'Bitte einen Sprecher auswählen.').map(operatorMessage);
  const bibleReasons=reasons('bible',selected?'':'Bitte eine Bibelstelle auswählen.').map(operatorMessage);
  const youtubeFault=!!manager.error||Object.values(manager.panel?.connectionErrors||{}).some(Boolean);
  const endPending=s.end?.status==='countdown'||s.end?.status==='ending';
  async function exclusive(fn:()=>Promise<void>){if(flight.current)return;flight.current=true;try{await fn();}finally{flight.current=false;}}
  async function fullscreen(){
    setLocalError('');
    try{if(document.fullscreenElement)await document.exitFullscreen();else await stage.current?.requestFullscreen();}
    catch{setLocalError('Vollbild konnte nicht geöffnet werden. Die Regie bleibt bedienbar.');}
  }
  function leaveAnd(run:()=>void){
    if(document.fullscreenElement)void document.exitFullscreen().then(run).catch(()=>setLocalError('Bitte Vollbild mit Esc verlassen.'));
    else run();
  }
  useEffect(()=>{const changed=()=>setFull(document.fullscreenElement===stage.current);document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);},[]);
  useEffect(()=>{setEditId('');setEditingReference('');setReference('');},[s.live.selectedService]);
  useEffect(()=>{
    const keyboard=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement|null;
      if(event.defaultPrevented||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||target?.closest('input,select,textarea,[contenteditable="true"],[role="dialog"]')||document.querySelector('[role="dialog"]'))return;
      if(event.key.toLowerCase()==='f'){event.preventDefault();void fullscreen();return;}
      const key=event.key.match(/^F([1-8])$/);
      if(key){event.preventDefault();stage.current?.querySelector<HTMLButtonElement>(`[data-scene-index="${Number(key[1])-1}"]`)?.click();}
    };
    document.addEventListener('keydown',keyboard);return()=>document.removeEventListener('keydown',keyboard);
  },[]);
  return <div className="v107-stage" ref={stage} data-fullscreen={full} data-panels={panels}>
    {full&&<div className="v107-full-status"><ChannelStatus manager={manager} now={now}/><span>{s.workspace.services.find(x=>x.id===s.live.selectedService)?.title||'Regie'}</span></div>}
    {s.live.lastError&&<div className="v107-fault" role="alert">{operatorMessage(s.live.lastError)}</div>}
    {localError&&<div className="v107-fault" role="alert">{localError}</div>}
    <div className="v107-stage-grid">
      <section className="v107-program" aria-label="Programmbild">
        <div className="v107-picture">
          <Monitor slot="program" api={api} now={now} source={o.program} connected={fresh}/>
          <div className="v107-picture-chips" aria-label="Bild- und Tonstatus">
            <span id="live-program" className="v107-status-chip" data-on-air={confirmedScene?scenePresentation(s,confirmedScene.role,fresh).onAir:false}>{fresh?(confirmedScene?SCENE_LABELS[confirmedScene.role]:o.program||'Andere Szene'):'Bildstatus offen'}</span>
            <span className="v107-status-chip"><Icon name={audioKnown&&!o.muted?'volume':'mute'}/>{!audioKnown?'Tonstatus offen':o.muted?'Ton aus':'Ton an'}</span>
          </div>
          <div className="v107-picture-tools"><button onClick={()=>setPanels(!panels)} aria-expanded={panels} aria-controls="v107-panels" title="Arbeitskarten ein- oder ausblenden" aria-label={panels?'Arbeitskarten ausblenden':'Arbeitskarten einblenden'}><Icon name="sliders"/></button><button id="v107-fullscreen" onClick={()=>void fullscreen()} aria-label={full?'Vollbild verlassen':'Vollbild öffnen'} title={full?'Vollbild verlassen · Esc':'Vollbild öffnen · F'}><span aria-hidden="true">{full?'↙':'⛶'}</span></button></div>
          {fault&&<div className="v107-fault v107-picture-fault" role="alert"><Icon name="help"/><div><strong>{o.reconnecting&&fresh?'OBS verbindet sich neu':'Verbindung zu OBS nicht bestätigt'}</strong><p>Bild und Ton können nicht sicher gesteuert werden. Das Ende bleibt erreichbar.</p></div><button onClick={()=>leaveAnd(()=>navigate('setup'))}>Verbindung prüfen</button></div>}
        </div>
        <div className="v107-picture-caption"><span>OBS-Vorschaubilder · kein YouTube-Player</span><span>{s.live.pendingAction?'Aktion angefordert · Bestätigung ausstehend':fresh?'Status von OBS bestätigt':'Status offen'}</span></div>
        <div className="v107-camera-row" aria-label="Kameravorschauen">{(['front','side'] as const).map(slot=><figure key={slot}><Monitor slot={slot} api={api} now={now} source={s.workspace.hardwareNotes[slot==='front'?'frontInput':'sideInput']} connected={fresh}/><figcaption>{slot==='front'?'Kamera vorne':'Kamera seitlich'}</figcaption></figure>)}<p>Quellen aus OBS.<br/>Die Auswahl am Bildmischer ist noch nicht angebunden.</p></div>
      </section>
      <aside id="v107-panels" className="v107-panels" hidden={!panels}>
        <section className="v107-card"><div className="v107-card-heading"><h2>Einblenden</h2><small>15 Sekunden</small></div>
          <label htmlFor="v107-speaker">Sprecher</label><select id="v107-speaker" disabled={cueLocked} value={cues.speaker} onChange={e=>void act(()=>api.cue({kind:'speaker',name:e.target.value}))}><option value="" disabled>Sprecher auswählen …</option>{s.workspace.speakers.map(name=><option key={name}>{name}</option>)}</select>
          <button id="v107-show-speaker" className="v107-primary" disabled={locked||fault||speakerReasons.length>0} title={speakerReasons.join(' ')} onClick={()=>void exclusive(()=>command('speaker',cues.speaker))}><Icon name="speaker"/>Namen einblenden</button>
          <p>Zeigt den Namen und kehrt zum Hauptbild zurück.</p>
        </section>
        <section className="v107-card v107-bible" aria-label="Bibelstellen"><div className="v107-card-heading"><h2>Bibelstelle</h2><small>{cues.entries.length} vorgemerkt</small></div>
          <form onSubmit={event=>{event.preventDefault();if(cueLocked||!reference.trim())return;void act(async()=>{await api.cue({kind:'add',reference:parsed?.reference||reference.trim()});setReference('');});}}>
            <label htmlFor="v107-reference">Buch, Kapitel und Verse</label><div className="v107-input-row"><input id="v107-reference" placeholder="z. B. 1 Kor 4, 12ff" value={reference} maxLength={500} disabled={cueLocked} onChange={e=>setReference(e.target.value)} aria-describedby="v107-reference-hint"/><button type="submit" disabled={cueLocked||!reference.trim()} aria-label="Bibelstelle vormerken">＋</button></div>
            <p id="v107-reference-hint" className="v107-reference-hint">{parsed?.reference||(reference.trim()?'Wird unverändert als eigene Stellenangabe gespeichert.':'Kurzschreibweise wird als Vorschlag aufgelöst.')}</p>
          </form>
          <div className="v107-cues">{!cues.entries.length&&<p className="v107-empty">Die nächste Lesung hier vormerken.</p>}{cues.entries.map(entry=><div key={entry.id} className="v107-cue" data-selected={entry.id===cues.selected}>
            {editId===entry.id?<form onSubmit={e=>{e.preventDefault();if(cueLocked||!editingReference.trim())return;void act(async()=>{await api.cue({kind:'edit',id:entry.id,reference:edited?.reference||editingReference.trim()});setEditId('');});}}><label htmlFor="v107-edit-reference">Stellenangabe bearbeiten</label><input id="v107-edit-reference" autoFocus value={editingReference} maxLength={500} disabled={cueLocked} onChange={e=>setEditingReference(e.target.value)}/><small>{edited?.reference||'Eigene Stellenangabe'}</small><div className="v107-input-row"><button type="submit" disabled={cueLocked||!editingReference.trim()}>Speichern</button><button type="button" onClick={()=>setEditId('')}>Abbrechen</button></div></form>:<><button className="v107-cue-select" disabled={cueLocked} aria-pressed={entry.id===cues.selected} onClick={()=>void act(()=>api.cue({kind:'select',id:entry.id}))}><span>{entry.reference}</span><small>{entry.id===cues.selected?'Als Nächstes':entry.shownAt!==null?'Bereits eingeblendet':'Vorgemerkt'}</small></button><button className="v107-small-button" aria-label={`${entry.reference} bearbeiten`} disabled={cueLocked} onClick={()=>{setEditId(entry.id);setEditingReference(entry.reference);}}>Bearbeiten</button><button className="v107-small-button" aria-label={`${entry.reference} entfernen`} disabled={cueLocked} onClick={()=>void act(()=>api.cue({kind:'remove',id:entry.id}))}>×</button></>}
          </div>)}</div>
          <button id="v107-show-bible" className="v107-primary" disabled={locked||fault||bibleReasons.length>0} title={bibleReasons.join(' ')} onClick={()=>void exclusive(()=>command('bible',selected?.reference))}><Icon name="book"/>Stellenangabe einblenden</button><p>Zeigt die ausgewählte Stelle für 15 Sekunden.</p>
        </section>
        {youtubeFault&&<div role="alert" className="v107-fault">YouTube-Status konnte nicht aktualisiert werden. <button onClick={()=>leaveAnd(()=>navigate('youtube'))}>Konten prüfen</button></div>}
        <details className="v107-device-note"><summary>Russisch · Web Presenter</summary><p>Der YouTube-Status wird oben geprüft. Der Encoder selbst ist noch nicht angebunden; sein Sendezustand ist nicht bestätigt.</p></details>
      </aside>
    </div>
    <div className="v107-dock" aria-label="Regiepult">
      <div className="v107-action-strip" role="status">
        {s.live.returnAt!==null?<><span>{fresh?`Zurück zum Hauptbild in ${remainingReturnSeconds(s.live.returnAt,now)} s`:'Rückkehr nicht bestätigt'}</span><button id="cancel-live-return" onClick={()=>void api.cancelReturn().catch(()=>setLocalError('Die Rückkehr konnte nicht ausgesetzt werden.'))}>Rückkehr aussetzen</button></>:endPending?<><span>{s.end?.status==='countdown'?`Übertragung endet in ${Math.max(0,Math.ceil(((s.end.until||now)-now)/1000))} s`:'Abschluss wird bestätigt …'}</span><button id="v107-cancel-end" onClick={()=>void api.cancelEnd().catch(()=>setLocalError('Der Abschluss konnte nicht abgebrochen werden.'))}>Abschluss abbrechen</button></>:<span>{s.live.pendingAction?'Aktion wird bestätigt …':fault?'Steuerung gesperrt · Verbindung prüfen':'Szene wählen · Bildwechsel wird von OBS bestätigt'}</span>}
      </div>
      <div className="v107-dock-controls"><div className="v107-scenes" aria-label="Szenen">
        {SCENES.map((scene,index)=>{const state=scenePresentation(s,scene.role,fresh),why=reasons(scene.command).map(operatorMessage);return <button key={scene.role} id={`v107-scene-${scene.role}`} data-scene-index={index} data-requested={state.requested} data-on-air={state.onAir} data-selected={state.selected} aria-pressed={state.selected} aria-busy={state.requested} disabled={locked||fault||why.length>0} title={`${scene.hint}${why.length?' '+why.join(' '):''}`} onClick={()=>void exclusive(()=>command(scene.command))}><SceneIcon name={scene.icon}/><strong>{SCENE_LABELS[scene.role]}</strong><small>{state.requested?'Angefordert':state.onAir?'Auf Sendung':state.selected?'Im Programm':why.length?'Nicht bereit':`F${index+1}`}</small></button>;})}
      </div><div className="v107-dock-end"><button id="v107-audio" className="v107-audio" disabled={locked||fault||!audioKnown||audioReasons.length>0} title={audioReasons.length?audioReasons.join(' '):o.muted?'Schaltet den Sendeton an.':'Schaltet den Sendeton aus.'} onClick={()=>void exclusive(()=>command(audioCommand))}><Icon name={audioKnown&&!o.muted?'volume':'mute'}/><strong>{!audioKnown?'Ton offen':o.muted?'Ton aus':'Ton an'}</strong></button><button id="open-outro-panel" className="v107-end" onClick={()=>leaveAnd(()=>openPanel('outro'))}><Icon name="stop"/>Beenden …</button></div></div>
      <div className="v107-dock-help"><span>Überblenden · {(s.workspace.transitionMs??900)/1000} s</span><button aria-expanded={help} onClick={()=>setHelp(!help)}><Icon name="help"/>Bedienhilfe</button></div>
      {help&&<div className="v107-help"><p>F1–F8 wählen dieselben Szenenkacheln. F öffnet Vollbild, Esc beendet es. Beim Schreiben lösen diese Tasten keine Aktion aus.</p><p>Die Kachel „Outro“ zeigt nur die Endtafel. „Beenden“ öffnet den geprüften Ablauf für die ausgewählten Übertragungen. Während des Countdowns können Sie ihn abbrechen oder über Main zurückkehren.</p><p>Bibelstellen sind Stellenangaben, kein automatisch geprüfter Vers- oder Liedtext. Eigene Angaben werden unverändert gespeichert. Bearbeiten verändert keine bereits sichtbare Einblendung.</p><p>Rot bedeutet bestätigt auf Sendung; Gold bedeutet angefordert. Kameravorschau, OBS-Sendestatus und YouTube-Bestätigung sind voneinander unabhängig.</p></div>}
    </div>
  </div>;
}
