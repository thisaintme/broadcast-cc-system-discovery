import {editableSnippet,makeDraft} from './core.mjs';
const api='https://www.googleapis.com/youtube/v3/videos';
export async function inspectVideo(target,token,http=fetch){
 if(!target?.broadcastId||!target.channelId)throw Error('Kein eindeutig verknüpftes deutsches Video.');
 const u=new URL(api);u.search=new URLSearchParams({id:target.broadcastId,part:'snippet,liveStreamingDetails'});
 const r=await http(u,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!r.ok)throw Error('Video konnte nicht gelesen werden.');const video=(await r.json()).items?.[0];
 if(video?.id!==target.broadcastId||video.snippet?.channelId!==target.channelId||!video.etag||!video.liveStreamingDetails?.actualEndTime)throw Error('YouTube hat das Ende des verknüpften deutschen Videos noch nicht bestätigt.');return video;
}
export function reviewDraft(events,video){const start=events[0],end=events.at(-1);if(start?.kind!=='start'||end?.kind!=='end'||end.confirmed!==true)throw Error('Mitschrift nicht abgeschlossen.');
 const date=new Date(start.startsAt),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(date).replaceAll('-','');const proposed=makeDraft(events,video.snippet,day);const names=[...new Set(events.filter(x=>x.kind==='line'&&x.role==='speaker'&&x.speaker).map(x=>x.speaker))],refs=[...new Set(end.reference||[])];
 if(names.length)proposed.description+='\nSprecher: '+names.join(', ');if(refs.length)proposed.description+='\nBibelstellen: '+refs.join('; ');
 return {target:start.target,etag:video.etag,current:{title:video.snippet.title,description:video.snippet.description||''},proposed};}
export async function applyReviewed(review,edited,token,http=fetch){const v=await inspectVideo(review.target,token,http);if(v.etag!==review.etag)throw Error('Video seit der Vorschau geändert. Bitte neu laden.');const snippet=editableSnippet(v.snippet,edited.title,edited.description);
 const r=await http(api+'?part=snippet',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','If-Match':v.etag},body:JSON.stringify({id:v.id,snippet}),redirect:'error',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Übernahme nicht bestätigt. Vor erneutem Versuch YouTube prüfen.');return true;}
