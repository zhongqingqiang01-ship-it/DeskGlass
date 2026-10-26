import {writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import {build} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const models = path.join(root, 'Resources/Stage/models');
await mkdir(models, {recursive:true});
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const document = await io.read(path.join(root, 'Assets/ferrari.glb'));
for (const extension of document.getRoot().listExtensionsUsed()) {
  if (extension.extensionName === 'KHR_draco_mesh_compression') extension.dispose();
}
const bytes = await io.writeBinary(document);
await writeFile(path.join(models, 'ferrari.js'),
  `window.DeskGlassModelData("ferrari",${JSON.stringify(Buffer.from(bytes).toString('base64'))});\n`);
await build({entryPoints:[path.join(root,'Tools/StageViewer.js')],bundle:true,format:'iife',
  minify:true,target:'safari17',outfile:path.join(root,'Resources/Stage/scene.bundle.js'),legalComments:'eof'});
console.log('Offline renderer rebuilt; bundled car and source licenses retained.');
