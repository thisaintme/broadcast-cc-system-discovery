/* Synthetic loopback-only OBS peer. No real site data, devices or recordings. */
const {WebSocketServer}=require('ws');
const {createHash,randomBytes}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('base64');
module.exports=async function mockAudio(){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});
  await new Promise(resolve=>server.once('listening',resolve));
  const password='Synthetic-'+randomBytes(16).toString('hex');
  const state={requests:[],subscriptions:[],identified:0,sendMeters:true,muted:true,failures:new Map()};
  const subscriptions=new Map();
  const tracks={'1':true,'2':false,'3':false,'4':false,'5':false,'6':false};
  const inputs=[{inputName:'Synthetic pulpit feed',inputKind:'coreaudio_input_capture'},{inputName:'Synthetic capture feed',inputKind:'macos-avcapture'}];
  const reply=(ws,value)=>{if(ws.readyState===1)ws.send(JSON.stringify(value));};
  const broadcast=(eventType,eventData,eventIntent=8)=>{
    for(const [ws,mask]of subscriptions)if(mask&eventIntent)reply(ws,{op:5,d:{eventType,eventIntent,eventData}});
  };
  server.on('connection',ws=>{
    const salt=randomBytes(16).toString('base64'),challenge=randomBytes(16).toString('base64');
    let identified=false;
    reply(ws,{op:0,d:{obsWebSocketVersion:'5.5.0',rpcVersion:1,authentication:{salt,challenge}}});
    ws.on('message',bytes=>{
      const {op,d={}}=JSON.parse(bytes.toString());
      if(op===1){
        if(d.authentication!==hash(hash(password+salt)+challenge)){ws.close(4009,'Synthetic authentication rejection');return;}
        identified=true;state.identified++;subscriptions.set(ws,d.eventSubscriptions??2047);reply(ws,{op:2,d:{negotiatedRpcVersion:1}});return;
      }
      if(!identified){ws.close(4007);return;}
      if(op===3){subscriptions.set(ws,d.eventSubscriptions??2047);state.subscriptions.push(d.eventSubscriptions??2047);reply(ws,{op:2,d:{negotiatedRpcVersion:1}});return;}
      if(op!==6)return;
      const {requestType,requestId,requestData={}}=d;
      state.requests.push({name:requestType,data:requestData});
      let data={},failure=state.failures.get(requestType);
      if(!failure)switch(requestType){
        case 'GetVersion':data={obsVersion:'32.0.0',obsWebSocketVersion:'5.5.0',rpcVersion:1,availableRequests:[]};break;
        case 'GetSceneCollectionList':data={currentSceneCollectionName:'Synthetic audio collection',sceneCollections:['Synthetic audio collection']};break;
        case 'GetSceneList':data={currentProgramSceneName:'Main',currentPreviewSceneName:'Intro',scenes:['Intro','Main','Speaker','Bible','Outro'].map((sceneName,sceneIndex)=>({sceneName,sceneIndex}))};break;
        case 'GetGroupList':data={groups:[]};break;
        case 'GetSceneItemList':data={sceneItems:[]};break;
        case 'GetInputList':data={inputs};break;
        case 'GetInputMute':data={inputMuted:requestData.inputName==='Synthetic pulpit feed'?state.muted:false};break;
        case 'GetInputVolume':data={inputVolumeDb:0,inputVolumeMul:1};break;
        case 'GetInputAudioTracks':data={inputAudioTracks:tracks};break;
        case 'GetInputAudioMonitorType':data={monitorType:'OBS_MONITORING_TYPE_NONE'};break;
        case 'GetSourceActive':if(!requestData.sourceName)failure={code:300};else data={videoActive:requestData.sourceName==='Synthetic pulpit feed',videoShowing:true};break;
        case 'GetStreamStatus':case 'GetRecordStatus':data={outputActive:false};break;
        case 'GetVirtualCamStatus':case 'GetReplayBufferStatus':failure={code:604};break;
        case 'GetStudioModeEnabled':data={studioModeEnabled:true};break;
        default:failure={code:204};
      }
      reply(ws,{op:7,d:{requestType,requestId,requestStatus:failure?{result:false,code:failure.code,comment:'SYNTHETIC_RAW_NOT_FOR_REPORT'}:{result:true,code:100},responseData:data}});
    });
    ws.on('close',()=>subscriptions.delete(ws));
  });
  const timer=setInterval(()=>{if(state.sendMeters)broadcast('InputVolumeMeters',{inputs:[{inputName:'Synthetic pulpit feed',inputLevelsMul:[[state.muted?0:0.1,state.muted?0:0.25,0.5],[state.muted?0:0.1,state.muted?0:0.25,0.5]]}]},1<<16);},50);
  return {url:`ws://127.0.0.1:${server.address().port}`,password,state,broadcast,
    disconnect:()=>{for(const ws of server.clients)ws.terminate();},
    close:async()=>{clearInterval(timer);for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));}};
};
