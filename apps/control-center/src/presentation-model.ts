/** V107 production configuration. No credentials, live grants or device observations are persisted here. */
export const PRESENTATION_ROLES=['intro','main','chapter','interlude','singing','prayer','remote','outro'] as const;
export type PresentationRole=typeof PRESENTATION_ROLES[number];
export const TRANSLATIONS={schlachter:'Schlachter 1951',luther1912:'Luther 1912',elberfelder1905:'Elberfelder 1905'} as const;
export type Translation=keyof typeof TRANSLATIONS;
export const ICON_KEYS=['none','hands','music','book','cross','dove','heart','candle','remote','image','camera','intro','outro'] as const;
export type PresentationIcon=typeof ICON_KEYS[number];
export interface ScenePolicy {icon:PresentationIcon;audio:'on'|'off'|'preserve';camera:string}
export interface MediaItem {id:string;name:string;file:string;kind:'image'|'logo'}
export interface NetworkDevice {enabled:boolean;host:string;port:number}
export interface CameraDevice extends NetworkDevice {protocol:'visca-tcp'|'visca-udp';sleepPreset:number;presets:{id:string;name:string;number:number}[]}
export interface DeviceConfig {
  webPresenter:NetworkDevice;
  front:CameraDevice; side:CameraDevice;
  mixer:NetworkDevice&{buses:number[]};
  light:NetworkDevice;
  switcher:NetworkDevice&{frontInput:number;sideInput:number};
  end:{cameras:boolean;mixer:boolean;light:boolean;recording:boolean};
}
export interface PresentationConfig {
  enabled:boolean;overlayInput:string;cameraScene:string;remoteScene:string;port:number;churchName:string;introTitle:string;outroTitle:string;
  cueSeconds:number;translation:Translation;logo:string;images:MediaItem[];image:string;
  scenes:Record<PresentationRole,ScenePolicy>;devices:DeviceConfig;
}
export interface Verse {n:number;text:string;omitted?:boolean}
export interface BibleChapter {translation:Translation;book:number;name:string;chapter:number;verses:Verse[];attribution:string}
export interface SongPart {id:string;label:string;kind:'verse'|'chorus'|'bridge';lines:string[]}
export interface Song {id:string;title:string;number:string;copyright:string;parts:SongPart[];order:string[]}
export interface SongPage {label:string;partId:string;lines:string[];chorus:boolean}
export interface SongState {id:string;title:string;copyright:string;page:number;pages:SongPage[]}
export interface PresentationState {
  revision:number;requested:boolean;confirmedAt:number|null;connected:boolean;error:string;
  scene:PresentationRole;cue:null|{kind:'speaker'|'bible';text:string;until:number};song:SongState|null;
  chapter:BibleChapter|null;verse:number;image:string;previewImage:string|null;history:{reference:string;at:number}[];
}
const net=(port:number):NetworkDevice=>({enabled:false,host:'',port});
const camera=():CameraDevice=>({...net(5678),protocol:'visca-tcp',sleepPreset:0,presets:[{id:'front',name:'Kanzel',number:1},{id:'wide',name:'Totale',number:2}]});
export function defaultPresentation():PresentationConfig {
  const icon:Record<PresentationRole,PresentationIcon>={intro:'intro',main:'camera',chapter:'book',interlude:'image',singing:'music',prayer:'hands',remote:'remote',outro:'outro'};
  return {enabled:false,cameraScene:'',remoteScene:'',overlayInput:'BCC · Einblendungen',port:17643,churchName:'',introTitle:'Herzlich willkommen',outroTitle:'Auf Wiedersehen',cueSeconds:15,translation:'schlachter',logo:'',images:[],image:'',
    scenes:Object.fromEntries(PRESENTATION_ROLES.map(r=>[r,{icon:icon[r],audio:r==='intro'||r==='outro'?'off':r==='main'?'on':'preserve',camera:''}])) as Record<PresentationRole,ScenePolicy>,
    devices:{webPresenter:net(9977),front:camera(),side:camera(),mixer:{...net(10023),buses:[1,2]},light:net(9123),switcher:{...net(9910),frontInput:1,sideInput:2},end:{cameras:false,mixer:false,light:false,recording:false}}};
}
export function blankPresentationState():PresentationState {return {revision:0,requested:false,confirmedAt:null,connected:false,error:'',scene:'intro',cue:null,song:null,chapter:null,verse:1,image:'',previewImage:null,history:[]};}
const record=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const clean=(v:unknown,max:number,fallback='')=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):fallback;
const integer=(v:unknown,min:number,max:number,fallback:number)=>v===undefined?fallback:typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max?v:(()=>{throw new Error('Ungültige Zahl in der Einrichtung.');})();
export function assetName(value:unknown):string {if(value==='')return '';if(typeof value!=='string'||!/^[-a-zA-Z0-9]{1,80}\.(png|jpg|webp)$/.test(value))throw new Error('Ungültiger lokaler Bildname.');return value;}
/** Literal private/loopback IPv4 only: no DNS rebinding, public endpoints, credentials or arbitrary URLs. */
export function deviceHost(value:unknown):string {
  const host=clean(value,64);if(!host)return '';
  const pieces=host.split('.').map(Number);
  if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)||pieces.some(n=>!Number.isInteger(n)||n<0||n>255)||!([10,127].includes(pieces[0])||pieces[0]===192&&pieces[1]===168||pieces[0]===172&&pieces[1]>=16&&pieces[1]<=31))throw new Error('Bitte eine private IPv4-Adresse im lokalen Netz eingeben.');
  return pieces.join('.');
}
export function parsePresentation(raw:unknown):PresentationConfig {
  const r=record(raw),d=defaultPresentation();
  const network=(v:unknown,base:NetworkDevice):NetworkDevice=>{const n=record(v),host=deviceHost(n.host);if(n.enabled===true&&!host)throw new Error('Für das aktivierte Gerät fehlt die Adresse.');return {enabled:n.enabled===true,host,port:integer(n.port,1,65535,base.port)};};
  const cam=(v:unknown,base:CameraDevice):CameraDevice=>{const c=record(v),seen=new Set<string>();return {...network(c,base),protocol:c.protocol==='visca-udp'?'visca-udp':'visca-tcp',sleepPreset:integer(c.sleepPreset,0,127,base.sleepPreset),presets:(Array.isArray(c.presets)?c.presets:base.presets).slice(0,32).map((p:any)=>{const id=clean(p.id,48),name=clean(p.name,100);if(!/^[\w-]+$/.test(id)||!name||seen.has(id))throw new Error('Kamerapositionen benötigen eindeutige Namen.');seen.add(id);return {id,name,number:integer(p.number,0,127,0)};})};};
  const devices=record(r.devices),end=record(devices.end),scenes=record(r.scenes),seen=new Set<string>();
  const images:MediaItem[]=(Array.isArray(r.images)?r.images:[]).slice(0,64).map((i:any)=>{const id=clean(i.id,80),name=clean(i.name,100);if(!id||seen.has(id)||!name)throw new Error('Bilder benötigen eindeutige Namen.');seen.add(id);return {id,name,file:assetName(i.file),kind:i.kind==='logo'?'logo':'image'};});
  const config:PresentationConfig={enabled:r.enabled===true,cameraScene:clean(r.cameraScene,200),remoteScene:clean(r.remoteScene,200),overlayInput:clean(r.overlayInput,200,d.overlayInput),port:integer(r.port,1024,65535,d.port),churchName:clean(r.churchName,180),introTitle:clean(r.introTitle,180,d.introTitle),outroTitle:clean(r.outroTitle,180,d.outroTitle),cueSeconds:integer(r.cueSeconds,3,60,15),translation:Object.hasOwn(TRANSLATIONS,r.translation)?r.translation:'schlachter',logo:r.logo?assetName(r.logo):'',images,image:typeof r.image==='string'&&images.some(i=>i.id===r.image)?r.image:images[0]?.id||'',
    scenes:Object.fromEntries(PRESENTATION_ROLES.map(role=>{const s=record(scenes[role]),base=d.scenes[role];return [role,{icon:ICON_KEYS.includes(s.icon)?s.icon:base.icon,audio:['on','off','preserve'].includes(s.audio)?s.audio:base.audio,camera:clean(s.camera,80)}];})) as Record<PresentationRole,ScenePolicy>,
    devices:{webPresenter:network(devices.webPresenter,d.devices.webPresenter),front:cam(devices.front,d.devices.front),side:cam(devices.side,d.devices.side),mixer:{...network(devices.mixer,d.devices.mixer),buses:[...new Set((Array.isArray(devices.mixer?.buses)?devices.mixer.buses:d.devices.mixer.buses).map((b:unknown)=>integer(b,1,16,1)))].slice(0,16) as number[]},light:network(devices.light,d.devices.light),switcher:{...network(devices.switcher,d.devices.switcher),frontInput:integer(devices.switcher?.frontInput,1,40,1),sideInput:integer(devices.switcher?.sideInput,1,40,2)},end:{cameras:end.cameras===true,mixer:end.mixer===true,light:end.light===true,recording:end.recording===true}}};
  if(!config.overlayInput.startsWith('BCC'))throw new Error('Der Name der Browserquelle fehlt.');
  // The agreed invariant cannot be overridden by a misleading per-scene setting.
  config.scenes.main.audio='on';config.scenes.intro.audio='off';config.scenes.outro.audio='off';
  return config;
}
export function parseSongs(raw:unknown):Song[] {
  const r=record(raw),items=Array.isArray(raw)?raw:r.songs;
  if(!Array.isArray(items)||items.length>5000)throw new Error('Bitte eine Liederdatei mit höchstens 5000 Liedern wählen.');
  const ids=new Set<string>();return items.map((value:unknown)=>{
    const s=record(value),id=clean(s.id,100),title=clean(s.title,200),partIds=new Set<string>();
    if(!id||!title||ids.has(id)||!Array.isArray(s.parts)||!s.parts.length||s.parts.length>100)throw new Error('Jedes Lied benötigt eine eindeutige ID, einen Titel und gegliederte Strophen.');ids.add(id);
    const parts:SongPart[]=s.parts.map((value:unknown)=>{const p=record(value),id=clean(p.id,50);if(!id||partIds.has(id)||!['verse','chorus','bridge'].includes(p.kind)||!Array.isArray(p.lines)||!p.lines.length||p.lines.length>16)throw new Error('Ungültige Liedstrophe. Höchstens 16 Zeilen je Seite.');partIds.add(id);const lines=p.lines.map((v:unknown)=>{if(typeof v!=='string'||v.length>240||/[\u0000-\u001f]/.test(v))throw new Error('Ungültige Liedzeile.');return v;});return {id,label:clean(p.label,60,p.kind==='chorus'?'Refrain':`Strophe ${id}`),kind:p.kind,lines};});
    const order=Array.isArray(s.order)?s.order:parts.flatMap(p=>p.kind==='verse'&&parts.find(x=>x.kind==='chorus')?[p.id,parts.find(x=>x.kind==='chorus')!.id]:p.kind==='chorus'?[]:[p.id]);
    if(!order.length||order.length>200||order.some((id:unknown)=>typeof id!=='string'||!partIds.has(id)))throw new Error('Die Liedfolge verweist auf eine unbekannte Strophe.');
    return {id,title,number:clean(s.number,40),copyright:clean(s.copyright,500),parts,order:[...order]};
  });
}
export function songPages(song:Song):SongPage[]{return song.order.map(id=>{const part=song.parts.find(p=>p.id===id);if(!part)throw new Error('Liedfolge unvollständig.');return {label:part.label,partId:id,lines:[...part.lines],chorus:part.kind==='chorus'};});}
