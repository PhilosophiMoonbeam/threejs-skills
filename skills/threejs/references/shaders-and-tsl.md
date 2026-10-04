# Shaders and TSL — Three.js 0.186.1

## Scope

This reference owns custom WebGL shaders, built-in material patching, shader coordinate spaces, output conversion, and the boundary to TSL/WebGPU compute.
For textures as resources, render-target setup, or post-processing graph design, use those named topics instead.
All APIs and engine internals below target npm `three@0.186.1` (r186) exactly.

## Choose the renderer path first

- `ShaderMaterial` and `RawShaderMaterial` are `WebGLRenderer` materials.
- Prefer `ShaderMaterial` when Three.js declarations, attributes, precision, defines, and chunk helpers are useful.
- Prefer `RawShaderMaterial` only when every GLSL declaration and interface should be explicit.
- For new WebGPU-capable or renderer-agnostic shader work, use NodeMaterial and TSL, not either GLSL material.
- `WebGLRenderer` requires WebGL 2 in 0.186.1. Its shader program is GLSL ES 3.00 even when a non-raw `ShaderMaterial` uses legacy source spellings through compatibility macros.
- Set `glslVersion`; never put `#version` inside shader source.

Official GLSL basis: [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html), [ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html), and [r186 WebGLProgram conversion](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLProgram.js).

## NodeMaterial and TSL selection

Use the closest built-in node material rather than the base `NodeMaterial` when a material model is already a fit:

- `MeshBasicNodeMaterial` — unlit mesh color, maps, and environment response.
- `MeshStandardNodeMaterial` — metalness/roughness PBR.
- `MeshPhysicalNodeMaterial` — Standard plus physical extensions such as clearcoat, transmission, and sheen.
- `LineBasicNodeMaterial` — line primitives.
- `SpriteNodeMaterial` — sprites and their screen-facing quad behavior.

These classes are exported by `three/webgpu` in 0.186.1. Import TSL functions from `three/tsl`, not node-material classes. `WebGPURenderer` emits backend shaders for native WebGPU or its WebGL 2 fallback. Separately, r186 adds a `WebGLNodesHandler` bridge for `WebGLRenderer`; this does not give that renderer compute or the WebGPU post-processing stack. [r186 node-material exports](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/NodeMaterials.js), [r186 bridge limits](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/WebGLNodesHandler.js)

Classic `ShaderMaterial` and `RawShaderMaterial` remain the WebGL GLSL path; do not mix their shader strings into a TSL graph.

### Node materials on WebGLRenderer

Install one handler before compiling or rendering node materials. No separate node library setup is required: the addon installs its `BasicNodeLibrary` through its renderer proxy. This factory owns only its material; the caller owns the renderer, geometry, scene membership, and loop.

<!-- check: tsl-webgl-bridge -->
```js
import { WebGLNodesHandler } from 'three/addons/tsl/WebGLNodesHandler.js';
import { MeshBasicNodeMaterial, Color } from 'three/webgpu';
import { uniform } from 'three/tsl';

function createWebGLNodeMaterial(renderer) {
  renderer.setNodesHandler(new WebGLNodesHandler());
  const phase = uniform(0);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = uniform(new Color(0x3b82f6))
    .mul(phase.sin().mul(0.25).add(0.75));
  return {
    material,
    update(elapsedSeconds) { phase.value = elapsedSeconds; },
    dispose() { material.dispose(); },
  };
}
```

Use an existing `WebGLRenderer` imported from `three`; attach the material to a mesh and update the uniform from the existing loop. This factory installs the handler once per renderer setup, not once per mesh or frame. Remove consumers before material disposal; the handler releases its cached uniform groups on the material's `dispose` event. It has no separate public `dispose()` method.

The bridge does not support VSM shadows, MRT, transmission, storage textures, or the WebGPU post-processing stack. Do not share geometry between instanced meshes on this path. Treat fog/environment changes as requiring the documented disposal/rebuild path, not automatic parity. Keep WebGL `EffectComposer` for post-processing and `GPUComputationRenderer` for texture computation. These restrictions do not describe `WebGPURenderer({ forceWebGL: true })`, which is a different renderer/backend path. [r186 handler setup, limits, and material disposal](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/WebGLNodesHandler.js), [r186 setNodesHandler](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js)

## Minimal TSL material

Use this with an existing `WebGPURenderer` scene. The caller attaches the returned material, calls `update(elapsedSeconds)` from its existing loop, and removes all consumers before `dispose()`. Build the graph once; change uniform values during animation.

<!-- check: tsl-material -->
```js
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

function createPulseMaterial() {
  const phase = uniform(0);
  const tint = uniform(new THREE.Color(0x3b82f6)); // Linear-sRGB working value.
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = tint.mul(phase.sin().mul(0.25).add(0.75));
  return {
    material,
    update(elapsedSeconds) { phase.value = elapsedSeconds; },
    dispose() { material.dispose(); },
  };
}
```

`colorNode` supplies linear surface color; leave display conversion to the renderer or final pipeline. TSL operations construct a shader graph; JavaScript arithmetic on node objects does not become shader arithmetic. Inside `Fn`, use node assignment methods and TSL control flow such as `If` for GPU-dependent branches. [r186 UniformNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/UniformNode.js), [r186 NodeMaterial](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/NodeMaterial.js), [r186 TSL flow](https://github.com/mrdoob/three.js/blob/r186/src/nodes/tsl/TSLCore.js)

## Minimal direct-screen ShaderMaterial

This explicit GLSL3 form uses a time uniform, keeps calculations linear, and applies display transforms once:

```js
import * as THREE from 'three';

const timer = new THREE.Timer();

const material = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x3b82f6) },
  },
  vertexShader: `
    out vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform vec3 uColor;
    in vec2 vUv;
    layout(location = 0) out vec4 outColor;
    #define gl_FragColor outColor
    void main() {
      float pulse = 0.75 + 0.25 * sin(uTime + vUv.x * 6.2831853);
      gl_FragColor = vec4(uColor * pulse, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});

// In the renderer loop; update the timer once, then mutate the existing uniform value.
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  material.uniforms.uTime.value = timer.getElapsed();
  renderer.render(scene, camera);
});
```

`THREE.Color` values are interpreted in the working Linear-sRGB space. The last two chunks are for a shader rendered directly to the canvas. Omit them when writing an intermediate render target that a later `OutputPass` will tone-map and convert; applying both paths double-transforms the image. See [Color management](https://threejs.org/manual/en/color-management.html) and [r186 built-in output order](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderLib/meshbasic.glsl.js).

## GLSL source forms

For non-raw `ShaderMaterial`, the default source form may use `attribute`, `varying`, `texture2D`, `textureCube`, and `gl_FragColor`; 0.186.1 supplies compatibility macros. With `glslVersion: THREE.GLSL3`, use `in`/`out`, `texture`, `textureSize`, and a declared fragment output. The `#define gl_FragColor outColor` above lets 0.186.1 output chunks target that declared GLSL3 output.

`RawShaderMaterial` receives no prepended declarations or compatibility macros. A valid GLSL3 raw vertex shader therefore declares precision, inputs, and renderer-owned matrices:

```js
const raw = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: `
    precision highp float;
    in vec3 position;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    layout(location = 0) out vec4 outColor;
    void main() { outColor = vec4(1.0); }
  `,
});
```

Declare `modelMatrix`, `modelViewMatrix`, `projectionMatrix`, or `normalMatrix` as needed, but do not duplicate them in the JS `uniforms` object: `WebGLRenderer` uploads recognized per-camera and per-object values. Raw shaders also receive no automatic output-transform helpers; implement the required conversion explicitly, or use them only for intermediate linear output. See [RawShaderMaterial](https://threejs.org/docs/pages/RawShaderMaterial.html) and [r186 matrix uploads](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js).

## Uniforms, varyings, and spaces

- Uniform entries have the shape `{ value }`; GLSL names and types must match. Reuse entries and mutate `Vector*`, `Matrix*`, and `Color` values instead of allocating each frame.
- `transparent` changes classification and blending; it does not make arbitrary GLSL consume `material.opacity`. Declare and use an opacity uniform, and enable transparency only when needed.
- Vertex outputs and fragment inputs must match. In GLSL3, integer varyings require `flat` interpolation.
- Normalize interpolated directions and normals in the fragment stage; vertex normalization does not survive interpolation.
- Local/object space uses geometry attributes. `modelMatrix` reaches world space; `modelViewMatrix` reaches view space; `projectionMatrix` reaches clip space. Divide clip `xyz` by `w` for NDC.
- Transform normals with `normalMatrix`, not `mat3(modelMatrix)`, especially under non-uniform scale.

A view-space Fresnel term keeps its normal and view direction in one space:

```glsl
// vertex
out vec3 vViewPosition;
out vec3 vViewNormal;
vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
vViewPosition = mvPosition.xyz;
vViewNormal = normalMatrix * normal;
gl_Position = projectionMatrix * mvPosition;

// fragment
vec3 N = normalize(vViewNormal);
vec3 V = normalize(-vViewPosition);
float fresnel = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 3.0);
```

Do not combine view-space `normalMatrix * normal` with world-space `cameraPosition - worldPosition`. See [Matrix3.getNormalMatrix](https://threejs.org/docs/pages/Matrix3.html#getNormalMatrix) and [r186 packing helpers](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/packing.glsl.js).

## Textures and color roles

```js
colorTexture.colorSpace = THREE.SRGBColorSpace; // PNG/JPEG base color or emissive
normalTexture.colorSpace = THREE.NoColorSpace;  // normal/roughness/metalness/depth/noise
colorTexture.updateMatrix();
material.uniforms.uMap.value = colorTexture;
material.uniforms.uMapTransform.value = colorTexture.matrix;
```

Apply transforms explicitly in the vertex shader: `vUv = (uMapTransform * vec3(uv, 1.0)).xy;`. Copying `vUv = uv` ignores `Texture.offset`, `repeat`, `rotation`, and `center`. Sample with `texture(uMap, vUv)` in explicit GLSL3. Decode color textures according to `Texture.colorSpace`, keep data textures untagged, calculate lighting in linear space, then perform the single final output conversion. See [Texture.colorSpace and matrix](https://threejs.org/docs/pages/Texture.html#colorSpace).

## Safe `onBeforeCompile` patches

`onBeforeCompile` customizes `WebGLRenderer` built-in materials only. Patch a verified 0.186.1 anchor, assert that it occurs exactly once, and retain the compiled uniform reference outside `userData` when serialization matters:

```js
const tint = new THREE.Color(0xff8844);
let compiledShader;
const material = new THREE.MeshStandardMaterial();
material.onBeforeCompile = (shader) => {
  const anchor = '#include <color_fragment>';
  if (shader.fragmentShader.split(anchor).length !== 2) throw new Error('0.186.1 shader anchor changed');
  shader.uniforms.uTint = { value: tint };
  shader.fragmentShader = `uniform vec3 uTint;
${shader.fragmentShader.replace(
    anchor,
    `${anchor}\ndiffuseColor.rgb *= uTint;`,
  )}`;
  compiledShader = shader;
};
```

Uniform-only changes (`tint.set(...)`) do not require recompilation. If generated source depends on closure configuration, make `customProgramCacheKey()` return a stable key containing every compile-time variant, and set `material.needsUpdate = true` when the variant changes. The default cache key uses `onBeforeCompile.toString()` and cannot see mutable closure state. See [Material.onBeforeCompile and customProgramCacheKey](https://threejs.org/docs/pages/Material.html#onBeforeCompile).

Position deformation at `begin_vertex` must also update the corresponding object-space normal before the normal pipeline, or lighting will be wrong. Use a defensible normal reconstruction, or TSL/NodeMaterial. Do not silently accept unchanged normals.

## 0.186.1 chunks and migration traps

Chunks are renderer implementation details, not a stable public composition API. Useful verified 0.186.1 stages include `beginnormal_vertex`, `begin_vertex`, `defaultnormal_vertex`, `project_vertex`, `normal_fragment_begin`, `map_fragment`, `opaque_fragment`, `tonemapping_fragment`, and `colorspace_fragment`; preserve the dependencies and order used by the matching 0.186.1 `ShaderLib` shader.

- `encodings_fragment` became `colorspace_fragment` in r154.
- `output_fragment` became `opaque_fragment` in r154; `opaque_fragment` is not the final display transform.
- `lightmap_fragment` was removed in r164.
- Replace deprecated `inverseTransformDirection()` with `transformNormalByInverseViewMatrix()` for normals or `transformDirectionByInverseViewMatrix()` for directions.
- Do not use obsolete `extensions.derivatives`, `fragDepth`, `drawBuffers`, or `shaderTextureLOD`. WebGL 2 provides derivatives, `gl_FragDepth`, declared MRT outputs, and `textureLod`; 0.186.1 `ShaderMaterial.extensions` exposes only `clipCullDistance` and `multiDraw`.

Sources: [r153→r154](https://github.com/mrdoob/three.js/wiki/Migration-Guide#153--154), [r163→r164](https://github.com/mrdoob/three.js/wiki/Migration-Guide#163--r164), [r184→r185](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185), and [r186 ShaderMaterial source](https://github.com/mrdoob/three.js/blob/r186/src/materials/ShaderMaterial.js).

## TSL, WebGPU, and compute boundary

Import renderer-facing node classes from `three/webgpu` and functions from `three/tsl`. Assign hooks such as `colorNode`, `positionNode`, or `normalNode`; let the node system emit backend code. Use `packNormalToRGB()`/`unpackRGBToNormal()`, not the old direction/color helpers. In `material.positionNode`, use `positionGeometry` for the original geometry attribute; do not assume `positionLocal` carries prior morphing, skinning, batching, or instancing updates into the separately built hook. Explicitly compose required transforms. Outside that hook, `positionLocal` represents the transformed local-position pipeline. [Historical r184→r185 delta](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185), [r186 position setup](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/NodeMaterial.js), [r186 position nodes](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/Position.js)

For WebGL fragment-texture computation, import `GPUComputationRenderer` from `three/addons/misc/GPUComputationRenderer.js`; it manages float RGBA variables, dependencies, and ping-pong render targets. For WebGPU-capable compute, use TSL compute/storage nodes with `WebGPURenderer`. `setAnimationLoop()` initializes the renderer before the loop callback; for on-demand compute, call `await renderer.init()` before synchronous `renderer.compute(computeNode)` (or use `computeAsync()`). See [GPUComputationRenderer](https://threejs.org/docs/pages/GPUComputationRenderer.html), [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html), [Renderer.compute](https://threejs.org/docs/pages/Renderer.html#compute), and [TSL compute](https://threejs.org/docs/pages/TSL.html#compute).

Prewarm a completed kernel with `await renderer.compileComputeAsync(kernel)` or an array of kernels before interactive dispatch. It initializes the renderer if needed and compiles pipelines without dispatching the kernels; synchronous `renderer.compute(kernel)` still performs the work. Keep compilation and graph creation out of frame loops. [r186 compute compilation and dispatch](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js)

### Minimal compute and readback

This one-shot kernel writes one scalar per invocation and returns CPU data. The caller owns the `WebGPURenderer` and keeps it alive until the returned promise settles. The helper owns its kernel and storage buffer. It needs no scene or animation loop.

<!-- check: tsl-compute -->
```js
import { Fn, instancedArray, instanceIndex } from 'three/tsl';

async function computeSquares(renderer, count = 64) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid element count');
  await renderer.init();
  const values = instancedArray(count, 'float');
  const kernel = Fn(() => {
    const i = instanceIndex.toFloat();
    values.element(instanceIndex).assign(i.mul(i));
  })().compute(count);
  try {
    await renderer.compileComputeAsync(kernel);
    renderer.compute(kernel);
    const buffer = await renderer.getArrayBufferAsync(values.value);
    return new Float32Array(buffer);
  } finally {
    kernel.dispose();
    values.value.dispose();
  }
}
```

`Fn` defines GPU work, `.compute(count)` sets dispatch bounds, and `renderer.compute()` submits it. Reading the CPU-side attribute array does not retrieve GPU writes; await readback. Keep readback out of animation loops unless required, since it adds transfer/synchronization cost. Kernel disposal releases compute pipeline bindings; dispose the separately owned storage attribute too. [r186 storage-array factories](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/Arrays.js), [r186 ComputeNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/gpgpu/ComputeNode.js), [r186 Renderer compute/readback](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js), [r186 BufferAttribute disposal](https://github.com/mrdoob/three.js/blob/r186/src/core/BufferAttribute.js)

This independent-element kernel is suitable for checking both WebGPU and the WebGL 2 fallback. Do not extrapolate to workgroup synchronization, atomics, or storage textures; verify each required backend feature separately.

### Local arrays, structs, and soft particles

For fixed shader-local data, use `array([vec3(1, 0, 0), vec3(0, 1, 0)]).element(indexNode)` or `array('float', count)` inside a graph. This is not an uploadable storage buffer; choose `uniformArray` for CPU-updated values and storage arrays for compute output. `struct({ min: 'vec3', max: 'vec3' })` returns a constructor; instantiate it with nodes and access members with `.get('min')`. Define layouts once and respect backend alignment for buffer-backed structures. [r186 array](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/ArrayNode.js), [r186 struct](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/StructNode.js), [r186 layout](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/StructTypeNode.js)

For depth-intersection fading, import `softParticles` from `three/addons/tsl/utils/SoftParticles.js` and assign `material.opacityNode = softParticles({ distance: 1, contrast: 2 })` on a transparent particle node material. It multiplies base `opacity` by a fade against opaque viewport depth; `distance` is in world units. The r186 helper converts perspective depth with camera near/far: do not assume compatibility with orthographic, logarithmic, or reversed-depth inputs. It requires a supported viewport-depth capture path; it is not a general transparency solution or a promised `WebGLNodesHandler` feature. [r186 SoftParticles](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/utils/SoftParticles.js)

Do not import the removed TSL `append` export or the removed `PMREMUtils` namespace. Use `.toStack()` when explicitly adding a node statement to the active `Fn` stack; assignment and control-flow helpers already add their statements. Do not replace internal PMREM utilities with deep imports: use the public renderer-compatible `PMREMGenerator` for environment preprocessing. [r186 stack helper](https://github.com/mrdoob/three.js/blob/r186/src/nodes/tsl/TSLCore.js), [r186 TSL exports](https://github.com/mrdoob/three.js/blob/r186/src/Three.TSL.js), [r186 WebGPU exports](https://github.com/mrdoob/three.js/blob/r186/src/Three.WebGPU.js)

## Failures, diagnostics, and lifecycle

- Keep `renderer.debug.checkShaderErrors` enabled; use `renderer.debug.onShaderError` for custom compile/link diagnostics. `onBeforeCompile` only exposes patch input.
- Never create shader variants or set `needsUpdate` in the frame loop for uniform-only animation.
- Warm likely variants with `renderer.compileAsync(scene, camera)`; profile texture bandwidth, overdraw, and GPU time on target hardware.
- Do not assume `mix` beats coherent branches, vector packing reduces cost, CPU precomputation is cheaper, or lookup textures improve performance; measure.
- `wireframeLinewidth` is ignored and line width remains one pixel.
- Dispose materials and owned textures/render targets when their lifetime ends; dispose superseded materials after replacement.
- Stop the loop and await outstanding compute/readback before releasing buffers. If this component owns a `WebGPURenderer`, finish teardown with `await renderer.dispose()`; `WebGLRenderer.dispose()` remains synchronous. [r186 async renderer disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js)

Official diagnostics and lifecycle references: [WebGLRenderer.debug and compileAsync](https://threejs.org/docs/pages/WebGLRenderer.html#debug), [ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html), and [Material.dispose](https://threejs.org/docs/pages/Material.html#dispose).
