# Broadcast CC System Discovery

Read-only macOS discovery app for the Broadcast Control Center project.

It inventories the broadcast Mac and attempts to discover:

- OBS via obs-websocket (default `ws://127.0.0.1:4455`)
- Bitfocus Companion (default `http://127.0.0.1:8000`)
- ONVIF cameras using WS-Discovery multicast
- Behringer X32 / Midas M32 mixers using the read-only OSC `/info` request
- macOS host/network information and whether OBS/Companion are running

## Safety

The application is intentionally **read-only**. Discovery code contains no operations to move PTZ cameras, switch program video, change mixer values, change OBS scenes, or start/stop streaming.

OBS passwords are held only for the duration of the scan and are never written to exported reports.

For Companion 4.x, v0.2 uses the same local full-export endpoint that can be retrieved with `/usr/bin/curl`:

```
/int/export/full?format=json
```

The raw Companion export is written only to a temporary directory, parsed in memory, and deleted immediately. The saved discovery report contains only normalized connection metadata and button/action mappings. Password-, token-, credential-, cookie- and secret-like fields plus embedded button images are stripped.

## v0.2 additions

- Companion 4.x full-export discovery using macOS `/usr/bin/curl`
- fallback to lightweight Companion connection APIs when export is unavailable
- Companion build/module versions, device addresses and useful button/action mappings
- detailed diagnostics for non-JSON Companion responses without retaining the raw response
- OBS scene-item enumeration so each scene can be mapped to its actual sources
- discovery report schema version 2

## Download a ready-to-use Mac build

Every push to `main` builds a universal macOS `.dmg` and `.zip` in GitHub Actions. Open the latest **Build macOS app** workflow run and download the `Broadcast-CC-System-Discovery-macOS` artifact.

Version tags additionally create a GitHub Release containing the `.dmg` and `.zip`.

The builds are currently unsigned. macOS Gatekeeper may therefore require **right-click → Open** the first time.

No Node.js, npm, Homebrew, or developer tools are required on the broadcast Mac to run a packaged build.

## Local development

Requires Node.js 24+.

```bash
npm install
npm run typecheck
npm start
```

Build the macOS package locally with:

```bash
npm run dist:mac
```

Artifacts are written to `release/`.

## Current scope

- ONVIF discovery identifies responding devices and service addresses; authenticated device metadata can be added after testing against the actual cameras.
- X32/M32 discovery probes hosts already present in the Mac ARP table plus an optional manually supplied mixer IP. It deliberately does **not** sweep the whole subnet.
- Companion export formats are normalized conservatively. Unknown fields are not copied wholesale into the report.
