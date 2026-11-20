import {build} from 'esbuild';
import {mkdir,copyFile,rm,writeFile,readFile,cp,access} from 'node:fs/promises';
await access('.generated/data/corpus-manifest.json').catch(()=>{throw new Error('Offline-Inhalte fehlen. Zuerst npm run assets ausführen.');});
await rm('dist',{recursive:true,force:true});await mkdir('dist/renderer',{recursive:true});
const captionEntries={'live-main':'captions/desk-main.mjs','live-preload':'captions/desk-preload.mjs','caption-review-preload':'captions/review-preload.mjs'};
for(const entry of ['main','preload','live-main','live-preload','youtube-preload','stream-management-preload','caption-review-preload']){
  await build({entryPoints:[captionEntries[entry]??`src/${entry}.ts`],outfile:`dist/${entry}.cjs`,bundle:true,platform:'node',target:'node22',format:'cjs',external:['electron','atem-connection'],sourcemap:false});
}
await mkdir('dist/captions',{recursive:true});for(const file of ['recognize.py','review.html','review.js'])await copyFile(`captions/${file}`,`dist/captions/${file}`);
for(const entry of ['renderer','live-renderer','youtube-renderer','stream-management-renderer','overlay-renderer'])await build({entryPoints:[`src/${entry}.tsx`],outfile:`dist/renderer/${entry}.js`,bundle:true,platform:'browser',target:'chrome130',format:'iife',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
for(const name of ['index.html','live.html','youtube.html','stream-management.html','stream-management.css','desk-tokens.css','konzept-b.css','audio.css','live.css','v107.css','v107-content.css','overlay.html','overlay.css'])await copyFile(`src/${name}`,`dist/renderer/${name}`);
// The legacy index links styles.css only; retain its audio/readiness styles.
await writeFile('dist/renderer/styles.css',(await readFile('src/styles.css','utf8'))+'\n'+(await readFile('src/audio.css','utf8')));
await writeFile('dist/launcher.cjs',`const {app,BrowserWindow,Menu}=require('electron');
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>{const w=BrowserWindow.getAllWindows()[0];if(w){if(w.isMinimized())w.restore();w.focus();}});
  if(app.commandLine.hasSwitch('bcc-advanced')){
    require('./main.cjs');
    app.whenReady().then(()=>Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label:app.name,submenu:[{role:'about'},{role:'quit'}]},
      {label:'Bearbeiten',submenu:[{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
      {label:'Ansicht',submenu:[{label:'Zur Senderegie (nur beobachten)',click:()=>{app.relaunch({args:process.argv.slice(1).filter(a=>a!=='--bcc-advanced')});app.quit();}}]}
    ])));
  }else{require('./live-main.cjs');}
}
`);
await cp('.generated/data','dist/data',{recursive:true});
await cp('.generated/fonts','dist/renderer/fonts',{recursive:true});
await cp('.generated/licenses','dist/licenses',{recursive:true});
