# Core Rendering — Three.js 0.186.1

## Scope

Own the scene graph, cameras, renderer lifecycle, renderer-loop scheduling, resizing, transforms, color output, disposal, and render-performance decisions. [r186 Renderer loop](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js#L2058-L2073), [r186 Timer](https://github.com/mrdoob/three.js/blob/r186/src/core/Timer.js)
Use the geometry, materials, lighting and shadows, textures and render targets, animation, asset loading, interaction and controls, shaders and TSL, and post-processing topics for their details.
All APIs below target exactly Three.js 0.186.1.

## Imports and renderer decision

```js
import * as THREE from 'three';
// Addons, when needed: import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
```

- Use `WebGLRenderer` from `three` for the mature WebGL 2 path and broad material/addon support.
- Use `WebGPURenderer` from `three/webgpu` when WebGPU, node materials, or TSL is a requirement. It selects WebGPU when available and otherwise falls back to a WebGL 2 backend; `{ forceWebGL: true }` deliberately selects that fallback.
- WebGPU/renderer classes come from `three/webgpu`; TSL functions come from `three/tsl`; ordinary addons use `three/addons/...`.
- `WebGLRenderer` is ready after construction. `WebGPURenderer.setAnimationLoop()` asynchronously initializes its backend before installing the loop. For on-demand rendering or synchronous feature queries, `await renderer.init()` before calling `renderer.render()`; do not use deprecated `renderAsync()`. [WebGPU renderer guide](https://threejs.org/manual/en/webgpurenderer.html), [r186 Renderer initialization and loop](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js), [r186 WebGPURenderer](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPURenderer.js)
- For `Renderer`/`WebGPURenderer`, call `await renderer.init()` first, then use synchronous `renderer.hasFeature(name)` for selected-backend capability checks; r186 throws when called before initialization. `hasFeatureAsync()` is deprecated. [r186 Renderer feature checks](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js#L3033-L3043)
- WebGL defaults `alpha` to `false`; WebGPU defaults it to `true`. Prefer an opaque clear/background unless HTML compositing is intentional. r185 changed WebGPU premultiplied-alpha behavior. [r184→r185](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185)
- When another library changes a shared raw WebGL context, call `renderer.resetState()` before Three.js resumes rendering. This is not a per-frame requirement for an exclusively owned context. Common `Renderer` requires initialization first; its WebGPU backend makes this a no-op. [r186 common resetState](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js#L2302-L2316), [r186 WebGLRenderer](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js)

```js
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
await renderer.init(); // Required here because this is an on-demand renderer.
renderer.render(scene, camera);
```

## Browser import maps

For browser-only CDN loading, choose one import map and pin every Three.js URL to `0.186.1`:

```html
<!-- WebGL -->
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"
  }
}
</script>
```

```html
<!-- WebGPU/TSL: map bare `three` to the WebGPU build because addons import it -->
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.webgpu.js",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.webgpu.js",
    "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.tsl.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"
  }
}
</script>
```

With npm or a bundler, install `three@0.186.1`; its package exports provide the same boundaries without an import map. [r186 package exports](https://github.com/mrdoob/three.js/blob/r186/package.json)

## Minimal WebGL lifecycle

The host owns the canvas and its CSS size; this setup owns its renderer and scene resources. Call `dispose()` before replacing the canvas or mounting another renderer on it.

```html
<canvas id="view"></canvas>
<style>
  html, body { margin: 0; width: 100%; height: 100%; }
  #view { display: block; width: 100%; height: 100%; }
</style>
```

<!-- check: webgl-baseline -->
```js
import * as THREE from 'three';

const canvas = document.querySelector('#view');
if (!canvas) throw new Error('Missing #view canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x181818);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 4);

const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial({ color: 0x44aaff });
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

function resize() {
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const dpr = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    renderer.setSize(width, height, false);
  }
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(canvas);
resize();

const timer = new THREE.Timer();
timer.connect(document); // Exclude time while this document is hidden.
function frame(timestamp) {
  timer.update(timestamp);
  mesh.rotation.y += timer.getDelta();
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

function dispose() {
  renderer.setAnimationLoop(null);
  resizeObserver.disconnect();
  timer.dispose();
  scene.remove(mesh);
  mesh.dispose(); // Notify object consumers; ordinary Mesh does not own geometry/material.
  scene.dispose(); // Base disposal is not recursive.
  geometry.dispose();
  material.dispose();
  renderer.dispose(); // WebGLRenderer disposal is synchronous.
}
```

For continuous rendering, use `renderer.setAnimationLoop()`; it also supports WebXR. Update one `Timer` at frame start, then reuse its stable `getDelta()` and `getElapsed()` values. `Clock` remains deprecated in Three.js 0.186.1. [r186 Timer](https://github.com/mrdoob/three.js/blob/r186/src/core/Timer.js), [r182→r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)
This uses the `setPixelRatio()` strategy: `setSize()` receives CSS-pixel dimensions and applies the renderer's pixel ratio once. Do not pass `width * dpr` and also leave a non-`1` pixel ratio configured. If physical dimensions are managed manually instead, set the renderer pixel ratio to `1` and pass the multiplied drawing-buffer dimensions. [Responsive rendering manual](https://threejs.org/manual/en/responsive.html)

### Application-created canvas

When the application owns the canvas, replace the baseline's canvas lookup and missing-canvas check with the following setup. The host document must provide `#app` with explicit nonzero dimensions; CSS controls display size, so retain the baseline's `setSize(width, height, false)` and resize observer.

<!-- check: owned-canvas-setup -->
```js
const host = document.querySelector('#app');
if (!host) throw new Error('Missing #app host');
const canvas = document.createElement('canvas');
Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
host.append(canvas);
```

Keep the remaining baseline setup. At the end of its `dispose()`, after stopping producers, freeing scene resources, and calling `renderer.dispose()`, remove the application-owned node:

<!-- check: owned-canvas-teardown -->
```js
canvas.remove();
```

Leave a host-owned canvas in place. Renderer disposal releases renderer resources; DOM removal is a separate ownership action. With `WebGPURenderer`, remove an owned canvas only after `await renderer.dispose()` completes. [r186 WebGLRenderer disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js#L1082-L1109), [r186 common Renderer disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js#L2692-L2726)

## Continuous versus on-demand rendering

Choose one owner for frame scheduling. Use `setAnimationLoop()` for animation or WebXR; for a static scene, render once and invalidate only when state changes. A one-shot `requestAnimationFrame()` is appropriate for coalescing invalidations, but do not install it alongside an animation loop:

<!-- check: on-demand -->
```js
let frameId = null;
let disposed = false;
function renderOnDemand() {
  frameId = null;
  if (controls.enableDamping) controls.update();
  resize(); // resize the drawing buffer and update the camera
  renderer.render(scene, camera);
}
function invalidate() {
  if (!disposed && frameId === null) frameId = requestAnimationFrame(renderOnDemand);
}

controls.addEventListener('change', invalidate);
window.addEventListener('resize', invalidate);
const resizeObserver = new ResizeObserver(invalidate);
resizeObserver.observe(renderer.domElement);
// Call invalidate() after an async model/texture/data update as well.
invalidate();

function disposeScheduling() {
  disposed = true;
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  resizeObserver.disconnect();
  controls.removeEventListener('change', invalidate);
  window.removeEventListener('resize', invalidate);
}
```

Set `frameId` back to `null` before rendering so damping-triggered `change` events schedule at most one next frame. Invalidate after controls, resize, and asset/data changes; call `disposeScheduling()` before disposing controls or the renderer. This avoids a continuously running loop and avoids duplicate queued frames. [Rendering on demand manual](https://threejs.org/manual/en/rendering-on-demand.html)

## Cameras

A `PerspectiveCamera(fov, aspect, near, far)` uses a vertical field of view in degrees. Keep `near > 0` and the near/far interval as tight as practical for depth precision. After changing `fov`, `aspect`, `near`, or `far`, call `updateProjectionMatrix()`.

For an `OrthographicCamera`, preserve a vertical span on resize:

```js
const span = 10;
camera.left = -span * aspect / 2;
camera.right = span * aspect / 2;
camera.top = span / 2;
camera.bottom = -span / 2;
camera.updateProjectionMatrix();
```

With `WebGLRenderer`, `ArrayCamera` subcamera viewports are drawing-buffer pixel rectangles, not normalized fractions. Recompute them after every renderer resize; the layout below is WebGL-specific. With common `Renderer`/`WebGPURenderer`, use logical pixels for canvas rendering (`renderer.getSize()`), but target pixels for offscreen rendering. Both common backends apply the canvas pixel ratio themselves. [r186 WebGL array-camera example](https://github.com/mrdoob/three.js/blob/r186/examples/webgl_camera_array.html), [r186 WebGPU viewport scaling](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPUBackend.js#L2260-L2294), [r186 fallback viewport scaling](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/WebGLBackend.js#L1271-L1330)

```js
const bufferSize = new THREE.Vector2();
function layoutArrayCamera(renderer, subCameras, columns, rows) {
  renderer.getDrawingBufferSize(bufferSize);
  subCameras.forEach((subCamera, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = Math.floor(column * bufferSize.x / columns);
    const right = Math.floor((column + 1) * bufferSize.x / columns);
    const bottom = Math.floor(row * bufferSize.y / rows);
    const top = Math.floor((row + 1) * bufferSize.y / rows);
    subCamera.viewport.set(left, bottom, right - left, top - bottom);
    subCamera.aspect = (right - left) / (top - bottom);
    subCamera.updateProjectionMatrix();
  });
}
```

A `CubeCamera` capture must exclude the reflective object to prevent feedback:

```js
const target = new THREE.WebGLCubeRenderTarget(256);
const cubeCamera = new THREE.CubeCamera(0.1, 100, target);
const capturePosition = new THREE.Vector3();
function captureEnvironment(reflector) {
  cubeCamera.position.copy(reflector.getWorldPosition(capturePosition));
  const wasVisible = reflector.visible;
  reflector.visible = false;
  try {
    cubeCamera.update(renderer, scene);
  } finally {
    reflector.visible = wasVisible;
  }
}
// At owner teardown: target.dispose().
```

Use `CubeRenderTarget`, not `WebGLCubeRenderTarget`, with `WebGPURenderer` in Three.js 0.186.1. [r186 CubeCamera](https://github.com/mrdoob/three.js/blob/r186/src/cameras/CubeCamera.js), [r182→r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)

## Scene graph and transforms

- `Scene`, `Group`, `Mesh`, lights, and cameras derive from `Object3D`; `add()` establishes parent ownership of transforms, not GPU-resource ownership.
- Local transforms are `position`, normalized `quaternion`, and `scale`. Euler `rotation` is radians and stays synchronized with `quaternion`; avoid writing both as independent state.
- Normalize arbitrary application-supplied quaternion components before use. [r157→r158](https://github.com/mrdoob/three.js/wiki/Migration-Guide#157--158)
- Three.js uses a right-handed world with default +Y up. A default camera looks along local −Z; “+Z points at the viewer” is true only for the conventional untransformed camera. [Object3D.DEFAULT_UP](https://threejs.org/docs/pages/Object3D.html#DEFAULT_UP)
- World-space getters require caller-owned targets. Reuse a `Vector3` or `Quaternion`; cache results only with explicit invalidation when transforms change.
- `visible` disables an object and its descendants. `layers` filters cameras/raycasters. `renderOrder` adjusts ordering but does not repair incorrect transparency or depth configuration.

### Matrix invalidation contract

- With `matrixAutoUpdate = true` (default), Three.js composes position/quaternion/scale into `matrix` before rendering.
- With it `false`, call `updateMatrix()` after changing position/quaternion/scale.
- If application code writes `matrix` directly while automatic updates are off, set `matrixWorldNeedsUpdate = true` before a non-forced world update.
- `updateMatrixWorld(force)` updates descendants; reserve `force = true` for an intentional full refresh.
- `updateWorldMatrix(updateParents, updateChildren, force)` gives explicit ancestor/descendant control. In Three.js 0.186.1 it honors `matrixWorldNeedsUpdate`. [r186 Object3D](https://github.com/mrdoob/three.js/blob/r186/src/core/Object3D.js), [r184→r185](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185)

## Renderer output and color

- `renderer.outputColorSpace` already defaults to `THREE.SRGBColorSpace`; assigning it again is unnecessary.
- Lighting calculations use Linear-sRGB. `Color` stores Linear-sRGB working values; hex and CSS colors are interpreted as sRGB and converted automatically.
- `color.setRGB(r, g, b)` treats values as working-space components unless its optional source color space is supplied. Linear/HDR values may exceed 1.
- Mark color PNG/JPEG textures with `texture.colorSpace = THREE.SRGBColorSpace`; non-color/data maps generally retain `THREE.NoColorSpace`. Color HDR data such as EXR uses `THREE.LinearSRGBColorSpace`. Texture ownership belongs to the textures topic. [Color management](https://threejs.org/manual/en/color-management.html)
- `renderer.toneMapping = THREE.ACESFilmicToneMapping` is an artistic choice; Three.js 0.186.1 still defaults to `NoToneMapping`.
- Direct rendering to the screen applies renderer tone mapping and output-color-space conversion; ordinary offscreen render targets remain in their configured texture color space. A WebGL `EffectComposer` should end with `OutputPass` for final tone mapping and color conversion. [Color management](https://threejs.org/manual/en/color-management.html), [r186 WebGLRenderer output](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js), [r154→r155](https://github.com/mrdoob/three.js/wiki/Migration-Guide#154--155), [r186 OutputPass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/OutputPass.js)
- A WebGPU `RenderPipeline` normally leaves `outputColorTransform` enabled; disable it only when the pipeline graph explicitly adds `renderOutput()`. `preserveDrawingBuffer` is a WebGL-only renderer option and normally remains `false`; for a WebGL screenshot, render immediately before `canvas.toBlob()` or `toDataURL()`. [r186 RenderPipeline](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/RenderPipeline.js), [r186 WebGPURenderer options](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPURenderer.js), [Screenshot guidance](https://threejs.org/manual/en/tips.html#taking-a-screenshot-of-the-canvas)

## Disposal and ownership

Stop producers before freeing consumers: stop the animation loop, cancel queued on-demand frames, disconnect observers/listeners, and stop new async loads/readbacks. Wait for tracked loads and GPU readbacks to settle while their renderer and targets remain alive; settlement does not imply success. Then dispose timers, controls, and animation bindings, detach retiring objects, notify object consumers, and free each owned allocation exactly once after its last user. Dispose the renderer last. [Disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

- In r186, base `Object3D.dispose()` only dispatches a `dispose` event. It does not remove the object, visit children, or dispose geometry, material, texture, or skeleton. Notify each retiring object separately; common renderer object caches listen for this event. Removing an object alone is not disposal. [r186 Object3D.dispose](https://github.com/mrdoob/three.js/blob/r186/src/core/Object3D.js#L1656-L1675), [r186 RenderObject listeners](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/RenderObject.js#L346-L360)
- Custom `Object3D` subclasses that override `dispose()` must call `super.dispose()` to preserve notification, then release only their owned resources. Resource-specific overrides differ: `InstancedMesh` releases its morph texture; `BatchedMesh` also releases its internal geometry and textures. Exclude override-owned allocations from separate disposal sets; do not apply a generic “dispose object, then every geometry” traversal to them. Shared geometry/material/texture ownership remains external. [r186 InstancedMesh.dispose](https://github.com/mrdoob/three.js/blob/r186/src/objects/InstancedMesh.js#L390-L405), [r186 BatchedMesh.dispose](https://github.com/mrdoob/three.js/blob/r186/src/objects/BatchedMesh.js#L1496-L1520)
- Material disposal does not dispose its textures. Asset loading and textures define load-boundary ownership.
- `WebGLRenderer.dispose()` remains synchronous. Common `Renderer`/`WebGPURenderer.dispose()` is asynchronous in r186: await it before replacing the renderer or removing an owned canvas. Do not treat base object notification as release of every compute or GPU allocation. [r186 WebGL disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js#L1082-L1109), [r186 common disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js#L2692-L2726)
- With the native WebGPU backend, final renderer disposal destroys a renderer-created `GPUDevice`, but does not destroy a supplied device. A supplied device remains caller-owned: its owner must retire it after its last user. Awaiting renderer disposal is not a guarantee that every internal GPU allocation on a supplied device has been released. Producer shutdown, readback settlement, and owned scene-resource cleanup remain required either way. [r186 WebGPUBackend disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPUBackend.js#L3252-L3277)

For an initialized `WebGPURenderer` using its default renderer-created device and owning the same ordinary mesh, geometry, material, scene, observer, and timer as the baseline, use this asynchronous teardown. The caller first stops other producers; `pendingReadbacks` contains every outstanding readback promise. Adapt resource ownership before adding controls, loaders, or targets. Rejected readbacks are reported after all settlements and cleanup:

<!-- check: webgpu-teardown -->
```js
async function disposeWebGPU({ renderer, pendingReadbacks, resizeObserver, timer, scene, mesh, geometry, material }) {
  await renderer.setAnimationLoop(null);
  resizeObserver.disconnect();
  const results = await Promise.allSettled(pendingReadbacks);
  timer.dispose();
  scene.remove(mesh);
  mesh.dispose();
  scene.dispose();
  geometry.dispose();
  material.dispose();
  await renderer.dispose();
  const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (failures.length) throw new AggregateError(failures, 'Readback failed during teardown');
}
```

## Render performance

- Measure draw calls with `renderer.info.render.calls` for WebGL or `renderer.info.render.drawCalls` for WebGPU, and triangles with `renderer.info.render.triangles` for either renderer; reset behavior changes if `renderer.info.autoReset` is disabled. [r186 WebGLInfo](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLInfo.js), [r186 common Info](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Info.js)
- Reduce draw calls through instancing or deliberate geometry merging; keep material-count and update-cost tradeoffs visible.
- Keep frustum culling enabled. `Mesh`, `Line`, and `Points` implement r186 `intersectsFrustum(frustum)` using object/geometry bounding spheres; `Sprite` uses its sprite bound. The base `Object3D` method is an empty override hook, not a general scene/group query. A custom renderable can override it for its own bound; return a boolean and handle `FrustumArray` when supporting common-renderer `ArrayCamera`. Recompute bounds after vertex/instance changes; enlarge CPU bounds or disable culling for shader-only deformation. Culling affects rendering, not animation evaluation. [r186 Object3D hook](https://github.com/mrdoob/three.js/blob/r186/src/core/Object3D.js#L1063-L1072), [r186 Mesh implementation](https://github.com/mrdoob/three.js/blob/r186/src/objects/Mesh.js#L218-L230), [r186 common renderer culling](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js#L3264-L3294), [r186 Frustum](https://github.com/mrdoob/three.js/blob/r186/src/math/Frustum.js)
- Cap device pixel ratio when fill rate dominates; lower render-target resolution for expensive offscreen effects.
- Avoid per-frame allocations, forced whole-tree matrix updates, redundant world-space queries, and unconditional cube-map captures.
- Update static shadows portably per light: set `light.shadow.autoUpdate = false`, then set `light.shadow.needsUpdate = true` whenever that light's shadow must refresh. The equivalent `renderer.shadowMap` flags are WebGL-specific. `PCFShadowMap` is the soft WebGL default in Three.js 0.186.1; do not select deprecated `PCFSoftShadowMap`. [r186 common renderer](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js), [r186 ShadowNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/lighting/ShadowNode.js), [r186 WebGLShadowMap](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLShadowMap.js), [r181→r182](https://github.com/mrdoob/three.js/wiki/Migration-Guide#181--182)
- Use `LOD` only when its transition and memory costs are justified. Profile CPU traversal, upload bandwidth, draw calls, and fragment cost separately.

## Official sources

- [Three.js revision 186 source](https://github.com/mrdoob/three.js/tree/r186)
- [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Object3D](https://threejs.org/docs/pages/Object3D.html)
- [PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html), [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html), [ArrayCamera](https://threejs.org/docs/pages/ArrayCamera.html)
- [Responsive rendering](https://threejs.org/manual/en/responsive.html)
- [Migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
