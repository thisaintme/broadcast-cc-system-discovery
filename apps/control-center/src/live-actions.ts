import {parseStudioIntent,commandForRole} from './studio-intent.ts';
import {parsePresentationAction} from './presentation-service.ts';
import type {PresentationPort} from './presentation-service.ts';
import type {PresentationRole} from './presentation-model.ts';
import type {Role,DeskRole,Workspace} from './model.ts';
import type {LiveCommand,LiveObservation,LivePhase,LiveWrite,LivePermissions} from './live-contract.ts';
import type {OperatorReader} from './obs-operator.ts';
import {LiveFailure} from './live-contract.ts';
import {nextServiceCaption} from './offline.ts';
import {text} from './workspace.ts';
import {ensureDissolve} from './live-transition.ts';
import {requireScene,requireText,requireSpeakerGroup,requireAudio,textSettings,commandPermissions} from './live-validation.ts';
export interface LiveActionContext {
  presentation?:PresentationPort;
  takePreview?:string;
  sceneDevices?:(role:PresentationRole,guard:()=>Promise<void>)=>Promise<void>;
  workspace:Workspace; reader:OperatorReader; serviceId:string;
  permissions():LivePermissions;
  check():Promise<LiveObservation>;
  change(name:LiveWrite,data?:Record<string,unknown>):Promise<void>;
  verified(detail:string):Promise<void>;
}
/** Operator-requested actions only. The controller checks current scope, cancellation and OBS state at every write. */
export async function executeLiveAction(ctx:LiveActionContext,command:LiveCommand,value=''):Promise<LivePhase|null> {
  const {workspace:w,reader}=ctx;
  const permitted=()=>{
    const need=commandPermissions(command),allowed=ctx.permissions();
    if((need.scenes&&!allowed.scenes)||(need.audio&&!allowed.audio)||(need.stream&&!allowed.stream))throw new LiveFailure('The required live-control permission is not enabled.');
  };
  permitted();
  const change=async(name:LiveWrite,data:Record<string,unknown>={})=>{
    permitted();await ctx.check();permitted();await ctx.change(name,data);
  };
  const mute=async(muted:boolean)=>{
    await requireAudio(reader,w);
    await change('SetInputMute',{inputName:w.bindings.audioInput,inputMuted:muted});
    if((await reader.read('GetInputMute',{inputName:w.bindings.audioInput})).inputMuted!==muted)throw new LiveFailure('Mute result not confirmed. Check OBS; no retry was made.');
    await ctx.verified(muted?'Selected service input muted.':'Selected service input unmuted.');
  };
  const program=async(role:DeskRole)=>{
    const name=await requireScene(reader,w,role);
    const policy=w.presentation?.enabled?w.presentation.scenes[role as PresentationRole]?.audio:'preserve';
    if(policy&&policy!=='preserve'&&!ctx.permissions().audio)throw new LiveFailure('Bitte die Tonsteuerung für diese Szene freigeben.');
    if(ctx.sceneDevices)await ctx.sceneDevices((role==='speaker'||role==='bible'?'main':role) as PresentationRole,async()=>{await ctx.check();});
    if(ctx.presentation)await ctx.presentation.prepare((role==='speaker'||role==='bible'?'main':role) as PresentationRole,ctx);
    const before=await ctx.check();
    if(before.program!==name){
      await ensureDissolve(reader,change,name,w.transitionMs??900);
      if(ctx.takePreview){if(ctx.takePreview!==name||(await reader.read('GetStudioModeEnabled')).studioModeEnabled!==true||(await reader.read('GetCurrentPreviewScene')).currentPreviewSceneName!==name)throw new LiveFailure('Die Vorschau hat sich geändert. Kein Bildwechsel gesendet.');await change('TriggerStudioModeTransition');}
      else await change('SetCurrentProgramScene',{sceneName:name});
    }
    let confirmed=false;
    for(let i=0;i<60;i++){
      const observed=await ctx.check();if(observed.program===name){confirmed=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!confirmed)throw new LiveFailure('Program scene was not confirmed. Check OBS.');
    await ctx.verified('Program scene confirmed.');
    if(policy&&policy!=='preserve'&&!['intro','outro'].includes(role)){if(!ctx.permissions().audio)throw new LiveFailure('Bitte die Tonsteuerung für diese Szene freigeben.');await mute(policy==='off');}
  };
  const caption=async(name:string,value:string)=>{
    await change('SetInputSettings',{inputName:name,inputSettings:{text:value},overlay:true});
    if((await textSettings(reader,name)).text!==value)throw new LiveFailure('Caption text was not confirmed. Program was not advanced.');
    await ctx.verified('Caption text confirmed.');
  };
  const confirmTransmission=async(active:boolean)=>{
    for(let i=0;i<100;i++){
      const o=await ctx.check();if(o.streaming===active&&(active||o.reconnecting!==true)){
        await ctx.verified(active?'OBS transmission active; YouTube status not verified.':'OBS transmission stopped; YouTube completion not verified.');return;
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new LiveFailure('OBS transmission result is unknown. Check OBS and YouTube manually. No retry was made.');
  };
  switch(command){
    case 'studio-mode':{
      if(value!=='true'&&value!=='false')throw new LiveFailure('Bitte den Studiomodus ausdrücklich an- oder ausschalten.');
      if(!ctx.permissions().operator)throw new LiveFailure('Bitte das OBS-Pult freigeben.');await change('SetStudioModeEnabled',{studioModeEnabled:value==='true'});
      if((await reader.read('GetStudioModeEnabled')).studioModeEnabled!==(value==='true'))throw new LiveFailure('Studiomodus nicht bestätigt.');return null;
    }
    case 'studio-preview':case 'studio-take':{
      const intent=parseStudioIntent(value),scene=await requireScene(reader,w,intent.role);
      if(!ctx.permissions().operator||(await reader.read('GetStudioModeEnabled')).studioModeEnabled!==true)throw new LiveFailure('Bitte den Studiomodus und die OBS-Pult-Freigabe aktivieren.');
      if(command==='studio-preview'){await change('SetCurrentPreviewScene',{sceneName:scene});if((await reader.read('GetCurrentPreviewScene')).currentPreviewSceneName!==scene)throw new LiveFailure('Vorschau nicht bestätigt.');return null;}
      if((await reader.read('GetCurrentPreviewScene')).currentPreviewSceneName!==scene)throw new LiveFailure('Die Vorschau hat sich seit der Auswahl geändert.');
      if(intent.role==='chapter'&&ctx.presentation){if(!intent.chapter)throw new LiveFailure('Bitte ein Kapitel für die Übernahme wählen.');return executeLiveAction({...ctx,takePreview:scene},'presentation',JSON.stringify(intent.chapter));}
      return executeLiveAction({...ctx,takePreview:scene},commandForRole[intent.role]);
    }
    case 'presentation':{if(!ctx.presentation)throw new LiveFailure('Bitte zuerst die V107-Einblendungen einrichten.');return ctx.presentation.execute(parsePresentationAction(value),ctx,program);}
    case 'prepare':
      await requireScene(reader,w,'intro');await requireScene(reader,w,'main');
      await ctx.verified('Intro/Main preflight completed without changing OBS.');return 'prepared';
    case 'intro':case 'start':{
      const before=await ctx.check();if(before.streaming!==false||before.reconnecting===true)throw new LiveFailure('Already transmitting or reconnecting; Intro preparation is unavailable.');
      await requireScene(reader,w,'intro');await requireAudio(reader,w);if(command==='start'&&ctx.presentation?.reset)await ctx.presentation.reset(ctx);await mute(true);await program('intro');
      if(command==='start'){await change('StartStream');await confirmTransmission(true);}return 'intro';
    }
    case 'intro-scene':await requireScene(reader,w,'intro');await requireAudio(reader,w);await mute(true);await program('intro');return 'intro';
    case 'prayer-scene':await program('prayer');return 'prayer';
    case 'chapter':case 'interlude':case 'singing':case 'remote':await program(command);return command;
    case 'on-air':await requireScene(reader,w,'main');await requireAudio(reader,w);await program('main');if(!ctx.presentation)await mute(false);return 'main';
    case 'main':await program('main');return 'main';
    case 'mute':case 'unmute':await mute(command==='mute');return null;
    case 'speaker':{
      if(!w.speakers.includes(value))throw new LiveFailure('Select a saved speaker.');
      if(ctx.presentation){await program('main');await ctx.presentation.cue('speaker',value,ctx);return 'main';}
      const selected=w.captions.speakerSources[value];
      if(!selected||!w.captions.speakerPool.includes(selected))throw new LiveFailure('No name source is mapped for this speaker.');
      await requireScene(reader,w,'main');await requireSpeakerGroup(reader,w);
      for(const source of [...w.captions.speakerPool.filter(n=>n!==selected),selected]){
        const group=await requireSpeakerGroup(reader,w),item=group.items.find(i=>i.source===source)!,enabled=source===selected;
        if(item.enabled===enabled)continue;
        await change('SetSceneItemEnabled',{sceneName:group.name,sceneItemId:item.id,sceneItemEnabled:enabled});
        if((await reader.read('GetSceneItemEnabled',{sceneName:group.name,sceneItemId:item.id})).sceneItemEnabled!==enabled)throw new LiveFailure('Speaker visibility was not confirmed.');
      }
      const group=await requireSpeakerGroup(reader,w),active=group.items.filter(i=>w.captions.speakerPool.includes(i.source)&&i.enabled);
      if(active.length!==1||active[0].source!==selected)throw new LiveFailure('Speaker selection could not be verified.');
      await program('speaker');return 'speaker';
    }
    case 'bible':{
      const reference=text(value,500).trim();if(!reference)throw new LiveFailure('Enter the Bible reference.');
      if(ctx.presentation){await program('main');await ctx.presentation.cue('bible',reference,ctx);return 'main';}
      await requireScene(reader,w,'main');const name=await requireText(reader,w,'bible');
      await caption(name,reference);await program('bible');return 'bible';
    }
    case 'prayer':await requireScene(reader,w,'main');await program('prayer');return 'prayer';
    case 'outro':{
      if(ctx.presentation){await requireAudio(reader,w);await mute(true);await program('outro');return 'outro';}
      const name=await requireText(reader,w,'outro'),next=nextServiceCaption(w,ctx.serviceId);
      await requireAudio(reader,w);await mute(true);await caption(name,next);await program('outro');return 'outro';
    }
    case 'stop':{
      const before=await ctx.check();if(before.streaming!==true&&before.reconnecting!==true)throw new LiveFailure('OBS is no longer transmitting. No Stop request sent.');
      await change('StopStream');await confirmTransmission(false);return null;
    }
    default:throw new LiveFailure('Unknown live action.');
  }
}
