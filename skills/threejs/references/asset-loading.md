# Asset Loading — Three.js 0.185.1

## Scope

This topic owns transport, loader completion, manager accounting, model/environment decoding,
compression, alternate URLs, caching, and teardown. All examples target exactly Three.js 0.185.1.
Texture sampling, animation playback, and picking belong to their named domain topics.

## Decisions and invariants

- Install and import core and addons from the same `three@0.185.1` package.
- Import addons only through `three/addons/...`; do not copy example modules between revisions.
- Prefer glTF 2.0 (`.gltf` or `.glb`) for runtime models. Use legacy loaders only when conversion is not practical.
- Treat `loadAsync()` as native loader completion, not universal dependency settlement.
- A manager batch is settled, not necessarily successful, when `LoadingManager.onLoad` runs.
- Keep decoder workers and decoded GPU resources under explicit ownership; JavaScript garbage collection is not GPU cleanup.
- Configure only the glTF compression extensions present in the delivered asset.

## Canonical `three@0.185.1` imports

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
```

`RGBELoader` is a deprecated compatibility subclass in 0.185.1. Use `HDRLoader`.
See the [179→180 migration note](https://github.com/mrdoob/three.js/wiki/Migration-Guide#179--180)
and [revision 185 HDRLoader source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/HDRLoader.js).

## `load` and `loadAsync`

`loader.load(url, onLoad, onProgress, onError)` starts asynchronous work. The result belongs to
`onLoad`; errors belong to `onError`. Inherited `loadAsync(url, onProgress)` resolves when that
loader calls its native `onLoad` and preserves its native error path; it does not guarantee that
placeholder textures or other dependent requests have settled. Do not wrap `load()` in a new promise.

`TextureLoader.load()` is a special immediate-placeholder API: it returns a `Texture` before its
image arrives. It is not synchronous. Since r184, `FileLoader.load()` and
`ImageBitmapLoader.load()` return nothing; use `onLoad` or `loadAsync()` for their results.
[revision 185 Loader.loadAsync](https://github.com/mrdoob/three.js/blob/r185/src/loaders/Loader.js) ·
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

`itemsLoaded` and `itemsTotal` count manager items, not bytes. Compound assets can discover buffers
and textures after loading starts, so `itemsTotal` can grow and the ratio need not be monotonic.
`GLTFLoader` adds an accounting item and documents its count as inaccurate. A failed `FileLoader`
item reports `onError` and is then ended; consequently `onLoad` still fires after all items settle.
[revision 185 manager counters](https://github.com/mrdoob/three.js/blob/r185/src/loaders/LoadingManager.js) ·
[revision 185 GLTFLoader accounting](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/GLTFLoader.js)

For a timeout, give the operation a dedicated manager, race its `loadAsync()` promise with a timer,
and call `manager.abort()` on timeout. Clear the timer in `finally`. Abort works only for participating
loaders and browsers supporting `AbortSignal.any()`; it does not stop CPU parsing already in progress.
[revision 185 LoadingManager.abort](https://github.com/mrdoob/three.js/blob/r185/src/loaders/LoadingManager.js)

## Minimal glTF/GLB pattern with compression

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

try {
  const gltf = await gltfLoader.loadAsync("models/compressed.glb");
  scene.add(gltf.scene);
  // Preserve gltf.animations with the scene when the application supports animation.
} catch (error) {
  showAssetError(error);
}

// At final application teardown, after all loads:
dracoLoader.dispose();
ktx2Loader.dispose();
```

`KHR_draco_mesh_compression` requires `setDRACOLoader`; `KHR_texture_basisu` requires
`setKTX2Loader`; `EXT_meshopt_compression` and `KHR_meshopt_compression` require
`setMeshoptDecoder`. In 0.185.1, KTX2 resolves its packaged Basis JS/WASM relative to the addon.
Usually omit `setTranscoderPath()`. If deployment requires one, host assets from the exact
`three@0.185.1` package. Never pair `three@0.185.1` code with another package version's
decoder assets. `detectSupport(renderer)` is synchronous; WebGPU requires
`await renderer.init()` first, not deprecated `detectSupportAsync()`.
[revision 185 compressed-glTF example](https://github.com/mrdoob/three.js/blob/r185/examples/webgl_loader_gltf_compressed.html) ·
[revision 185 KTX2Loader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/KTX2Loader.js)

## HDR and EXR environments

With `WebGLRenderer`, explicit PMREM preprocessing owns a render target:

```js
const hdr = await new HDRLoader(manager).loadAsync("env/studio.hdr");
hdr.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
const envTarget = pmrem.fromEquirectangular(hdr);
scene.environment = envTarget.texture;
hdr.dispose();
pmrem.dispose();

// When retiring this environment:
scene.environment = null;
envTarget.dispose();
```

With `WebGPURenderer`, retain the HDR source; the renderer handles environment preprocessing:

```js
const hdr = await new HDRLoader(manager).loadAsync("env/studio.hdr");
hdr.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = hdr;
scene.background = hdr; // Optional.

// When retiring every use of this source:
scene.environment = null;
scene.background = null;
hdr.dispose();
```

Use `EXRLoader` identically for OpenEXR transport. HDR/EXR are linear color data; do not label
normal, roughness, metalness, or other data maps `LinearSRGBColorSpace`. Such maps use
`NoColorSpace` (the default); color/albedo/emissive PNG/JPEG inputs use `SRGBColorSpace`.
For WebGL, keep the PMREM render target because it owns the allocation. For WebGPU, keep the
HDR/EXR source texture until every environment or background reference is retired.
[Color-management input spaces](https://threejs.org/manual/en/color-management.html#input-color-space) ·
[revision 185 PMREM return type](https://github.com/mrdoob/three.js/blob/r185/src/extras/PMREMGenerator.js) ·
[revision 185 WebGPU retained environment](https://github.com/mrdoob/three.js/blob/r185/examples/webgpu_loader_gltf.html)

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
  [revision 185 loader promise](https://github.com/mrdoob/three.js/blob/r185/src/loaders/Loader.js#L90-L104) ·
  [revision 185 MTL texture preload](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/MTLLoader.js#L288-L296)
- FBX: `FBXLoader.loadAsync()` returns a `Group` with `animations`. Since r184 the loader applies a
  root rotation from +Z-up to +Y-up; do not rotate again, and do not describe this as vertex conversion.
  A `0.01` scale is not universal. Inspect export units and `object.userData.unitScaleFactor`, then
  apply the application's deliberate unit conversion.
- STL: `STLLoader.loadAsync()` returns `BufferGeometry`; construct the mesh and material explicitly.
- PLY: `PLYLoader.loadAsync()` returns `BufferGeometry`. Three.js 0.185.1 preserves declared `double`/`float64`
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
[184→185 PLY migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185) ·
[revision 185 FBXLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/FBXLoader.js)

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

[revision 185 GLTFLoader.parseAsync](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/GLTFLoader.js#L552-L568) ·
[URL resolution](https://developer.mozilla.org/en-US/docs/Web/API/URL/URL) ·
[revision 185 LoadingManager URL modifier](https://github.com/mrdoob/three.js/blob/r185/src/loaders/LoadingManager.js)

## Caching, performance, cloning, and cleanup

`THREE.Cache` is disabled by default and globally stores resolved loader results. `FileLoader`
uses `file:` keys, `ImageLoader` uses `image:` keys for `HTMLImageElement` objects, and
`ImageBitmapLoader` uses `image-bitmap:` keys for promises and decoded `ImageBitmap` objects.
These entries are not parsed textures or models. Enable the cache only after measuring reuse.
`Cache.remove()` and `Cache.clear()` release references; neither disposes nor closes underlying
resources. Dispose GPU resources and close owned image bitmaps after their final users are gone.
[revision 185 Cache](https://github.com/mrdoob/three.js/blob/r185/src/loaders/Cache.js) ·
[revision 185 FileLoader](https://github.com/mrdoob/three.js/blob/r185/src/loaders/FileLoader.js) ·
[revision 185 ImageLoader](https://github.com/mrdoob/three.js/blob/r185/src/loaders/ImageLoader.js) ·
[revision 185 ImageBitmapLoader](https://github.com/mrdoob/three.js/blob/r185/src/loaders/ImageBitmapLoader.js)

A parsed glTF cache should retain an asset record containing at least `scene` and `animations`.
Use `SkeletonUtils.clone(asset.scene)` for independent skinned instances; plain `Object3D.clone()`
is insufficient for skinned hierarchies. At final ownership teardown, traverse cached scenes and
deduplicate shared geometries, materials, textures, and skeletons before disposing each once.
Close loader-owned `ImageBitmap` objects with `image.close()` only after every texture user is gone.
Clearing a map is not disposal. Remove scene references before final resource disposal.
[revision 185 SkeletonUtils.clone](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/utils/SkeletonUtils.js#L384-L427) ·
[official disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

## Common failures and corrections

- Startup runs after a failure, or progress moves backward: manager completion is settlement and totals are dynamic items.
- A texture or local glTF is wrong: await completion, inspect errors/color space, and provide the dependency resource base.
- Compressed glTF fails: align decoder assets with `three@0.185.1`; initialize WebGPU before KTX2 detection.
- Memory remains after cache clear: dispose GPU resources, skeletons, decoder pools, and image bitmaps.

## Official sources

- [Three.js revision 185 source tag](https://github.com/mrdoob/three.js/tree/r185)
- [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
