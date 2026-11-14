/** Fullscreen is a UI-only permission for the exact trusted top-level desk. */
interface PermissionTarget {isDestroyed():boolean;getURL():string}
interface PermissionDetails {isMainFrame?:boolean;requestingUrl?:string}
export function allowLiveFullscreen(permission:string,requester:PermissionTarget|null,desk:PermissionTarget|null,details:PermissionDetails):boolean{
  return permission==='fullscreen'&&requester!==null&&requester===desk&&!requester.isDestroyed()&&requester.getURL()==='bcc://app/live.html'&&details.isMainFrame===true&&details.requestingUrl==='bcc://app/live.html';
}
