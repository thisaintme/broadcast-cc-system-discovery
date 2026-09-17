# Broadcast CC System Discovery

Read-only macOS discovery app for the Broadcast Control Center project.

It inventories the broadcast Mac and attempts to discover:

- OBS via obs-websocket (default `ws://127.0.0.1:4455`)
- Bitfocus Companion via its HTTP API (default `http://127.0.0.1:8000`)
- ONVIF cameras using WS-Discovery multicast
- Behringer X32 / Midas M32 mixers using the read-only OSC `/info` request
- macOS host/network information and whether OBS/Companion are running

## Safety

The application is intentionally **read-only**. Discovery code contains no operations to move PTZ cameras, switch program video, change mixer values, change OBS scenes, or start/stop streaming.

OBS passwords are held only for the duration of the scan and are never written to exported reports. Exported reports contain local device addresses and configuration names, but no configured secrets/tokens.

## Download a ready-to-use Mac build

Every push to `main` builds a universal macOS `.dmg` and `.zip` in GitHub Actions. Open the latest **Build macOS app** workflow run and download the `Broadcast-CC-System-Discovery-macOS` artifact.

Version tags such as `v0.1.0` additionally create a GitHub Release containing the `.dmg` and `.zip`.

The initial builds are unsigned. macOS Gatekeeper may therefore require **right-click → Open** the first time. Code signing and notarization can be added later without changing the scanner architecture.

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

This is the first discovery build. In particular:

- ONVIF discovery currently identifies responding devices and service addresses; authenticated device metadata can be added after testing against the actual cameras.
- X32/M32 discovery probes hosts already present in the Mac ARP table plus an optional manually supplied mixer IP. It deliberately does **not** sweep the whole subnet.
- Companion API formats can vary by version; the report preserves warnings when a response cannot be normalized.
