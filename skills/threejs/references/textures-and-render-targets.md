# Textures and Render Targets — Three.js 0.186.1

## Scope

Use this reference for texture loading and annotation, UV selection, sampling, environment maps, render/depth targets,
texture ownership, and GPU-memory decisions in 0.186.1. Materials own slot-to-channel and color-role tables; post-processing owns multi-pass composition; shaders own custom sampling.

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
- Keep addons and core on 0.186.1 and import addons only through `three/addons/...`.

Color-role rules: [Color management](https://threejs.org/manual/en/color-management.html#input-color-space),
[`Texture.colorSpace`](https://threejs.org/docs/pages/Texture.html#colorSpace), [r186
HDRLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/HDRLoader.js), and
[r186 EXRLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/EXRLoader.js).

## Minimal loading pattern

Keep the asset owner alive until setup settles. This helper owns both textures and its material;
the caller removes all consumers before calling `dispose()`. For cancellation, shared caches, or
loading-manager policy, use asset loading in the skill index.

<!-- check: loaded-texture-pair -->
```js
import * as THREE from 'three';

async function loadTexturedMaterial(baseURL, normalURL) {
  const loader = new THREE.TextureLoader();
  const results = await Promise.allSettled([loader.loadAsync(baseURL), loader.loadAsync(normalURL)]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
    throw failure.reason;
  }
  const [baseColor, normal] = results.map(result => result.value);
  baseColor.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: baseColor, normalMap: normal });
  return {
    material,
    dispose() { material.dispose(); baseColor.dispose(); normal.dispose(); },
  };
}
```

`TextureLoader.loadAsync()` is the canonical Promise API. `load()` starts asynchronous work but
immediately returns a placeholder `Texture`, useful for a non-null map before compilation.
`TextureLoader` does not support byte-level `onProgress`; use `LoadingManager.onProgress` for item
progress. For a directly constructed `Texture(image)`, await `image.decode()` (with CORS configured
before `src` for cross-origin images), then set `texture.needsUpdate = true`; construction alone
does not signal that image pixels are ready. See [`TextureLoader`](https://threejs.org/docs/pages/TextureLoader.html)
and [r186 Texture](https://github.com/mrdoob/three.js/blob/r186/src/textures/Texture.js).

Await a texture before constructing its material when practical. Adding or removing a map on an already-rendered material changes shader features, so set `material.needsUpdate = true`.
Replacing one non-null map avoids recompilation only if its shader-keyed characteristics remain unchanged; the materials topic owns those rules.

## UV sets and texture transforms

Geometry attribute names are `uv`, `uv1`, `uv2`, and `uv3`. `Texture.channel` selects them as `0`, `1`, `2`, and `3` respectively; AO has no hard-wired `uv2` path.
The rename and per-texture selection predate r186: [Migration r151→r152](https://github.com/mrdoob/three.js/wiki/Migration-Guide#151--152),
[Migration r150→r151](https://github.com/mrdoob/three.js/wiki/Migration-Guide#150--151).

```js
geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
aoTexture.channel = 1;

const uv = geometry.getAttribute('uv');
uv.setXY(vertexIndex, u, v);
uv.needsUpdate = true;
```

A texture has one UV selector and transform. If material slots need different UV sets or transforms, clone the texture and configure each clone; clones share image data through `texture.source`. Keep every clone and the shared image under explicit lifetime ownership. [r186 Texture.copy](https://github.com/mrdoob/three.js/blob/r186/src/textures/Texture.js)

In r186, the canonical source class is `THREE.TextureSource` and its type flag is `isTextureSource`. Replace old `Source`/`isSource` uses; `Source` remains a deprecated compatibility export in this exact release, not a removed API. Ordinary texture loading creates its source automatically; construct `new THREE.TextureSource(image)` only when directly managing source data. [r186 TextureSource and historical alias](https://github.com/mrdoob/three.js/blob/r186/src/textures/TextureSource.js#L230-L261), [r186 public exports](https://github.com/mrdoob/three.js/blob/r186/src/Three.Core.js#L39-L40)

Changing `texture.channel` after a material has rendered changes the shader's required UV
attribute; set `material.needsUpdate = true` after such a change. r186 WebGL shader parameters
enable only the UV attributes selected by material texture channels.
[r186 Texture.channel](https://github.com/mrdoob/three.js/blob/r186/src/textures/Texture.js) ·
[r186 WebGLPrograms UV selection](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLPrograms.js)

`texture.offset`, `repeat`, `rotation`, and `center` update its UV transform; offsets are not restricted to `[0, 1]`. Keep `matrixAutoUpdate` enabled unless manually maintaining `texture.matrix`.

### Atlas regions

For a top-origin atlas grid, select a cell with `repeat = (1/columns, 1/rows)` and
`offset = (column/columns, 1-(row+1)/rows)`. Use one texture clone per independently transformed
consumer, not one mutable transform shared by every sprite. Clones share the image source;
GPU-allocation sharing is backend/sampler dependent, not a portable guarantee of one upload.
Pad/extrude cells for filtering at every mip level; clamping only protects the outer image edge.
Do not use repeat wrapping to tile one atlas cell: it repeats the whole atlas.
[r186 Texture.copy](https://github.com/mrdoob/three.js/blob/r186/src/textures/Texture.js) · [r186 WebGL source/cache keys](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLTextures.js)

## Wrapping, filtering, mipmaps, and anisotropy

- `ClampToEdgeWrapping` is the default; use `RepeatWrapping` or `MirroredRepeatWrapping` for tiling.
- `magFilter` is `LinearFilter` or `NearestFilter`.
- Minification can use nearest/linear filtering with or without mipmaps; trilinear filtering is `LinearMipmapLinearFilter`.
- Ordinary textures generate mipmaps when `generateMipmaps` is true, independent of minification filter since r170.
  [`Migration r169→r170`](https://github.com/mrdoob/three.js/wiki/Migration-Guide#169--170)
- `DataTexture` defaults to nearest filtering and `generateMipmaps = false`; opt into other behavior.
- `CompressedTexture` cannot generate mipmaps; the container must supply the mip chain.
- The 0.186.1 `WebGLRenderer` requires WebGL 2, so NPOT textures may use repeat wrapping and mipmaps; do not disable either merely because dimensions are NPOT.
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

- `CanvasTexture(canvas)` signals the first upload; mark `needsUpdate` after later drawing. Set sRGB
  for canvas-authored colors. Raw arrays instead need an explicit first update.
- `VideoTexture(video)` follows available video frames automatically and disables mipmaps; do not
  toggle `needsUpdate` every animation frame. Ordinary color video needs sRGB. Configure CORS
  before `src`, handle `await video.play()` rejection, and respect autoplay/user-gesture rules.
  Disposing the texture does not pause the application-owned video or stop its media tracks.
- `DataTexture(data, width, height, ...)` references caller-provided typed data; it does not transfer
  or copy ownership. Defaults are nearest filtering, `flipY = false`, and no mipmaps.
  Set `needsUpdate = true` after construction/mutation. Keep scalar/vector data at `NoColorSpace`;
  explicitly annotate raw bytes authored as sRGB colors.
- `DataArrayTexture` stores equal-sized discrete 2D layers; `Data3DTexture` stores a volume with a
  continuous third coordinate. Neither is an ordinary 2D `map` slot. Use a matching custom sampler
  (`sampler2DArray`/`sampler3D` in WebGL GLSL3) or TSL sampling with the corresponding dimensionality.
- `CubeTexture` stores six faces; `DepthTexture` stores sampled depth.

This procedural canvas helper owns no renderer or material; the caller owns the returned texture
and calls `dispose()` after all consumers retire. Redraw the canvas, then mark `needsUpdate`.

<!-- check: procedural-canvas-texture -->
```js
import * as THREE from 'three';

function createLabelTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('A 2D canvas context is required.');
  ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff'; ctx.font = '32px sans-serif';
  ctx.fillText(text, 8, 44);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
```

The following WebGPU factory samples layer `1` of a two-layer raw color array. Each layer is
2 × 1 RGBA8 pixels, packed consecutively. The caller owns both resources and their consumers.

<!-- check: raw-array-texture -->
```js
import { DataArrayTexture, MeshBasicNodeMaterial, SRGBColorSpace } from 'three/webgpu';
import { texture, uv, int } from 'three/tsl';

function createArrayMaterial() {
  const bytes = new Uint8Array([
    255, 0, 0, 255, 255, 255, 0, 255,
    0, 128, 255, 255, 0, 255, 128, 255,
  ]);
  const layers = new DataArrayTexture(bytes, 2, 1, 2);
  layers.colorSpace = SRGBColorSpace;
  layers.needsUpdate = true;
  const material = new MeshBasicNodeMaterial();
  material.colorNode = texture(layers, uv()).depth(int(1));
  return { material, layers, dispose() { material.dispose(); layers.dispose(); } };
}
```

For partial array uploads, mutate the backing layer, call `addLayerUpdate(layerIndex)`, then set
`needsUpdate = true`; first upload must initialize the complete array. Recreate the texture if
dimensions/format/type change after first use. [r186 DataArrayTexture](https://github.com/mrdoob/three.js/blob/r186/src/textures/DataArrayTexture.js) · [r186 TextureNode.depth](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/TextureNode.js)

### WebCodecs frames and experimental HTML

`VideoFrameTexture.setFrame(frame)` marks an update but does not close the frame. Transfer each
decoded frame to one owner, retain it until the renderer has consumed it, and close it on
replacement/teardown; `texture.dispose()` alone does not close it. Stop/close the decoder before
retiring its texture. Browser WebCodecs support, codec configuration, and input demuxing are
application prerequisites, not provided by Three.js.

<!-- check: video-frame-texture-owner -->
```js
import { VideoFrameTexture, SRGBColorSpace } from 'three';

function createFrameTextureOwner() {
  const texture = new VideoFrameTexture();
  texture.colorSpace = SRGBColorSpace;
  let current;
  return {
    texture,
    // Takes ownership of a distinct frame; do not replace during an in-flight upload.
    setFrame(frame) {
      const previous = current;
      texture.setFrame(frame);
      current = frame;
      previous?.close();
    },
    dispose() { texture.dispose(); current?.close(); current = undefined; },
  };
}
```

`HTMLTexture(element)` depends on experimental HTML-in-Canvas plus the backend's element-copy
API (`texElementImage2D` for WebGL, `queue.copyElementImageToTexture` for WebGPU). It is not a
portable DOM screenshot utility. The renderer reparents the element into its canvas and listens
for paint events; first pixels need a paint before upload. Check support before choosing this
path, annotate color content, dispose the texture, and restore/remove the owned element during
teardown. Prefer CanvasTexture for portable generated labels.
[r186 VideoTexture](https://github.com/mrdoob/three.js/blob/r186/src/textures/VideoTexture.js) · [r186 VideoFrameTexture](https://github.com/mrdoob/three.js/blob/r186/src/textures/VideoFrameTexture.js) · [r186 HTMLTexture](https://github.com/mrdoob/three.js/blob/r186/src/textures/HTMLTexture.js) · [r186 HTML WebGL upload](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLTextures.js) · [r186 HTML WebGPU upload](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/utils/WebGPUTextureUtils.js)

Use KTX2 for GPU-compressed delivery; the container owns its compressed mip levels. In r186,
`KTX2Loader` derives the texture color space from the KTX2 data-format descriptor: valid sRGB,
linear, and Display-P3 metadata is preserved, while unspecified/unsupported metadata becomes
`NoColorSpace`. Keep that result unless the asset metadata is known to be wrong. Reuse one
configured loader and release its workers afterward.

For a standalone KTX2 texture, this helper owns a one-load decoder pool; the caller owns the returned texture and calls `texture.dispose()` after its final consumer. Keep the renderer alive until the promise settles. Use a shared loader for a batch. The default packaged transcoder files must be served; custom paths and glTF compression wiring belong to asset loading in the skill index.

<!-- check: standalone-ktx2 -->
```js
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

async function loadKTX2Texture(renderer, url) {
  if (renderer.isWebGPURenderer) await renderer.init();
  const loader = new KTX2Loader();
  try {
    loader.detectSupport(renderer);
    return await loader.loadAsync(url);
  } finally {
    loader.dispose(); // Runs after load completion or failure, not immediately after starting.
  }
}
// const texture = await loadKTX2Texture(renderer, '/assets/material.ktx2');
```

Keep the returned color-space metadata. `detectSupport()` must follow WebGPU initialization; the packaged transcoder defaults are revision-specific. [r186 KTX2Loader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/KTX2Loader.js)

## HDR, EXR, environments, and PMREM

Use the 0.186.1 `HDRLoader` name; `RGBELoader` is only a deprecated compatibility subclass. [Migration r179→r180](https://github.com/mrdoob/three.js/wiki/Migration-Guide#179--180)

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

For LDR cube images, `CubeTextureLoader.loadAsync([px, nx, py, ny, pz, nz])` returns a cube with
reflection mapping and sRGB annotation already set. All faces must have compatible square
dimensions. `UltraHDRLoader` from `three/addons/loaders/UltraHDRLoader.js` is another HDR image
option for supported gain-map JPEGs; retain the loader's radiance annotation. Do not infer color
space solely from a filename extension. [r186 CubeTextureLoader](https://github.com/mrdoob/three.js/blob/r186/src/loaders/CubeTextureLoader.js) · [r186 UltraHDRLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/UltraHDRLoader.js)

For explicit WebGL PMREM ownership, use this alternative to the source-texture assignment above. Start with an existing `WebGLRenderer` and an unused `scene.environment`; keep both alive until the load settles. This source is used only for preprocessing, so it can be disposed afterward. If also used as a background, retain it until that consumer retires.

<!-- check: pmrem-environment -->
```js
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const source = await new HDRLoader().loadAsync('/assets/studio.hdr');
const pmrem = new THREE.PMREMGenerator(renderer);
let envTarget;
try {
  envTarget = pmrem.fromEquirectangular(source);
} finally {
  source.dispose();
  pmrem.dispose();
}
scene.environment = envTarget.texture;

function disposeEnvironment() {
  if (scene.environment === envTarget.texture) scene.environment = null;
  envTarget.dispose(); // The target owns the allocation, not just its exposed texture.
}
```

`fromEquirectangular()` returns a render target whose lifetime extends beyond the generator's. [r186 PMREMGenerator](https://github.com/mrdoob/three.js/blob/r186/src/extras/PMREMGenerator.js)

r186 PMREM uses a Golden-Angle spiral blur for `fromScene()` with nonzero `sigma`; recheck blurred scene environments when upgrading rather than assuming identical appearance. The output remains packed cube-UV with `CubeUVReflectionMapping` in both renderer paths. Do not replace it with a later-release mapping/layout. [r186 WebGL spiral blur](https://github.com/mrdoob/three.js/blob/r186/src/extras/PMREMGenerator.js#L564-L577), [r186 WebGL cube-UV output](https://github.com/mrdoob/three.js/blob/r186/src/extras/PMREMGenerator.js#L717-L720), [r186 common spiral blur](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/extras/PMREMGenerator.js#L668-L673), [r186 common cube-UV output](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/extras/PMREMGenerator.js#L850-L854)

With `WebGPURenderer`, assign the HDR/EXR source directly and retain it until every environment/background consumer is retired; let the renderer preprocess it. Do not pass a WebGL PMREM target into that path. [r186 WebGPU environment example](https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_loader_gltf.html)

Clear `scene.environment` and `scene.background` before disposing their final owned texture. If an explicit PMREM target is used, dispose it after its last consumer; dispose the generator after preprocessing. Materials own environment response; lighting owns scene/background intensity and orientation.

### Environments generated from a scene

`PMREMGenerator.fromScene()` also captures procedural environments. This WebGL helper owns the
temporary room/generator and returns the owning target, not a texture with its owner discarded.
Assign `target.texture` to the environment and retire it using the same consumer-clearing rules
above. Explicit preprocessing is useful for controlled readiness/ownership; it is not a quality
upgrade over the automatic equirectangular path.

<!-- check: generated-room-environment -->
```js
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

function createRoomEnvironment(renderer) {
  const room = new RoomEnvironment();
  const generator = new PMREMGenerator(renderer);
  try {
    return generator.fromScene(room, 0.04);
  } finally {
    room.dispose();
    generator.dispose();
  }
}
```

Use `PMREMGenerator` from `three/webgpu` with an initialized `WebGPURenderer` for its node path,
not the WebGL generator/target. [r186 RoomEnvironment](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/environments/RoomEnvironment.js) · [r186 common PMREMGenerator](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/extras/PMREMGenerator.js)

## Render and depth targets

Use `THREE.RenderTarget` for renderer-portable code. `THREE.WebGLRenderTarget` and `THREE.WebGLCubeRenderTarget` are WebGL-specific; use `CubeRenderTarget` with WebGPU.
WebGPU stopped supporting `WebGLCubeRenderTarget` in r183:
[Migration r182→r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183).

```js
const target = new THREE.RenderTarget(1024, 1024, { depthBuffer: true, samples: 4 });
target.depthTexture = new THREE.DepthTexture(1024, 1024, THREE.UnsignedIntType);

const previousTarget = renderer.getRenderTarget();
renderer.setRenderTarget(target);
try {
  renderer.render(offscreenScene, offscreenCamera);
} finally {
  renderer.setRenderTarget(previousTarget);
}
consumerMaterial.map = target.texture;
consumerMaterial.needsUpdate = true; // Needed when the material has already rendered.
```

Restore the previous target rather than assuming `null`; reusable rendering can be nested.
Ordinary render-target textures are `NoColorSpace` linear intermediates and do not generate
mipmaps by default. Before disposal, clear every scene, material, and uniform reference to the
target's attachments. Dispose the target to release its owned color/depth allocation; do not dispose
target-owned textures separately. Shared depth has a renderer-specific ownership contract below.
Screen output applies `renderer.outputColorSpace`; intermediate targets do not automatically receive
screen conversion. A final custom `ShaderMaterial` screen pass normally ends:

```glsl
gl_FragColor = result;
#include <tonemapping_fragment>
#include <colorspace_fragment>
```

Include tone mapping only when that final pass should apply renderer tone mapping. Do not apply final output conversion blindly to intermediate targets.
See [output color space](https://threejs.org/manual/en/color-management.html#output-color-space),
[`RenderTarget`](https://threejs.org/docs/pages/RenderTarget.html), and [r186
RenderTarget source](https://github.com/mrdoob/three.js/blob/r186/src/core/RenderTarget.js).

For MRT, construct `new THREE.RenderTarget(width, height, { count: 2 })` and use
`.textures[0]`/`.textures[1]`; `WebGLMultipleRenderTargets` is obsolete. The pass must explicitly
write each attachment using matching GLSL outputs or a WebGPU `mrt(...)` node; allocating
attachments alone does not produce multiple meaningful outputs. Never sample an attachment
while rendering into that same attachment: exclude its consumers from the capture or ping-pong
between targets. MSAA color resolves and storage are separate concerns; see the storage rules below.
[r186 RenderTarget](https://github.com/mrdoob/three.js/blob/r186/src/core/RenderTarget.js)

### Dynamic cube reflections

This WebGL capture helper hides the complete reflective object during all six faces and restores
its prior visibility even on failure. It captures the object's world position, not a parent-local
position. Exclude every other target-texture consumer too. The caller owns the scene/object/
material; this helper owns the target, and restores the previous explicit environment on teardown.

<!-- check: dynamic-cube-reflection -->
```js
import * as THREE from 'three';

function createCubeReflection(renderer, scene, object, material) {
  const target = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
  const camera = new THREE.CubeCamera(0.1, 100, target);
  const previousMap = material.envMap;
  material.envMap = target.texture;
  material.needsUpdate = true;
  return {
    update() {
      object.getWorldPosition(camera.position);
      const visible = object.visible;
      object.visible = false;
      try { camera.update(renderer, scene); }
      finally { object.visible = visible; }
    },
    dispose() {
      if (material.envMap === target.texture) {
        material.envMap = previousMap;
        material.needsUpdate = true;
      }
      target.dispose();
    },
  };
}
```

Update only when the reflection changes, not necessarily every frame. With `WebGPURenderer`,
use `CubeRenderTarget` from `three/webgpu` and `await renderer.init()` before synchronous
`CubeCamera.update()`. [r186 CubeCamera](https://github.com/mrdoob/three.js/blob/r186/src/cameras/CubeCamera.js)

### TSL sampling coordinates

NodeMaterial's ordinary `map`, `normalMap`, and other supported slots remain useful.
For custom sampling, `texture(map)` selects the texture's channel and applies its UV transform.
Supplying explicit coordinates, such as `texture(map, uv(1))` or
`texture(map, uv().mul(0.5).add(0.25))`, replaces that automatic coordinate path; offset/repeat/
rotation are not additionally applied unless requested with `.setUpdateMatrix(true)`.
Import `texture`/`uv` from `three/tsl` and NodeMaterials from `three/webgpu`; graph authoring
belongs to the shaders topic in the skill index.
[r186 TextureNode transform selection](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/TextureNode.js)

### Viewport units

Set `target.viewport` and `target.scissor` in target pixels; neither should be multiplied by canvas DPR. In common `Renderer`/`WebGPURenderer`, canvas viewport/scissor use logical pixels and the renderer applies its pixel ratio, while offscreen targets use a ratio of `1`. `renderer.setViewport()` configures the canvas target, not the currently bound offscreen target. [r186 common target scaling](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js#L1763-L1787), [r186 setViewport](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js#L2330-L2344)

For r186 `WebGLRenderer`, `setRenderTarget(target)` copies the target-pixel viewport/scissor, but direct `renderer.setViewport()`/`setScissor()` still apply renderer DPR even while a target is bound. Configure the target rectangles before binding it instead of assuming the common-renderer setter behavior. [r186 WebGL setters](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js#L799-L858), [r186 WebGL target binding](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js#L3041-L3049)

### Multisample storage

`RenderTarget` has `storeMultisampledColorBuffer`, `storeMultisampledDepthBuffer`, and `storeMultisampledStencilBuffer`, all defaulting to `true`. Set color storage to `false` only for a fully redrawn pass whose consumers read resolved color; preserve it when accumulating without clearing or when transmission needs a mid-pass framebuffer copy. In WebGPU, sampled multisampled depth is not resolved: keep depth storage `true` for depth-based effects. Depth/stencil can be discarded only when no later consumer needs those multisampled values. Storage flags are distinct from `resolveColorBuffer`/`resolveDepthBuffer`/`resolveStencilBuffer`; WebGPU does not support depth resolves. Do not assume identical bandwidth savings across backends. [r186 storage/resolve contract](https://github.com/mrdoob/three.js/blob/r186/src/core/RenderTarget.js#L175-L251), [r186 WebGPU discard selection](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPUBackend.js#L948-L951), [r186 WebGL multisample handling](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLTextures.js#L2342-L2396)

### Shared depth ownership

In common `Renderer`/`WebGPURenderer`, attaching a `DepthTexture` with no owner records that target in `depthTexture.renderTarget`; another target can borrow it without taking ownership. Keep attachment dimensions and sample counts compatible and resize them together. The common renderer resizes/releases the depth allocation only for its recorded owner. Retire borrowing targets before disposing or resizing that owner; do not separately dispose its depth texture. [r186 depth attachment ownership](https://github.com/mrdoob/three.js/blob/r186/src/core/RenderTarget.js#L335-L340), [r186 depth resize/sample handling](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Textures.js#L110-L168), [r186 owner-only depth release](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Textures.js#L550-L578)

This is not a portable `WebGLRenderer` lifetime guarantee: disposing a WebGL target disposes its attached depth texture regardless of `depthTexture.renderTarget`. Prefer a separate depth attachment per target there; never dispose one target while another live target still consumes its shared depth. [r186 WebGL depth release](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLTextures.js#L409-L419)

## Ownership, disposal, and memory

- Track owned textures separately from material references; use ref-counting or asset-scope teardown. Exclude target-owned attachments from standalone texture disposal sets.
- Deduplicate aliases before disposal. Dispose an owned texture only after its last consumer is gone.
- Clear live scene, material, and uniform references; then dispose materials and owned textures.
- Dispose render/depth/cube targets through `target.dispose()` after outstanding readbacks settle; do not separately dispose target-owned textures. Shared depth follows the renderer-specific owner rules above.
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
[`RenderTarget.dispose`](https://threejs.org/docs/pages/RenderTarget.html#dispose), and [r186
render-target texture management](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Textures.js).
