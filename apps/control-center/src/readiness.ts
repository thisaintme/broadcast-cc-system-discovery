import type {Snapshot, Workspace} from './model.ts';
import {ROLES} from './model.ts';

/** Display-only prerequisites. These never confirm mappings, grant consent or send OBS commands. */
export interface ReadinessIssue {code: string; message: string}
const issue = (code: string, message: string): ReadinessIssue => ({code, message});
const shown = (value: string | undefined): string => value ? `“${value}”` : '(not set)';

function idleIssues(s: Snapshot, pending: boolean): ReadinessIssue[] {
  const result: ReadinessIssue[] = [];
  if (pending || s.runtime.busy) result.push(issue('busy', 'An operation is still in progress. Cancel / return to Simulation remains available.'));
  if (s.runtime.mode !== 'simulation') result.push(issue('mode', 'Another rehearsal mode is enabled. Use Cancel / return to Simulation before changing modes or setup.'));
  if (s.runtime.phase !== 'idle') result.push(issue('phase', `The rehearsal is in “${s.runtime.phase}”, not Ready to rehearse. Use Cancel / return to Simulation; enable the OBS mode before pressing Prepare.`));
  return result;
}

/** Uses live inventory from the main-process snapshot, not the renderer's editable inventory. */
function mappingIssues(s: Snapshot, draft: Workspace): ReadinessIssue[] {
  const result: ReadinessIssue[] = [], inventory = s.workspace.inventory;
  const test = draft.captions.testCollection;
  if (!s.transport.connected) result.push(issue('connection', 'OBS is not connected. Open Connections & mappings → Connect & inspect OBS.'));
  if (inventory?.origin !== 'live') result.push(issue('inspection', 'Only a saved observation is available. Connect & inspect OBS in this session; importing a file does not count as a live inspection.'));
  if (!test) result.push(issue('test-name', 'The Test collection field is empty. Its grey “BCC TEST” placeholder is not a saved value. Enter the exact name of your duplicated test collection.'));
  else if (!/^BCC TEST(?:$|[ -])/.test(test)) result.push(issue('test-name', 'The test collection name must be BCC TEST or BCC TEST - a description. Use a duplicate, not a renamed production collection.'));
  if (inventory && test && inventory.collection !== test) result.push(issue('inspected-collection', `The last inspected collection is ${shown(inventory.collection)}, but the Test collection field is ${shown(test)}. Select the test copy in OBS, then Connect & inspect OBS again.`));
  if (s.transport.connected && inventory && s.transport.collection !== inventory.collection) result.push(issue('current-collection', `OBS currently reports ${shown(s.transport.collection)}; the inspection belongs to ${shown(inventory.collection)}. Inspect the selected test collection again.`));
  for (const role of ROLES) {
    const name = draft.bindings.scenes[role];
    if (!name || !inventory?.scenes.includes(name)) result.push(issue(`scene-${role}`, `The ${role} scene mapping is ${name ? 'not in the inspected collection' : 'empty'}. Choose it under Scene roles.`));
  }
  if (!draft.bindings.bibleText) result.push(issue('bible-text', 'Bible-reference source is not selected. Choose the actual text input under Caption sources → Bible reference.'));
  if (!draft.bindings.nextServiceText) result.push(issue('next-text', 'Next-service text source is not selected. Choose it under Caption sources → Next-service text.'));
  if (!draft.captions.speakerGroup) result.push(issue('speaker-group', 'No speaker-name group is selected. Choose Group containing speaker-name text sources, then review its names.'));
  else if (!inventory?.nodes.some(n => n.type === 'group' && n.name === draft.captions.speakerGroup)) result.push(issue('speaker-group', 'The selected speaker-name group is not in this inspection. Inspect OBS and select the group again.'));
  if (!draft.captions.speakerPool.length) result.push(issue('speaker-pool', 'The speaker-name pool is empty. Select the group to populate the pool, then review the per-person source selections.'));
  return result;
}

export function captionSetupIssues(s: Snapshot, draft: Workspace, pending = false): ReadinessIssue[] {
  return [...idleIssues(s, pending), ...mappingIssues(s, draft)];
}

/** Mirrors the existing renderer gates and explains known backend prerequisites as well. */
export function offlineEnableIssues(s: Snapshot, pending = false): ReadinessIssue[] {
  const result = [...idleIssues(s, pending), ...mappingIssues(s, s.workspace)];
  if (!s.workspace.bindings.confirmed) result.push(issue('scene-confirmation', 'Scene mappings have not been confirmed for this session. Finish setup, then use the combined scene & caption confirmation button.'));
  if (!s.workspace.captions.confirmed) result.push(issue('caption-confirmation', 'Caption mappings have not been confirmed for this session. In Connections & mappings, click “I reviewed the pool — confirm scene & caption mappings” after completing the fields.'));
  if (s.transport.connected) {
    const absent = s.transport.unavailableOutputs || [];
    for (const key of ['streaming', 'recording', 'virtualCamera', 'replayBuffer'] as const) {
      const value = s.transport[key];
      const optionalAbsent = (key === 'virtualCamera' || key === 'replayBuffer') && value === null && absent.includes(key);
      if (value !== false && !optionalAbsent) result.push(issue(`output-${key}`, `OBS ${key} is ${value === true ? 'active' : 'unknown'}. Offline controls require it to be off or, for optional outputs, explicitly reported unavailable.`));
    }
  }
  return result;
}

/** Simulation has no dependency on OBS, scene mappings, captions or offline authorization. */
export function rehearsalHint(s: Snapshot, pending = false): string {
  if (pending || s.runtime.busy) return 'An action is still in progress. Cancel / return to Simulation remains available.';
  const {phase, mode, selectedService} = s.runtime;
  if (phase === 'idle') {
    if (!s.workspace.services.some(x => x.id === selectedService)) return 'Select a service at the top, or add one in Services & speakers. Then click 1 · Prepare.';
    return mode === 'simulation'
      ? 'Simulation is ready: click 1 · Prepare. It does not require OBS or mapping confirmation. To test real OBS changes instead, enable offline mode before Prepare.'
      : 'Rehearsal mode is enabled. Click 1 · Prepare to begin; only the next workflow step is available.';
  }
  if (phase === 'prepared') return 'Next: click 2 · Intro. Prepare has already been completed. To enable a different mode, use Cancel / return to Simulation first.';
  if (phase === 'intro') return 'Next: click 3 · Main / On Air. Speaker and Bible controls become available after Main.';
  if (phase === 'outro') return 'This rehearsal has reached Outro. Use Cancel / return to Simulation to start another run.';
  return 'Choose a speaker or Bible reference, return to Main, or select Outro. The unavailable earlier steps cannot be repeated in this phase.';
}
