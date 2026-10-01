# Broadcast Control Center Preview

## Alpha.5 — optional service-audio mute rules

Separate Electron + React + TypeScript macOS application. The original System Discovery app remains unchanged. This is an **offline rehearsal alpha, not a live-service controller**. Packaged DMG/ZIP installers include the runtime; no Node/npm installation is needed on the church Mac.

### Modes

- **Simulation:** no device writes.
- **OBS Preview:** mapped Preview scene selection only, with the existing all-outputs-off and Studio Mode checks. No captions or audio are changed.
- **Offline Program & captions:** the accepted alpha.3 real scene/caption workflow in a live-inspected, duplicated `BCC TEST` collection, with confirmed mappings, native consent, fresh output checks and readback.
- **Optional service audio in offline Program mode:** check the additional box in the native mode dialog to apply mute rules to the exact configured service input. It starts unchecked every time and never survives reset/restart. Enabling a mode alone does not mute anything.

## Next offline test

Keep your existing workspace and tested caption mappings. Select the backed-up duplicate test collection, stop outputs/external encoders and disable competing automation. Connect & inspect OBS. Choose the service-audio input under **Connections & mappings → Caption sources** and reconfirm the scene/caption mappings.

In **Service rehearsal**, select a service, click **Enable offline Program & captions…**, check **Also apply service-audio mute rules to "<input>"**, and confirm. The mode label adds **+ AUDIO**. Prepare/Intro mute; Intro → Main confirms the scene and then unmutes; Speaker/Bible and all returns preserve the mute state; Outro mutes. Cancel/exit/reconnect never restores or replays a mute command.

Only the selected OBS input's mute flag changes. Its volume, tracks, monitoring, other inputs and all hardware stay untouched by the new audio policy. The service-audio card shows verified, pending or unknown OBS input-mute state, not final broadcast audibility.

Full instructions: [Service-audio rehearsal](docs/SERVICE-AUDIO.md).
Read-only meters and operator-note workflow: [Audio verification](docs/AUDIO-VERIFICATION.md).

## Existing setup and captions

The app imports discovery reports and workspace files locally, inspects nested OBS scenes/groups and audio snapshots, and reads selected Companion configuration metadata. Configuration is not live hardware health. Passwords, raw Companion exports and actual control authorization are not persisted. Site files still contain private names and addresses; keep them out of the public repository.

Review all five scene roles plus Bible/next-service text inputs. Select the group of separate speaker-name text sources, review every name in its mutually exclusive pool, map each person and confirm. Unmapped speakers are refused. Text updates contain only the text field, preserving styles; file-backed or malformed settings are refused. Groups, images, audio and camera items are not toggled by speaker selection. Ten-second returns start after Program confirmation and are canceled by newer actions.

Service dates are displayed in Europe/Berlin; the date editor uses the Mac's timezone as labeled. Outro uses the next chronological scheduled entry. Local workspaces use versioned JSON, not SQLite yet; logs are session-only.

## Safety and remaining scope

The BCC TEST requirement, live-session inspection, confirmed mappings, native consent and output guards remain in force. Only exact 604 responses for optional Replay Buffer/Virtual Camera handlers are classified as absent resources; their flags remain null. Unknown or failed streaming/recording state remains blocking. There is no atomic interlock with another operator, plugins, external encoders or projectors.

Completed scene, caption or mute edits remain after failure or cancel; inspect OBS after a partial failure. No automatic rollback, output shutdown or retry on reconnect is performed. Read-only audio observations never authorize writes.

No YouTube API, encoder start/stop, X32 controls, RØDECaster switching, PTZ commands or Companion button triggers are implemented. Global OBS state is not verified YouTube or external-encoder state. Full Bible text/verse validation, dual-language encoders, production recovery, durable logging, SQLite and signed/notarized distribution remain later work.

## Build and validation

CI uses Node 24 and pinned direct dependencies. From this folder: `npm install`, `npm run typecheck`, `npm test`, `npm run build`. `npm run dist:mac` builds a universal DMG and ZIP. The workflow uploads its resolved dependency lock, package checksums, commit ID and test screenshots. A reviewed committed lockfile is still required before production distribution.

Regression tests retain the accepted caption, connection and read-only meter behavior. New tests cover the mute sequence, manual-mute preservation, unknown readback, cancellation and session-only opt-in. Electron smoke tests run the interface and IPC against authenticated synthetic localhost OBS peers. They do not contact church hardware or validate final broadcast sound.

Download the `Broadcast-Control-Center-Preview-macOS` artifact from the successful **Control Center Preview - macOS** run. Install the DMG by replacing the previous Preview app; existing local workspace files remain compatible. Builds are unsigned and not notarized; use an app-specific macOS exception only for a build you trust, never disable Gatekeeper globally.
