# Subscriber captions · German rehearsal

This is an opt-in pilot, not an OBS subtitle source. Readers open the relay URL on their phone. BCC sends finalized German text; neither audio nor video goes to the relay. Do not change or replace the existing Russian interpretation stream.

## Run the software rehearsal first

From `apps/control-center` with Node 24: `node --test tests/caption-pilot.test.mjs`. This uses a real local HTTP relay and synthetic recognition/YouTube fixtures. It does not open a microphone or modify YouTube.

## Relay and reader URL

On the relay host, set `BCC_CAPTION_TOKEN` to a secret generated with `openssl rand -hex 32` and run `node captions/relay.mjs` (from this app directory). Store that **same** value in the broadcast Mac's launch environment via your secret manager; never send it to a phone, put it in a URL, or commit it. The relay listens on `127.0.0.1:8787` (`PORT` overrides). Run it under a service supervisor. Publish an HTTPS origin through a reverse proxy with SSE buffering disabled; for example, a Caddy site `captions.example.org` with `reverse_proxy 127.0.0.1:8787` and `flush_interval -1` inside the proxy block. Test from the congregation Wi-Fi. Restrict origin access at the proxy to the rehearsal network until approved. **Anyone with reader access can see the text**; the publish token does not protect reading. No access to the BCC or OBS network should be necessary.

The link for phones is just the HTTPS origin `/`. Print that URL or make a QR locally, not via a third-party QR service. Example: `python -m pip install segno` and `python -c 'import os,segno; segno.make(os.environ["BCC_CAPTION_ORIGIN"],micro=False).save("reader-qr.png",scale=8,border=4)'`. Clients also may subscribe to `/events` (SSE, `Last-Event-ID`, bounded replay). A browser can recover missed lines within the replay window; the relay is not a permanent archive.

## Broadcast Mac

1. Start with a **private test service and nonproduction YouTube event**. Provide a named Core Audio input carrying the German program **after the actual on-air mute**. Select the speech channel on input channel one. Do not use the laptop microphone or a pre-fader mixer/OBS monitor bus. Independently listen to the proposed input during a mute: if it contains private speech, stop and fix the route before proceeding. Software telemetry alone cannot prove the physical routing.
2. Create a dedicated Python virtual environment, install `vosk` and `sounddevice`, and unpack a German model from <https://alphacephei.com/vosk/models>. The model and Python environment are **not** inside the DMG. Check the interpreter on this Mac: `"$BCC_CAPTION_PYTHON" -I -c 'import vosk,sounddevice'` and `"$BCC_CAPTION_PYTHON" captions/recognize.py --list`. The full device name must match exactly and be unique. Permit the chosen audio input in macOS when prompted. No default-device fallback.
3. Set the following in the BCC launch environment. Launch the **actual app executable** from that environment, not a previously running Finder instance. Fully quit BCC before relaunching.

```sh
export BCC_CAPTIONS=1
export BCC_CAPTION_PYTHON="$HOME/.venvs/bcc-captions/bin/python"
export BCC_CAPTION_MODEL="$HOME/Models/vosk-model-small-de-0.15"
export BCC_CAPTION_DEVICE='replace with verified program input name'
export BCC_CAPTION_ORIGIN='https://captions.example.org'
# BCC_CAPTION_TOKEN is provided privately. Only after the routing check:
export BCC_CAPTION_POST_MUTE=yes
'/Applications/Broadcast Control Center Preview.app/Contents/MacOS/Broadcast Control Center Preview'
```

4. Select the service and confirm its OBS mappings and its German YouTube link before starting. Open **Mitschrift → Live-Mitschrift öffnen …**, inspect the device and relay URL and explicitly authorize capture. The recognizer only starts on confirmed allowed program scenes with fresh, connected, unmuted OBS streaming state. Unknown/disconnected state suspends capture. Select **Mitschrift abschalten** to disarm; an early manual abort deliberately does not enable YouTube edits.

## After a confirmed end

With the linked German account available, select the local transcript and choose **Titel und Beschreibung vorschlagen**. The pilot extracts representative spoken lines instead of sending the sermon to a writing service. Check recognition errors, titles and quoted text. Existing description text and links are retained in the draft. Compare with the current YouTube text, edit, then explicitly confirm **Auf YouTube übernehmen**. A stop countdown, a different account or an open YouTube event is not sufficient. A changed video must be reviewed again. No automatic writes; no action targets the Russian stream.

## Sign-off on your equipment

- Speak a known name and Bible reference, time the text appearing on a real phone, and record missed words and OBS dropped frames against the same test with capture off.
- Say different harmless test phrases before and after mute; **the muted phrase must be absent both on the phone and in the local archive**. Cancel the outro: public speech should resume within the same transcript without a second service. Finish the outro: text stops and the draft becomes eligible only after YouTube reports the end.
- Drop phone Wi-Fi briefly; confirm replay without duplicate lines. Temporarily disconnect the relay; check the broadcast and local archive continue. A restarted relay or long outage is not guaranteed to resume the same live feed in this pilot.
- Use only a private German test video to try a metadata update. Verify a description link and tags survive, and verify the Russian video is untouched. Rehearse cancelling the update as well.

Local JSONL text files are under the app's `userData/caption-transcripts` (not the relay). They are private files, **not encrypted**; set a retention policy, restrict backups/access, and delete rehearsal data when no longer needed. Disarm and relaunch with `BCC_CAPTIONS` unset to return to the standard desk. Do not enable this for a public service until the physical mute and device tests pass.
