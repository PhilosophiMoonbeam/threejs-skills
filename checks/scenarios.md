# Skill behavior evaluations

These cases evaluate agent decisions; the executable checks separately validate the documented examples. Run a case in a fresh temporary project with `three@0.185.1`. Give the agent the installed skill, prompt, and fixture only. Keep the acceptance criteria with the evaluator. Never let an evaluation commit, push, or edit this repository.

When comparing revisions, keep the model, configuration, prompt, and fixture identical. Record the skill revision, references read, input tokens when available, output diff, and observed behavior. Report skips and failures; syntax checks alone do not establish rendering correctness. These fixtures are a starting evaluation set, not evidence of a measured improvement in agent success rate.

## Narrow existing-code change

Prompt: “Make this sphere rougher. Preserve the rest of the application.”

Fixture: the core-rendering baseline in a working host, with its material replaced by `new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0 })` and a hemisphere light added. The package lock already pins `three@0.185.1`.

Acceptance: the requested material value changes, the scene still renders, and the agent preserves the renderer, dependency version, loop, and lifecycle. No unrelated application rebuild or migration is introduced. Record which references the agent read.

## Load completes after unmount

Prompt: “This viewer can unmount while loading. Make cancellation and cleanup correct, including when the loader ignores abort.”

Fixture: an existing scene owner with this application-level loading function; `releaseGLTF` correctly releases exclusively owned resources. A controllable loader promise can resolve after `dispose()`.

```js
function mountModel(loader, scene, releaseGLTF) {
  let asset;
  loader.loadAsync('/model.glb').then(value => {
    asset = value;
    scene.add(asset.scene);
  });
  return function dispose() {
    if (asset) {
      scene.remove(asset.scene);
      releaseGLTF(asset);
    }
  };
}
```

Acceptance: unmount before completion prevents attachment; a late successful result is released exactly once; failures are handled; live success remains owned until disposal. Cancellation affects only this owner's load. Exercise both completion/unmount orderings and remount into a fresh owner.

## Static viewer with damping and embedded resize

Prompt: “This static viewer wastes frames. Render on demand while preserving smooth controls, container resizing, and cleanup.”

Fixture: the core-rendering baseline without mesh rotation, hosted in a resizable panel. Add `OrbitControls` with `enableDamping = true`. The panel resizes without a window resize event.

Acceptance: initial output appears; control motion and damping render until settled; idle rendering stops; changing the panel size updates the drawing buffer and camera; asynchronous scene changes invalidate output. Teardown cancels queued frames and observers, and a late invalidation cannot restart rendering. The canvas remains owned by the host.
