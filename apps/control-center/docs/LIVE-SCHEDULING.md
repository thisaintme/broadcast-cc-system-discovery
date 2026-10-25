# Live schedule correction — 0.2.0-alpha.2

## What changed

In the first Live Service alpha, adding/removing scheduled services used the same workspace-save route and edit lock as connection and caption mappings. Enabling any live permission disabled the service editor. OBS transmission itself was not the direct cause.

Schedule additions and removals now use a dedicated, validated local command. It merges into the latest saved schedule rather than accepting a replacement workspace from the interface. It does not send OBS requests, release permissions, change the selected service, cancel a pending caption return, or update text already on Program.

## Use during a service

Open **Services & speakers**, choose Gottesdienst, Andacht or a custom title, choose the date/time and click **Add service with date prefix**. You do not need to stop OBS or release live controls. Return to **Live Service** and check **Next scheduled service**.

The next-service label in the app updates immediately. The actual OBS outro text changes only when you deliberately run the existing Outro action. Adding a service neither creates nor modifies a YouTube event.

The selected service is protected from removal in both the interface and backend. Other entries can be removed from the local schedule. Save controls are briefly unavailable while an actual command/save is in progress; an active stream or pending ten-second countdown alone does not block them.

Connection settings, source mappings and speaker-list changes still require releasing live control. Schedule saves preserve unsaved mapping edits; later saving an older mapping draft cannot discard newly added services.

## Validation

Regression tests cover input validation, rejection of unrelated configuration fields, selected-service protection, capacity/duplicate IDs, sorting, local persistence, unchanged permission/timer state, and use of the revised next service by a later Outro action.

The Electron test adds services while an authenticated simulated stream and a real ten-second speaker countdown are active. It checks that the timer and permissions survive, OBS receives no extra writes, removal of the selected service is rejected, mapping edits remain locked, and a stale settings save cannot remove a newer schedule entry. Test data is synthetic; no church devices or private site configuration are used.

The existing OBS controller, audio policy, stream commands and offline guards are unchanged. This is still a supervised unsigned alpha. Keep manual OBS/Stream Deck controls available.
