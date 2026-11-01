import React, {useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import type {LiveSiteSnapshot} from './live-app.ts';
import {formatBerlinDate, formatDuration, upcomingService, remainingReturnSeconds} from './live-ui-model.ts';

export type Tone = 'ready' | 'live' | 'progress' | 'warning' | 'error' | 'unknown' | 'offline';
export type IconName = 'grid' | 'broadcast' | 'calendar' | 'settings' | 'sliders' | 'history' | 'arrow' | 'close' | 'sun' | 'moon' | 'help' | 'check' | 'speaker' | 'book' | 'image' | 'stop' | 'volume' | 'mute' | 'shield';
const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  broadcast: <><path d="M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14M8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8"/><circle cx="12" cy="12" r="1"/><path d="m12 13-3 8m3-8 3 8"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4M8 14h3m3 0h2m-8 3h3"/></>,
  settings: <><path d="m9 3-1 3-3 1 1 4-2 2 2 3 3-1 3 2 3-2 3 1 2-3-2-2 1-4-3-1-1-3z"/><circle cx="12" cy="10" r="3"/></>,
  sliders: <><path d="M5 3v7m0 4v7M12 3v12m0 4v2M19 3v3m0 4v11M2 10h6m1 5h6m1-9h6"/></>,
  history: <><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7m2-4v6l4 2"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></>,
  moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/></>,
  check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
  speaker: <><circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></>,
  book: <><path d="M12 6v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 17 5-5 4 4 4-7 5 8"/><circle cx="8" cy="8" r="1"/></>,
  stop: <><circle cx="12" cy="12" r="9"/><rect x="8" y="8" width="8" height="8" rx="1"/></>,
  volume: <><path d="m11 4-6 5H2v6h3l6 5zM15 8a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/></>,
  mute: <><path d="m11 4-6 5H2v6h3l6 5zM16 9l6 6m0-6-6 6"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
};
export function Icon({name, className = ''}: {name: IconName; className?: string}) {
  return <svg className={`bcc-icon ${className}`} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function Badge({tone = 'unknown', children}: {tone?: Tone; children: ReactNode}) {
  return <span className="bcc-badge" data-tone={tone}>{tone === 'live' ? <span className="bcc-tally"/> : <Icon name={tone === 'ready' ? 'check' : tone === 'unknown' ? 'help' : tone === 'progress' ? 'history' : tone === 'offline' ? 'stop' : 'help'}/>}<span>{children}</span></span>;
}
const statusLabels: Record<string, [Tone, string]> = {
  TRANSMITTING: ['live', 'OBS sendet'], OFF: ['offline', 'OBS sendet nicht'],
  STARTING: ['progress', 'OBS wird gestartet'], STOPPING: ['progress', 'OBS wird beendet'],
  RECONNECTING: ['warning', 'OBS verbindet erneut'], UNKNOWN: ['unknown', 'Status unbekannt'],
};
export function ControlShell({s, tab, navigate, fresh, status, authorized, release, cancelReturn, now, advanced, children}: {
  s: LiveSiteSnapshot; tab: string; navigate: (tab: string) => void; fresh: boolean; status: string;
  authorized: boolean; release: () => void; cancelReturn: () => void; now: number; advanced: () => void; children: ReactNode;
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {try {return localStorage.getItem('bcc-ui-theme') === 'light' ? 'light' : 'dark';} catch {return 'dark';}});
  useEffect(() => {document.documentElement.dataset.theme = theme; try {localStorage.setItem('bcc-ui-theme', theme);} catch {/* Appearance must not depend on storage. */}}, [theme]);
  const [tone, label] = statusLabels[status] || statusLabels.UNKNOWN;
  const o = s.live.observation;
  const navigation: [string, string, IconName][] = [['overview', 'Übersicht', 'grid'], ['live', 'Übertragung', 'broadcast'], ['schedule', 'Termine', 'calendar'], ['youtube', 'YouTube', 'broadcast'], ['setup', 'Einstellungen', 'settings']];
  const navButton = ([id, text, icon]: [string, string, IconName]) => <button key={id} id={`nav-${id}`} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} aria-label={text} title={text} onClick={() => navigate(id)}><Icon name={icon}/><span>{text}</span>{id === 'live' && fresh && o.streaming && <span className="bcc-nav-tally" aria-label="OBS sendet"/>}</button>;
  return <div className="shell live-shell bcc-shell">
    <a className="bcc-skip" href="#bcc-content">Zum Inhalt</a>
    <aside className="bcc-rail">
      <div className="bcc-brand"><svg width="40" height="40" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 32A22 22 0 0 1 54 32ZM13 38H51A3 3 0 0 1 51 44H13A3 3 0 0 1 13 38ZM21 48H43A3 3 0 0 1 43 54H21A3 3 0 0 1 21 48Z" fill="currentColor"/></svg><span>Broadcast <strong>CC</strong><small>Service Control Center</small></span></div>
      <div className="bcc-rail-label">ARBEITSPLATZ</div><nav aria-label="Hauptnavigation">{navigation.map(navButton)}</nav>
      <div className="bcc-rail-secondary"><div className="bcc-rail-label">WERKZEUGE</div><nav aria-label="Erweiterte Werkzeuge">{navButton(['operator', 'OBS-Pult', 'sliders'])}{navButton(['log', 'Protokoll', 'history'])}</nav></div>
      <div className="bcc-rail-bottom"><div className="bcc-version">ALPHA <span>{s.version}</span></div><button type="button" className="bcc-theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'} title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}><Icon name={theme === 'dark' ? 'sun' : 'moon'}/><span>{theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}</span></button><button type="button" className="bcc-advanced" onClick={advanced}>Erweiterte Probe öffnen …</button><small>Gibt die Live-Steuerung ab. OBS läuft unverändert weiter.</small></div>
    </aside>
    <header id="live-banner" className="bcc-status" data-state={status} aria-label="Übertragungsstatus">
      <div id="transmission-status" data-state={status} role="status" aria-live="polite"><Badge tone={tone}>{label}</Badge></div>
      <div className="bcc-status-program"><span>OBS-Programm</span><strong id="live-program">{fresh ? o.program || 'Unbekannt' : 'Unbekannt'}</strong></div>
      <div className="bcc-status-clock" aria-label="Von OBS gemeldete Sendedauer">{fresh ? formatDuration(o.durationMs) : '—:—:—'}</div>
      {tab !== 'live' && <button className="bcc-back-live" type="button" onClick={() => navigate('live')}>Zur Live-Steuerung <Icon name="arrow"/></button>}
      <button id="release-live" className="bcc-release" type="button" onClick={release} title="Gibt nur die App-Steuerung frei. OBS und eine laufende Übertragung bleiben unverändert."><Icon name="shield"/><span>Steuerung abgeben</span></button>
    </header>
    <main id="bcc-content" className="bcc-main" tabIndex={-1}>{s.live.returnAt!==null&&<section className="bcc-global-return" aria-label="Automatische Rückkehr"><span role="status">{fresh?`Zurück zum Hauptbild in ${remainingReturnSeconds(s.live.returnAt,now)} s`:'Rückkehr nicht bestätigt · OBS prüfen'}</span><button id="cancel-live-return" type="button" onClick={cancelReturn}>Automatische Rückkehr abbrechen</button></section>}{children}<footer className="bcc-footer"><span>OBS und Geräte bleiben manuell bedienbar.</span><span id="live-mode" data-authorized={authorized}>{authorized ? 'Live-Steuerung aktiv' : 'Nur beobachten'}</span></footer></main>
  </div>;
}
export function ChannelReadout({s, fresh, status, openPlanning}: {openPlanning: () => void; s: LiveSiteSnapshot; fresh: boolean; status: string}) {
  const [tone, text] = statusLabels[status] || statusLabels.UNKNOWN;
  const o = s.live.observation;
  return <div className="bcc-channel-grid">
    <section className="bcc-channel" data-tone={tone} aria-label="OBS Encoder"><div className="bcc-card-heading"><div className="bcc-channel-name"><span className="bcc-language">DE</span><strong>Hauptübertragung</strong></div><Badge tone={tone}>{text}</Badge></div><p className="bcc-secondary">OBS-Encoder · Ziel aus Ihrer OBS-Konfiguration</p><div className="bcc-channel-values"><div><span>Sendedauer</span><strong className="bcc-mono">{fresh ? formatDuration(o.durationMs) : 'Unbekannt'}</strong></div><div><span>Verworfene Frames</span><strong className="bcc-mono">{fresh && o.skippedFrames !== null ? o.skippedFrames : '—'} <small>/ {fresh && o.totalFrames !== null ? o.totalFrames : '—'}</small></strong></div></div></section>
    <section className="bcc-channel bcc-unverified" aria-label="YouTube Status"><div className="bcc-card-heading"><strong>YouTube</strong><Badge>Nicht verifiziert</Badge></div><p>Diese Anzeige zeigt den Encoderstatus. Verwalten Sie YouTube-Termine, Serien und die verbundenen Kanäle in der Stream-Planung.</p><button id="desk-youtube-planning" type="button" className="bcc-text-action" onClick={openPlanning}>YouTube-Planung öffnen <Icon name="arrow"/></button><div className="bcc-provenance"><Icon name="help"/><span>„OBS sendet“ ist keine YouTube-Live-Bestätigung.</span></div></section>
  </div>;
}
export function Overview({s, fresh, status, now, navigate}: {s: LiveSiteSnapshot; fresh: boolean; status: string; now: number; navigate: (tab: string) => void}) {
  const service = upcomingService(s.workspace.services, now);
  return <><ChannelReadout s={s} fresh={fresh} status={status} openPlanning={()=>navigate('youtube')}/><div className="bcc-overview-grid"><article className="bcc-next-card"><div className="bcc-eyebrow">NÄCHSTER TERMIN</div><h2>{service?.title || 'Noch kein Termin geplant'}</h2><p className="bcc-next-date">{service ? formatBerlinDate(service.startsAt) : 'Legen Sie den nächsten Gottesdienst unter Termine an.'}</p><p className="bcc-secondary">Europe/Berlin · Lokal gespeicherte Planung</p><div className="toolbar"><button className="primary" type="button" onClick={() => navigate(service ? 'live' : 'schedule')}>{service ? 'Zur Übertragung' : 'Termin hinzufügen'} <Icon name="arrow"/></button><button type="button" onClick={() => navigate('schedule')}>Termine verwalten</button></div></article><article><h2>Verbindungen</h2><div className="bcc-device"><span>OBS Studio</span><Badge tone={fresh ? 'ready' : 'unknown'}>{fresh ? 'Live abgefragt' : 'Nicht bestätigt'}</Badge></div><div className="bcc-device"><span>Companion</span><Badge tone="unknown">Nicht überwacht</Badge></div><div className="bcc-device"><span>Kameras / Web Presenter</span><Badge tone="unknown">Nicht angebunden</Badge></div><button type="button" className="bcc-text-action" onClick={() => navigate('setup')}>Verbindungen prüfen <Icon name="arrow"/></button></article></div><article className="bcc-scope-note"><Icon name="shield"/><div><h3>Ein vertrauter Ablauf. Keine verdeckten Aktionen.</h3><p>Navigation, Terminplanung und Auswahl starten keinen Stream. Russische YouTube-Termine lassen sich mitplanen. Der Web Presenter wird manuell gestartet; Mitteilungen und Kamerafahrten werden nicht automatisch ausgelöst.</p></div></article></>;
}
/** Non-modal, docked panel: the global status and emergency release stay operable. */
export function CuePanel({title, close, children}: {title: string; close: () => void; children: ReactNode}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.focus({preventScroll: true});
    if (window.matchMedia('(max-width: 1100px)').matches) ref.current?.scrollIntoView({block: 'start'});
    return () => {if (opener instanceof HTMLElement && document.contains(opener)) opener.focus({preventScroll: true});};
  }, []);
  return <section ref={ref} className="bcc-cue-panel" aria-labelledby="cue-panel-title" role="region" tabIndex={-1} onKeyDown={e => {if (e.key === 'Escape') {e.stopPropagation(); close();}}}><div className="bcc-card-heading"><h2 id="cue-panel-title">{title}</h2><button id="close-cue-panel" type="button" className="bcc-icon-button" aria-label="Auswahl schließen" title="Auswahl schließen (Escape)" onClick={close}><Icon name="close"/></button></div><div className="bcc-cue-body">{children}</div></section>;
}
export function SceneTile({label, detail, icon, active, disabled, reason, onClick, id}: {label: string; detail: string; icon: IconName; active: boolean; disabled?: boolean; reason?: string; onClick: () => void; id: string}) {
  return <button type="button" id={id} className="bcc-scene" data-active={active} aria-pressed={active} disabled={disabled} title={reason || `${label}: ${detail}`} onClick={onClick}><Icon name={icon}/><strong>{label}</strong><span>{active ? 'OBS-Programm' : detail}</span></button>;
}
