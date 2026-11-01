# Stream Management · Mac preview

Open **YouTube → Stream Management → Accounts** and connect the German and optional Russian channels. Review the exact channel ID. Select an existing reusable stream profile only when preparing the encoder. OAuth credentials and locally saved streaming keys use Electron safeStorage, separate from the ordinary workspace. Scheduling does not require a stream key or a running encoder.

In **Create**, select one event or a series, its audience and visibility. For a weekly service, select Sunday, 11:00, Europe/Berlin and eight occurrences. Review the expanded dates before confirming: confirmation creates real YouTube events. Set every destination to **Unlisted** for rehearsal; normal-service forms default to Public. Use Upcoming to reschedule against the same event ID or delete an upcoming event. After an uncertain result, refresh and recover the existing event rather than creating it again.

Preparation is separate from going live. The operator-desk handoff controls German/OBS only; operate Russian/Web Presenter start and stop separately. No email or Telegram delivery is part of this preview. Do not reset, paste into chat, or put stream keys in logs.

## Preview build and acceptance

The macOS workflow on `preview/stream-management-dmg` builds the committed source with `npm run dist:mac`. No external implementation ZIP is needed. It runs the regression suite, nine native Electron smoke scenarios, verifies and mounts the universal disk image, and opens the installed-code equivalent directly from that mounted image with a throwaway user profile. It uploads only a preview artifact; it does not publish a GitHub release. This is an unsigned preview. Keep the working app available until an on-site test succeeds.

Before public use, run two consecutive unlisted German broadcasts: reschedule the first without changing its viewing link, start and end it, then create, start and end the second without changing the stream key. Use test accounts or agree a test window, set Russian Unlisted explicitly if enabled, and never run these checks during an active service.
