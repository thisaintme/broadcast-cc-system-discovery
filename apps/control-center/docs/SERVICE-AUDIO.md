# Service-audio mute rehearsal — alpha.5

This adds an optional mute policy for one configured OBS input to the accepted offline Program/caption workflow. It is not permission to broadcast or operate the X32/RØDECaster.

## Install and enable

1. Install the `0.1.0-alpha.5` universal macOS DMG. Keep your existing local workspace and tested caption mappings; do not overwrite them with an older export. Node/npm are not required to run the app.
2. Outside a service, select the backed-up, duplicated `BCC TEST` collection already used for caption rehearsal. Stop OBS outputs and external encoders; disable competing automation. A collection copy does not isolate physical audio devices or external monitoring paths.
3. Connect & inspect OBS in this session. In **Connections & mappings → Caption sources → Service-audio input (mute rules are opt-in)**, select the exact confirmed service input. Saving the source selection does not change a mute. Reconfirm the existing scene/caption mappings as required.
4. Open **Service rehearsal**, select a service and, before Prepare, click **Enable offline Program & captions…**.
5. In the native confirmation dialog, check **Also apply service-audio mute rules to "<selected input>"** and confirm. The checkbox is off by default every time. The input is checked against live OBS data; enabling the mode itself does not mute or unmute it.
6. The mode label adds **+ AUDIO** and the Service audio card says the rules are enabled for this session. Run the workflow while watching that input's mute icon in OBS.

No repeat of network or physical-input discovery is required. Use the operator-confirmed input selection already in the workspace. The Audio verification screen remains a separate read-only tool.

## Exact behavior

| Action | Selected OBS input |
| --- | --- |
| Prepare | Explicitly mute and read back before continuing preparation. |
| Intro | Explicitly mute and read back before the Intro scene. |
| Main / On Air from Intro | Confirm Main on Program, then explicitly unmute and read back. |
| Speaker / Bible | No mute command. |
| Automatic or manual return to Main, or repeated Main | No mute command; preserve a manual mute. |
| Outro | Explicitly mute and read back before caption/outro completion. |
| Cancel / close / disconnect / reconnect | No compensating mute, unmute or replay. Completed changes remain. |

Only `SetInputMute` is added to the existing mutation allowlist. There is no toggle, volume, balance, sync, monitoring, track, mixer, switcher or camera write. Audio on other inputs is not changed. Names are configuration, not hard-coded site information.

Each audio write requires the original live-inspected test collection, confirmed mappings, fresh output checks, a matching live input, valid cancellation generation and an explicit boolean mute state. Main readback must succeed before unmuting. Unsupported/missing/malformed input state, rejected commands or failed readback stop the action and report Unknown / not confirmed. There is no automatic retry, rollback or reconnection replay.

The service mute card is independently updated from OBS events and bounded status reads. Stale/disconnected status becomes unknown. It describes the selected input's mute flag, not final mix silence or YouTube audibility. Read-only meters and historical observations never authorize the policy.

A manual input-mute event cancels an in-flight audio-changing action, but does not interrupt caption-only actions or their timer. Selecting Main while returning from a caption does not unmute a manually silenced input. To begin a new On Air transition, reset and explicitly enable the offline mode again.

## Acceptance check

- Prepare and Intro show the selected input muted in OBS.
- Intro → Main / On Air unmutes it only after Main is confirmed.
- Speaker and Bible displays plus timed/manual returns leave it unchanged.
- Manually mute the input in OBS while on Main, show a speaker, and allow the ten-second return. It must remain muted.
- Outro mutes it. Cancel/exit must leave the current mute state unchanged.
- Leaving the optional checkbox unchecked preserves the old caption-only workflow with no audio commands.

These are tests of the software's sequencing. They are not another request to identify the actual service input.

## Scope and validation

Audio authorization and status are session-only, absent from workspace persistence and exports. Local services, speakers, caption mappings and operator audio notes retain their existing format. Credentials are not saved.

Unit and authenticated loopback tests cover sequencing, disabled-policy behavior, manual mute preservation, output guards, missing/malformed inputs, failed readback, cancellation and reconnect without replay. An Electron test exercises the actual buttons, native-dialog opt-in handling and a real ten-second caption return against a synthetic OBS peer. No CI test contacts church equipment.

This remains unsigned/not notarized offline alpha software. Stop external encoders and keep manual control available. Another operator can act between a status read and a write; there is no atomic interlock with external software. Scene changes can activate media/audio already present, even though this feature writes only the selected input's mute flag.

Protocol reference: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#getinputmute and #setinputmute.
