import {DeviceDesk} from './v107-devices.tsx';
import type {PresentationRole} from './presentation-model.ts';
import {ContentDesk,ImageDesk} from './v107-content.tsx';
import type {ChapterSelection} from './v107-content.tsx';
import type {PresentationAction} from './presentation-service.ts';
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
  // OBS Studio Mode is not consent to a different interaction model in this desk.
  const [previewOnly,setPreviewOnly]=useState(false);
  const [chapterChoice,setChapterChoice]=useState<ChapterSelection|null>(null),[idle,setIdle]=useState(false);
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
  const obsStudio=fresh&&o.studio===true,studio=obsStudio&&previewOnly,previewRole=SCENES.find(scene=>s.workspace.bindings.scenes[scene.role]===o.preview)?.role as PresentationRole|undefined;
  useEffect(()=>{if(!fresh||o.studio!==true||!s.live.permissions.operator)setPreviewOnly(false);},[fresh,o.studio,s.live.permissions.operator]);
  const endPending=s.end?.status==='countdown'||s.end?.status==='ending';
  async function exclusive(fn:()=>Promise<void>){if(flight.current)return;flight.current=true;try{await fn();}finally{flight.current=false;}}
  const sendContent=(action:PresentationAction)=>exclusive(()=>command('presentation',JSON.stringify(action)));
  async function chooseScene(c:LiveCommand){if(studio){const scene=SCENES.find(scene=>scene.command===c);if(scene)await command('studio-preview',JSON.stringify({role:scene.role}));return;}if(c==='chapter'&&s.workspace.presentation?.enabled){if(!chapterChoice)return;await command('presentation',JSON.stringify({kind:'chapter-show',...chapterChoice}));}else await command(c);}
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
      if(event.key==='Enter'&&!(event.target as HTMLElement)?.closest('button')){const take=stage.current?.querySelector<HTMLButtonElement>('#v107-take');if(take&&!take.disabled){event.preventDefault();take.click();}return;}
      const key=event.key.match(/^F([1-8])$/);
      if(key){event.preventDefault();stage.current?.querySelector<HTMLButtonElement>(`[data-scene-index="${Number(key[1])-1}"]`)?.click();}
    };
    document.addEventListener('keydown',keyboard);return()=>document.removeEventListener('keydown',keyboard);
  },[]);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const wake=()=>{setIdle(false);clearTimeout(timer);if(full&&!fault&&!endPending&&!locked)timer=setTimeout(()=>{if(!stage.current?.querySelector('input:focus,textarea:focus,select:focus,[role="dialog"]'))setIdle(true);},3500);};
    wake();const element=stage.current;element?.addEventListener('pointermove',wake);element?.addEventListener('keydown',wake);element?.addEventListener('focusin',wake);
    return()=>{clearTimeout(timer);element?.removeEventListener('pointermove',wake);element?.removeEventListener('keydown',wake);element?.removeEventListener('focusin',wake);};
  },[full,fault,endPending,locked]);
  return <div className="v107-stage" data-idle={idle} ref={stage} data-fullscreen={full} data-panels={panels}>
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
        {studio&&<section className="v107-studio-preview" aria-label="Studiovorschau"><div><b>Vorschau · {previewRole?SCENE_LABELS[previewRole]:'Externe Auswahl'}</b><small>Noch nicht übernommen</small></div><Monitor slot="preview" api={api} now={now} source={o.preview||''} connected={fresh}/><button id="v107-take" className="v107-primary" disabled={locked||fault||!previewRole||reasons('studio-take').length>0||previewRole==='chapter'&&!!s.workspace.presentation?.enabled&&!chapterChoice} onClick={()=>void exclusive(()=>command('studio-take',JSON.stringify({role:previewRole,...(previewRole==='chapter'&&chapterChoice?{chapter:{kind:'chapter-show',...chapterChoice}}:{})})))}>Übernehmen · Enter</button></section>}
        <div className="v107-picture-caption"><span>OBS-Vorschaubilder · kein YouTube-Player</span><span>{s.live.pendingAction?'Aktion angefordert · Bestätigung ausstehend':fresh?'Status von OBS bestätigt':'Status offen'}</span></div>
        <div className="v107-camera-row" aria-label="Kameravorschauen">{(['front','side'] as const).map(slot=><figure key={slot} data-program={s.devices?.readings.switcher.status==='ready'&&s.devices.readings.switcher.program===s.workspace.presentation?.devices.switcher[slot==='front'?'frontInput':'sideInput']}><Monitor slot={slot} api={api} now={now} source={s.workspace.hardwareNotes[slot==='front'?'frontInput':'sideInput']} connected={fresh}/><figcaption>{slot==='front'?'Kamera vorne':'Kamera seitlich'}{s.devices?.readings.switcher.status==='ready'&&s.devices.readings.switcher.program===s.workspace.presentation?.devices.switcher[slot==='front'?'frontInput':'sideInput']&&<strong> · Im Bildmischer-Programm</strong>}</figcaption></figure>)}<p>Quellen aus OBS.<br/>{s.devices?.readings.switcher.status==='ready'?s.devices.readings.switcher.detail:'Bildmischer-Tally nicht bestätigt.'}</p></div>
      </section>
      <aside id="v107-panels" className="v107-panels" hidden={!panels}>
        {confirmedScene?.role==='interlude'&&s.workspace.presentation?.enabled?<ImageDesk s={s} api={api} locked={locked||fault} send={sendContent}/>:<>
        <section className="v107-card"><div className="v107-card-heading"><h2>Einblenden</h2><small>{s.workspace.presentation?.cueSeconds||15} Sekunden</small></div>
          <label htmlFor="v107-speaker">Sprecher</label><select id="v107-speaker" disabled={cueLocked} value={cues.speaker} onChange={e=>void act(()=>api.cue({kind:'speaker',name:e.target.value}))}><option value="" disabled>Sprecher auswählen …</option>{s.workspace.speakers.map(name=><option key={name}>{name}</option>)}</select>
          <button id="v107-show-speaker" className="v107-primary" disabled={locked||fault||speakerReasons.length>0} title={speakerReasons.join(' ')} onClick={()=>void exclusive(()=>command('speaker',cues.speaker))}><Icon name="speaker"/>Namen einblenden</button>
          <p>{s.workspace.presentation?.enabled?'Zeigt den Namen als Bauchbinde auf Main.':'Zeigt den Namen und kehrt zum Hauptbild zurück.'}</p>
        </section>
        <section className="v107-card v107-bible" aria-label="Bibelstellen"><div className="v107-card-heading"><h2>Bibelstelle</h2><small>{cues.entries.length} vorgemerkt</small></div>
          <form onSubmit={event=>{event.preventDefault();if(cueLocked||!reference.trim())return;void act(async()=>{await api.cue({kind:'add',reference:parsed?.reference||reference.trim()});setReference('');});}}>
            <label htmlFor="v107-reference">Buch, Kapitel und Verse</label><div className="v107-input-row"><input id="v107-reference" placeholder="z. B. 1 Kor 4, 12ff" value={reference} maxLength={500} disabled={cueLocked} onChange={e=>setReference(e.target.value)} aria-describedby="v107-reference-hint"/><button type="submit" disabled={cueLocked||!reference.trim()} aria-label="Bibelstelle vormerken">＋</button></div>
            <p id="v107-reference-hint" className="v107-reference-hint">{parsed?.reference||(reference.trim()?'Wird unverändert als eigene Stellenangabe gespeichert.':'Kurzschreibweise wird als Vorschlag aufgelöst.')}</p>
          </form>
          <div className="v107-cues">{!cues.entries.length&&<p className="v107-empty">Die nächste Lesung hier vormerken.</p>}{cues.entries.map(entry=><div key={entry.id} className="v107-cue" data-selected={entry.id===cues.selected}>
            {editId===entry.id?<form onSubmit={e=>{e.preventDefault();if(cueLocked||!editingReference.trim())return;void act(async()=>{await api.cue({kind:'edit',id:entry.id,reference:edited?.reference||editingReference.trim()});setEditId('');});}}><label htmlFor="v107-edit-reference">Stellenangabe bearbeiten</label><input id="v107-edit-reference" autoFocus value={editingReference} maxLength={500} disabled={cueLocked} onChange={e=>setEditingReference(e.target.value)}/><small>{edited?.reference||'Eigene Stellenangabe'}</small><div className="v107-input-row"><button type="submit" disabled={cueLocked||!editingReference.trim()}>Speichern</button><button type="button" onClick={()=>setEditId('')}>Abbrechen</button></div></form>:<><button className="v107-cue-select" disabled={cueLocked} aria-pressed={entry.id===cues.selected} onClick={()=>void act(()=>api.cue({kind:'select',id:entry.id}))}><span>{entry.reference}</span><small>{entry.id===cues.selected?'Als Nächstes':entry.shownAt!==null?'Bereits eingeblendet':'Vorgemerkt'}</small></button><button className="v107-small-button" aria-label={`${entry.reference} bearbeiten`} disabled={cueLocked} onClick={()=>{setEditId(entry.id);setEditingReference(entry.reference);}}>Bearbeiten</button><button className="v107-small-button" aria-label={`${entry.reference} entfernen`} disabled={cueLocked} onClick={()=>void act(()=>api.cue({kind:'remove',id:entry.id}))}>×</button></>}
          </div>)}</div>
          <button id="v107-show-bible" className="v107-primary" disabled={locked||fault||bibleReasons.length>0} title={bibleReasons.join(' ')} onClick={()=>void exclusive(()=>command('bible',selected?.reference))}><Icon name="book"/>Stellenangabe einblenden</button><p>Zeigt die ausgewählte Stelle für {s.workspace.presentation?.cueSeconds||15} Sekunden.</p>
        </section>
        </>}
        {s.workspace.presentation?.enabled&&confirmedScene?.role!=='interlude'&&<ContentDesk fullscreen={full} s={s} api={api} locked={locked||fault||reasons('presentation').length>0} send={sendContent} onChapter={setChapterChoice}/>}
        {youtubeFault&&<div role="alert" className="v107-fault">YouTube-Status konnte nicht aktualisiert werden. <button onClick={()=>leaveAnd(()=>navigate('youtube'))}>Konten prüfen</button></div>}
        <DeviceDesk s={s} api={api} act={act} locked={locked}/>
      </aside>
    </div>
    <div className="v107-dock" aria-label="Regiepult">
      <div className="v107-action-strip" role="status">
        {s.presentation?.cue&&s.presentation.cue.until>now?<><span>{s.presentation.requested?'Einblendung angefordert':`Einblendung endet in ${Math.max(0,Math.ceil((s.presentation.cue.until-now)/1000))} s`}</span><button id="v107-hide-cue" disabled={locked||fault} onClick={()=>void sendContent({kind:'hide'})}>Ausblenden</button></>:s.live.returnAt!==null?<><span>{fresh?`Zurück zum Hauptbild in ${remainingReturnSeconds(s.live.returnAt,now)} s`:'Rückkehr nicht bestätigt'}</span><button id="cancel-live-return" onClick={()=>void api.cancelReturn().catch(()=>setLocalError('Die Rückkehr konnte nicht ausgesetzt werden.'))}>Rückkehr aussetzen</button></>:endPending?<><span>{s.end?.status==='countdown'?`Übertragung endet in ${Math.max(0,Math.ceil(((s.end.until||now)-now)/1000))} s`:'Abschluss wird bestätigt …'}</span><button id="v107-cancel-end" onClick={()=>void api.cancelEnd().catch(()=>setLocalError('Der Abschluss konnte nicht abgebrochen werden.'))}>Abschluss abbrechen</button></>:<span>{s.live.pendingAction?'Aktion wird bestätigt …':fault?'Steuerung gesperrt · Verbindung prüfen':'Szene wählen · Bildwechsel wird von OBS bestätigt'}</span>}
      </div>
      <div className="v107-dock-controls"><div className="v107-scenes" aria-label="Szenen">
        {SCENES.map((scene,index)=>{const state=scenePresentation(s,scene.role,fresh),why=reasons(studio?'studio-preview':scene.command).map(operatorMessage);if(scene.role==='chapter'&&s.workspace.presentation?.enabled&&!chapterChoice)why.push('Bitte zuerst ein Kapitel auswählen.');if(studio&&!s.workspace.bindings.scenes[scene.role])why.push('Bitte die Szene zuordnen.');return <button key={scene.role} id={`v107-scene-${scene.role}`} data-scene-index={index} data-preview={studio&&previewRole===scene.role} data-requested={state.requested} data-on-air={state.onAir} data-selected={state.selected} aria-pressed={state.selected} aria-busy={state.requested} disabled={locked||fault||why.length>0} title={`${studio?'Wählt die Vorschau; erst Übernehmen aktiviert das Bild.':scene.hint}${why.length?' '+why.join(' '):''}`} onClick={()=>void exclusive(()=>chooseScene(scene.command))}><SceneIcon name={(s.workspace.presentation?.scenes[scene.role as keyof typeof s.workspace.presentation.scenes]?.icon||scene.icon) as any}/><strong>{SCENE_LABELS[scene.role]}</strong><small>{state.requested?'Angefordert':state.onAir?'Auf Sendung':state.selected?'Im Programm':why.length?'Nicht bereit':studio&&previewRole===scene.role?'In Vorschau':`F${index+1}`}</small></button>;})}
      </div><div className="v107-dock-end"><button id="v107-audio" className="v107-audio" disabled={locked||fault||!audioKnown||audioReasons.length>0} title={audioReasons.length?audioReasons.join(' '):o.muted?'Schaltet den Sendeton an.':'Schaltet den Sendeton aus.'} onClick={()=>void exclusive(()=>command(audioCommand))}><Icon name={audioKnown&&!o.muted?'volume':'mute'}/><strong>{!audioKnown?'Ton offen':o.muted?'Ton aus':'Ton an'}</strong></button><button id="open-outro-panel" className="v107-end" onClick={()=>leaveAnd(()=>openPanel('outro'))}><Icon name="stop"/>Beenden …</button></div></div>
      <div className="v107-dock-help"><span id="v107-switching-mode">{studio?'Vorschau + Übernehmen':'Direkt schalten'} · Überblenden {(s.workspace.transitionMs??900)/1000} s</span><label className="v107-studio-toggle"><input id="v107-studio-mode" type="checkbox" checked={studio} disabled={locked||fault||!studio&&reasons('studio-mode').length>0} onChange={e=>{if(!e.target.checked){setPreviewOnly(false);return;}void exclusive(()=>act(async()=>{if(!obsStudio)await api.command('studio-mode','true');setPreviewOnly(true);}));}}/>Erst Vorschau, dann übernehmen</label><button aria-expanded={help} onClick={()=>setHelp(!help)}><Icon name="help"/>Bedienhilfe</button></div>
      {full&&s.presentation?.song&&<div className="v107-full-song"><button aria-label="Vorherige Liedseite im Vollbild" disabled={locked||s.presentation.song.page===0} onClick={()=>void sendContent({kind:'song-page',page:s.presentation!.song!.page-1})}>←</button><span>{s.presentation.song.pages[s.presentation.song.page]?.label} · {s.presentation.song.page+1}/{s.presentation.song.pages.length}</span><button aria-label="Nächste Liedseite im Vollbild" disabled={locked||s.presentation.song.page===s.presentation.song.pages.length-1} onClick={()=>void sendContent({kind:'song-page',page:s.presentation!.song!.page+1})}>→</button></div>}
      {help&&<div className="v107-help"><p>F1–F8 wählen dieselben Szenenkacheln. F öffnet Vollbild, Esc beendet es. Standardmäßig aktivieren Kacheln das Programmbild direkt, auch wenn OBS im Studiomodus ist. Nur mit „Erst Vorschau, dann übernehmen“ wählen die Kacheln die Vorschau; Enter übernimmt dann das Bild mit seinen Tonregeln. Diese Wahl gilt nur für die aktuelle Regieansicht und verändert beim Ausschalten nicht den OBS-Studiomodus. Beim Schreiben lösen diese Tasten keine Aktion aus.</p><p>Die Kachel „Outro“ zeigt nur die Endtafel. „Beenden“ öffnet den geprüften Ablauf für die ausgewählten Übertragungen. Während des Countdowns können Sie ihn abbrechen oder über Main zurückkehren.</p><p>Bibelstellen bleiben bearbeitbare Stellenangaben. Kapitel werden lokal aus der gewählten Bibelausgabe gelesen. Liedseiten zeigen ausschließlich importierte Texte. Bearbeiten verändert keine bereits sichtbare Einblendung.</p><p>Rot bedeutet bestätigt auf Sendung; Gold bedeutet angefordert. Kameravorschau, OBS-Sendestatus und YouTube-Bestätigung sind voneinander unabhängig.</p></div>}
    </div>
  </div>;
}
