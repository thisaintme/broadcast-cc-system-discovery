import { SignInSetup, ManualKey } from './stream-account-forms.tsx';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ManagementAction, ManagementBridge, ManagementPanel } from './stream-management-contract.ts';
import type { CreationPlan, DestinationDraft, Language, Occurrence, PlannedDate, Profile, Scope, Template } from './stream-management-model.ts';
import { eventTitle } from './stream-management-model.ts';
declare global {
    interface Window {
        streamManagement: ManagementBridge;
    }
}
// Same origin as the desk; share only the appearance preference, never account data.
const syncTheme=()=>{let theme='dark';try{if(localStorage.getItem('bcc-ui-theme')==='light')theme='light';}catch{}document.documentElement.dataset.theme=theme;};
syncTheme();window.addEventListener('storage',e=>{if(e.key==='bcc-ui-theme'||e.key===null)syncTheme();});
const bridge = window.streamManagement;
const presets = { de: ['Gottesdienst', 'Andacht'], ru: ['Богослужение', 'Духовное размышление'] };
const defaultDraft = (language: Language): DestinationDraft => ({ language, title: { mode: 'dated', text: presets[language][0] }, description: '', privacy: 'public', madeForKids: false });
const uid = () => crypto.randomUUID();
const tomorrow = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(Date.now() + 86400000));
type DraftForm = DestinationDraft & {
    audienceAnswered: boolean;
};
type Execute = (action: ManagementAction) => Promise<void>;
function DestinationEditor({ value, onChange }: {
    value: DraftForm;
    onChange: (value: DraftForm) => void;
}) {
    const set = (patch: Partial<DraftForm>) => onChange({ ...value, ...patch });
    return <fieldset><legend>{value.language === 'de' ? 'German · OBS' : 'Russian · Web Presenter'}</legend>
  <label>Title preset<select value={presets[value.language].includes(value.title.text) ? value.title.text : ''} onChange={e => { if (e.target.value)
        set({ title: { ...value.title, text: e.target.value } }); }}><option value="">Custom / saved title</option>{presets[value.language].map(t => <option key={t}>{t}</option>)}</select></label>
  <label>Title<input value={value.title.text} maxLength={value.title.mode === 'dated' ? 89 : 100} onChange={e => set({ title: { ...value.title, text: e.target.value } })} required/></label>
  <label className="check"><input type="checkbox" checked={value.title.mode === 'dated'} onChange={e => set({ title: { ...value.title, mode: e.target.checked ? 'dated' : 'custom' } })}/> Add YYYYMMDD date prefix</label>
  <label>Description<textarea value={value.description} maxLength={5000} rows={3} onChange={e => set({ description: e.target.value })}/></label>
  <div className="row"><label>Visibility<select value={value.privacy} onChange={e => set({ privacy: e.target.value as DestinationDraft['privacy'] })}><option value="public">Public</option><option value="unlisted">Unlisted · test</option><option value="private">Private</option></select></label>
  <label>Made for kids?<select required value={value.audienceAnswered ? String(value.madeForKids) : ''} onChange={e => set({ audienceAnswered: e.target.value !== '', madeForKids: e.target.value === 'true' })}><option value="">Select explicitly</option><option value="false">No</option><option value="true">Yes</option></select></label></div>
 </fieldset>;
}
function clean(value: DraftForm): DestinationDraft { const { audienceAnswered, ...draft } = value; if (!audienceAnswered)
    throw Error('Answer the made-for-kids question for each selected destination.'); return draft; }
function Composer({ panel, run, duplicate, onDone }: {
    panel: ManagementPanel;
    run: Execute;
    duplicate: Occurrence | null;
    onDone: () => void;
}) {
    const [requestId, setRequestId] = useState(uid), [name, setName] = useState('Gottesdienst'), [date, setDate] = useState(tomorrow), [time, setTime] = useState('11:00'), [series, setSeries] = useState(false), [weekdays, setWeekdays] = useState([7]), [interval, setInterval] = useState(1), [limit, setLimit] = useState<'count' | 'until'>('count'), [count, setCount] = useState(8), [until, setUntil] = useState(tomorrow), [exclusions, setExclusions] = useState(''), [ru, setRu] = useState(false), [deDraft, setDe] = useState<DraftForm>({ ...defaultDraft('de'), audienceAnswered: false }), [ruDraft, setRuDraft] = useState<DraftForm>({ ...defaultDraft('ru'), audienceAnswered: false }), [preview, setPreview] = useState<PlannedDate[]>([]), [error, setError] = useState(''), [submitted, setSubmitted] = useState(false);
    useEffect(() => { if (duplicate) {
        const de = duplicate.targets.find(t => t.language === 'de'), r = duplicate.targets.find(t => t.language === 'ru');
        if (de)
            setDe({ ...de.draft, audienceAnswered: true });
        if (r)
            setRuDraft({ ...r.draft, audienceAnswered: true });
        setRu(!!r);
        setName(de?.draft.title.text || 'Copied service');
        setTime(duplicate.time);
        setSubmitted(false);
        setRequestId(uid());
        setPreview([]);
    } }, [duplicate]);
    const plan = (): CreationPlan => ({ requestId, name, destinations: [clean(deDraft), ...(ru ? [clean(ruDraft)] : [])], ...(series ? { recurrence: { startDate: date, time, timeZone: 'Europe/Berlin' as const, weekdays, intervalWeeks: interval, ...(limit === 'count' ? { count } : { until }), excludeDates: exclusions.split(/[\s,]+/).filter(Boolean) } } : { single: { date, time } }) });
    const changed = () => { setPreview([]); setError(''); };
    const view = async () => { try {
        setError('');
        setPreview(await bridge.preview(plan()));
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Preview failed.');
    } };
    const submit = async () => { try {
        const p = plan();
        await run({ kind: 'create', plan: p });
        setSubmitted(true);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Creation was not confirmed.');
    } };
    const loadTemplate = (value: string) => { const template = panel.state.templates.find(t => t.id === value); if (!template)
        return; setName(template.name); for (const d of template.destinations)
        if (d.language === 'de')
            setDe({ ...d, audienceAnswered: true });
        else
            setRuDraft({ ...d, audienceAnswered: true }); setRu(template.destinations.some(d => d.language === 'ru')); changed(); };
    return <section className="card"><h2>Create a broadcast or series</h2><p>Events are created on YouTube when you confirm. Nothing starts automatically.</p>{error && <p role="alert" className="error">{error}</p>}
 <form onSubmit={e => { e.preventDefault(); void view(); }} onChange={changed}><fieldset disabled={panel.busy || submitted}><div className="row"><label>Saved template<select defaultValue="" onChange={e => loadTemplate(e.target.value)}><option value="">Choose a template</option>{panel.state.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Service / series name<input value={name} onChange={e => setName(e.target.value)} maxLength={100} required/></label></div>
 <div className="row"><label>{series ? 'Start date' : 'Date'}<input type="date" value={date} onChange={e => setDate(e.target.value)} required/></label><label>Time · Europe/Berlin<input type="time" value={time} onChange={e => setTime(e.target.value)} required/></label></div>
 <label className="check"><input type="checkbox" checked={series} onChange={e => setSeries(e.target.checked)}/> Repeat as a series</label>
 {series && <fieldset><legend>Recurrence</legend><div className="weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => <label className="check" key={label}><input type="checkbox" checked={weekdays.includes(i + 1)} onChange={e => setWeekdays(e.target.checked ? [...weekdays, i + 1] : weekdays.filter(d => d !== i + 1))}/>{label}</label>)}</div><div className="row"><label>Every … weeks<input type="number" min={1} max={52} value={interval} onChange={e => setInterval(+e.target.value)}/></label><label>End by<select value={limit} onChange={e => setLimit(e.target.value as typeof limit)}><option value="count">Occurrence count</option><option value="until">End date</option></select></label>{limit === 'count' ? <label>Occurrences<input type="number" min={1} max={104} value={count} onChange={e => setCount(+e.target.value)}/></label> : <label>Last date<input type="date" value={until} onChange={e => setUntil(e.target.value)}/></label>}</div><label>Excluded dates · YYYY-MM-DD, separated by commas<input value={exclusions} onChange={e => setExclusions(e.target.value)}/></label></fieldset>}
 <div className="destinations"><DestinationEditor value={deDraft} onChange={setDe}/>{ru && <DestinationEditor value={ruDraft} onChange={setRuDraft}/>}</div><label className="check"><input type="checkbox" checked={ru} onChange={e => setRu(e.target.checked)}/> Include Russian channel</label>
 <div className="actions"><button type="submit" className="primary">Preview dates and visibility</button><button type="button" onClick={() => { try {
        void run({ kind: 'template', template: { id: uid(), name, destinations: plan().destinations } }).catch(e => setError(e.message));
    }
    catch (e) {
        setError((e as Error).message);
    } }}>Save as template</button></div></fieldset></form>
 {!!preview.length && !submitted && <div className="preview"><h3>{preview.length} service(s) · {preview.length * (ru ? 2 : 1)} YouTube event(s)</h3><p>DE: {deDraft.privacy}{ru ? ` · RU: ${ruDraft.privacy}` : ''} · Europe/Berlin</p><div className="dates">{preview.map(p => <div key={p.date}>{p.date} · {p.time}</div>)}</div><button className="primary" disabled={panel.busy} onClick={() => void submit()}>Review and create on YouTube</button></div>}
 {submitted && <div className="preview"><p>This request has been submitted. Review individual results in Upcoming. Retry only failed destinations there; uncertain outcomes require recovery.</p><button onClick={() => { setRequestId(uid()); setSubmitted(false); setPreview([]); onDone(); }}>Start a separate new request</button></div>}
 </section>;
}
function Editor({ occurrence, run, close, busy }: {
    occurrence: Occurrence;
    run: Execute;
    close: () => void;
    busy: boolean;
}) {
    const [date, setDate] = useState(occurrence.date), [time, setTime] = useState(occurrence.time), [selection, setScope] = useState<Scope>('one'), [metadata, setMetadata] = useState(false), [drafts, setDrafts] = useState(occurrence.targets.filter(t => t.stage !== 'deleted').map(t => ({ ...t.draft, audienceAnswered: true }))), [error, setError] = useState('');
    const save = async () => { try {
        await run({ kind: 'edit', edit: { occurrenceId: occurrence.id, scope: selection, date, time, ...(metadata ? { destinations: drafts.map(clean) } : {}) } });
        close();
    }
    catch (e) {
        setError((e as Error).message);
    } };
    return <div className="editor" role="region" aria-label="Edit scheduled event"><h3>Edit / reschedule</h3>{error && <p role="alert" className="error">{error}</p>}<fieldset disabled={busy}><div className="row"><label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label><label>Time · Europe/Berlin<input type="time" value={time} onChange={e => setTime(e.target.value)}/></label><ScopePicker series={!!occurrence.seriesId} value={selection} set={setScope}/></div><label className="check"><input type="checkbox" checked={metadata} onChange={e => setMetadata(e.target.checked)}/> Also replace title, description and visibility</label>{metadata && <div className="destinations">{drafts.map((d, i) => <DestinationEditor key={d.language} value={d} onChange={v => setDrafts(drafts.map((d, j) => i === j ? v : d))}/>)}</div>}<p>Generated date prefixes follow rescheduling. Custom titles and one-off series exceptions remain intact.</p><div className="actions"><button onClick={() => void save()} className="primary">Review changes</button><button onClick={close}>Cancel edit</button></div></fieldset></div>;
}
function ScopePicker({ series, value, set }: {
    series: boolean;
    value: Scope;
    set: (scope: Scope) => void;
}) { return <label>Scope<select value={value} onChange={e => set(e.target.value as Scope)}><option value="one">Only this occurrence</option>{series && <><option value="following">This and following occurrences</option><option value="future">All future occurrences</option></>}</select></label>; }
function EventCard({ o, panel, run, editRun, onDuplicate }: {
    o: Occurrence;
    panel: ManagementPanel;
    run: Execute;
    editRun: Execute;
    onDuplicate: (o: Occurrence) => void;
}) {
    const [editing, setEditing] = useState(false), [selection, setScope] = useState<Scope>('one'), [recovery, setRecovery] = useState<Partial<Record<Language, string>>>({});
    const [adding, setAdding] = useState(false), [addedDraft, setAddedDraft] = useState<DraftForm>({ ...defaultDraft('ru'), audienceAnswered: false });
    const ru = o.targets.find(t => t.language === 'ru' && t.stage !== 'deleted');
    return <article className="card event"><div className="event-head"><div><small>{o.seriesId ? 'SERIES OCCURRENCE' : 'SINGLE SERVICE'}</small><h2>{o.date} · {o.time}</h2><span className="muted">Europe/Berlin{o.timeOverride ? ' · Individual time exception' : ''}</span></div><button disabled={panel.busy} onClick={() => onDuplicate(o)}>Duplicate</button></div>
 <div className="destinations">{o.targets.map(t => <section key={t.language} className={`target target-${t.stage}`}><div className="event-head"><strong>{t.language.toUpperCase()}</strong><span className="badge">{t.stage}{t.observed ? ` · ${t.observed.lifecycle}` : ''}</span></div><h3>{t.observed?.title || eventTitle(o.date, t.draft.title)}</h3><p>{t.observed?.privacy || t.draft.privacy} · {panel.accounts.find(a => a.channel?.id === t.channelId)?.channel?.title || t.channelId}</p>{t.observed && Number.isFinite(Date.parse(t.observed.startsAt)) && <p className="muted">YouTube scheduled: {new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t.observed.startsAt))}</p>}{t.checkedAt && <p className="muted">Last confirmed check: {new Date(t.checkedAt).toLocaleString()} · refresh for current status</p>}{t.error && <p role="status" className="error">{t.error}</p>}<div className="actions">{t.broadcastId && <><button disabled={panel.busy} onClick={() => void run({ kind: 'open', language: t.language, broadcastId: t.broadcastId })}>Open YouTube</button><button disabled={panel.busy} onClick={() => void run({ kind: 'copy-link', language: t.language, broadcastId: t.broadcastId })}>Copy link</button></>}{['pending', 'failed'].includes(t.stage) && <button disabled={panel.busy} onClick={() => void run({ kind: 'retry', occurrenceId: o.id, language: t.language })}>Retry {t.language.toUpperCase()} only</button>}{t.stage === 'ready' && ['created', 'ready'].includes(t.observed?.lifecycle || '') && <button disabled={panel.busy} onClick={() => void run({ kind: 'prepare', occurrenceId: o.id, language: t.language })}>Prepare profile</button>}</div>
 {t.stage === 'uncertain' && <div className="recovery"><p>Refresh this channel, then select the existing event. Do not create a duplicate.</p><label>Existing event<select value={recovery[t.language] || ''} onChange={e => setRecovery({ ...recovery, [t.language]: e.target.value })}><option value="">Choose after refresh</option>{(panel.remote[t.language] || []).filter(b => ['created', 'ready'].includes(b.lifecycle) && (!t.broadcastId || b.id === t.broadcastId)).map(b => <option key={b.id} value={b.id}>{b.title} · {b.startsAt}</option>)}</select></label><button disabled={panel.busy || !recovery[t.language]} onClick={() => void run({ kind: 'recover', occurrenceId: o.id, language: t.language, broadcastId: recovery[t.language]! })}>Review recovery</button></div>}
 </section>)}</div>
 <div className="actions"><button disabled={panel.busy} onClick={() => setEditing(!editing)}>Edit / reschedule</button><ScopePicker series={!!o.seriesId} value={selection} set={setScope}/><button disabled={panel.busy} className="danger" onClick={() => void run({ kind: 'remove', occurrenceId: o.id, scope: selection })}>Delete upcoming events</button>{!ru && <button disabled={panel.busy} onClick={() => setAdding(!adding)}>Add Russian occurrence</button>}{ru && <button disabled={panel.busy} onClick={() => void run({ kind: 'remove', occurrenceId: o.id, scope: 'one', language: 'ru' })}>Remove Russian occurrence</button>}<button disabled={panel.busy || o.targets.find(t => t.language === 'de')?.stage !== 'ready'} onClick={() => void run({ kind: 'operator', occurrenceId: o.id, germanOnly: !!ru })}>{ru ? 'Continue with German only' : 'Use on operator desk'}</button></div>
 {adding && <div className="editor"><DestinationEditor value={addedDraft} onChange={setAddedDraft}/><button disabled={panel.busy || !addedDraft.audienceAnswered} onClick={() => void editRun({ kind: 'add-destination', occurrenceId: o.id, draft: clean(addedDraft) }).then(() => setAdding(false)).catch(() => { })}>Review new Russian event</button></div>}
 {editing && <Editor occurrence={o} run={editRun} close={() => setEditing(false)} busy={panel.busy}/>}
 </article>;
}
function Accounts({ panel, run, setPanel }: {
    panel: ManagementPanel;
    run: Execute;
    setPanel: (p: ManagementPanel) => void;
}) {
    const [profiles, setProfiles] = useState<Partial<Record<Language, Profile[]>>>({}), [selection, setSelection] = useState<Partial<Record<Language, string>>>({}), [error, setError] = useState('');
    const load = async (lang: Language) => { try {
        setError('');
        const result = await bridge.action({ kind: 'profiles', language: lang });
        setPanel(result.panel);
        if (result.profiles)
            setProfiles({ ...profiles, [lang]: result.profiles });
    }
    catch (e) {
        setError((e as Error).message);
    } };
    return <section><h2>YouTube account management</h2><SignInSetup panel={panel} run={run}/><p>Everyone using this app has administrator access. Keys stay hidden unless explicitly revealed in a native dialog. Saving a profile never changes the encoder.</p>{error && <p className="error">{error}</p>}<div className="destinations">{panel.accounts.map(a => <article className="card" key={a.language}><h3>{a.language === 'de' ? 'German · OBS' : 'Russian · Web Presenter'}</h3><p><strong>{a.channel?.title || 'Not connected'}</strong><br /><small>{a.channel?.id || (a.configured?'Sign-in is configured. Choose Connect YouTube.':'Complete Google sign-in setup above to enable Connect YouTube.')}</small></p><div className="actions"><button disabled={panel.busy || !a.configured} onClick={() => void run({ kind: 'connect', language: a.language })}>{a.channel ? 'Reconnect' : 'Connect YouTube'}</button><button disabled={panel.busy || !a.channel} onClick={() => void run({ kind: 'disconnect', language: a.language })}>Disconnect</button></div><hr /><ManualKey account={a} run={run} disabled={panel.busy || !panel.ready}/><hr /><h4>Connected YouTube profile</h4><p>Saved profile: <strong>{a.profile?.title || 'Not selected'}</strong></p><p>Verified stream key: <code>{a.keySaved ? '•••• •••• •••• ••••' : 'Not saved'}</code></p><div className="actions"><button disabled={panel.busy || !a.channel} onClick={() => void load(a.language)}>Refresh profiles</button></div>{profiles[a.language] && <><label>Reusable YouTube profile<select value={selection[a.language] || ''} onChange={e => setSelection({ ...selection, [a.language]: e.target.value })}><option value="">Select a profile</option>{profiles[a.language]!.filter(p => p.reusable && p.channelId === a.channel?.id).map(p => <option key={p.id} value={p.id}>{p.title} · {p.status}</option>)}</select></label><button disabled={panel.busy || !selection[a.language]} onClick={() => void run({ kind: 'select-profile', language: a.language, profileId: selection[a.language]! })}>Save / refresh selected profile securely</button></>}<div className="actions">{(['reveal-key', 'copy-key', 'copy-server', 'forget-key'] as const).map((kind, i) => <button key={kind} disabled={panel.busy || !a.keySaved} onClick={() => void run({ kind, language: a.language })}>{['Reveal key', 'Copy key', 'Copy server', 'Forget saved key'][i]}</button>)}</div><p className="muted">A key reset must be performed in YouTube Studio. Refresh the profile here afterwards, then update the encoder. Local removal is not a YouTube reset.</p></article>)}</div></section>;
}
function External({ panel, run }: {
    panel: ManagementPanel;
    run: Execute;
}) { const [audiences, setAudiences] = useState<Record<string, string>>({}); return <section><h2>Other YouTube events</h2><p>Refresh each connected channel to inspect its events. Adopting one does not create a duplicate.</p>{panel.accounts.map(a => <section key={a.language}><h3>{a.language.toUpperCase()} · {a.channel?.title || 'Not connected'}</h3>{(panel.remote[a.language] || []).filter(b => !panel.state.occurrences.some(o => o.targets.some(t => t.channelId === b.channelId && t.broadcastId === b.id))).map(b => <article className="card" key={b.id}><h3>{b.title}</h3><p>{b.startsAt} · {b.privacy} · {b.lifecycle}</p><div className="actions"><button disabled={panel.busy} onClick={() => void run({ kind: 'open', language: a.language, broadcastId: b.id })}>Open YouTube</button>{['created', 'ready'].includes(b.lifecycle) && <><label>Made for kids?<select value={audiences[b.id] ?? (b.madeForKids === undefined ? '' : String(b.madeForKids))} onChange={e => setAudiences({ ...audiences, [b.id]: e.target.value })}><option value="">Select explicitly</option><option value="false">No</option><option value="true">Yes</option></select></label><button disabled={panel.busy || (audiences[b.id] === undefined && b.madeForKids === undefined) || audiences[b.id] === ''} onClick={() => void run({ kind: 'adopt', language: a.language, broadcastId: b.id, madeForKids: (audiences[b.id] ?? String(b.madeForKids)) === 'true' })}>Manage in this app</button></>}</div></article>)}</section>)}</section>; }
function App() {
    const [panel, setPanel] = useState<ManagementPanel | null>(null), [tab, setTab] = useState('Upcoming'), [error, setError] = useState(''), [duplicate, setDuplicate] = useState<Occurrence | null>(null);
    useEffect(() => { void bridge.panel().then(setPanel).catch(e => setError(e.message)); return bridge.subscribe(setPanel); }, []);
    const run: Execute = async (action) => { setError(''); try {
        const result = await bridge.action(action);
        setPanel(result.panel);
        if (result.panel.error)
            throw Error(result.panel.error);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Operation failed.');
        throw e;
    } };
    // Event handlers consume the rejection; edit/create callers retain it to keep forms open on failure.
    const safeRun: Execute = action => run(action).catch(() => { });
    if (!panel)
        return <main><h1>Stream Management</h1><p role="status">{error || 'Loading local settings…'}</p></main>;
    const states = (o: Occurrence) => o.targets.filter(t => t.stage !== 'deleted').map(t => t.observed?.lifecycle);
    const rows = panel.state.occurrences.filter(o => tab === 'Series' ? !!o.seriesId : tab === 'Live' ? states(o).some(s => ['live', 'liveStarting', 'testing', 'testStarting'].includes(s || '')) : tab === 'Past' ? o.targets.every(t => t.stage === 'deleted' || ['complete', 'revoked'].includes(t.observed?.lifecycle || '')) : !o.targets.every(t => t.stage === 'deleted' || ['complete', 'revoked'].includes(t.observed?.lifecycle || '')) && !states(o).some(s => ['live', 'liveStarting', 'testing', 'testStarting'].includes(s || ''))).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return <main><header><div><small>BROADCAST CONTROL CENTER</small><h1>Stream Management</h1><p>Plan services. Manage channels. Go live deliberately.</p></div><div className="actions">{panel.accounts.filter(a => a.channel).map(a => <button key={a.language} disabled={panel.busy || !panel.ready} onClick={() => void safeRun({ kind: 'refresh', language: a.language })}>Refresh {a.language.toUpperCase()}</button>)}<button disabled={panel.busy || !panel.ready} onClick={() => void safeRun({ kind: 'legacy-controls' })}>Broadcast controls</button>{panel.busy && <button onClick={() => void bridge.cancel()}>Cancel pending work</button>}</div></header>
 <nav aria-label="Stream management">{['Upcoming', 'Live', 'Past', 'Series', 'Create', 'Accounts', 'YouTube events'].map(value => <button aria-current={tab === value ? 'page' : undefined} key={value} onClick={() => setTab(value)}>{value}</button>)}</nav>
 {(error || panel.error) && <p role="alert" className="error">{error || panel.error}</p>}<p role="status" className="notice">{panel.busy ? 'Working — completed changes are saved individually. ' : ''}{panel.notice}</p>
 {!panel.ready && <p className="error">Management is unavailable until local data or secure storage can be read. No plaintext fallback is used.</p>}
 {tab === 'Create' ? <Composer panel={panel} run={run} duplicate={duplicate} onDone={() => setDuplicate(null)}/> : tab === 'Accounts' ? <Accounts panel={panel} run={safeRun} setPanel={setPanel}/> : tab === 'YouTube events' ? <External panel={panel} run={safeRun}/> : <><p>{rows.length} service(s){tab === 'Series' ? ' · Rules are shown below; edits affect one occurrence, following occurrences, or all future occurrences.' : ''}</p>{tab === 'Series' && panel.state.batches.filter(b => b.recurrence).map(b => <details className="card" key={b.id}><summary>{b.name}</summary><p>Original generation rule · weekdays {b.recurrence!.weekdays.join(', ')} (Monday = 1) · {b.recurrence!.time} · every {b.recurrence!.intervalWeeks} week(s)</p><p>Individual and future-occurrence edits are shown on the service cards below.</p><p>{b.recurrence!.count ? `${b.recurrence!.count} occurrences` : `Through ${b.recurrence!.until}`} · Europe/Berlin</p></details>)}{rows.map(o => <EventCard key={o.id} o={o} panel={panel} run={safeRun} editRun={run} onDuplicate={value => { setDuplicate(value); setTab('Create'); }}/>)}{!rows.length && <section className="card"><h2>No services in this view</h2><p>Create a single event or recurring series, or refresh YouTube and explicitly adopt an existing event.</p><button onClick={() => setTab('Create')}>Create service</button></section>}</>}
 <footer>Scheduling never changes encoder settings. Russian Web Presenter start/stop remains manual; Broadcast controls operate the German OBS destination only.</footer></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
