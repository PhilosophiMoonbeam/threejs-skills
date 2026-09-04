---
name: threejs
description: Builds, debugs, migrates, and optimizes Three.js 0.185.1 applications across WebGL and WebGPU rendering, scene setup, geometry, materials, lighting and shadows, textures and render targets, animation, asset loading, interaction and controls, shaders and TSL, post-processing, color management, disposal, and performance. Use when implementing or reviewing Three.js code or upgrading older Three.js code to 0.185.1.
metadata:
  threejs-version: "0.185.1"
---

# Three.js 0.185.1

## Scope and version contract

- Target exactly npm `three@0.185.1`. This package reports `THREE.REVISION === "185"` and uses the official [revision 185 source tag](https://github.com/mrdoob/three.js/tree/r185).
- Pin core, addons, examples, and copied shader chunks to the same revision. Never combine files from different Three.js releases.
- Treat the current online documentation and [`llms.txt`](https://threejs.org/docs/llms.txt) as conceptual guidance; their examples may target a different release than this pinned package. For exact APIs and import paths, verify against the [revision 185 tagged source](https://github.com/mrdoob/three.js/tree/r185) and `three@0.185.1` package exports: [revision 185 `package.json`](https://github.com/mrdoob/three.js/blob/r185/package.json).
- Do not introduce an API first added after revision 185. Route code written for another revision through the migration reference before adapting it.
- Use Three.js core and official addons as Three.js APIs. Label every external engine, wrapper, control, loader, or effect as third-party.

## Task workflow

1. Inspect the package lock, import map, or CDN URLs and the existing renderer. For an unknown or different revision, read the migration reference before adapting code; identify the mismatch without silently upgrading a dependency.
2. Match the work to the request:
   - **New application:** choose WebGL or WebGPU, one module-loading strategy, scene units, asset inputs, and lifecycle ownership. Start from the core-rendering baseline.
   - **Existing application:** preserve its renderer, architecture, and lifecycle; change only the relevant subsystem. Inspect shared consumers before changing ownership or state.
   - **Migration:** establish source and target revisions, apply intervening deltas, and compare affected behavior and visuals.
3. Read the smallest set of references selected below. Return to this index when another domain is needed.
4. Exercise the affected surface: frame output and console, plus resize, interaction, async failure/cancellation, or teardown where the change touches them. Measure before optimizing.

## Canonical imports and renderer choice

Use package exports, not repository internals:

```js
// WebGL application core
import * as THREE from 'three';

// Official addon; keep the .js suffix
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
```

For a WebGPU/TSL application, use the dedicated `three@0.185.1` exports:

```js
import * as THREE from 'three/webgpu';
import { color, pass, vec3 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
```

TSL custom materials use node classes such as `MeshBasicNodeMaterial`, `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, `LineBasicNodeMaterial`, and `SpriteNodeMaterial`, exported by `three/webgpu`; do not substitute WebGL GLSL materials for them. [r185 node-material exports](https://github.com/mrdoob/three.js/blob/r185/src/materials/nodes/NodeMaterials.js)

These entry points and the `three/addons/*` mapping are defined by the [`three@0.185.1` package exports](https://github.com/mrdoob/three.js/blob/r185/package.json); the WebGPU surface is listed in [revision 185 `Three.WebGPU.js`](https://github.com/mrdoob/three.js/blob/r185/src/Three.WebGPU.js).

Choose once per rendering pipeline:

- Choose `WebGLRenderer` by default for conventional WebGL 2 applications, GLSL `ShaderMaterial`/`RawShaderMaterial`, or the WebGL `EffectComposer` addon pipeline.
- Choose `WebGPURenderer` when requirements depend on TSL/node materials, compute, or the WebGPU post-processing pipeline. `setAnimationLoop()` initializes it before its first frame; for on-demand rendering or synchronous backend-dependent calls, `await renderer.init()` first. [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)
- If actual WebGPU is required, check `WebGPU.isAvailable()` from `three/addons/capabilities/WebGPU.js` and provide a deliberate fallback or unsupported-path error. `WebGPURenderer` can fall back to WebGL 2, which is not universal feature parity. [WebGPU capability check](https://threejs.org/docs/pages/WebGPU.html)
- Verify every material, texture format, pass, shader path, and capability against the chosen renderer; do not assume feature parity.
- Do not deep-import `three/src/...` or `three/examples/jsm/...`. Use `three`, `three/webgpu`, `three/tsl`, and `three/addons/...` only.
- Do not mix CDN origins or versions. Map every selected core, WebGPU/TSL, and addon entry to the same `0.185.1` distribution.

## Reference index

Read the smallest set that owns the requested work. Return here to route an additional topic; references are not a chain.

| Task signal | Read |
|---|---|
| new application, npm/CDN setup, import maps, scene, camera, renderer, scene graph, transforms, responsive sizing, render loop, rendering on demand, disposal, WebGPU availability or backend capabilities | [core rendering](references/core-rendering.md) |
| primitives, `BufferGeometry`, attributes, morph data, lines, points, instancing | [geometry](references/geometry.md) |
| built-in or PBR materials, transparency, blending, environment response | [materials](references/materials.md) |
| lights, physically based intensity, shadows, IBL, `RectAreaLight`, `RectAreaLightUniformsLib`, `RectAreaLightTexturesLib`, or LTC initialization, helpers | [lighting and shadows](references/lighting-and-shadows.md) |
| color or data textures, UV channels, HDR, PMREM, render or depth targets | [textures and render targets](references/textures-and-render-targets.md) |
| loading manager, `loadAsync`, cancellation, late results, GLTF/GLB, Draco, KTX2, other formats, and cleanup | [asset loading](references/asset-loading.md) |
| clips, tracks, mixers, actions, skeletal animation, morph animation | [animation](references/animation.md) |
| raycasting, pointer coordinates, selection, controls, event cleanup | [interaction and controls](references/interaction-and-controls.md) |
| `ShaderMaterial`, `RawShaderMaterial`, GLSL, TSL/nodes, `NodeMaterial`, compute, extension boundaries | [shaders and TSL](references/shaders-and-tsl.md) |
| `EffectComposer`, passes, WebGPU post-processing, resize, pass ordering | [post-processing](references/post-processing.md) |
| old code, deprecated names, removed APIs, revision upgrade | [0.185.1 migration](references/0.185.1-migration.md) |

## Cross-domain invariants

- **One revision:** resolve all core and addon imports from the same `three@0.185.1` package. A duplicate Three.js instance is a defect, not a workaround.
- **One renderer contract:** renderer selection governs materials, shader language, post-processing, render targets, and capability checks.
- **Explicit spaces:** distinguish local, world, view, clip, normalized-device, screen, tangent, and texture coordinates. Update world matrices before queries that depend on them.
- **Consistent units:** choose a world-unit scale and apply it to models, cameras, lights, physics data, movement, and clipping planes.
- **Color semantics:** identify color textures versus non-color data. Assign color spaces at ingestion and let one output stage own display conversion and tone mapping.
- **Resource readiness:** loading is asynchronous. Do not render, animate, raycast, or dispose a resource as though it were ready until its promise or manager state says so.
- **Size agreement:** keep CSS display size, drawing-buffer size, camera projection, pixel ratio, render targets, composers, and picking coordinates synchronized.
- **Ownership:** record who creates, shares, and disposes geometries, materials, textures, render targets, mixers, controls, passes, listeners, timers, workers, and the renderer. Dispose each owned GPU resource exactly once after its last user.
- **Stable frames:** reuse vectors, matrices, rays, arrays, and uniform containers in hot paths. Do not allocate, load, compile, or attach listeners per frame.
- **Bounded GPU work:** cap pixel ratio deliberately; bound shadow maps, lights, draw calls, texture memory, samples, and post-processing passes against a measured budget.
- **Feature evidence:** test the actual renderer/backend capability before enabling optional formats or effects. Provide an intentional fallback or a clear unsupported-path error.
- **Lifecycle symmetry:** every animation loop, observer, event listener, control, async request, and DOM node added by setup has a teardown action.

## Debugging order

Stop at the first failing layer; do not tune later layers to hide it.

1. **Import/runtime:** confirm `three@0.185.1` resolution, one Three.js instance, valid addon paths, no thrown error, and a live canvas/context.
2. **Camera/frustum:** confirm finite camera values, aspect, near/far ordering, pose, layers, viewport, and that the subject lies inside the frustum.
3. **Transforms/matrices:** confirm parent transforms, units, matrix updates, coordinate-space conversions, bounds, winding, and normals.
4. **Material/light state:** replace complexity with an unlit diagnostic material; then restore lights, shadow settings, transparency, depth, and culling deliberately.
5. **Color/output:** inspect texture color spaces, HDR range, environment preparation, tone mapping, exposure, and the single output conversion stage.
6. **Resource readiness:** verify URLs, network/CORS, decoder configuration, promises, dimensions, UV channels, animation bindings, and disposal timing.
7. **Shader/pipeline:** reduce to the smallest material or pass; inspect compile diagnostics, node/GLSL compatibility, uniforms, attachments, and pass order.
8. **GPU cost:** measure draw calls, triangles, texture/render-target memory, shader compilation, overdraw, shadows, pixel ratio, and pass timings before optimizing.

## Migration rule

Whenever code, generated advice, an example, or a dependency targets an unknown revision or anything other than 0.185.1, read the 0.185.1 migration reference in the index before implementation. Identify the source revision, apply each intervening migration delta, replace removed APIs rather than aliasing them, and re-check the result against the [official migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) and [revision 185 source](https://github.com/mrdoob/three.js/tree/r185).

## Official sources

- [Three.js documentation](https://threejs.org/docs/)
- [Three.js LLM index](https://threejs.org/docs/llms.txt)
- [Three.js manual](https://threejs.org/manual/)
- [Three.js revision 185 tagged source](https://github.com/mrdoob/three.js/tree/r185)
- [Three.js revision 185 package exports](https://github.com/mrdoob/three.js/blob/r185/package.json)
- [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
