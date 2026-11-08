# Control Center 0.3.0-alpha.6 — Konzept B

## Operator desk

The supplied Claude export is implemented as the production desk, not embedded as a demo. Sendung, Termine and Einstellungen share a persistent status sidebar. Actual YouTube lifecycle and OBS transport status are distinguished. No sample camera footage, fabricated viewer counts or simulated hardware status are shown.

Speaker selection is global within the selected broadcast. Choosing a speaker is local preparation; the Sprecher scene button publishes the selection. Bible references form a persistent per-broadcast queue. Only a successful OBS overlay command marks a reference as shown and advances to the next unshown reference. Selecting or removing a reference does not publish it. Speaker, Bible and prayer overlays return to Hauptbild after 15 seconds. Manual scene changes, release and disconnect cancel pending returns. An active scene is an indicator rather than another action button.

Program preview is a rate-limited OBS screenshot, not a full-motion confidence monitor. Map front and side OBS sources in Einstellungen for their previews. Offline/stale images are labeled. This does not add a direct switcher tally, camera switching, PTZ movement or Web Presenter encoder control.

The managed end panel supports DE, RU or both. Native review precedes a cancellable 15-second countdown. DE uses the existing verified YouTube completion/OBS stop sequence. RU completes the exact app-managed YouTube event after fresh identity and lifecycle checks; Web Presenter must be stopped manually. RU-only ending does not mute or stop DE. Interrupted/uncertain actions are not automatically repeated. The UI never resumes a countdown after restarting.

## Credentials and automatic access

OBS password storage is opt-in, encrypted through Electron safeStorage (macOS Keychain-backed), scoped to the exact configured endpoint, excluded from renderer snapshots, logs and workspace exports. The settings UI is write-only. Automatic startup/reconnection is read-only; live permissions remain off. Encrypted storage unavailable or unreadable fails closed. There is no plaintext fallback; Linux basic_text is rejected. Forgetting credentials does not stop OBS.

YouTube uses the existing encrypted per-channel refresh tokens, client setup and stream-key storage. Valid refresh tokens are reused without opening a browser; refresh requests are single-flight and rotated tokens are persisted. Credential cancellation/removal wins races with in-flight refresh writes. This does not store Google passwords or bypass Google's initial OAuth consent. Revoked/expired grants and Google policy may require reconnection; an external OAuth application left in Testing may issue refresh tokens with a seven-day lifetime. Device Keychain prompts remain controlled by macOS.

## Reusable broadcast series

Create Gottesdienst, Andacht or custom series with an explicit anchor date, weekday(s), local time, weekly interval, exclusion dates and independent DE/RU destination defaults. Europe/Berlin is the supported timezone. Preview an inclusive date range before confirming YouTube creation. No encoder starts during generation.

An occurrence is identified by series ID plus original local date. Overlapping batches do not duplicate previous occurrences, including moved and deleted exceptions. Existing occurrences do not inherit subsequent template edits. DST gaps/ambiguous local times are rejected instead of silently shifted. Past dates are skipped; at most 104 new occurrences and a two-year range are accepted per batch. Partial remote results retain per-target recovery state; uncertain creates are never blindly retried. Individual rescheduling, deletion and recovery remain available in the existing advanced management window.

## Build and validation

`npm ci && npm run typecheck && npm test && npm run build`

The isolated redesign branch's macOS workflow runs all unit tests and native Electron suites, including real safeStorage encryption with synthetic credentials and a loopback OBS server. It packages the same checkout as a universal DMG, verifies the image, checks Intel/Apple Silicon executable slices, and launches the app inside the mounted DMG to exercise desk, secrets, series and account screens. BUILD.json records the exact source commit and SHA256SUMS.txt identifies the delivered image. Passing synthetic tests does not establish compatibility with a particular church camera, switcher, Web Presenter or real Google account.

This remains an **unsigned, unnotarized preview**. No Apple signing identity was supplied; macOS Gatekeeper handling and first-use Keychain prompts have not been eliminated. The existing application ID is retained to preserve the application data location. Never copy encrypted credentials to another Mac expecting them to decrypt there. Back up the non-secret workspace before updating.

Official references: Electron safeStorage API; Google OAuth 2.0 for installed applications; Google OAuth token expiration; YouTube liveBroadcasts.transition; OBS WebSocket 5 GetSourceScreenshot protocol.
