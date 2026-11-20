import {randomUUID} from 'node:crypto';
import {audible,stopped} from './core.mjs';
export class CaptionSession {
  constructor({capture,store,send,clock=Date.now,onError=()=>{},onClosed=()=>{}}){Object.assign(this,{capture,store,send,clock,onError,onClosed});this.epoch=0;this.retryAt=0;this.session=null;this.worker=null;this.key='';this.state=null;this.disabled=false;this.writes=Promise.resolve();}
  observe(s){this.state=s;this.tick();}
  record(kind,data={}){const s=this.session;if(!s)return;const event={sid:s.id,seq:++s.seq,kind,lang:'de',at:this.clock(),...data};const meta={...s};this.writes=this.writes.then(async()=>{await this.store(meta,event);this.send({sid:event.sid,seq:event.seq,kind,lang:'de',at:event.at,...(kind==='line'?{text:event.text}:{})});if(kind==='end')this.onClosed(meta,data.confirmed);}).catch(()=>{this.disabled=true;this.halt();this.onError('Lokales Archiv nicht beschreibbar. Mitschrift angehalten.');});}
  halt(){this.epoch++;const w=this.worker;this.worker=null;this.key='';try{w?.stop();}catch{}}
  abort(){this.halt();if(this.session){this.record('end',{confirmed:false});this.session=null;}this.state=null;}
  tick(){const s=this.state,now=this.clock();if(this.disabled)return;
    if(this.session&&s?.service&&s.service!==this.session.service){this.abort();return;}
    if(stopped(s,this.session,now)){this.halt();this.record('end',{confirmed:true,reference:s.reference||[]});this.session=null;return;}
    if(!audible(s,now)){if(this.worker)this.halt();return;}
    const key=JSON.stringify([s.service,s.program,s.input]);if(this.worker&&this.key===key)return;
    if(this.worker)this.halt();if(now<this.retryAt)return;
    if(!this.session){this.session={id:randomUUID(),service:s.service,startsAt:s.startsAt,seq:0};this.record('start');}
    const epoch=++this.epoch;this.key=key;
    const fail=()=>{if(epoch!==this.epoch)return;this.halt();this.retryAt=this.clock()+15000;this.onError('Spracherkennung nicht verfügbar. Programmrouting und Modell prüfen.');};
    try{this.worker=this.capture(text=>{if(epoch!==this.epoch||!audible(this.state,this.clock())||typeof text!=='string'||!text.trim()||text.length>1400)return;this.record('line',{text:text.trim(),role:s.role,speaker:this.state.speaker||'',reference:this.state.reference||[]});},fail);}catch{fail();}
  }
}
