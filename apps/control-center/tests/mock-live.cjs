/* Synthetic OBS only; random loopback port, invented collection and credentials. */
const {fixture:baseFixture}=require('./mock-service-audio.cjs');
const {WebSocketServer}=require('ws');const crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
  const base=baseFixture(),state=base.state;
  state.collection='Synthetic production collection';state.profile='Synthetic profile';state.reconnecting=false;state.streamReply=undefined;
  state.availableRequests=['GetStreamStatus','StartStream','StopStream'];state.ignoreStart=false;state.ignoreStop=false;
  function request(name,data={}){
    if(!['GetVersion','GetProfileList','GetStreamStatus','StartStream','StopStream'].includes(name))return base.request(name,data);
    state.calls.push({name,data:clone(data)});state.before(name,data);
    if(state.failures.has(name))throw Object.assign(new Error('PRIVATE_UPSTREAM_DIAGNOSTIC'),state.failures.get(name));
    if(name==='GetVersion')return {obsVersion:'32.2.2',obsWebSocketVersion:'5.7.4',availableRequests:state.availableRequests};
    if(name==='GetProfileList')return {currentProfileName:state.profile,profiles:[state.profile]};
    if(name==='GetStreamStatus')return state.streamReply!==undefined?clone(state.streamReply):{outputActive:state.streaming,outputReconnecting:state.reconnecting,outputDuration:600000,outputBytes:1234000,outputSkippedFrames:2,outputTotalFrames:3000};
    if(Object.keys(data).length)throw new Error('No stream destination changes permitted.');
    if(name==='StartStream'&&!state.ignoreStart){state.streaming=true;state.onEvent('StreamStateChanged',{outputActive:true,outputState:'OBS_WEBSOCKET_OUTPUT_STARTED'});}
    if(name==='StopStream'&&!state.ignoreStop){state.streaming=false;state.reconnecting=false;state.onEvent('StreamStateChanged',{outputActive:false,outputState:'OBS_WEBSOCKET_OUTPUT_STOPPED'});}
    state.writes.push({name,data:clone(data)});state.afterWrite(name,data);return {};
  }
  return {state,request};
}
function fakePort(f){
  const port={connected:false,onEvent:()=>{},onDisconnect:()=>{},isConnected(){return this.connected;},async connect(){this.connected=true;},async disconnect(){this.connected=false;this.onDisconnect();},async read(n,d={}){return f.request(n,d);},async change(n,d={}){f.request(n,d);}};
  f.state.onEvent=(n,d)=>port.onEvent(n,d);return port;
}
async function start(){
  const f=fixture(),password='invented-live-test-password',salt=crypto.randomBytes(12).toString('base64'),challenge=crypto.randomBytes(12).toString('base64');
  const hash=s=>crypto.createHash('sha256').update(s).digest('base64'),auth=hash(hash(password+salt)+challenge);
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));const clients=new Set();
  const emit=(name,data)=>{for(const c of clients)if(c.readyState===1)c.send(JSON.stringify({op:5,d:{eventType:name,eventIntent:8,eventData:data}}));};f.state.onEvent=emit;
  server.on('connection',ws=>{
    ws.send(JSON.stringify({op:0,d:{obsWebSocketVersion:'5.7.4',rpcVersion:1,authentication:{salt,challenge}}}));
    ws.on('message',buffer=>{
      const p=JSON.parse(String(buffer));
      if(p.op===1){if(p.d.authentication!==auth)return ws.close(4009);clients.add(ws);ws.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));return;}
      if(p.op!==6||!clients.has(ws))return;
      const {requestType,requestId,requestData={}}=p.d;
      try{const responseData=f.request(requestType,requestData);ws.send(JSON.stringify({op:7,d:{requestType,requestId,requestStatus:{result:true,code:100},responseData}}));}
      catch(e){ws.send(JSON.stringify({op:7,d:{requestType,requestId,requestStatus:{result:false,code:e.code||500,comment:'PRIVATE_UPSTREAM_DIAGNOSTIC'}}}));}
    });ws.on('close',()=>clients.delete(ws));
  });
  return {...f,password,url:`ws://127.0.0.1:${server.address().port}`,emit,close:async()=>{for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={fixture,fakePort,start};
