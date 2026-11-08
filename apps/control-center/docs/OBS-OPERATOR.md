# OBS operator desk — 0.3.0-alpha.1

This release extends the tested service workflow with manual operation of existing OBS scenes, inputs and outputs. It is **not every OBS setting or an OBS replacement**. YouTube event/channel setup, camera/hardware control, source creation/deletion, layout transforms, filters, track/monitor routing, encoder/destination settings and third-party plugin configuration remain outside the app.

## Existing Live Service workflow

The main screen still handles selecting a service, starting OBS with Intro, On Air (Main + service-input unmute), speaker/Bible displays with ten-second returns, Outro (mute + next service) and separately confirmed Stop OBS stream. It can join an ongoing stream without changing outputs. The 0.2.0-alpha.2 live scheduling correction and 0.2.0-alpha.3 compact date/text-layout fix are retained. Schedule updates do not modify a currently displayed OBS caption; Outro refreshes the next-service date when deliberately invoked.

## New optional permission and page

On **Live Service**, release existing control, select the permissions needed, including **OBS operator desk**, and enable them. The review dialog names the current collection/profile and the broader manual scope. Enabling itself performs no writes. Open **OBS operator desk** in the sidebar. Stream start/stop remains a separate permission and stays on Live Service.

The panel reads current capabilities and existing names from OBS. It does not use the historical workspace export as proof of live output status. Optional Replay Buffer, Virtual Camera, media or recording capability failures do not disable unrelated service functions. Unknown is displayed as unknown, not off. Observe-only inspection does not require operator permission.

Every manual desk write has a native Cancel-default confirmation naming its target and effect. A confirmed manual operator action cancels the app's pending caption return. Cancelled confirmation does not execute the action. Shared input/group changes can affect Program and audio even when the selected container is not the top-level Program scene. There is no atomic lock against another operator or plugin.

## Available controls

- Select any existing scene on Program, without applying mute rules or adding a return timer. To display a chosen speaker name, use the Live Service speaker cue instead.
- Studio Mode enable/disable, select a scene in Preview, and transition the confirmed Preview to Program using the existing OBS transition. The app rechecks Preview before sending the transition. No embedded video preview: watch OBS itself.
- Select an existing OBS audio input, inspect its mute/level, explicitly mute/unmute it, or set gain between -100 and 0 dB. This is OBS gain, not the physical mixer. No positive gain boost, mute toggle, track or monitor change.
- Inspect an existing scene/group and explicitly show/hide an identified item. Nested items are available by selecting their group. The backend checks both source name and item ID. No deletion, movement, resizing or cropping.
- Read/edit built-in manual text sources. Only `text` is overlaid; font, dimensions and transforms are untouched. File-backed text is refused. Empty replacement text is an explicit clearing action.
- Recording start/stop and pause/resume, using existing OBS settings. Pause may not be supported by a particular encoder configuration. No stream stop is attached to recording stop.
- Replay Buffer start/stop/save and Virtual Camera start/stop when available. The app does not configure missing outputs. Replay saving checks for a new reported saved file.
- Existing FFmpeg/VLC media input play/pause/stop/restart, where the input reports playback state. Very short media can finish before confirmation; the app reports failure/unknown rather than silently retrying.

All commands share the live controller's session, cancellation, target checks, serialization and durable activity log. Failed commands may leave completed changes in OBS; no automatic rollback, unmute, restart or shutdown is performed. Release, app exit and disconnect do not stop outputs. Authorization does not survive restart/reconnect.

## Supervised service use

Install by replacing the Preview app, not OBS. Keep the working production collection and existing mappings. Connect/inspect, choose today's service and enable only the controls needed. During an already-running service, do not run Intro preparation or restart the stream. Use the ordinary speaker/Bible/Outro actions at the actual cues; no artificial test sequence is necessary.

New desk controls can change the broadcast. Prefer the known service buttons for normal operation and use manual desk actions only for intentional cues. Do not test mute/stop/hide commands on live content simply to prove a button works. Keep OBS and Stream Deck controls available, and monitor the actual viewer feed. OBS transmitting does not independently certify YouTube's broadcast state.

## Build validation

The release pipeline retains prior domain, audio, scheduling, text-layout and seven Electron tests, and adds operator schema/permission/target/output tests plus an eighth Electron UI/IPC test against an authenticated synthetic OBS peer. The new UI test checks cancellation, manual scene/Preview/transition, selected input level/mute, nested visibility, text preservation, recording and Virtual Camera, media, release during confirmation and no unintended stream-stop/start. Test fixtures contain no church names, addresses, credentials or exports.

Passing these tests is not physical-site acceptance. This is an unsigned, unnotarized supervised alpha. The version is an operational expansion, not a claim of complete OBS API coverage.

Primary protocol reference: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
