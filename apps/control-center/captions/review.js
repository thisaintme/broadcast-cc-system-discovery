const $ = id => document.getElementById(id);
const api = window.captions;
let armed = false, busy = false, options = '';
const message = text => { $('msg').textContent = text; };
async function status() {
  try {
    const s = await api.status();
    armed = s.armed;
    $('state').textContent = (s.active ? 'Erkennung aktiv · ' : '') + s.message;
    $('route').textContent = `${s.device} → ${s.origin} · ${s.relay}`;
    $('arm').textContent = armed ? 'Mitschrift abschalten' : 'Mitschrift freigeben';
    if (busy) return;
    const key = JSON.stringify(s.archives);
    if (key !== options) {
      options = key;
      const old = $('files').value;
      $('files').replaceChildren(...s.archives.map(f => new Option(f.replace('.jsonl',''), f)));
      if (s.archives.includes(old)) $('files').value = old;
    }
    $('arm').disabled = false;
    $('preview').disabled = !$('files').value;
  } catch (e) { $('arm').disabled = true; message(e.message); }
}
async function action(fn) {
  if (busy) return;
  busy = true;
  for (const id of ['arm','files','preview','apply']) $(id).disabled = true;
  try { await fn(); } catch(e) { message(e.message); }
  finally {
    busy = false;
    for (const id of ['files','apply']) $(id).disabled = false;
    await status();
  }
}
$('arm').onclick = () => action(() => api.arm(!armed));
$('files').onchange = () => { $('editor').hidden = true; message(''); };
$('preview').onclick = () => action(async () => {
  $('editor').hidden = true;
  const v = await api.review($('files').value);
  $('target').textContent = 'Deutsches Video: ' + v.video;
  $('beforeTitle').textContent = v.current.title;
  $('beforeDesc').textContent = v.current.description;
  $('title').value = v.proposed.title;
  $('desc').value = v.proposed.description;
  $('editor').hidden = false;
  message('Vorschlag prüfen. Auf YouTube wurde noch nichts geändert.');
});
$('apply').onclick = () => action(async () => {
  try { message(await api.apply($('title').value, $('desc').value)); }
  finally { $('editor').hidden = true; }
});
void status();
setInterval(() => void status(), 2000);
