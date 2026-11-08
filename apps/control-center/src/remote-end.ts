import type {ManagementApi} from './stream-management-api.ts';
import type {RemoteBroadcast} from './stream-management-model.ts';
import {ManagementError} from './stream-management-model.ts';
/** No encoder API here: RU completion closes only the explicitly reviewed YouTube event. */
export async function completeReviewedEvent(api:ManagementApi,reviewed:RemoteBroadcast,guard:()=>void,sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))):Promise<void>{
  const verify=(b:RemoteBroadcast|null):RemoteBroadcast=>{
    if(!b||b.id!==reviewed.id||b.channelId!==reviewed.channelId||b.title!==reviewed.title||b.startsAt!==reviewed.startsAt||b.privacy!==reviewed.privacy||b.streamId!==reviewed.streamId||!['live','complete'].includes(b.lifecycle))throw new ManagementError('changed','Das überprüfte YouTube-Event hat sich geändert. Kein weiteres Ende angefordert.');return b;
  };
  guard();const current=verify(await api.broadcast(reviewed.id));guard();
  if(current.lifecycle!=='complete'){if(!api.complete)throw new ManagementError('unsupported','YouTube-Abschluss nicht verfügbar.');await api.complete(current,guard);guard();}
  for(let i=0;i<15;i++){guard();const b=verify(await api.broadcast(reviewed.id));guard();if(b.lifecycle==='complete')return;await sleep(1000);}
  throw new ManagementError('unconfirmed','YouTube hat den Abschluss nicht bestätigt. Prüfen Sie das bestehende Event; kein automatischer neuer Versuch.');
}
