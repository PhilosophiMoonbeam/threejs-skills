# Interaction and Controls

## Scope

Use this reference for pointer coordinates, raycasting, selection, and the 0.185.1 addon controls. Rendering, camera construction, materials, animation systems, and physics belong to their named topics.

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
function render() {
  controls.update();
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

Refresh matrices before a pick, including before the first render. Call `invalidatePicking()` after model animation, camera changes outside controls, and resize; a stationary pointer can gain or lose a hit. The targeted world updates honor the core matrix-invalidation contract. [r185 Raycaster](https://github.com/mrdoob/three.js/blob/r185/src/core/Raycaster.js), [r185 Object3D](https://github.com/mrdoob/three.js/blob/r185/src/core/Object3D.js)

Use pointer events for mouse, pen, and touch. Set `canvas.style.touchAction = "none"` when application gestures must suppress browser panning. For a drag, call `setPointerCapture(event.pointerId)` on pointer down, release it on pointer up, and clear drag/key state on `pointercancel`, `blur`, or control unlock.

## Raycaster in 0.185.1

- `setFromCamera(ndc, camera)` accepts normalized device coordinates and a perspective or orthographic camera. For `set(origin, direction)`, normalize `direction`.
- `intersectObject(object, recursive = true, target = [])` and `intersectObjects(objects, recursive = true, target = [])` return nearest-first results. `false` tests only supplied objects; a supplied `Group` normally needs recursion.
- A rejected parent's layer does not prune recursion; descendants are tested independently.
- Set `near` and `far` to restrict accepted distances. Tune `params.Line.threshold` and `params.Points.threshold` in world units.
- Mesh back faces are not hit with the default front-side material; use the material's `side` setting intentionally.

Treat an intersection as a type-dependent union, not as a fixed record:

- All hits have `distance`, world-space `point`, and `object`.
- Mesh hits may have `face` as `{ a, b, c, normal, materialIndex }`, `faceIndex`, `uv`, `uv1`, interpolated `normal`, and `barycoord`. There is no core `Face3` in 0.185.1. Attribute-derived values exist only when the geometry supplies the attributes.
- Line and Points hits use `index`; Points also uses `distanceToRay`. Their face fields are `null`.
- `InstancedMesh` adds `instanceId`; `BatchedMesh` adds `batchId`.

These shapes and recursive defaults are defined by the [revision 185 Raycaster source](https://github.com/mrdoob/three.js/blob/r185/src/core/Raycaster.js), [revision 185 Mesh source](https://github.com/mrdoob/three.js/blob/r185/src/objects/Mesh.js), [revision 185 Line source](https://github.com/mrdoob/three.js/blob/r185/src/objects/Line.js), [revision 185 Points source](https://github.com/mrdoob/three.js/blob/r185/src/objects/Points.js), [revision 185 InstancedMesh source](https://github.com/mrdoob/three.js/blob/r185/src/objects/InstancedMesh.js), and [revision 185 BatchedMesh source](https://github.com/mrdoob/three.js/blob/r185/src/objects/BatchedMesh.js).

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

`selectionBox.collection` contains selected objects; `selectionBox.instances[uuid]` and `selectionBox.batches[uuid]` contain selected IDs for instanced and batched meshes. Selection tests geometry bounding-sphere centers for ordinary objects and transform origins for instanced or batched instances; it does not test triangle overlap. `select()` clears `collection`, but not the instance or batch result maps. Before selection when the traversed hierarchy can change, reset `selectionBox.instances = {}` and `selectionBox.batches = {}`, or filter their keys to current objects. Remove custom document listeners and call `selectionHelper.dispose()`. See the [revision 185 SelectionBox source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/interactive/SelectionBox.js).

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

A miss means the ray is parallel or the intersection lies behind it. Snapping `object.position.y = 0` is local-space snapping, not a world-ground constraint for a transformed parent. To place a world point in canvas CSS pixels, call `object.getWorldPosition(scratch).project(camera)`, then map NDC through the canvas rectangle. See [`Ray.intersectPlane`](https://threejs.org/docs/pages/Ray.html#intersectPlane) and [`Object3D.getWorldPosition`](https://threejs.org/docs/pages/Object3D.html#getWorldPosition).

## Controls lifecycle

Addon control constructors given a DOM element connect immediately. `enabled = false` suppresses input but leaves listeners installed. Use `disconnect()` for a temporary detach, `connect(element)` to attach again, and `dispose()` for permanent teardown. `connect()` requires the element in 0.185.1; this cutover is documented in [r174 → r175](https://github.com/mrdoob/three.js/wiki/Migration-Guide#174--175). Remove application-owned listeners and helpers separately. A control's `dispose()` does not dispose its camera, scene objects, or materials.

### OrbitControls and MapControls

Import from `three/addons/controls/OrbitControls.js` or `MapControls.js`. Configure `target`, distance/zoom limits, polar and azimuth limits, and `enableRotate`, `enableZoom`, or `enablePan`. Damping requires `update()` every frame while it settles. Auto-rotation also requires `update()` every frame; pass `deltaSeconds` to `update(deltaSeconds)` for refresh-rate-independent auto-rotation. With no auto-rotation, the delta argument is optional. MapControls follows the same update and lifecycle contract. In a shared `renderer.setAnimationLoop` callback, derive one frame delta and pass that same value to every time-dependent subsystem. See [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html), [MapControls](https://threejs.org/docs/pages/MapControls.html), and the [revision 185 OrbitControls source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/controls/OrbitControls.js).

### On-demand rendering

Use the coalesced scheduler owned by core rendering, routed through the skill index. Connect the controls' `change` event to its invalidation callback. With damping, call `controls.update()` inside the scheduled frame so changes schedule subsequent frames until settling; never render synchronously from `change`. Auto-rotation requires continuous updates. Invalidate both picking and rendering when scene state changes. [Official on-demand pattern](https://threejs.org/manual/en/rendering-on-demand.html)

### FlyControls and FirstPersonControls

Both require `update(deltaSeconds)` every frame. Use `THREE.Timer`, call `timer.update(timestamp)`, then read `timer.getDelta()`; `Clock` was deprecated in r183 ([r182 → r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)). FlyControls exposes `movementSpeed`, `rollSpeed`, `autoForward`, and `dragToLook`. See the [revision 185 Timer source](https://github.com/mrdoob/three.js/blob/r185/src/core/Timer.js) and [FlyControls source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/controls/FlyControls.js).

FirstPersonControls exposes `movementSpeed`, `lookSpeed`, `lookVertical`, vertical constraints, `dampingFactor`, and `lookAt()`. In 0.185.1 it uses pointer capture: press-drag offsets continuous look; left/right mouse move forward/backward; one/two touches move forward/backward; WASD/arrows plus E/Q provide internal movement. Do not call deprecated `handleResize()`. This interaction model arrived in [r183 → r184](https://github.com/mrdoob/three.js/wiki/Migration-Guide#183--184); see the [revision 185 source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/controls/FirstPersonControls.js).

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

Register named `keydown`, `keyup`, `blur`, `lock`, and `unlock` handlers and remove them at teardown. See [PointerLockControls revision 185](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/controls/PointerLockControls.js).

### DragControls

```js
import { DragControls } from "three/addons/controls/DragControls.js";
const drag = new DragControls(objects, camera, renderer.domElement);
```

The `objects` array is mutable. Current configuration includes `recursive` (default `true`), `transformGroup`, `raycaster`, `mouseButtons`, `touches`, and `rotateSpeed`; left/middle default to pan and right to rotate. Listen for `hoveron`, `hoveroff`, `dragstart`, `drag`, and `dragend`. Use `connect(element)`, `disconnect()`, and `dispose()`; removed legacy accessors and `activate()`/`deactivate()` are not 0.185.1 APIs. See [DragControls revision 185](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/controls/DragControls.js) and the [r167 → r168 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#167--r168).

### TransformControls

```js
import { TransformControls } from "three/addons/controls/TransformControls.js";
const transform = new TransformControls(camera, renderer.domElement);
const helper = transform.getHelper();
scene.add(helper);
transform.attach(selectedObject);
function onDraggingChanged(event) {
  orbit.enabled = !event.value;
}
transform.addEventListener("dragging-changed", onDraggingChanged);
```

Use `attach()`, `detach()`, `setMode()`, `setSpace()`, snapping properties, and `setSize()`. If the helper uses a non-default layer, configure `transform.getRaycaster().layers` to match. On teardown, remove the application listener, detach, remove the helper, and call `dispose()`. Adding the controls object itself to the scene is obsolete since [r168 → r169](https://github.com/mrdoob/three.js/wiki/Migration-Guide#168--169); see [TransformControls revision 185](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/controls/TransformControls.js).
```js
transform.removeEventListener("dragging-changed", onDraggingChanged);
transform.detach();
scene.remove(helper);
transform.dispose();
```

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
