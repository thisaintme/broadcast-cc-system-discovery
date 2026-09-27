# Broadcast Control Center Preview

## Alpha.3 — offline Program and caption rehearsal

This is NOT a live-service controller. The existing System Discovery app remains separate and unchanged. The packaged universal macOS DMG/ZIP includes its runtime; Node/npm are not required on the church Mac.

### Three modes

- **Simulation** is the default. No device writes.
- **OBS Preview** selects mapped Preview scenes only. It does not edit captions and retains the alpha.2 requirement that every checked output is explicitly off and Studio Mode on.
- **Offline Program & captions** changes real Program scenes, Bible-reference text, next-service text and a reviewed pool of speaker-name visibility items. It requires a separately inspected, duplicated test collection whose name starts `BCC TEST`, confirmation of mappings, an explicit native consent dialog and fresh output checks before each write.

No stream start/stop, audio mute/fader/track, PTZ, RODE switching, X32, or YouTube API commands exist. Scene changes can nonetheless activate the media/audio already configured in a scene. Stop external encoders and disable automation yourself; OBS built-in output checks do not cover other equipment, plugins or projectors.

## First run / upgrade

1. Quit the previous Preview app. Install the alpha.3 DMG as **Broadcast Control Center Preview** in Applications. Existing local services/speakers are retained; old workspace files gain empty caption mappings. No control authorization survives an import or restart.
2. In OBS, back up your working scene collection and use Scene Collection → Duplicate. Name the copy `BCC TEST` or `BCC TEST - rehearsal`. Do not rename the production collection instead of duplicating it. Select the copy in OBS and stop all outputs. Disable external automated transitions and encoders.
3. Open Connections & mappings in the app. Import your existing workspace only if it is not already loaded. Keep it out of the public repository.
4. Connect & inspect OBS again. The current password is used only for the connection; failures retain it for retry, success clears it. Inspect the selected test collection, not the production collection.
5. Review all five scene roles. Choose the Bible-reference and next-service text sources that have enabled paths in their scenes.
6. In **Offline Program & speaker-name mapping**, enter the exact test-collection name and choose the group containing the existing speaker-name text inputs. Review every text item in the displayed pool: these will be treated as mutually exclusive names. Images/audio/group items are not included. Select each person's source; an unmapped person is refused, never substituted.
7. Click **I reviewed the pool — confirm scene & caption mappings**. This saves metadata only.
8. In Service rehearsal, select a service and choose **Enable offline Program & captions…**. Read and confirm the native dialog. Run Prepare → Intro → Main → Speaker/Bible → Outro while watching OBS.

Prepare verifies mappings and writes the next-service date. The next entry is chronological, not necessarily next Sunday. Dates use Europe/Berlin. With no later entry, the caption is `Nächster Termin folgt.`. Text changes use an overlay containing only `text`; fonts and unrelated settings are not reset. File-backed or unverified text sources are refused.

Speaker display resolves item IDs live, disables other reviewed text names and enables the selected one. The containing group, icons, camera sources and audio are left alone. Bible display updates only its text, not the group. The ten-second return starts after Program readback confirms the target scene.

**Cancel / return to Simulation** also cancels an in-flight command. Completed edits remain in the test collection. There is no automatic rollback, scene restoration, output shutdown or replay of commands after reconnect. A partial failure can leave some text/visibility edits completed; inspect the test collection before retrying.

## Safety limits and diagnostics

Streaming and recording must explicitly report off. For offline Program mode only, a 604 response from the exact GetReplayBufferStatus or GetVirtualCamStatus handler is recorded as an absent resource, separately from unknown. Their boolean value remains null. Unsupported requests, malformed flags, timeouts, other errors and stream/record failures remain blocking. The basis is OBS's official output-handler implementation, where those two requests return 604 when their output object does not exist. Queries are repeated before every mutation.

There is no atomic interlock with another controller. A remote operator can change state between a read and a write. Use this milestone only in an isolated offline rehearsal. Unexpected Program changes, relevant configuration events, disconnection or output-state changes cancel pending actions. Safe errors retain request names/codes, never raw upstream payloads.

The renderer remains isolated and sandboxed, with no Node access. IPC is sender-validated and offers semantic commands only. Device URLs are localhost-only. Import/export projects known fields and cannot execute Companion actions. Workspace data is a versioned local JSON file, not SQLite yet; logs are session-only. The package is unsigned/not notarized. Do not disable Gatekeeper globally.

## Development / validation

CI uses Node 24 and pinned direct dependencies. Run `npm install`, `npm run typecheck`, `npm test`, `npm run build`. `npm run dist:mac` builds the universal package. The resolved package-lock is included in the CI artifact; a reviewed committed lockfile remains necessary before production distribution.

Tests use invented scene names, a simulated clock and an authenticated synthetic WebSocket peer on a random loopback port. No test contacts church equipment. The suite retains alpha.2 authentication/inspection regressions and adds real adapter coverage for offline caption/Program writes, readback, cancellation, partial failures, unmapped speakers, changed groups, file-backed text, saved authorization and output checks. Passing CI is not physical-hardware acceptance.

Primary protocol references:
- https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
- https://github.com/obsproject/obs-websocket/blob/master/src/requesthandler/RequestHandler_Outputs.cpp

## Not included

YouTube scheduling/OAuth/start/stop; German/Russian dual-encoder operation; broadcast-audio automation; camera switching/tracking; Bible text and verse validation; persistent operational logging; production recovery; signing/notarization. The global OBS state label reports OBS only, not verified YouTube or external-encoder state.
