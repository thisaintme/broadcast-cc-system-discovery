'use strict';
// Runs in native Electron, using a disposable profile and no Google credentials.
const { app, BrowserWindow, Menu, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bcc-stream-management-'));
app.setPath('userData', profile);
const delay = ms => new Promise(r => setTimeout(r, ms));
async function wait(fn, label) {
  for (let i = 0; i < 240; i++) { const value = await fn(); if (value) return value; await delay(80); }
  throw Error('Timed out: ' + label);
}
const flatten = menu => menu.items.flatMap(i => [i, ...(i.submenu ? flatten(i.submenu) : [])]);
let unexpectedDialogs = 0;
dialog.showMessageBox = async () => { unexpectedDialogs++; return { response: 0, checkboxChecked: false }; };
// Refuse any real Google/YouTube request, including one introduced accidentally by a UI regression.
const nativeFetch = global.fetch;
let remoteRequests = 0;
global.fetch = (url, ...args) => {
  if (/^https?:/i.test(String(url))) {remoteRequests++; throw Error('Network not permitted in scheduling smoke test');}
  return nativeFetch(url, ...args);
};
const watchdog = setTimeout(() => { console.error('Stream Management smoke test timed out'); app.exit(1); }, 80000);
require('../dist/live-main.cjs');
(async () => {
  await app.whenReady();
  const menuItem = await wait(() => { const m=Menu.getApplicationMenu(); return m && flatten(m).find(i=>/Stream Management/.test(i.label)); }, 'Stream Management menu entry');
  const desk = await wait(() => BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === 'bcc://app/live.html' && !w.webContents.isLoading()), 'operator desk');
  menuItem.click(menuItem,desk);
  const win=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='bcc://app/stream-management.html'&&!w.webContents.isLoading()),'management window');
  const run = expr=>win.webContents.executeJavaScript(expr);
  await wait(()=>run("!!document.querySelector('nav[aria-label]') && !!window.streamManagement"),'management renderer and sandboxed preload');
  const panel=await run('window.streamManagement.panel()'); assert.equal(panel.ready,true); assert.equal(panel.error,''); assert.deepEqual(panel.accounts.map(a=>a.language).sort(),['de','ru']); assert.equal(panel.state.occurrences.length,0);
  const tab=async name=>{await run(`Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent===${JSON.stringify(name)}).click()`);await wait(()=>run(`document.querySelector('nav button[aria-current=page]')?.textContent===${JSON.stringify(name)}`),name);};
  await tab('Accounts'); await tab('Create');
  assert.match(await run('document.body.innerText'),/Create a broadcast or series/);
  const year=new Date().getUTCFullYear()+1;
  const plan={requestId:'ipc_preview',name:'Unlisted rehearsal',destinations:[{language:'de',title:{mode:'dated',text:'Gottesdienst'},description:'',privacy:'unlisted',madeForKids:false}],recurrence:{startDate:year+'-03-01',time:'11:00',timeZone:'Europe/Berlin',weekdays:[7],intervalWeeks:1,count:8,excludeDates:[]}};
  const dates=await run(`window.streamManagement.preview(${JSON.stringify(plan)})`);
  assert.equal(dates.length,8); assert.equal(new Set(dates.map(d=>d.date)).size,8);
  for(const d of dates){ const t=new Date(d.startsAt);assert.equal(t.getUTCDay(),0);assert.equal(new Intl.DateTimeFormat('de-DE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'}).format(t),'11:00'); }
  assert.equal(new Set(dates.map(d=>new Date(d.startsAt).getUTCHours())).size,2,'spring clock change');
  await assert.rejects(()=>run('window.streamManagement.preview({unexpected:true})'));
  assert.equal((await run('window.streamManagement.panel()')).state.occurrences.length,0);
  assert.equal(unexpectedDialogs,0);assert.equal(remoteRequests,0);
  fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/smoke-stream-management.png',(await win.webContents.capturePage()).toPNG());
  console.log('PASS: real menu, renderer, validated IPC, two account slots and 8 Sundays across DST; no Google call or event creation.');
})().then(()=>finish(0),e=>{console.error(e);finish(1);});
function finish(code){clearTimeout(watchdog);try{fs.rmSync(profile,{recursive:true,force:true});}catch{}app.exit(code);}
