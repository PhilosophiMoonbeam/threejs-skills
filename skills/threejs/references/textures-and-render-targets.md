# Textures and Render Targets — Three.js 0.185.1

## Scope

Use this reference for texture loading and annotation, UV selection, sampling, environment maps, render/depth targets,
texture ownership, and GPU-memory decisions in 0.185.1. Materials own map semantics; post-processing owns multi-pass composition; shaders own custom sampling.

## Decisions and invariants

- Classify every texture as **color**, **non-color data**, or **linear HDR** before use.
- Color inputs such as base-color and emissive images use `THREE.SRGBColorSpace`.
- Normal, roughness, metalness, AO, displacement, depth, alpha, and packed physical data maps
  retain `THREE.NoColorSpace`.
- `HDRLoader` and `EXRLoader` default to `THREE.LinearSRGBColorSpace` for scene-referred HDR.
  If an HDR/EXR file is deliberately a data map, set `THREE.NoColorSpace` before its first upload.
- Configure dimensions, format, wrapping, filtering, mipmaps, and anisotropy before first upload.
- Materials do not own textures. The application must define shared-resource ownership.
- A render target owns more than its exposed texture; dispose the target, not only `.texture`.
- Keep addons and core on 0.185.1 and import addons only through `three/addons/...`.

Color-role rules: [Color management](https://threejs.org/manual/en/color-management.html#input-color-space),
[`Texture.colorSpace`](https://threejs.org/docs/pages/Texture.html#colorSpace), [revision 185
HDRLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/HDRLoader.js), and
[revision 185 EXRLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/EXRLoader.js).

## Minimal loading pattern

```js
import * as THREE from 'three';

const manager = new THREE.LoadingManager();
manager.onProgress = (url, loaded, total) => console.log(`${loaded}/${total}`, url);

const loader = new THREE.TextureLoader(manager);
const [baseColor, normal] = await Promise.all([
  loader.loadAsync('/assets/base-color.webp'),
  loader.loadAsync('/assets/normal.webp'),
]);
baseColor.colorSpace = THREE.SRGBColorSpace;

const material = new THREE.MeshStandardMaterial({ map: baseColor, normalMap: normal });
```

`TextureLoader.loadAsync()` is the canonical Promise API. Its `load()` method starts asynchronous work but immediately returns a placeholder `Texture`, useful when a material must receive a non-null map before compilation.
`TextureLoader` does not support byte-level `onProgress`; pass `undefined` in that callback position and use `LoadingManager.onProgress` for item progress.
See [`TextureLoader`](https://threejs.org/docs/pages/TextureLoader.html).

Await a texture before constructing its material when practical. Adding or removing a map on an already-rendered material changes shader features, so set `material.needsUpdate = true`.
Replacing one non-null map with another normally does not require recompilation.

## Map roles and channels

| Material input | Interpretation | Sampled source channel |
|---|---|---|
| `map`, `emissiveMap`, `sheenColorMap`, `specularColorMap`, and `specularMap` | sRGB color | RGB |
| `normalMap` | non-color tangent/object-space vectors | RGB |
| `aoMap` | non-color occlusion | R |
| `roughnessMap` | non-color roughness | G |
| `metalnessMap` | non-color metalness | B |
| `alphaMap` | non-color opacity | G for RGB/RGBA textures |
| `bumpMap`, `displacementMap` | non-color height | documented scalar channel |
| `lightMap` | linear lighting data (`LinearSRGBColorSpace`) | RGB |

Grayscale roughness or metalness files work because their RGB channels are equal, not because Three.js samples a generic grayscale value.
`transparent = true` enables alpha blending; prefer `alphaTest` for hard cutouts. See [`MeshStandardMaterial`](https://threejs.org/docs/pages/MeshStandardMaterial.html).

## UV sets and texture transforms

Geometry attribute names are `uv`, `uv1`, `uv2`, and `uv3`. `Texture.channel` selects them as `0`, `1`, `2`, and `3` respectively; AO has no hard-wired `uv2` path.
The rename and per-texture selection landed before revision 185: [Migration r151→r152](https://github.com/mrdoob/three.js/wiki/Migration-Guide#151--152),
[Migration r150→r151](https://github.com/mrdoob/three.js/wiki/Migration-Guide#150--151).

```js
geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
aoTexture.channel = 1;

const uv = geometry.getAttribute('uv');
uv.setXY(vertexIndex, u, v);
uv.needsUpdate = true;
```

Changing `texture.channel` after a material has rendered changes the shader's required UV
attribute; set `material.needsUpdate = true` after such a change. r185 WebGL shader parameters
enable only the UV attributes selected by material texture channels.
[revision 185 Texture.channel](https://github.com/mrdoob/three.js/blob/r185/src/textures/Texture.js#L115-L122) ·
[revision 185 WebGLPrograms UV selection](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLPrograms.js#L46-L52)

`texture.offset`, `repeat`, `rotation`, and `center` update its UV transform; offsets are not restricted to `[0, 1]`. Keep `matrixAutoUpdate` enabled unless manually maintaining `texture.matrix`.

## Wrapping, filtering, mipmaps, and anisotropy

- `ClampToEdgeWrapping` is the default; use `RepeatWrapping` or `MirroredRepeatWrapping` for tiling.
- `magFilter` is `LinearFilter` or `NearestFilter`.
- Minification can use nearest/linear filtering with or without mipmaps; trilinear filtering is `LinearMipmapLinearFilter`.
- Ordinary textures generate mipmaps when `generateMipmaps` is true, independent of minification filter since r170.
  [`Migration r169→r170`](https://github.com/mrdoob/three.js/wiki/Migration-Guide#169--170)
- `DataTexture` defaults to nearest filtering and `generateMipmaps = false`; opt into other behavior.
- `CompressedTexture` cannot generate mipmaps; the container must supply the mip chain.
- The 0.185.1 `WebGLRenderer` requires WebGL 2, so NPOT textures may use repeat wrapping and mipmaps; do not disable either merely because dimensions are NPOT.
  [`WebGLRenderer`](https://threejs.org/docs/pages/WebGLRenderer.html), [`Migration r162→r163`](https://github.com/mrdoob/three.js/wiki/Migration-Guide#r162--r163)

```js
texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
texture.repeat.set(4, 4);
texture.minFilter = THREE.LinearMipmapLinearFilter;
texture.magFilter = THREE.LinearFilter;
texture.generateMipmaps = true;
```

Changing upload/sampler properties after upload requires `texture.needsUpdate = true`; UV transform changes do not.
For `WebGLRenderer`, query `renderer.capabilities.getMaxAnisotropy()`; for `WebGPURenderer`, first `await renderer.init()`, then query `renderer.getMaxAnisotropy()`.
Apply anisotropy selectively to oblique surfaces because it increases sampling cost. See [`Renderer.getMaxAnisotropy`](https://threejs.org/docs/pages/Renderer.html#getMaxAnisotropy).

## Dynamic, raw, and compressed textures

- `CanvasTexture(canvas)` uploads canvas pixels; mark `needsUpdate` after later drawing. Set sRGB for canvas-authored colors.
- `VideoTexture(video)` updates from video frames automatically; do not toggle `needsUpdate` each frame. Set sRGB for ordinary color video.
- `DataTexture(data, width, height, ...)` owns caller-provided typed data; set `needsUpdate = true` after construction or mutation. Keep non-color arrays at `NoColorSpace`.
- `CubeTexture` stores six faces. `DataArrayTexture`, `Data3DTexture`, and compressed variants serve array, volume, and GPU-compressed data.
- `DepthTexture` stores depth for sampling.

```js
const values = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
const dataTexture = new THREE.DataTexture(values, 2, 1, THREE.RGBAFormat);
dataTexture.needsUpdate = true;
```

Use KTX2 for GPU-compressed delivery; the container owns its compressed mip levels. In r185,
`KTX2Loader` derives the texture color space from the KTX2 data-format descriptor: valid sRGB,
linear, and Display-P3 metadata is preserved, while unspecified/unsupported metadata becomes
`NoColorSpace`. Keep that result unless the asset metadata is known to be wrong. Reuse one
configured loader and release its workers afterward.

```js
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

if (renderer.isWebGPURenderer) await renderer.init();
// r185 resolves Basis JS/WASM relative to the addon; normally no transcoder path is needed.
const ktx2 = new KTX2Loader().detectSupport(renderer);
const texture = await ktx2.loadAsync('/assets/material.ktx2');
ktx2.dispose();
```

If a bundler or static host does not emit `examples/jsm/libs/basis`, copy
`basis_transcoder.js` and `basis_transcoder.wasm` from the exact `three@0.185.1` package and
call `.setTranscoderPath()` with that directory. Do not point at decoder files from another
Three.js release. See [`KTX2Loader`](https://threejs.org/docs/pages/KTX2Loader.html),
[revision 185 KTX2Loader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/KTX2Loader.js),
and [revision 185 package exports](https://github.com/mrdoob/three.js/blob/r185/package.json).
`detectSupportAsync()` is deprecated in 0.185.1: [Migration r180→r181](https://github.com/mrdoob/three.js/wiki/Migration-Guide#180--181).

## HDR, EXR, environments, and PMREM

Use the 0.185.1 `HDRLoader` name; `RGBELoader` is only a deprecated compatibility subclass. [Migration r179→r180](https://github.com/mrdoob/three.js/wiki/Migration-Guide#179--180)

```js
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

const environment = await new HDRLoader().loadAsync('/assets/studio.hdr');
// The same setup applies to: await new EXRLoader().loadAsync('/assets/studio.exr')
environment.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = environment;
scene.background = environment;
```

`WebGLRenderer` internally PMREM-filters supported equirectangular/cube environments for physically based materials; keeping the source texture as `scene.background` preserves resolution.
[Migration r129→r130](https://github.com/mrdoob/three.js/wiki/Migration-Guide#129--130)

For manual WebGL PMREM, `pmrem.fromEquirectangular(source)` returns a render target. Retain it as owner, use `.texture`, then dispose target and generator.
Do not lose the target handle. See [`PMREMGenerator`](https://threejs.org/docs/pages/PMREMGenerator.html).

Background uses `scene.backgroundIntensity`/`backgroundRotation`; inherited environments use `scene.environmentIntensity`/`environmentRotation`.
An explicit `material.envMap` overrides the scene environment and uses `envMapIntensity`/`envMapRotation`. r184 aligned environment rotation signs with object rotations.
Remove older sign compensation. [Migration r183→r184](https://github.com/mrdoob/three.js/wiki/Migration-Guide#183--184)

## Render and depth targets

Use `THREE.RenderTarget` for renderer-portable code. `THREE.WebGLRenderTarget` and `THREE.WebGLCubeRenderTarget` are WebGL-specific; use `CubeRenderTarget` with WebGPU.
WebGPU stopped supporting `WebGLCubeRenderTarget` in r183:
[Migration r182→r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183).

```js
const target = new THREE.RenderTarget(1024, 1024, { depthBuffer: true, samples: 4 });
target.depthTexture = new THREE.DepthTexture(1024, 1024, THREE.UnsignedIntType);

const previousTarget = renderer.getRenderTarget();
renderer.setRenderTarget(target);
renderer.render(offscreenScene, offscreenCamera);
renderer.setRenderTarget(previousTarget);
consumerMaterial.map = target.texture;
consumerMaterial.needsUpdate = true; // Needed when the material has already rendered.
```

Restore the previous target rather than assuming `null`; reusable rendering can be nested.
Ordinary render-target textures are `NoColorSpace` linear intermediates and do not generate
mipmaps by default. Before disposal, clear every scene, material, and uniform reference to the
target's attachments. `target.dispose()` releases its color and depth attachments; do not dispose
target-owned textures separately.
Screen output applies `renderer.outputColorSpace`; intermediate targets do not automatically receive
screen conversion. A final custom `ShaderMaterial` screen pass normally ends:

```glsl
gl_FragColor = result;
#include <tonemapping_fragment>
#include <colorspace_fragment>
```

Include tone mapping only when that final pass should apply renderer tone mapping. Do not apply final output conversion blindly to intermediate targets.
See [output color space](https://threejs.org/manual/en/color-management.html#output-color-space),
[`RenderTarget`](https://threejs.org/docs/pages/RenderTarget.html), and [revision 185
RenderTarget source](https://github.com/mrdoob/three.js/blob/r185/src/core/RenderTarget.js).

Dynamic `CubeCamera` capture is expensive: hide the reflective object as needed, update only at the required cadence, and dispose its cube render target.

## Ownership, disposal, and memory

- Track owned textures separately from material references; use ref-counting or asset-scope teardown.
- Deduplicate aliases before disposal. Dispose an owned texture only after its last consumer is gone.
- Clear live scene, material, and uniform references; then dispose materials and owned textures.
- Dispose render/depth/cube targets through `target.dispose()`; do not separately dispose target-owned textures.
- `ImageBitmap` memory is application-owned: after all aliases are gone, call `bitmap.close()` and `texture.dispose()`.
- Reuse loader instances where useful; `KTX2Loader.dispose()` releases its worker pool.

```js
const ownedTextures = new Set([baseColor, normal, environment]);
const ownedBitmaps = new Set();
for (const texture of ownedTextures) {
  if (texture.image instanceof ImageBitmap) ownedBitmaps.add(texture.image);
  texture.dispose();
}
for (const bitmap of ownedBitmaps) bitmap.close();
target.dispose();
material.dispose();
```

Estimate uncompressed memory as width × height × bytes/texel × faces/layers; a complete mip chain adds about one third. Compressed formats have block-specific costs.
Choose resolution from content, quality tier, bandwidth, and measured GPU budget—not user-agent strings. Mipmaps improve minification but cost memory and update work.
Atlases reduce state changes but require padding and careful mips/repeat. Sharing avoids duplicate uploads but does not merge draw calls.
`renderer.info.memory.textures` is a resource count, not a byte measurement.

Official lifecycle guidance: [disposing objects](https://threejs.org/manual/en/how-to-dispose-of-objects.html#textures),
[`RenderTarget.dispose`](https://threejs.org/docs/pages/RenderTarget.html#dispose), and [revision 185
render-target texture management](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/Textures.js).
