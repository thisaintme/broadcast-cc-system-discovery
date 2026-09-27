# Audio verification — alpha.4

This is read-only observation of OBS input meters and settings, not automatic audio routing, recording, playback or a loudness certification.

## Where to open it

1. Install **Broadcast Control Center Preview 0.1.0-alpha.4**. Existing services, caption mappings and speakers are preserved. Previously exported workspaces remain compatible; they start with no audio observations.
2. Open **Connections & mappings → Connect & inspect OBS**. The normal current OBS password is used once for the connection and is not persisted. Companion is not required for this screen.
3. Stay in **Simulation** with the rehearsal reset, then select **Audio verification** in the left sidebar (second item).
4. Click **Start read-only meters**. No BCC TEST mapping, caption confirmation or service selection is required for this read-only screen. Optional OBS output-status warnings do not prevent observation.
5. Outside a service, ask someone to speak into the pulpit microphone, then each choir microphone individually, using your existing operating/monitoring arrangement. Use normal speech; this app does not unmute anything. Watch which incoming input peaks respond, and listen at a known broadcast monitoring point.
6. Expand **My routing observations** under the relevant input. Classify a likely role; mark only responses actually observed; record the listening result, monitoring point and remaining uncertainties. Click **Save observation** on each edited input.
7. Use **Export workspace with observations…** to save `broadcast-cc-workspace.json`. The original Connections & mappings export includes the same saved notes. Do not put site exports in the public repository.

## Reading the screen

Each reported audio input has per-channel peaks before and after OBS input volume/mute, plus independently refreshed mute, volume-setting, source-active, track-assignment and monitoring fields. A plugin is recognized as audio-capable by its getter response or a meter event, not solely a guessed name.

- **Incoming peak** is the third value of each `inputLevelsMul` channel tuple: before OBS input volume/mute.
- **After volume/mute** is the second value: that input's post-volume peak. It is not a measurement of the final mix, an X32 bus or YouTube.
- Both use `20 * log10(multiplier)`. Zero/very small values display at a floor of -100 dBFS; that floor is not proof of silence at a viewer's speakers.
- OBS commonly reports meters for active inputs only. Inactive, omitted, empty and malformed samples remain explicitly unavailable rather than being coerced to zero.
- A meter becomes stale after two seconds without its current events. Settings become unknown when a read fails or after eight seconds without fresh confirmation. The renderer also rejects updates older than its own 2.5-second reception heartbeat.
- “Source active” is OBS's reported source activity, not a guarantee of audibility or presence on a particular streaming track. Muted, active and meter status are separate facts.
- The settings table in Connections & mappings remains a historical inspection snapshot; it is not the live Audio verification screen.

## Boundaries and lifecycle

No new OBS mutation requests are introduced by alpha.4. Audio observation uses getter requests plus a session subscription change (`Reidentify`) to opt into high-volume meter/activity events. Normal event subscriptions used by the accepted rehearsal controller are preserved. Samples are published to the renderer on a separate approximately 5 Hz channel, not a full workspace per meter packet. Metadata reads are bounded and polled without overlapping batches.

Observation stops on Stop meters, leaving the audio screen, reconnect/disconnect, changed input identities/collections, and before enabling an actual rehearsal mode. Connection loss and late responses cannot resume it automatically. Nothing restores, unmutes or stops an OBS output on exit.

The audio screen starts only while the app is idle in Simulation. Read-only meters can observe any selected collection. This does not relax the BCC TEST restriction, explicit consent, fresh output checks, source review or cancellation behavior for the existing real scene/caption controls.

An observation is saved with its collection, input name and timestamp as **operator-reported**. It is not detected routing and never enables controls. Notes survive imports/restarts as historical statements. Live meter samples are never included in workspace persistence/export; the app neither records nor plays audio. No credentials or raw OBS settings are copied into notes automatically. User-entered notes and source names remain private site information.

Stop external encoders and keep normal manual control available while testing physical microphones. This app cannot verify the church PA path, external encoders, plugins or final YouTube sound. Do not enable monitoring or change a mute just to make a meter move without checking the existing audio route.

## Technical references

- OBS event protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
- Exact tuple construction and active-meter lifecycle: https://github.com/obsproject/obs-websocket/blob/master/src/utils/Obs_VolumeMeter.cpp
- JS session subscription API: https://github.com/obs-websocket-community-projects/obs-websocket-js#reidentify

## Acceptance checks

Observe response to each microphone; distinguish an incoming signal from its muted output; save an uncertain observation without claiming routing is verified; restart and export to check note persistence. A stopped/omitted/stale meter must not look like confirmed silence. Confirm the accepted alpha.3 caption workflow still functions separately in the test collection.

Automated fixtures use invented names and authenticated loopback servers. They do not validate physical church equipment. CI runs typechecking, the existing regression suite, new meter/observation/connection tests, and an Electron UI/IPC audio smoke test including stale/disconnected displays and unsaved-note preservation.
