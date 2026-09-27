# Preview changelog

## 0.1.0-alpha.3

- Added explicitly enabled offline Program/scene and caption control in a duplicated `BCC TEST` collection.
- Added a reviewed mutually exclusive speaker-name pool and per-person source mappings. Names are selected by visibility; no person's existing text is overwritten.
- Added Bible-reference and next-service text updates, preserving font/style settings and refusing file-backed text.
- Read back text, visibility and Program state before progressing. Start ten-second returns after confirmation; stop further writes on cancellation, foreign changes or failures.
- Keep changes already completed in the test collection rather than performing an unsafe automatic rollback.
- Cancellation remains reachable while an OBS operation is pending.
- Separate known absent optional output resources from unknown failures in offline mode. Keep Preview-only compatibility/guards and alpha.2 login regression coverage.
- Existing workspace schema remains readable; new caption fields are projected and authorization is reset on import/export/restart.
- No live streaming, audio, YouTube or physical-hardware command implementations were added.

## 0.1.0-alpha.2

Separated authentication from optional OBS status queries. Correct logins are no longer disconnected merely because an optional status request fails. Kept unavailable status unknown, added request/code diagnostics and synthetic authenticated WebSocket regression tests. Password input is retained after failure and cleared only after success or explicit Clear password. The original discovery application remained unchanged.
