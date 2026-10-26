# Third-party notices

The root MIT license applies to the original DeskGlass code, not to every asset in this repository.

## three.js

- Version: 0.170.0 (r170)
- Authors: three.js authors
- License: MIT; full text: [`Resources/Stage/licenses/three-MIT.txt`](Resources/Stage/licenses/three-MIT.txt)
- Source: <https://github.com/mrdoob/three.js/tree/r170>
- Used in the locally bundled WebKit renderer, including OrbitControls, GLTFLoader and blur shaders.

## Ferrari 458 Italia

- Creator: **vicent091036**
- Original: <https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6>
- License: **Creative Commons Attribution 4.0 International (CC BY 4.0)**: <https://creativecommons.org/licenses/by/4.0/>
- Distributed source: <https://github.com/mrdoob/three.js/blob/r170/examples/models/gltf/ferrari.glb>
- Upstream media-license inventory: <https://github.com/mrdoob/three.js/issues/23089>
- Repository files: `Assets/ferrari.glb` and generated `Resources/Stage/models/ferrari.js`.
- Changes: decoded Draco geometry for offline use; replaced paint, glass and rim materials at runtime; normalized scale and added display interactions.

Preserve the creator credit, license link, source and modification notice when redistributing this asset or derivatives. No affiliation with, or endorsement by, the creator or vehicle manufacturer is implied. Trademark and other rights are not granted by the software's MIT license.

## Robot puppy

The electronic puppy is modelled and animated programmatically by the DeskGlass project in `Tools/stage/pet.js` and `Tools/stage/parts.js`. These original source files are covered by the repository's MIT license.

## Development dependencies

Pinned versions and integrity hashes are in `package-lock.json`:

| Package | Version | License |
| --- | --- | --- |
| three | 0.170.0 | MIT |
| esbuild | 0.25.12 | MIT |
| @gltf-transform/core | 4.2.1 | MIT |
| @gltf-transform/extensions | 4.2.1 | MIT |
| draco3dgltf | 1.5.7 | Apache-2.0 |

The glTF conversion and bundling tools are used during asset development. They are not fetched or executed by the application at runtime. Their installed packages carry their corresponding license files.

## Excluded local assets

The public repository and public release packages contain **no Gundam model, related texture, source archive or derived model-data payload**. Optional local imports remain subject to their original permissions. Repairing, converting or renaming a third-party model does not change its distribution license.
