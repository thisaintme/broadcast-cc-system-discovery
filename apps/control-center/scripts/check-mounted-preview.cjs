'use strict';
// CI only: drive the executable inside the verified DMG, not the checkout.
// Use a disposable Chromium profile and never press Review and create on YouTube.
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,dirname}=require('node:path');
const {createServer}=require('node:net');
const {setTimeout:delay}=require('node:timers/promises');
const WS=require('ws');
async function freePort(){const s=createServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});const port=s.address().port;await new Promise(ok=>s.close(ok));return port;}
async function until(fn,label){const end=Date.now()+25000;while(Date.now()<end){const result=await fn();if(result)return result;await delay(150);}throw Error('Timed out: '+label);}
function evaluate(target,expression){return new Promise((ok,no)=>{const ws=new WS(target.webSocketDebuggerUrl,{handshakeTimeout:4000});const timer=setTimeout(()=>{ws.terminate();no(Error('Renderer timed out'));},5000);const done=(fn,value)=>{clearTimeout(timer);ws.terminate();fn(value);};ws.once('error',e=>done(no,e));ws.once('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})));ws.on('message',data=>{const r=JSON.parse(data);if(r.id!==1)return;if(r.error||r.result.exceptionDetails)return done(no,Error(r.error?.message||r.result.exceptionDetails?.exception?.description||'Renderer exception'));done(ok,r.result.result.value);});});}
function verifyNativePrebuilds(binary){
  // FreeType distributes both CPU variants in every package. They must remain
  // in separate arch-labelled directories, not be merged or dropped as duplicates.
  const root=join(dirname(binary),'..','Resources','app.asar.unpacked','node_modules','@julusian','freetype2','prebuilds');
  for(const [directory,architecture] of [['arm64','arm64'],['x64','x86_64']]){
    const file=join(root,'freetype2-darwin-'+directory,'node-napi-v7.node');
    const actual=execFileSync('/usr/bin/lipo',['-archs',file],{encoding:'utf8'}).trim().split(/\s+/);
    assert.ok(actual.includes(architecture),`Packaged ${directory} FreeType prebuild lacks ${architecture}: ${actual.join(' ')}`);
  }
  console.log('PASS mounted DMG native dependencies: FreeType arm64 and x86_64 prebuilds both present with the correct architecture.');
}
async function main(){
  const binary=process.argv[2];assert.ok(binary?.startsWith('/'));verifyNativePrebuilds(binary);const port=await freePort();const profile=await mkdtemp(join(tmpdir(),'bcc-mounted-'));
  const child=spawn(binary,[`--user-data-dir=${profile}`,'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{stdio:'ignore'});
  let exited=false;const exit=new Promise(ok=>{child.once('error',()=>{exited=true;ok();});child.once('exit',()=>{exited=true;ok();});});
  async function page(file){return until(async()=>{if(exited)throw Error('Packaged app exited');let pages=[];try{pages=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1000)})).json();}catch{}return pages.find(t=>t.type==='page'&&t.url===`bcc://app/${file}.html`);},file);}
  try{
    const desk=await page('live');const d=expr=>evaluate(desk,expr);
    await until(()=>d(`!!document.getElementById('v107-scene-main')`),'packaged V107 Regie');
    assert.equal(await d(`window.liveService.site().then(s=>s.version)`),require('../package.json').version);
    assert.equal(await d(`document.documentElement.dataset.theme`),'dark');
    assert.equal(await d(`document.querySelectorAll('.v107-scenes button').length`),8);
    assert.equal(await d(`document.querySelectorAll('#v107-audio').length`),1);
    assert.equal(await d(`window.liveService.site().then(s=>s.live.permissions.scenes)`),false);
    assert.equal(await d(`window.liveService.chapter('schlachter',42,3).then(c=>c.verses.find(v=>v.n===16).text.includes('Gott'))`),true);
    await d(`document.fonts.ready`);
    assert.equal(await d(`document.fonts.check('14px Inter')`),true);
    await d(`document.querySelector('#nav-setup').click()`);
    await until(()=>d(`!!document.querySelector('#save-obs-credential') && !!document.querySelector('#connect-saved-obs')`),'packaged credential settings');
    assert.equal(await d(`document.querySelector('#live-obs-password').type`),'password');
    await d(`document.querySelector('#nav-schedule').click()`);
    await until(()=>d(`document.body.innerText.includes('Sendereihe')`),'packaged reusable series screen');
    await d(`document.querySelector('#nav-youtube').click()`);
    const manage=await page('stream-management');const m=expr=>evaluate(manage,expr);
    const tab=async label=>{await until(()=>m(`!![...document.querySelectorAll('nav button')].find(b=>b.textContent===${JSON.stringify(label)})`),'tab '+label);await m(`[...document.querySelectorAll('nav button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);await until(()=>m(`document.querySelector('nav button[aria-current=page]')?.textContent===${JSON.stringify(label)}`),label);};
    await tab('Accounts');assert.match(await m('document.body.innerText'),/German · OBS/);assert.match(await m('document.body.innerText'),/Russian · Web Presenter/);
    const accounts=await m(`window.streamManagement.panel().then(p=>({ready:p.ready,langs:p.accounts.map(a=>a.language).sort(),count:p.state.occurrences.length}))`);assert.deepEqual(accounts,{ready:true,langs:['de','ru'],count:0});
    assert.equal(await m(`document.querySelectorAll('form[id^=key-form-] input[type=password]:not(:disabled)').length`),2);assert.ok(await m(`!!document.querySelector('#desktop-client-setup input[name=clientId]')`));
    await tab('Create');
    const toggle=label=>m(`[...document.querySelectorAll('form label')].find(l=>l.textContent.trim()===${JSON.stringify(label)}).querySelector('input').click()`);
    await toggle('Repeat as a series');await toggle('Include Russian channel');
    await until(()=>m(`document.querySelectorAll('form select[required]').length===2`),'separate destination audience choices');
    await m(`(()=>{const e=document.querySelector('input[type=date]');const year=new Date().getUTCFullYear()+1;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,year+'-03-01');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await m(`(()=>{for(const e of document.querySelectorAll('form select[required]')){e.value='false';e.dispatchEvent(new Event('change',{bubbles:true}));}for(const e of [...document.querySelectorAll('form select')].filter(e=>e.querySelector('option[value=unlisted]'))){e.value='unlisted';e.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
    await m(`document.querySelector('form button[type=submit]').click()`);
    await until(()=>m(`document.querySelectorAll('.preview .dates > div').length===8`),'eight actual preview rows');
    assert.match(await m(`document.querySelector('.preview').textContent`),/8 service\(s\) · 16 YouTube event\(s\)/);
    assert.match(await m(`document.querySelector('.preview').textContent`),/DE: unlisted · RU: unlisted/);
    const rows=await m(`[...document.querySelectorAll('.preview .dates > div')].map(e=>e.textContent)`);assert.equal(new Set(rows).size,8);for(const row of rows){const [date,time]=row.split(' · ');assert.equal(time,'11:00');assert.equal(new Date(date+'T12:00:00Z').getUTCDay(),0);}
    assert.equal(await m(`window.streamManagement.panel().then(p=>p.state.occurrences.length)`),0);
    console.log('PASS mounted DMG: V107 desk, offline Bible, local fonts → visible YouTube button → both accounts → eight Sundays at 11:00 / sixteen unlisted event previews. Nothing scheduled or transmitted.');
  }finally{if(!exited)child.kill('SIGTERM');await Promise.race([exit,delay(2000)]);if(!exited){child.kill('SIGKILL');await exit;}await rm(profile,{recursive:true,force:true,maxRetries:4});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
