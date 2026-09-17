import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer', { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  external: ['electron'],
};

await build({
  ...shared,
  entryPoints: ['src/main.ts'],
  format: 'cjs',
  outfile: 'dist/main.cjs',
});

await build({
  ...shared,
  entryPoints: ['src/preload.ts'],
  format: 'cjs',
  outfile: 'dist/preload.cjs',
});

await cp('src/renderer', 'dist/renderer', { recursive: true });
console.log('Built Electron app into dist/.');
