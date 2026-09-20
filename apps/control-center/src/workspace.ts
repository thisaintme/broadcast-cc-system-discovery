import { blankWorkspace, blankBindings, ROLES } from './model.ts';
import type {Workspace, Inventory, SceneNode, Connection, Bindings, SourceCandidate} from './model.ts';
export const object = (x: unknown): Record<string, any> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, any> : {};
export const text = (x: unknown, limit = 240): string => typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, limit) : '';
const array = (x: unknown): any[] => Array.isArray(x) ? x.slice(0, 1000) : [];
/** This milestone connects only to software on the broadcast Mac. No remote credentials. */
export function localEndpoint(value: unknown, kind: 'obs' | 'companion'): string {
  const u = new URL(text(value, 500));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.hash)
    throw new Error('Use a localhost endpoint without credentials or fragments.');
  if (kind === 'obs') {
    if (!['ws:', 'wss:'].includes(u.protocol) || u.pathname !== '/' || u.search)
      throw new Error('Use the OBS WebSocket base URL, not an API path.');
  } else {
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Companion needs an HTTP base URL.');
    if (!['/', '/api/connections', '/api/v1/connections', '/int/export/full'].includes(u.pathname))
      throw new Error('Use the Companion base URL or its full-export URL.');
    if (u.search && !(u.pathname === '/int/export/full' && u.search === '?format=json'))
      throw new Error('Unexpected Companion URL parameters.');
  }
  return u.origin;
}
export function connections(raw: unknown): Connection[] {
  const list = Array.isArray(raw) ? raw : Object.values(object(raw));
  return list.slice(0, 100).map((x) => {
    const c=object(x), cfg=object(c.config);
    const host=text(c.host || cfg.host || cfg.ipAddress);
    return { label:text(c.label), module:text(c.module || c.moduleId || c.instance_type),
      version:text(c.version || c.moduleVersion || c.moduleVersionId),
      host:/^[a-zA-Z0-9.:\[\]_-]+$/.test(host) ? host : '', enabled:c.enabled === true, health:'unknown' as const };
  });
}
function inventory(raw: unknown): Inventory {
  const i=object(raw);
  const nodes: SceneNode[] = array(i.nodes || i.sceneDetails).map((r) => {
    const n=object(r);
    return { name:text(n.name), type:n.type === 'group' ? 'group' : n.type === 'unknown' ? 'unknown' : 'scene',
      items:array(n.items).map((r,index) => {const x=object(r); return {
        id:Number.isInteger(x.id ?? x.sceneItemId) ? (x.id ?? x.sceneItemId) : -1,
        source:text(x.source || x.sourceName), kind: text(x.kind || x.inputKind) || null,
        group:x.group === true, container:x.container === true || x.sourceType === 'OBS_SOURCE_TYPE_SCENE',
        enabled:x.enabled === true, index:Number.isInteger(x.index) ? x.index : index,
      };}), warnings:[] };
  });
  return {origin:'report', collection:text(i.collection || i.currentSceneCollection),
    scenes:array(i.scenes).map((x) => text(typeof x === 'string' ? x : object(x).sceneName)).filter(Boolean),
    inputs:array(i.inputs).map((x)=>({name:text(x.name),kind:text(x.kind)})),
    nodes, audio:[], capturedAt:text(i.capturedAt),
    warnings:['Imported snapshot, not live status. Inspect OBS to resolve nested groups and current audio state.']};
}
export function suggestBindings(i: Inventory): Bindings {
  const b=blankBindings();
  const aliases={intro:['Intro'],main:['Main'],speaker:['Sprecher','Speaker'],bible:['Kapitel1','Bible'],outro:['Outro']};
  for (const role of ROLES) b.scenes[role]=aliases[role].find(n=>i.scenes.includes(n)) || '';
  // These are suggestions only. No mappings are marked confirmed by an import.
  for (const [key,names] of Object.entries({nextServiceText:['Nächster-Livestream','NEXTSTREAM'],audioInput:['1audio-de']})) {
    (b as any)[key]=names.find(n=>i.inputs.some(x=>x.name===n)) || '';
  }
  return b;
}
/** Project only known fields; never persist raw exports, action options, or secrets. */
export function importWorkspace(raw: unknown): Workspace {
  const r=object(raw), w=blankWorkspace();
  if (r.format === 'broadcast-cc-workspace' && r.version === 1) return validateWorkspace(r, true);
  if (r.format === 'broadcast-cc-site-profile-draft') {
    const o=object(r.observations), obs=object(o.obs);
    w.inventory=inventory({scenes:obs.sceneNames, currentSceneCollection:obs.sceneCollection,inputs:[],sceneDetails:[]});
    w.inventory.origin='draft';
    w.inventory.warnings=['Draft imported. Connect to OBS to obtain current resources before confirming mappings.'];
    w.bindings=suggestBindings(w.inventory);
    w.connections=connections(object(o.companion).connections);
    if (object(o.companion).baseUrl) w.companionUrl=localEndpoint(o.companion.baseUrl,'companion');
    return w;
  }
  if ([1,2].includes(r.schemaVersion) && object(r.obs).scenes) {
    w.inventory=inventory(r.obs); w.bindings=suggestBindings(w.inventory);
    w.connections=connections(object(r.companion).connections);
    if (object(r.companion).url) w.companionUrl=localEndpoint(r.companion.url,'companion');
    return w;
  }
  throw new Error('Select a discovery report, draft site profile, or Control Center workspace. Raw Companion exports are not site profiles.');
}
export function validateWorkspace(raw: unknown, imported=false): Workspace {
  const r=object(raw), w=blankWorkspace();
  w.obsUrl=localEndpoint(r.obsUrl || w.obsUrl,'obs');
  w.companionUrl=localEndpoint(r.companionUrl || w.companionUrl,'companion');
  w.inventory=r.inventory ? inventory(r.inventory) : null;
  w.connections=connections(r.connections);
  const b=object(r.bindings);
  for (const role of ROLES) w.bindings.scenes[role]=text(object(b.scenes)[role]);
  for(const key of ['speakerText','bibleText','nextServiceText','audioInput'] as const) w.bindings[key]=text(b[key]);
  w.bindings.confirmed=!imported && b.confirmed===true;
  const ids=new Set<string>();
  w.services=array(r.services).map((s)=>{
    const id=text(s.id,100), title=text(s.title), dt=new Date(s.startsAt);
    if(!id || ids.has(id) || !title || !Number.isFinite(dt.getTime())) throw new Error('Services need a unique ID, a title and a valid start date.');
    ids.add(id); return {id,title,startsAt:dt.toISOString()};
  }).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  w.speakers=[...new Set(array(r.speakers).map(x=>text(x)).filter(Boolean))];
  for(const key of ['frontInput','sideInput','audioRoute'] as const) w.hardwareNotes[key]=text(object(r.hardwareNotes)[key],800);
  return w;
}
export function candidates(i: Inventory | null, scene: string): SourceCandidate[] {
  if(!i || !scene) return [];
  const output: SourceCandidate[]=[];
  function walk(name:string, enabled:boolean, trail:string[]) {
    if(trail.includes(name) || trail.length>20) return;
    const node=i!.nodes.find(n=>n.name===name);
    if(!node) return;
    for(const item of node.items) {
      const active=enabled && item.enabled;
      if(item.kind?.startsWith('text_')) output.push({name:item.source,path:[...trail,name,item.source].join(' → '),enabled:active});
      if(item.container || item.group) walk(item.source,active,[...trail,name]);
    }
  }
  walk(scene,true,[]); return output;
}
export function selectService(w:Workspace, now=new Date()): string {
  const day=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  return w.services.find(s=>day(new Date(s.startsAt))===day(now))?.id || w.services.find(s=>new Date(s.startsAt)>=now)?.id || w.services[0]?.id || '';
}
