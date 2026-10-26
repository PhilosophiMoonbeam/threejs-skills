# Interaction and Controls in Three.js 0.186.1

## Scope

Use this reference for pointer coordinates, raycasting, selection, and the 0.186.1 addon controls. Rendering, camera construction, materials, animation systems, and physics belong to their named topics.

## Decisions and invariants

- Normalize every pointer against `renderer.domElement.getBoundingClientRect()`, not the window.
- Keep one `Raycaster`, pointer vector, result array, and scratch vectors per interaction owner.
- Decide whether selection owns the intersected leaf or a logical model root.
- Use layers deliberately: rendering and raycasting apply separate layer tests.
- Pass the frame delta in seconds to controls whose motion depends on time.
- Store listener function identities and remove those same functions during teardown.
- Import examples only through `three/addons/...`.

## Canonical pointer and picking pattern

<!-- check: picking -->
```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = renderer.domElement;
const previousCursor = canvas.style.cursor;
const pointer = new THREE.Vector2();
const pointerClient = { clientX: 0, clientY: 0 };
const raycaster = new THREE.Raycaster();
const hits = [];
const selectable = [modelRoot];
let pointerInside = false;
let pointerDirty = false;
let selected = null;
let hovered = null;

function updateHover(hit) {
  hovered = hit?.object ?? null;
  canvas.style.cursor = hovered ? 'pointer' : previousCursor;
}

function invalidatePicking() {
  pointerDirty = true;
}

function pointerToNDC(event) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  return pointer;
}

function pickNearest(event) {
  if (event) {
    pointerClient.clientX = event.clientX;
    pointerClient.clientY = event.clientY;
  }
  if (!pointerToNDC(pointerClient)) return null;
  camera.updateWorldMatrix(true, false);
  for (const root of selectable) root.updateWorldMatrix(true, true);
  raycaster.setFromCamera(pointer, camera);
  hits.length = 0; // A supplied result array is appended to, not cleared.
  raycaster.intersectObjects(selectable, true, hits);
  return hits[0] ?? null;
}

function onPointerMove(event) {
  pointerClient.clientX = event.clientX;
  pointerClient.clientY = event.clientY;
  pointerInside = true;
  invalidatePicking();
}

function onPointerLeave() {
  pointerInside = false;
  pointerDirty = false;
  updateHover(null);
}

function onPointerDown(event) {
  const hit = pickNearest(event);
  selected = hit?.object.userData.selectionOwner ?? hit?.object ?? null;
}

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.addEventListener('change', invalidatePicking);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerleave', onPointerLeave);
canvas.addEventListener('pointercancel', onPointerLeave);
canvas.addEventListener('pointerdown', onPointerDown);

// Called by the application's single frame loop after updating object transforms.
function render(deltaSeconds) {
  if (controls.enabled) controls.update(deltaSeconds);
  if (pointerInside && pointerDirty) {
    pointerDirty = false;
    updateHover(pickNearest());
  }
  renderer.render(scene, camera);
}

function disposeInteraction() {
  controls.removeEventListener('change', invalidatePicking);
  canvas.removeEventListener('pointermove', onPointerMove);
  canvas.removeEventListener('pointerleave', onPointerLeave);
  canvas.removeEventListener('pointercancel', onPointerLeave);
  canvas.removeEventListener('pointerdown', onPointerDown);
  controls.dispose();
  canvas.style.cursor = previousCursor;
}
```

Refresh matrices before a pick, including before the first render. Call `invalidatePicking()` after model animation, camera changes outside controls, and resize; a stationary pointer can gain or lose a hit. The targeted world updates honor the core matrix-invalidation contract. [r186 Raycaster](https://github.com/mrdoob/three.js/blob/r186/src/core/Raycaster.js), [r186 Object3D](https://github.com/mrdoob/three.js/blob/r186/src/core/Object3D.js)

Use pointer events for mouse, pen, and touch. Set `canvas.style.touchAction = "none"` when application gestures must suppress browser panning. For a drag, call `setPointerCapture(event.pointerId)` on pointer down, release it on pointer up, and clear drag/key state on `pointercancel`, `blur`, or control unlock.

## Raycaster in 0.186.1

- `setFromCamera(ndc, camera)` accepts normalized device coordinates and a perspective or orthographic camera. For `set(origin, direction)`, normalize `direction`.
- `intersectObject(object, recursive = true, target = [])` and `intersectObjects(objects, recursive = true, target = [])` return nearest-first results. `false` tests only supplied objects; a supplied `Group` normally needs recursion.
- A rejected parent's layer does not prune recursion; descendants are tested independently.
- Set `near` and `far` to restrict accepted distances. Tune `params.Line.threshold` and `params.Points.threshold` in world units.
- Mesh back faces are not hit with the default front-side material; use the material's `side` setting intentionally.
- Raycasting does not reject `visible = false` objects; filter eligibility in the
  application or use layers. A shared triangle edge can yield coincident hits.

Treat an intersection as a type-dependent union, not as a fixed record:

- All hits have `distance`, world-space `point`, and `object`.
- Mesh hits may have `face` as `{ a, b, c, normal, materialIndex }`, `faceIndex`, `uv`, `uv1`, interpolated `normal`, and `barycoord`. `point` is world-space; `face.normal` and interpolated `normal` are object-local (the latter is oriented toward the ray). Transform a normal with the object's world normal matrix before using it as a world direction. There is no core `Face3` in 0.186.1. Attribute-derived values exist only when the geometry supplies the attributes.
- Line and Points hits use `index`; Points also uses `distanceToRay`. Their face fields are `null`.
- `InstancedMesh` adds `instanceId`; `BatchedMesh` adds `batchId`.

These shapes and recursive defaults are defined by the [revision 186 Raycaster source](https://github.com/mrdoob/three.js/blob/r186/src/core/Raycaster.js), [revision 186 Mesh source](https://github.com/mrdoob/three.js/blob/r186/src/objects/Mesh.js), [revision 186 Line source](https://github.com/mrdoob/three.js/blob/r186/src/objects/Line.js), [revision 186 Points source](https://github.com/mrdoob/three.js/blob/r186/src/objects/Points.js), [revision 186 InstancedMesh source](https://github.com/mrdoob/three.js/blob/r186/src/objects/InstancedMesh.js), and [revision 186 BatchedMesh source](https://github.com/mrdoob/three.js/blob/r186/src/objects/BatchedMesh.js).

The official `GaussianSplat` addon implements CPU raycasting against covariance ellipsoids.
Its hits have `index` (splat ID), `distance`, world-space `point`, and `object`, with null
`face`, `faceIndex`, and `barycoord`; they do not identify mesh triangles or expose UVs.
Very faint splats are skipped, and the hit approximation is not exact blended-pixel coverage.
After the bounds test it scans splats, so use narrow target arrays or selection proxies for large
captures rather than assuming GPU rendering also accelerates picking. Wait for loader readiness.
[r186 GaussianSplat raycast](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/objects/GaussianSplat.js)

## Layers and selection

For an additional picking-only layer, preserve normal rendering membership:

```js
pickable.layers.enable(1); // Keeps default layer 0 too.
raycaster.layers.set(1);
```

`pickable.layers.set(1)` removes layer 0, so a default camera no longer renders it. If exclusive membership is intended, enable the same layer on the camera. See the [Raycaster layers example](https://threejs.org/docs/pages/Raycaster.html#layers).

Recursive hits identify descendant meshes. Put a logical owner in `child.userData.selectionOwner`, or walk parents to a known root. Selection highlighting must save and restore exact previous state; account for material arrays, non-emissive materials, and shared materials rather than forcing emissive black.

For box selection, import `SelectionBox` and `SelectionHelper` from `three/addons/interactive/...`. Convert drag endpoints with the same canvas-relative NDC formula. Style the helper-created element; it is otherwise only an unstyled `div`:

```css
.selectBox { position: fixed; border: 1px solid #55aaff; background: #55aaff33; pointer-events: none; }
```

`selectionBox.collection` contains selected objects; `selectionBox.instances[uuid]` and `selectionBox.batches[uuid]` contain selected IDs for instanced and batched meshes. Selection tests geometry bounding-sphere centers for ordinary objects and transform origins for instanced or batched instances; it does not test triangle overlap. `select()` clears `collection`, but not the instance or batch result maps. Before selection when the traversed hierarchy can change, reset `selectionBox.instances = {}` and `selectionBox.batches = {}`, or filter their keys to current objects. Remove custom document listeners and call `selectionHelper.dispose()`. See the [revision 186 SelectionBox source](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/interactive/SelectionBox.js).

For `BatchedMesh`, `selectionBox.batches[uuid]` reports logical instance IDs,
not geometry IDs or draw-order indices. r186 box selection cannot traverse a
batch containing deleted instance slots: its loop expects
`validateInstanceId(id)` to return `false`, but that method throws for a deleted
ID, aborting selection even when other instances remain active. Use this addon
only with batches without deleted slots in the traversed hierarchy; filtering
results afterward cannot prevent the exception. This is an addon limitation,
not a requirement to patch or suppress errors in `BatchedMesh`.
[r186 SelectionBox batch loop](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/interactive/SelectionBox.js#L268-L290),
[r186 batch validation](https://github.com/mrdoob/three.js/blob/r186/src/objects/BatchedMesh.js#L453-L458)

For an operational rectangle query, reuse one picker and call `select()` once
when the captured drag ends. Inputs are `{ clientX, clientY }` pairs saved at
pointer down/up, not drawing-buffer pixels. The result array and ID maps belong
to the picker and are replaced by the next selection; copy only when persisting
a selection. Run only in a deliberate selection mode with camera gestures
disabled; this query does not install event listeners.

<!-- check: box-selection -->
```js
import { SelectionBox } from 'three/addons/interactive/SelectionBox.js';

function createBoxPicker(camera, scene, canvas) {
  const selectionBox = new SelectionBox(camera, scene, camera.far);
  function select(start, end) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    selectionBox.startPoint.set(
      ((start.clientX - rect.left) / rect.width) * 2 - 1,
      -((start.clientY - rect.top) / rect.height) * 2 + 1, 0.5,
    );
    selectionBox.endPoint.set(
      ((end.clientX - rect.left) / rect.width) * 2 - 1,
      -((end.clientY - rect.top) / rect.height) * 2 + 1, 0.5,
    );
    camera.updateWorldMatrix(true, false);
    scene.updateWorldMatrix(true, true);
    selectionBox.instances = {};
    selectionBox.batches = {};
    return selectionBox.select();
  }
  return { selectionBox, select };
}
```

Create `new SelectionHelper(renderer, 'selectBox')` only while selection mode is
active; it connects to the canvas immediately and expects it to have a parent
element. Its rectangle uses client coordinates, hence the fixed-position CSS.
The helper does not capture pointers or handle cancellation: the application's
named `pointercancel`, `lostpointercapture`, and `blur` handlers must end the
gesture, set `helper.isDown = false`, and remove `helper.element`; use
`helper.dispose()` at mode teardown. Remove those application handlers too.

`SelectionBox` does not apply Raycaster layers, visibility, or occlusion rules;
filter its results according to the application's selection policy. Its r186
orthographic path hardcodes near/far NDC at `-1`/`1`: use a non-reversed,
WebGL-coordinate orthographic projection, or an application selection frustum
adapted to the actual projection. Do not assume WebGPU orthographic or
reversed-depth box selection is renderer-neutral.
[r186 SelectionBox projection and traversal](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/interactive/SelectionBox.js#L136-L321),
[r186 SelectionHelper lifecycle](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/interactive/SelectionHelper.js)

## Ray-to-plane and screen coordinates

Reuse the raycaster and destination, and handle a miss:

```js
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const worldPoint = new THREE.Vector3();
function pointerOnPlane(event) {
  const ndc = pointerToNDC(event);
  if (!ndc) return null;
  camera.updateWorldMatrix(true, false);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(plane, worldPoint); // Vector3 | null
}
```

A miss means the ray is parallel or the intersection lies behind it. Snapping
`object.position.y = 0` is local-space snapping, not a world-ground constraint
for a transformed parent. To place a picked world point, first copy it to a
scratch vector, update the parent's world matrix, then use
`object.position.copy(object.parent.worldToLocal(scratch))`; without a parent,
copy the world point directly. Do not mutate a hit point that other consumers
still need.
[r186 Ray.intersectPlane](https://github.com/mrdoob/three.js/blob/r186/src/math/Ray.js),
[r186 Object3D coordinate conversion](https://github.com/mrdoob/three.js/blob/r186/src/core/Object3D.js)

For world-to-screen overlays, cache the canvas CSS rectangle outside the frame
loop. Refresh it on resize, scroll, or layout changes. Supply a world position
and a reusable `Vector2` destination; a null result hides an out-of-frustum
overlay. Update changed scene/camera matrices before projecting. This helper
handles the camera's actual WebGL/WebGPU depth convention, including reversed
depth; do not blindly test all projections against Z in `[-1, 1]`.

<!-- check: screen-projection -->
```js
import * as THREE from 'three';

function createScreenProjector(camera, canvas) {
  const point = new THREE.Vector3();
  let left = 0, top = 0, width = 0, height = 0;
  function updateViewport() {
    const rect = canvas.getBoundingClientRect();
    left = rect.left; top = rect.top;
    width = rect.width; height = rect.height;
  }
  function project(worldPosition, target) {
    if (width <= 0 || height <= 0) return null;
    point.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse);
    if (camera.isPerspectiveCamera && point.z >= 0) return null;
    point.applyMatrix4(camera.projectionMatrix);
    const minZ = camera.coordinateSystem === THREE.WebGLCoordinateSystem
      && !camera.reversedDepth ? -1 : 0;
    if (point.x < -1 || point.x > 1 || point.y < -1 || point.y > 1
      || point.z < minZ || point.z > 1) return null;
    return target.set(left + (point.x + 1) * width / 2, top + (1 - point.y) * height / 2);
  }
  updateViewport();
  return { project, updateViewport };
}
```

[r186 camera projection](https://github.com/mrdoob/three.js/blob/r186/src/cameras/PerspectiveCamera.js),
[r186 NDC depth conventions](https://github.com/mrdoob/three.js/blob/r186/src/math/Matrix4.js#L1140-L1246)

## Controls lifecycle

Addon control constructors given a DOM element connect immediately. `enabled = false` suppresses input but leaves listeners installed. Use `disconnect()` for a temporary detach, `connect(element)` to attach again, and `dispose()` for permanent teardown. `connect()` requires the element in 0.186.1; this cutover is documented in [r174 → r175](https://github.com/mrdoob/three.js/wiki/Migration-Guide#174--175). Remove application-owned listeners and helpers separately, except the TransformControls helper owned by its control. A control's `dispose()` does not dispose its camera, scene objects, or their materials.

### OrbitControls and MapControls

Import from `three/addons/controls/OrbitControls.js` or `MapControls.js`. Configure `target`, distance/zoom limits, polar and azimuth limits, and `enableRotate`, `enableZoom`, or `enablePan`. Damping requires `update()` every frame while it settles. Auto-rotation also requires `update()` every frame; pass `deltaSeconds` to `update(deltaSeconds)` for refresh-rate-independent auto-rotation. With no auto-rotation, the delta argument is optional. MapControls follows the same update and lifecycle contract. In a shared `renderer.setAnimationLoop` callback, derive one frame delta and pass that same value to every time-dependent subsystem. See [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html), [MapControls](https://threejs.org/docs/pages/MapControls.html), and the [revision 186 OrbitControls source](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/OrbitControls.js).

`zoomToCursor = true` directs wheel zoom toward the pointer. `change` reports
camera changes; `start`/`end` bracket gestures. MapControls defaults left drag to
pan and right drag to orbit, with `screenSpacePanning = false` for ground-parallel
panning. `TrackballControls.staticMoving = true` disables its inertia; otherwise
tune `dynamicDampingFactor`. Disabling input does not stop a control's explicit
`update()` from applying damping or auto-rotation: skip camera-control updates
while another tool owns the camera.
[r186 OrbitControls](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/OrbitControls.js),
[r186 MapControls](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/MapControls.js)

### TrackballControls

Import from `three/addons/controls/TrackballControls.js` for orbiting without a fixed camera-up
direction. Call `update()` each frame while damping settles, and `handleResize()` after canvas
layout changes. One touch rotates; two or more touches zoom and pan. In r186,
`multiTouchRoll = true` additionally enables a two-finger twist around the view axis
(`rollSpeed`, default `1`); `noRotate` disables that rotation too. This is optional roll,
not a replacement for one-finger orbiting. Use the same connect/disconnect/dispose lifecycle.
[r186 TrackballControls](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/TrackballControls.js)

### On-demand rendering

Use the coalesced scheduler owned by core rendering, routed through the skill index. Connect the controls' `change` event to its invalidation callback. With damping, call `controls.update()` inside the scheduled frame so changes schedule subsequent frames until settling; never render synchronously from `change`. Auto-rotation requires continuous updates. Invalidate both picking and rendering when scene state changes. [Official on-demand pattern](https://threejs.org/manual/en/rendering-on-demand.html)

### FlyControls and FirstPersonControls

Both require `update(deltaSeconds)` every frame. Use `THREE.Timer`, call `timer.update(timestamp)`, then read `timer.getDelta()`; `Clock` was deprecated in r183 ([r182 → r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)). FlyControls exposes `movementSpeed`, `rollSpeed`, `autoForward`, and `dragToLook`. See the [revision 186 Timer source](https://github.com/mrdoob/three.js/blob/r186/src/core/Timer.js) and [FlyControls source](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/FlyControls.js).

FirstPersonControls exposes `movementSpeed`, `lookSpeed`, `lookVertical`, vertical constraints, `dampingFactor`, and `lookAt()`. In 0.186.1, WASD/arrows move in the world XZ plane using camera yaw only; R/F move along world Y. Combined keyboard input is normalized, so diagonals are not faster. Mouse/touch movement instead follows the full look direction: left/right mouse and one/two touches move forward/backward; while a forward/back key is held, mouse presses only look. Pointer-captured drag offsets drive continuous look. Do not call deprecated `handleResize()`. The pointer interaction model arrived in [r183 → r184](https://github.com/mrdoob/three.js/wiki/Migration-Guide#183--184); world-axis keyboard movement and R/F are r186 behavior. Use an untransformed camera parent for these world-axis assumptions. [revision 186 FirstPersonControls](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/FirstPersonControls.js)

### PointerLockControls

Call `lock()` only from a user activation. Use `isLocked`, `unlock()`, `moveForward(distance)`, `moveRight(distance)`, `pointerSpeed`, and polar limits; `lock(true)` optionally requests raw movement. Maintain mutable key state with `let` or an object, handle both keydown and keyup, and clear it on `unlock` and `blur`:

```js
const moving = { forward: false, back: false };
function onKey(event) {
  const down = event.type === "keydown";
  if (event.code === "KeyW") moving.forward = down;
  if (event.code === "KeyS") moving.back = down;
}
function updatePointerLock(delta) {
  if (!controls.isLocked) return;
  controls.moveForward(((moving.forward ? 1 : 0) - (moving.back ? 1 : 0)) * speed * delta);
}
```

Register named `keydown`, `keyup`, `blur`, `lock`, and `unlock` handlers and remove them at teardown. See [PointerLockControls revision 186](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/PointerLockControls.js).

`controls.object` is the managed camera; the removed `getObject()` accessor is
not needed. With conventional world-up, `moveForward()` moves parallel to the
ground; `moveRight()` follows the camera's right axis. For eased movement, cache
a scalar speed and update it with `THREE.MathUtils.damp(current, target, lambda,
delta)`, then move by `speed * delta`; clear speed as well as keys on unlock and
blur. Camera motion is not collision detection or a physics controller.

### DragControls

```js
import { DragControls } from "three/addons/controls/DragControls.js";
const drag = new DragControls(objects, camera, renderer.domElement);
```

The `objects` array is mutable. Current configuration includes `recursive` (default `true`), `transformGroup`, `raycaster`, `mouseButtons`, `touches`, and `rotateSpeed`; left/middle default to pan and right to rotate. Listen for `hoveron`, `hoveroff`, `dragstart`, `drag`, and `dragend`. Use `connect(element)`, `disconnect()`, and `dispose()`; removed legacy accessors and `activate()`/`deactivate()` are not 0.186.1 APIs. See [DragControls revision 186](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/DragControls.js) and the [r167 → r168 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#167--168).

Panning uses a camera-facing plane; rotation uses camera up/right axes, not a
world-ground constraint. With `transformGroup = true`, pass the intended group
as the only draggable root; dragging selects the outermost ancestor Group, so
avoid unintended enclosing Groups. A drag event's object can be a Group without
a material. Pause competing camera input on `dragstart`, restore its previous
enabled state on `dragend` and teardown, and invalidate picking/rendering on
`drag`. Use the ray-to-plane pattern for a true world-ground drag rather than
clamping local Y. Preserve prior colors/material state when highlighting.

### TransformControls

<!-- check: transform-editor -->
```js
import { TransformControls } from 'three/addons/controls/TransformControls.js';

function createTransformEditor(camera, canvas, scene, orbit, object, invalidate) {
  const transform = new TransformControls(camera, canvas);
  const helper = transform.getHelper();
  scene.add(helper);
  transform.attach(object); // The object must already be in the scene graph.
  transform.setMode('translate');
  transform.setSpace('local');
  transform.setTranslationSnap(0.5);
  transform.setRotationSnap(Math.PI / 12);
  transform.setScaleSnap(0.25);
  let dragging = false;
  let orbitWasEnabled = orbit.enabled;
  function onDraggingChanged(event) {
    if (event.value && !dragging) {
      orbitWasEnabled = orbit.enabled;
      dragging = true;
      orbit.enabled = false;
    } else if (!event.value && dragging) {
      dragging = false;
      orbit.enabled = orbitWasEnabled;
    }
  }
  function dispose() {
    transform.removeEventListener('dragging-changed', onDraggingChanged);
    transform.removeEventListener('objectChange', invalidate);
    if (dragging) orbit.enabled = orbitWasEnabled;
    transform.detach();
    scene.remove(helper);
    transform.dispose(); // Owns helper geometry/material disposal.
  }
  transform.addEventListener('dragging-changed', onDraggingChanged);
  transform.addEventListener('objectChange', invalidate);
  return { transform, dispose };
}
```

Use `setMode('translate' | 'rotate' | 'scale')`, `setSpace('local' | 'world')`,
`setSize()`, `attach()`/`detach()`, and snapping methods. Rotation snap is radians;
scale always acts in local space. Supply an invalidation callback that updates
both picking and rendering after `objectChange`. If adding keyboard shortcuts
for modes or Escape/detach, keep named handlers and remove them at teardown.

If the helper uses a non-default layer, configure
`transform.getRaycaster().layers` to match. Do not add the controls object itself
to the scene, or independently dispose the helper: the control owns its geometry
and materials. Other application resources remain caller-owned.
[r168 → r169 helper migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#168--169),
[r186 TransformControls](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/TransformControls.js)

## WebGPU and GPU-deformation boundary

Camera controls and ordinary CPU Raycaster queries work with either renderer.
Core rendering through the skill index owns initialization of
`WebGPURenderer`; establish its camera projection before the first pick.
Both renderers use the same canvas-relative pointer X/Y, independent of device
pixel ratio. On final teardown stop the application loop before controls and
listeners; the WebGPU-capable renderer's loop shutdown/disposal is async.
[r186 common renderer lifecycle](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js)

CPU mesh raycasting includes core CPU-accessible morph/skinning transforms, but
not shader displacement or TSL `positionNode`/GPU-only compute changes. Pick a
deliberately sized CPU proxy, reproduce the deformation on the CPU, or choose a
separate GPU-picking design through the shaders/rendering topics in the index.
An undisplaced proxy is an approximation, not exact visible-surface coverage.
Refresh bounds after CPU deformation; GPU displacement also needs conservative
render bounds. SelectionBox has the projection restrictions stated above.
[r186 Mesh raycasting](https://github.com/mrdoob/three.js/blob/r186/src/objects/Mesh.js),
[r186 SkinnedMesh raycasting](https://github.com/mrdoob/three.js/blob/r186/src/objects/SkinnedMesh.js)

## Performance

- Raycast narrow target arrays, use layers, and use correctly sized simple proxy meshes for complex models.
- Invisible proxy materials still participate in CPU mesh raycasting. Core mesh raycasting checks a bounding sphere and a bounding box when one exists.
- Reuse result arrays and scratch objects. Clear a result target before each call.
- Coalesce hover work to one raycast per rendered frame; raycast activation events only when they occur.
- Disconnect controls that are temporarily unused and dispose controls on route or component teardown.

## Official sources

- [Raycaster documentation](https://threejs.org/docs/pages/Raycaster.html)
- [Controls documentation](https://threejs.org/docs/pages/Controls.html)
- [Official picking manual](https://threejs.org/manual/en/picking.html)
- [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
