import React,{useEffect,useRef,useState} from 'react';
import type {LiveAppBridge,LiveSiteSnapshot} from './live-app.ts';
import type {OperatorAction,OperatorQuery,OperatorView} from './obs-operator.ts';
import {operatorRequests} from './obs-operator.ts';
const errorText=(e:unknown)=>(e instanceof Error?e.message:'Inspection failed.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
const stateLabel=(v:boolean|null|undefined)=>v===true?'Active':v===false?'Off':'Unavailable / unknown';
export function OperatorPanel({api,s,act,now,onLive}:{api:LiveAppBridge;s:LiveSiteSnapshot;act:(fn:()=>Promise<unknown>)=>Promise<void>;now:number;onLive:()=>void}){
  const [view,setView]=useState<OperatorView|null>(null),[detail,setDetail]=useState<OperatorView|null>(null),[error,setError]=useState('');
  const [scene,setScene]=useState(''),[input,setInput]=useState(s.workspace.bindings.audioInput),[container,setContainer]=useState('');
  const [textInput,setTextInput]=useState(''),[caption,setCaption]=useState(''),[media,setMedia]=useState(''),[db,setDb]=useState('');
  const [itemsFor,setItemsFor]=useState(''),[reading,setReading]=useState(false);
  const current=useRef(s);current.current=s;const inFlight=useRef(false);const mounted=useRef(true);
  async function overview(manual=false){
    if(inFlight.current||current.current.live.busy||!current.current.live.connected)return;
    inFlight.current=true;
    try{const result=await api.operatorData({section:'overview'});if(mounted.current){setView(result);if(manual)setError('');}}
    catch(e){if(mounted.current&&manual)setError(errorText(e));}
    finally{inFlight.current=false;}
  }
  useEffect(()=>{mounted.current=true;void overview();const interval=setInterval(()=>void overview(),3000);return()=>{mounted.current=false;clearInterval(interval);};},[]);
  async function inspect(q:OperatorQuery){
    setReading(true);setError('');
    try{const result=await api.operatorData(q);if(!mounted.current)return;setDetail(result);if(q.section==='audio')setDb(result.volumeDb===null?'':String(Math.round(result.volumeDb*100)/100));if(q.section==='text')setCaption(result.caption||'');if(q.section==='items')setItemsFor(`${q.group?'g':'s'}:${q.container}`);}
    catch(e){setDetail(null);setError(errorText(e));}finally{setReading(false);}
  }
  const live=s.live,o=live.observation;
  const matched=!!view&&view.collection===o.collection&&view.profile===o.profile;
  const fresh=live.connected&&matched&&now-view!.checkedAt<8000;
  const blocked=live.busy||reading||!fresh||!live.permissions.operator||live.reasons.operator.length>0;
  async function send(intent:Record<string,unknown>){
    if(!view)return;const action={...intent,collection:view.collection,profile:view.profile} as OperatorAction;
    setDetail(null);await act(async()=>{await api.command('operator',JSON.stringify(action));});await overview(true);
  }
  function button(id:string,label:string,intent:Record<string,unknown>,extra=''){
    const a={...intent,collection:view?.collection||'',profile:view?.profile||''} as OperatorAction;
    const missing=view?operatorRequests(a).filter(n=>!view.available.includes(n)):[];
    const why=extra||(!fresh?'Waiting for a current operator snapshot.':!live.permissions.operator?'Enable OBS operator desk permission on Live Service.':missing.length?`Unavailable: ${missing.join(', ')}`:live.reasons.operator.join(' '));
    return <button id={id} disabled={blocked||!!extra||missing.length>0} title={why||'Review the target in the confirmation dialog.'} onClick={()=>void send(intent)}>{label}</button>;
  }
  const audio=detail?.section==='audio'&&detail.input===input?detail:null;
  const items=detail?.section==='items'&&itemsFor===container?detail:null;
  const txt=detail?.section==='text'&&detail.input===textInput?detail:null;
  const mediaInfo=detail?.section==='media'&&detail.input===media?detail:null;
  const detailFresh=(d:OperatorView|null)=>!!d&&live.connected&&d.collection===o.collection&&d.profile===o.profile&&now-d.checkedAt<30000;
  return <section id="obs-operator-panel">
    <div className="notice"><strong>OBS operator desk — real changes, not a layout editor.</strong><p>Use Live Service for the normal Intro / On Air / speaker / Bible / Outro / stream sequence. This desk operates existing OBS scenes, inputs and outputs. Every write has a target-specific confirmation and cancels pending automatic returns. Scene or source activation can also activate its configured audio/media.</p><p>No stream-key, encoder, profile, track-routing, filter or transform changes. YouTube event setup, cameras and hardware remain manual.</p></div>
    {!live.permissions.operator&&<div className="toolbar"><button id="operator-open-permissions" onClick={onLive}>Open Live Service permissions</button><span>Release existing control, check OBS operator desk, then enable the selected controls. No output changes occur just by enabling it.</span></div>}
    <div className="toolbar"><button id="operator-refresh" disabled={reading||live.busy||!live.connected} onClick={()=>void overview(true)}>Refresh OBS operator status</button><span id="operator-freshness">{fresh?'Current OBS snapshot':'Status stale, unavailable or disconnected — controls blocked'}</span></div>
    {error&&<p role="alert" className="alert">{error}</p>}
    {view&&<details><summary>Optional capability notes ({view.warnings.length})</summary>{view.warnings.map((x,i)=><p key={i}>{x}</p>)}</details>}
    <div className="two-col">
      <article><h2>All scenes / Studio Mode</h2><p>Studio Mode: <b>{fresh?stateLabel(view?.studio):'Unknown'}</b> · Preview: <b id="operator-preview-status">{fresh?view?.preview||'Not available':'Unknown'}</b></p>
        <label>Choose an existing scene<select id="operator-scene" value={scene} onChange={e=>setScene(e.target.value)}><option value="">Select scene…</option>{view?.scenes.map(n=><option key={n}>{n}</option>)}</select></label>
        <div className="toolbar">{button('operator-program','Show on Program…',{kind:'program',scene},!scene?'Select a scene.':'')}{button('operator-preview','Select in Preview…',{kind:'preview',scene},!scene?'Select a scene.':view?.studio!==true?'Studio Mode must be enabled.':'')}{button('operator-take','Transition Preview to Program…',{kind:'take',scene:view?.preview||''},view?.studio!==true||!view.preview?'Studio Mode and a confirmed Preview are required.':'')}</div>
        <div className="toolbar">{button('operator-studio-on','Enable Studio Mode…',{kind:'studio',enabled:true},view?.studio!==false?'Studio Mode must be confirmed off.':'')}{button('operator-studio-off','Disable Studio Mode…',{kind:'studio',enabled:false},view?.studio!==true?'Studio Mode must be confirmed on.':'')}</div><small>No video preview is embedded. Watch OBS. Direct scene changes do not run service-audio rules or select a speaker name.</small>
      </article>
      <article><h2>Input mute and level</h2><label>OBS input<select id="operator-audio-input" value={input} onChange={e=>{setInput(e.target.value);setDetail(null);setDb('');}}><option value="">Select input…</option>{view?.inputs.map(i=><option key={i.name}>{i.name}</option>)}</select></label><button id="operator-read-audio" disabled={!input||reading||live.busy||!live.connected} onClick={()=>void inspect({section:'audio',input})}>Read input state</button>
        <p id="operator-audio-status">{detailFresh(audio)?`Mute: ${audio!.muted===null?'Unavailable':audio!.muted?'Muted':'Unmuted'} · Level: ${audio!.volumeDb===null?'Unavailable':audio!.volumeDb.toFixed(2)+' dB'}`:'Read this input to inspect its current audio state.'}</p>
        <div className="toolbar">{button('operator-mute','Mute input…',{kind:'mute',input,muted:true},!detailFresh(audio)||audio!.muted===null?'Read a confirmed audio input.':'')}{button('operator-unmute','Unmute input…',{kind:'mute',input,muted:false},!detailFresh(audio)||audio!.muted===null?'Read a confirmed audio input.':'')}</div>
        <label>New level in dB (−100 to 0)<input id="operator-volume" type="number" min={-100} max={0} step={0.5} value={db} onChange={e=>setDb(e.target.value)}/></label>{button('operator-volume-apply','Apply level…',{kind:'volume',input,db:Number(db)},!detailFresh(audio)||audio!.volumeDb===null?'Read the current input level.':db===''||!Number.isFinite(Number(db))||Number(db)< -100||Number(db)>0?'Enter a level from -100 to 0 dB.':'')}<small>Mute is unchanged by a level adjustment. This is OBS input gain, not X32 or RØDECaster control.</small>
      </article>
      <article><h2>Source visibility</h2><label>Scene or group<select id="operator-container" value={container} onChange={e=>{setContainer(e.target.value);setDetail(null);}}><option value="">Select container…</option>{view?.scenes.map(n=><option key={'s:'+n} value={'s:'+n}>Scene: {n}</option>)}{view?.groups.map(n=><option key={'g:'+n} value={'g:'+n}>Group: {n}</option>)}</select></label><button id="operator-read-items" disabled={!container||reading||live.busy||!live.connected} onClick={()=>void inspect({section:'items',container:container.slice(2),group:container.startsWith('g:')})}>Read sources</button>
        {items?.items.map(i=><div className="list-row" key={i.id}><span>{i.source}<small>{detailFresh(items)?i.enabled?'Visible / enabled':'Hidden / disabled':'Stale — refresh sources'}</small></span>{button(`operator-show-${i.id}`,'Show…',{kind:'visibility',container:container.slice(2),group:container.startsWith('g:'),itemId:i.id,source:i.source,enabled:true},!detailFresh(items)?'Refresh sources first.':'')}{button(`operator-hide-${i.id}`,'Hide…',{kind:'visibility',container:container.slice(2),group:container.startsWith('g:'),itemId:i.id,source:i.source,enabled:false},!detailFresh(items)?'Refresh sources first.':'')}</div>)}<small>Use the group selector for nested sources. Shared groups and audio sources affect all scenes using them. No source is deleted.</small>
      </article>
      <article><h2>Manual text content</h2><label>Built-in OBS text input<select id="operator-text-input" value={textInput} onChange={e=>{setTextInput(e.target.value);setCaption('');setDetail(null);}}><option value="">Select text…</option>{view?.inputs.filter(i=>i.kind.startsWith('text_')).map(i=><option key={i.name}>{i.name}</option>)}</select></label><button id="operator-read-text" disabled={!textInput||reading||live.busy||!live.connected} onClick={()=>void inspect({section:'text',input:textInput})}>Read existing text</button>
        <label>Replacement text<textarea id="operator-text-value" style={{width:'100%',minHeight:100,marginTop:8}} value={caption} disabled={!txt} maxLength={2000} onChange={e=>setCaption(e.target.value)}/></label>{button('operator-text-apply','Apply text only…',{kind:'text',input:textInput,text:caption},!txt?'Read the current manual text source first.':'')}<small>File-backed text is refused. Fonts, text bounds, position, scale and crop are not changed. For speaker names, prefer the tested Live Service selector.</small>
      </article>
      <article><h2>Recording</h2><p id="operator-record-status">{fresh?stateLabel(view?.recording):'Unknown'}{fresh&&view?.recording&&view.paused?' · Paused':''}</p><div className="toolbar">{button('operator-record-start','Start recording…',{kind:'record',state:'start'},view?.recording!==false?'Recording must be confirmed off.':'')}{button('operator-record-stop','Stop recording…',{kind:'record',state:'stop'},view?.recording!==true?'Recording must be confirmed active.':'')}{button('operator-record-pause','Pause recording…',{kind:'record',state:'pause'},view?.recording!==true||view.paused!==false?'Recording must be active and unpaused.':'')}{button('operator-record-resume','Resume recording…',{kind:'record',state:'resume'},view?.recording!==true||view.paused!==true?'Recording must be paused.':'')}</div><small>Uses OBS recording settings. Recording controls do not stop the stream. Some recording configurations do not support pause.</small></article>
      <article><h2>Optional OBS outputs</h2><p>Replay Buffer: {fresh?stateLabel(view?.replay):'Unknown'}</p><div className="toolbar">{button('operator-replay-start','Start Replay Buffer…',{kind:'replay',state:'start'},view?.replay!==false?'Replay Buffer must be available and off.':'')}{button('operator-replay-stop','Stop Replay Buffer…',{kind:'replay',state:'stop'},view?.replay!==true?'Replay Buffer must be active.':'')}{button('operator-replay-save','Save replay…',{kind:'replay',state:'save'},view?.replay!==true?'Replay Buffer must be active.':'')}</div><p>Virtual Camera: {fresh?stateLabel(view?.virtualCamera):'Unknown'}</p><div className="toolbar">{button('operator-virtual-start','Start Virtual Camera…',{kind:'virtual-camera',enabled:true},view?.virtualCamera!==false?'Virtual Camera must be available and off.':'')}{button('operator-virtual-stop','Stop Virtual Camera…',{kind:'virtual-camera',enabled:false},view?.virtualCamera!==true?'Virtual Camera must be active.':'')}</div><small>An unavailable optional output never blocks the service workflow. This panel does not configure or install these features.</small></article>
      <article><h2>Media playback</h2><label>Media input<select id="operator-media-input" value={media} onChange={e=>{setMedia(e.target.value);setDetail(null);}}><option value="">Select media…</option>{view?.inputs.filter(i=>['ffmpeg_source','vlc_source'].includes(i.kind)).map(i=><option key={i.name}>{i.name}</option>)}</select></label><button id="operator-read-media" disabled={!media||reading||live.busy||!live.connected} onClick={()=>void inspect({section:'media',input:media})}>Read playback state</button><p>{detailFresh(mediaInfo)?mediaInfo!.mediaState||'Unknown':'Playback state not inspected'}</p><div className="toolbar">{(['play','pause','stop','restart'] as const).map(action=><React.Fragment key={action}>{button(`operator-media-${action}`,`${action}…`,{kind:'media',input:media,action},!detailFresh(mediaInfo)||!mediaInfo!.mediaState?'Read the media state first.':'')}</React.Fragment>)}</div><small>Media may carry audio and may be shared by the current Program scene. Short clips may finish before a playback confirmation is received.</small></article>
    </div>
  </section>;
}
