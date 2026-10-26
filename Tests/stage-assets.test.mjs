import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('public distribution includes exactly the redistributable car payload', async () => {
  assert.deepEqual((await readdir(path.join(root,'Resources/Stage/models'))).sort(), ['ferrari.js']);
  assert.equal((await readFile(path.join(root,'Resources/Stage/assets.js'),'utf8')).trim(),
    'window.DeskGlassStageAssets = ["ferrari", "pet"];');
});

test('offline WebKit page prohibits remote connections and loads metadata before the renderer', async () => {
  const page = await readFile(path.join(root,'Resources/Stage/index.html'),'utf8');
  assert.ok(page.includes("default-src 'none'") && page.includes('connect-src blob:;'));
  assert.ok(!/<script[^>]+src=["']https?:/i.test(page));
  assert.ok(page.indexOf('src="assets.js"') < page.indexOf('src="scene.bundle.js"'));
});

test('invalid or externally referenced local GLBs are rejected before any write', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(),'DeskGlass-import-'));
  const tool = path.join(root,'Tools/import-local-model.mjs');
  try {
    const broken=path.join(temporary,'broken.glb');await writeFile(broken,'not a model');
    const invalid=spawnSync(process.execPath,[tool,broken],{encoding:'utf8'});
    assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/complete glTF/);
    const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},images:[{uri:'https://example.invalid/private.jpg'}]}));
    const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);
    header.writeUInt32LE(20+json.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
    const external=path.join(temporary,'external.glb');await writeFile(external,Buffer.concat([header,json]));
    const blocked=spawnSync(process.execPath,[tool,external],{encoding:'utf8'});
    assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/external URLs/);
  } finally { await rm(temporary,{recursive:true,force:true}); }
});
