import React,{useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import type {LiveSiteSnapshot} from './live-app.ts';
import type {ManagementUI} from './desk-management.tsx';
import {Icon} from './live-design.tsx';
import {formatDuration,remainingReturnSeconds} from './live-ui-model.ts';
import {channelStatus} from './v107-model.ts';

export function ChannelStatus({manager,now}:{manager:ManagementUI;now:number}){
  return <div className="v107-channels" aria-label="Übertragungen">{(['de','ru'] as const).map(language=>{
    const state=channelStatus(manager.panel,language,now);
    return <span key={language} className="v107-channel" data-on-air={state.live} data-unknown={!state.fresh} aria-label={`${language==='de'?'Deutsch':'Russisch'}: ${state.label}`}><i aria-hidden="true"/><b>{language.toUpperCase()}</b><span>{state.label}</span></span>;
  })}</div>;
}
export function V107Shell({s,manager,tab,navigate,fresh,status,authorized,release,cancelReturn,now,advanced,children}:{
  s:LiveSiteSnapshot;manager:ManagementUI;tab:string;navigate:(tab:string)=>void;fresh:boolean;status:string;authorized:boolean;release:()=>void;cancelReturn:()=>void;now:number;advanced:()=>void;children:ReactNode;
}){
  const [theme,setTheme]=useState<'dark'|'light'>(()=>{try{return localStorage.getItem('bcc-ui-theme')==='light'?'light':'dark';}catch{return 'dark';}});
  const [tools,setTools]=useState(false);
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('bcc-ui-theme',theme);}catch{/* Appearance is optional. */}},[theme]);
  const transmitting=fresh&&s.live.observation.streaming===true&&s.live.observation.reconnecting===false;
  return <div className="v107-shell">
    <a className="bcc-skip" href="#bcc-content">Zum Inhalt</a>
    <header className="v107-navbar" id="live-banner" data-state={status}>
      <div className="v107-brand"><svg viewBox="18 24 64 57" width="34" height="30" aria-hidden="true"><g fill="currentColor"><path d="M22 54A28 28 0 0 1 78 54Z"/><rect x="22" y="60" width="56" height="7" rx="3.5"/><rect x="31" y="72" width="38" height="7" rx="3.5"/></g></svg><span>Broadcast <b>CC</b></span></div>
      <ChannelStatus manager={manager} now={now}/>
      <span id="transmission-status" className="v107-obs-status" data-on-air={transmitting} data-state={status}><span>{!fresh||s.live.observation.streaming===null||s.live.observation.reconnecting===null?'OBS · Status offen':s.live.observation.reconnecting?'OBS · verbindet neu':transmitting?'OBS sendet':'OBS bereit'}</span><time>{fresh?formatDuration(s.live.observation.durationMs):'—:—:—'}</time></span>
      <nav aria-label="Hauptnavigation"><button id="nav-live" aria-current={tab==='live'?'page':undefined} onClick={()=>navigate('live')}>Regie</button><button id="nav-schedule" aria-current={tab==='schedule'?'page':undefined} onClick={()=>navigate('schedule')}>Termine</button><button id="nav-setup" aria-label="Einrichtung" title="Einrichtung" aria-current={tab==='setup'?'page':undefined} onClick={()=>navigate('setup')}><Icon name="settings"/></button><button aria-label={theme==='dark'?'Helles Design aktivieren':'Dunkles Design aktivieren'} onClick={()=>setTheme(theme==='dark'?'light':'dark')}><Icon name={theme==='dark'?'sun':'moon'}/></button><button aria-expanded={tools} aria-controls="v107-tools" aria-label="Weitere Werkzeuge" onClick={()=>setTools(!tools)}><Icon name="sliders"/></button></nav>
      {tools&&<div id="v107-tools" className="v107-tools" onKeyDown={e=>{if(e.key==='Escape')setTools(false);}}><button onClick={()=>{setTools(false);navigate('youtube');}}>YouTube-Verwaltung öffnen</button><button onClick={()=>{setTools(false);navigate('log');}}>Protokoll öffnen</button><button id="release-live" onClick={()=>{setTools(false);release();}}>Steuerung abgeben</button><button onClick={()=>{setTools(false);advanced();}}>Erweiterte Probe öffnen …</button><small>Die Probe gibt die Live-Steuerung ab.</small></div>}
    </header>
    <main id="bcc-content" data-tab={tab} tabIndex={-1}>
      {tab!=='live'&&s.live.returnAt!==null&&<section className="v107-return" aria-label="Automatische Rückkehr"><span>{fresh?`Hauptbild in ${remainingReturnSeconds(s.live.returnAt,now)} s`:'Rückkehr nicht bestätigt'}</span><button id="cancel-live-return" onClick={cancelReturn}>Rückkehr aussetzen</button></section>}
      {children}
      <footer className="v107-footer"><span id="live-mode" data-authorized={authorized}>{authorized?'Steuerung freigegeben':'Nur beobachten'}</span><span>V107 · Vorschau {s.version} · OBS-Status und YouTube-Status werden getrennt geprüft.</span></footer>
    </main>
  </div>;
}
