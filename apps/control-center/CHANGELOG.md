# Preview changelog

## 0.1.0-alpha.4

- Add a read-only Audio verification sidebar screen with opt-in input meter/activity subscriptions, bounded metadata polling and separate approximately 5 Hz telemetry delivery.
- Display incoming (pre-volume/mute) and post-volume/mute channel peaks separately. Distinguish real zeros from missing, malformed, inactive, stale, stopped and disconnected readings. Never infer final broadcast audibility from an input meter.
- Save collection-specific, operator-reported routing notes, microphone responses, listening result and monitoring point. Keep telemetry, recordings and credentials out of workspace exports. Old workspaces default to an empty observations list.
- Stop observation on disconnect/reconnect, input/collection changes, leaving the audio screen and before enabling a real rehearsal mode. Preserve normal OBS event subscriptions.
- Add unit, authenticated loopback and actual Electron/IPC UI regression coverage. Preserve the accepted alpha.3 caption/scene code paths and safeguards. No audio mutation or external-device commands added.

## 0.1.0-alpha.3

Added explicit offline Program/caption rehearsal on a duplicated BCC TEST collection: per-person existing text-source visibility, Bible/next-service text overlay updates, fresh output guards, confirmed mappings, native consent, readback and cancellable returns. Synthetic protocol/Electron regressions passed in CI. The operator later reported all discussed offline acceptance checks passed; this does not establish audio/streaming/hardware or production readiness.

## 0.1.0-alpha.2

Separated WebSocket authentication from optional OBS output-status queries. Unavailable replay-buffer/virtual-camera status no longer tears down a valid authenticated session. Added request-specific sanitized diagnostics and actual React-input password retry tests. Preserve the password on failed inspection; clear after success or explicit Clear password. Unknown outputs continue blocking controls.

## 0.1.0-alpha.1

Initial separate Control Center Preview: local workspace/schedule, recursive OBS inspection, read-only Companion metadata, simulation and explicitly enabled Preview-only rehearsal. The original System Discovery app remains unchanged.
