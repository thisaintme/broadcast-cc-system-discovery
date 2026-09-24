import type {ReadRequest} from './model.ts';

const NETWORK_CODES = new Set(['ECONNREFUSED','ECONNRESET','ENOTFOUND','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','BCC_TIMEOUT']);
/** Preserve diagnostic codes, never upstream messages, request payloads or credentials. */
export function obsErrorCode(error:unknown, depth=0):number|string|undefined {
  if(depth>2 || !error || typeof error!=='object')return undefined;
  const e=error as {code?:unknown;cause?:unknown;errors?:unknown};
  if(typeof e.code==='number' && Number.isInteger(e.code) && e.code>=-1 && e.code<=4999)return e.code;
  if(typeof e.code==='string' && NETWORK_CODES.has(e.code))return e.code;
  const cause=obsErrorCode(e.cause,depth+1);
  if(cause!==undefined)return cause;
  if(Array.isArray(e.errors))for(const child of e.errors.slice(0,4)){
    const found=obsErrorCode(child,depth+1);if(found!==undefined)return found;
  }
  return undefined;
}
export class ObsFailure extends Error {
  readonly code:number|string|undefined;
  constructor(message:string, code?:number|string){super(message);this.name='ObsFailure';this.code=code;}
}
export function connectionFailure(error:unknown,endpoint:string):ObsFailure {
  const code=obsErrorCode(error);
  if(code===4009)return new ObsFailure('OBS rejected authentication (code 4009). The password field has been kept for retry; no password was saved.',code);
  if(code===4010 || code===-1)return new ObsFailure('The endpoint did not accept the OBS WebSocket v5 / RPC 1 handshake. No authenticated session was established.',code);
  if(code==='BCC_TIMEOUT' || code==='ETIMEDOUT')return new ObsFailure(`OBS WebSocket handshake timed out at ${endpoint}. No authenticated session was established.`,code);
  if(code==='ECONNREFUSED')return new ObsFailure(`Connection refused at ${endpoint}. No OBS WebSocket listener accepted this connection.`,code);
  const suffix=code===undefined?'':` (code ${code})`;
  return new ObsFailure(`OBS WebSocket connection to ${endpoint} failed${suffix}. No authenticated session was established.`,code);
}
export function requestFailure(error:unknown,request:ReadRequest|'SetCurrentPreviewScene'):ObsFailure {
  const code=obsErrorCode(error);
  const suffix=code===undefined?'':` (code ${code})`;
  const explanation=code===604?'The requested resource is unavailable in its current state.':
    code===204?'This request is not supported by the connected OBS server.':
    code==='BCC_TIMEOUT'?'The request timed out.':'The request did not complete.';
  return new ObsFailure(`OBS ${request} failed${suffix}. ${explanation}`,code);
}
