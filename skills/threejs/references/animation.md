# Animation — Three.js 0.185.1

## Scope

Use this reference for frame timing, clips, tracks, mixers, actions, fades,
additive layers, skeletons, procedural bone overrides, and morph playback.
Asset loading owns GLTF transport and decoder configuration; begin here once it
returns an `Object3D` root and its `AnimationClip[]`.

## Decisions and invariants

- Target Three.js 0.185.1 exactly.
- Use `THREE.Timer`, not deprecated `Clock`. `Clock` was deprecated in r183;
  `Timer` is a core export in 0.185.1.
  [r182 → r183 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)
  [revision 185 Timer](https://github.com/mrdoob/three.js/blob/r185/src/core/Timer.js)
- Connect the timer to `document` for Page Visibility handling, update it once at
  the start of each frame, then reuse that frame's delta and elapsed values.
- Times, clip durations, mixer updates, fades, and warps use seconds.
- A clip contains typed tracks. A mixer has one default root and one global time;
  actions may use `clipAction()`'s optional alternative root. Use separate mixers
  for independently timed roots. An action is the mixer's cached playback
  control for one clip/root pair.
  [revision 185 AnimationMixer](https://github.com/mrdoob/three.js/blob/r185/src/animation/AnimationMixer.js#L550-L610)
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
The official revision 185 blending example combines it with `Timer` and
`AnimationMixer.update()`.
[revision 185 blending example](https://github.com/mrdoob/three.js/blob/r185/examples/webgl_animation_skinning_blending.html)

## Tracks, bindings, and clips

Use one value per key for scalar, boolean, and string tracks; three for vectors
and colors; four for quaternions. Quaternion samples must be normalized. [revision 185 QuaternionKeyframeTrack](https://github.com/mrdoob/three.js/blob/r185/src/animation/tracks/QuaternionKeyframeTrack.js)

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
[revision 185 PropertyBinding](https://github.com/mrdoob/three.js/blob/r185/src/animation/PropertyBinding.js)
[revision 185 Mesh morph fields](https://github.com/mrdoob/three.js/blob/r185/src/objects/Mesh.js)

Use `InterpolateLinear`, `InterpolateSmooth`, or `InterpolateDiscrete` only when
supported by the track type. Boolean and string tracks are discrete. Quaternion
tracks use quaternion interpolation. Do not describe `InterpolateSmooth` as glTF
`CUBICSPLINE`; loader-created spline tracks use specialized interpolants. [revision 185 KeyframeTrack](https://github.com/mrdoob/three.js/blob/r185/src/animation/KeyframeTrack.js)

Pass `-1` as clip duration to infer it from the final track keys. Calling
`clip.resetDuration()` recalculates duration; it does not seek. Seek one action
with `action.reset()` or `action.time = 0`, and seek the whole mixer with
`mixer.setTime(0)`.
[revision 185 AnimationClip](https://github.com/mrdoob/three.js/blob/r185/src/animation/AnimationClip.js)

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
[revision 185 AnimationAction](https://github.com/mrdoob/three.js/blob/r185/src/animation/AnimationAction.js)

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
or was disabled. [revision 185 blending example](https://github.com/mrdoob/three.js/blob/r185/examples/webgl_animation_skinning_blending.html)

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
[revision 185 AnimationUtils](https://github.com/mrdoob/three.js/blob/r185/src/animation/AnimationUtils.js)

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
[revision 185 AnimationMixer update](https://github.com/mrdoob/three.js/blob/r185/src/animation/AnimationMixer.js)
[revision 185 SkinnedMesh](https://github.com/mrdoob/three.js/blob/r185/src/objects/SkinnedMesh.js)

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
  objects. [revision 185 WebGLRenderer](https://github.com/mrdoob/three.js/blob/r185/src/renderers/WebGLRenderer.js)
- Apply distance/visibility policy in the application update loop or in a
  deliberate lower-frequency culling pass. Pause an action only when freezing
  its local time is correct; otherwise keep simulation advancing and skip only
  rendering.
- Bound large deltas after a deliberate suspension if the application cannot
  safely advance animation by the full elapsed interval.

## Official sources

- [revision 185 Timer and animation system](https://github.com/mrdoob/three.js/blob/r185/src/core/Timer.js)
- [revision 185 tracks, mixers, and actions](https://github.com/mrdoob/three.js/tree/r185/src/animation)
- [revision 185 animation manual](https://github.com/mrdoob/three.js/blob/r185/manual/en/animation-system.html)
- [Migration guide: 182→183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)
