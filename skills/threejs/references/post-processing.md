# Post-processing (Three.js 0.185.1)

## Scope

Use this reference for screen-space effects after scene rendering. It owns WebGL
`EffectComposer`, WebGPU `RenderPipeline`, pass ordering, color output, resizing, AA,
bloom, AO, DOF, custom passes, selective effects, composition, cost, and disposal.

## Choose one pipeline

- `WebGLRenderer` uses `EffectComposer` and `three/addons/postprocessing/...`.
- `WebGPURenderer` uses `THREE.RenderPipeline`, TSL nodes, and display-effect nodes.
- Do not mix WebGL passes such as `OutputPass` into a WebGPU node graph.
- Render through the selected pipeline, not through `renderer.render()` afterward; a later direct render normally clears or replaces the processed image.

## WebGL: minimal working chain

<!-- check: post-webgl -->
```js
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(width, height);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1, 0.4, 0.85);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
renderer.setAnimationLoop(() => composer.render());
```

`OutputPass` is the single WebGL final-output conversion: it reads the renderer's
tone mapping, exposure, and output color space. Keep preceding shader passes in
working linear-sRGB and do not also apply `tonemapping_fragment` or
`colorspace_fragment` in those intermediate passes. A `GammaCorrectionShader`
pass is not a substitute. See [OutputPass revision 185](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/OutputPass.js)
and the [r154→r155 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#154--155).

Do not set an individual pass's `renderToScreen`. On every render, `EffectComposer`
assigns it to the last enabled pass when `composer.renderToScreen` is true. Set the
composer property false only for offscreen output. [EffectComposer revision 185](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/EffectComposer.js).

## WebGL ordering invariant

Canonical order is:

1. `RenderPass`.
2. Depth/normal-dependent and linear-HDR effects: AO, DOF, bloom, blur, grading.
3. `SMAAPass`, if selected; SMAA operates in linear-sRGB.
4. `OutputPass` for tone mapping and display conversion.
5. `FXAAPass`, if selected; FXAA expects sRGB input.

**SMAA precedes `OutputPass`; FXAA follows `OutputPass`.** Do not append linear-space
effects after output conversion. Sources: [SMAAPass](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/SMAAPass.js),
[FXAAPass](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/FXAAPass.js).

## Resize and pixel-ratio ownership

Set renderer DPR before constructing the composer; its constructor snapshots the ratio.
Pass logical CSS dimensions to both `setSize()` methods. The composer applies its
stored ratio and propagates effective dimensions to every pass.

<!-- check: post-resize -->
```js
function resize(width, height, dpr = Math.min(window.devicePixelRatio, 2)) {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height);
  composer.setPixelRatio(dpr);
  composer.setSize(width, height);
}
```

Do not multiply dimensions by DPR yourself. Do not update FXAA uniforms or bloom's
`resolution` vector manually; the composer invokes each pass's `setSize()`. A smaller
bloom constructor vector is also overwritten when added. Reduced-resolution bloom
needs an offscreen pipeline and explicit composition. [Sizing source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/EffectComposer.js).

## Effects and current constructors

### Bloom

`new UnrealBloomPass(resolution, strength, radius, threshold)` is valid. Lower
`threshold` admits more bright pixels; `strength` scales and `radius` spreads bloom.
Keep it before `OutputPass`. [Source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/UnrealBloomPass.js).

### Anti-aliasing

- Prefer renderer MSAA when it meets the target and post-processing preserves it.
- Use `new SMAAPass()` before `OutputPass`; width/height constructor arguments were
  removed in r175.
- Use `new FXAAPass()` after `OutputPass`; its `setSize()` owns reciprocal resolution.
- Do not use `new ShaderPass(FXAAShader)` unless intentionally managing its uniforms.

Sources: [SMAAPass revision 185](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/SMAAPass.js),
[r174→r175 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#174--175).

### Ambient occlusion and depth of field

A WebGL AO pass requires scene depth/normal information and follows a `RenderPass`:

```js
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
const ssao = new SSAOPass(scene, camera, width, height);
ssao.kernelRadius = 16;
composer.addPass(ssao); // after RenderPass, before OutputPass
```

`SSAOPass` is basic; `GTAOPass` is generally higher quality and more expensive. Tune against camera scale. For DOF:

```js
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
const dof = new BokehPass(scene, camera, { focus: 10, aperture: 0.025, maxblur: 0.01 });
dof.uniforms.focus.value = focusDistance;
composer.addPass(dof);
```

Increasing `aperture` increases defocus blur; decreasing it keeps more in focus. Sources:
[SSAOPass](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/SSAOPass.js), [BokehPass](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/BokehPass.js).

### Corrected constructors

- Film grain: `new FilmPass(0.35, false)`; 0.185.1 accepts `(intensity, grayscale)`.
  Scanline arguments were removed in r156.
- Halftone: `new HalftonePass({ radius: 4, scatter: 0 })`; sizing is automatic.

Sources: [FilmPass](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/FilmPass.js),
[HalftonePass](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/HalftonePass.js),
[r155→r156](https://github.com/mrdoob/three.js/wiki/Migration-Guide#155--156),
[r174→r175](https://github.com/mrdoob/three.js/wiki/Migration-Guide#174--175).

## Custom WebGL pass

`ShaderPass` receives the previous texture as `tDiffuse` and must emit the complete next color. Put this linear effect before `OutputPass`.

```js
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
const tintPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, tint: { value: new THREE.Color(0xffe0c0) } },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform vec3 tint;varying vec2 vUv;
    void main(){vec4 c=texture2D(tDiffuse,vUv);gl_FragColor=vec4(c.rgb*tint,c.a);}`,
});
composer.addPass(tintPass);
```

Update custom uniforms yourself only when the pass lacks `setSize()`. Preserve alpha deliberately for later composition.

## Selective effects and composition

Selective bloom needs two explicit paths, not “render bloom, then render the scene”:

1. Mark bloom objects with a layer; temporarily darken non-bloom meshes.
2. Render a bloom composer with `renderToScreen = false`.
3. Restore every material, including on exceptions.
4. Render a final composer containing the normal `RenderPass`, an additive
   `ShaderPass` sampling the bloom composer's output texture, then `OutputPass`.

Follow the [revision 185 selective-bloom example](https://github.com/mrdoob/three.js/blob/r185/examples/webgl_postprocessing_unreal_bloom_selective.html).
For multiple scenes, render one source offscreen and combine textures explicitly.
Two screen-rendering composers do not imply compositing. When directly layering passes,
configure `RenderPass.clear`; `renderer.autoClear = false` does not change its default `clear = true`. [Source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/RenderPass.js).

## WebGPU: RenderPipeline and TSL

Use 0.185.1 import boundaries and node APIs:

```js
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
const renderer = new THREE.WebGPURenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(width, height);
const renderPipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
const bloomPass = bloom(sceneColor, 0.5, 0.4, 0.85);
renderPipeline.outputNode = sceneColor.add(bloomPass);
renderer.setAnimationLoop(() => renderPipeline.render());
```

With the default `outputColorTransform = true`, `RenderPipeline` adds the single
final tone-mapping and output-color-space conversion; do not add `OutputPass` or
perform another conversion in the graph. If you set `outputColorTransform = false`,
place exactly one `renderOutput(...)` node at the point where conversion is needed
(for example, before an FXAA node); no automatic conversion is then applied. Resize
the renderer with logical dimensions. Use `setResolutionScale()` or a node's
`resolutionScale` where supported. Sources:
[RenderPipeline](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/RenderPipeline.js),
[revision 185 bloom](https://github.com/mrdoob/three.js/blob/r185/examples/webgpu_postprocessing_bloom.html).

For WebGPU DOF, pass scene color and `scenePass.getViewZNode()` to `dof()` from
`three/addons/tsl/display/DepthOfFieldNode.js`. WebGPU AO is not `SSAOPass`: 0.185.1 uses
`ao()` from `GTAONode.js`, a depth/normal pre-pass, and `builtinAOContext`. Sources:
[DOF](https://github.com/mrdoob/three.js/blob/r185/examples/webgpu_postprocessing_dof.html), [AO](https://github.com/mrdoob/three.js/blob/r185/examples/webgpu_postprocessing_ao.html).

Do not use `three/addons/nodes/Nodes.js`, `THREE.PostProcessing`, `TRAAPassNode`,
`PassNode.setResolution()`, `AnamorphicNode`, or `SSAAPassNode.clearColor/clearAlpha`.
In 0.185.1 use `three/tsl`, `THREE.RenderPipeline`, `TRAANode`,
`setResolutionScale()`, `BloomNode`, and renderer clear color. The r185 GTAO change means
older tuning usually needs lower radius and scale.
[Migration r170→r171](https://github.com/mrdoob/three.js/wiki/Migration-Guide#170--171),
[r178→r179](https://github.com/mrdoob/three.js/wiki/Migration-Guide#178--179),
[r180→r181](https://github.com/mrdoob/three.js/wiki/Migration-Guide#180--181),
[r182→r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183),
[r184→r185](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185).

## Cost and lifecycle

Each full-resolution pass adds fragment work and often render targets; SMAA, bloom,
AO, and DOF contain multiple internal passes. Measure GPU time on target hardware.
Cap DPR, disable unused passes with `pass.enabled = false`, reduce resolution only
through supported APIs, and avoid redundant scene/depth renders.

On teardown, stop the animation loop and remove listeners. Dispose every pass, then
call `composer.dispose()`; the composer does not dispose its pass list. Dispose custom
materials, textures, and owned render targets. For WebGPU, retain handles for every
owned effect/pass node. Call `bloomPass.dispose()` and `scenePass.dispose()` before
`renderPipeline.dispose()`. Pipeline disposal alone releases only its fullscreen
material, not node-owned render targets or materials. Sources:
[RenderPipeline revision 185](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/RenderPipeline.js#L145-L153),
[BloomNode revision 185](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/tsl/display/BloomNode.js#L475-L499).
Dispose application-owned scene resources; set `renderPipeline.needsUpdate = true` after changing its output graph.
