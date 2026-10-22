# Live Service Alpha — operator guide

## Joining the service already underway

Leave OBS streaming. Open the application, go to **Connections & mappings**, and **Connect & inspect OBS**. Check that the current collection shown is the one actually in use; do not switch or duplicate it during the service. The new Live Service interface has no BCC TEST name requirement.

Keep the mappings you already configured. Any missing field can be selected from the live inventory, then **Save reviewed mappings — no OBS changes**. Your saved service-audio input remains the configured input; no new physical-input discovery is required.

Return to **Live Service**. The top banner describes OBS, not YouTube. Choose the service and only the permissions needed. For the first use choose **Scenes and captions**, leaving **Service audio** and **OBS start/stop** unchecked. Click **Enable selected live controls…**, review the collection/profile and name-source pool in the native dialog, then confirm.

Nothing changes just by connecting, selecting a service, recording a phase, or enabling permissions. There is no need to run Prepare or Intro when joining. Those actions are unavailable during transmission. Use the app for the next genuine speaker or Bible-reference cue.

## Where to operate

**Live Service → Speaker**: select the person, then **Show speaker · 10 seconds**.

**Live Service → Bible reference**: enter the reference, then **Show reference · 10 seconds**.

Watch the actual picture in OBS. The app does not embed a video preview. The return countdown is in the persistent banner, with **Cancel automatic return**. **Return to Main — keep audio unchanged** is a scene-only operation.

To leave the app in observation mode, use the prominent **Release control — leave OBS running** button. This does not undo completed caption edits or change the current mute/scene/output. OBS and the Stream Deck remain the manual fallback.

## Adding audio control

Release control, select **Scenes and captions** plus **Service audio**, and enable again. The confirmation names the exact configured OBS input. There is no hidden + AUDIO checkbox: enabled permissions are listed in the banner.

**On Air — Main + unmute** changes Main first and then unmutes the selected input. **Mute service audio** and **Unmute service audio** are explicit controls. Speaker/Bible cues and all returns leave the input's mute alone. Other OBS input levels, tracks, monitoring and external mixer controls are not changed.

## Starting and stopping OBS

Set up the correct YouTube event and destination in OBS using your normal procedure. The app does not select the channel/event or change the stream key.

Before transmission, enable all three permissions. **Check readiness** does not modify OBS. **Start OBS stream with Intro…** has its own confirmation and then mutes the configured service input, confirms Intro, starts the configured OBS output and checks status. Confirm the correct event/viewer result in YouTube separately.

At the end, **Outro — mute and show next service…** does not stop transmission. **Stop OBS stream…** is a separate confirmed action. Depending on YouTube's existing event configuration, stopping OBS may or may not complete the YouTube event. Keep your normal YouTube completion check.

## When something changes or fails

A manual Program switch cancels the app's pending timer; a manual mute is not undone by caption returns. A disconnect, target-collection/profile change, release or interface reload clears control permission. Reconnect and inspect, then explicitly enable only the permissions needed. The app does not remember or replay a pending action.

Unknown status is not off. An unsuccessful command or readback can leave earlier changes completed; use OBS to assess the current state. The app does not automatically restore a scene/mute or restart/stop a stream. Another controller can act between a check and a command; these are not atomic locks on OBS.

**Activity log** retains recent local actions across restarts. Export it for troubleshooting; do not share passwords or stream keys.

## Advanced tools

**Advanced rehearsal & audio meters…** releases live permissions and relaunches the application into the prior offline interface. Its BCC TEST and output-off restrictions remain unchanged. Read-only audio verification is still available there. Use its **View → Return to Live Service (Observe only)** menu to return. Switching application interfaces does not stop OBS.
