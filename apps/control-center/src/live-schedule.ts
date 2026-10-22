import type {Workspace} from './model.ts';
import {LiveFailure} from './live-contract.ts';
import {text} from './workspace.ts';

type Service=Workspace['services'][number];
export type ServiceChange={type:'add';service:Service}|{type:'remove';id:string};

function record(raw:unknown,keys:string[]):Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new LiveFailure('Invalid schedule change.');
  const value=raw as Record<string,unknown>;
  if(Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))
    throw new LiveFailure('Only service schedule fields may be changed here.');
  return value;
}
function service(raw:unknown):Service{
  const value=record(raw,['id','title','startsAt']);
  if(typeof value.id!=='string'||!value.id.trim()||value.id.length>100||text(value.id,100)!==value.id||
    typeof value.title!=='string'||!value.title.trim()||value.title.length>240||text(value.title)!==value.title||
    typeof value.startsAt!=='string'||value.startsAt.length>40||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.startsAt))
    throw new LiveFailure('Services need an ID, a title and a valid date with timezone.');
  const date=new Date(value.startsAt);
  if(!Number.isFinite(date.getTime()))throw new LiveFailure('Choose a valid service date.');
  return {id:value.id,title:value.title.trim(),startsAt:date.toISOString()};
}

/** Applies a small command to the authoritative schedule, never a renderer workspace.
 * No OBS port or controller reference is available here. Keep the live inventory,
 * bindings and speaker pool unchanged, including their object identity.
 */
export function applyServiceChange(current:Workspace,raw:unknown,selectedService:string):Workspace{
  const change=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
  let services:Workspace['services'];
  if(change.type==='add'){
    record(raw,['type','service']);
    const entry=service(change.service);
    if(current.services.some(s=>s.id===entry.id))throw new LiveFailure('That service is already in the schedule.');
    if(current.services.length>=1000)throw new LiveFailure('The schedule is full. Remove an unneeded service first.');
    services=[...current.services,entry];
  }else if(change.type==='remove'){
    record(raw,['type','id']);
    if(typeof change.id!=='string'||!current.services.some(s=>s.id===change.id))
      throw new LiveFailure('That service is no longer in the schedule.');
    if(change.id===selectedService)
      throw new LiveFailure('The selected service cannot be removed. Keep the current service selected while broadcasting.');
    services=current.services.filter(s=>s.id!==change.id);
  }else throw new LiveFailure('Choose an add or remove schedule action.');
  services.sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
  return {...current,services};
}
