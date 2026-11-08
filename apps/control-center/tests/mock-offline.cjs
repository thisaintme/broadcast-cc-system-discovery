/* Synthetic OBS v5 peer. Binds only a random loopback port and uses invented scenes. */
const {WebSocketServer}=require('ws');
const crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x));
const item=(id,name,kind,enabled=true,group=false)=>({sceneItemId:id,sourceName:name,inputKind:kind,sceneItemEnabled:enabled,sourceType:group?'OBS_SOURCE_TYPE_SCENE':'OBS_SOURCE_TYPE_INPUT',isGroup:group});
function fixture(){
  const state={collection:'BCC TEST - synthetic',program:'Main',preview:'Intro',studio:true,streaming:false,recording:false,
    unavailable:new Set(['GetReplayBufferStatus','GetVirtualCamStatus']),failures:new Map(),calls:[],writes:[],onEvent:()=>{},before:()=>{},afterWrite:()=>{},
    scenes:['Intro','Main','Speaker','Bible','Outro'],groups:['Names','Reference'],
    nodes:{Intro:[],Main:[],Speaker:[item(1,'Names',null,true,true)],Bible:[item(2,'Reference',null,true,true)],Outro:[item(3,'Next date','text_ft2_source_v2')],
      Names:[item(101,'Speaker A','text_ft2_source_v2'),item(102,'Speaker B','text_ft2_source_v2',false),item(103,'Unused name','text_ft2_source_v2',false),item(104,'Speaker icon','image_source')],
      Reference:[item(201,'Reference text','text_ft2_source_v2'),item(202,'Microphone','coreaudio_input_capture'),item(203,'Bible icon','image_source')]},
    settings:{'Speaker A':{text:'Speaker A',from_file:false,font:{size:30}},'Speaker B':{text:'Speaker B',from_file:false,font:{size:30}},'Unused name':{text:'Unused name',from_file:false},'Reference text':{text:'Old reference',from_file:false,font:{size:28}},'Next date':{text:'Old date',from_file:false,font:{size:26}}},
  };
  function request(name,data={}){
    state.calls.push({name,data:clone(data)});state.before(name,data);
    if(state.failures.has(name))throw Object.assign(new Error('Synthetic private diagnostic'),state.failures.get(name));
    if(state.unavailable.has(name))throw Object.assign(new Error('Synthetic unavailable output'),{code:604});
    let result={},event;
    switch(name){
      case 'GetVersion':result={obsVersion:'32.2.2',obsWebSocketVersion:'5.7.4'};break;
      case 'GetStreamStatus':result={outputActive:state.streaming};break;
      case 'GetRecordStatus':result={outputActive:state.recording};break;
      case 'GetVirtualCamStatus':case 'GetReplayBufferStatus':result={outputActive:false};break;
      case 'GetStudioModeEnabled':result={studioModeEnabled:state.studio};break;
      case 'GetSceneCollectionList':result={currentSceneCollectionName:state.collection};break;
      case 'GetSceneList':result={scenes:state.scenes.map(sceneName=>({sceneName})),currentProgramSceneName:state.program,currentPreviewSceneName:state.preview};break;
      case 'GetGroupList':result={groups:state.groups};break;
      case 'GetSceneItemList':case 'GetGroupSceneItemList':if(!state.nodes[data.sceneName])throw Object.assign(new Error('Missing node'),{code:600});result={sceneItems:state.nodes[data.sceneName]};break;
      case 'GetInputList':result={inputs:[...Object.keys(state.settings).map(inputName=>({inputName,inputKind:'text_ft2_source_v2'})),{inputName:'Microphone',inputKind:'coreaudio_input_capture'}]};break;
      case 'GetInputSettings':if(!state.settings[data.inputName])throw Object.assign(new Error('Missing input'),{code:600});result={inputKind:'text_ft2_source_v2',inputSettings:state.settings[data.inputName]};break;
      case 'GetInputDefaultSettings':result={defaultInputSettings:{text:'',from_file:false}};break;
      case 'GetInputMute':result={inputMuted:true};break;
      case 'GetInputVolume':result={inputVolumeDb:-12};break;
      case 'GetInputAudioMonitorType':result={monitorType:'OBS_MONITORING_TYPE_NONE'};break;
      case 'GetInputAudioTracks':result={inputAudioTracks:{'1':true}};break;
      case 'GetSceneItemEnabled':{const i=state.nodes[data.sceneName]?.find(i=>i.sceneItemId===data.sceneItemId);if(!i)throw Object.assign(new Error('Missing item'),{code:600});result={sceneItemEnabled:i.sceneItemEnabled};break;}
      case 'SetInputSettings':{
        if(!state.settings[data.inputName]||data.overlay!==true||JSON.stringify(Object.keys(data.inputSettings))!=='["text"]')throw new Error('Unexpected text write');
        state.settings[data.inputName]={...state.settings[data.inputName],...data.inputSettings};
        event=['InputSettingsChanged',{inputName:data.inputName,inputSettings:state.settings[data.inputName]}];break;
      }
      case 'SetSceneItemEnabled':{
        const i=state.nodes[data.sceneName]?.find(i=>i.sceneItemId===data.sceneItemId);if(!i)throw new Error('Missing item');i.sceneItemEnabled=data.sceneItemEnabled;
        event=['SceneItemEnableStateChanged',data];break;
      }
      case 'SetCurrentProgramScene':if(!state.scenes.includes(data.sceneName))throw new Error('Missing scene');state.program=data.sceneName;event=['CurrentProgramSceneChanged',{sceneName:data.sceneName}];break;
      case 'SetCurrentPreviewScene':state.preview=data.sceneName;event=['CurrentPreviewSceneChanged',{sceneName:data.sceneName}];break;
      default:throw Object.assign(new Error('Unsupported synthetic request'),{code:204});
    }
    if(name.startsWith('Set')){state.writes.push({name,data:clone(data)});if(event)state.onEvent(...event);state.afterWrite(name,data);}
    return clone(result);
  }
  return {state,request};
}
async function start(){
  const f=fixture(),password='synthetic-test-password-only',salt=crypto.randomBytes(12).toString('base64'),challenge=crypto.randomBytes(12).toString('base64');
  const hash=s=>crypto.createHash('sha256').update(s).digest('base64');const auth=hash(hash(password+salt)+challenge);
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));
  const clients=new Set();const emit=(name,data)=>{for(const c of clients)c.send(JSON.stringify({op:5,d:{eventType:name,eventIntent:1,eventData:data}}));};
  f.state.onEvent=emit;
  server.on('connection',ws=>{
    ws.send(JSON.stringify({op:0,d:{obsWebSocketVersion:'5.7.4',rpcVersion:1,authentication:{salt,challenge}}}));
    ws.on('message',buffer=>{
      const p=JSON.parse(String(buffer));
      if(p.op===1){if(p.d.authentication!==auth)return ws.close(4009);clients.add(ws);ws.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));return;}
      if(p.op!==6||!clients.has(ws))return;
      const {requestType,requestId,requestData={}}=p.d;
      try{const responseData=f.request(requestType,requestData);ws.send(JSON.stringify({op:7,d:{requestType,requestId,requestStatus:{result:true,code:100},responseData}}));}
      catch(e){ws.send(JSON.stringify({op:7,d:{requestType,requestId,requestStatus:{result:false,code:e.code||500,comment:'Synthetic private diagnostic'}}}));}
    });
    ws.on('close',()=>clients.delete(ws));
  });
  return {...f,password,url:`ws://127.0.0.1:${server.address().port}`,emit,close:async()=>{for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={fixture,start};
