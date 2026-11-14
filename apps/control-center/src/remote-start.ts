import type {ManagementApi} from './stream-management-api.ts';
import type {PrivateProfile,RemoteBroadcast} from './stream-management-model.ts';
import {ManagementError} from './stream-management-model.ts';
/** Pinned metadata and ingest identity. A failed write is never retried or rolled back. */
export function sameRemoteEvent(reviewed:RemoteBroadcast,b:RemoteBroadcast|null):RemoteBroadcast {
  if(!b||b.id!==reviewed.id||b.channelId!==reviewed.channelId||b.title!==reviewed.title||b.startsAt!==reviewed.startsAt||b.privacy!==reviewed.privacy||b.madeForKids!==reviewed.madeForKids||b.streamId!==reviewed.streamId||b.autoStart!==reviewed.autoStart||b.autoStop!==reviewed.autoStop)throw new ManagementError('changed','Das freigegebene YouTube-Ziel hat sich geändert. Keine weitere Aktion wurde gesendet.');return b;
}
export function sameRemoteProfile(expected:PrivateProfile,actual:PrivateProfile):void {
  if(actual.id!==expected.id||actual.channelId!==expected.channelId||actual.key!==expected.key||actual.server!==expected.server||actual.reusable!==true)throw new ManagementError('changed','Das freigegebene YouTube-Streamprofil hat sich geändert.');
}
export async function publishReviewedEvent(api:ManagementApi,reviewed:RemoteBroadcast,profile:PrivateProfile,guard:()=>void,sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))):Promise<void>{
  if(reviewed.autoStart||reviewed.autoStop||reviewed.madeForKids===undefined)throw new ManagementError('state','Automatischer YouTube-Start/-Stopp muss aus sein; die Zielgruppe muss festgelegt sein.');
  let ready:RemoteBroadcast|null=null;
  for(let i=0;i<30;i++){
    guard();const b=sameRemoteEvent(reviewed,await api.broadcast(reviewed.id));guard();const p=await api.profile(profile.id);guard();sameRemoteProfile(profile,p);
    if(b.lifecycle==='live')return;
    if(!['ready','testing'].includes(b.lifecycle))throw new ManagementError('state','Das Event ist nicht zur Veröffentlichung bereit.');
    if(p.status==='active'){ready=b;break;}await sleep(1000);
  }
  if(!ready)throw new ManagementError('ingest','YouTube bestätigt noch kein Eingangssignal. Web Presenter bleibt unverändert. Nach Prüfung kann das vorhandene Signal veröffentlicht werden.');
  guard();const current=sameRemoteEvent(reviewed,await api.broadcast(reviewed.id));guard();const currentProfile=await api.profile(profile.id);guard();sameRemoteProfile(profile,currentProfile);
  if(currentProfile.status!=='active')throw new ManagementError('ingest','Das YouTube-Eingangssignal ist nicht mehr bestätigt.');
  if(current.lifecycle!=='live'){if(!api.publish)throw new ManagementError('unsupported','Veröffentlichung nicht verfügbar.');await api.publish(current,guard);guard();}
  for(let i=0;i<20;i++){guard();const b=sameRemoteEvent(reviewed,await api.broadcast(reviewed.id));guard();if(b.lifecycle==='live')return;await sleep(1000);}
  throw new ManagementError('unconfirmed','YouTube hat den Live-Zustand nicht bestätigt. Es wird kein zweiter Start gesendet.');
}
