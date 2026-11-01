/* CI harness only; not packaged. The hosted Intel VM has no usable GPU. */
const {app}=require('electron');const path=require('node:path');
const allowed=new Set(['smoke.cjs','smoke-obs.cjs','smoke-offline.cjs','smoke-audio.cjs','smoke-service-audio.cjs','smoke-readiness.cjs','smoke-live.cjs','smoke-operator.cjs','smoke-design.cjs']);
const name=path.basename(process.argv[2]||'');if(!allowed.has(name))throw new Error('Choose an allowlisted CI smoke test.');
app.disableHardwareAcceleration();require(path.join(__dirname,name));
