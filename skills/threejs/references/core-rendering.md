# Core Rendering — Three.js 0.185.1

## Scope

Own the scene graph, cameras, renderer lifecycle, renderer-loop scheduling, resizing, transforms, color output, disposal, and render-performance decisions. [revision 185 Renderer loop](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/Renderer.js#L1919-L1926), [revision 185 Timer](https://github.com/mrdoob/three.js/blob/r185/src/core/Timer.js#L117-L151)
Use the geometry, materials, lighting and shadows, textures and render targets, animation, asset loading, interaction and controls, shaders and TSL, and post-processing topics for their details.
All APIs below target exactly Three.js 0.185.1.

## Imports and renderer decision

```js
import * as THREE from 'three';
// Addons, when needed: import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
```

- Use `WebGLRenderer` from `three` for the mature WebGL 2 path and broad material/addon support.
- Use `WebGPURenderer` from `three/webgpu` when WebGPU, node materials, or TSL is a requirement. It selects WebGPU when available and otherwise falls back to a WebGL 2 backend; `{ forceWebGL: true }` deliberately selects that fallback.
- WebGPU/renderer classes come from `three/webgpu`; TSL functions come from `three/tsl`; ordinary addons use `three/addons/...`.
- `WebGLRenderer` is ready after construction. `WebGPURenderer.setAnimationLoop()` asynchronously initializes its backend before installing the loop. For on-demand rendering or synchronous feature queries, `await renderer.init()` before calling `renderer.render()`; do not use deprecated `renderAsync()`. [WebGPU renderer guide](https://threejs.org/manual/en/webgpurenderer.html), [Renderer initialization and loop](https://threejs.org/docs/pages/Renderer.html#init), [r185 WebGPURenderer source](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgpu/WebGPURenderer.js#L12-L93)
- For `Renderer`/`WebGPURenderer`, call `await renderer.init()` first, then use synchronous `renderer.hasFeature(name)` for selected-backend capability checks; r185 throws when `hasFeature()` is called before backend initialization. `hasFeatureAsync()` is deprecated. [r185 `Renderer.js` implementation](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/Renderer.js#L2845-L2880)
- WebGL defaults `alpha` to `false`; WebGPU defaults it to `true`. Prefer an opaque clear/background unless HTML compositing is intentional. r185 changed WebGPU premultiplied-alpha behavior. [r184→r185](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185)

```js
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
await renderer.init(); // Required here because this is an on-demand renderer.
renderer.render(scene, camera);
```

## Browser import maps

For browser-only CDN loading, choose one import map and pin every Three.js URL to `0.185.1`:

```html
<!-- WebGL -->
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/"
  }
}
</script>
```

```html
<!-- WebGPU/TSL: map bare `three` to the WebGPU build because addons import it -->
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.webgpu.js",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.webgpu.js",
    "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.tsl.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/"
  }
}
</script>
```

With npm or a bundler, install `three@0.185.1`; its package exports provide the same boundaries without an import map. [r185 package exports](https://github.com/mrdoob/three.js/blob/r185/package.json)

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
  geometry.dispose();
  material.dispose();
  scene.remove(mesh);
  renderer.dispose();
}
```

For continuous rendering, use `renderer.setAnimationLoop()`; it also supports WebXR. Update one `Timer` at frame start, then reuse its stable `getDelta()` and `getElapsed()` values. `Clock` is deprecated in Three.js 0.185.1. [Timer](https://threejs.org/docs/pages/Timer.html), [r182→r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)
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

Leave a host-owned canvas in place. Renderer disposal releases renderer resources; DOM removal is a separate ownership action. [r185 WebGLRenderer disposal](https://github.com/mrdoob/three.js/blob/r185/src/renderers/WebGLRenderer.js)

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

`ArrayCamera` subcamera viewports are drawing-buffer pixel rectangles, not normalized fractions. Recompute them after every renderer resize. [revision 185 array-camera example](https://github.com/mrdoob/three.js/blob/r185/examples/webgl_camera_array.html)

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

Use `CubeRenderTarget`, not `WebGLCubeRenderTarget`, with `WebGPURenderer` in Three.js 0.185.1. [CubeCamera](https://threejs.org/docs/pages/CubeCamera.html), [r182→r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)

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
- `updateWorldMatrix(updateParents, updateChildren, force)` gives explicit ancestor/descendant control. In Three.js 0.185.1 it honors `matrixWorldNeedsUpdate`. [Object3D](https://threejs.org/docs/pages/Object3D.html#updateWorldMatrix), [r184→r185](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185)

## Renderer output and color

- `renderer.outputColorSpace` already defaults to `THREE.SRGBColorSpace`; assigning it again is unnecessary.
- Lighting calculations use Linear-sRGB. `Color` stores Linear-sRGB working values; hex and CSS colors are interpreted as sRGB and converted automatically.
- `color.setRGB(r, g, b)` treats values as working-space components unless its optional source color space is supplied. Linear/HDR values may exceed 1.
- Mark color PNG/JPEG textures with `texture.colorSpace = THREE.SRGBColorSpace`; non-color/data maps generally retain `THREE.NoColorSpace`. Color HDR data such as EXR uses `THREE.LinearSRGBColorSpace`. Texture ownership belongs to the textures topic. [Color management](https://threejs.org/manual/en/color-management.html)
- `renderer.toneMapping = THREE.ACESFilmicToneMapping` is an artistic choice; Three.js 0.185.1 still defaults to `NoToneMapping`.
- Direct rendering to the screen applies renderer tone mapping and output-color-space conversion; ordinary offscreen render targets remain in their configured texture color space. A WebGL `EffectComposer` should end with `OutputPass` for final tone mapping and color conversion. [Color management](https://threejs.org/manual/en/color-management.html), [WebGLRenderer output](https://threejs.org/docs/pages/WebGLRenderer.html#outputColorSpace), [r154→r155](https://github.com/mrdoob/three.js/wiki/Migration-Guide#154--155), [revision 185 OutputPass](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/OutputPass.js#L74-L83)
- A WebGPU `RenderPipeline` normally leaves `outputColorTransform` enabled; disable it only when the pipeline graph explicitly adds `renderOutput()`. `preserveDrawingBuffer` is a WebGL-only renderer option and normally remains `false`; for a WebGL screenshot, render immediately before `canvas.toBlob()` or `toDataURL()`. [revision 185 RenderPipeline](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/RenderPipeline.js#L205-L218), [revision 185 WebGPURenderer options](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgpu/WebGPURenderer.js#L24-L35), [Screenshot guidance](https://threejs.org/manual/en/tips.html#taking-a-screenshot-of-the-canvas)

## Disposal and ownership

Stop producers before freeing consumers: clear the animation loop, cancel any queued on-demand frame, disconnect observers/listeners, then dispose `Timer` and controls. Dispose every owned geometry, material, texture, render target, and `Skeleton`; remove objects; finally dispose the renderer. Removing an `Object3D` does not dispose GPU resources, and disposing a material does not dispose its textures. Shared resources must be disposed exactly once by their owner. Asset-loading and textures topics define ownership at load boundaries. [Disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

## Render performance

- Measure draw calls with `renderer.info.render.calls` for WebGL or `renderer.info.render.drawCalls` for WebGPU, and triangles with `renderer.info.render.triangles` for either renderer; reset behavior changes if `renderer.info.autoReset` is disabled. [revision 185 WebGLInfo](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLInfo.js#L5-L16), [revision 185 common Info](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/Info.js#L44-L73)
- Reduce draw calls through instancing or deliberate geometry merging; keep material-count and update-cost tradeoffs visible.
- Keep frustum culling enabled. Ordinary object culling uses a bounding sphere; recompute it after vertex or instance bounds change. For vertex deformation performed only in a shader, enlarge the CPU bound or disable culling for that object. [revision 185 Frustum source](https://github.com/mrdoob/three.js/blob/r185/src/math/Frustum.js#L125-L147)
- Cap device pixel ratio when fill rate dominates; lower render-target resolution for expensive offscreen effects.
- Avoid per-frame allocations, forced whole-tree matrix updates, redundant world-space queries, and unconditional cube-map captures.
- Update static shadows portably per light: set `light.shadow.autoUpdate = false`, then set `light.shadow.needsUpdate = true` whenever that light's shadow must refresh. The equivalent `renderer.shadowMap` flags are WebGL-specific. `PCFShadowMap` is the soft WebGL default in Three.js 0.185.1; do not select deprecated `PCFSoftShadowMap`. [revision 185 common renderer](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/Renderer.js#L697-L709), [revision 185 ShadowNode](https://github.com/mrdoob/three.js/blob/r185/src/nodes/lighting/ShadowNode.js#L853-L874), [revision 185 WebGLShadowMap](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLShadowMap.js#L86-L95), [r181→r182](https://github.com/mrdoob/three.js/wiki/Migration-Guide#181--182)
- Use `LOD` only when its transition and memory costs are justified. Profile CPU traversal, upload bandwidth, draw calls, and fragment cost separately.

## Official sources

- [Three.js revision 185 source](https://github.com/mrdoob/three.js/tree/r185)
- [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Object3D](https://threejs.org/docs/pages/Object3D.html)
- [PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html), [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html), [ArrayCamera](https://threejs.org/docs/pages/ArrayCamera.html)
- [Responsive rendering](https://threejs.org/manual/en/responsive.html)
- [Migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
