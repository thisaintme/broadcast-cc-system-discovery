'use strict';
// CI-only check: start the mounted application with a fresh profile. No actions are sent to OBS or YouTube.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdtemp, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {createServer} = require('node:net');
const {setTimeout: delay} = require('node:timers/promises');
const WS = require('ws');
async function availablePort() {
  const socket = createServer();
  await new Promise((resolve,reject) => {socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function observe(url) {
  const ws = new WS(url, {handshakeTimeout:2000});
  try {
    return await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(Error('Renderer probe timed out')),3000);
      ws.once('error',e=>{clearTimeout(timer);reject(e);});
      ws.once('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'document.querySelector("#live-mode")?.textContent',returnByValue:true}})));
      ws.on('message',data=>{const r=JSON.parse(data);if(r.id===1){clearTimeout(timer);resolve(r.result?.result?.value);}});
    });
  } finally {ws.terminate();}
}
async function main() {
  const binary=process.argv[2];assert.ok(binary && binary.startsWith('/'),'Expected mounted app executable');
  const profile=await mkdtemp(join(tmpdir(),'bcc-mounted-preview-'));
  const port=await availablePort();
  const child=spawn(binary,[`--user-data-dir=${profile}`,'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],{stdio:'ignore'});
  let exited=false;const exit=new Promise(resolve=>{child.once('error',()=>{exited=true;resolve();});child.once('exit',()=>{exited=true;resolve();});});
  try {
    for(let i=0;i<100;i++){
      if(exited)throw Error('The packaged app exited before the desk loaded');
      let targets=[];try{const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1000)});targets=await r.json();}catch{}
      const desk=targets.find(t=>t.type==='page'&&t.url==='bcc://app/live.html');
      if(desk&&await observe(desk.webSocketDebuggerUrl)==='OBSERVE ONLY'){console.log('PASS: mounted universal application launched its real desk in observe-only mode.');return;}
      await delay(300);
    }
    throw Error('The mounted application did not render the observe-only desk');
  } finally {
    if(!exited)child.kill('SIGTERM');
    await Promise.race([exit,delay(2500)]);if(!exited){child.kill('SIGKILL');await exit;}
    await rm(profile,{recursive:true,force:true,maxRetries:4});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
