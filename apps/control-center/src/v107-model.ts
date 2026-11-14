import type {DeskRole} from './model.ts';
import type {LiveCommand} from './live-contract.ts';
import type {LiveSiteSnapshot} from './live-app.ts';
import type {ManagementPanel} from './stream-management-contract.ts';
import type {SceneIconName} from './v107-icons.tsx';

export const SCENE_LABELS:Record<DeskRole,string>={intro:'Intro',main:'Main',speaker:'Sprecher',bible:'Bibelstelle',chapter:'Kapitel',interlude:'Zwischenbild',singing:'Singen',prayer:'Beten',remote:'Stream',outro:'Outro'};
export const SCENES:readonly {role:DeskRole;command:LiveCommand;icon:SceneIconName;hint:string}[]=[
  {role:'intro',command:'intro-scene',icon:'intro',hint:'Zeigt die Starttafel und schaltet den Ton aus.'},
  {role:'main',command:'on-air',icon:'camera',hint:'Zeigt das Hauptbild und schaltet den Ton an.'},
  {role:'chapter',command:'chapter',icon:'book',hint:'Zeigt die eingerichtete Kapitel-Szene.'},
  {role:'interlude',command:'interlude',icon:'image',hint:'Zeigt das eingerichtete Zwischenbild.'},
  {role:'singing',command:'singing',icon:'music',hint:'Zeigt die eingerichtete Gesangs-Szene.'},
  {role:'prayer',command:'prayer-scene',icon:'hands',hint:'Zeigt die Gebets-Szene.'},
  {role:'remote',command:'remote',icon:'remote',hint:'Zeigt die eingerichtete Zuschaltung.'},
  {role:'outro',command:'outro',icon:'outro',hint:'Zeigt die Endtafel und schaltet den Ton aus.'},
];
export function scenePresentation(s:LiveSiteSnapshot,role:DeskRole,fresh:boolean){
  const definition=SCENES.find(d=>d.role===role),action=s.live.pendingAction;
  const requested=!!action&&(action===definition?.command||role==='intro'&&action==='start'||role==='main'&&['main','speaker','bible'].includes(action));
  const names=role==='main'?['main','speaker','bible'] as const:[role];
  const selected=fresh&&names.some(r=>!!s.workspace.bindings.scenes[r]&&s.workspace.bindings.scenes[r]===s.live.observation.program);
  return {requested,selected,onAir:selected&&!requested&&s.live.observation.streaming===true&&s.live.observation.reconnecting===false};
}
export function channelStatus(panel:ManagementPanel|null,language:'de'|'ru',now:number){
  const account=panel?.accounts.find(a=>a.language===language),checked=panel?.checkedAt?.[language];
  const fresh=!!account?.channel&&typeof checked==='number'&&Number.isFinite(checked)&&now>=checked&&now-checked<45000&&!panel?.connectionErrors?.[language];
  const events=fresh?(panel?.remote[language]||[]):[];
  const live=events.filter(e=>e.lifecycle==='live');
  return {fresh,live:live.length>0,count:live.length,label:!fresh?'Status offen':live.length>1?`${live.length} auf Sendung`:live.length?'Auf Sendung':events.some(e=>['liveStarting','testing','testStarting'].includes(e.lifecycle))?'Wird vorbereitet':'Nicht auf Sendung'};
}
/** User-facing language; the unmodified diagnostic stays in the local action journal. */
export function operatorMessage(value:string):string{
  const messages:Record<string,string>={
    'An action is in progress. Release control remains available.':'Eine Aktion wird bestätigt.',
    'Connect & inspect OBS.':'Bitte OBS verbinden.',
    'Wait for confirmed OBS status; unknown is not off.':'Der aktuelle OBS-Status fehlt.',
    'Enable Scenes and captions permission.':'Bitte die Szenensteuerung freigeben.',
    'Enable Service audio permission.':'Bitte die Tonsteuerung freigeben.',
    'Enable OBS start/stop permission.':'Bitte Start und Ende freigeben.',
    'Review the speaker-name group and pool in setup.':'Bitte die Sprecherquellen einrichten.',
    'Map the Bible-reference text source.':'Bitte die Textquelle für Bibelstellen zuordnen.',
    'Map the next-service text source.':'Bitte die Textquelle für den Folgetermin zuordnen.',
    'Select the confirmed service-audio input.':'Bitte die Quelle für den Sendeton zuordnen.',
    'Select a service from the local schedule.':'Bitte einen Termin auswählen.',
    'Map Main for the timed return.':'Bitte das Hauptbild für die Rückkehr zuordnen.',
    'OBS is not confirmed transmitting.':'OBS meldet keine laufende Übertragung.',
    'OBS is transmitting or reconnecting. Joining a service must not run Intro preparation.':'Die Übertragung läuft bereits oder verbindet sich neu.',
  };
  if(messages[value])return messages[value];
  const map=value.match(/^Map the (\w+) scene\.$/);
  if(map)return `Bitte die Szene „${SCENE_LABELS[map[1] as DeskRole]||map[1]}“ zuordnen.`;
  if(/^(OBS .* (?:not confirmed|disconnected)|Action |The operation |The required |Mute result|Program scene|Caption text|Unknown |Select |Enable |Wait |Choose |Map )/.test(value))return 'Die Aktion wurde nicht bestätigt. Bitte OBS und die Verbindung prüfen.';
  return value;
}
