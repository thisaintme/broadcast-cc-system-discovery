# YouTube creation and coordinated publication — staged, not released

## Release hold

Requested 25 October 2026: collect YouTube integration and subsequent changes before running GitHub Actions. This source change is staged on `staging/youtube-consolidation`, forked from `control-center-m1` commit `6f206ba4fad8ac3908f09fad20dfbe51713bd454`. Do not merge into `main`/`control-center-m1`, create a release tag or dispatch a workflow until the user requests the consolidated build. No workflow file or release version is changed by this batch. The installed 0.3.0-alpha.1 application is unaffected.

The implementation is a **source candidate, not a verified release**. Regression tests are included but have not been executed in this authoring session; the local execution environment was unavailable, and GitHub Actions was deliberately not run. TypeScript, existing regressions, new tests, Electron UI/IPC tests, actual Google authorization and physical OBS/YouTube acceptance remain release gates. Do not report these as passing based on code review or previous release results.

## First integration scope

One Google-authorized YouTube channel and the main OBS broadcast. A new YouTube menu opens **Broadcast manager** without stopping the current service or switching scene collections.

- Import a Google Cloud Desktop OAuth client JSON locally, then sign in in the system browser. PKCE (S256), a random OAuth state and a loopback-only temporary callback listener are used. Only the YouTube management scope required for event operations is requested.
- Google refresh credentials are encrypted with Electron safeStorage (Keychain-backed on macOS) in a separate local sidecar. No tokens, stream keys or OAuth client secrets are sent to the renderer, logs, workspace exports or the repository. No plaintext fallback. Google account/Brand Account and channel ID are displayed for review.
- Select a local service. The existing date-prefixed service title is the default; title, description, scheduled YouTube time and privacy are reviewed before creation. Title is limited to YouTube's 100-character limit. Private is the initial visibility; Public is an explicit operator choice. The made-for-kids answer is never inferred from church context.
- Create a scheduled `liveBroadcast` and bind it to the **existing reusable YouTube ingest stream whose key matches OBS**. This creates the audience-facing event without requiring a new stream key or replacing the working OBS destination. It does not create a fresh `liveStream`/ingest-key resource.
- Creating or linking future events is separate from live OBS control. It does not change scenes, audio, transmission, permissions, selected service or caption timers. Google sign-in and event creation do not hold the OBS command mutex; coordinated output operations do.
- Refresh channel events, link/recover an existing compatible upcoming event, open its viewer page and copy its link.
- **Start broadcast with Intro:** explicit channel/event/privacy confirmation; current destination recheck; existing guarded OBS sequence (mute service audio, confirm Intro, start OBS); wait for matching YouTube ingest; explicitly transition only the linked event to `live`; read back lifecycle state. Intro remains on Program with service audio muted. **Live Service → On Air** remains Main + unmute.
- **Outro** remains the existing mute + next-service caption + scene action, without ending transmission.
- **End YouTube broadcast and stop OBS:** require Outro/muted service audio, confirm the linked event, transition it to `complete`, verify completion, then stop the matching OBS output. An OBS-only stop remains available in the original interface, clearly described as not completing a managed YouTube event.
- Separate observed OBS transmission and YouTube event state. Stale, failed or pending checks are unknown, not confirmed live/off. The YouTube manager is the authoritative YouTube display in this staged UI; the existing main banner still reports OBS-only status.

## Destination and lifecycle policy

This initial implementation deliberately **does not write `SetStreamServiceSettings`**. It supports verifiable RTMP/RTMPS YouTube destinations with a reusable key. `GetStreamServiceSettings` is read only through a main-process-specific method, outside the generic inspection/IPC allowlist. Explicit YouTube server URLs are supported; an opaque or `auto` destination, HLS/WHIP service, inaccessible key, wrong channel or unmatched key produces an actionable refusal, not an assumed match. No further broad discovery scan is needed, but actual installed OBS stream-service compatibility must be verified before release.

New events set `enableAutoStart=false`, `enableAutoStop=false` and `monitorStream.enableMonitorStream=false`, allowing explicit publication after ingest is active. This preserves the agreed distinction: **Start broadcast makes Intro live; On Air starts the audible Main service**. Already-running encoder streams are not restarted. The app does not flip an existing event's automation or visibility settings silently.

Another live/testing broadcast using the same key blocks coordinated start/stop. Google channel ownership, event binding, OBS selection and live permissions are checked. Manual release, cancellation, disconnect, profile/collection changes and app closure cancel subsequent work. There is no atomic interlock with another operator, plugin, external encoder or YouTube Studio.

## Partial results and recovery

Before event creation, persist a write-ahead association. Persist an acknowledged event ID before attempting binding. An ambiguous create response blocks blind re-creation and directs the operator to refresh/link the already-created event. Never automatically delete events as cleanup. Event metadata and associations are separate from the general workspace export.

If OBS starts but YouTube ingest/publication is not confirmed, leave OBS running, show uncertainty and provide **Publish current Intro — recovery**. That action requires the selected event, matching active ingest, confirmed Intro and muted service audio; it never restarts OBS. If YouTube completes but the OBS stop fails, the completion can be re-read and a separately confirmed end attempt can finish only the OBS stop. Cancellation does not undo completed remote actions. Never automatically retry mutating requests, roll back scene/mute state, restart a stream or stop a running output on error.

## One-time Google prerequisites

The channel must already have live-streaming access and the operator must be authorized to manage it. Enable YouTube Data API v3 in a Google Cloud project, configure the consent screen/testing users as applicable, and create an OAuth **Desktop app** client. Import that downloaded JSON on the church Mac; do not paste it, tokens or stream keys into chat or commit them to GitHub. An API key is not sufficient for channel mutations; service-account credentials are not supported for this flow. OAuth verification, testing-mode token lifetime, quotas and channel/project restrictions must be checked for the actual Google project. This work does not claim those approvals already exist.

The app is unsigned; Keychain access may prompt again after updates. This must be included in the real-Mac authorization acceptance test.

## Validation before a consolidated release

Run `npm run typecheck`, `npm test`, and `npm run build` locally or in the explicitly approved CI batch. Re-run all eight existing Electron smoke tests. Add/execute a YouTube-manager UI/IPC test using fake Google transport and a synthetic authenticated OBS peer; then complete a private/unlisted end-to-end test with the actual Google project and Mac before public use. No real event is created by repository changes or unit fixtures.

New test source covers draft/schema limits, PKCE/state checks, fixed OAuth endpoints, zero-write observation, non-disruptive future-event creation, persistent duplicate prevention, unconfirmed-create recovery, wrong-channel/key refusal, Intro/start/publication sequencing, ingest timeouts, explicit recovery without restarting, cancellation, changed consent metadata, conflicting active events, separate YouTube completion/OBS stop, sanitized errors, storage without plaintext fallback and final OBS destination checks. These tests are **written, not yet run**.

## Consolidated batch and deferred requests

Current batch: YouTube manager, account authorization, scheduled event creation/linking, coordinated Intro start, completion/stop and diagnostics. Preserve 0.3.0-alpha.1 operator desk, live scheduling and compact Outro-layout fixes. Further requested changes can be added to the same staging branch before a single release review/version bump and build.

Not included here: Russian-channel/Web Presenter lifecycle, automatic email/Telegram delivery, Bible API/typeahead or automatic description appends, new ingest-key provisioning, encoder reconfiguration, camera/PTZ control, and unattended auto-start. Those remain separate requested features, not implied completed work.

## Primary protocol references

- Google OAuth for installed apps: https://developers.google.com/identity/protocols/oauth2/native-app
- Broadcast creation: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert
- Binding reusable input streams: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/bind
- Ingest identity/state: https://developers.google.com/youtube/v3/live/docs/liveStreams
- Broadcast transitions: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition
- OBS WebSocket protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
- Electron secure storage: https://www.electronjs.org/docs/latest/api/safe-storage
