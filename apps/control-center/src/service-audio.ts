import type {Reader,Role,Workspace} from './model.ts';
import {assertOfflineSafe,executeOffline} from './offline.ts';
import type {CaptionPort} from './offline.ts';
import {readTransport} from './inspect.ts';

/** Session-only intent supplied by the state machine, never by renderer command arguments. */
export interface ServiceAudioIntent {inputName:string;goOnAir:boolean}
export interface ServiceAudioStatus {
  inputName:string;muted:boolean|null;checkedAt:number|null;
  phase:'unknown'|'pending'|'confirmed';note:string;
}
export const unknownServiceAudio=(inputName='',note='Not checked.'):ServiceAudioStatus=>({inputName,muted:null,checkedAt:null,phase:'unknown',note});
export interface ServiceAudioPort extends CaptionPort {
  mute(inputName:string,muted:boolean):Promise<void>;
}
export function serviceMuteTarget(role:'prepare'|Role,intent?:ServiceAudioIntent):boolean|null {
  if(!intent?.inputName)return null;
  if(intent.goOnAir&&role!=='main')throw new Error('Invalid On Air audio intent.');
  if(role==='prepare'||role==='intro'||role==='outro')return true;
  return role==='main'&&intent.goOnAir?false:null;
}
export async function verifyServiceInput(reader:Reader,w:Workspace,inputName:string,valid:()=>boolean=()=>true):Promise<boolean> {
  if(!inputName||inputName!==w.bindings.audioInput)throw new Error('Confirm the configured service-audio input before enabling mute control.');
  if(w.inventory?.origin!=='live'||w.inventory.inputs.filter(i=>i.name===inputName).length!==1)
    throw new Error('Inspect OBS in this session and select the exact service-audio input.');
  if(!valid())throw new Error('Audio action cancelled.');
  const list=await reader.read('GetInputList');
  if(!valid())throw new Error('Audio action cancelled.');
  if(!Array.isArray(list.inputs)||list.inputs.filter((i:any)=>i.inputName===inputName).length!==1)
    throw new Error('The selected service-audio input is missing or ambiguous.');
  const result=await reader.read('GetInputMute',{inputName});
  if(!valid())throw new Error('Audio action cancelled.');
  if(typeof result.inputMuted!=='boolean')throw new Error('OBS returned an unknown service-audio mute state.');
  return result.inputMuted;
}
/** Adds only explicit input mute writes; all caption code and its interlocks remain unchanged. */
export async function executeWithServiceAudio(
  port:ServiceAudioPort,w:Workspace,role:'prepare'|Role,value:string,serviceId:string,valid:()=>boolean,
  intent?:ServiceAudioIntent,report:(state:ServiceAudioStatus)=>void=()=>{},
):Promise<void> {
  const target=serviceMuteTarget(role,intent);
  if(target===null){await executeOffline(port,w,role,value,serviceId,valid);return;}
  const inputName=intent!.inputName;
  const guard=async()=>{
    if(!valid())throw new Error('Audio action cancelled.');
    const state=await readTransport(port);
    if(!valid())throw new Error('Audio action cancelled.');
    assertOfflineSafe(state,w);return state;
  };
  const confirm=async()=>{
    const result=await port.read('GetInputMute',{inputName});
    if(!valid())throw new Error('Audio action interrupted.');
    if(typeof result.inputMuted!=='boolean'||result.inputMuted!==target)
      throw new Error('OBS did not confirm the requested service-audio mute state. No automatic retry was sent.');
    await guard();
    report({inputName,muted:target,checkedAt:Date.now(),phase:'confirmed',note:'Confirmed by OBS input-mute readback; not a final-stream sound measurement.'});
  };
  try {
    await guard();
    const initial=await verifyServiceInput(port,w,inputName,valid);
    // On Air must reach and confirm Main before opening the service feed.
    if(target===false)await executeOffline(port,w,role,value,serviceId,valid);
    const before=await guard();
    if(target===false&&before.program!==w.bindings.scenes.main)throw new Error('Main is not confirmed; service audio was not unmuted.');
    const current=await verifyServiceInput(port,w,inputName,valid);
    if(current!==initial)throw new Error('The service mute changed during this action. Manual state was not overwritten.');
    await guard();
    if(!valid())throw new Error('Audio action cancelled.');
    report({inputName,muted:null,checkedAt:null,phase:'pending',note:target?'Confirming mute…':'Confirming unmute…'});
    await port.mute(inputName,target);
    await confirm();
    // Prepare/Intro/Outro only advance after the mute has been read back.
    if(target===true)await executeOffline(port,w,role,value,serviceId,valid);
    await confirm();
  } catch(error) {
    report(unknownServiceAudio(inputName,'Audio action not confirmed. Completed changes may remain; inspect OBS before retrying.'));
    throw error;
  }
}
