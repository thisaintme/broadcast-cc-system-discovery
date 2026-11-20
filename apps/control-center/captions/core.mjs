// Capture never opens on a default mic, a preview scene, stale telemetry or an outro.
export function fresh(s, now=Date.now()) { return !!s && s.connected===true && Number.isFinite(s.checkedAt) && now>=s.checkedAt && now-s.checkedAt<4000; }
export function audible(s,now=Date.now()) { return fresh(s,now)&&!!s.service&&s.streaming===true&&s.reconnecting===false&&s.muted===false&&s.busy===false&&s.allowed===true&&!!s.input&&!!s.program; }
export function stopped(s,session,now=Date.now()) { return !!session&&fresh(s,now)&&s.service===session.service&&s.streaming===false&&s.reconnecting===false; }
export function endpoint(origin){const u=new URL(origin);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname))))throw Error('Use an HTTPS relay origin (HTTP only on loopback).');return new URL('/publish',u).href;}
export function makeDraft(lines,current,day){
  if(!/^\d{8}$/.test(day))throw Error('Ungültiges Gottesdienstdatum.');
  const relevant=lines.filter(x=>x.kind==='line'&&['main','speaker','bible'].includes(x.role)&&typeof x.text==='string');
  const entries=relevant.map(x=>({...x,t:x.text.trim().replace(/\s+/g,' ')})).filter(x=>x.t.length>=20&&!/\b(termine|ansagen|bekanntmachungen|nächsten sonntag|herzlich willkommen|gottesdienst endet)\b/iu.test(x.t));
  if(!entries.length)throw Error('Zu wenig geeigneter Predigt- oder Lesungstext für einen Vorschlag.');
  const words=t=>new Set(t.toLowerCase().match(/[\p{L}]{5,}/gu)?.filter(w=>!['diese','dieser','diesen','dieses','haben','werden','unser','unsere','heute','nicht','wieder','immer','einen','einem','einer','durch','ihnen','jetzt'].includes(w))||[]);
  const counts=new Map();for(const x of entries)for(const w of words(x.t))counts.set(w,1+(counts.get(w)||0));
  const ranked=entries.map((x,i)=>({...x,i,score:[...words(x.t)].reduce((a,w)=>a+Math.min(5,counts.get(w)),0)/Math.sqrt(x.t.length)+(x.role==='speaker'?1:0)})).sort((a,b)=>b.score-a.score);
  const best=ranked[0].t;const headline=best.length>85?best.slice(0,84).replace(/\s+\S*$/,'')+'…':best.replace(/[.!?]+$/,'');
  const excerpts=[...new Map(ranked.map(x=>[x.t,x])).values()].slice(0,2).sort((a,b)=>a.i-b.i).map(x=>'„'+x.t+'“').join('\n');
  return {title:day+' - '+headline.charAt(0).toLocaleUpperCase('de')+headline.slice(1),description:[current.description||'','Aus der Predigt / Lesung (automatische Mitschrift):\n'+excerpts].filter(Boolean).join('\n\n')};
}
export function editableSnippet(snippet,title,description){if(typeof title!=='string'||!title.trim()||[...title].length>100||typeof description!=='string'||Buffer.byteLength(description)>5000||/[<>\u0000]/.test(title+description)||!snippet?.categoryId)throw Error('Titel, Beschreibung oder Kategorie ungültig. Bestehende Links nicht abschneiden.');return Object.fromEntries(Object.entries({...snippet,title:title.trim(),description}).filter(([k])=>['title','description','categoryId','tags','defaultLanguage','defaultAudioLanguage'].includes(k)));}
export class Outbox {
  constructor(url,token,http=fetch){this.url=endpoint(url);this.token=token;this.http=http;this.queue=[];this.busy=false;this.error=false;this.disabled=false;}
  add(event){if(this.disabled)return;if(this.queue.length>=8192){this.disabled=true;this.error=true;return;}this.queue.push(event);void this.flush();}
  async flush(){if(this.busy||this.disabled)return;this.busy=true;try{while(this.queue.length){const v=this.queue[0],r=await this.http(this.url,{method:'POST',headers:{authorization:'Bearer '+this.token,'content-type':'application/json'},body:JSON.stringify(v),signal:AbortSignal.timeout(3000),redirect:'error'});if(!r.ok)throw Error();this.queue.shift();}this.error=false;}catch{this.error=true;}finally{this.busy=false;}}
}
