# React Three Fiber — Three.js 0.186.1

## Scope and pinned setup

React Three Fiber (R3F) and drei are **third-party**, not Three.js core. This browser integration targets `three@0.186.1`, `@react-three/fiber@9.8.2`, `@react-three/drei@10.7.9`, and React 19. Use a JSX-capable bundler; the reproducible React/DOM baseline is `19.2.9`. Keep one resolved copy of Three.js and matching React/React DOM versions. Fiber's published React/DOM peers are `>=19 <19.4`; drei accepts Fiber 9 and React 19. [Fiber package](https://unpkg.com/@react-three/fiber@9.8.2/package.json), [drei package](https://unpkg.com/@react-three/drei@10.7.9/package.json)

```sh
npm install --save-exact three@0.186.1 react@19.2.9 react-dom@19.2.9 @react-three/fiber@9.8.2 @react-three/drei@10.7.9
```

Use the skill index for core rendering, materials, lighting and shadows, asset loading, interaction and controls, shaders and TSL, performance, and offline asset-pipeline/gltfjsx workflows. This reference owns their React integration, not a second core API guide. Native WebGPU below means Three.js's WebGPU backend in a browser, not React Native.

## Operational Canvas example: WebGL or WebGPU

`Canvas` fills its parent; zero-size parents prevent root configuration. This example supplies a height, owns the React root, and needs no network assets. Default mode is an idle demand-rendered WebGL scene: hover/click/controls request frames. Use `frameloop="always"` for continuous rotation; `"never"` exposes explicit stepping through `onReady`. Change renderer/backend by **unmounting and mounting a new Canvas**, not by replacing `gl` on a live root. [Fiber Canvas implementation](https://unpkg.com/@react-three/fiber@9.8.2/dist/react-three-fiber.esm.js), [Fiber renderer/configuration/loop implementation](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js)

<!-- check: fiber-renderer-lifecycle -->
```jsx
import React, { Component, useCallback, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, extend, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as GPU from 'three/webgpu';
import { uniform } from 'three/tsl';

// Canvas registers plain `three`; add node materials before using their JSX tags.
extend(GPU);

class FiberErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    return this.state.error
      ? <p role="alert">3D view failed: {this.state.error.message}</p>
      : this.props.children;
  }
}

function PickableBox({ webgpu }) {
  const mesh = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [selected, setSelected] = useState(false);
  const tint = hovered ? '#ffd166' : selected ? '#80ed99' : '#42699c';
  const tintNode = useMemo(() => uniform(new GPU.Color('#42699c')), []);
  // Mutate the existing node's Color; do not replace the shader graph per render.
  tintNode.value.set(tint);
  useFrame((_, delta) => {
    mesh.current.rotation.y += delta; // seconds; no allocation or React state update
  });
  return (
    <mesh ref={mesh} position={[0, 0.6, 0]} castShadow
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
      onClick={(event) => { event.stopPropagation(); setSelected(value => !value); }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.target.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => event.target.releasePointerCapture(event.pointerId)}>
      <boxGeometry args={[1, 1, 1]} />
      {webgpu
        ? <meshStandardNodeMaterial colorNode={tintNode} roughness={0.65} />
        : <meshStandardMaterial color={tint} roughness={0.65} />}
    </mesh>
  );
}

export function FiberExample({ webgpu = false, forceWebGL = false,
  frameloop = 'demand', onReady = () => {} }) {
  const createGPU = useCallback(async (defaults) => {
    const renderer = new GPU.WebGPURenderer({ ...defaults, forceWebGL });
    await renderer.init(); // Return only a ready renderer; Fiber owns this result.
    return renderer;
  }, [forceWebGL]);
  return (
    <FiberErrorBoundary>
      <div style={{ height: 360, width: '100%' }}>
        <Canvas gl={webgpu ? createGPU : undefined} shadows="percentage"
          dpr={[1, 2]} frameloop={frameloop}
          camera={{ position: [3, 2, 4], fov: 50, near: 0.1, far: 100 }}
          onCreated={onReady} fallback={<p>A graphics-capable browser is required.</p>}>
          <color attach="background" args={['#111827']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 4, 2]} intensity={2} castShadow />
          <PickableBox webgpu={webgpu} />
          <mesh rotation-x={-Math.PI / 2} receiveShadow>
            <planeGeometry args={[10, 10]} />
            {webgpu
              ? <meshStandardNodeMaterial color="#20293a" />
              : <meshStandardMaterial color="#20293a" />}
          </mesh>
          <OrbitControls makeDefault />
        </Canvas>
      </div>
    </FiberErrorBoundary>
  );
}

export function mountFiberExample(host, props = {}) {
  const root = createRoot(host);
  root.render(<FiberExample {...props} />);
  return () => root.unmount(); // Stops React ownership; not an async GPU-disposal barrier.
}
```

Call `mountFiberExample(host)` for WebGL; `{ webgpu: true }` requests WebGPU with Three.js's WebGL 2 fallback; `{ webgpu: true, forceWebGL: true }` deliberately exercises that fallback. Inspect `state.gl.backend.isWebGPUBackend` in `onReady` if a test must require native WebGPU. `onCreated` means renderer initialization and scene commit are complete, **not** that the first frame or every Suspense asset has rendered. The async `gl` gate keeps the canvas mounted; an outer Suspense fallback is not its initialization indicator. Keep a DOM loading status until `onCreated` when needed. Errors in renderer configuration or the scene propagate to the outer error boundary; errors thrown later in event handlers/frame callbacks need application-level handling. [Fiber Canvas](https://unpkg.com/@react-three/fiber@9.8.2/dist/react-three-fiber.esm.js), [Fiber Provider and root readiness](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js), [r186 WebGPURenderer](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPURenderer.js)

### Canvas decisions

- The default camera is perspective, fov 75, near 0.1, far 1000, z=5. `camera` accepts properties or an instance; `orthographic` selects an orthographic default. Fiber updates projection on resize unless the camera is manual. With `camera={{ manual: true }}`, own the frustum and `updateProjectionMatrix()`.
- Default renderer creation uses the measured canvas, antialiasing, alpha, and high-performance preference. `gl` accepts construction properties, an instance, or a synchronous/async factory. A factory receives that canvas; constructing a renderer without it can draw into an invisible second canvas.
- `dpr` is a fixed number or device-ratio clamp `[min, max]` (default `[1, 2]`); ranges follow display/zoom changes. More pixels cost rendering work and render-target memory.
- Color management is enabled, output is sRGB, and tone mapping defaults to ACES Filmic, unlike plain Three.js. `flat` selects no tone mapping; `linear` selects Linear-sRGB output, not a generic texture fix. `legacy` disables Three.js's **global** color management and can affect other roots. Explicit `gl` properties override the corresponding color shorthand; factory results receive Fiber's shorthand defaults too. WebGPU tone-maps the background as part of the frame, so its appearance need not match a WebGL clear color.
- `shadows="percentage"` selects PCF; `"basic"` and `"variance"` select their corresponding algorithms. Boolean shadows and `"soft"` select deprecated PCFSoft in this Fiber version, which r186 coerces to PCF and warns. Even `shadows={false}` selects that type while disabling it. Use the explicit PCF string, and set light/mesh `castShadow` and receiver `receiveShadow` separately. A shadows object merges renderer shadow-map options; renderer-specific algorithm support still applies.
- `onPointerMissed` handles empty-space clicks. `events` can replace the event manager; `eventSource` changes its connected DOM target. `eventPrefix` selects coordinate properties, **not** automatic scroll/transform correction: its built-in calculation divides those values by Canvas size without subtracting a DOM rectangle. For shared/offset event sources, provide `events.compute` that uses `clientX/Y - canvas.getBoundingClientRect().left/top` before normalization.

Sources: [Fiber configuration, shadow mapping, color defaults and event computation](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js), [Canvas eventPrefix calculation](https://unpkg.com/@react-three/fiber@9.8.2/dist/react-three-fiber.esm.js), [r186 WebGL shadow maps](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLShadowMap.js), [r186 common renderer shadow map coercion](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js).

## Scene graph, hooks and frame ownership

JSX tags resolve registered constructors: `<mesh>` creates `Mesh`; `<boxGeometry args={[1, 1, 1]}>` passes constructor arguments. Changing `args` reconstructs the object. Geometry/material children attach automatically. `attach="background"` assigns a property; `attach="material-0"` targets an array slot. Dashed properties such as `rotation-x` and `material-color` reach nested fields. Vector/color properties use their setters: arrays, scalar values where `setScalar` exists, or matching Three.js objects work; plain `{ x, y, z }` is not a Vector3 replacement. `onUpdate` runs after property updates, not per frame. Register addons with `extend({ Water })` before `<water ... />`; import the class from `three/addons/objects/Water.js`. TypeScript uses `ThreeElements` for tag props and `threeLine`, `threeAudio`, `threeSource`, `threePath` to avoid DOM-name collisions. [Fiber catalogue, applyProps and reconciliation](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js), [Fiber JSX types](https://unpkg.com/@react-three/fiber@9.8.2/dist/declarations/src/three-types.d.ts)

Hooks require a component **inside** Canvas. `useThree(state => state.camera)` subscribes narrowly to root state; it does not observe mutations to `camera.position` or other Three.js internals. `useThree(state => state.get)` provides nonreactive reads outside a frame; inside `useFrame`, use its `state` argument directly. State includes `gl`, `scene`, `camera`, `pointer` (normalized device coordinates), `size` (CSS pixels), `viewport` (world units at a target/depth), `invalidate`, `advance`, `controls`, and performance setters. `useGraph(object)` memoizes named `nodes`, `materials` and `meshes` maps, not ownership or cloning. [Fiber hooks/store](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js)

| Mode or priority | Who requests and renders frames |
| --- | --- |
| `frameloop="always"` | Fiber drives frames. Mutate refs using `delta` seconds; reuse vectors, arrays and TSL uniforms. Do not call React `setState`, allocate objects, or start another RAF per frame. |
| `frameloop="demand"` | React scene updates invalidate automatically. After an imperative mutation, call root-local `invalidate()`; requests coalesce rather than render immediately. An ongoing animation must invalidate again while active. drei controls invalidate on change, including damping. |
| `frameloop="never"` | The external owner calls root-local `state.advance(seconds)` after readiness, including after resize/DPR changes, asset completion and interactions that require repainting. For deterministic steps use `advance(0)`, `advance(1 / 60)`, etc.; a RAF owner converts elapsed milliseconds to seconds and cancels its RAF on teardown. `invalidate()` does nothing in this mode. Stop using saved state/advance handles when that Canvas unmounts. |
| `useFrame(callback, -1)` | Runs earlier than priority 0 without taking render ownership; useful for controls or simulation ordering. |
| `useFrame(callback, 1)` | Any positive priority disables Fiber's automatic render. The owner must call `state.gl.render(state.scene, state.camera)` or its chosen render pipeline; higher priorities execute later. Do not also render manually at priority 0. |

Prefer root-local `advance` over the module export, which advances **all** roots. The first manual delta is the supplied time minus zero; do not pass absolute browser milliseconds or a large epoch. Global effects receive the timestamp passed to `advance`, so coordinate units with any global-effect consumers when mixing manual and automatic roots. Read `state.clock.elapsedTime` rather than calling `getElapsedTime()` in a frame (the latter consumes clock delta). Fiber 9.8.2 itself constructs a deprecated `THREE.Clock`; that r186 warning is not fixed by changing the application's timer. [Exact Fiber loop, priorities and clock](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js)

## Pointer events

Raycasting is CPU-side and renderer-independent. GPU/TSL displacement does not change the raycast geometry. Configure `raycaster` thresholds/layers when necessary. Events contain intersection fields (`object`, world-space `point`, `distance`, `face`, `instanceId`), `eventObject` (handler owner), `intersections`, `ray`, `camera`, `unprojectedPoint`, click-travel `delta` in pixels, and `nativeEvent`. Hits run nearest first and bubble through parents; objects behind the first hit also receive them unless `event.stopPropagation()` stops the ray's remaining delivery. This may immediately trigger pointer-out on previously hovered objects.

Use click/double-click/context-menu/wheel and pointer down/up/move/over/out/enter/leave handlers; pointer-move raycasts are limited to objects with move/hover handlers. Capture through `event.target.setPointerCapture(event.pointerId)` and release with `releasePointerCapture`; captured objects are **added to** the hit delivery, not substituted for raycast hits. Do not assume DOM-equivalent enter/leave or cancel semantics: the default manager uses pointer-cancel to clear hover and lost-capture to release bookkeeping, not to invoke same-named mesh callbacks. The example uses React state only for discrete interaction, never for per-frame transforms. [Fiber event implementation](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js)

## Loading, Suspense, caches and model copies

Put `<Suspense fallback={null}>` **inside** Canvas around loading components; a fallback there must be valid scene JSX, not a raw DOM `<div>`. Place a DOM error boundary around Canvas for rejected loads. `useProgress()` is a drei store that can render a DOM progress HUD outside Canvas; it tracks Three.js's DefaultLoadingManager, not every application request or WebGPU initialization. Loading progress is not a replacement for an error boundary. [Fiber useLoader](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js), [drei Progress](https://unpkg.com/@react-three/drei@10.7.9/core/Progress.js)

`useLoader(LoaderClassOrInstance, urlOrArray, configure?, onProgress?)` caches by loader identity and URLs. Class-based calls share one loader instance: configuration callbacks are not independent per-consumer loader settings, and decoder/configuration differences are not additional cache keys. Configure before preloading/first use; use a dedicated stable loader instance when isolation is necessary. `useLoader.preload(...)` warms the cache; `useLoader.clear(...)` evicts without disposing resources. Use `three/addons/loaders/GLTFLoader.js` for core-loader imports; do not add unmanaged effect-based loading just to bypass Suspense.

`useGLTF(url, useDraco?, useMeshopt?, extendLoader?)` uses drei's **three-stdlib** loader, enables Draco/Meshopt by default, and adds named graph maps. The default Draco decoder is fetched from gstatic `1.5.5`; self-host the matching decoder files and call `useGLTF.setDecoderPath('/decoders/draco/')` before preload/first load, or pass a decoder directory as the second argument. `false` disables its Draco setup; set decoder policy before any shared-loader use. KTX2 needs explicit loader configuration and renderer support detection; see asset loading through the skill index. [Exact drei GLTF implementation](https://unpkg.com/@react-three/drei@10.7.9/core/Gltf.js)

This component is intended inside the previous Canvas's Suspense boundary; provide a real local GLB URL. Each instance gets its own object hierarchy/skeleton, while geometry, materials and textures remain cache-owned. It does not automatically play animation clips; use the animation topic's mixer lifecycle and uncache instance actions on teardown.

<!-- check: fiber-cached-model -->
```jsx
import React, { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export function CachedModel({ url, ...props }) {
  const { scene } = useGLTF(url);
  const instance = useMemo(() => clone(scene), [scene]);
  useEffect(() => () => {
    const skeletons = new Set();
    instance.traverse(object => {
      if (object.isSkinnedMesh) skeletons.add(object.skeleton);
    });
    for (const skeleton of skeletons) skeleton.dispose(); // Only per-copy bone textures.
  }, [instance]);
  return <primitive object={instance} dispose={null} {...props} />;
}
```

One Object3D has one parent and one Fiber instance handle: never mount the same `scene` in multiple primitives. `scene.clone()` is adequate only for suitable unskinned hierarchies; `SkeletonUtils.clone()` rebinds skinned copies. Neither deep-clones shared materials/textures: clone those separately before per-instance edits and dispose only those private resources. [r186 SkeletonUtils](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/utils/SkeletonUtils.js), [r186 Skeleton.dispose](https://github.com/mrdoob/three.js/blob/r186/src/objects/Skeleton.js)

`useTexture` supports a URL, URL array, or keyed object. Fiber assigns sRGB to supported RGBA8 unsigned-byte textures when attached through recognized color-map properties; this is not universal texture inference. Explicitly distinguish color textures (sRGB) from normal/roughness/metalness/data maps (no color space), and do not reuse one cached texture object simultaneously with contradictory color spaces. Hook preloading/cache clearing follows `useLoader` ownership. [drei Texture](https://unpkg.com/@react-three/drei@10.7.9/core/Texture.js), [Fiber color-map assignment](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js)

## Useful drei helpers and their costs

Import these from `@react-three/drei`; they are optional wrappers, not renderer-independent guarantees.

| Helper | Use and boundary |
| --- | --- |
| `OrbitControls` | Connects events, enables damping by default, updates at priority -1, invalidates on change and disposes controls. `makeDefault` exposes `state.controls`; `regress` requests temporary adaptive quality. Pass `target`, distance/polar-angle limits and damping props to the controls. |
| `CameraControls` | Wraps camera-controls, updates with delta and manages lifecycle. Methods such as `fitToBox` belong to that third-party API, not OrbitControls. |
| `Environment` | Assign an HDR/map for image-based lighting; `background` also shows it. Presets require external downloads: self-host production assets. Loaded-file variants dispose their texture on unmount; an explicit `map` remains caller-owned. Children/`Lightformer` bake a separate cube scene; repeated frames add captures. |
| `Lightformer` | A bright mesh card inside an Environment capture, not an ordinary light illuminating the main scene directly. |
| `ContactShadows` | Depth capture plus blur passes; no ordinary light shadow-map setup. `frames={1}` bakes a static scene only; moving objects need refreshed captures. WebGL-only shader assumptions. |
| `Text` | Troika SDF text; font loading suspends. Use `font`, `fontSize`, `maxWidth`, `textAlign`, `lineHeight`, `letterSpacing`, `characters`, `anchorX/Y`; self-host fonts. WebGL shader injection, not native WebGPU text. |
| `Html` | DOM overlay projected from a 3D anchor; `transform` adds 3D CSS orientation, `distanceFactor` scales, `occlude`/`"raycast"` checks scene geometry. Keep the anchor outside occluding geometry. Use `portal={overlayRef}` for a stable explicit DOM target in a positioned wrapper; ensure the ref is attached when Html mounts. `occlude="blending"` uses a shader mesh and is WebGL-only. |
| `Center` | Measures/recenters geometry bounds; edge flags align top/bottom/etc., `precise={false}` uses cheaper object bounds, `onCentered` reports measurements. Troika text's base quad is not its laid-out glyph bounds: anchor Text itself instead. |
| `Bounds` / `useBounds` | Fit/clip/observe a perspective or orthographic camera around descendants; `margin` adds framing space. Imperative API includes `refresh`, `reset`, `moveTo`, `lookAt`, `fit`, `clip`. Moving content needs deliberate refresh; helpers need valid bounds. |
| `Preload all` | Compiles and cube-renders once on mount; `all` temporarily includes invisible objects. Put it after assets inside their Suspense boundary. It adds startup work and is not a promise that later views/material variants cannot hitch. |
| `Instances` / `Instance` | One instanced geometry/material with per-copy transforms/colors. Set `limit` for capacity; declarative matrix updates still cost CPU work. For static instances, `frames={1}` avoids ongoing updates. Use a raw InstancedMesh for tighter control when needed. |
| `Detailed` | LOD children selected by camera distance: e.g. `distances={[0, 15, 40]}`; matching children get progressively cheaper. `hysteresis` reduces distance-boundary oscillation. It is not geometry simplification. |

Exact sources: [OrbitControls](https://unpkg.com/@react-three/drei@10.7.9/core/OrbitControls.js), [CameraControls](https://unpkg.com/@react-three/drei@10.7.9/core/CameraControls.js), [Environment](https://unpkg.com/@react-three/drei@10.7.9/core/Environment.js), [Lightformer](https://unpkg.com/@react-three/drei@10.7.9/core/Lightformer.js), [ContactShadows](https://unpkg.com/@react-three/drei@10.7.9/core/ContactShadows.js), [Text](https://unpkg.com/@react-three/drei@10.7.9/core/Text.js), [Html](https://unpkg.com/@react-three/drei@10.7.9/web/Html.js), [Center](https://unpkg.com/@react-three/drei@10.7.9/core/Center.js), [Bounds](https://unpkg.com/@react-three/drei@10.7.9/core/Bounds.js), [Preload](https://unpkg.com/@react-three/drei@10.7.9/core/Preload.js), [Instances](https://unpkg.com/@react-three/drei@10.7.9/core/Instances.js), [Detailed](https://unpkg.com/@react-three/drei@10.7.9/core/Detailed.js).

### Adaptive performance

Start with demand rendering for static views, bounded DPR, shared resources, instancing/LOD, and asset optimization. Do not mount/unmount expensive materials merely to hide them; weigh retained GPU memory against reconstruction/compilation. Profile the actual bottleneck before lowering quality.

Choose **one DPR policy**:

- `<OrbitControls regress /><AdaptiveDpr pixelated />` uses `performance.current * viewport.initialDpr`. It temporarily lowers resolution during interaction and restores the initially resolved ratio, not an independently updated quality target. `pixelated` also changes canvas CSS sampling.
- `<PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(2)} flipflops={3} onFallback={() => setDpr(1)} />` reports sampled frame-rate trends; it does not change resolution itself. Hold `dpr` in the parent React component and pass it to `<Canvas dpr={dpr}>`. Bound the range and changes to prevent oscillation; occasional quality-state updates are different from per-frame transform state.

Do not combine these independent writers without an explicit policy. Fiber re-resolves DPR during configuration/display changes, and AdaptiveDpr restores its initial ratio. PerformanceMonitor samples rendered frames: a sleeping demand scene is not a valid continuous-FPS workload. No fixed quality setting guarantees a frame rate. [AdaptiveDpr](https://unpkg.com/@react-three/drei@10.7.9/core/AdaptiveDpr.js), [PerformanceMonitor](https://unpkg.com/@react-three/drei@10.7.9/core/PerformanceMonitor.js), [Fiber DPR configuration](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js)

## Ownership and teardown

- Fiber removes scene JSX and schedules disposal of its constructed disposable objects on unmount, including declared geometry/material/texture children. `dispose={null}` opts out for that subtree. An object passed via a property (`geometry`, `map`, etc.) is not thereby owned. `<primitive>` removes its object but never disposes it.
- Cached loaders outlive component mounts. Do not dispose shared geometry/material/textures from an individual model's cleanup. At final cache eviction: stop all consumers, clear the matching cache key, deduplicate and dispose the owned geometries/materials/textures/skeletons, and release external decoder/worker resources under their owner's policy. Cache clearing alone frees no GPU resources. Material disposal does not recursively dispose its texture properties.
- Fiber's exported `dispose(object)` is a shallow property walk, **not** a recursive asset collector. Explicit ownership is safer than assuming it traverses a loaded model tree.
- Fiber owns renderers it constructs from options or receives from its factory. In **9.8.2**, teardown waits for pending configuration, disconnects events/XR, and awaits a Promise returned by the owned renderer's `dispose()` before final teardown callback/context loss. This specifically accommodates r186's async WebGPURenderer disposal. Do not manually double-dispose that factory result in a React effect.
- A renderer **instance** supplied directly remains caller-owned: Fiber releases render lists and calls `forceContextLoss` when available but does not call that instance's `dispose()`. Do not assume such a WebGL renderer can be reused after unmount. A caller-owned WebGPU renderer still needs its owner to await `dispose()` after rendering has stopped.
- React DOM `root.unmount()` and Canvas removal return no disposal Promise. Do not claim `await root.unmount()` synchronizes GPU teardown. If a host truly requires a completion barrier, the lower-level Fiber `unmountComponentAtNode(canvas, callback)` callback runs after the renderer-release Promise; that is a custom-root ownership design, not an additional call to race against Canvas cleanup. Prefer a new DOM canvas for remounts.
- The async factory must await initialization **before returning** its renderer. A factory that rejects before returning has not transferred ownership: it must handle any external/partially created resources itself. An error boundary reports failure; it does not supply an initialization-cancellation or failed-backend resource-recovery contract.

Sources: [Fiber disposal, ownership and root teardown](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js), [Canvas insertion-effect lifecycle](https://unpkg.com/@react-three/fiber@9.8.2/dist/react-three-fiber.esm.js), [r186 Renderer.init/dispose](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js).

## WebGPU/TSL compatibility decisions

Use the example's initialized async renderer and `extend(GPU)`. Import nodes from `three/tsl`, not GLSL shader strings. Construct graphs once (`useMemo`/module scope); animate `uniform(...).value` or an existing color/vector value. Replacing a compiled graph requires material recompilation (`material.needsUpdate = true`); ordinary uniform changes do not. Fiber defaults still set sRGB output and ACES unless overridden. [r186 node material](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/NodeMaterial.js), [Fiber renderer configuration](https://unpkg.com/@react-three/fiber@9.8.2/dist/events-e51d7528.esm.js)

Scene JSX, refs/hooks, CPU pointer events, conventional loaded geometry, controls, bounds/centering, instancing and LOD do not inherently require WebGL shaders. That is not blanket certification of every drei helper/material on both WebGPURenderer backends. GLTFLoader materials supported by WebGPURenderer can convert to node materials; custom GLSL/onBeforeCompile materials cannot be assumed to convert.

Keep `Text`'s Troika shader path, `ContactShadows`, `Html occlude="blending"`, and Environment ground projection/gainmap decoding out of the native WebGPU path unless replaced by supported node implementations. Environment children/Lightformer and Preload use cube-camera captures; explicitly check output on **both native WebGPU and forceWebGL fallback** before adopting them. Prefer a supplied HDR/environment map for a simple cross-backend lighting path. Do not inherit an upstream visual claim such as “black fallback reflections” or “all helpers work” as an API guarantee. [drei shader/capture implementations](https://unpkg.com/@react-three/drei@10.7.9/core/Environment.js), [environment loader](https://unpkg.com/@react-three/drei@10.7.9/core/useEnvironment.js), [ContactShadows](https://unpkg.com/@react-three/drei@10.7.9/core/ContactShadows.js), [Html](https://unpkg.com/@react-three/drei@10.7.9/web/Html.js), [Text](https://unpkg.com/@react-three/drei@10.7.9/core/Text.js), [Preload](https://unpkg.com/@react-three/drei@10.7.9/core/Preload.js)
