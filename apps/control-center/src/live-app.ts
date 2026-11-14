import type {DeviceSnapshot} from './device-service.ts';
import type {BibleChapter,Translation,PresentationState} from './presentation-model.ts';
import type {EndScope,EndState} from './end-countdown.ts';
import type { ObsCredentialStatus } from './obs-credentials.ts';
import type { DeskCues, CueChange } from './desk-cues.ts';
import type { MonitorSlot, MonitorFrame } from './program-monitor.ts';
import type {Workspace} from './model.ts';
import type {LiveBridge,LiveSnapshot} from './live-contract.ts';
import type {ServiceChange} from './live-schedule.ts';
import type {OperatorQuery,OperatorView} from './obs-operator.ts';
export interface LiveSiteSnapshot{version:string;workspace:Workspace;devices?:DeviceSnapshot;presentation?:PresentationState;songCount?:number;credentials?:ObsCredentialStatus;end?:EndState;broadcast?:{busy:boolean;error:string;notice:string;linked:boolean};cues?:DeskCues;live:LiveSnapshot;companionResult:string}
export interface LiveAppBridge extends LiveBridge{
  checkDevices():Promise<LiveSiteSnapshot>;
  grantDevices():Promise<LiveSiteSnapshot>;
  deviceAction(action:{kind:'camera';slot:'front'|'side';preset:string}|{kind:'light';on:boolean}):Promise<LiveSiteSnapshot>;
  chapter(translation:Translation,book:number,chapter:number):Promise<BibleChapter>;
  songs(query:string):Promise<{id:string;number:string;title:string;pages:number}[]>;
  importSongs():Promise<LiveSiteSnapshot>;
  importImage(kind:'image'|'logo'):Promise<LiveSiteSnapshot>;
  media(id:string):Promise<string>;
  installPresentation():Promise<LiveSiteSnapshot>;
  broadcast(kind:'start'|'publish-intro'|'start-ru'|'publish-ru'):Promise<void>;
  scheduleEnd(scope:EndScope):Promise<void>;
  cancelEnd():Promise<void>;
  saveObsCredential(password:string,autoConnect:boolean):Promise<LiveSiteSnapshot>;
  forgetObsCredential():Promise<LiveSiteSnapshot>;
  connectSaved():Promise<LiveSiteSnapshot>;
  cue(change:CueChange):Promise<LiveSiteSnapshot>;
  monitor(slot:MonitorSlot):Promise<MonitorFrame>;
  openStreamManagement():Promise<void>;
  site():Promise<LiveSiteSnapshot>;onSite(callback:(s:LiveSiteSnapshot)=>void):()=>void;
  connect(password:string):Promise<LiveSiteSnapshot>;
  saveWorkspace(workspace:Workspace):Promise<LiveSiteSnapshot>;
  changeServices(change:ServiceChange):Promise<LiveSiteSnapshot>;
  operatorData(query:OperatorQuery):Promise<OperatorView>;
  importWorkspace():Promise<LiveSiteSnapshot>;exportWorkspace():Promise<string>;
  inspectCompanion():Promise<LiveSiteSnapshot>;
}
