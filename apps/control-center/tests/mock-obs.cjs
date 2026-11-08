/* Synthetic localhost OBS v5 peer for tests only. Never contacts broadcast hardware. */
const {WebSocketServer}=require('ws');
const {createHash,randomBytes}=require('node:crypto');
const {once}=require('node:events');
const sha=value=>createHash('sha256').update(value).digest('base64');
module.exports=async function mockObs(options={}){
  const password=options.password ?? ' synthetic-password-with-spaces ';
  const state={unavailable:new Set(options.unavailable ?? ['GetReplayBufferStatus','GetVirtualCamStatus']),failures:new Map(),requests:[],identified:0};
  const server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:65536});
  server.on('connection',socket=>{
    const salt=randomBytes(16).toString('base64'),challenge=randomBytes(16).toString('base64');
    let authenticated=false;
    socket.send(JSON.stringify({op:0,d:{obsWebSocketVersion:'5.7.4',rpcVersion:1,authentication:{salt,challenge}}}));
    socket.on('message',bytes=>{
      let packet;try{packet=JSON.parse(bytes.toString());}catch{socket.close(4002);return;}
      if(packet.op===1){
        if(packet.d?.authentication!==sha(sha(password+salt)+challenge)){socket.close(4009,'Authentication failed');return;}
        authenticated=true;state.identified++;socket.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));return;
      }
      if(!authenticated){socket.close(4007);return;}
      if(packet.op!==6){socket.close(4006);return;}
      const d=packet.d || {},name=d.requestType;state.requests.push(name);
      const replies={
        GetVersion:{obsVersion:'32.2.2',obsWebSocketVersion:'5.7.4',rpcVersion:1,availableRequests:[]},
        GetStreamStatus:{outputActive:false},GetRecordStatus:{outputActive:false},
        GetVirtualCamStatus:{outputActive:false},GetReplayBufferStatus:{outputActive:false},
        GetStudioModeEnabled:{studioModeEnabled:true},
        GetSceneList:{currentProgramSceneName:'Main',currentPreviewSceneName:'Intro',scenes:['Intro','Main','Speaker','Bible','Outro'].map(sceneName=>({sceneName}))},
        GetSceneCollectionList:{currentSceneCollectionName:'Synthetic collection',sceneCollections:['Synthetic collection']},
        GetInputList:{inputs:[{inputName:'Synthetic text',inputKind:'text_ft2_source_v2'}]},
        GetGroupList:{groups:['Synthetic group']},
        GetSceneItemList:{sceneItems:[{sceneItemId:1,sourceName:'Synthetic group',isGroup:true,sourceType:'OBS_SOURCE_TYPE_SCENE',sceneItemEnabled:true}]},
        GetGroupSceneItemList:{sceneItems:[{sceneItemId:2,sourceName:'Synthetic text',inputKind:'text_ft2_source_v2',sourceType:'OBS_SOURCE_TYPE_INPUT',sceneItemEnabled:true}]},
      };
      let failure=state.failures.get(name);
      if(!failure && state.unavailable.has(name))failure={code:604,comment:'Synthetic unavailable resource; RAW_DIAGNOSTIC_MUST_NOT_LEAK'};
      if(!failure && !replies[name])failure={code:204,comment:'Unknown request'};
      socket.send(JSON.stringify({op:7,d:{requestType:name,requestId:d.requestId,requestStatus:failure?{result:false,...failure}:{result:true,code:100},...(failure?{}:{responseData:replies[name]})}}));
    });
    socket.on('error',()=>{});
  });
  await once(server,'listening');
  return {url:`ws://127.0.0.1:${server.address().port}`,password,state,
    async close(){for(const client of server.clients)client.terminate();await new Promise(resolve=>server.close(resolve));}
  };
};
