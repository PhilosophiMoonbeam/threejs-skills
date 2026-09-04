# Shaders and TSL — Three.js 0.185.1

## Scope

This reference owns custom WebGL shaders, built-in material patching, shader coordinate spaces, output conversion, and the boundary to TSL/WebGPU compute.
For textures as resources, render-target setup, or post-processing graph design, use those named topics instead.
All APIs and engine internals below target Three.js 0.185.1 exactly.

## Choose the renderer path first

- `ShaderMaterial` and `RawShaderMaterial` are `WebGLRenderer` materials.
- Prefer `ShaderMaterial` when Three.js declarations, attributes, precision, defines, and chunk helpers are useful.
- Prefer `RawShaderMaterial` only when every GLSL declaration and interface should be explicit.
- For new WebGPU-capable or renderer-agnostic shader work, use NodeMaterial and TSL, not either GLSL material.
- `WebGLRenderer` requires WebGL 2 in 0.185.1. Its shader program is GLSL ES 3.00 even when a non-raw `ShaderMaterial` uses legacy source spellings through compatibility macros.
- Set `glslVersion`; never put `#version` inside shader source.

Official GLSL basis: [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html), [ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html), and [revision 185 WebGLProgram conversion](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLProgram.js#L800-L828).

## NodeMaterial and TSL selection

Use the closest built-in node material rather than the base `NodeMaterial` when a material model is already a fit:

- `MeshBasicNodeMaterial` — unlit mesh color, maps, and environment response.
- `MeshStandardNodeMaterial` — metalness/roughness PBR.
- `MeshPhysicalNodeMaterial` — Standard plus physical extensions such as clearcoat, transmission, and sheen.
- `LineBasicNodeMaterial` — line primitives.
- `SpriteNodeMaterial` — sprites and their screen-facing quad behavior.

These five classes are exported by `three/webgpu` in 0.185.1. Import TSL node functions from `three/tsl`; do not import node-material classes from that module. TSL graphs avoid GLSL string rewriting and can be emitted for the renderer backend, which is the practical reason to choose this path for WebGPU, compute, or code that must also work with the renderer's WebGL 2 fallback. See [official NodeMaterial guidance](https://threejs.org/docs/llms.txt#4-node-material-classes-for-webgputsl), [r185 node-material exports](https://github.com/mrdoob/three.js/blob/r185/src/materials/nodes/NodeMaterials.js), and [NodeMaterial](https://threejs.org/docs/pages/NodeMaterial.html).

Classic `ShaderMaterial` and `RawShaderMaterial` remain the WebGL GLSL path; do not mix their shader strings into a TSL graph.

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

`colorNode` supplies linear surface color; leave display conversion to the renderer or final pipeline. TSL operations construct a shader graph; JavaScript arithmetic on node objects does not become shader arithmetic. Inside `Fn`, use node assignment methods and TSL control flow such as `If` for GPU-dependent branches. [r185 UniformNode](https://github.com/mrdoob/three.js/blob/r185/src/nodes/core/UniformNode.js), [r185 NodeMaterial](https://github.com/mrdoob/three.js/blob/r185/src/materials/nodes/NodeMaterial.js), [r185 TSL flow](https://github.com/mrdoob/three.js/blob/r185/src/nodes/tsl/TSLCore.js)

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

`THREE.Color` values are interpreted in the working Linear-sRGB space. The last two chunks are for a shader rendered directly to the canvas. Omit them when writing an intermediate render target that a later `OutputPass` will tone-map and convert; applying both paths double-transforms the image. See [Color management](https://threejs.org/manual/en/color-management.html) and [revision 185 built-in output order](https://github.com/mrdoob/three.js/blob/r185/src/renderers/shaders/ShaderLib/meshbasic.glsl.js).

## GLSL source forms

For non-raw `ShaderMaterial`, the default source form may use `attribute`, `varying`, `texture2D`, `textureCube`, and `gl_FragColor`; 0.185.1 supplies compatibility macros. With `glslVersion: THREE.GLSL3`, use `in`/`out`, `texture`, `textureSize`, and a declared fragment output. The `#define gl_FragColor outColor` above lets 0.185.1 output chunks target that declared GLSL3 output.

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

Declare `modelMatrix`, `modelViewMatrix`, `projectionMatrix`, or `normalMatrix` as needed, but do not duplicate them in the JS `uniforms` object: `WebGLRenderer` uploads recognized per-camera and per-object values. Raw shaders also receive no automatic output-transform helpers; implement the required conversion explicitly, or use them only for intermediate linear output. See [RawShaderMaterial](https://threejs.org/docs/pages/RawShaderMaterial.html) and [revision 185 matrix uploads](https://github.com/mrdoob/three.js/blob/r185/src/renderers/WebGLRenderer.js#L2567-L2767).

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

Do not combine view-space `normalMatrix * normal` with world-space `cameraPosition - worldPosition`. See [Matrix3.getNormalMatrix](https://threejs.org/docs/pages/Matrix3.html#getNormalMatrix) and [revision 185 packing helpers](https://github.com/mrdoob/three.js/blob/r185/src/renderers/shaders/ShaderChunk/packing.glsl.js).

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

`onBeforeCompile` customizes `WebGLRenderer` built-in materials only. Patch a verified 0.185.1 anchor, assert that it occurs exactly once, and retain the compiled uniform reference outside `userData` when serialization matters:

```js
const tint = new THREE.Color(0xff8844);
let compiledShader;
const material = new THREE.MeshStandardMaterial();
material.onBeforeCompile = (shader) => {
  const anchor = '#include <color_fragment>';
  if (shader.fragmentShader.split(anchor).length !== 2) throw new Error('0.185.1 shader anchor changed');
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

## 0.185.1 chunks and migration traps

Chunks are renderer implementation details, not a stable public composition API. Useful verified 0.185.1 stages include `beginnormal_vertex`, `begin_vertex`, `defaultnormal_vertex`, `project_vertex`, `normal_fragment_begin`, `map_fragment`, `opaque_fragment`, `tonemapping_fragment`, and `colorspace_fragment`; preserve the dependencies and order used by the matching 0.185.1 `ShaderLib` shader.

- `encodings_fragment` became `colorspace_fragment` in r154.
- `output_fragment` became `opaque_fragment` in r154; `opaque_fragment` is not the final display transform.
- `lightmap_fragment` was removed in r164.
- In 0.185.1, replace deprecated `inverseTransformDirection()` with `transformNormalByInverseViewMatrix()` for normals or `transformDirectionByInverseViewMatrix()` for directions.
- Do not use obsolete `extensions.derivatives`, `fragDepth`, `drawBuffers`, or `shaderTextureLOD`. WebGL 2 provides derivatives, `gl_FragDepth`, declared MRT outputs, and `textureLod`; 0.185.1 `ShaderMaterial.extensions` exposes only `clipCullDistance` and `multiDraw`.

Sources: [r153→r154](https://github.com/mrdoob/three.js/wiki/Migration-Guide#153--154), [r163→r164](https://github.com/mrdoob/three.js/wiki/Migration-Guide#163--r164), [r184→r185](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185), and [revision 185 ShaderMaterial source](https://github.com/mrdoob/three.js/blob/r185/src/materials/ShaderMaterial.js).

## TSL, WebGPU, and compute boundary

For NodeMaterial work, import renderer-facing classes from `three/webgpu` and node functions from `three/tsl`; the class choices are listed above. Assign nodes such as `colorNode`, `positionNode`, or `normalNode` and let the node system emit backend code. In 0.185.1, use `packNormalToRGB()`/`unpackRGBToNormal()` rather than the renamed direction/color helpers. In the `material.positionNode` hook, r185 does not make `positionLocal` reflect internal morphing, skinning, batching, or instancing updates; use `positionGeometry` when you need the pre-transformed geometry attribute, and explicitly compose any required internal transforms yourself. Outside that hook, `positionLocal` remains the node for the material's transformed local-position pipeline. See the [r184→r185 migration entry](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185), [r185 NodeMaterial position setup](https://github.com/mrdoob/three.js/blob/r185/src/materials/nodes/NodeMaterial.js#L763-L807), and [r185 position nodes](https://github.com/mrdoob/three.js/blob/r185/src/nodes/accessors/Position.js).

For WebGL fragment-texture computation, import `GPUComputationRenderer` from `three/addons/misc/GPUComputationRenderer.js`; it manages float RGBA variables, dependencies, and ping-pong render targets. For WebGPU-capable compute, use TSL compute/storage nodes with `WebGPURenderer`. `setAnimationLoop()` initializes the renderer before the loop callback; for on-demand compute, call `await renderer.init()` before synchronous `renderer.compute(computeNode)` (or use `computeAsync()`). See [GPUComputationRenderer](https://threejs.org/docs/pages/GPUComputationRenderer.html), [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html), [Renderer.compute](https://threejs.org/docs/pages/Renderer.html#compute), and [TSL compute](https://threejs.org/docs/pages/TSL.html#compute).

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
    renderer.compute(kernel);
    const buffer = await renderer.getArrayBufferAsync(values.value);
    return new Float32Array(buffer);
  } finally {
    kernel.dispose();
    values.value.dispose();
  }
}
```

`Fn` defines GPU work, `.compute(count)` sets dispatch bounds, and `renderer.compute()` submits it. Reading the CPU-side attribute array does not retrieve GPU writes; await readback. Keep readback out of animation loops unless required, since it adds transfer/synchronization cost. Kernel disposal releases compute pipeline bindings; dispose the separately owned storage attribute too. [r185 storage-array factories](https://github.com/mrdoob/three.js/blob/r185/src/nodes/accessors/Arrays.js), [r185 ComputeNode](https://github.com/mrdoob/three.js/blob/r185/src/nodes/gpgpu/ComputeNode.js), [r185 Renderer compute/readback](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/Renderer.js), [r185 BufferAttribute disposal](https://github.com/mrdoob/three.js/blob/r185/src/core/BufferAttribute.js)

This independent-element kernel is suitable for checking both WebGPU and the WebGL 2 fallback. Do not extrapolate to workgroup synchronization, atomics, or storage textures; verify each required backend feature separately.

## Failures, diagnostics, and lifecycle

- Keep `renderer.debug.checkShaderErrors` enabled; use `renderer.debug.onShaderError` for custom compile/link diagnostics. `onBeforeCompile` only exposes patch input.
- Never create shader variants or set `needsUpdate` in the frame loop for uniform-only animation.
- Warm likely variants with `renderer.compileAsync(scene, camera)`; profile texture bandwidth, overdraw, and GPU time on target hardware.
- Do not assume `mix` beats coherent branches, vector packing reduces cost, CPU precomputation is cheaper, or lookup textures improve performance; measure.
- `wireframeLinewidth` is ignored and line width remains one pixel.
- Dispose materials and owned textures/render targets when their lifetime ends; dispose superseded materials after replacement.

Official diagnostics and lifecycle references: [WebGLRenderer.debug and compileAsync](https://threejs.org/docs/pages/WebGLRenderer.html#debug), [ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html), and [Material.dispose](https://threejs.org/docs/pages/Material.html#dispose).
