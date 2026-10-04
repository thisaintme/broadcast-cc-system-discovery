# Rehearsal readiness — alpha.6 usability fix

Alpha.5 displayed “Offline Program mode is not authorized” whenever saved caption confirmation was false. That label was not an OBS permission error and did not identify which field or session condition was missing. A service selection never implied authorization to change OBS.

Alpha.6 adds actionable explanations beside both affected controls. It does not remove checks or auto-confirm imported configuration. The controller, OBS adapter, audio policy, native consent dialog and workspace format are unchanged.

## Service rehearsal

Mode controls and Cancel are now immediately below the selected service. **Real OBS mode — readiness** lists current blockers: busy/not-idle state, connection or inspection, exact collection mismatch, empty or missing scene/caption/group selections, unconfirmed saved mappings, and active or unknown outputs. **Open Connections & mappings** opens setup without making any device changes.

**Simulation is independent of this checklist.** With a selected service and no pending action, Prepare is available while idle even without OBS or any source mappings. After Prepare the next button is Intro, then Main. After Outro, Cancel / return to Simulation starts another run. The next-step message above the stage explains this sequence. It also explains why enabling OBS mode after Prepare requires resetting first.

## Connections & mappings

The OBS card distinguishes **Current OBS collection** from **Last inspected collection**. No historical export is treated as a live inspection.

The section **Offline Program & speaker-name mapping** now includes **Before you can confirm these mappings**, listing exactly which current draft fields are missing. In particular, the grey BCC TEST placeholder does not populate the Test collection value. That field must name the actual duplicated test collection, which must match the live inspection. Typing a name does not create or select a collection in OBS.

Once fields are complete, review the name pool and click **I reviewed the pool — confirm scene & caption mappings**. This saves metadata only. Return to Service rehearsal and use the native offline Program confirmation dialog before Prepare. The alpha.5 service-audio checkbox remains separate and unchecked by default.

Existing imports, inspection and setup edits continue to require confirmation. This release does not replace missing fields using an old report, manufacture a live inventory, re-identify the service-audio source, change OBS settings during setup, or enable production controls.

## Validation scope

New unit tests cover each disabled-button reason, draft vs saved/live state, collection mismatches, optional-output classification and next-step instructions. An Electron/IPC test exercises actual React fields and buttons: Simulation with no OBS, missing setup, mismatched collection, completing and confirming mappings, cancelling native consent and reinspection clearing confirmation. It asserts zero OBS writes from this diagnostic sequence. All previous caption, audio, authentication and safety regressions remain in CI.

These tests explain supported states; the old generic message alone cannot establish the specific state of the operator's running app. Read the new checklist for that diagnosis. The build remains unsigned and is for offline testing, not a live-service release.
