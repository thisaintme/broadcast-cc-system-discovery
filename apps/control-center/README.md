# Broadcast Control Center Preview

## Alpha.4 — read-only audio verification

A new **Audio verification** sidebar screen adds live per-input/channel peaks, mute/volume/track/monitor/activity readings, stale/disconnected indicators, and explicitly saved operator routing observations. No audio control commands have been added.

**Start here:** [Audio verification instructions](docs/AUDIO-VERIFICATION.md).

Install the universal macOS DMG from the **Control Center Preview - macOS** Actions workflow. The artifact is `Broadcast-Control-Center-Preview-macOS`; the DMG is inside its `release/` folder. The packaged app includes its runtime: no Node/npm installation on the church Mac. It remains unsigned/not notarized; do not disable Gatekeeper globally.

Existing services/speakers and caption mappings remain compatible. Audio observation requires only the existing OBS connection and an idle Simulation session; it does not require a new discovery report, Companion, a test-collection name or caption confirmation. It does not play/record audio. Saved notes are historical operator statements; telemetry and credentials are not saved. Export the workspace after explicitly saving observations.

## Existing alpha.3 modes remain

- **Simulation** is default. No device writes.
- **OBS Preview** selects mapped Preview scenes only. It does not edit captions; checked outputs must explicitly be off and Studio Mode on.
- **Offline Program & captions** changes real Program scenes, Bible-reference text, next-service text and a reviewed pool of speaker-name visibility items. This still requires a live-inspected, duplicated collection named `BCC TEST` or `BCC TEST - a description`, confirmation of mappings, a native consent dialog and fresh output checks before each mutation.

The System Discovery application and main branch remain separate from this open PR. No YouTube, stream start/stop, mute/fader/track, PTZ, RODE switching or X32 commands exist in the Preview. Scene changes can still activate media/audio already present. Stop external encoders and disable external automation before any offline-control rehearsal.

## Offline caption rehearsal

1. Back up and duplicate the production OBS scene collection. Name the **copy** `BCC TEST`, select it, and stop all outputs. Do not rename the production collection instead of duplicating it.
2. Connect & inspect OBS again in Connections & mappings. Review the five scene roles and the Bible/next-service text sources.
3. Under Offline Program & speaker-name mapping, enter the exact test-collection name and choose the group of speaker-name text inputs. Review every item in the mutually exclusive text pool and each speaker's source.
4. Click **I reviewed the pool — confirm scene & caption mappings**. Saving metadata alone does not operate OBS.
5. Select a service in Service rehearsal, click **Enable offline Program & captions…** and confirm the native dialog. Run Prepare → Intro → Main → Speaker/Bible → Outro while watching OBS. The app panel is not a live video preview.

Prepare verifies mappings and writes the next chronological service date (Europe/Berlin), or `Nächster Termin folgt.` when none exists. Text changes overlay only `text`, leaving fonts/styles intact. File-backed/unverified text is refused. Speaker selection resolves IDs live, disables other reviewed name text items and enables the chosen one, leaving groups/icons/audio/cameras untouched. Ten-second returns start after Program readback.

Cancel/reset can interrupt pending commands. Completed edits remain in the test collection; there is no automatic rollback, scene restoration, output shutdown or replay on reconnect. Imports/restarts never retain control authorization. Inspect OBS after a partial failure.

Streaming and recording must explicitly report off. Only exact 604 replies from the virtual-camera/replay-buffer status handlers are classified as absent optional resources for offline mode; boolean state remains null. Other uncertainty blocks writes. Preview-only mode keeps all-false requirements. These checks cannot atomically exclude another controller, external encoder, projector or plugin.

## Architecture and tests

Electron + React + TypeScript; main-process state/timers; direct OBS adapter; read-only Companion export metadata. Sandboxed/isolated renderer, bundled-only protocol, sender-validated narrow IPC, localhost endpoints. Workspace persistence is local JSON with atomic replacement, not SQLite yet. Activity logs are session-only.

CI uses Node 24 and pinned direct dependencies. Run `npm install`, `npm run typecheck`, `npm test`, `npm run build`; `npm run dist:mac` packages DMG/ZIP. The resolved dependency lock, package checksums, commit identity and smoke-test images accompany CI artifacts. A reviewed committed lockfile is still required before production distribution.

Synthetic tests cover authentication, optional statuses, safe diagnostics, timers, caption writes/readback, cancellation, workspace projection and the new read-only meter/observation behavior. Electron smoke tests cover startup, password retries, captions and audio UI. Passing CI is not hardware acceptance. The operator reported the alpha.3 offline acceptance tests passed; alpha.4 needs its own on-site audio observation.

## Not yet included

YouTube scheduling/OAuth/encoder start-stop; German/Russian dual encoder operation; automatic broadcast-audio policy; camera switching/tracking; Bible text/verse validation; durable operational logging; production recovery; signing/notarization. Global OBS status is not verified YouTube/external-encoder status.
