/* Isolated Electron/IPC acceptance test; no real OBS, YouTube or church equipment. */
const {app,dialog}=require('electron');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {start}=require('../tests/mock-live.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bcc-live-smoke-'));app.setPath('userData',dir);
let peer,finished=false,allowGrant=false,allowStop=false,grants=0,stops=0;
const timer=setTimeout(()=>finish(1,new Error('Live UI test timed out')),90000);
dialog.showMessageBox=async(_window,options)=>{
  assert.equal(options.defaultId,0);
  if(options.message==='Enable live control of this OBS session?'){grants++;assert.match(options.detail,/Synthetic production collection/);return {response:allowGrant?1:0};}
  if(options.message==='Stop OBS transmission now?'){stops++;return {response:allowStop?1:0};}
  if(options.message==='Start the configured OBS stream?')return {response:1};
  return {response:0};
};
async function finish(code,error){if(finished)return;finished=true;clearTimeout(timer);if(error)console.error(error);if(peer)await peer.close();try{fs.rmSync(dir,{recursive:true,force:true});}catch{}app.exit(code);}
(async()=>{
  peer=await start();peer.state.streaming=true;
  const w={format:'broadcast-cc-workspace',version:1,obsUrl:peer.url,companionUrl:'http://127.0.0.1:8000',inventory:null,connections:[],bindings:{scenes:{intro:'Intro',main:'Main',speaker:'Speaker',bible:'Bible',outro:'Outro'},bibleText:'Reference text',nextServiceText:'Next date',audioInput:'Microphone'},captions:{speakerGroup:'Names',speakerPool:['Speaker A','Speaker B','Unused name'],speakerSources:{'Speaker A':'Speaker A','Speaker B':'Speaker B'}},services:[{id:'one',title:'Synthetic service',startsAt:'2026-10-25T10:00:00Z'},{id:'two',title:'Next service',startsAt:'2026-10-29T17:00:00Z'}],speakers:['Speaker A','Speaker B']};
  fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(w));
  app.on('browser-window-created',(_event,win)=>{
    win.webContents.once('did-finish-load',async()=>{
      const evaluate=code=>win.webContents.executeJavaScript(code);
      const wait=async(code,timeout=10000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,50));}throw new Error('UI condition timed out: '+code);};
      const click=async id=>{await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);await new Promise(r=>setTimeout(r,100));};
      const field=async(id,value,select=false)=>{await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(${select?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(select?'change':'input')},{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,100));};
      try{
        await wait("!!document.getElementById('nav-setup')");await click('nav-setup');
        await field('live-obs-password','wrong-test-password');await click('connect-live-obs');await wait("!document.getElementById('connect-live-obs').disabled && document.querySelector('[role=alert]')?.textContent.includes('password')");
        assert.equal(await evaluate("document.getElementById('live-obs-password').value"),'wrong-test-password');
        await field('live-obs-password',peer.password);await click('connect-live-obs');
        await wait("window.liveService.site().then(s=>s.workspace.inventory?.origin==='live' && !s.live.busy)");assert.equal(await evaluate("document.getElementById('live-obs-password').value"),'');
        assert.equal(peer.state.writes.length,0);assert.equal(peer.state.streaming,true);
        await click('nav-live');await field('live-service','one',true);await click('permission-scenes');await click('enable-live');
        assert.equal(grants,1);assert.equal(await evaluate("window.liveService.snapshot().then(s=>s.permissions.scenes)"),false);assert.equal(peer.state.writes.length,0);
        allowGrant=true;await click('enable-live');await wait("window.liveService.snapshot().then(s=>s.permissions.scenes)");assert.equal(peer.state.writes.length,0);
        assert.equal(await evaluate("document.getElementById('live-start').disabled"),true);
        await field('live-speaker-select','Speaker B',true);await click('live-speaker');await wait("window.liveService.snapshot().then(s=>s.observation.program==='Speaker' && !s.busy)");
        peer.state.mutes.Microphone=true;peer.emit('InputMuteStateChanged',{inputName:'Microphone',inputMuted:true});

        // Regression: the schedule remains editable with live control and a pending return.
        const beforeSchedule=await evaluate('window.liveService.site()');
        const scheduleWrites=peer.state.writes.length,oldNext=JSON.stringify(peer.state.settings['Next date']);
        await click('nav-schedule');
        assert.equal(await evaluate("document.getElementById('new-service-time').disabled"),false);
        assert.equal(await evaluate("document.getElementById('new-live-speaker').disabled"),true);
        assert.equal(await evaluate("document.querySelector('[data-remove-service=one]').disabled"),true);
        await field('service-title-preset','Andacht',true);await field('new-service-time','2026-10-27T12:00');
        await click('add-live-service');await wait("window.liveService.site().then(s=>s.workspace.services.length===3 && !s.live.busy)");
        const firstSchedule=await evaluate('window.liveService.site()');
        assert.equal(firstSchedule.workspace.services[1].title,'20261027 - Andacht');
        assert.equal(firstSchedule.live.selectedService,'one');
        assert.deepEqual(firstSchedule.live.permissions,beforeSchedule.live.permissions);
        assert.equal(firstSchedule.live.returnAt,beforeSchedule.live.returnAt);
        assert.equal(firstSchedule.live.phase,'speaker');assert.equal(peer.state.writes.length,scheduleWrites);
        assert.equal(JSON.stringify(peer.state.settings['Next date']),oldNext);
        assert.equal(peer.state.streaming,true);assert.equal(peer.state.mutes.Microphone,true);
        assert.deepEqual(firstSchedule.workspace.bindings,beforeSchedule.workspace.bindings);
        assert.deepEqual(firstSchedule.workspace.captions,beforeSchedule.workspace.captions);
        assert.equal(firstSchedule.workspace.inventory.origin,'live');
        const protectedError=await evaluate("window.liveService.changeServices({type:'remove',id:'one'}).then(()=>'',e=>e.message)");assert.match(protectedError,/selected service cannot be removed/i);
        const injectionError=await evaluate("window.liveService.changeServices({type:'add',service:{id:'bad',title:'Bad',startsAt:'2026-11-01T10:00:00Z'},bindings:{audioInput:'Other input'}}).then(()=>'',e=>e.message)");assert.match(injectionError,/Only service schedule fields/);
        assert.equal(await evaluate("window.liveService.site().then(s=>window.liveService.saveWorkspace(s.workspace)).then(()=>false,()=>true)"),true);
        // A second add merges with the first; remove an unselected entry using the actual UI.
        await field('new-service-time','2026-11-08T12:00');await click('add-live-service');
        await wait("window.liveService.site().then(s=>s.workspace.services.length===4 && !s.live.busy)");
        const extra=await evaluate("window.liveService.site().then(s=>s.workspace.services.find(x=>x.title==='20261108 - Andacht'))");
        await evaluate(`document.querySelector(${JSON.stringify('[data-remove-service="'+extra.id+'"]')}).click()`);
        await wait("window.liveService.site().then(s=>s.workspace.services.length===3 && !s.live.busy)");
        assert.equal(peer.state.writes.length,scheduleWrites);
        const during=await evaluate('window.liveService.snapshot()');assert.equal(during.returnAt,beforeSchedule.live.returnAt);assert.equal(during.selectedService,'one');
        const persisted=JSON.parse(fs.readFileSync(path.join(dir,'workspace.json'),'utf8'));
        assert.deepEqual(persisted.services,firstSchedule.workspace.services);
        await click('nav-live');assert.match(await evaluate("document.getElementById('next-live-service').textContent"),/27 Oct 2026/);
        await wait("window.liveService.snapshot().then(s=>s.observation.program==='Main' && !s.busy)",15000);assert.equal(peer.state.mutes.Microphone,true);
        assert.deepEqual(peer.state.writes.slice(scheduleWrites).map(x=>x.name),['SetCurrentProgramScene']);
        assert.equal(await evaluate("window.liveService.snapshot().then(s=>s.permissions.scenes)"),true);

        await click('live-bible');await wait("window.liveService.snapshot().then(s=>s.observation.program==='Bible' && !s.busy)");
        peer.state.program='Outro';peer.emit('CurrentProgramSceneChanged',{sceneName:'Outro'});await wait("window.liveService.snapshot().then(s=>s.returnAt===null)");
        await click('release-live');await wait("window.liveService.snapshot().then(s=>!s.permissions.scenes)");assert.equal(peer.state.streaming,true);
        await click('permission-scenes');await click('permission-audio');await click('permission-stream');await click('enable-live');await wait("window.liveService.snapshot().then(s=>s.permissions.stream && s.permissions.audio)");
        await click('live-on-air');await wait("window.liveService.snapshot().then(s=>s.observation.program==='Main' && s.observation.muted===false && !s.busy)");
        const shape=await evaluate("({overflow:document.documentElement.scrollWidth>innerWidth+2,mode:document.getElementById('live-mode').textContent,status:document.getElementById('transmission-status').textContent})");assert.equal(shape.overflow,false);assert.match(shape.mode,/LIVE CONTROL/);assert.match(shape.status,/TRANSMITTING/);
        fs.mkdirSync('release',{recursive:true});fs.writeFileSync('release/smoke-live.png',(await win.webContents.capturePage()).toPNG());
        const count=peer.state.writes.length;await click('live-stop');assert.equal(stops,1);assert.equal(peer.state.writes.length,count);assert.equal(peer.state.streaming,true);
        allowStop=true;await click('live-stop');await wait("window.liveService.snapshot().then(s=>s.observation.streaming===false && !s.busy)");assert.equal(peer.state.streaming,false);
        await click('live-start');await wait("window.liveService.snapshot().then(s=>s.observation.streaming===true && s.observation.program==='Intro' && !s.busy)");assert.equal(peer.state.mutes.Microphone,true);
        await click('release-live');assert.equal(peer.state.streaming,true);

        // Saving a schedule must neither discard nor authorize unrelated draft settings.
        const finalWrites=peer.state.writes.length;
        await click('nav-setup');await field('live-audio-input','Other input',true);
        await click('nav-schedule');await field('service-title-preset','custom',true);
        await field('new-service-custom-title','Custom gathering');await field('new-service-time','2026-11-15T12:00');await click('add-live-service');
        await wait("window.liveService.site().then(s=>s.workspace.services.length===4 && !s.live.busy)");
        await click('nav-setup');assert.equal(await evaluate("document.getElementById('live-audio-input').value"),'Other input');
        assert.equal(await evaluate("window.liveService.site().then(s=>s.workspace.bindings.audioInput)"),'Microphone');
        await click('discard-live-mappings');assert.equal(await evaluate("document.getElementById('live-audio-input').value"),'Microphone');
        const staleWorkspace=await evaluate('window.liveService.site().then(s=>s.workspace)');
        await evaluate("window.liveService.changeServices({type:'add',service:{id:'stale-proof',title:'Later service',startsAt:'2026-11-22T10:00:00Z'}})");
        await evaluate(`window.liveService.saveWorkspace(${JSON.stringify(staleWorkspace)})`);
        assert.equal(await evaluate("window.liveService.site().then(s=>s.workspace.services.some(x=>x.id==='stale-proof'))"),true);
        assert.equal(peer.state.writes.length,finalWrites);assert.equal(peer.state.streaming,true);
        const log=await evaluate('window.liveService.journal()');assert.ok(log.some(x=>x.action==='start'&&x.stage==='completed'));assert.ok(!JSON.stringify(log).includes(peer.password));
        const stored=fs.readFileSync(path.join(dir,'workspace.json'),'utf8');assert.ok(!stored.includes(peer.password));assert.ok(!stored.includes('livePermissions'));
        console.log('Live UI acceptance passed: authenticated join, permissions, actual caption timer/manual mute, live schedule add/remove without extra OBS writes, selected-service protection, persistence, retained unsaved mappings, stale-settings-save protection, external override, start/stop and release.');await finish(0);
      }catch(error){await finish(1,error);}
    });
  });
  require('../dist/live-main.cjs');
})().catch(error=>finish(1,error));
