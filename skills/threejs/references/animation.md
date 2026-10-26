# Animation — Three.js 0.186.1

## Scope

Use this reference for frame timing, clips, tracks, mixers, actions, fades,
additive layers, skeletons, procedural bone overrides, and morph playback.
Asset loading owns GLTF transport and decoder configuration; begin here once it
returns an `Object3D` root and its `AnimationClip[]`.

## Decisions and invariants

- Target Three.js 0.186.1 exactly.
- Use `THREE.Timer`, not deprecated `Clock`. `Clock` was deprecated in r183;
  `Timer` is a core export in 0.186.1.
  [r182 → r183 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)
  [r186 Timer](https://github.com/mrdoob/three.js/blob/r186/src/core/Timer.js)
- Connect the timer to `document` for Page Visibility handling, update it once at
  the start of each frame, then reuse that frame's delta and elapsed values.
- Times, clip durations, mixer updates, fades, and warps use seconds.
- A clip contains typed tracks. A mixer has one default root and one global time;
  actions may use `clipAction()`'s optional alternative root. Use separate mixers
  for independently timed roots. An action is the mixer's cached playback
  control for one clip/root pair.
  [r186 AnimationMixer](https://github.com/mrdoob/three.js/blob/r186/src/animation/AnimationMixer.js)
- For each track, `values.length / times.length` must equal the property's value
  size. Times must be sorted in nondecreasing order.
- Update a mixer before applying procedural overrides to properties also driven
  by that mixer. Otherwise the mixer overwrites the procedural value.

## Canonical imports and frame loop

Core animation APIs are available from `three`; animation playback needs no
addon import.

```js
import * as THREE from 'three';

const root = animatedObject;
const track = new THREE.VectorKeyframeTrack('.position', [0, 0.5, 1], [0, 0, 0, 0, 1, 0, 0, 0, 0]);
const clip = new THREE.AnimationClip('hop', -1, [track]);
const mixer = new THREE.AnimationMixer(root);
const action = mixer.clipAction(clip).play();

const timer = new THREE.Timer(); timer.connect(document);

// Cache optional procedural targets once, never by searching each frame.
let headBone;
root.traverse((object) => { if (object.isBone && object.name === 'Head') headBone = object; });

function frame(timestamp) {
  timer.update(timestamp); // Exactly once per rendered frame.
  const delta = timer.getDelta();
  const elapsed = timer.getElapsed();

  mixer.update(delta);

  // This deliberately replaces the clip's value for this channel.
  if (headBone) headBone.rotation.y = Math.sin(elapsed) * 0.2;

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(frame);

function disposeAnimation() {
  renderer.setAnimationLoop(null);
  action.stop();
  mixer.uncacheAction(clip, root);
  mixer.uncacheClip(clip);
  mixer.uncacheRoot(root);
  timer.dispose();
}
```

`renderer.setAnimationLoop()` is the renderer-managed loop and also supports XR.
The official r186 blending example combines it with `Timer` and
`AnimationMixer.update()`.
[r186 blending example](https://github.com/mrdoob/three.js/blob/r186/examples/webgl_animation_skinning_blending.html)
This helper stops playback and releases mixer/timer bindings, not the root's resources
or renderer. The shown loop uses `WebGLRenderer`; for common `Renderer`/`WebGPURenderer`,
await `renderer.setAnimationLoop(null)` before subsystem teardown and await
`renderer.dispose()` at final application retirement. [r186 common loop/disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js)

## Tracks, bindings, and clips

Use one value per key for scalar, boolean, and string tracks; three for vectors
and colors; four for quaternions. Quaternion samples must be normalized. [r186 QuaternionKeyframeTrack](https://github.com/mrdoob/three.js/blob/r186/src/animation/tracks/QuaternionKeyframeTrack.js)

Track paths bind relative to the action's root: `.position[y]` addresses one
component, `.material.opacity` a material field, `Hips.position` a named
descendant, and `.bones[Head].quaternion` a named skeleton bone. Verify names
against the loaded hierarchy; a clip from another rig is not automatically
retargeted. Numeric color samples are in the material's working color space
(normally Linear-sRGB), not encoded sRGB bytes. Opacity animation needs a material
configured for transparency before playback.
[r186 binding paths](https://github.com/mrdoob/three.js/blob/r186/src/animation/PropertyBinding.js),
[r186 color management](https://github.com/mrdoob/three.js/blob/r186/src/math/ColorManagement.js)

```js
const opacity = new THREE.NumberKeyframeTrack('.material.opacity', [0, 1], [1, 0]);
const position = new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 1, 2, 0]);
const quaternion = new THREE.QuaternionKeyframeTrack('.quaternion', [0, 1], [0, 0, 0, 1, 0, 1, 0, 0]);
const color = new THREE.ColorKeyframeTrack('.material.color', [0, 1], [1, 0, 0, 0, 0, 1]);
const visible = new THREE.BooleanKeyframeTrack('.visible', [0, 1], [true, false]);
const smile = new THREE.NumberKeyframeTrack('.morphTargetInfluences[smile]', [0, 0.5, 1], [0, 1, 0]);
```

Morph influences are numbers; never use `StringKeyframeTrack` for them. A named
morph binding resolves through `morphTargetDictionary`.
[r186 PropertyBinding](https://github.com/mrdoob/three.js/blob/r186/src/animation/PropertyBinding.js)
[r186 Mesh morph fields](https://github.com/mrdoob/three.js/blob/r186/src/objects/Mesh.js)

Use `InterpolateLinear`, `InterpolateSmooth`, `InterpolateDiscrete`, or
`InterpolateBezier` only when appropriate for the track. Boolean and string tracks
are discrete; keep quaternion tracks on quaternion interpolation, not componentwise
Bézier curves. `InterpolateSmooth` is not glTF `CUBICSPLINE`; loader-created spline
tracks use specialized interpolants. [r186 KeyframeTrack](https://github.com/mrdoob/three.js/blob/r186/src/animation/KeyframeTrack.js)

Pass `-1` as clip duration to infer it from the final track keys. Calling
`clip.resetDuration()` recalculates duration; it does not seek. Seek one action
with `action.reset()` or `action.time = 0`, and seek the whole mixer with
`mixer.setTime(0)`.
[r186 AnimationClip](https://github.com/mrdoob/three.js/blob/r186/src/animation/AnimationClip.js)

### Clip lookup and editing

Use `THREE.AnimationClip.findByName(clips, 'Walk')` and handle a missing result
before `clipAction()`. Share immutable clips between compatible character rigs;
clone before editing. `clip.validate()` checks empty tracks, ordering, NaN, and
fractional value sizes, but does not prove the size matches the bound property.
`clip.optimize()` removes redundant keys; do it during preparation, not per frame.

`THREE.AnimationUtils.subclip(source, 'segment', startFrame, endFrame, fps)`
returns a clone containing existing keys in the half-open frame range and shifts
the earliest retained key to zero. It neither resamples nor inserts boundary
poses. For example, frames `[0, 31)` at 30 fps retain keys at 0 and 1 seconds.
Check retained keys and duration before playback. In r186, `subclip()` and
`optimize()` do not compact Bézier tangent arrays with their keys; do not use them
to edit authored Bézier tracks without rebuilding matching tangent data.
[r186 subclip](https://github.com/mrdoob/three.js/blob/r186/src/animation/AnimationUtils.js#L173-L252),
[r186 validation and optimization](https://github.com/mrdoob/three.js/blob/r186/src/animation/KeyframeTrack.js#L403-L596)

### Authored Bézier tangents

r186 `InterpolateBezier` uses explicit 2D control points, not derivative slopes.
For `N` keys and property size `S`, each `settings.inTangents`/`outTangents`
`Float32Array` has `N * S * 2` entries: one `[time, value]` pair per key and
component. The previous key's outgoing point and next key's incoming point define
each segment. Set these arrays before `mixer.clipAction()` or `createInterpolant()`;
without both arrays the Bézier interpolant falls back to linear interpolation.
[r186 tangent factory](https://github.com/mrdoob/three.js/blob/r186/src/animation/KeyframeTrack.js#L154-L177),
[r186 control-point layout and evaluation](https://github.com/mrdoob/three.js/blob/r186/src/math/interpolants/BezierInterpolant.js#L3-L75),
[r186 action interpolant creation](https://github.com/mrdoob/three.js/blob/r186/src/animation/AnimationAction.js#L33-L44)

This scalar track eases opacity from 0 to 1. Use it on a transparent material;
construct the clip and action only after its tangent settings are assigned:

<!-- check: animation-bezier -->
```js
import * as THREE from 'three';

function createBezierTrack() {
  const track = new THREE.NumberKeyframeTrack(
    '.material.opacity', [0, 1], [0, 1], THREE.InterpolateBezier,
  );
  track.settings = {
    inTangents: new Float32Array([0, 0, 2 / 3, 1]),
    outTangents: new Float32Array([1 / 3, 0, 1, 1]),
  };
  return track;
}
```

### FBX clips on one timeline

For an FBX file whose animation stacks define separate ranges on a shared
timeline, set `loader.trimAnimationClips = true` on an `FBXLoader` instance before
loading. The default is `false`. When a stack has `LocalStop > LocalStart`, r186
keeps keys inside that range and shifts them to start at time zero; tracks with
no keys in the range are discarded. It does not synthesize boundary keys, so
check first/last poses and bindings against the authored ranges. Select the
returned root's `animations` by clip name rather than assuming index zero is the
wanted clip. Multiple stacks are clips; multiple layers within one stack remain
unsupported and subsequent layers are ignored. Loading, cancellation, and root
resource ownership remain asset-loading concerns.
[r186 option/default](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/FBXLoader.js#L89-L97),
[r186 stacks and clip ranges](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/FBXLoader.js#L2911-L2967),
[r186 key trimming](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/FBXLoader.js#L2971-L3016)

## Actions, loops, and events

`play()` activates an action; `reset()` prepares it from time zero; `stop()`
deactivates and resets it. `fadeOut(seconds)` fades weight. `halt(seconds)`
warps effective time scale to zero and neither fades nor stops the action.

For a one-shot that holds its last pose:

```js
const once = mixer.clipAction(clip);
once.reset().setLoop(THREE.LoopOnce, 1);
once.clampWhenFinished = true;
once.play();
```

An infinitely repeating action never reaches a finished state, so clamping has
no effect. `LoopRepeat` and `LoopPingPong` accept finite repetitions or
`Infinity`. Use `paused`, `timeScale`, and effective weight deliberately; action
weights combine when actions target the same binding.

Listen for mixer `loop` and `finished` events when application state depends on
playback completion. Keep each listener function so teardown can call
`mixer.removeEventListener(type, listener)`.
[r186 AnimationAction](https://github.com/mrdoob/three.js/blob/r186/src/animation/AnimationAction.js)

`action.time` seeks within one clip; use `mixer.update(0)` to evaluate the
new pose without advancing time. `action.timeScale = -1` plays backward; for
a fresh reverse one-shot, reset it, set `time = clip.duration`, then set the
negative time scale before playing. `paused = true` freezes sampling time while
retaining the current weighted contribution. `stop()` releases the action's
bindings, restoring their original values when no other active action owns them;
it is not equivalent to holding the last pose.
[r186 action time and activation](https://github.com/mrdoob/three.js/blob/r186/src/animation/AnimationAction.js),
[r186 binding restoration](https://github.com/mrdoob/three.js/blob/r186/src/animation/AnimationMixer.js)

## Safe fades and additive layers

Prepare and activate a reused target before scheduling a crossfade:

```js
function crossFade(from, to, seconds) {
  to.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  from.crossFadeTo(to, seconds, false);
}
```

Passing `true` as the final argument temporarily warps both time scales to align
clips of different durations. Enable it only when that synchronization is
wanted. A plain `to.play()` is unsafe if the target previously finished, faded,
or was disabled. [r186 blending example](https://github.com/mrdoob/three.js/blob/r186/examples/webgl_animation_skinning_blending.html)

For a one-sided entrance, prepare the target the same way, then call
`to.fadeIn(seconds).play()` instead of scheduling a crossfade. Pair it with
`from.fadeOut(seconds)` for an explicit handoff, or use `crossFadeTo()`, not both.
Fades multiply the action's base weight; they do not activate an action or
rewind a previously completed one. Avoid fading an action to itself.
[r186 fading](https://github.com/mrdoob/three.js/blob/r186/src/animation/AnimationAction.js)

Convert a cloned clip before creating its action because conversion mutates the
clip and establishes additive blend mode:

```js
const additiveClip = sourceClip.clone();
THREE.AnimationUtils.makeClipAdditive(additiveClip, 0, sourceClip, 30);
const baseAction = mixer.clipAction(baseClip).play();
const additiveAction = mixer.clipAction(additiveClip);
additiveAction.setEffectiveWeight(0.35).play();
```

Choose the reference frame, reference clip, and frames-per-second to match the
source data. The utility omits boolean and string tracks. Do not convert a clip
already used by normal actions.
[r186 AnimationUtils](https://github.com/mrdoob/three.js/blob/r186/src/animation/AnimationUtils.js)

### Continuous weighted blending

For a locomotion blend, activate both actions once and change weights only when
the input changes. Compatible tracks mix their sampled values; weights do not
synchronize footfalls or clip phases. Choose compatible clips or align their
timing deliberately. Normal blending uses the original bound value for any
remaining weight below one; weights above one are normalized per binding.
[r186 PropertyMixer weights](https://github.com/mrdoob/three.js/blob/r186/src/animation/PropertyMixer.js)

<!-- check: animation-weighted-blend -->
```js
import * as THREE from 'three';

function createLocomotionBlend(root, idleClip, runClip) {
  const mixer = new THREE.AnimationMixer(root);
  const idle = mixer.clipAction(idleClip).setEffectiveWeight(1).play();
  const run = mixer.clipAction(runClip).setEffectiveWeight(0).play();
  function setBlend(amount) {
    const weight = THREE.MathUtils.clamp(amount, 0, 1);
    idle.setEffectiveWeight(1 - weight);
    run.setEffectiveWeight(weight);
  }
  function dispose() {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
  }
  return { mixer, setBlend, dispose };
}
```

Pass distinct clips bound to the same compatible root. The application advances
the returned mixer once per frame. This owner releases animation bindings only.

## Loaded clips and independent characters

Start after asset loading has returned `{ scene, animations }`; transport,
decoders, cancellation, lights, and resource ownership belong to asset loading
and rendering through the skill index. Find a clip by name, create a mixer for
the loaded root, activate its action, then include that mixer in the shared loop.

For another independently posed skinned character, use
`SkeletonUtils.clone(model)` from `three/addons/utils/SkeletonUtils.js`, not
`model.clone()`, and create a separate mixer for the copy. Clone a root containing
every required bone. Clips can be shared; cloned skinned hierarchies get independent
skeletons but still share geometry and materials. Retiring one character must not
dispose resources still used by the others.
[r186 SkeletonUtils ownership](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/utils/SkeletonUtils.js#L384-L427)

## Skeletons and procedural bones

A loaded root may contain several `SkinnedMesh` objects. Traverse once, collect
them with `object.isSkinnedMesh`, and cache required bones from each
`mesh.skeleton.bones`. Do not assume the first skinned mesh owns every bone.
`SkeletonHelper` is useful for inspection and must be removed and disposed when
no longer needed.

Mixer updates write animated bindings into the scene graph. Apply a deliberate
procedural bone override after `mixer.update(delta)` and before rendering. If the
motion must blend instead of replace a channel, author a compatible additive
clip. Attachments may be parented to a cached bone; set their local transform for
that bone's space.
[r186 AnimationMixer update](https://github.com/mrdoob/three.js/blob/r186/src/animation/AnimationMixer.js)
[r186 SkinnedMesh](https://github.com/mrdoob/three.js/blob/r186/src/objects/SkinnedMesh.js)

## Morph targets

`morphTargetInfluences` and `morphTargetDictionary` are undefined when a mesh has
no morph attributes. Guard both and verify the named index before assigning:

```js
const weights = mesh.morphTargetInfluences;
const index = mesh.morphTargetDictionary?.smile;
if (weights && index !== undefined) weights[index] = 0.75;
```

If both a mixer and procedural code write the same influence, the later write
wins. Prefer a numeric track for authored playback and a separate influence or
additive animation for intentional layering.

Zero is the base shape and one the full target; intermediate weights blend
between them. Cache the validated weights/index once for procedural playback,
then assign e.g. `(Math.sin(elapsed * 2) + 1) / 2` after the mixer update. Morph
attribute authoring, relative versus absolute targets, vertex correspondence,
and `mesh.updateMorphTargets()` belong to geometry through the skill index.

## Procedural motion

Use elapsed seconds for absolute oscillations, delta seconds for integration,
and exponential damping for a smooth approach. A constant per-frame lerp factor
changes its response with refresh rate. This helper allocates nothing during
updates; call it after any mixer writing the same scale:

<!-- check: animation-procedural-damp -->
```js
import * as THREE from 'three';

function createScaleApproach(object) {
  let scale = object.scale.x; // This controller owns a uniform scale.
  return function updateScale(target, deltaSeconds) {
    scale = THREE.MathUtils.damp(scale, target, 4, deltaSeconds);
    object.scale.setScalar(scale);
  };
}
```

[r186 MathUtils.damp](https://github.com/mrdoob/three.js/blob/r186/src/math/MathUtils.js)

## WebGPU and TSL boundary

Clips, mixers, bone transforms, and morph influences are CPU-side and work with
either renderer. Node materials and TSL motion use the WebGPU-capable renderer,
including its WebGL fallback, not classic `WebGLRenderer`. Rendering through
the index owns renderer initialization, the single loop, and async teardown.

TSL `time` and `deltaTime` are renderer-updated seconds. `oscSine`, `oscSquare`,
`oscTriangle`, and `oscSawtooth` produce 0–1 waves with a one-second period from
their time input (default `time`); `oscSine(time.mul(0.5))` has a two-second period.
They can animate color as well as geometry without a JavaScript time-uniform
assignment on every frame.
[r186 timer nodes](https://github.com/mrdoob/three.js/blob/r186/src/nodes/utils/Timer.js),
[r186 oscillators](https://github.com/mrdoob/three.js/blob/r186/src/nodes/utils/Oscillators.js)

Renderer time is independent of an application's `Timer` and mixer time.
An explicitly controlled uniform is appropriate when GPU motion must share a
clip's pause, seek, or time-scale behavior; built-in `time` alone does not provide
that synchronization.

This factory is for an **unskinned, non-morphed, non-instanced** subdivided plane.
Its local Z displacement follows the plane's local normal; rotate the mesh to
orient the effect. The caller owns and disposes the returned material.

<!-- check: animation-tsl-ripple -->
```js
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { color, mix, oscSine, positionGeometry, time, vec3 } from 'three/tsl';

function createRippleMaterial() {
  const material = new MeshBasicNodeMaterial({ wireframe: true });
  const offset = positionGeometry.x.mul(2).sin().mul(time.mul(2).cos()).mul(0.2);
  material.positionNode = positionGeometry.add(vec3(0, 0, offset));
  material.colorNode = mix(color(0x202030), color(0xffd24a), oscSine());
  return material;
}
```

Do not assume `positionLocal` inside r186's separately built `positionNode`
contains prior skinning, morphing, batching, or instancing. `positionGeometry`
reads the raw attribute; using it also replaces those transforms unless the
graph explicitly composes them. Route deformation of animated rigs to shaders
and TSL through the index. GPU displacement does not update CPU bounds or
raycasting: expand bounds conservatively and use a matching CPU proxy if needed.
[r186 position sub-build](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/NodeMaterial.js#L766-L810),
[r186 sub-build isolation](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/SubBuildNode.js),
[r184 → r185 positionNode migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185)

## Lifecycle, culling, and performance

- Update each active mixer once with the frame delta; never sample the timer in
  separate subsystem loops.
- Cache actions, bones, morph indices, and scratch objects outside the frame.
- Stop every action before `uncacheAction`, `uncacheClip`, or `uncacheRoot`.
  `mixer.stopAllAction()` is convenient when one mixer owns one root. Uncache a
  clip only after all actions using that clip have stopped, because it removes
  every cached action for that clip.
- Remove mixer event listeners and dispose the timer during teardown.
- A skinned mesh's lazily computed bounding sphere does not automatically follow
  later poses. For tight dynamic bounds, update the rig's world matrices after
  mixer/procedural changes, then call each affected mesh's
  `computeBoundingSphere()` before culling or picking. This scans vertices; prefer
  a conservative authored `mesh.boundingSphere` when available. Disabling
  `frustumCulled` avoids render culling but does not fix stale raycast bounds.
  [r186 skinned bounds](https://github.com/mrdoob/three.js/blob/r186/src/objects/SkinnedMesh.js#L103-L157)
- `frustumCulled` controls rendering, not animation evaluation. Render callbacks
  cannot detect an object becoming culled because callbacks run only for rendered
  objects. `Object3D.intersectsFrustum()` is an override hook, not a visibility query
  for a whole animated root or its descendants. [r186 Object3D hook](https://github.com/mrdoob/three.js/blob/r186/src/core/Object3D.js#L1063-L1072),
  [r186 WebGL render culling](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js#L1892-L1914)
- Apply distance/visibility policy in the application update loop or in a
  deliberate lower-frequency culling pass. Pause an action only when freezing
  its local time is correct; otherwise keep simulation advancing and skip only
  rendering.
- Bound large deltas after a deliberate suspension if the application cannot
  safely advance animation by the full elapsed interval.

## Official sources

- [r186 Timer and animation system](https://github.com/mrdoob/three.js/blob/r186/src/core/Timer.js)
- [r186 tracks, mixers, and actions](https://github.com/mrdoob/three.js/tree/r186/src/animation)
- [r186 animation manual](https://github.com/mrdoob/three.js/blob/r186/manual/pages/animation-system.html)
- [Migration guide: 182→183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)
