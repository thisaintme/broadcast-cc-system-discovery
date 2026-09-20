/** Shared data contracts. None of these contain credentials or raw device configuration. */
export const ROLES = ['intro', 'main', 'speaker', 'bible', 'outro'] as const;
export type Role = typeof ROLES[number];
export type Phase = 'idle' | 'prepared' | Role;
export type Mode = 'simulation' | 'obs-preview';
export interface SceneItem {
  id: number; source: string; kind: string | null; group: boolean;
  container: boolean; enabled: boolean; index: number;
}
export interface SceneNode {
  name: string; type: 'scene' | 'group' | 'unknown'; items: SceneItem[]; warnings: string[];
}
export interface AudioState {
  name: string; muted: boolean | null; volumeDb: number | null;
  monitor: string | null; tracks: Record<string, boolean>; warnings: string[];
}
export interface Inventory {
  origin: 'report' | 'live' | 'draft'; collection: string;
  scenes: string[]; inputs: {name: string; kind: string}[]; nodes: SceneNode[];
  audio: AudioState[]; warnings: string[]; capturedAt: string;
}
export interface Connection {
  label: string; module: string; version: string; host: string; port?: number;
  enabled: boolean; health: 'unknown';
}
export interface Bindings {
  scenes: Record<Role, string>; speakerText: string; bibleText: string;
  nextServiceText: string; audioInput: string; confirmed: boolean;
}
export interface Service { id: string; title: string; startsAt: string }
export interface Workspace {
  format: 'broadcast-cc-workspace'; version: 1;
  obsUrl: string; companionUrl: string; inventory: Inventory | null;
  connections: Connection[]; bindings: Bindings; services: Service[]; speakers: string[];
  hardwareNotes: { frontInput: string; sideInput: string; audioRoute: string };
}
export interface TransportState {
  connected: boolean; streaming: boolean | null; recording: boolean | null;
  virtualCamera: boolean | null; replayBuffer: boolean | null;
  studio: boolean | null; program: string; preview: string; collection: string;
}
export interface EventEntry { at: string; message: string }
export interface RuntimeState {
  mode: Mode; phase: Phase; selectedService: string; overlay: string;
  returnAt: number | null; busy: boolean; events: EventEntry[];
}
export interface Snapshot {
  version: string; workspace: Workspace; runtime: RuntimeState;
  transport: TransportState; companionResult: string;
}
export interface SourceCandidate {name: string; path: string; enabled: boolean}
export const blankBindings = (): Bindings => ({
  scenes: {intro:'', main:'', speaker:'', bible:'', outro:''},
  speakerText:'', bibleText:'', nextServiceText:'', audioInput:'', confirmed:false,
});
export const blankWorkspace = (): Workspace => ({
  format:'broadcast-cc-workspace', version:1,
  obsUrl:'ws://127.0.0.1:4455', companionUrl:'http://127.0.0.1:8000',
  inventory:null, connections:[], bindings:blankBindings(), services:[], speakers:[],
  hardwareNotes:{frontInput:'',sideInput:'',audioRoute:''},
});
export const disconnected = (): TransportState => ({
  connected:false, streaming:null, recording:null, virtualCamera:null,
  replayBuffer:null, studio:null, program:'', preview:'', collection:'',
});
export type ReadRequest =
  | 'GetVersion' | 'GetSceneList' | 'GetGroupList' | 'GetInputList'
  | 'GetSceneCollectionList' | 'GetSceneItemList' | 'GetGroupSceneItemList'
  | 'GetStreamStatus' | 'GetRecordStatus' | 'GetVirtualCamStatus'
  | 'GetReplayBufferStatus' | 'GetStudioModeEnabled'
  | 'GetInputMute' | 'GetInputVolume' | 'GetInputAudioMonitorType' | 'GetInputAudioTracks';
export interface Reader { read(name: ReadRequest, data?: Record<string, unknown>): Promise<Record<string, any>> }
export interface PreviewPort extends Reader {
  state(): TransportState;
  preview(scene: string, collection: string, valid: () => boolean): Promise<void>;
}
export interface Bridge {
  snapshot(): Promise<Snapshot>;
  importFile(): Promise<Snapshot>;
  exportFile(): Promise<string>;
  saveWorkspace(workspace: Workspace): Promise<Snapshot>;
  inspect(password: string): Promise<Snapshot>;
  companion(): Promise<Snapshot>;
  mode(mode: Mode): Promise<Snapshot>;
  command(command: string, value?: string): Promise<Snapshot>;
  onState(callback: (state: Snapshot) => void): () => void;
}
