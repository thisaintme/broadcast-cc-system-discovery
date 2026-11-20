import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const hash = x => createHash('sha256').update(x).digest();
const html = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live-Mitschrift</title><style>body{max-width:40rem;margin:auto;padding:1.3rem;font:1.2rem/1.5 system-ui;color:#142730}h1{font-size:1.65rem}header{border-bottom:1px solid #aaa}#status{font-size:1rem}time{font:small system-ui;color:#456}p{overflow-wrap:anywhere}</style><header><h1>Live-Mitschrift</h1><p>Deutsch · automatisch erkannt</p><p id="status" role="status">Verbindung wird aufgebaut …</p></header><main id="lines" role="log" aria-live="polite"></main><script src="/reader.js" defer></script></html>`;
const js = `const s=document.querySelector('#status'),l=document.querySelector('#lines'),e=new EventSource('/events');let last='';e.onopen=()=>s.textContent='Verbunden · warte auf Text';e.onerror=()=>s.textContent='Verbindung unterbrochen · neuer Versuch …';e.addEventListener('reset',()=>{l.replaceChildren();last='';});e.onmessage=m=>{if(m.lastEventId===last)return;last=m.lastEventId;const v=JSON.parse(m.data);if(v.kind==='start'){l.replaceChildren();s.textContent='Mitschrift geöffnet';}if(v.kind==='end'){s.textContent='Mitschrift beendet';}if(v.kind==='line'){const p=document.createElement('p'),t=document.createElement('time');t.textContent=new Date(v.at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});p.append(t,document.createElement('br'),document.createTextNode(v.text));l.append(p);while(l.children.length>150)l.firstChild.remove();s.textContent='Verbunden';}};`;
const validId = x => typeof x==='string' && /^[a-z0-9-]{36}$/i.test(x);
export function createRelay(token,{limit=256,readers=200,ttl=900_000,clock=Date.now}={}) {
  if(typeof token!=='string'||token.length<32) throw Error('Set BCC_CAPTION_TOKEN (at least 32 random characters).');
  const key=hash('Bearer '+token), clients=new Set();let sid='',seq=0,ended=false,ring=[],seen=new Map(),touched=0;
  const id = n => sid+':'+n;
  const push=(r,buf)=>{if(!r.write(buf))r.destroy();};
  const expire=()=>{const now=clock();for(const [k,until] of seen)if(until<now)seen.delete(k);if(sid&&now-touched>ttl){sid='';seq=0;ring=[];ended=false;for(const r of clients)push(r,'event: reset\ndata: {}\n\n');}};
  const server=http.createServer(async(q,r)=>{
    r.setHeader('Cache-Control','no-store');r.setHeader('X-Content-Type-Options','nosniff');r.setHeader('Referrer-Policy','no-referrer');r.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    const reply=(n,text='')=>{r.writeHead(n);r.end(text);};expire();
    if(q.method==='GET'&&['/','/reader.js'].includes(q.url)){r.setHeader('Content-Type',q.url==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8');return reply(200,q.url==='/'?html:js);}
    if(q.method==='GET'&&q.url==='/events'){
      if(clients.size>=readers)return reply(503);r.writeHead(200,{'Content-Type':'text/event-stream','X-Accel-Buffering':'no'});r.write('retry: 1500\n\n');
      const last=q.headers['last-event-id'],i=ring.findIndex(e=>e.id===last);if(i<0)r.write('event: reset\ndata: {}\n\n');for(const e of ring.slice(i+1))push(r,e.frame);clients.add(r);r.once('close',()=>clients.delete(r));return;
    }
    if(q.method!=='POST'||q.url!=='/publish')return reply(404);
    if(!timingSafeEqual(hash(q.headers.authorization||''),key))return reply(401);
    if(q.headers['content-type']?.split(';')[0]!=='application/json')return reply(415);
    let body='';try{for await(const chunk of q){body+=chunk.toString('latin1');if(body.length>8192)return reply(413);}const v=JSON.parse(Buffer.from(body,'latin1').toString('utf8'));
      if(!v||!validId(v.sid)||!Number.isSafeInteger(v.seq)||v.seq<1||!Number.isSafeInteger(v.at)||!Number.isFinite(new Date(v.at).getTime())||v.lang!=='de'||!['start','line','end'].includes(v.kind)||(v.kind==='line'&&(typeof v.text!=='string'||!v.text.trim()||v.text.length>1400)))return reply(400);
      if(v.sid!==sid){if(v.kind!=='start'||v.seq!==1||seen.has(v.sid)||(sid&&!ended))return reply(409);if(sid)seen.set(sid,clock()+ttl);sid=v.sid;seq=0;ring=[];ended=false;}
      if(v.seq<=seq)return reply(204);if(ended||v.seq!==seq+1||(v.kind==='start'&&seq!==0))return reply(409);
      const event={kind:v.kind,lang:'de',at:v.at,...(v.kind==='line'?{text:v.text}:{})};seq=v.seq;ended=v.kind==='end';touched=clock();const eid=id(seq),frame='id: '+eid+'\ndata: '+JSON.stringify(event)+'\n\n';ring.push({id:eid,frame});if(ring.length>limit)ring.shift();for(const client of clients)push(client,frame);return reply(204);
    }catch{return reply(400);}
  });
  const timer=setInterval(()=>{expire();for(const r of clients)push(r,': heartbeat\n\n');},15000);timer.unref();server.on('close',()=>clearInterval(timer));return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)createRelay(process.env.BCC_CAPTION_TOKEN).listen(Number(process.env.PORT||8787),'127.0.0.1',()=>console.log('Caption relay listening on loopback. Use a TLS reverse proxy for phones.'));
