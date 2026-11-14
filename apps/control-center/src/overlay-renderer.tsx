import React,{useEffect,useState,useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {SceneIcon} from './v107-icons.tsx';
import type {SceneIconName} from './v107-icons.tsx';
import type {OverlayPacket} from './presentation-service.ts';
import type {PresentationRole} from './presentation-model.ts';
const role=location.pathname.split('/').at(-1) as PresentationRole;
const key=new URLSearchParams(location.search).get('key')||'';
let connection:WebSocket|null=null;
function Overlay(){
  const [packet,setPacket]=useState<OverlayPacket|null>(null),[now,setNow]=useState(Date.now());
  useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;const connect=()=>{if(stopped)return;const ws=new WebSocket(`ws://${location.host}/events?role=${encodeURIComponent(role)}&key=${encodeURIComponent(key)}`);connection=ws;ws.onmessage=event=>{try{const next=JSON.parse(event.data);if(Number.isSafeInteger(next?.state?.revision))setPacket(next);}catch{/* Invalid payload does not replace the displayed state. */}};ws.onclose=()=>{if(!stopped)timer=setTimeout(connect,1500);};ws.onerror=()=>ws.close();};connect();const clock=setInterval(()=>setNow(Date.now()),200);return()=>{stopped=true;clearTimeout(timer);clearInterval(clock);connection?.close();};},[]);
  useLayoutEffect(()=>{if(!packet)return;let cancelled=false;const revision=packet.state.revision;void(async()=>{try{
    await document.fonts.ready;await Promise.all(Array.from(document.images).map(image=>image.decode()));
    for(const element of Array.from(document.querySelectorAll<HTMLElement>('.verses,.song-card>div,.lower-third strong,.title-card h1'))){element.style.fontSize='';for(let i=0;i<28&&(element.scrollHeight>element.clientHeight+2||element.scrollWidth>element.clientWidth+2);i++){const size=parseFloat(getComputedStyle(element).fontSize);if(size<=18)throw new Error('Text passt nicht in die Sendefläche.');element.style.fontSize=Math.max(18,size*.92)+'px';}}
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(Array.from(document.querySelectorAll<HTMLElement>('.verses,.song-card>div,.lower-third strong,.title-card h1')).some(e=>e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2))return;
    if(!cancelled&&connection?.readyState===WebSocket.OPEN)connection.send(JSON.stringify({kind:'rendered',revision,obs:!!(window as any).obsstudio}));
  }catch{/* Missing font/image must not be acknowledged as a successful rendering. */}})();return()=>{cancelled=true;};},[packet]);
  if(!packet)return null;
  const {state,config,nextService}=packet,logo=config.logo,image=config.images.find(i=>i.id===state.image),cue=state.cue&&state.cue.until>now?state.cue:null;
  const song=state.song,page=song?.pages[song.page];const chapter=state.chapter;
  const verses=chapter?.verses.filter(v=>v.n>=state.verse).slice(0,3)||[];
  const icon=config.scenes[role]?.icon;
  const iconElement=icon&&icon!=='none'?<SceneIcon name={icon as SceneIconName}/>:null;
  return <main className={`output output--${role}`}>
    {(role==='intro'||role==='outro')&&<section className="title-card"><div className="ambient"/>{logo&&<img className="title-logo" src={`/media/${logo}`} alt=""/>}<p>{config.churchName}</p><h1>{role==='intro'?config.introTitle:config.outroTitle}</h1>{role==='outro'&&<p className="next">{nextService}</p>}<span className="gold-rule"/></section>}
    {role==='interlude'&&image&&<img className={image.kind==='logo'?'interlude-logo':'interlude-image'} src={`/media/${image.file}`} alt=""/>}
    {role==='chapter'&&chapter&&<section className="chapter-card"><header><SceneIcon name="book"/><span>{chapter.name} {chapter.chapter}</span></header><div className="verses" key={`${chapter.translation}-${chapter.book}-${chapter.chapter}-${state.verse}`}>{verses.map(v=><p key={v.n} className={v.n===state.verse?'focus':''}><sup>{v.n}</sup>{v.omitted?'— (in dieser Ausgabe ohne Text)':v.text}</p>)}</div><footer>{chapter.attribution}</footer></section>}
    {role==='singing'&&song&&page?<section className={`song-card ${page.lines.length>8?'compact':''}`} key={`${song.id}-${song.page}`}><header>{song.title}<span>{page.label}</span></header><div>{page.lines.map((line,i)=><p key={i}>{line||'\u00a0'}</p>)}</div><footer>{song.copyright}</footer></section>:(role==='singing'||role==='prayer')&&<section className="invitation">{iconElement}<span>Lasst uns · <strong>{role==='prayer'?'beten':'singen'}</strong></span></section>}
    {role==='main'&&cue&&<section className="lower-third" key={`${cue.kind}-${cue.until}`}><SceneIcon name={cue.kind==='bible'?'book':'camera'}/><div><small>{cue.kind==='bible'?'Bibelstelle':'Sprecher'}</small><strong>{cue.text}</strong></div></section>}
    {logo&&!['intro','outro'].includes(role)&&!(role==='interlude'&&image?.kind==='logo')&&<img className="watermark" src={`/media/${logo}`} alt=""/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Overlay/>);
