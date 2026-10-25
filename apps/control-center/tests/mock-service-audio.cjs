/* Synthetic loopback OBS peer for selected-input muting. No real site data. */
const {fixture:captionFixture}=require('./mock-offline.cjs');
const {WebSocketServer}=require('ws');
const crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
  const base=captionFixture(),state=base.state;
  state.mutes={Microphone:false,'Other input':false};state.ignoreMuteWrite=false;
  state.muteReply=undefined;
  function request(name,data={}){
    if(name==='GetInputList'){
      const result=base.request(name,data);
      result.inputs.push({inputName:'Other input',inputKind:'coreaudio_input_capture'});
      return result;
    }
    if(name!=='GetInputMute'&&name!=='SetInputMute')return base.request(name,data);
    state.calls.push({name,data:clone(data)});state.before(name,data);
    if(state.failures.has(name))throw Object.assign(new Error('PRIVATE_DIAGNOSTIC'),state.failures.get(name));
    if(!Object.hasOwn(state.mutes,data.inputName))throw Object.assign(new Error('Missing audio input'),{code:600});
    if(name==='GetInputMute')return state.muteReply!==undefined?clone(state.muteReply):{inputMuted:state.mutes[data.inputName]};
    if(typeof data.inputMuted!=='boolean'||Object.keys(data).sort().join(',')!=='inputMuted,inputName')throw new Error('Invalid explicit mute request');
    if(!state.ignoreMuteWrite)state.mutes[data.inputName]=data.inputMuted;
    state.writes.push({name,data:clone(data)});
    if(!state.ignoreMuteWrite)state.onEvent('InputMuteStateChanged',{inputName:data.inputName,inputMuted:data.inputMuted});
    state.afterWrite(name,data);return {};
  }
  return {state,request};
}
async function start(){
  const f=fixture(),password='synthetic-audio-password',salt=crypto.randomBytes(12).toString('base64'),challenge=crypto.randomBytes(12).toString('base64');
  const hash=s=>crypto.createHash('sha256').update(s).digest('base64'),auth=hash(hash(password+salt)+challenge);
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));
  const clients=new Set();
  const emit=(name,data)=>{for(const c of clients)c.send(JSON.stringify({op:5,d:{eventType:name,eventIntent:8,eventData:data}}));};
  f.state.onEvent=emit;
  server.on('connection',ws=>{
    ws.send(JSON.stringify({op:0,d:{obsWebSocketVersion:'5.7.4',rpcVersion:1,authentication:{salt,challenge}}}));
    ws.on('message',buffer=>{
      const p=JSON.parse(String(buffer));
      if(p.op===1){if(p.d.authentication!==auth)return ws.close(4009);clients.add(ws);ws.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));return;}
      if(p.op===3&&clients.has(ws)){ws.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));return;}
      if(p.op!==6||!clients.has(ws))return;
      const {requestType,requestId,requestData={}}=p.d;
      try{const responseData=f.request(requestType,requestData);ws.send(JSON.stringify({op:7,d:{requestType,requestId,requestStatus:{result:true,code:100},responseData}}));}
      catch(error){ws.send(JSON.stringify({op:7,d:{requestType,requestId,requestStatus:{result:false,code:error.code||500,comment:'PRIVATE_DIAGNOSTIC'}}}));}
    });ws.on('close',()=>clients.delete(ws));
  });
  return {...f,password,url:`ws://127.0.0.1:${server.address().port}`,emit,close:async()=>{for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={fixture,start};
