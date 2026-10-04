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

## Lifecycle, culling, and performance

- Update each active mixer once with the frame delta; never sample the timer in
  separate subsystem loops.
- Cache actions, bones, morph indices, and scratch objects outside the frame.
- Stop every action before `uncacheAction`, `uncacheClip`, or `uncacheRoot`.
  `mixer.stopAllAction()` is convenient when one mixer owns one root. Uncache a
  clip only after all actions using that clip have stopped, because it removes
  every cached action for that clip.
- Remove mixer event listeners and dispose the timer during teardown.
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
