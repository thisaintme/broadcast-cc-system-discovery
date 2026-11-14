import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const universalRequire=createRequire(require.resolve('@electron/universal'));
const {minimatch}=universalRequire('minimatch');
const {build}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const matches=path=>minimatch(path,build.mac.x64ArchFiles,{matchBase:true});
const root='Contents/Resources/app.asar.unpacked/node_modules/';

test('V107 universal package preserves both architecture-labelled FreeType prebuilds',()=>{
  for(const arch of ['arm64','x64'])assert.equal(matches(root+`@julusian/freetype2/prebuilds/freetype2-darwin-${arch}/node-napi-v7.node`),true);
  assert.equal(build.asar,true);
  assert.notEqual(build.mac.mergeASARs,false);
  assert.ok(build.mac.target.some(t=>t.target==='dmg'&&t.arch.includes('universal')));
});

test('V107 native packaging exception cannot hide unrelated or misplaced binaries',()=>{
  for(const relative of [
    '@julusian/freetype2/build/Release/freetype2.node',
    '@julusian/freetype2/prebuilds/freetype2-linux-x64/node-napi-v7.node',
    '@julusian/freetype2/prebuilds/freetype2-darwin-arm64/unexpected.node',
    'other-native/prebuilds/freetype2-darwin-x64/node-napi-v7.node',
  ])assert.equal(matches(root+relative),false,relative);
  assert.equal(matches('Contents/MacOS/Broadcast Control Center Preview'),false);
});
