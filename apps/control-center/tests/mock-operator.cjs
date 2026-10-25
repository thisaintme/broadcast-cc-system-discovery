/* Invented localhost-only OBS peer for operator operations. No site configuration. */
const baseMock=require('./mock-live.cjs');
const {WebSocketServer}=require('ws');const crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x));
const requests=['GetVersion','GetProfileList','GetSceneCollectionList','GetSceneList','GetGroupList','GetInputList','GetSceneItemList','GetGroupSceneItemList','GetSceneItemEnabled','GetInputSettings','GetInputDefaultSettings','GetInputMute','GetInputVolume','GetStreamStatus','StartStream','StopStream','GetCurrentPreviewScene','SetCurrentPreviewScene','SetCurrentProgramScene','GetStudioModeEnabled','SetStudioModeEnabled','TriggerStudioModeTransition','SetInputSettings','SetSceneItemEnabled','SetInputMute','SetInputVolume','GetRecordStatus','StartRecord','StopRecord','PauseRecord','ResumeRecord','GetReplayBufferStatus','StartReplayBuffer','StopReplayBuffer','SaveReplayBuffer','GetLastReplayBufferReplay','GetVirtualCamStatus','StartVirtualCam','StopVirtualCam','GetMediaInputStatus','TriggerMediaInputAction'];
function fixture(){
  const base=baseMock.fixture(),state=base.state;state.availableRequests=[...requests];state.unavailable.clear();
  state.scenes.push('Singing','Prayer','Break');for(const n of ['Singing','Prayer','Break'])state.nodes[n]=[];
  state.paused=false;state.replay=false;state.virtualCamera=false;state.lastReplay='';state.replayCount=0;
  state.volumes={Microphone:-12,'Other input':-8,'Media clip':-18};state.mutes['Media clip']=true;state.media='OBS_MEDIA_STATE_STOPPED';state.ignored=new Set();
  const handled=new Set(['GetCurrentPreviewScene','SetStudioModeEnabled','TriggerStudioModeTransition','GetInputVolume','SetInputVolume','GetRecordStatus','StartRecord','StopRecord','PauseRecord','ResumeRecord','GetReplayBufferStatus','StartReplayBuffer','StopReplayBuffer','SaveReplayBuffer','GetLastReplayBufferReplay','GetVirtualCamStatus','StartVirtualCam','StopVirtualCam','GetMediaInputStatus','TriggerMediaInputAction']);
  function request(name,data={}){
    if(name==='GetInputList'){const r=base.request(name,data);r.inputs.push({inputName:'Media clip',inputKind:'ffmpeg_source'});return r;}
    if(!handled.has(name))return base.request(name,data);
    state.calls.push({name,data:clone(data)});state.before(name,data);
    if(state.failures.has(name))throw Object.assign(new Error('PRIVATE_TEST_DIAGNOSTIC'),state.failures.get(name));
    if(state.unavailable.has(name))throw Object.assign(new Error('PRIVATE_UNAVAILABLE'),{code:604});
    let result={};
    switch(name){
      case 'GetCurrentPreviewScene':if(!state.studio)throw Object.assign(new Error('Studio disabled'),{code:506});return {currentPreviewSceneName:state.preview};
      case 'GetInputVolume':if(!Object.hasOwn(state.volumes,data.inputName))throw Object.assign(new Error('Not audio'),{code:605});return {inputVolumeDb:state.volumes[data.inputName]};
      case 'GetRecordStatus':return {outputActive:state.recording,outputPaused:state.paused,outputDuration:1000};
      case 'GetReplayBufferStatus':return {outputActive:state.replay};
      case 'GetVirtualCamStatus':return {outputActive:state.virtualCamera};
      case 'GetLastReplayBufferReplay':if(!state.lastReplay)throw Object.assign(new Error('Not saved'),{code:604});return {savedReplayPath:state.lastReplay};
      case 'GetMediaInputStatus':if(data.inputName!=='Media clip')throw Object.assign(new Error('Not media'),{code:605});return {mediaState:state.media,mediaCursor:0,mediaDuration:60000};
    }
    if(!state.ignored.has(name))switch(name){
      case 'SetStudioModeEnabled':state.studio=data.studioModeEnabled;state.onEvent('StudioModeStateChanged',{studioModeEnabled:state.studio});break;
      case 'TriggerStudioModeTransition':{if(!state.studio)throw new Error('Studio disabled');const previous=state.program;state.program=state.preview;state.preview=previous;state.onEvent('CurrentProgramSceneChanged',{sceneName:state.program});state.onEvent('CurrentPreviewSceneChanged',{sceneName:state.preview});break;}
      case 'SetInputVolume':state.volumes[data.inputName]=data.inputVolumeDb;state.onEvent('InputVolumeChanged',{inputName:data.inputName,inputVolumeDb:data.inputVolumeDb,inputVolumeMul:Math.pow(10,data.inputVolumeDb/20)});break;
      case 'StartRecord':state.recording=true;state.paused=false;break;
      case 'StopRecord':state.recording=false;state.paused=false;break;
      case 'PauseRecord':state.paused=true;break;
      case 'ResumeRecord':state.paused=false;break;
      case 'StartReplayBuffer':state.replay=true;break;
      case 'StopReplayBuffer':state.replay=false;break;
      case 'SaveReplayBuffer':state.lastReplay=`/synthetic/replay-${++state.replayCount}.mkv`;break;
      case 'StartVirtualCam':state.virtualCamera=true;break;
      case 'StopVirtualCam':state.virtualCamera=false;break;
      case 'TriggerMediaInputAction':state.media=data.mediaAction.endsWith('_PAUSE')?'OBS_MEDIA_STATE_PAUSED':data.mediaAction.endsWith('_STOP')?'OBS_MEDIA_STATE_STOPPED':'OBS_MEDIA_STATE_PLAYING';break;
      default:throw new Error('Unsupported mock operation');
    }
    state.writes.push({name,data:clone(data)});state.afterWrite(name,data);return result;
  }
  return {state,request};
}
async function start(){
  const f=fixture(),password='invented-operator-test-only',salt=crypto.randomBytes(12).toString('base64'),challenge=crypto.randomBytes(12).toString('base64');
  const hash=s=>crypto.createHash('sha256').update(s).digest('base64'),auth=hash(hash(password+salt)+challenge);
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));const clients=new Set();
  const emit=(name,data)=>{for(const c of clients)if(c.readyState===1)c.send(JSON.stringify({op:5,d:{eventType:name,eventIntent:8,eventData:data}}));};f.state.onEvent=emit;
  server.on('connection',ws=>{
    ws.send(JSON.stringify({op:0,d:{obsWebSocketVersion:'5.7.4',rpcVersion:1,authentication:{salt,challenge}}}));
    ws.on('message',buffer=>{
      const p=JSON.parse(String(buffer));if(p.op===1){if(p.d.authentication!==auth)return ws.close(4009);clients.add(ws);ws.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));return;}if(p.op!==6||!clients.has(ws))return;
      const {requestType,requestId,requestData={}}=p.d;
      try{const responseData=f.request(requestType,requestData);ws.send(JSON.stringify({op:7,d:{requestType,requestId,requestStatus:{result:true,code:100},responseData}}));}
      catch(e){ws.send(JSON.stringify({op:7,d:{requestType,requestId,requestStatus:{result:false,code:e.code||500,comment:'PRIVATE_TEST_DIAGNOSTIC'}}}));}
    });ws.on('close',()=>clients.delete(ws));
  });
  return {...f,password,url:`ws://127.0.0.1:${server.address().port}`,emit,close:async()=>{for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={fixture,start,fakePort:baseMock.fakePort,requests};
