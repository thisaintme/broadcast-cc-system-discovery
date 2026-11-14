/** Main-process-only device transports. Each request has a deadline and a fixed protocol shape.
 * No renderer-supplied addresses, OSC paths, HTTP URLs or raw bytes enter these functions.
 * Sources and hardware compatibility notes: docs/V107-DEVICE-PROTOCOLS.md.
 */
import net from 'node:net';
import dgram from 'node:dgram';
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import type {CameraDevice,NetworkDevice} from './presentation-model.ts';
import {deviceHost} from './presentation-model.ts';
import {LiveFailure} from './live-contract.ts';
export type Guard=()=>Promise<void>;
const fail=()=>new LiveFailure('Gerät nicht bestätigt. Verbindung und Einrichtung prüfen; die Aktion wird nicht wiederholt.');
const endpoint=(d:NetworkDevice)=>{const host=deviceHost(d.host);if(!d.enabled||!host||!Number.isInteger(d.port)||d.port<1||d.port>65535)throw fail();return {host,port:d.port};};
export const devicePause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export function equalSecret(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}

export interface PresenterStatus {state:'Idle'|'Connecting'|'Streaming'|'Interrupted'|'Flushing';bitrate:number|null;duration:string;cache:number|null;observedAt:number}
export interface PresenterTarget {key:string;platform:string;server:string;identity:string}
/** Do not export this object through IPC: stream settings contain credentials. */
interface PresenterPrivate {blocks:Record<string,Record<string,string>>;prelude:boolean;ack:number;version:number;stateVersion:number}
const streamNumber=(s:string|undefined,max=Number.MAX_SAFE_INTEGER):number|null=>s!==undefined&&/^\d+$/.test(s)&&Number(s)<=max?Number(s):null;
export function presenterPublic(data:PresenterPrivate):PresenterStatus {
  const b=data.blocks['STREAM STATE']||{},state=b.Status;
  if(!data.prelude||!['Idle','Connecting','Streaming','Interrupted','Flushing'].includes(state))throw fail();
  return {state:state as PresenterStatus['state'],bitrate:streamNumber(b.Bitrate),duration:/^\d{2,4}:\d{2}:\d{2}:\d{2}$/.test(b.Duration||'')?b.Duration:'',cache:streamNumber(b['Cache Used'],100),observedAt:Date.now()};
}
class PresenterSession {
  readonly data:PresenterPrivate={blocks:{},prelude:false,ack:0,version:0,stateVersion:0};
  private socket:net.Socket|null=null;private buffer='';private error=false;private listeners=new Set<()=>void>();private closed=false;
  constructor(private readonly device:NetworkDevice){}
  async connect(){const {host,port}=endpoint(this.device);this.socket=net.createConnection({host,port});this.socket.on('error',()=>{this.error=true;this.emit();});this.socket.on('close',()=>{this.error=true;this.emit();});this.socket.on('data',b=>{
    this.buffer+=b.toString('utf8').replace(/\r/g,'');if(this.buffer.length>128000){this.error=true;this.close();this.emit();return;}
    let end:number;while((end=this.buffer.indexOf('\n\n'))>=0){const raw=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+2);this.block(raw);}
  });await this.wait(()=>this.data.prelude,5000);const v=this.data.blocks['PROTOCOL PREAMBLE']?.Version;if(!/^1\.\d+$/.test(v||''))throw fail();}
  private emit(){for(const fn of this.listeners)fn();}
  private block(raw:string){const lines=raw.split('\n').filter(Boolean),name=lines.shift()?.replace(/:$/,'');if(!name)return;if(name==='NACK'){this.error=true;this.emit();return;}if(name==='ACK')this.data.ack++;
    if(name==='END PRELUDE')this.data.prelude=true;
    if(['PROTOCOL PREAMBLE','IDENTITY','STREAM SETTINGS','STREAM STATE'].includes(name)){const values=this.data.blocks[name]||{};for(const line of lines){const p=line.indexOf(':');if(p>0)values[line.slice(0,p)]=line.slice(p+1).trim();}this.data.blocks[name]=values;this.data.version++;if(name==='STREAM STATE')this.data.stateVersion++;}this.emit();}
  async wait(test:()=>boolean,ms:number){return new Promise<void>((resolve,reject)=>{const done=(err?:Error)=>{clearTimeout(timer);this.listeners.delete(check);err?reject(err):resolve();};const check=()=>{if(this.error||this.closed)done(fail());else if(test())done();};const timer=setTimeout(()=>done(fail()),ms);this.listeners.add(check);check();});}
  async query(){const version=this.data.stateVersion;this.write('STREAM STATE:\n\n');await this.wait(()=>this.data.stateVersion>version,3000);return presenterPublic(this.data);}
  target():PresenterTarget {const settings=this.data.blocks['STREAM SETTINGS']||{},identity=this.data.blocks.IDENTITY?.['Unique ID']||'';const platform=settings['Current Platform'],server=settings['Current Server'],key=settings['Stream Key'];
    // A built-in YouTube target only. Custom URL/SRT profiles must not masquerade as YouTube.
    if(!['YouTube','YouTube RTMP'].includes(platform)||!['Primary','Secondary','Primary (RTMPS)','Secondary (RTMPS)'].includes(server)||!key||!identity||settings['Customizable URL']==='true')throw new LiveFailure('Web Presenter: bitte ein festes YouTube-RTMP-Profil mit passendem Schlüssel auswählen.');return {key,platform,server,identity};}
  verify(target:PresenterTarget){const now=this.target();if(!equalSecret(now.key,target.key)||now.platform!==target.platform||now.server!==target.server||now.identity!==target.identity)throw new LiveFailure('Das Web-Presenter-Ziel hat sich geändert. Es wurde keine weitere Aktion gesendet.');}
  write(s:string){if(this.error||this.closed||!this.socket||this.socket.destroyed)throw fail();this.socket.write(s);}
  async change(action:'Start'|'Stop',target:PresenterTarget,guard:Guard){this.verify(target);const before=presenterPublic(this.data);if(action==='Start'&&before.state!=='Idle')throw new LiveFailure('Web Presenter sendet bereits oder sein Zustand ist offen.');if(action==='Stop'&&before.state==='Idle')return before;
    await guard();this.verify(target);const ack=this.data.ack,version=this.data.version;this.write(`STREAM STATE:\nAction: ${action}\n\n`);
    await this.wait(()=>this.data.ack>ack,4000);await guard();
    // An ACK is acceptance only, never a success. Poll read-only until actual state is confirmed.
    for(let i=0;i<40;i++){await guard();this.verify(target);const current=await this.query();await guard();this.verify(target);if(this.data.version>version&&current.state===(action==='Start'?'Streaming':'Idle'))return current;await devicePause(250);}throw fail();}
  close(){this.closed=true;this.socket?.destroy();this.buffer='';this.data.blocks={};this.emit();}
}
export async function readPresenter(d:NetworkDevice):Promise<PresenterStatus>{const s=new PresenterSession(d);try{await s.connect();return await s.query();}finally{s.close();}}
export async function reviewPresenter(d:NetworkDevice,key:string):Promise<{status:PresenterStatus;target:PresenterTarget}>{const s=new PresenterSession(d);try{await s.connect();const status=await s.query(),target=s.target();if(!equalSecret(target.key,key))throw new LiveFailure('Der gespeicherte russische Schlüssel stimmt nicht mit dem Web Presenter überein.');return {status,target};}finally{s.close();}}
export async function changePresenter(d:NetworkDevice,action:'Start'|'Stop',target:PresenterTarget,guard:Guard){const s=new PresenterSession(d);try{await s.connect();await s.query();return await s.change(action,target,guard);}finally{s.close();}}

/** One VISCA request per connection/UDP socket. Completion must match the ACK socket. */
async function visca(d:CameraDevice,bytes:Buffer,kind:'power'|'position'|'recall',guard:Guard):Promise<Buffer>{
  const {host,port}=endpoint(d);await guard();return new Promise((resolve,reject)=>{
    let done=false,buffer=Buffer.alloc(0),ack=-1;let tcp:net.Socket|undefined,udp:dgram.Socket|undefined;
    const finish=(result?:Buffer)=>{if(done)return;done=true;clearTimeout(timer);tcp?.destroy();try{udp?.close();}catch{}result?resolve(result):reject(fail());};
    const timer=setTimeout(()=>finish(),kind==='recall'?20000:3000);
    const onData=(data:Buffer)=>{buffer=Buffer.concat([buffer,data]);if(buffer.length>4096)return finish();let p:number;while((p=buffer.indexOf(0xff))>=0){const msg=buffer.subarray(0,p+1);buffer=buffer.subarray(p+1);if(msg[0]!==0x90||msg.length<3)continue;const type=msg[1]&0xf0,socket=msg[1]&0x0f;if(type===0x60)return finish();if(type===0x40&&msg.length===3)ack=socket;
      if(kind==='recall'&&type===0x50&&msg.length===3&&ack===socket)return finish(Buffer.from(msg));
      if(kind==='power'&&msg.length===4&&msg[1]===0x50&&[2,3].includes(msg[2]))return finish(Buffer.from(msg));
      if(kind==='position'&&msg.length===11&&msg[1]===0x50&&[...msg.subarray(2,10)].every(n=>n<16))return finish(Buffer.from(msg));
    }};
    const send=async()=>{try{await guard();if(done)return;if(tcp)tcp.write(bytes);else udp!.send(bytes,port,host,e=>{if(e)finish();});}catch{finish();}};
    if(d.protocol==='visca-udp'){udp=dgram.createSocket('udp4');udp.on('error',()=>finish());udp.on('message',(b,r)=>{if(r.address===host&&r.port===port)onData(b);});udp.bind(0,'0.0.0.0',()=>void send());}
    else{tcp=net.createConnection({host,port},()=>void send());tcp.on('data',onData);tcp.on('error',()=>finish());tcp.on('end',()=>finish());}
  });
}
const noop:Guard=async()=>{};
export async function readCamera(d:CameraDevice){const b=await visca(d,Buffer.from([0x81,9,4,0,255]),'power',noop);return {power:b[2]===2,observedAt:Date.now()};}
export async function recallCamera(d:CameraDevice,preset:number,guard:Guard){if(!Number.isInteger(preset)||preset<0||preset>127)throw fail();const power=await visca(d,Buffer.from([0x81,9,4,0,255]),'power',guard);if(power[2]!==2)throw new LiveFailure('Die Kamera ist im Bereitschaftsmodus. Bitte zuerst einschalten.');await visca(d,Buffer.from([0x81,1,4,0x3f,2,preset,255]),'recall',guard);await guard();const p=await visca(d,Buffer.from([0x81,9,6,0x12,255]),'position',guard);await guard();return {completed:true,position:p.subarray(2,10).toString('hex'),observedAt:Date.now()};}

const oscString=(s:string)=>{const bytes=Buffer.from(s+'\0');return Buffer.concat([bytes,Buffer.alloc((4-bytes.length%4)%4)]);};
export function busPath(bus:number){if(!Number.isInteger(bus)||bus<1||bus>16)throw fail();return `/bus/${String(bus).padStart(2,'0')}/mix/on`;}
export function oscBus(bus:number,value?:0|1){const head=oscString(busPath(bus));if(value===undefined)return head;const n=Buffer.alloc(4);n.writeInt32BE(value);return Buffer.concat([head,oscString(',i'),n]);}
export function parseBus(packet:Buffer,bus:number):0|1|null{const head=oscString(busPath(bus)),tag=oscString(',i');if(packet.length!==head.length+tag.length+4||!packet.subarray(0,head.length).equals(head)||!packet.subarray(head.length,head.length+tag.length).equals(tag))return null;const n=packet.readInt32BE(packet.length-4);return n===0||n===1?n:null;}
async function busRequest(d:NetworkDevice,bus:number,value:0|undefined,guard:Guard):Promise<0|1>{const {host,port}=endpoint(d);await guard();return new Promise((resolve,reject)=>{const socket=dgram.createSocket('udp4');let done=false,querying=value===undefined;const finish=(n?:0|1)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(queryTimer);try{socket.close();}catch{}n===undefined?reject(fail()):resolve(n);};const timer=setTimeout(()=>finish(),3000);let queryTimer:ReturnType<typeof setTimeout>|undefined;
  socket.on('error',()=>finish());socket.on('message',(b,r)=>{if(r.address!==host||r.port!==port||!querying)return;const n=parseBus(b,bus);if(n!==null)finish(n);});
  socket.bind(0,'0.0.0.0',()=>{void(async()=>{try{await guard();if(done)return;socket.send(oscBus(bus,value),port,host);if(value!==undefined)queryTimer=setTimeout(()=>{void(async()=>{try{await guard();if(done)return;querying=true;socket.send(oscBus(bus),port,host);}catch{finish();}})();},100);}catch{finish();}})();});
});}
export async function readMixer(d:NetworkDevice,buses:number[]){if(!buses.length)throw fail();const values:Record<number,boolean>={};for(const bus of buses)values[bus]=(await busRequest(d,bus,undefined,noop))===0;return {muted:values,observedAt:Date.now()};}
export async function muteMixer(d:NetworkDevice,buses:number[],guard:Guard){for(const bus of buses){await guard();if(await busRequest(d,bus,0,guard)!==0)throw fail();}await guard();return readMixer(d,buses);}

/** Key Light legacy HTTP API only. New mTLS-only models fail closed; never disable TLS to use them. */
async function lightRequest(d:NetworkDevice,body?:string):Promise<any>{const {host,port}=endpoint(d);return new Promise((resolve,reject)=>{let finished=false;const req=http.request({hostname:host,port,path:'/elgato/lights',method:body?'PUT':'GET',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})}},res=>{let data=Buffer.alloc(0);res.on('data',b=>{data=Buffer.concat([data,b]);if(data.length>65536)req.destroy();});res.on('end',()=>{if(finished)return;finished=true;clearTimeout(deadline);if(res.statusCode!==200)return reject(fail());try{resolve(JSON.parse(data.toString()));}catch{reject(fail());}});});const deadline=setTimeout(()=>req.destroy(),3500);req.on('error',()=>{if(finished)return;finished=true;clearTimeout(deadline);reject(fail());});req.on('close',()=>{if(!finished){finished=true;clearTimeout(deadline);reject(fail());}});req.end(body);});}
function lightValue(raw:any){if(!raw||!Number.isInteger(raw.numberOfLights)||raw.numberOfLights!==1||!Array.isArray(raw.lights)||raw.lights.length!==1||![0,1].includes(raw.lights[0]?.on))throw fail();return raw.lights[0].on===1;}
export async function readLight(d:NetworkDevice){return {on:lightValue(await lightRequest(d)),observedAt:Date.now()};}
export async function setLight(d:NetworkDevice,on:boolean,guard:Guard){await readLight(d);await guard();await lightRequest(d,JSON.stringify({numberOfLights:1,lights:[{on:on?1:0}]}));await guard();const next=await readLight(d);if(next.on!==on)throw fail();return next;}
