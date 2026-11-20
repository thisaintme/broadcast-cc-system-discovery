import {LiveFailure} from './live-contract.ts';
import type {LiveCommand} from './live-contract.ts';
import {PRESENTATION_ROLES} from './presentation-model.ts';
import type {PresentationRole} from './presentation-model.ts';
import {parsePresentationAction} from './presentation-service.ts';
import type {PresentationAction} from './presentation-service.ts';
export type StudioIntent={role:PresentationRole;chapter?:Extract<PresentationAction,{kind:'chapter-show'}>};
export function parseStudioIntent(value:string):StudioIntent {
  let x:any;try{x=JSON.parse(value);}catch{throw new LiveFailure('Ungültige Vorschau-Auswahl.');}
  if(!x||typeof x!=='object'||Array.isArray(x)||!PRESENTATION_ROLES.includes(x.role)||Object.keys(x).some(k=>!['role','chapter'].includes(k)))throw new LiveFailure('Bitte eine eingerichtete Szene für die Vorschau wählen.');
  if(x.chapter!==undefined){if(x.role!=='chapter')throw new LiveFailure('Kapitelinhalt gehört nur zur Kapitelszene.');const chapter=parsePresentationAction(JSON.stringify(x.chapter));if(chapter.kind!=='chapter-show')throw new LiveFailure('Ungültiges Kapitel.');return {role:x.role,chapter};}return {role:x.role};
}
export const commandForRole:Record<PresentationRole,LiveCommand>={intro:'intro-scene',main:'on-air',chapter:'chapter',interlude:'interlude',singing:'singing',prayer:'prayer-scene',remote:'remote',outro:'outro'};
