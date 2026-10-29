# Claude Design UI adaptation — 0.3.0-alpha.2

## Scope

This implements the supplied `UI mockups request.zip` as a redesign of the existing live renderer, not as a second simulated app. The base is `control-center-m1` at `6f206ba4fad8ac3908f09fad20dfbe51713bd454`. The separate `staging/youtube-consolidation` work is deliberately not merged by this change.

The main navigation is Übersicht, Übertragung, Termine and Einstellungen. The existing OBS operator desk and activity log remain available as secondary tools. The horizon mark and semantic colour, typography, spacing and motion tokens come from the supplied design export. Dark is the default; the light-theme preference is local to this app. Font stacks prefer IBM Plex when installed, with system fallbacks. No font files, remote fonts, remote scripts or prototype runtime are bundled.

The shell includes a persistent OBS status, observed program and explicit control-release action. The pending automatic return can be cancelled on any screen. Speaker, Bible and outro tiles open docked, non-modal panels; opening a panel is not an output command. Escape closes a panel and returns focus to its opener. Compact layouts stack the panel and keep the control-release action accessible.

## Preserved operational behaviour

- The renderer uses the existing `window.liveService` bridge. There are no changes to OBS command dispatch, transport, permission validation, workspace format or credential storage.
- Scene/audio/stream/operator permissions remain independent, session-only and subject to the existing native confirmations. Observe-only remains the starting state.
- Speaker and Bible captions retain the implemented **10-second** return, not the prototype's 15-second demonstration. The backend starts the timer only after confirmation. Manual mute is preserved.
- Intro mutes the service input. Return to Main preserves audio; the separate on-air action explicitly unmutes it. Outro and stream stop remain distinct actions.
- Text updates continue through the existing text-only path. The UI does not resize OBS text or insert a weekday.
- Editing local services during a stream does not select another service, alter mappings, reset caption timers or change OBS output. Dirty mapping drafts are retained.
- The existing advanced rehearsal/audio-meter app and OBS operator desk remain available. Their backend diagnostics, confirmations and detailed operator labels have not been fully translated.

## Truthful status and deliberate omissions

`OBS sendet` is an encoder observation, not an independent YouTube verification. A disconnected, null or stale observation is shown as unknown; output controls require fresh data. Status is paired with text and icons, not conveyed by colour alone. Requested start/stop and reconnecting states remain distinct from confirmed transmission.

No Russian stream, YouTube event creation, Telegram/email announcement, Bible API, PTZ camera command or camera sleep feature is silently simulated or added by this UI work. Companion configuration inspection is not presented as continuous device-health monitoring. Caption selection cards are explicitly not video previews.

## Validation

Presentation helper tests are included in `tests/live-ui-model.test.mjs`. They cover stale/null/future observations, requested versus confirmed status, chronological service selection, Berlin date labels and countdown/duration formatting.

The existing native `smoke-live.cjs` and `smoke-operator.cjs` retain their operational assertions and now use panel navigation and locale-independent state attributes. `smoke-design.cjs` exercises the actual Electron renderer and IPC against synthetic loopback OBS: side-effect-free cue panels, label distinctions, Escape focus restoration, global countdown cancellation, responsive layout, unique element IDs, themes and stream preservation.

Local Chromium review additionally exercised four screens at 390, 540, 768, 1024, 1200 and 1440 pixels using an injected synthetic bridge; this was an in-memory renderer check, not a native Electron or hardware test. No fixture is bundled with the app. GitHub Actions performs the full dependency install, typecheck, regression tests, application build and macOS native smoke tests before packaging. Check the run result for the exact commit rather than assuming that a source commit implies a successful package.

## Local development and review

From `apps/control-center`, use the repository's pinned Node 24 environment:

```sh
npm install --no-audit --no-fund
npm run typecheck
npm test
npm run build
npm start
```

On a Mac, `npm run dist:mac` creates the existing unsigned universal preview package. The macOS workflow also records the commit and SHA-256 package checksums. A successful synthetic test does not replace a supervised rehearsal with the church's OBS collection and physical equipment. Export the existing workspace before installation and test away from a public service.
