import type {Workspace} from './model.ts';
import type {LiveBridge,LiveSnapshot} from './live-contract.ts';
import type {ServiceChange} from './live-schedule.ts';
export interface LiveSiteSnapshot{version:string;workspace:Workspace;live:LiveSnapshot;companionResult:string}
export interface LiveAppBridge extends LiveBridge{
  site():Promise<LiveSiteSnapshot>;onSite(callback:(s:LiveSiteSnapshot)=>void):()=>void;
  connect(password:string):Promise<LiveSiteSnapshot>;
  saveWorkspace(workspace:Workspace):Promise<LiveSiteSnapshot>;
  changeServices(change:ServiceChange):Promise<LiveSiteSnapshot>;
  importWorkspace():Promise<LiveSiteSnapshot>;exportWorkspace():Promise<string>;
  inspectCompanion():Promise<LiveSiteSnapshot>;
}
