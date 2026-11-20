import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {setImmediate as turn} from 'node:timers/promises';
import {Outbox} from '../captions/core.mjs';

test('first status enables the initially disabled arm control, without opening capture or allowing empty preview',async()=>{
  const html=await readFile(new URL('../captions/review.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../captions/review.js',import.meta.url),'utf8');
  const elements=new Map([...html.matchAll(/<[^<>]+\bid="([^"]+)"[^<>]*>/g)].map(m=>[m[1],{disabled:/\bdisabled\b/.test(m[0]),value:'',replaceChildren(){}}]));
  const choices=[];let allowed=false;
  const api={status:async()=>({armed:allowed,active:false,message:'Bereit',device:'DE',origin:'https://example.org',relay:'Bereit',archives:[]}),arm:async v=>{choices.push(v);allowed=v;}};
  assert.equal(elements.get('arm').disabled,true);
  runInNewContext(js,{document:{getElementById:id=>elements.get(id)},window:{captions:api},setInterval:()=>{}});
  await turn();assert.equal(elements.get('arm').disabled,false);assert.equal(elements.get('preview').disabled,true);assert.deepEqual(choices,[]);
  await elements.get('arm').onclick();assert.deepEqual(choices,[true]);assert.equal(elements.get('arm').textContent,'Mitschrift abschalten');
});

test('an unavailable relay is retried in sequence instead of blocking capture',async()=>{
  let online=false;const sent=[];const b=new Outbox('http://127.0.0.1:8787','x'.repeat(32),async(_,o)=>{if(!online)throw Error('offline');sent.push(JSON.parse(o.body).seq);return new Response(null,{status:204});});
  b.add({seq:1});b.add({seq:2});await turn();assert.equal(b.error,true);assert.deepEqual(sent,[]);
  online=true;await b.flush();assert.deepEqual(sent,[1,2]);assert.equal(b.error,false);
});
