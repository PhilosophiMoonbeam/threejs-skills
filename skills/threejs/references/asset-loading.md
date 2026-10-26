# Asset Loading — Three.js 0.186.1

## Scope

This topic owns transport, loader completion, manager accounting, model/environment decoding,
compression, alternate URLs, caching, and teardown. All examples target exactly Three.js 0.186.1.
Texture sampling, animation playback, and picking belong to their named domain topics.

## Decisions and invariants

- Install and import core and addons from the same `three@0.186.1` package.
- Import addons only through `three/addons/...`; do not copy example modules between revisions.
- Prefer glTF 2.0 (`.gltf` or `.glb`) for runtime models. Use legacy loaders only when conversion is not practical.
- Treat `loadAsync()` as native loader completion, not universal dependency settlement.
- A manager batch is settled, not necessarily successful, when `LoadingManager.onLoad` runs.
- Keep decoder workers and decoded GPU resources under explicit ownership; JavaScript garbage collection is not GPU cleanup.
- Configure only the glTF compression extensions present in the delivered asset.

## Canonical `three@0.186.1` imports

```js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader, DRACO_GLTF_CONFIG } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { USDLoader } from "three/addons/loaders/USDLoader.js";
import { UltraHDRLoader } from "three/addons/loaders/UltraHDRLoader.js";
```

`RGBELoader` is a deprecated compatibility subclass in 0.186.1. Use `HDRLoader`.
See the [179→180 migration note](https://github.com/mrdoob/three.js/wiki/Migration-Guide#179--180)
and [revision 186 HDRLoader source](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/HDRLoader.js).

## `load` and `loadAsync`

`loader.load(url, onLoad, onProgress, onError)` starts asynchronous work. The result belongs to
`onLoad`; errors belong to `onError`. Inherited `loadAsync(url, onProgress)` resolves when that
loader invokes its native `onLoad` and preserves its native error path. For compound loaders such
as `GLTFLoader`, that completion includes the dependencies managed by that loader; it does not
settle requests that the application enqueues separately (for example, an `MTLLoader` preload).
Do not wrap `load()` in a new promise.

`TextureLoader.load()` is a special immediate-placeholder API: it returns a `Texture` before its
image arrives. It is not synchronous. Since r184, `FileLoader.load()` and `ImageBitmapLoader.load()`
return nothing; use `onLoad` or `loadAsync()` for their results.
[revision 186 Loader.loadAsync](https://github.com/mrdoob/three.js/blob/r186/src/loaders/Loader.js) ·
[183→184 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#183--184)

A per-loader progress callback receives a `ProgressEvent`. Treat `loaded / total` as byte progress
only when `total > 0`; servers may omit content length. `TextureLoader` does not support progress events.

## LoadingManager: counts, settlement, and abort

Share one manager only among requests that form one user-visible batch.

```js
const failed = new Set();
const manager = new THREE.LoadingManager();
manager.onProgress = (url, itemsLoaded, itemsTotal) => updateItemProgress(itemsLoaded, itemsTotal);
manager.onError = (url) => failed.add(url);
manager.onLoad = () => {
  if (failed.size === 0) startExperience();
  else showFailedAssets([...failed]);
};
```

`manager.onStart(url, itemsLoaded, itemsTotal)` fires when an idle manager becomes active,
not once per file; install hooks before enqueueing work.
`itemsLoaded` and `itemsTotal` count manager items, not bytes. Compound assets can discover buffers
and textures after loading starts, so `itemsTotal` can grow and the ratio need not be monotonic.
`GLTFLoader` adds an accounting item and documents its count as inaccurate. A failed `FileLoader`
item reports `onError` and is then ended; consequently `onLoad` still fires after all items settle.
[revision 186 manager counters](https://github.com/mrdoob/three.js/blob/r186/src/loaders/LoadingManager.js) ·
[revision 186 GLTFLoader accounting](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js)

A cancelled load can still finish decoding. Use this helper for unshared operations, with a dedicated manager and a synchronous, non-throwing `release(value)` that frees its late result. `onSettled()` is a synchronous, non-throwing cleanup hook for the underlying load, even when the caller has already received cancellation. The caller owns successful results; the helper owns results arriving after cancellation or timeout. Manager abort is best-effort, requires participating loaders and browser support for `AbortSignal.any()`, and does not interrupt CPU parsing. [r186 LoadingManager.abort](https://github.com/mrdoob/three.js/blob/r186/src/loaders/LoadingManager.js)

<!-- check: owned-load -->
```js
function loadOwned(loader, url, { signal, timeoutMs = 30000, release, onSettled = () => {} }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timerId;
    function cleanup() {
      clearTimeout(timerId);
      signal?.removeEventListener('abort', onAbort);
    }
    function cancel(reason) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason);
      loader.manager.abort();
    }
    function onAbort() {
      cancel(signal.reason);
    }
    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }
    if (signal?.aborted) {
      reject(signal.reason);
      onSettled();
      return; // Do not start work for an already-retired owner.
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    timerId = setTimeout(() => cancel(new Error(`Timed out loading ${url}`)), timeoutMs);
    try {
      loader.loadAsync(url).then((value) => {
        if (settled) {
          release(value);
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      }, fail).finally(onSettled);
    } catch (error) {
      fail(error);
      onSettled();
    }
  });
}
```

`FileLoader` coalesces simultaneous identical URLs across managers. Shared requests need one asset/cache owner that aborts only after its last consumer retires; a dedicated manager alone does not isolate those requests. [r186 FileLoader request sharing](https://github.com/mrdoob/three.js/blob/r186/src/loaders/FileLoader.js)

Call the owner's `AbortController.abort()` during teardown. After awaiting a successful result, check the lifetime signal again before attaching it: if teardown won that interval, release the result instead. A failed compound load can leave partially created resources; `release` covers returned results only, so track partial resources at their creation boundaries when the loader exposes them.

## Minimal glTF/GLB pattern with compression

Assume the component supplies `signal` from its lifetime controller and `releaseGLTF(gltf)`, an asset-scope disposer that deduplicates owned geometry, materials, textures, bitmaps, and skeletons. Register its abort action before starting this operation. Use a dedicated manager/decoder pair for this independently cancellable load.

```js
const manager = new THREE.LoadingManager();
const dracoLoader = new DRACOLoader(manager).setDecoderPath(DRACO_GLTF_CONFIG);
const ktx2Loader = new KTX2Loader(manager);

// WebGLRenderer is ready immediately. WebGPURenderer must be initialized first.
if (renderer.isWebGPURenderer) await renderer.init();
ktx2Loader.detectSupport(renderer);

const gltfLoader = new GLTFLoader(manager)
  .setDRACOLoader(dracoLoader)
  .setKTX2Loader(ktx2Loader)
  .setMeshoptDecoder(MeshoptDecoder);

function retireDecoders() {
  dracoLoader.dispose();
  ktx2Loader.dispose();
}

try {
  const gltf = await loadOwned(gltfLoader, "models/compressed.glb", {
    signal, release: releaseGLTF, onSettled: retireDecoders,
  });
  if (signal.aborted) releaseGLTF(gltf);
  else {
    scene.add(gltf.scene);
    // Retain gltf.scene and gltf.animations in the owner's asset record.
    // On retirement: remove the scene, then releaseGLTF(gltf).
  }
} catch (error) {
  if (!signal.aborted) showAssetError(error);
}
```

`KHR_draco_mesh_compression` requires `setDRACOLoader`; `KHR_texture_basisu` requires
`setKTX2Loader`; `EXT_meshopt_compression` and `KHR_meshopt_compression` require
`setMeshoptDecoder`. In 0.186.1, `KTX2Loader` defaults to the packaged Basis JS/WASM files
resolved relative to the addon module (`examples/jsm/libs/basis`), so normally omit
`setTranscoderPath()`. If a bundler or static host does not preserve those files, copy
`basis_transcoder.js` and `basis_transcoder.wasm` from the exact `three@0.186.1` package and
set the path to that directory. Never pair `three@0.186.1` code with another package version's
decoder assets. `detectSupport(renderer)` is synchronous; WebGPU requires `await renderer.init()`
first, not deprecated `detectSupportAsync()`.
Reuse `DRACOLoader` and `KTX2Loader` within a shared lifetime; use `setWorkerLimit()` to keep decoder
workers within the application's CPU budget, and dispose each loader only after its final load.
[revision 186 compressed-glTF example](https://github.com/mrdoob/three.js/blob/r186/examples/webgl_loader_gltf_compressed.html) ·
[revision 186 DRACOLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/DRACOLoader.js) ·
[revision 186 GLTFLoader compression extensions](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js) ·
[revision 186 KTX2Loader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/KTX2Loader.js)

## Loaded glTF content and placement

Retain `scene` (default scene), `scenes`, `animations`, `cameras`, `asset` (version/generator),
and `userData` when needed; node extras are on each object's `userData`. Inspect names with
`gltf.scene.getObjectByName(name)` rather than assuming exporter-generated hierarchy paths.
Animation playback and mixer retirement belong to animation through the skill index.
Set mesh `castShadow`/`receiveShadow` by traversal only when intended; shadows also need renderer
and light configuration. PBR materials require suitable lighting/environment, not a loader fix.
[r186 GLTFLoader result and extras](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js)
`GLTFLoader` is renderer-independent. WebGPURenderer adapts supported conventional materials
internally; loading does not require replacing each material with a node-material class.
[r186 WebGPU glTF example](https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_loader_gltf.html)

For a standalone preview, normalize an **unattached** model using a parent wrapper so authored
root transforms and animation bindings remain unchanged. This is not a unit conversion for an
assembled scene. Bounds are a snapshot of the current pose; avoid empty/degenerate bounds.

<!-- check: model-preview-placement -->
```js
function createModelPreview(model) {
  if (model.parent) throw new Error("Preview model must be unattached.");
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  if (bounds.isEmpty() || !Number.isFinite(extent) || extent <= 0) {
    throw new Error("Model has no finite nonzero bounds.");
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const preview = new THREE.Group();
  const scale = 1 / extent;
  preview.scale.setScalar(scale);
  preview.position.copy(center).multiplyScalar(-scale);
  preview.add(model);
  return preview;
}
```

The wrapper is application-owned; removing it does not free model resources.
[r186 Box3.setFromObject](https://github.com/mrdoob/three.js/blob/r186/src/math/Box3.js)

## HDR and EXR transport

Use `HDRLoader.loadAsync()` or `EXRLoader.loadAsync()` for environment files. Return the loaded texture to its owner; mapping, color-space annotation, WebGL/WebGPU preprocessing, and environment teardown belong to the textures topic in the skill index. [r186 HDRLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/HDRLoader.js), [r186 EXRLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/EXRLoader.js)

`UltraHDRLoader` decodes gain-map JPEGs into a floating-point `DataTexture`, annotated
`LinearSRGBColorSpace`; use the same equirectangular mapping/lifetime policy as HDR/EXR.
It uses browser image/canvas APIs during reconstruction, so transport completion is not decode
readiness: await `loadAsync()`. Ordinary JPEGs are not a substitute for gain-map authoring.
[r186 UltraHDRLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/UltraHDRLoader.js)

## Image and cube transport

`TextureLoader` handles browser-supported image formats, including WebP/AVIF when supported by
the browser. Await decoding and handle rejection. glTF-loaded textures already carry their
color-role annotation. For a manually loaded replacement on glTF UVs, set `flipY = false` before
upload; color maps use `SRGBColorSpace`, non-color maps use `NoColorSpace`. Sampling, UV transforms,
map recompilation, environment mapping, and generated PMREM ownership belong to textures and
materials through the skill index.
[r186 glTF texture orientation](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js)

`CubeTextureLoader.loadAsync([px, nx, py, ny, pz, nz])` takes six faces in +X, -X, +Y, -Y,
+Z, -Z order and returns an sRGB cube texture. Assign it to `scene.background` and/or
`scene.environment` as appropriate; clear those references before its final owner's `dispose()`.
Its HTML-image requests do not participate in manager abort.
[r186 CubeTextureLoader](https://github.com/mrdoob/three.js/blob/r186/src/loaders/CubeTextureLoader.js)

## Gaussian splat loading

The official r186 addons return splat data as `BufferGeometry`, not a
`GaussianSplatGeometry` class. Render it with `GaussianSplat`, which requires
`WebGPURenderer` (including its `forceWebGL` fallback), not `WebGLRenderer`.
Resolve `three/webgpu` and `three/tsl` from the same package.
[r186 renderer boundary](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/objects/GaussianSplat.js)

- `SPZLoader` imports from `three/addons/loaders/SPZLoader.js`. It supports gzip
  SPZ v1–3 and ZSTD SPZ v4. `loadAsync(url)` waits for parsing and v4 decoder
  initialization; `await loader.parse(arrayBuffer)` handles either synchronous
  v1–3 output or the v4 promise. Higher-order SH output is supported through
  degree 3; v4 vendor extensions are skipped with a warning.
- `GaussianSplatPLYLoader` imports from
  `three/addons/loaders/GaussianSplatPLYLoader.js`.
  It reads Gaussian-specific PLY properties and detects SH degree 0–3 from the
  header. `loadAsync(url)` resolves to splat geometry; `parse(arrayBufferOrString)`
  is synchronous. Ordinary `PLYLoader` remains the generic mesh/point loader.
- `SPLATLoader` (`three/addons/loaders/SPLATLoader.js`) reads the uncompressed `.splat` format;
  `KSPLATLoader` (`three/addons/loaders/KSPLATLoader.js`) reads `.ksplat`. Both return
  `BufferGeometry` from `loadAsync()` and synchronously from `parse(arrayBuffer)`.
  Substitute either in the owned loading pattern below; the same renderer and disposal
  restrictions apply. They do not require a separately configured decoder.
  [r186 SPLATLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/SPLATLoader.js) ·
  [r186 KSPLATLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/KSPLATLoader.js)
- SPZ's fflate and ZSTD decoder are bundled third-party libraries in the addon
  package; the ZSTD WASM is embedded in its module. No external decoder path,
  separate worker pool, or loader `dispose()` API is required. The module caches
  decoder readiness; manager transport settlement alone is not v4 parse readiness.

[r186 SPZ loader and decoder imports](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/SPZLoader.js) ·
[r186 embedded ZSTD decoder](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/libs/zstddec.module.js) ·
[r186 Gaussian PLY loader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GaussianSplatPLYLoader.js)

This uses the `loadOwned` helper above. Supply a `WebGPURenderer` owned by the
splat view, constructed **without a supplied `GPUDevice`**, and its lifetime
`AbortSignal`. This lets final renderer disposal retire its renderer-created
native device. The returned object is ready but unattached; the caller owns scene
attachment and `releaseGaussianSplat()`. Cancelled/late geometry is released
without constructing an object.

<!-- check: gaussian-load-r186 -->
```js
import { LoadingManager } from "three/webgpu";
import { SPZLoader } from "three/addons/loaders/SPZLoader.js";
import { GaussianSplat } from "three/addons/objects/GaussianSplat.js";

function releaseGaussianSplat(splats) {
  splats.removeFromParent();
  splats.dispose();
  splats.geometry.dispose();
  splats.material.dispose();
  splats.splatGeometry.dispose();
}

async function loadGaussianSplatOwned(url, { renderer, signal }) {
  await renderer.init();
  if (signal.aborted) throw signal.reason;
  const data = await loadOwned(new SPZLoader(new LoadingManager()), url, {
    signal, release: (geometry) => geometry.dispose(),
  });
  if (signal.aborted) {
    data.dispose();
    throw signal.reason;
  }
  try {
    return new GaussianSplat(data);
  } catch (error) {
    data.dispose();
    throw error;
  }
}
```

After awaiting `loadGaussianSplatOwned()`, check `signal.aborted` once more before
scene attachment: release a retired result; otherwise add and retain it.

For PLY, substitute `GaussianSplatPLYLoader` with the same lifetime policy.
Before final view teardown, abort its loads and stop rendering, then remove and
release retained splats. The source `splatGeometry`, generated instanced
`geometry`, and generated node `material` are distinct resources. The release
helper assumes one unshared result; shared source geometry needs a final-consumer
owner instead. In r186, `GaussianSplat`/`CountingSort` expose no public disposal
of internal sort/SH compute nodes. With the renderer-created native device assumed
above, keep rendered splats within a bounded renderer-owned lifetime; finally
**await `renderer.dispose()`** to retire that device and its private compute
resources. A supplied `GPUDevice` remains caller-owned: renderer disposal alone
cannot guarantee deterministic private compute retirement. Its owner must retire
the device after its final users; otherwise this recipe cannot promise per-view
private compute cleanup. Do not claim `splats.dispose()` recursively frees data
or independently tears down all compute resources on a continuing shared renderer.
[r186 Object3D disposal](https://github.com/mrdoob/three.js/blob/r186/src/core/Object3D.js) ·
[r186 sort ownership](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/gpgpu/CountingSort.js) ·
[r186 asynchronous renderer disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js) ·
[r186 native backend device ownership](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPUBackend.js#L3271-L3275)

For glTF `KHR_gaussian_splatting`, register the official plugin explicitly on the
configured `GLTFLoader` before loading:

```js
import { GLTFGaussianSplatLoaderExtension } from "three/addons/loaders/GLTFGaussianSplatLoaderExtension.js";

gltfLoader.register((parser) => new GLTFGaussianSplatLoaderExtension(parser));
const gltf = await loadOwned(gltfLoader, "models/splats.glb", {
  signal, release: releaseGLTF, onSettled: retireDecoders,
});
```

The plugin creates `GaussianSplat` objects, not ordinary point meshes. It requires
POINTS primitives, the ellipse kernel, and explicit `colorSpace`; mixed Gaussian
and ordinary primitives in one glTF mesh are unsupported. Initialize the renderer
first and extend `releaseGLTF` to dispose splat objects and their `splatGeometry`,
deduplicating shared data alongside ordinary geometry/material resources. Apply
the same cancellation, post-await lifetime check, and final renderer retirement
as above. Compression decoders remain configured only for extensions the asset uses.
[r186 glTF Gaussian plugin](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFGaussianSplatLoaderExtension.js)

## Legacy model formats

- OBJ/MTL: use a dedicated manager and track its errors. `MTLLoader.loadAsync()` covers the MTL
  file, but `materials.preload()` starts placeholder texture loads. After the MTL phase has completed,
  install a fresh settlement promise before enqueueing `preload()` and the OBJ load:

  ```js
  const failed = new Set();
  const manager = new THREE.LoadingManager();
  manager.onError = (url) => failed.add(url);

  const materials = await new MTLLoader(manager).loadAsync("a.mtl");
  const settlement = new Promise((resolve) => { manager.onLoad = resolve; });
  materials.preload();
  const objectPromise = new OBJLoader(manager).setMaterials(materials).loadAsync("a.obj");
  const [objectResult] = await Promise.allSettled([objectPromise, settlement]);

  if (objectResult.status === "rejected") throw objectResult.reason;
  if (failed.size > 0) throw new Error(`Asset dependencies failed: ${[...failed].join(", ")}`);
  const object = objectResult.value;
  ```

  This manager must not be shared with unrelated loads. Apply the same dedicated-manager
  settlement and error policy to FBX files with external textures.
  [revision 186 loader promise](https://github.com/mrdoob/three.js/blob/r186/src/loaders/Loader.js) ·
  [revision 186 MTL texture preload](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/MTLLoader.js)
- FBX: `FBXLoader.loadAsync()` returns a `Group` with `animations`. Since r184 the loader applies a
  root rotation from +Z-up to +Y-up; do not rotate again, and do not describe this as vertex conversion.
  A `0.01` scale is not universal. Inspect export units and `object.userData.unitScaleFactor`, then
  apply the application's deliberate unit conversion.
- STL: `STLLoader.loadAsync()` returns `BufferGeometry`; construct the mesh and material explicitly.
- USD: `USDLoader.loadAsync()` returns a `Group` and handles USD, USDA, USDC, and USDZ archives.
  It replaces deprecated `USDZLoader`; this is the addon's supported USD subset, not a complete
  USD authoring/composition engine. `parse(buffer, basePath, onLoad, onError)` returns a group
  immediately, but its callback waits for referenced textures; do not treat the return value
  as ready. [r186 USDLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/USDLoader.js)
- PLY: `PLYLoader.loadAsync()` returns `BufferGeometry`. Three.js 0.186.1 preserves declared `double`/`float64`
  attributes as `Float64Array`, which WebGL/WebGPU attributes cannot render directly.

```js
const geometry = await new PLYLoader(manager).loadAsync("scan.ply");
for (const [name, attribute] of Object.entries(geometry.attributes)) {
  if (attribute.array instanceof Float64Array) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(
      attribute.array, attribute.itemSize, attribute.normalized,
    ));
  }
}
```

Convert only float64 render attributes, not integer color or index data indiscriminately.
For triangle meshes, compute missing normals only if needed and enable material `vertexColors`
only when the geometry has a `color` attribute. Preserve authored normals and colors; PLY can
also represent points, for which a mesh/normals recipe is inappropriate.
[184→185 PLY migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185) ·
[revision 186 PLYLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/PLYLoader.js) ·
[revision 186 FBXLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/FBXLoader.js)

## URL, blob, and in-memory loading

Use `loader.setPath()` for main files and `setResourcePath()` for referenced resources.
A URL modifier must preserve absolute, `data:`, and `blob:` URLs; resolve instead of prefixing:

```js
manager.setURLModifier((url) => new URL(url, "https://cdn.example.com/assets/").href);
```

For a blob map, return `URL.createObjectURL(blob)` from the modifier, collect every created URL,
and revoke all of them only after the compound asset settles. Blob URLs are intentionally not cached.
For an `ArrayBuffer`, check HTTP status, then provide the dependency base URL:

```js
const assetURL = new URL(url, document.baseURI);
const response = await fetch(assetURL);
if (!response.ok) throw new Error(`Asset HTTP ${response.status}: ${assetURL.href}`);
const gltf = await gltfLoader.parseAsync(
  await response.arrayBuffer(),
  new URL("./", assetURL).href,
);
```

[revision 186 GLTFLoader.parseAsync](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js) ·
[URL resolution](https://developer.mozilla.org/en-US/docs/Web/API/URL/URL) ·
[revision 186 LoadingManager URL modifier](https://github.com/mrdoob/three.js/blob/r186/src/loaders/LoadingManager.js)

For independent loads, start their `loadAsync()` calls together. `Promise.all()` rejects on the
first error without cancelling siblings; use explicit ownership and settle/retire every result
before abandoning a batch. A placeholder is separate application-owned geometry/material:
remove and dispose it when replacing it, or on failure/teardown.

For a single blob-backed texture, revoke its URL on both success and failure. The successful
caller owns the texture; revocation is not texture disposal.

<!-- check: blob-texture-load -->
```js
async function loadTextureFromBlob(blob, manager = THREE.DefaultLoadingManager) {
  const url = URL.createObjectURL(blob);
  try {
    return await new THREE.TextureLoader(manager).loadAsync(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

## Caching, performance, cloning, and cleanup

`THREE.Cache` is disabled by default and globally stores resolved loader results. `FileLoader`
uses `file:` keys, `ImageLoader` uses `image:` keys for `HTMLImageElement` objects, and
`ImageBitmapLoader` uses `image-bitmap:` keys for promises and decoded `ImageBitmap` objects.
These entries are not parsed textures or models. Enable the cache only after measuring reuse.
`Cache.remove()` and `Cache.clear()` release references; neither disposes nor closes underlying
resources. Dispose GPU resources and close owned image bitmaps after their final users are gone.
[revision 186 Cache](https://github.com/mrdoob/three.js/blob/r186/src/loaders/Cache.js) ·
[revision 186 FileLoader](https://github.com/mrdoob/three.js/blob/r186/src/loaders/FileLoader.js) ·
[revision 186 ImageLoader](https://github.com/mrdoob/three.js/blob/r186/src/loaders/ImageLoader.js) ·
[revision 186 ImageBitmapLoader](https://github.com/mrdoob/three.js/blob/r186/src/loaders/ImageBitmapLoader.js)

A parsed glTF cache should retain an asset record containing at least `scene` and `animations`.
Use `SkeletonUtils.clone(asset.scene)` for independent skinned instances; plain `Object3D.clone()`
is insufficient for skinned hierarchies. At final ownership teardown, traverse cached scenes and
deduplicate shared geometries, materials, textures, and skeletons before disposing each once.
Close loader-owned `ImageBitmap` objects with `image.close()` only after every texture user is gone.
Clearing a map is not disposal. Remove scene references before final resource disposal.
[revision 186 SkeletonUtils.clone](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/utils/SkeletonUtils.js) ·
[official disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

In r186, call `object.dispose()` on each owned subtree object to release per-object renderer
state (including instanced buffers). It does not recurse or release geometry/material/texture
resources. Dispose skeletons separately after their last skinned user; cloned instances can
still share geometry, materials, and textures. Do not copy a traversal that disposes aliases
multiple times or closes a bitmap still used by another asset.
[r186 Object3D.dispose](https://github.com/mrdoob/three.js/blob/r186/src/core/Object3D.js)

## Common failures and corrections

- Startup runs after a failure, or progress moves backward: manager completion is settlement and totals are dynamic items.
- A texture or local glTF is wrong: await completion, inspect errors/color space, and provide the dependency resource base.
- Compressed glTF fails: align decoder assets with `three@0.186.1`; initialize WebGPU before KTX2 detection.
- Memory remains after cache clear: dispose GPU resources, skeletons, decoder pools, and image bitmaps.

## Official sources

- [Three.js revision 186 source tag](https://github.com/mrdoob/three.js/tree/r186)
- [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
