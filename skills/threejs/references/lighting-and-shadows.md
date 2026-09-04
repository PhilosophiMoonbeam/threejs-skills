# Lighting and Shadows in Three.js 0.185.1

## Scope

Use this reference for analytic-light selection, physical units, targets, WebGL/WebGPU shadows, `RectAreaLight`, helpers, image-based lighting (IBL), light probes, and lighting cost. Materials own how surfaces respond to light; texture loading and post-processing belong to their respective topics.

## Decisions and invariants

- Use `MeshStandardMaterial` or `MeshPhysicalMaterial` for physically based lighting and IBL. In WebGPU, use the corresponding NodeMaterial classes.
- Prefer an HDR environment plus a small number of intentional direct lights. Ambient and hemisphere lights provide diffuse fill; they do not create reflections or shadows.
- Only `DirectionalLight`, `PointLight`, and `SpotLight` have built-in shadow maps. A `RectAreaLight` has no built-in shadow support.
- A mesh casts only with `castShadow = true` and receives only with `receiveShadow = true`.
- Use `three/addons/...` for addons. Select either `three` or `three/webgpu` as the core namespace for the renderer in use; do not mix renderer-specific targets, shadow internals, or RectAreaLight setup.
- Keep the renderer, light, shadow camera, material, and environment in one consistent scene scale.

## Select a light

| Light | Use | Intensity in 0.185.1 | Native shadow cost |
| --- | --- | --- | --- |
| `AmbientLight` | Uniform, non-directional fill | Generic strength | None |
| `HemisphereLight` | Sky/ground diffuse fill | Generic strength | None |
| `DirectionalLight` | Distant source such as sun | Generic strength; no distance falloff | One 2D shadow render |
| `PointLight` | Bulb emitting in every direction | Candela; `power` is lumens | Six cube-face renders |
| `SpotLight` | Cone with controllable edge | Candela; `power` is lumens | One 2D shadow render |
| `RectAreaLight` | Window or panel on PBR surfaces | Intensity corresponds to nits; `power` is lumens | No native shadows |

Photometric units are documented for point, spot, and rect-area lights; ambient, hemisphere, and
directional lights expose generic `intensity`. [AmbientLight revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/AmbientLight.js) · [HemisphereLight revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/HemisphereLight.js) · [DirectionalLight revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/DirectionalLight.js) · [PointLight revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/PointLight.js) · [SpotLight revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/SpotLight.js) · [RectAreaLight revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/RectAreaLight.js)

Point and spot lights use inverse-square falloff by default: keep `decay = 2` for physically based work. Their nonzero `distance` is a cutoff, not a replacement for decay. The r155 physical-lighting cutover changed legacy intensity scales, so old arbitrary values are only starting points. [154→155 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#154--155)

## Minimal direct-light and shadow pattern

```js
import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(8, 12, 6);
sun.target.position.set(0, 1, 0);
sun.castShadow = true;
scene.add(sun, sun.target);

sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  left: -12, right: 12, top: 12, bottom: -12,
  near: 0.5, far: 40,
});
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0001;
sun.shadow.normalBias = 0.02;

const subject = new THREE.Mesh(geometry, material);
subject.castShadow = true;
subject.receiveShadow = true;
scene.add(subject);

const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.receiveShadow = true;
scene.add(floor);
```

Use measured scene bounds instead of copying these tuning values. A directional light's position-to-target vector determines direction; its distance from the target does not attenuate the light.

## Targets and cone/range control

`DirectionalLight.target` and `SpotLight.target` are `Object3D` instances. Add a moved target to the scene so its world matrix updates. Move the target rather than rotating the light.

```js
const spot = new THREE.SpotLight(0xfff2dd, 800, 25, Math.PI / 6, 0.35, 2);
spot.position.set(0, 8, 4);
spot.target.position.set(0, 0, 0);
spot.castShadow = true;
spot.shadow.camera.near = 0.25;
spot.shadow.focus = 1;
scene.add(spot, spot.target);
```

Do not assign `spot.shadow.camera.fov`: every shadow update derives it from `2 * spot.angle * spot.shadow.focus`. With nonzero `spot.distance`, 0.185.1 also derives the shadow-camera far plane from that distance. [SpotLightShadow revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/SpotLightShadow.js)

For a shadowed point light, align the illumination cutoff and shadow range. In 0.185.1 the WebGL shadow pass uses nonzero `point.distance` as the cube shadow camera's far plane; otherwise the camera's explicit `far` applies. Remember that one point-light shadow renders the scene six times. [WebGLShadowMap revision 185](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLShadowMap.js)

## RectAreaLight: renderer-specific setup

A `RectAreaLight` emits uniformly from one face, illuminates only PBR materials (`MeshStandardMaterial` and `MeshPhysicalMaterial` in the built-in WebGL path), and has no built-in shadow. Aim it with `lookAt()`.

`WebGLRenderer` 0.185.1 requires one LTC uniform initialization during application setup; do not repeat it per light:

```js
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

RectAreaLightUniformsLib.init();
const panel = new THREE.RectAreaLight(0xffffff, 30, 4, 2);
panel.position.set(0, 5, 2);
panel.lookAt(0, 1, 0);
scene.add(panel);
```

`WebGPURenderer` uses LTC data textures and the node hook instead of the WebGL uniforms library. Initialize it once before the first render:

```js
import * as THREE from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';

THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
```

These are distinct 0.185.1 paths, not interchangeable initialization. [RectAreaLight revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/RectAreaLight.js) · [WebGL revision 185 example](https://github.com/mrdoob/three.js/blob/r185/examples/webgl_lights_rectarealight.html) · [WebGPU revision 185 example](https://github.com/mrdoob/three.js/blob/r185/examples/webgpu_lights_rectarealight.html)

## Shadow renderer choices

Both renderers expose `renderer.shadowMap.enabled` and default to `PCFShadowMap` in 0.185.1. Use PCF as the portable default. Do not select `PCFSoftShadowMap`: WebGL deprecates and coerces it to PCF in 0.185.1, and WebGPU removes it after r185. [181→182 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#181--182) · [WebGLShadowMap revision 185](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLShadowMap.js) · [185→186 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#185--186)

- `BasicShadowMap` is hard and unfiltered.
- `PCFShadowMap` is the normal filtered choice.
- `VSMShadowMap` adds blur passes, does not support point-light shadows, and includes receivers in its shadow pass.
- WebGPU implements shadows through renderer nodes, not WebGL shader internals. WebGL-only depth-material or shader hacks are not portable.
- WebGPU shadow behavior changed in r183; remove or retune inherited bias values rather than copying WebGL settings. [182→183 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)

There is no core or addon `ContactShadows` object in 0.185.1. Contact shadows require a custom depth render target plus blur/composite passes; use the imperative example as a design reference. [Revision 185 addon exports](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/Addons.js) · [revision 185 contact-shadow example](https://github.com/mrdoob/three.js/blob/r185/examples/webgl_shadow_contact.html)

## Tune shadows in this order

1. Fit the directional orthographic frustum tightly around visible casters and receivers; reduce `near`/`far` depth range.
2. Choose the smallest power-of-two `shadow.mapSize` that meets the visual target.
3. Increase `shadow.radius` only after resolution and frustum fit are correct. It affects non-Basic modes; high values band unless map size is sufficient.
4. Start `bias` and `normalBias` at zero. Change them by small amounts to remove acne; excess bias detaches shadows, while excess normal bias distorts grazing surfaces.
5. For static lights and casters, set `light.shadow.autoUpdate = false`; set `light.shadow.needsUpdate = true` only before a required refresh.

`LightShadow` documents map size, bias, normal bias, radius, blur samples, and update controls. [LightShadow revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/LightShadow.js)

## Helpers

```js
import { RectAreaLightHelper } from 'three/addons/helpers/RectAreaLightHelper.js';

const lightHelper = new THREE.DirectionalLightHelper(sun, 2);
const cameraHelper = new THREE.CameraHelper(sun.shadow.camera);
const areaHelper = new RectAreaLightHelper(panel);
scene.add(lightHelper, cameraHelper, areaHelper);

// After changing a light, target, or shadow frustum:
lightHelper.update();
cameraHelper.update();
```

Core also provides `PointLightHelper`, `SpotLightHelper`, and `HemisphereLightHelper`. Call each helper's `dispose()` when removing it.

## IBL policy

Use an environment prepared by the textures topic. It owns HDR/EXR loading, mapping, preprocessing, and texture/PMREM lifetime. With that texture already assigned:

```js
scene.environmentIntensity = 1;
scene.backgroundIntensity = 0.6;
scene.environmentRotation.y = Math.PI / 4;
scene.backgroundRotation.y = Math.PI / 4;
```

`environmentIntensity`/`environmentRotation` affect inherited scene IBL; background controls affect only the background. An explicit material `envMap` prevents scene-environment inheritance; material-specific response belongs to the materials topic. Rotation convention changed in r184, so retune pre-r184 values. [r185 Scene](https://github.com/mrdoob/three.js/blob/r185/src/scenes/Scene.js), [183→184 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#183--184)

## Diffuse light probes

A `LightProbe` stores low-frequency diffuse irradiance as spherical harmonics. It is ambient and global after being added to the scene: core does not spatially select or interpolate probes. The cube camera's position chooses the capture point, not an influence volume. Probes do not replace the specular environment map.

For `WebGLRenderer`, use a `WebGLCubeRenderTarget`; for `WebGPURenderer`, use `CubeRenderTarget`. Keep these setup paths separate:

```js
// WebGLRenderer
import * as THREE from 'three';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';

const cubeTarget = new THREE.WebGLCubeRenderTarget(128);
const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeTarget);
cubeCamera.position.set(0, 1.5, 0);
cubeCamera.update(renderer, scene);
scene.add(await LightProbeGenerator.fromCubeRenderTarget(renderer, cubeTarget));
```

```js
// WebGPURenderer
import * as THREE from 'three/webgpu';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';

const cubeTarget = new THREE.CubeRenderTarget(128);
const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeTarget);
cubeCamera.position.set(0, 1.5, 0);
cubeCamera.update(renderer, scene);
scene.add(await LightProbeGenerator.fromCubeRenderTarget(renderer, cubeTarget));
```

`fromCubeRenderTarget()` is asynchronous in 0.185.1 and expects an RGBA cube target. `WebGPURenderer` no longer accepts `WebGLCubeRenderTarget`; use `CubeRenderTarget` in that renderer path. Dispose the cube target after generation if it will not be reused. [LightProbeGenerator revision 185](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/lights/LightProbeGenerator.js) · [182→183 migration](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183)

## Failures, lifecycle, and cost

- Layers select lights against camera layers for a render pass; they do not provide per-object light linking. Use separate passes/scenes or an intentional material/node solution. [WebGLRenderer revision 185](https://github.com/mrdoob/three.js/blob/r185/src/renderers/WebGLRenderer.js#L1389-L1411)
- Do not add broad ambient intensity to fix exposure; tune renderer exposure, IBL, materials, and direct-light units deliberately.
- Reduce shadow-casting lights first. Then reduce caster count, tighten frusta/ranges, lower map sizes, and freeze static maps.
- Bake static diffuse lighting when scene constraints permit. Each analytic light adds shading work; each shadow adds scene renders and texture memory.
- Static scenes should render on demand rather than in a continuous animation loop; request a render when assets, lights, materials, camera, or display size changes. [Rendering on demand manual](https://threejs.org/manual/en/rendering-on-demand.html)
- On teardown, remove lights and their targets. Call `light.dispose()` so renderer-specific dispose listeners can release owned light/shadow state; explicitly dispose an application-owned shadow allocation exactly once when it is not covered by that lifecycle. Dispose helpers and cube/PMREM render targets, and dispose HDR textures when no longer referenced. [Light revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/Light.js) · [LightShadow revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/LightShadow.js) · [WebGPU AnalyticLightNode revision 185](https://github.com/mrdoob/three.js/blob/r185/src/nodes/lighting/AnalyticLightNode.js)

## Official sources

- [Lights documentation](https://threejs.org/docs/#api/en/lights/Light)
- [Shadows manual](https://threejs.org/manual/en/shadows.html)
- [RectAreaLight revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/RectAreaLight.js)
- [LightProbe revision 185](https://github.com/mrdoob/three.js/blob/r185/src/lights/LightProbe.js)
- [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
