# Performance — Three.js 0.186.1

## Measure a logical frame first

Keep camera, scene, viewport, backend, and quality settings fixed when comparing changes. Warm assets and pipelines first; separately record cold-load/first-use stalls. Sample representative interaction as well as an idle scene. Use browser performance tools to locate long tasks, allocation/GC spikes, uploads, and main-thread submission work; counters alone do not identify a bottleneck. Aggregate samples outside the hot path instead of logging every frame.

| Question | Measurement | Limitation |
| --- | --- | --- |
| Is interaction missing its frame budget? | Wall-clock interval between animation callbacks, summarized over many frames | Includes scheduling, tab throttling, other work, and GPU back-pressure; not GPU duration or guaranteed display cadence |
| Is application/submission work expensive? | `performance.now()` around synchronous update and submission | CPU-side elapsed time, including possible driver stalls; the GPU can still be executing afterward |
| How much GPU work was submitted? | Whole-frame draw/primitive counters | Not elapsed time, shaded pixels, visible pixels, or upload bytes |
| Is GPU execution expensive? | Supported asynchronous GPU timer queries or a GPU capture | Capability-dependent; excludes work outside the measured passes and does not measure presentation latency |
| Is resource ownership leaking? | Compare settled memory counters over repeated load/remove cycles | Counts and renderer estimates are not the process's actual VRAM allocation |

Use `renderer.setAnimationLoop()` for the application's loop, including XR. `THREE.Timer` supplies seconds for simulation: update it once per frame, connect it to `document` for visibility handling, and dispose it at teardown. Its delta is a measured interval, **not** a promise that callbacks are separated by at least one display refresh. Avoid mixing deprecated `Clock.getDelta()` and `getElapsedTime()`, which both advance its internal clock. Renderer/loop setup belongs to Core Rendering through the SKILL index. [r186 Timer](https://github.com/mrdoob/three.js/blob/r186/src/core/Timer.js), [r186 Clock](https://github.com/mrdoob/three.js/blob/r186/src/core/Clock.js), [r186 renderer animation](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Animation.js)

### Counters and reset boundaries

| Metric | `WebGLRenderer` | `WebGPURenderer`, including its WebGL 2 fallback |
| --- | --- | --- |
| Draw calls | `info.render.calls` | `info.render.drawCalls` |
| Primitives | `info.render.triangles`, `.lines`, `.points` | Same names |
| Render invocations/passes | Not a separate comparable counter | `info.render.frameCalls` for this frame; `info.render.calls` cumulative |
| Compute invocations | Not available | `info.compute.frameCalls` for this frame; `info.compute.calls` cumulative |
| Combined render/compute invocations | Not available | `info.calls` cumulative |
| Allocated resource counts | `info.memory.geometries`, `.textures`; `info.programs.length` for cached programs | `info.memory.geometries`, `.textures`, `.programs`, and other resource counts |
| Estimated bytes | Not available | `info.memory.total`, `.texturesSize`, `.attributesSize`, `.storageAttributesSize`, and other `*Size` fields |

With default `autoReset`, WebGL clears its render counters inside each `render()` before shadow drawing, so a later render can hide earlier work. The common renderer resets frame counters at its animation-loop tick, not at each `render()`. Its cumulative counters survive `info.reset()`. For comparable multi-pass measurements, disable automatic reset and reset once at the start of the **whole logical frame**, encompassing simulation, compute, picking, reflections, shadow updates, and the final post-processing pipeline. Sample after its last submission. Do not also render the scene separately when the post-processing pipeline already renders it. [r186 WebGLInfo](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLInfo.js), [r186 WebGL reset/shadows](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js#L1729-L1737), [r186 common Info](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Info.js), [r186 animation reset](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Animation.js#L69-L93)

This focused helper measures a **synchronous** logical-frame callback on either renderer. The caller owns counter resets during the call, passes an existing mutable `sample` object, and includes every desired pass in `submitFrame`. It allocates no sample per call, restores the reset policy even on error, and leaves the measured counters available. Do not overlap it with another renderer user or pass an async callback. Initialize a `WebGPURenderer` before calling it.

<!-- check: performance-logical-frame -->
```js
function measureLogicalFrame(renderer, submitFrame, sample) {
  const info = renderer.info;
  const previousAutoReset = info.autoReset;
  info.autoReset = false;
  info.reset();
  try {
    const start = performance.now();
    submitFrame();
    sample.cpuSubmitMs = performance.now() - start;
    sample.drawCalls = info.render.drawCalls ?? info.render.calls;
    sample.triangles = info.render.triangles;
    sample.lines = info.render.lines;
    sample.points = info.render.points;
    sample.geometries = info.memory.geometries;
    sample.textures = info.memory.textures;
    sample.estimatedBytes = info.memory.total ?? null;
    return sample;
  } finally {
    info.autoReset = previousAutoReset;
  }
}
```

For example, an existing loop can call `measureLogicalFrame(renderer, submitFrame, sample)`, where a stable `submitFrame` function updates the scene and renders its complete pipeline. Store or aggregate the returned fields without per-frame console output. For continuous manual ownership, keep `info.autoReset = false` and apply the same reset/submit/sample ordering once per frame; restore the previous policy when instrumentation detaches.

### GPU duration is optional and asynchronous

For `WebGPURenderer`, construct with `{ trackTimestamp: true }`, await `renderer.init()`, then check `renderer.hasFeature('timestamp-query')`. Native WebGPU needs the device's optional timestamp-query feature; the WebGL 2 fallback needs `EXT_disjoint_timer_query_webgl2`. This is **not** an option or method on `WebGLRenderer`. On that renderer, use a profiler or explicitly manage supported WebGL timer queries: poll availability asynchronously and reject disjoint results, never busy-wait or use `gl.finish()` as normal instrumentation. [r186 WebGPU timestamp enablement](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPUBackend.js), [r186 fallback feature mapping](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/utils/WebGLConstants.js), [WebGL timer-query specification](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)

For a controlled one-shot sample, use the helper below with a timestamp-enabled renderer, a stopped application loop, no other renderer users, and no unresolved earlier timestamp queries. `submitFrame` synchronously submits the render work; query resolution occurs afterward. Keep the renderer alive until the promise settles. A compute-only sample instead resolves `'compute'` after dispatching compute; the two query categories are separate.

<!-- check: performance-gpu-duration -->
```js
async function measureGpuRender(renderer, submitFrame) {
  await renderer.init();
  if (!renderer.hasFeature('timestamp-query')) return null;
  submitFrame();
  return await renderer.resolveTimestampsAsync('render');
}
```

The result is milliseconds of the measured GPU passes, not CPU time or callback interval. In r186 the query pools sum passes by renderer frame ID and return the last resolved frame's duration. They can return a previous value on failure/disjoint timing, or no value when no query exists; do not treat every resolution as a fresh, exact logical-frame sample. Production instrumentation must associate delayed samples carefully and bound outstanding requests. Do not await a readback in every animation callback or equate CPU submission time with GPU completion. [r186 resolution](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Backend.js#L598-L628), [r186 WebGPU query duration/last-frame selection](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/utils/WebGPUTimestampQueryPool.js), [r186 WebGL query availability/disjoint handling](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/utils/WebGLTimestampQueryPool.js)

## Diagnose before choosing an optimization

Change one factor, repeat the same workload, and compare both timings and counters. A lower counter is useful only if the constrained workload improves.

| Evidence or controlled experiment | Likely work to investigate | Appropriate next step |
| --- | --- | --- |
| Many small draws; CPU submission improves when objects/material groups are removed | Draw submission, sorting, material changes | Share materials; merge spatially local static geometry, instance repeats, or batch compatible geometry. Preserve culling granularity and measure updates/backend draw behavior. |
| Fewer triangles improve time with similar pixels/calls | Geometry/vertex work, skinning, uploads | Reduce tessellation, use suitable LODs, simplify distant meshes, and avoid unnecessary attribute uploads. LOD levels retain their geometry in memory and do not inherently reduce draw calls. |
| Main-thread trace dominated by animation, picking, transforms, allocations, or GC | Application CPU work | Narrow updates/picking, reuse scratch objects, and opt static objects out of automatic local-matrix composition. |
| Lower drawing-buffer resolution improves time while calls/triangles stay similar | Fragment cost, bandwidth, overdraw, full-screen passes | Reduce pixel ratio/effect target resolution; simplify expensive materials and stacked transparency. |
| Disabling a shadow light/update improves time and calls | Shadow caster submissions, shadow-map fill/filtering | Reduce casting lights/casters, tighten the shadow camera, budget map size, and invalidate static shadows explicitly. |
| Spikes on first view or when material/light features change | Shader/pipeline compilation, texture upload, lazy resource creation | Precompile representative variants, load/decode assets before interaction, and avoid repeatedly rebuilding material features. |
| Counts or estimated bytes climb across settled load/unload cycles | Retained/shared resources or incomplete teardown | Audit ownership, listeners, async producers, and disposal rather than lowering polygon count blindly. |

### Draws, bounds, and visibility

A mesh is not a reliable unit of draw cost: material groups, double-sided transparent rendering, transmission captures, shadow passes, cube captures, and post-processing can multiply draws. In WebGL, transparent `DoubleSide` materials normally render back and front separately; `forceSinglePass` is a visual tradeoff, not a universal optimization. Transmission can introduce another opaque-scene capture. Inspect the actual frame rather than applying a fixed “one object, one call” rule. Detailed merge, `InstancedMesh`, `BatchedMesh`, and LOD recipes belong to Geometry through the SKILL index; do not assume batching means one hardware draw on every backend. [r186 WebGL material passes/transmission](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js), [r186 Material.forceSinglePass](https://github.com/mrdoob/three.js/blob/r186/src/materials/Material.js)

Keep frustum culling enabled. Recompute CPU bounds after vertex or instance-transform edits; organize large merged/instanced populations into useful spatial clusters. For shader displacement, provide a conservative bound if supported, otherwise disable culling only on the affected renderable. Disabling culling scene-wide hides a bounds bug at the cost of submitting invisible work. Culling does not automatically stop animation or simulation. Core Rendering and Geometry through the SKILL index describe the r186 object-level culling contract.

### CPU work and static matrices

Reuse vectors, matrices, typed arrays, and raycast-result arrays instead of creating them in the hot loop. Profile before reducing update frequency. Raycast an explicit pickable list with recursion off when appropriate, filter by layers before geometry tests, and coalesce pointer events to the application's update cadence. Layers do not prune an entire descendant tree: an explicit candidate list avoids visiting irrelevant objects. Optional third-party `three-mesh-bvh` can accelerate suitable geometry's triangle tests; it is not part of Three.js. Interaction through the SKILL index owns picking setup and accelerated-raycast integration. [r186 Raycaster traversal](https://github.com/mrdoob/three.js/blob/r186/src/core/Raycaster.js)

Disable local matrix composition only for objects whose transform updates the application will own. This does **not** disable scene traversal or guarantee that world matrices stop changing: a moving parent still changes its children's world transforms. Do not globally disable `matrixWorldAutoUpdate` as a substitute.

<!-- check: performance-static-matrix -->
```js
function freezeLocalTransform(object) {
  object.updateMatrix();
  object.matrixAutoUpdate = false;
}

function moveManualTransform(object, x, y, z) {
  object.position.set(x, y, z);
  object.updateMatrix(); // recomposes the local matrix and invalidates its world matrix
}
```

Apply `freezeLocalTransform()` after placing static scenery. Every later position/quaternion/scale edit needs `updateMatrix()`, or restore `matrixAutoUpdate = true` before animation takes ownership. Direct matrix writes require explicit world-matrix invalidation; Core Rendering through the SKILL index owns that contract. [r186 Object3D matrix updates](https://github.com/mrdoob/three.js/blob/r186/src/core/Object3D.js)

### Fill, effects, and shadows

Drawing-buffer area grows with pixel ratio squared; a high-DPI display is not an automatic quality requirement. Choose a measured pixel-ratio cap and keep resize handling consistent with effect targets. Counts do not reveal fragment-shader complexity or transparent overdraw. Prefer opaque surfaces when visually equivalent; stacked transparent quads and large particles still shade overlapping pixels. Post-processing through the SKILL index owns target resolution, MSAA, pass topology, and final color conversion. [Drawing-buffer sizing](https://threejs.org/manual/en/responsive.html)

Shadow maps add caster draws and texture/filtering work. Point-light shadow coverage can require multiple cube faces; VSM adds receiver/filtering costs in WebGL. Tighten directional/spot shadow coverage rather than only raising map resolution. For static shadows, set `light.shadow.autoUpdate = false` and set `light.shadow.needsUpdate = true` after relevant caster, light, or shadow-camera changes. This per-light policy works with both renderer families; equivalent `renderer.shadowMap.autoUpdate/needsUpdate` flags are WebGL-only. Keep r186 `PCFShadowMap` rather than deprecated `PCFSoftShadowMap`. Lighting and Shadows through the SKILL index owns complete setup. [r186 WebGL shadows](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLShadowMap.js), [r186 common-renderer ShadowNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/lighting/ShadowNode.js)

## Memory and texture budgets

`memory.geometries` and `memory.textures` are renderer-maintained allocation counts, not bytes, meshes, or a count of CPU objects. Shared resources, internal targets/caches, and texture source/configuration reuse affect these counts. Material disposal does not dispose its textures. An object removed from the scene still needs ownership-aware resource retirement; blindly disposing every texture on every material can break remaining users. A still-rendered disposed resource can be created again. Core Rendering and Asset Loading through the SKILL index own teardown and shared-resource rules. [r186 WebGL geometry accounting](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLGeometries.js), [r186 WebGL texture accounting](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLTextures.js), [Disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

Common-renderer `memory.total` and `*Size` values are **estimates**, not authoritative VRAM usage. In particular, r186 `Info` assigns a compressed texture a fallback size of **one byte**; its total can substantially under-report compressed assets. Compare known allocations and their lifetimes, not this total alone. [r186 Info byte estimates](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Info.js#L449-L508)

Budget texture dimensions, format, mip levels, layers/cube faces, environment maps, depth attachments, render targets, and MSAA together. Download size is not GPU size: PNG/JPEG generally expand on upload; supported KTX2/Basis assets can retain block compression, with format-dependent fallback. Prefer source resolution matched to projected detail and measure memory after the full pipeline is initialized. Textures and Render Targets through the SKILL index owns byte formulas, color-versus-data color spaces, KTX2 transcoder setup/support detection, and disposal; Asset Pipeline owns offline conversion. Do not override a KTX2 color-space tag blindly. [r186 KTX2Loader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/KTX2Loader.js)

## First-use stalls and warmup

Finish configuring lights, environment, fog, materials, targets, and relevant renderer settings before `await renderer.compileAsync(scene, camera)`. Use its optional target scene when compiling an incoming subtree for an existing scene. On WebGL this uses `KHR_parallel_shader_compile` when available; without it, asynchronous completion does **not** guarantee a stall-free first render. `compile()` alone is not an equivalent readiness barrier. Shadow/depth variants, texture uploads, and paths not exercised by this compile can still need a controlled warmup render; keep that work outside interactive timing and do not flash it on screen. Common-renderer compilation also depends on the chosen output/target context. [r186 WebGL compileAsync](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js#L1498-L1578), [r186 non-parallel program readiness](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLProgram.js#L992-L1005), [r186 common compileAsync](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js)

Avoid toggling shader-defining material features in the frame loop. Reuse materials where visual semantics match; update uniform values rather than rebuilding graphs. Set `material.needsUpdate = true` when a documented feature change requires it, then accept or schedule the resulting variant compilation. Materials and Shaders/TSL through the SKILL index own feature invalidation and backend restrictions. Precompile completed TSL kernels with `await renderer.compileComputeAsync(kernel)` before interactive dispatch; compilation does not execute the kernel. [r186 compute compilation](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js)

## Bounded GPU particle work

Compute is useful when profiling identifies a large independent update/upload workload. It does not make particles free: dispatch, storage, rendering, transparency, and readback still cost work. Fix a particle budget and keep results GPU-resident when possible. `WebGPURenderer` supports TSL compute on native WebGPU and a restricted WebGL 2 transform-feedback fallback; independent per-element writes below fit both, but workgroup synchronization, atomics, and storage textures require separate backend checks. `WebGLRenderer` instead uses the distinct `GPUComputationRenderer` texture/ping-pong workflow; Shaders/TSL through the SKILL index owns that API. [r186 fallback compute](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/WebGLBackend.js), [r186 compute/storage factories](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/Arrays.js)

This factory owns a fixed-size storage buffer, kernel, material, and cloned sprite geometry, not the renderer or scene. Await it before attaching `particles`; then call `update()` before the existing loop's render. Positions are in the sprite's **local space**; its transform places the bounded system in the world. Color components are Linear-sRGB working values. CPU culling cannot see GPU-written positions, so culling is disabled for this one system; keep its population/spatial extent bounded. The built-in `time` node supplies elapsed seconds without a second timer or a CPU particle loop.

TSL's built-in `time` and `deltaTime` nodes are renderer-updated uniforms in seconds; use them instead of maintaining duplicate timer-fed uniforms when their semantics fit the simulation. [r186 TSL time uniforms](https://github.com/mrdoob/three.js/blob/r186/src/nodes/utils/Timer.js)

<!-- check: performance-compute-particles -->
```js
import * as THREE from 'three/webgpu';
import { Fn, cos, hash, instanceIndex, instancedArray, sin, time, TWO_PI, vec2, vec3 } from 'three/tsl';

async function createComputeParticles(renderer) {
  await renderer.init();
  const count = 4096;
  const positions = instancedArray(count, 'vec3');
  const kernel = Fn(() => {
    const seed = hash(instanceIndex);
    const angle = seed.mul(TWO_PI).add(time);
    positions.element(instanceIndex).assign(vec3(
      cos(angle).mul(4),
      sin(seed.mul(97).add(time)).mul(2),
      sin(angle).mul(4),
    ));
  })().compute(count);
  const material = new THREE.SpriteNodeMaterial();
  material.positionNode = positions.toAttribute();
  material.colorNode = vec3(1, 0.5, 0.1);
  material.scaleNode = vec2(0.05); // particle size without shrinking the position offsets
  const particles = new THREE.Sprite(material);
  particles.geometry = particles.geometry.clone(); // default Sprite geometry is shared
  particles.count = count;
  particles.frustumCulled = false;

  function dispose() {
    particles.removeFromParent();
    particles.dispose();
    material.dispose();
    particles.geometry.dispose();
    kernel.dispose();
    positions.value.dispose();
  }

  try {
    await renderer.compileComputeAsync(kernel);
    renderer.compute(kernel); // initialize positions before the first draw
    return { particles, update() { renderer.compute(kernel); }, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
```

Sprite object scale also scales local position offsets; `material.scaleNode` above controls particle size independently. After attachment, precompile the scene's draw materials as needed. This example avoids downloading particle positions; CPU reads of the attribute array do not retrieve GPU writes. If CPU results are required, await `renderer.getArrayBufferAsync(positions.value)` and account for transfer/synchronization overhead rather than adding per-frame readbacks casually. [r186 SpriteNodeMaterial position/scale](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/SpriteNodeMaterial.js), [r186 Sprite shared geometry/count](https://github.com/mrdoob/three.js/blob/r186/src/objects/Sprite.js), [r186 renderer readback](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js)

Stop calling `update()`, remove draw consumers, and settle any outstanding readbacks before `dispose()`; do not dispose this factory's renderer. Its owner eventually awaits common-renderer `renderer.dispose()` after all renderer users retire. Kernel and storage disposal are separate responsibilities. [r186 ComputeNode disposal](https://github.com/mrdoob/three.js/blob/r186/src/nodes/gpgpu/ComputeNode.js), [r186 BufferAttribute disposal](https://github.com/mrdoob/three.js/blob/r186/src/core/BufferAttribute.js), [r186 renderer disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js)
