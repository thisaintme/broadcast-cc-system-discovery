import {build} from 'esbuild';
import {mkdir,copyFile,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/renderer',{recursive:true});
await build({entryPoints:['src/main.ts'],outfile:'dist/main.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',external:['electron'],sourcemap:false});
await build({entryPoints:['src/preload.ts'],outfile:'dist/preload.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',external:['electron']});
await build({entryPoints:['src/renderer.tsx'],outfile:'dist/renderer/renderer.js',bundle:true,platform:'browser',target:'chrome130',format:'iife',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
await copyFile('src/index.html','dist/renderer/index.html');
await copyFile('src/styles.css','dist/renderer/styles.css');
