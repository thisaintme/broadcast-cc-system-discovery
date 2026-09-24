# Preview changelog

## 0.1.0-alpha.2

### OBS connection regression

The alpha.1 connection handler put both the WebSocket handshake and a `Promise.all` of seven state queries inside one catch. A valid authenticated session was disconnected if any state query failed, and every failure was reported as a port/password/server error. OBS can reject `GetReplayBufferStatus` or `GetVirtualCamStatus` with status 604 when those resources are unavailable. This is a reproduced failure path; the earlier generic error did not retain enough information to identify which request failed on a particular installation.

- Separate the handshake from post-authentication queries.
- Independently settle state queries, keeping unavailable fields unknown and reporting request names and numeric codes.
- Continue read-only scene/group inspection even when optional output status is unavailable.
- Use an explicit JSON OBS v5 client for deterministic protocol testing.
- Keep safety checks conservative: unknown is not off and does not authorize Preview writes.
- Distinguish authentication rejection (4009), handshake/network errors, and individual request failures. Never echo upstream messages or credential-bearing payloads.
- Keep the password field on failed authentication or inspection. Clear it only after successful inspection or the explicit Clear password button. Passwords are not trimmed or persisted.
- Reconfirm scene mappings after initiating inspection from the UI.

### Regression coverage

Synthetic localhost WebSocket tests reproduce the old post-authentication failure and exercise successful inspection, wrong-password retry, optional capability failures, unknown-state guards, named inspection errors and status recovery. A separate Electron smoke test enters a synthetic password through the actual React input, clicks Connect & inspect OBS, verifies failure/retry/success behavior through IPC, and checks that neither controls nor persisted credentials are produced.

These tests do not use the church's configuration, credentials or hardware. The existing discovery app remains unchanged. This build is still an unsigned setup/rehearsal preview, not a live-service controller.
