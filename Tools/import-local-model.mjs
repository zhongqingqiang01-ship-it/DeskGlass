import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
if (!input) throw new Error('Usage: node Tools/import-local-model.mjs /path/to/your-compatible-model.glb');
const bytes = await readFile(input);
if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2
    || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) {
  throw new Error('Expected a complete glTF 2.0 binary (GLB).');
}
const jsonLength = bytes.readUInt32LE(12);
if (20 + jsonLength > bytes.length) throw new Error('Invalid GLB JSON chunk length.');
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
for (const value of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
  if (value.uri && !value.uri.startsWith('data:')) throw new Error('Embed all assets in the GLB; external URLs and sidecar files are not allowed.');
}
if (gltf.extensionsRequired?.includes('KHR_draco_mesh_compression')) {
  throw new Error('Decode Draco geometry first; the offline viewer does not load remote decoders.');
}
const models = path.join(root, 'Resources/Stage/models');
await mkdir(models, {recursive:true});
await writeFile(path.join(models, 'gundam.js'),
  `window.DeskGlassModelData("gundam",${JSON.stringify(bytes.toString('base64'))});\n`);
await writeFile(path.join(root, 'Resources/Stage/assets.js'), 'window.DeskGlassStageAssets = ["ferrari", "gundam", "pet"];\n');
console.log('Local model imported. Rebuild with ./build.sh. Do not publish this private asset.');
