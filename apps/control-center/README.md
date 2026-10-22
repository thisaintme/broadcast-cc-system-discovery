# Broadcast Control Center — Live Service Alpha

## 0.2.0-alpha.1

The packaged application now opens **Live Service** in **Observe only** mode. This is a supervised controller for one already-configured OBS instance and its main broadcast. It can join an ongoing stream without changing its picture, audio or transmission. No Node/npm installation is needed on the broadcast Mac.

The macOS application keeps the name **Broadcast Control Center Preview** and the same app ID/user-data location, so existing local schedules, speaker lists, mappings and observations remain available. The original System Discovery application remains separate. The prior offline tools are available under **Advanced rehearsal & audio meters…**, which releases live control and relaunches the application into the legacy interface. In the advanced interface, use **View → Return to Live Service (Observe only)**.

## First use during a service

1. Install the new DMG by replacing the old Preview app, not OBS. Keep normal OBS/Stream Deck operation available. Do not stop the service just to connect the controller.
2. Open **Connections & mappings**. Confirm the local WebSocket URL, enter the current OBS password, and click **Connect & inspect OBS**. Connection and inspection are read-only. Passwords are never persisted.
3. Review the current OBS collection and saved mappings. **Live Service does not require BCC TEST and never switches collections.** Existing mappings are reused; only missing or changed sources need review. Select the speaker-name group and review its mutually exclusive text-name pool, plus Bible-reference text, next-service text and the confirmed service-audio input. Click **Save reviewed mappings — no OBS changes**.
4. Open **Live Service**. Select the local service. Choose only **Scenes and captions** initially, click **Enable selected live controls…**, and review the native confirmation. Granting permissions performs no broadcast changes.
5. Use a speaker/Bible action when it is actually needed. The confirmed display returns to Main after ten seconds. **Return to Main** does not unmute audio. External Program changes and a newer app action cancel the previous return.
6. **Release control — leave OBS running** cancels pending automation and clears permissions without stopping OBS or restoring a previous scene/mute state. Manual operation remains available.

No artificial Intro → Outro sequence is required to join a service already underway. The phase selector records a description only; it executes nothing and starts no timer.

## Independent session permissions

- **Scenes and captions:** mapped Program scenes, reviewed per-person name visibility, Bible-reference and next-service text.
- **Service audio:** explicit mute/unmute of only the configured service input. No volume, track, monitoring, X32 or RØDECaster changes.
- **OBS start/stop:** the configured OBS encoder output. Destination/event setup remains manual. Start and Stop each require a separate native confirmation.

Permissions are visible on every screen. No permission survives a restart, disconnect, configuration-target change, release, or interface reload. Saved mappings are not stored authorization. Missing Bible mapping blocks Bible display, not other mapped controls. Required current connection/collection/profile/Program state must be known; missing optional Replay Buffer/Virtual Camera resources are not queried by this controller.

## Operator actions

| Action | Behavior |
| --- | --- |
| Check readiness | Validate Intro/Main without changing outputs. Other features have separate readiness checks. Only available before transmission. |
| Show Intro | Verify/mute the selected service input, then select Intro. Not available during an ongoing transmission. |
| Start OBS stream | Separate confirmation; verify/mute service input, confirm Intro on Program, then start the existing OBS destination and read back status. Requires all three permissions. Never restarts an already active/reconnecting stream. |
| On Air | Confirm Main on Program, then unmute the selected service input. Requires scene and audio permissions. |
| Return to Main | Scene only; preserve any manual mute. |
| Show speaker / Bible reference | Update only the mapped text/visibility, confirm Program, then schedule a cancellable ten-second return to Main. Audio is unchanged. |
| Mute / Unmute service audio | Set an explicit boolean mute state on the selected input and read back. No toggle. |
| Outro | Separate confirmation; mute service input, update next-service text and show Outro. Does not stop transmission. |
| Stop OBS stream | Separate confirmation; stop and verify OBS transmission only. Does not change scene/audio or independently complete a YouTube event. |
| Release control | Cancel pending actions; leave completed changes and running outputs alone. |

The persistent banner shows OBS transmission, Program, selected-input mute, duration, frame counters, control permissions and any return countdown. Missing/stale states become **Unknown**, not **Off**. **OBS transmitting is not independently verified YouTube live status.** Keep existing viewer-side monitoring.

## Scope limits

One OBS instance and main stream. No YouTube OAuth/event creation, stream-key/encoder setting changes, Russian-stream/Web Presenter automation, X32 commands, Companion button presses, RØDECaster switching, PTZ/AI directing, email/Telegram distribution or full Bible-text retrieval. Local title presets (Gottesdienst, Andacht, custom) add a Europe/Berlin service-date prefix but do not edit YouTube. Existing titles are preserved.

## Reliability and privacy

Live logic is separate from the accepted offline controllers. The renderer is sandboxed, with no Node access, no network access and sender-validated semantic IPC. Only localhost OBS endpoints are accepted. Command requests are serialized. Release/cancel remain reachable during a pending operation or native dialog. Each write checks session permissions, target collection/profile, cancellation and fresh OBS state; commands are read back before reporting completion. No automatic retries, rollback, output shutdown, or command replay on reconnect.

Manual Program changes cancel pending automation. Manual mute is preserved across captions and returns. A manual mute during an audio-changing action interrupts that pending action. A failure can leave already completed scene/text/mute changes in place: inspect OBS before continuing.

Activity is recorded in a local rotating `logs/live-service.jsonl` (three bounded files), with requested/acknowledged/verified/failed stages. Only local diagnostics are recorded, never passwords, raw OBS replies, stream keys or authentication tokens. **Activity log → Export activity log…** exports the recent retained entries. A journal write failure blocks further live changes rather than silently dropping the trail. Workspace/log exports can still reveal site information and should not be committed publicly.

There is no atomic interlock with another operator, OBS plugins, external encoders, monitoring paths or projectors. Network acknowledgements do not certify viewer sound/video. Keep manual OBS/Stream Deck controls available. This remains unsigned/not notarized alpha software, not unattended production automation.

## Build and validation

CI uses Node 24 and the existing pinned direct dependencies. `npm run typecheck`, `npm test`, `npm run build`; `npm run dist:mac` creates universal macOS DMG/ZIP files. The test runner enables Node's TypeScript transformation for the new typed classes. CI uploads the resolved dependency lock, package hashes, commit ID and screenshots. A reviewed committed dependency lock and signed/notarized release remain future work.

The suite retains previous authentication, offline-caption, audio-meter, mute-policy and readiness tests. New unit and authenticated-loopback tests cover non-disruptive joining, independent permissions, production collection support, manual overrides, cancelled/failed actions, stale status, start/stop sequencing and durable logs. The new Electron/IPC test exercises real UI permission/action buttons and a real ten-second return against a synthetic OBS peer. Test names and credentials are invented; no test accesses church equipment. A passing build is not physical-site acceptance.

Primary protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
