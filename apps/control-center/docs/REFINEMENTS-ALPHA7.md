# Broadcast Control Center 0.3.0-alpha.7

## Operator changes

The previous redesign branch is merged into main. This build adds the follow-up desk refinements.

- One permanent-height automation lane replaces the two return bars. It carries countdown progress and both Main/cancel actions across tabs. Idle, active and finished states reserve the same space; the changing OBS notice is also height-bounded.
- The OBS program preview targets up to five JPEG snapshots per second instead of one every 1.5 seconds. Captures use 960px / quality 55 for program and 320px / quality 45 for mapped camera sources, with slower camera refresh, one global capture in flight, adaptive backoff, stale-reply rejection and paused capture while hidden or outside Sendung. Image updates stay outside global desk state. This remains a snapshot preview, not 25/30fps video; actual latency depends on OBS and the network.
- Bible entry recognizes German book names, common abbreviations, compact references, small spelling errors, ranges, f and ff. Example: `1 Kor 4, 12ff` becomes `1. Korinther Kap. 4 ab Vers 12`. The interpreted result is visible before saving; ambiguous matches require a choice. Free-form references remain explicitly available. Book/chapter recognition is local; verse text and translation-specific verse numbering are not validated.
- Each queued passage has a Bearbeiten action. Edits preserve identity and order and persist across restarts. Changed text becomes unshown again; saving never rewrites an on-air caption. Publish it using the Bible scene button.
- The Outro scene tile immediately runs the mapped Outro and mutes service audio without a confirmation dialog. For an active DE stream it arms a 15-second end deadline. Main cancels that deadline, switches to Main and restores the pre-Outro unmuted state when applicable. Previously muted audio remains muted. With an app-managed DE link, the existing verified YouTube completion then OBS-stop sequence is used; without a link, only OBS is stopped. A failed/stalled Google verification never falls back to an unverified stop. An idle OBS can show Outro without scheduling a future stop.
- The direct Outro tile affects DE only. Existing explicit DE/RU/both review controls remain available in the side panel; Web Presenter still requires manual encoder control. Release, disconnect, profile/collection changes, manual scene changes and restart prevent outstanding automatic stops. Cancellation cannot undo a YouTube completion already sent after the deadline.
- Prayer now uses the exact praying-hands SVG paths from the supplied Claude Konzept B design instead of the shield.

## Validation and installation

Use BUILD.json, SHA256SUMS.txt and the corresponding CI validation artifact for this build's actual result and source commit. The pipeline requires unit tests, native Electron suites, hdiutil verification, both executable architectures and a smoke test of the executable inside the mounted DMG. Packaged acceptance includes the fixed automation lane, prayer icon and fuzzy Bible add/edit, account screens and batch preview.

Tests use disposable profiles, synthetic loopback OBS and no real Google credentials or church hardware. Runtime validation is on Intel macOS; both Intel and Apple Silicon binary slices are checked. The preview is unsigned and unnotarized; no Apple signing identity is supplied. No stream, camera or real account is operated by CI. OBS and Google encrypted credential handling remains unchanged.
