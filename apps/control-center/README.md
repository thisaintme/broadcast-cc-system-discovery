# Broadcast Control Center Preview

**Milestone 1: local setup and rehearsal — not a live-broadcast controller.**

This is a separate Electron application alongside the existing discovery tool. The discovery app and its build remain unchanged. No Node/npm installation is required to run the packaged Mac app.

## What works

- Import a discovery v1/v2 report or the earlier draft site profile using a native file picker. Import projects known fields only; it never executes imported actions or retains raw Companion options.
- Connect to OBS on this Mac, recursively inspect scenes and groups, and select scene/source mappings. Group cycles are bounded and failed reads remain unresolved.
- Read OBS input mute/volume/monitor/track snapshots without changing them, including eligible capture sources with embedded audio. A snapshot is not a level meter or proof of physical audio routing.
- Inspect the local Companion full export, with an explicit confirmation, using macOS curl. Raw export data is processed in memory, not a temporary file. Only allowlisted connection metadata is retained; device health remains unknown.
- Add/remove local services and speakers. Default service selection and schedule display use Europe/Berlin. The date-time editor uses the Mac's timezone, as labelled. Next-service information is derived from the schedule.
- Run Prepare → Intro → Main → Speaker/Bible → Main → Outro in **simulation**, including cancellable ten-second returns.
- Optionally arm **OBS Preview rehearsal**. It only selects already mapped OBS Preview scenes; it does not transition Program, edit text, change source visibility, or mute anything.
- Save a local workspace and export it for review. Credentials and raw configuration are not part of the workspace format. Treat site names and LAN addresses as private nevertheless.

## Install the Mac app

Open the **Control Center Preview - macOS** Actions workflow. A successful run has the `Broadcast-Control-Center-Preview-macOS` artifact containing a universal DMG and app ZIP. Open the DMG and copy **Broadcast Control Center Preview** to Applications; this does not replace System Discovery.

The alpha package is not Developer ID signed or notarized. Do not disable Gatekeeper system-wide. Consult Apple's app-specific Open Anyway procedure for a build you trust. A successful CI build does not establish compatibility with the physical broadcast equipment.

## First use

1. Open Connections & mappings → Import report / site profile. Select the latest discovery JSON on the Mac; do not add it to GitHub.
2. Add at least one test service and a test speaker under Services & speakers.
3. Run a simulation in Service rehearsal. No OBS connection is required for simulation.
4. Outside a service, connect and inspect OBS using its current WebSocket password. The password is not persisted. It is used to authenticate this connection only.
5. Review the recursive groups, choose all five scene roles and confirm them. Source selections and hardware-validation notes are metadata, not device commands.
6. Optional: manually enable OBS Studio Mode, stop all OBS outputs, and disable external automation that could transition Preview to Program. Explicitly enable OBS Preview rehearsal. The same rehearsal buttons now select Preview scenes only; displayed speaker names/Bible references still remain simulated in the application.
7. Export the local workspace after recording the unresolved hardware/audio mappings.

## Safety boundary

There is exactly one outbound OBS write: `SetCurrentPreviewScene`. Streaming, recording, virtual camera, replay buffer and Studio Mode state are re-read before every Preview write. Active or unknown output state, a collection mismatch, a missing scene, or an invalidated generation blocks that write. External OBS changes and disconnection cancel timers and disarm Preview rehearsal. A restart never resumes rehearsal or old timers.

There is no atomic interlock with other software. Another operator or external automation can still transition OBS Preview to Program, or start outputs between checks. Use this milestone outside a service. Do not use it as a safety barrier for other controllers.

No YouTube API, Companion action trigger, PTZ, RØDECaster switch, X32 mute, OBS audio write, OBS text write or Program-transition implementation exists in this build. Hardware validation notes cannot unlock these functions. Closing the application does not stop OBS or restore a scene.

Electron uses an isolated, sandboxed renderer, a bundled-resource-only custom protocol, blocked navigation/new windows, denied renderer permissions, and a narrow sender-validated IPC bridge. Endpoint inputs are limited to localhost; credentials in URLs and arbitrary paths are rejected. The full-export reader ignores curl configuration and proxies, bounds size/time and does not follow redirects. Errors never echo response bodies.

## Persistence and implementation scope

React + TypeScript UI; Electron main-process controller; direct obs-websocket adapter; separate read-only Companion adapter. The main process owns rehearsal state and timers. Workspace and schedule persistence for this alpha is a versioned, atomically replaced local JSON file, not SQLite yet. It is stored in the application's user-data directory, with no service credentials. The activity log is session-only. SQLite migrations, encrypted credential persistence and durable operational logs belong to the production milestone.

Not implemented: YouTube OAuth/scheduling/stream start-stop, actual lower-third text updates, Bible text/licensing and verse validation, camera directing/tracking, device-feedback validation, automatic audio routing, or production service operation. The app marks these as unavailable rather than pretending that simulated actions operated hardware.

## Development and tests

Node 24 is used in CI. From this folder:

```sh
npm install
npm run typecheck
npm test
npm run build
npm start
```

`npm run dist:mac` packages universal DMG/ZIP on macOS. Direct dependencies are pinned. The build workflow uploads its resolved package-lock.json with the artifacts; commit a reviewed lockfile before a production release. The first install currently uses npm install because there is no committed lockfile yet.

Tests use synthetic fixtures, never site exports. They cover parsing, endpoint restrictions, credential exclusion, recursive group traversal, unknown/active output guards, external interruption, timer cancellation, phase validity and restart behavior. No test contacts broadcast devices.

Primary API references:
- https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/api/protocol
- https://www.electron.build/v26/docs/mac/
