# Post-processing (Three.js 0.186.1)

## Scope

Use this reference for screen-space effects after scene rendering. It owns WebGL
`EffectComposer`, WebGPU `RenderPipeline`, pass ordering, color output, resizing, AA,
bloom, AO, DOF, custom passes, selective effects, composition, cost, and disposal.

## Choose one pipeline

- `WebGLRenderer` uses `EffectComposer` and `three/addons/postprocessing/...`.
- `WebGPURenderer` uses `THREE.RenderPipeline`, TSL nodes, and display-effect nodes on native WebGPU or its supported WebGL 2 fallback. The `WebGLRenderer` node-material bridge does not support this stack.
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
pass is not a substitute. See [OutputPass r186](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/OutputPass.js)
and the [r154→r155 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#154--155).

Do not set an individual pass's `renderToScreen`. On every render, `EffectComposer`
assigns it to the last enabled pass when `composer.renderToScreen` is true. Set the
composer property false only for offscreen output. [EffectComposer r186](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/EffectComposer.js).

`composer.render()` advances its internal timer and supplies delta seconds to
time-driven passes. Pass an explicit delta only when the application owns time.
`pass.enabled = false` skips a pass without rebuilding the chain.

### Multisampling belongs to the render target

The default composer targets are half-float and **not multisampled**;
`WebGLRenderer({ antialias: true })` affects the default framebuffer, not these
offscreen targets. To request composer MSAA, supply a multisampled target.
The composer owns the supplied target and its clone; do not dispose it separately.
The caller owns the renderer, passes, camera, and loop.

<!-- check: post-msaa -->
```js
import { WebGLRenderTarget, HalfFloatType } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';

function createMSAAComposer(renderer, width, height) {
  const target = new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    samples: Math.min(4, renderer.capabilities.maxSamples),
  });
  const composer = new EffectComposer(renderer, target);
  composer.setSize(width, height); // Logical dimensions; applies the captured DPR.
  return composer;
}
```

Require WebGL 2 and support for the selected half-float render-target/sample
configuration. MSAA smooths rasterized geometry, not every edge introduced by a
later full-screen filter. Profile before combining it with post-process AA.
[r186 composer targets, timer, and sizing](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/EffectComposer.js),
[r186 WebGL multisample storage](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLTextures.js)

## WebGL ordering invariant

Canonical order is:

1. `RenderPass`.
2. Depth/normal-dependent and linear-HDR effects: AO, DOF, bloom, blur, grading.
3. `SMAAPass`, if selected; SMAA operates in linear-sRGB.
4. `OutputPass` for tone mapping and display conversion.
5. `FXAAPass`, if selected; FXAA expects sRGB input.

**SMAA precedes `OutputPass`; FXAA follows `OutputPass`.** Do not append linear-space
effects after output conversion. Sources: [SMAAPass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/SMAAPass.js),
[FXAAPass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/FXAAPass.js).

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
needs an offscreen pipeline and explicit composition. [Sizing source](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/EffectComposer.js).

## Effects and current constructors

### Bloom

`new UnrealBloomPass(resolution, strength, radius, threshold)` is valid. Lower
`threshold` admits more bright pixels; `strength` scales and `radius` spreads bloom.
Keep it before `OutputPass`. [Source](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/UnrealBloomPass.js).

### Anti-aliasing

- Renderer MSAA alone does not multisample a composer's offscreen scene; use the target setup above when needed.
- Use `new SMAAPass()` before `OutputPass`; width/height constructor arguments were
  removed in r175.
- Use `new FXAAPass()` after `OutputPass`; its `setSize()` owns reciprocal resolution.
- Do not use `new ShaderPass(FXAAShader)` unless intentionally managing its uniforms.

Sources: [SMAAPass r186](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/SMAAPass.js),
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
[SSAOPass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/SSAOPass.js), [BokehPass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/BokehPass.js).

`SSAOPass.minDistance`/`maxDistance` gate accepted depth differences; expose
`ssao.output = SSAOPass.OUTPUT.SSAO` (or `Blur`, `Depth`, `Normal`) to inspect the
source of artifacts instead of tuning blindly. AO is screen-space: it cannot
recover occluders outside the image.

DOF focus is positive distance along the camera's view direction, not general
Euclidean distance or an object's local position. For a world-space target, update
the camera's world matrix, transform the target by `camera.matrixWorldInverse`,
and set focus to its negated view-space Z. `BokehPass` reads the previous color
image and renders its own depth, so keep the preceding `RenderPass`.
[r186 Bokeh shader depth/focus](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/shaders/BokehShader.js),
[r186 SSAO output modes](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/SSAOPass.js)

### Corrected constructors

- Film grain: `new FilmPass(0.35, false)`; 0.186.1 accepts `(intensity, grayscale)`.
  Scanline arguments were removed in r156.
- Halftone: `new HalftonePass({ radius: 4, scatter: 0 })`; sizing is automatic.

Sources: [FilmPass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/FilmPass.js),
[HalftonePass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/HalftonePass.js),
[r155→r156](https://github.com/mrdoob/three.js/wiki/Migration-Guide#155--156),
[r174→r175](https://github.com/mrdoob/three.js/wiki/Migration-Guide#174--175).

### Outline, grain, glitch, vignette, and grading

Choose these passes independently; this factory exposes all controls without
requiring every effect to be enabled. The caller owns the WebGL renderer,
scene/camera resources, scene membership, resize handling, and loop; this helper
owns its composer and passes. Call `composer.render()` from the existing loop,
resize through the composer, and stop the loop before disposal.

<!-- check: post-stylized-webgl -->
```js
import { Vector2 } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { GlitchPass } from 'three/addons/postprocessing/GlitchPass.js';
import { HalftonePass } from 'three/addons/postprocessing/HalftonePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { ColorCorrectionShader } from 'three/addons/shaders/ColorCorrectionShader.js';

function createStylizedComposer(renderer, scene, camera, selectedObjects = []) {
  const composer = new EffectComposer(renderer);
  const outline = new OutlinePass(new Vector2(1, 1), scene, camera, selectedObjects);
  outline.edgeStrength = 3;
  outline.visibleEdgeColor.set(0xffffff);
  outline.hiddenEdgeColor.set(0x190a05);
  const film = new FilmPass(0.35, false);
  const glitch = new GlitchPass();
  glitch.goWild = false; // true glitches every frame, false at random intervals.
  const halftone = new HalftonePass({ radius: 4, scatter: 0 });
  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms.offset.value = 1;
  vignette.uniforms.darkness.value = 1;
  const grade = new ShaderPass(ColorCorrectionShader);
  grade.uniforms.powRGB.value.set(1, 1, 1); // Neutral, unlike its default (2, 2, 2).
  const effects = { outline, film, glitch, halftone, vignette, grade };
  for (const effect of [film, glitch, halftone]) effect.enabled = false;
  for (const pass of [new RenderPass(scene, camera), ...Object.values(effects), new OutputPass()]) {
    composer.addPass(pass);
  }
  return {
    composer,
    effects,
    dispose() {
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
    },
  };
}
```

`outline.selectedObjects` is a live selection list; edge colors distinguish visible
and occluded edges. Film grain advances from the composer's delta. Halftone shape
and radius are shader controls, not a render-resolution switch. Color correction
computes `mulRGB * pow(color + addRGB, powRGB)` in this linear chain; keep the
power's base nonnegative. A LUT authored for display-encoded input instead needs
an explicit color-domain decision, not automatic placement among linear filters.
[r186 OutlinePass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/OutlinePass.js),
[r186 FilmPass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/FilmPass.js),
[r186 GlitchPass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/GlitchPass.js),
[r186 vignette](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/shaders/VignetteShader.js),
[r186 color correction](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/shaders/ColorCorrectionShader.js)

### Pixelation renders the scene

`RenderPixelatedPass` replaces `RenderPass`; following it with another scene render
would replace its work. It generates beauty/depth/normal buffers itself.

<!-- check: post-pixelated-webgl -->
```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

function createPixelatedComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  const pixelated = new RenderPixelatedPass(6, scene, camera);
  pixelated.normalEdgeStrength = 0.3;
  pixelated.depthEdgeStrength = 0.4;
  composer.addPass(pixelated);
  composer.addPass(new OutputPass());
  return {
    composer,
    pixelated,
    dispose() {
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
    },
  };
}
```

Use the same caller ownership, loop, resize, and teardown contract as the preceding
factory. Pixel size is in effective target pixels, so DPR changes its CSS appearance.
[r186 RenderPixelatedPass](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/RenderPixelatedPass.js)

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

A spatial warp samples the previous texture at displaced UVs rather than tinting
its color. This pass owns only its shader material/fullscreen resources; the
composer owns chain placement. Call `update(elapsedSeconds)` from the application
timer and dispose the pass with the other passes.

<!-- check: post-wave-webgl -->
```js
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

function createWavePass() {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, time: { value: 0 }, intensity: { value: 1 },
    },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float time;
      uniform float intensity;
      varying vec2 vUv;
      void main() {
        vec2 sampleUv = vUv;
        sampleUv.x += sin(sampleUv.y * 10.0 + time) * 0.01 * intensity;
        gl_FragColor = texture2D(tDiffuse, sampleUv);
      }`,
  });
  return {
    pass,
    update(elapsedSeconds) { pass.uniforms.time.value = elapsedSeconds; },
    dispose() { pass.dispose(); },
  };
}
```

Out-of-range UVs use the input target texture's wrapping; clamp explicitly if the
effect must not sample its border. No output chunks belong in this linear pass.
[r186 ShaderPass texture binding](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/ShaderPass.js)

## Selective effects and composition

Selective bloom needs two explicit paths, not “render bloom, then render the scene”:

1. Mark bloom objects with a layer; temporarily darken non-bloom meshes.
2. Render a bloom composer with `renderToScreen = false`.
3. Restore every material, including on exceptions.
4. Render a final composer containing the normal `RenderPass`, an additive
   `ShaderPass` sampling the bloom composer's output texture, then `OutputPass`.

Follow the [r186 selective-bloom example](https://github.com/mrdoob/three.js/blob/r186/examples/webgl_postprocessing_unreal_bloom_selective.html).

Keep a bloom-only render's background black/absent too: backgrounds are not meshes
and otherwise bloom and are added twice. Restore `scene.background`, clear state,
and replaced materials in `finally`, not just after a successful render.
Use `bloomComposer.readBuffer.texture` after its render rather than assuming a
particular ping-pong target is always final; additional swapping passes can change
the final buffer. Enable the bloom layer with `object.layers.enable(layer)` so it
remains in the normal camera layer. Resize and dispose both composers and all
passes, plus the temporary dark material.
[r186 composer swaps/output buffer](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/EffectComposer.js)
For multiple scenes, render one source offscreen and combine textures explicitly.
Two screen-rendering composers do not imply compositing. When directly layering passes,
configure `RenderPass.clear`; `renderer.autoClear = false` does not change its default `clear = true`. [Source](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/postprocessing/RenderPass.js).

## WebGL renderer-owned effects without a composer

For a simple linear effect list, `WebGLRenderer.setEffects()` is an alternative,
not another stage after `EffectComposer`. It requires `outputBufferType` set to
`HalfFloatType` or `FloatType`, uses internal HDR buffers, and performs output
conversion automatically. Do not include `OutputPass` or sRGB-input `FXAAPass`.
`antialias: true` multisamples its scene target; effect ping-pong buffers remain
single-sampled. Size only the renderer.

<!-- check: post-built-in-effects -->
```js
import { WebGLRenderer, HalfFloatType, Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

function createBuiltinBloomRenderer(width, height, dpr = 1) {
  const renderer = new WebGLRenderer({ antialias: true, outputBufferType: HalfFloatType });
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height);
  const bloom = new UnrealBloomPass(new Vector2(width, height), 1, 0.4, 0.85);
  renderer.setEffects([bloom]);
  return {
    renderer,
    bloom,
    dispose() {
      renderer.setAnimationLoop(null);
      renderer.setEffects([]);
      bloom.dispose();
      renderer.dispose();
    },
  };
}
```

The caller owns canvas attachment, scene resources, and the animation callback:
call this renderer's `render(scene, camera)` normally. The factory owns the
renderer and bloom pass; remove its canvas when unmounting.

In **0.186.1**, the renderer calls the internal effect runner without a delta.
Time-driven passes such as `FilmPass` therefore receive `undefined` and corrupt
their time uniform; use `EffectComposer` for those. Do not assume composer masking
or all arbitrary pass-state conventions are supported by this simpler runner.
Passes retain their own resources and are not disposed by removing the list.
[r186 setEffects and invocation](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js),
[r186 HDR effect runner, MSAA, and disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLOutput.js)

## WebGPU: RenderPipeline and TSL

Use npm `three@0.186.1` (r186) import boundaries and node APIs:

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
[RenderPipeline](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/RenderPipeline.js),
[r186 bloom](https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_postprocessing_bloom.html).

For DOF, pass scene color and `scenePass.getViewZNode()` to `dof()` from
`three/addons/tsl/display/DepthOfFieldNode.js`. Node AO is not WebGL `SSAOPass`;
choose the graph below or `ao()` from `GTAONode.js` with depth/view-space normals.
For lighting-aware integration, use an AO pre-pass and `builtinAOContext`, rather
than darkening the fully lit image. Sources: [r186 DOF](https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_postprocessing_dof.html),
[r186 lighting-aware GTAO](https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_postprocessing_ao.html).

### Node-effect inputs and composition

Build the graph once after scene/camera setup. Call `await renderer.init()` before
on-demand synchronous rendering; `setAnimationLoop()` initializes before its
callback. `pass()` inherits `renderer.samples` unless overridden with `{ samples: 0 }`
and follows the renderer's drawing-buffer size. Effects that sample depth may
require single-sampled depth. The pipeline itself needs no `setSize()`.
[r186 PassNode setup](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/PassNode.js)

Factories below come from `three/addons/tsl/display/<file>.js`, **not** `three/tsl`.
These are alternatives, not a recommended all-effects-at-once graph:

| Effect / file | Inputs and returned signal |
| --- | --- |
| `bloom(color, strength, radius, threshold)` / [BloomNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/BloomNode.js) | Glow only; add to scene RGB. |
| `dof(color, viewZ, focusDistance, focalLength, bokehScale)` / [DepthOfFieldNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/DepthOfFieldNode.js) | Complete filtered color; replace the image. Focus/focal-length controls are world-unit distances along the view direction; `bokehScale` is artistic, not a camera aperture. |
| `film(color, intensity)` / [FilmNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/FilmNode.js); `rgbShift(color, amount, angle)` / [RGBShiftNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/RGBShiftNode.js); `chromaticAberration(color, strength, center, scale)` / [ChromaticAberrationNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/ChromaticAberrationNode.js) | Complete color filters. |
| `afterImage(color, damp)` / [AfterImageNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/AfterImageNode.js) | Complete temporal image; retain/dispose the history owner. Higher `damp` in `[0, 1]` retains more history. |
| `dotScreen(color, angle, scale)` / [DotScreenNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/DotScreenNode.js); `smaa(color)` / [SMAANode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/SMAANode.js) | Complete filters; SMAA expects linear input. |
| `lut3D(color, texture3D(lutTexture), size, intensity)` / [Lut3DNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/Lut3DNode.js) | Complete graded color; provide a ready `Data3DTexture` LUT, its edge size, and a correctly authored input color domain. The LUT is data, not an sRGB image. |
| `pixelationPass(scene, camera, pixelSize)` / [PixelationPassNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/PixelationPassNode.js) | Renders a new scene image; replaces beauty `pass()`. |
| `outline(scene, camera, { selectedObjects })` / [OutlineNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/OutlineNode.js) | Edge masks `.visibleEdge`/`.hiddenEdge`; color and add to the beauty RGB. |
| `ssao(depth, normalView, camera)` / [SSAONode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/SSAONode.js); `ao(depth, normalView, camera)` / [GTAONode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/GTAONode.js) | Occlusion factor in `.r`; not a ready beauty image. Prefer lighting-context integration where appropriate. |
| `traa(color, depth, velocity, camera)` / [TRAANode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/TRAANode.js) | Complete temporally antialiased color; needs a velocity MRT and MSAA disabled. |

Sources: [r186 display-node source directory](https://github.com/mrdoob/three.js/tree/r186/examples/jsm/tsl/display),
[r186 LUT contract](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/Lut3DNode.js),
[r186 DOF units](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/DepthOfFieldNode.js),
[r186 outline composition](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/OutlineNode.js)

### DOF followed by display-space FXAA

The caller owns an initialized `WebGPURenderer`, scene/camera, loop, and size.
This factory owns the scene pass, DOF/FXAA nodes, and pipeline. Use a perspective
camera: r186 `PassNode.getViewZNode()` uses perspective depth reconstruction.

<!-- check: post-dof-fxaa -->
```js
import { RenderPipeline } from 'three/webgpu';
import { pass, renderOutput, uniform } from 'three/tsl';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

function createDOFFXAAPipeline(renderer, scene, camera) {
  const scenePass = pass(scene, camera, { samples: 0 });
  const focus = uniform(4.5);
  const dofNode = dof(scenePass.getTextureNode(), scenePass.getViewZNode(), focus, 1.2, 2.5);
  const fxaaNode = fxaa(renderOutput(dofNode));
  const renderPipeline = new RenderPipeline(renderer);
  renderPipeline.outputColorTransform = false;
  renderPipeline.outputNode = fxaaNode;
  return {
    renderPipeline,
    focus,
    render() { renderPipeline.render(); },
    dispose() {
      fxaaNode.dispose();
      dofNode.dispose();
      scenePass.dispose();
      renderPipeline.dispose();
    },
  };
}
```

Change `focus.value` without rebuilding. After changing `outputNode` or
`outputColorTransform` on an already-rendered pipeline, set `needsUpdate = true`.
Do not add scene color to the DOF result; it already contains the scene.
[r186 FXAA](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/FXAANode.js),
[r186 pipeline output graph](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/RenderPipeline.js)

### Custom screen warp and emissive-only bloom

TSL samples screen textures with `screenUV`, not a mesh's UVs. This factory owns
its scene/bloom nodes and pipeline; the caller owns initialized renderer, scene
resources, loop, and resize. Give meshes emissive node materials (and lighting for
lit materials) to populate the emissive MRT attachment. The glow affects only the
captured emissive contribution, not an arbitrary selection of non-emissive objects.

<!-- check: post-emissive-wave -->
```js
import { RenderPipeline, BlendMode, NormalBlending } from 'three/webgpu';
import { pass, mrt, output, emissive, screenUV, time, vec2, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

function createEmissiveWavePipeline(renderer, scene, camera) {
  const scenePass = pass(scene, camera);
  const attachments = mrt({ output, emissive: vec4(emissive, output.a) });
  attachments.setBlendMode('emissive', new BlendMode(NormalBlending));
  scenePass.setMRT(attachments);
  const sceneColor = scenePass.getTextureNode('output');
  const glow = bloom(scenePass.getTextureNode('emissive'), 1, 0.4, 0.1);
  const offset = vec2(screenUV.y.mul(10).add(time).sin().mul(0.01), 0);
  const warped = sceneColor.sample(screenUV.add(offset));
  const renderPipeline = new RenderPipeline(renderer);
  renderPipeline.outputNode = vec4(warped.rgb.add(glow.rgb), warped.a);
  return {
    renderPipeline,
    render() { renderPipeline.render(); },
    dispose() {
      glow.dispose();
      scenePass.dispose();
      renderPipeline.dispose();
    },
  };
}
```

The warp affects the beauty image only here; warp the bloom source too if that is
the intended design. Explicit emissive alpha/blending preserves transparent
contributions instead of treating the attachment as opaque. MRT needs backend
attachment support; per-attachment blend modes on the WebGL fallback require
`OES_draw_buffers_indexed`. The `WebGLRenderer` node-material bridge cannot run this
graph. Keep color linear and leave the final transform automatic.
[r186 emissive MRT bloom example](https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_postprocessing_bloom_emissive.html),
[r186 MRT blend modes](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/MRTNode.js),
[r186 fallback blend support](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/utils/WebGLState.js),
[r186 screen UV](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/ScreenNode.js)

For TRAA, create a renderer without antialiasing, set
`scenePass.setMRT(mrt({ output, velocity }))`, and feed its `output`, `depth`, and
`velocity` texture nodes plus the camera to `traa(...)`. Preserve history across
frames and retain/dispose both TRAA and scene-pass owners. Do not independently
jitter the camera or combine this with a multisampled scene pass.
[r186 TRAA contract](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/TRAANode.js)

### Lighting-aware GTAO

Unlike multiplying final color, `builtinAOContext` supplies AO to the lighting
model without indiscriminately darkening emissive/direct lighting. It needs a
separate single-sampled depth/normal pre-pass. Both pre-pass attachments must use
the same camera and view-space normals.

<!-- check: post-gtao-context -->
```js
import { RenderPipeline } from 'three/webgpu';
import { pass, mrt, normalView, screenUV, builtinAOContext } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';

function createGTAOPipeline(renderer, scene, camera) {
  const prePass = pass(scene, camera, { samples: 0 });
  prePass.transparent = false;
  prePass.setMRT(mrt({ output: normalView }));
  const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
  const scenePass = pass(scene, camera);
  scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
  const renderPipeline = new RenderPipeline(renderer);
  renderPipeline.outputNode = scenePass;
  return {
    renderPipeline,
    aoPass,
    render() { renderPipeline.render(); },
    dispose() {
      aoPass.dispose();
      prePass.dispose();
      scenePass.dispose();
      renderPipeline.dispose();
    },
  };
}
```

The caller owns an initialized renderer, lit scene materials/lights/environment,
camera, size, and loop. This factory owns the two passes, AO node, and pipeline.
The minimal graph leaves GTAO's default temporal filtering off and may be noisy:
denoise it spatially, or enable `useTemporalFiltering` only with a TRAA/velocity
graph. The normal pre-pass excludes transparent surfaces because their color and
depth need not represent the same nearest surface.
[r186 GTAO temporal contract](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/GTAONode.js)
[r186 lighting-aware AO example](https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_postprocessing_ao.html)

Do not use `three/addons/nodes/Nodes.js`, `THREE.PostProcessing`, `TRAAPassNode`,
`PassNode.setResolution()`, `AnamorphicNode`, or `SSAAPassNode.clearColor/clearAlpha`.
In 0.186.1 use `three/tsl`, `THREE.RenderPipeline`, `TRAANode`,
`setResolutionScale()`, `BloomNode`, and renderer clear color. The r185 GTAO change means
older tuning usually needs lower radius and scale.
[Migration r170→r171](https://github.com/mrdoob/three.js/wiki/Migration-Guide#170--171),
[r178→r179](https://github.com/mrdoob/three.js/wiki/Migration-Guide#178--179),
[r180→r181](https://github.com/mrdoob/three.js/wiki/Migration-Guide#180--181),
[r182→r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183),
[r184→r185](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185).

### Weighted order-independent transparency

Use `oitPass(scene, camera, options)` instead of a separate beauty `pass()` when
intersecting transparent surfaces produce sorting artifacts. The pass renders
ordinary objects first, accumulates qualified transparent color/revealage in a
second scene render, and composites them into its node output. This is weighted
blended transparency, not exact depth-sorted refraction.

The caller initializes and owns the `WebGPURenderer`, scene resources, sizing, and
loop. This factory owns its OIT pass and output pipeline. Call `render()` from the
existing loop; stop that loop before `dispose()`.

Before creating the pipeline, call `await renderer.init()` and provide an opaque
beauty background: for example, `scene.background = new THREE.Color(0x000000)`,
or `renderer.setClearColor(0x000000, 1)` when there is no scene background. The
factory does not change the caller's clear color or alpha.

<!-- check: post-oit -->
```js
import { RenderPipeline } from 'three/webgpu';
import { oitPass } from 'three/addons/tsl/display/OITPassNode.js';

function createOITPipeline(renderer, scene, camera) {
  // Caller initializes the renderer and provides opaque background/clear alpha 1.
  if (renderer.backend.isWebGLBackend &&
      !renderer.getContext().getExtension('OES_draw_buffers_indexed')) {
    throw new Error('OIT requires independent MRT blending on the WebGL backend');
  }
  const scenePass = oitPass(scene, camera);
  const renderPipeline = new RenderPipeline(renderer);
  // The OIT node is the composite; its 'output' texture is only the beauty pass.
  renderPipeline.outputNode = scenePass;
  return {
    renderPipeline,
    scenePass,
    render() { renderPipeline.render(); },
    dispose() {
      scenePass.dispose();
      renderPipeline.dispose();
    },
  };
}
```

Use `scenePass` itself as the color input for subsequent effects, not
`scenePass.getTextureNode('output')`: the latter contains only ordinary objects,
without OIT-qualified transparency. In r186, the OIT node composites RGB but
preserves the beauty pass's alpha unchanged. A transparent-only scene with the
renderer default clear alpha `0` therefore produces alpha `0`; the pipeline's
normal output transform maps that color to transparent black. This applies to
both native WebGPU and the WebGL fallback. The tagged pass is not an alpha-correct
transparent-canvas/HTML compositing implementation. Use an opaque background;
do not bypass the output transform or substitute the beauty texture to hide this
limitation. Sources:
[r186 OIT composite](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/OITPassNode.js#L211-L239),
[r186 output transform](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/RenderOutputNode.js#L108-L139),
[r186 zero-alpha handling](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/PremultiplyAlphaFunctions.js#L35-L39).

Keep the pass's default `autoClear`, `autoClearColor`, and `autoClearDepth` enabled.
The ordinary pass clears its color/depth; accumulation clears weighted color to
zero and revealage to one, shares that depth without clearing it, and temporarily
disables transparent depth writes. The pass removes the scene background only
during accumulation and restores scene/renderer state afterward. Resize the
renderer normally: each frame both targets follow its drawing-buffer size and
the pass's `setResolutionScale()`. `RenderPipeline` writes to the caller's active
render target; select that target explicitly, or `renderer.setRenderTarget(null)`
for the canvas. Sources:
[r186 OIT render state and sizing](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/OITPassNode.js#L203-L312),
[r186 pass sizing](https://github.com/mrdoob/three.js/blob/r186/src/nodes/display/PassNode.js#L935-L966),
[r186 pipeline rendering](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/RenderPipeline.js#L130-L160).

In 0.186.1 OIT inherits `PassNode`'s once-per-renderer-frame update cadence:
multiple `renderPipeline.render()` calls in the same renderer animation frame
reuse the pass textures, even if objects were added or removed between calls.
For deterministic dynamic updates, apply scene changes before `render()` in a
`renderer.setAnimationLoop()` callback, with separately observed scene states in
distinct callbacks. Awaiting pixel readback does not guarantee a new frame.
Adding or removing scene objects does not require `renderPipeline.needsUpdate`;
set that flag when changing the output graph, not to invalidate scene contents.
With the default clears above, the first pass render in the next renderer frame
renders the current scene without retaining removed layers. Sources:
[0.186.1 pass update cadence](https://unpkg.com/three@0.186.1/src/nodes/display/PassNode.js),
[0.186.1 frame deduplication](https://unpkg.com/three@0.186.1/src/nodes/core/NodeFrame.js),
[0.186.1 animation-frame advancement](https://unpkg.com/three@0.186.1/src/renderers/common/Animation.js),
[0.186.1 pipeline graph updates](https://unpkg.com/three@0.186.1/src/renderers/common/RenderPipeline.js).

Materials qualify only with `transparent = true`, `NormalBlending`, no positive
transmission, and no `transmissionNode` or `backdropNode`. Other materials stay in
the ordinary pass. OIT-qualified objects do not populate custom MRT attachments;
do not reuse those attachments as if they contained transparent normals or motion.
MSAA is supported on native WebGPU; this pass disables MSAA on the WebGL backend
because its shared depth texture cannot use that path. Independent attachment
blending requires `OES_draw_buffers_indexed` on the fallback: without it r186 warns
and applies one material blend mode to every attachment, which is not correct OIT.
Use conventional transparency deliberately if the extension is unavailable.
Assign a custom `scenePass.weightNode` before the first render, not per frame.
[r186 OIT qualification, graph, MSAA, and disposal](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/OITPassNode.js),
[r186 fallback MRT blending](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/utils/WebGLState.js),
[r186 extension initialization](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/WebGLBackend.js)

### Fast SSAO or GTAO

`ssao(depthNode, normalNode, camera)` from `SSAONode.js` trades GTAO horizon
ray-marching accuracy for fewer depth samples. It defaults to half resolution and
includes a separable depth-aware blur, so it need not depend on temporal accumulation.
This factory owns both passes and its pipeline; the caller owns the initialized
renderer, scene resources, loop, and size.

<!-- check: post-ssao -->
```js
import { RenderPipeline } from 'three/webgpu';
import { pass, mrt, output, normalView, vec4 } from 'three/tsl';
import { ssao } from 'three/addons/tsl/display/SSAONode.js';

function createSSAOPipeline(renderer, scene, camera) {
  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.setMRT(mrt({ output, normal: normalView }));
  const sceneColor = scenePass.getTextureNode('output');
  const aoPass = ssao(
    scenePass.getTextureNode('depth'),
    scenePass.getTextureNode('normal'),
    camera,
  );
  aoPass.radius.value = 0.5; // World units; tune to scene scale.
  aoPass.intensity.value = 1;
  const renderPipeline = new RenderPipeline(renderer);
  renderPipeline.outputNode = vec4(sceneColor.rgb.mul(aoPass.r), sceneColor.a);
  return {
    renderPipeline,
    scenePass,
    aoPass,
    render() { renderPipeline.render(); },
    dispose() {
      aoPass.dispose();
      scenePass.dispose();
      renderPipeline.dispose();
    },
  };
}
```

This simple composite darkens all surface color, including emissive/direct lighting;
use `builtinAOContext` when AO should affect the lighting model instead. Keep the
depth and view-space normals from the same camera/pass. Tune `radius.value`,
`samples.value`, `bias.value`, and `blurSharpness.value`; lower resolution reduces
cost but can lose thin contacts. [r186 SSAO setup and ownership](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/SSAONode.js)

For another scalar screen-space signal, import `depthAwareBlur` from
`three/addons/tsl/display/depthAwareBlur.js`. It filters the red channel using five
taps, scene depth, a one-texel direction, camera, sharpness, and world-space radius.
Run horizontal and vertical passes with an intermediate texture; it is not a
complete two-axis blur or a color blur by itself. Its non-logarithmic branch uses
perspective-depth conversion; verify depth conventions before other camera/depth
modes. [r186 depth-aware blur](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/depthAwareBlur.js)

Prefer GTAO when contact/horizon quality justifies its sampling cost. In r186,
`distanceExponent` and `distanceFallOff` remain deprecated properties but are not
used by its quadratic ray-stepping distance model. Remove those tuning controls;
adjust radius, thickness, scale, and samples against the new result instead.
[r186 GTAO parameters and sampling](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/GTAONode.js)

### Stylized knobs

`dotScreen(input, angle, scale)` from `DotScreenNode.js` and
`rgbShift(input, amount, angle)` from `RGBShiftNode.js` accept numbers or float
nodes. Pass `uniform(...)` for interactive knobs and mutate `.value`; numeric
arguments become fixed nodes, not automatically mutable uniform controls.
Angles are radians; dot-screen scale increases dot density, while RGB amount is
a UV offset. Build once, preserve the single output conversion, and retain any
intermediate texture owners created by a composed effect.
[r186 dot-screen](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/DotScreenNode.js),
[r186 RGB shift](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/RGBShiftNode.js)

### VXGI decision

`vxgi(depth, viewNormalOrNull, scene, camera, resolution)` from
`three/addons/lighting/vxgi/VXGINode.js` requires a native WebGPU backend, not the
WebGL fallback. It gathers off-screen indirect diffuse light and AO from a dense
voxel volume: useful for mostly static geometry with changing direct lights, not
per-frame geometry animation. Geometry changes require expensive re-voxelization
(`needsUpdate = true`); lighting changes can request `lightingNeedsUpdate = true`.
Bound the volume with `volume.bounds`/`volume.layers`; resolution defaults to 128
along the longest axis and should not exceed 256. Dense volume memory, occupied
voxels times lights, cone count, and cached bounces are material costs.

Setup needs matching scene depth/view-space normals, the scene/camera, and an
explicit lighting graph: `getGINode()` provides indirect irradiance for
`builtinGIContext`, while `getAONode()` provides occlusion. Temporal filtering
defaults on and requires `TRAANode`; disable `useTemporalFiltering` if that path
is absent. The VXGI node owns its volume and disposes it with its own targets and
material; dispose separate scene/temporal pass owners too. Choose lower-cost
screen-space AO/SSGI or baked probes when those costs do not fit; VXGI is not a
drop-in scene-color filter.
[r186 VXGI contract and lifecycle](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/lighting/vxgi/VXGINode.js),
[r186 volume setup, backend, and costs](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/lighting/vxgi/VXGIVolume.js)

### Direct output without screen-space effects

`DirectRenderPipeline` is exported by `three/webgpu` for `WebGPURenderer`.
`new DirectRenderPipeline(renderer).render(scene, camera)` applies output
processing in material shaders, avoiding the intermediate framebuffer and output
pass. It changes blending because output transforms occur before blending, and
is incompatible with materials that sample the framebuffer, including
transmission. Use it only when that trade-off fits; retain `RenderPipeline` for
the screen-space graphs above. Keep and dispose the direct-pipeline instance.
[r186 direct pipeline restrictions](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/DirectRenderPipeline.js),
[r186 public export](https://github.com/mrdoob/three.js/blob/r186/src/Three.WebGPU.js)

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
[RenderPipeline r186](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/RenderPipeline.js),
[BloomNode r186](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/BloomNode.js).
Dispose application-owned scene resources; set `renderPipeline.needsUpdate = true` after changing its output graph.
After stopping all producers and awaiting in-flight work, release an owned
`WebGPURenderer` with `await renderer.dispose()`; r186 disposal awaits the backend.
Do not dispose a shared renderer from a pass factory.
[r186 async renderer disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js)
