import {createServer} from 'node:http';
import type {Server} from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import type {Workspace,DeskRole} from './model.ts';
import type {LiveActionContext} from './live-actions.ts';
import {readCaptionGraph} from './offline.ts';
import {enabledPaths,requireScene} from './live-validation.ts';
import {LiveFailure} from './live-contract.ts';
import {PRESENTATION_ROLES,blankPresentationState,defaultPresentation,songPages,assetName,TRANSLATIONS} from './presentation-model.ts';
import type {PresentationState,PresentationRole,Translation} from './presentation-model.ts';
import type {ContentLibrary} from './content-library.ts';

export type PresentationAction = {kind:'hide'|'song-end'}|{kind:'song-start';id:string}|{kind:'song-page';page:number}|{kind:'chapter-show';translation:Translation;book:number;chapter:number;verse:number}|{kind:'verse';verse:number}|{kind:'image';id:string};
export function parsePresentationAction(raw:string):PresentationAction{
  let x:any;try{x=JSON.parse(raw);}catch{throw new LiveFailure('Ungültige Einblendung.');}
  if(!x||typeof x!=='object'||Array.isArray(x))throw new LiveFailure('Ungültige Einblendung.');
  const exact=(keys:string[])=>Object.keys(x).length===keys.length&&Object.keys(x).every(k=>keys.includes(k));
  const int=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
  if(['hide','song-end'].includes(x.kind)&&exact(['kind']))return x;
  if(['song-start','image'].includes(x.kind)&&exact(['kind','id'])&&typeof x.id==='string'&&x.id.length>0&&x.id.length<=100)return x;
  if(x.kind==='song-page'&&exact(['kind','page'])&&int(x.page,0,199))return x;
  if(x.kind==='verse'&&exact(['kind','verse'])&&int(x.verse,1,176))return x;
  if(x.kind==='chapter-show'&&exact(['kind','translation','book','chapter','verse'])&&Object.hasOwn(TRANSLATIONS,x.translation)&&int(x.book,0,65)&&int(x.chapter,1,150)&&int(x.verse,1,176))return x;
  throw new LiveFailure('Die Einblendung enthält ungültige oder unbekannte Werte.');
}
export interface PresentationPort {
  reset?(ctx:LiveActionContext):Promise<void>;
  prepare(role:PresentationRole,ctx:LiveActionContext):Promise<void>;
  cue(kind:'speaker'|'bible',text:string,ctx:LiveActionContext):Promise<void>;
  execute(action:PresentationAction,ctx:LiveActionContext,program:(role:DeskRole)=>Promise<void>):Promise<PresentationRole|null>;
}
export interface OverlayPacket {state:PresentationState;config:ReturnType<typeof defaultPresentation>;nextService:string}
export class PresentationService implements PresentationPort {
  private state=blankPresentationState();private server:Server|null=null;private socket:WebSocketServer|null=null;
  private clients=new Map<WebSocket,PresentationRole>();private waiters=new Map<number,{role:PresentationRole;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}[]>();
  private timer:ReturnType<typeof setTimeout>|null=null;private secret='';private port=0;private nextService='';
  constructor(private readonly workspace:()=>Workspace,private readonly library:ContentLibrary,private readonly directory:string,private readonly rendererDirectory:string,private readonly notify:()=>void){}
  snapshot():PresentationState{return structuredClone({...this.state,connected:this.clients.size>0});}
  private config(){return this.workspace().presentation||defaultPresentation();}
  sourceName(role:PresentationRole):string{return `${this.config().overlayInput} · ${role}`;}
  sourceURL(role:PresentationRole):string{return `http://127.0.0.1:${this.config().port}/overlay/${role}?key=${this.secret}`;}
  setNextService(value:string):void{this.nextService=value;}
  async start():Promise<void>{
    if(!this.config().enabled){await this.close();return;}
    if(this.server&&this.port===this.config().port)return;
    await this.close();await mkdir(this.directory,{recursive:true,mode:0o700});
    const keyFile=path.join(this.directory,'overlay-key');
    try{this.secret=(await readFile(keyFile,'utf8')).trim();if(!/^[a-f0-9]{64}$/.test(this.secret))throw new Error('Ungültiger Schlüssel.');}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new LiveFailure('Der lokale Einblendungszugang ist beschädigt.');this.secret=randomBytes(32).toString('hex');await writeFile(keyFile,this.secret,{mode:0o600,flag:'wx'});}
    this.port=this.config().port;
    const authorized=(url:URL)=>{const candidate=url.searchParams.get('key')||'';return /^[a-f0-9]{64}$/.test(candidate)&&timingSafeEqual(Buffer.from(candidate),Buffer.from(this.secret));};
    this.server=createServer(async(req,res)=>{
      const headers={'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'"};
      const fail=(code=404)=>{res.writeHead(code,headers);res.end();};
      if(req.headers.host!==`127.0.0.1:${this.port}`||req.method!=='GET')return fail(403);
      const url=new URL(req.url||'/',`http://127.0.0.1:${this.port}`);
      try{
        if(url.pathname.startsWith('/overlay/')){
          if(!authorized(url)||!PRESENTATION_ROLES.includes(url.pathname.slice(9) as PresentationRole))return fail(403);
          res.writeHead(200,{...headers,'Content-Type':'text/html'});res.end(await readFile(path.join(this.rendererDirectory,'overlay.html')));return;
        }
        const staticFiles:Record<string,[string,string]>={'/overlay-renderer.js':['overlay-renderer.js','text/javascript'],'/overlay.css':['overlay.css','text/css'],'/fonts/Inter.ttf':['fonts/Inter.ttf','font/ttf'],'/fonts/Literata.ttf':['fonts/Literata.ttf','font/ttf']};
        if(staticFiles[url.pathname]){const [file,type]=staticFiles[url.pathname];res.writeHead(200,{...headers,'Content-Type':type});res.end(await readFile(path.join(this.rendererDirectory,file)));return;}
        if(url.pathname.startsWith('/media/')){const file=assetName(url.pathname.slice(7));if(!this.config().images.some(i=>i.file===file)&&this.config().logo!==file)return fail();const data=await readFile(path.join(this.directory,'media',file));res.writeHead(200,{...headers,'Content-Type':'image/png'});res.end(data);return;}
        fail();
      }catch{fail();}
    });
    this.socket=new WebSocketServer({noServer:true,maxPayload:2048});
    this.server.on('upgrade',(req,stream,head)=>{
      const url=new URL(req.url||'/',`http://127.0.0.1:${this.port}`),role=url.searchParams.get('role') as PresentationRole;
      if(req.headers.host!==`127.0.0.1:${this.port}`||req.headers.origin!==`http://127.0.0.1:${this.port}`||url.pathname!=='/events'||!authorized(url)||!PRESENTATION_ROLES.includes(role)||this.clients.size>=24){stream.destroy();return;}
      this.socket!.handleUpgrade(req,stream,head,client=>{
        this.clients.set(client,role);this.send(client);this.notify();
        client.on('message',data=>{try{const message=JSON.parse(data.toString());if(message.kind!=='rendered'||message.obs!==true||!Number.isSafeInteger(message.revision))return;const waiting=this.waiters.get(message.revision)||[];for(const w of waiting.filter(w=>w.role===role)){clearTimeout(w.timer);w.resolve();}this.waiters.set(message.revision,waiting.filter(w=>w.role!==role));}catch{/* Read-only channel: malformed frames never become commands. */}});
        client.on('error',()=>client.close());client.on('close',()=>{this.clients.delete(client);this.notify();});
      });
    });
    try{await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(this.port,'127.0.0.1',()=>{this.server!.removeListener('error',reject);resolve();});});}
    catch{await this.close();throw new LiveFailure('Der lokale Einblendungsdienst konnte nicht starten. Bitte den Port prüfen.');}
    this.server.on('error',()=>{this.state.error='Einblendungsdienst nicht erreichbar.';this.notify();});
  }
  private send(client:WebSocket):void{if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify({state:this.state,config:this.config(),nextService:this.nextService} satisfies OverlayPacket));}
  private broadcast():void{for(const c of this.clients.keys())this.send(c);this.notify();}
  private async source(role:PresentationRole,ctx:LiveActionContext):Promise<void>{
    await ctx.check();if(!this.server||!this.config().enabled)throw new LiveFailure('Bitte den Einblendungsdienst einrichten.');
    const scene=await requireScene(ctx.reader,ctx.workspace,role),name=this.sourceName(role);
    const settings=await ctx.reader.read('GetInputSettings',{inputName:name});
    if(settings.inputKind!=='browser_source'||settings.inputSettings?.url!==this.sourceURL(role)||settings.inputSettings?.width!==1920||settings.inputSettings?.height!==1080)throw new LiveFailure('Die Browserquelle stimmt nicht mit der eingerichteten Einblendung überein. Bitte die Einrichtung prüfen.');
    if(enabledPaths(await readCaptionGraph(ctx.reader,scene),scene,name)!==1)throw new LiveFailure('Die Einblendung benötigt genau einen sichtbaren Pfad in der Zielszene.');
    await ctx.check();
  }
  private async update(role:PresentationRole,patch:Partial<PresentationState>,ctx:LiveActionContext):Promise<void>{
    await this.source(role,ctx);await ctx.verified('Lokale Einblendung geprüft; Darstellung angefordert.');await ctx.check();
    const revision=this.state.revision+1;this.state={...this.state,...patch,revision,requested:true,confirmedAt:null,error:''};
    const pending=new Promise<void>((resolve,reject)=>{const w={role,resolve,reject,timer:setTimeout(()=>reject(new LiveFailure('OBS hat die Einblendung nicht bestätigt. Keine automatische Wiederholung.')),6500)};this.waiters.set(revision,[w]);});
    this.broadcast();
    try{await pending;await ctx.check();if(this.state.revision!==revision)throw new LiveFailure('Die Einblendung wurde inzwischen ersetzt.');this.state.requested=false;this.state.confirmedAt=Date.now();await ctx.verified('Die OBS-Browserquelle hat die Darstellung bestätigt.');}
    catch(error){this.state.requested=false;this.state.confirmedAt=null;this.state.error='Einblendung nicht bestätigt · OBS prüfen';throw error;}
    finally{for(const w of this.waiters.get(revision)||[])clearTimeout(w.timer);this.waiters.delete(revision);this.notify();}
  }
  async reset(ctx:LiveActionContext):Promise<void>{if(this.timer)clearTimeout(this.timer);this.timer=null;await this.update('intro',{cue:null,song:null,chapter:null,verse:1,history:[],image:this.config().image},ctx);}
  async prepare(role:PresentationRole,ctx:LiveActionContext):Promise<void>{
    if(this.timer)clearTimeout(this.timer);this.timer=null;
    await this.update(role,{scene:role,cue:null,song:role==='singing'?this.state.song:null,image:this.state.image||this.config().image},ctx);
  }
  async cue(kind:'speaker'|'bible',text:string,ctx:LiveActionContext):Promise<void>{
    const until=Date.now()+this.config().cueSeconds*1000;
    await this.update('main',{cue:{kind,text,until},history:kind==='bible'?[{reference:text,at:Date.now()},...this.state.history.filter(i=>i.reference!==text)].slice(0,12):this.state.history},ctx);
    if(this.timer)clearTimeout(this.timer);const revision=this.state.revision;
    this.timer=setTimeout(()=>{if(this.state.revision===revision){this.state={...this.state,cue:null,revision:revision+1};this.broadcast();}},Math.max(0,until-Date.now()));
  }
  async execute(action:PresentationAction,ctx:LiveActionContext,program:(role:DeskRole)=>Promise<void>):Promise<PresentationRole|null>{
    const target=action.kind==='song-start'?'singing':action.kind==='song-end'?'main':action.kind==='chapter-show'?'chapter':action.kind==='image'?'interlude':null;
    if(!ctx.permissions().scenes)throw new LiveFailure('Bitte die Szenensteuerung freigeben.');
    if(target&&this.config().scenes[target].audio!=='preserve'&&!ctx.permissions().audio)throw new LiveFailure('Bitte die Tonsteuerung für diese Szene freigeben.');
    switch(action.kind){
      case 'hide':await this.update('main',{cue:null},ctx);return null;
      case 'song-start':{const song=this.library.song(action.id);await this.update('singing',{song:{id:song.id,title:song.title,copyright:song.copyright,page:0,pages:songPages(song)}},ctx);await program('singing');return 'singing';}
      case 'song-page':{if(!this.state.song||action.page>=this.state.song.pages.length||ctx.workspace.bindings.scenes.singing!==(await ctx.check()).program)throw new LiveFailure('Bitte zuerst ein Lied in der Szene Singen starten.');await this.update('singing',{song:{...this.state.song,page:action.page}},ctx);return null;}
      case 'song-end':await this.update('singing',{song:null},ctx);await program('main');return 'main';
      case 'chapter-show':{const chapter=await this.library.chapter(action.translation,action.book,action.chapter);if(!chapter.verses.some(v=>v.n===action.verse))throw new LiveFailure('Der gewählte Vers fehlt in dieser Ausgabe.');await this.update('chapter',{chapter,verse:action.verse},ctx);await program('chapter');return 'chapter';}
      case 'verse':{if(!this.state.chapter?.verses.some(v=>v.n===action.verse)||ctx.workspace.bindings.scenes.chapter!==(await ctx.check()).program)throw new LiveFailure('Bitte zuerst das Kapitel zeigen.');await this.update('chapter',{verse:action.verse},ctx);return null;}
      case 'image':{if(!this.config().images.some(i=>i.id===action.id))throw new LiveFailure('Das Zwischenbild fehlt.');await this.update('interlude',{image:action.id},ctx);await program('interlude');return 'interlude';}
    }
  }
  async close():Promise<void>{
    if(this.timer)clearTimeout(this.timer);this.timer=null;
    for(const waiting of this.waiters.values())for(const w of waiting){clearTimeout(w.timer);w.reject(new LiveFailure('Einblendungsdienst geschlossen.'));}this.waiters.clear();
    for(const c of this.clients.keys())c.terminate();this.clients.clear();this.socket?.close();this.socket=null;
    const server=this.server;this.server=null;if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  }
}
