import {build} from 'esbuild';
import {mkdir,copyFile,rm,writeFile,readFile} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist/renderer',{recursive:true});
for(const [entry,out] of [['main','main'],['preload','preload'],['live-main','live-main'],['live-preload','live-preload']]){
  await build({entryPoints:[`src/${entry}.ts`],outfile:`dist/${out}.cjs`,bundle:true,platform:'node',target:'node22',format:'cjs',external:['electron'],sourcemap:false});
}
for(const entry of ['renderer','live-renderer'])await build({entryPoints:[`src/${entry}.tsx`],outfile:`dist/renderer/${entry}.js`,bundle:true,platform:'browser',target:'chrome130',format:'iife',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
for(const name of ['index.html','live.html','styles.css','audio.css','live.css'])await copyFile(`src/${name}`,`dist/renderer/${name}`);
// The prior readiness screen adds its own stylesheet to the legacy page.
try{await copyFile('src/readiness.css','dist/renderer/readiness.css');}catch{}
await writeFile('dist/launcher.cjs',`const {app,BrowserWindow,Menu}=require('electron');
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>{const w=BrowserWindow.getAllWindows()[0];if(w){if(w.isMinimized())w.restore();w.focus();}});
  if(app.commandLine.hasSwitch('bcc-advanced')){
    require('./main.cjs');
    app.whenReady().then(()=>Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label:app.name,submenu:[{role:'about'},{role:'quit'}]},
      {label:'Edit',submenu:[{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
      {label:'View',submenu:[{label:'Return to Live Service (Observe only)',click:()=>{app.relaunch({args:process.argv.slice(1).filter(a=>a!=='--bcc-advanced')});app.quit();}}]}
    ])));
  }else{require('./live-main.cjs');}
}
`);
