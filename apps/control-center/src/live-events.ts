/** A stream transition is expected only when both its state and direction match the requested action. */
export function expectedStreamEvent(target:boolean,raw:Record<string,unknown>):boolean{
  const active=raw.outputActive,state=raw.outputState;
  if(typeof active!=='boolean'||typeof state!=='string')return false;
  if(target){
    if(state==='OBS_WEBSOCKET_OUTPUT_STARTING')return active===false;
    return active===true&&['OBS_WEBSOCKET_OUTPUT_STARTED','OBS_WEBSOCKET_OUTPUT_RECONNECTING','OBS_WEBSOCKET_OUTPUT_RECONNECTED'].includes(state);
  }
  if(state==='OBS_WEBSOCKET_OUTPUT_STOPPING')return true;
  return state==='OBS_WEBSOCKET_OUTPUT_STOPPED'&&active===false;
}
export function duplicateTerminalStreamEvent(active:boolean|null,raw:Record<string,unknown>):boolean{
  return typeof active==='boolean'&&raw.outputActive===active&&raw.outputState===(active?'OBS_WEBSOCKET_OUTPUT_STARTED':'OBS_WEBSOCKET_OUTPUT_STOPPED');
}
