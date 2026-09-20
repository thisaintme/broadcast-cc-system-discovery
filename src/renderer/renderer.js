const $ = (id) => document.getElementById(id);
const scanButton = $('scan');
const saveButton = $('save');
const activity = $('activity');
const results = $('results');

function status(target, ok, label, warning = false) {
  target.className = `status ${ok ? 'ok' : warning ? 'warn' : 'error'}`;
  target.textContent = `${ok ? '✓' : warning ? '!' : '×'} ${label}`;
}

function lines(values) { return values.filter(Boolean).join('\n'); }

scanButton.addEventListener('click', async () => {
  scanButton.disabled = true;
  saveButton.disabled = true;
  activity.textContent = 'Scanning…';

  try {
    const x32Host = $('x32-host').value.trim();
    const report = await window.broadcastDiscovery.scan({
      obsUrl: $('obs-url').value.trim(),
      obsPassword: $('obs-password').value,
      companionUrl: $('companion-url').value.trim(),
      x32Hosts: x32Host ? [x32Host] : [],
    });

    results.classList.remove('hidden');

    status($('host-status'), report.host.status === 'ok', report.host.hostname || 'Host');
    $('host-detail').textContent = lines([
      report.host.model,
      report.host.cpu,
      `${report.host.arch || ''} · macOS ${report.host.release || ''}`,
    ]);

    status($('obs-status'), report.obs.status === 'ok', report.obs.status === 'ok' ? 'Connected' : 'Not available');
    $('obs-detail').textContent = report.obs.status === 'ok'
      ? lines([
          `OBS ${report.obs.obsVersion || ''}`,
          `${report.obs.scenes.length} scenes · ${report.obs.inputs.length} inputs`,
          `${report.obs.sceneDetails?.reduce((sum, scene) => sum + scene.items.length, 0) || 0} scene items mapped`,
          `Program: ${report.obs.currentProgramScene || 'unknown'}`,
          `Streaming: ${report.obs.streaming ? 'yes' : 'no'}`,
        ])
      : lines([report.obs.error, ...(report.obs.warnings || [])]);

    status($('companion-status'), report.companion.status === 'ok', report.companion.status === 'ok' ? 'Connected' : 'Not available');
    $('companion-detail').textContent = report.companion.status === 'ok'
      ? lines([
          report.companion.diagnostics?.companionBuild ? `Companion ${report.companion.diagnostics.companionBuild}` : '',
          `${report.companion.connections.length} configured connections`,
          `${report.companion.buttons?.length || 0} button mappings`,
          ...report.companion.connections.slice(0, 8).map((c) => {
            const endpoint = c.host ? ` · ${c.host}${c.port ? `:${c.port}` : ''}` : '';
            return `• ${c.label || c.id}${c.moduleId ? ` (${c.moduleId})` : ''}${endpoint}`;
          }),
        ])
      : lines([report.companion.error, ...(report.companion.warnings || [])]);

    status($('onvif-status'), report.onvif.devices.length > 0, `${report.onvif.devices.length} device(s)`, report.onvif.status === 'ok');
    $('onvif-detail').textContent = report.onvif.devices.length
      ? report.onvif.devices.map((d) => `• ${d.remoteAddress}`).join('\n')
      : lines([report.onvif.error, ...(report.onvif.warnings || []), 'No ONVIF devices responded to WS-Discovery.']);

    status($('x32-status'), report.x32.devices.length > 0, `${report.x32.devices.length} mixer(s)`, report.x32.status === 'ok');
    $('x32-detail').textContent = report.x32.devices.length
      ? report.x32.devices.map((d) => `• ${d.address}${d.model ? ` · ${d.model}` : ''}${d.firmware ? ` · ${d.firmware}` : ''}`).join('\n')
      : lines(report.x32.warnings || []);

    $('raw').textContent = JSON.stringify(report, null, 2);
    activity.textContent = `Scan completed ${new Date(report.generatedAt).toLocaleTimeString()}`;
    saveButton.disabled = false;
  } catch (error) {
    activity.textContent = `Scan failed: ${error?.message || error}`;
  } finally {
    scanButton.disabled = false;
  }
});

saveButton.addEventListener('click', async () => {
  const result = await window.broadcastDiscovery.save();
  activity.textContent = result.saved ? `Saved to ${result.path}` : (result.reason || 'Export cancelled.');
});
