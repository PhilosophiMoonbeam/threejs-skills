# Materials in Three.js 0.185.1

## Scope

This reference owns built-in material selection, PBR properties, texture-map roles and channels,
alpha and render state, environment response, material lifecycle, and draw-call decisions.
Use `textures-and-render-targets` for texture loading and sampler setup, `lighting-and-shadows`
for light design, and `shaders-and-tsl` for shader tutorials.

## 0.185.1 invariants

- Import core materials and constants from `three`.
- Import add-ons from `three/addons/...`; in 0.185.1, use `HDRLoader`, renamed from `RGBELoader` in r180.
  ([migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide#179--180),
  [revision 185 `HDRLoader`](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/HDRLoader.js))
- Work in the default Linear-sRGB working space and sRGB output workflow. Annotate color textures;
  do not use removed `encoding` or gamma APIs.
  ([color management](https://threejs.org/manual/en/color-management.html),
  [r151→r152](https://github.com/mrdoob/three.js/wiki/Migration-Guide#151--152))
- Treat `Material.type` as read-only serialization/type metadata. Test with `isMeshStandardMaterial`
  flags or `instanceof`; use `needsUpdate` or `customProgramCacheKey()` for shader variants.
  ([`Material.type`](https://threejs.org/docs/pages/Material.html#type),
  [r169→r170](https://github.com/mrdoob/three.js/wiki/Migration-Guide#169--170))
- Physically correct lighting is the current behavior; do not restore legacy arbitrary light scaling.
  r181 also changed indirect specular energy and PMREM appearance.
  ([r154→r155](https://github.com/mrdoob/three.js/wiki/Migration-Guide#154--155),
  [r180→r181](https://github.com/mrdoob/three.js/wiki/Migration-Guide#180--181))

## Select a material

| Material | Choose it for | Important constraint |
|---|---|---|
| `MeshBasicMaterial` | unlit surfaces, helpers, UI-like meshes | still obeys culling, depth, fog, opacity, and visibility |
| `MeshLambertMaterial` | inexpensive diffuse lighting | no specular highlight |
| `MeshPhongMaterial` | legacy/plastic specular look | `specularMap` controls reflectivity, not `shininess` |
| `MeshToonMaterial` | stepped/cel lighting | gradient-map filtering determines bands |
| `MeshMatcapMaterial` | view-dependent baked lighting | ignores scene lights |
| `MeshStandardMaterial` | default metallic-roughness PBR | environment lighting strongly recommended |
| `MeshPhysicalMaterial` | advanced PBR layers and transmission | enabled lobes add per-pixel cost |
| `MeshNormalMaterial` | normal debugging | unlit diagnostic output |
| `MeshDepthMaterial` / `MeshDistanceMaterial` | depth and point-shadow passes | special-purpose, not general surface shading |
| `PointsMaterial` | `Points` | point size and alpha behavior differ from meshes |
| `LineBasicMaterial` / `LineDashedMaterial` | one-pixel GPU lines | GPU renderers ignore width; dashed lines need distances |
| `SpriteMaterial` | camera-facing sprites | used with `Sprite` |
| `ShadowMaterial` | transparent received-shadow overlays | tune opacity and depth ordering |

`linewidth`, `linecap`, and `linejoin` only affect `SVGRenderer` in 0.185.1. Use the line add-ons for
wide GPU lines. ([revision 185 `LineBasicMaterial`](https://github.com/mrdoob/three.js/blob/r185/src/materials/LineBasicMaterial.js))
Measure actual cost: maps, lights, shadows, transparency, overdraw, and enabled Physical lobes matter
more than a fixed material-name ranking.

## Canonical PBR pattern

```javascript
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const loader = new THREE.TextureLoader();
const baseColor = await loader.loadAsync('base-color.webp');
baseColor.colorSpace = THREE.SRGBColorSpace;
const orm = await loader.loadAsync('orm.webp'); // R=AO, G=roughness, B=metalness

const geometry = new THREE.SphereGeometry(1, 64, 32);
geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
orm.channel = 1; // aoMap reads uv1; the other uses may require their own Texture clones

const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: baseColor,
  aoMap: orm,
  roughness: 1,
  roughnessMap: orm,
  metalness: 1,
  metalnessMap: orm,
});

const environment = await new HDRLoader().loadAsync('studio.hdr');
environment.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = environment;
scene.add(new THREE.Mesh(geometry, material));
```

A texture has one `channel` selector. If packed data must use different UV sets for different material
slots, clone the texture and set each clone's `channel`; texture clones share the image source.
([revision 185 `Texture.channel`](https://github.com/mrdoob/three.js/blob/r185/src/textures/Texture.js#L115-L122))

## Standard PBR decisions

- Model dielectrics with `metalness = 0` and metals with `metalness = 1`; intermediate values are
  mainly for mixed pixels such as rust boundaries. Base values multiply their maps.
- `roughness = 0` is mirror-like and `1` is diffuse. Roughness uses the map's green channel;
  metalness uses blue; AO uses red.
- `normalMap` changes lighting only. `bumpMap` is ignored when a normal map exists.
- `displacementMap` moves vertices, so it needs tessellation. Pair it with authored normals because
  the renderer does not recompute normals after displacement.
- `emissiveMap` is multiplied by `emissive` and `emissiveIntensity`; a black emissive color suppresses it.
  ([revision 185 `MeshStandardMaterial`](https://github.com/mrdoob/three.js/blob/r185/src/materials/MeshStandardMaterial.js))
- In `MeshPhongMaterial`, `specularMap` modulates specular reflectivity/intensity; `shininess` controls
  highlight size. Treat the specular map as sRGB color data.
  ([revision 185 `MeshPhongMaterial`](https://github.com/mrdoob/three.js/blob/r185/src/materials/MeshPhongMaterial.js))

## Physical extensions

Enable only effects the asset needs. `MeshPhysicalMaterial` adds cost as features become active.
([revision 185 source](https://github.com/mrdoob/three.js/blob/r185/src/materials/MeshPhysicalMaterial.js))

| Effect | Scalar/property rule | Packed map channel |
|---|---|---|
| clearcoat | `clearcoat`; separate roughness and normal layer | intensity R, roughness G, normal RGB |
| sheen | `sheen`, `sheenColor`, `sheenRoughness` | color RGB (sRGB), roughness A |
| transmission/volume | keep `opacity = 1`; use `transmission`, `thickness`, attenuation | transmission R, thickness G |
| dielectric specular | `ior`, `specularIntensity`, `specularColor`; no effect at full metalness | intensity A, color RGB (sRGB) |
| iridescence | strength, IOR, and thickness range | strength R, thickness G |
| anisotropy | strength and tangent-space rotation | direction RG, strength B |
| dispersion | `0` disables it; meaningful with transmission | no map; extra spectral cost |

For physical glass, prefer transmission rather than low opacity: use `metalness: 0`, nonzero
`transmission`, suitable `ior` and roughness, and an environment. Give closed volumes nonzero
`thickness`; leave thin surfaces at `0`.
([`transmission`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#transmission),
[`dispersion`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#dispersion))

## Map roles, channels, and color spaces

| Slots | Sampled data | `texture.colorSpace` |
|---|---|---|
| `map`, `emissiveMap`, `sheenColorMap`, `specularColorMap` | displayed/color RGB | `THREE.SRGBColorSpace` |
| HDR/EXR environment and `lightMap` | scene-referred light RGB | `THREE.LinearSRGBColorSpace` |
| `roughnessMap` G, `metalnessMap` B, `aoMap` R, `alphaMap` G | scalar data | `THREE.NoColorSpace` |
| normal, bump, displacement, transmission, thickness maps | vectors/heights/scalars | `THREE.NoColorSpace` |
| anisotropy, clearcoat, iridescence, sheen-roughness maps | packed physical data | `THREE.NoColorSpace` |

Color constants and CSS-style color inputs are interpreted as sRGB and converted into the working
space. Do not tag data maps as sRGB. Do not manually convert an HDR texture loaded by `HDRLoader`;
it is Linear-sRGB in 0.185.1.
([color-space roles](https://threejs.org/manual/en/color-management.html#roles-of-color-spaces),
[revision 185 `HDRLoader`](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/HDRLoader.js))

UV attributes are named `uv`, `uv1`, `uv2`, and `uv3`; `Texture.channel` values `0`–`3` select them.
For a generated second set, use `geometry.setAttribute('uv1', geometry.getAttribute('uv').clone())`
and `texture.channel = 1`, not the old `uv2` recipe.
([`Texture.channel`](https://threejs.org/docs/pages/Texture.html#channel),
[r151→r152](https://github.com/mrdoob/three.js/wiki/Migration-Guide#151--152))

## Alpha, blending, and depth state

Choose one primary transparency strategy:

- Hard foliage/fences: `alphaTest` discards below a threshold and stays in the opaque path.
- Sorting-resistant coverage: `alphaHash = true`; accept noise, preferably with TAA.
- MSAA edges: `alphaToCoverage = true` only when the render target/context is multisampled.
- Smooth compositing: enable `transparent = true` and use `opacity < 1` and/or meaningful texture
  alpha; expect sorting and overdraw. Without transparent mode, 0.185.1 forces fragment alpha to `1`.
  ([revision 185 opaque-fragment chunk](https://github.com/mrdoob/three.js/blob/r185/src/renderers/shaders/ShaderChunk/opaque_fragment.glsl.js))
- Physical glass: `MeshPhysicalMaterial.transmission` with `opacity = 1`.

Keep `depthTest = true` normally. Transparent surfaces commonly keep depth testing but disable
`depthWrite` when later transparent layers must remain visible; this can expose sorting artifacts.
Use `CustomBlending` before changing blend factors/equations. Since r177, `MultiplyBlending` and
`SubtractiveBlending` require `premultipliedAlpha = true`.
([r177→r178](https://github.com/mrdoob/three.js/wiki/Migration-Guide#177--178))

Double-sided transparent built-ins render back and front faces in two passes. `forceSinglePass = true`
is a performance option for flat, non-overlapping vegetation, not a general transparency fix.
([Material alpha/state APIs](https://threejs.org/docs/pages/Material.html))
For 0.185.1 `WebGPURenderer`, prefer an opaque scene or clear color; use a transparent canvas only for
HTML compositing because premultiplied-alpha handling changed.
([r184→r185](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185))

## Environment response

- `scene.environment` supplies the default IBL for Standard/Physical materials; an explicit
  `material.envMap` overrides it. PBR environment maps are PMREM-filtered internally.
- Tune scene IBL with `scene.environmentIntensity` and `scene.environmentRotation`.
- Tune an explicit PBR map with `material.envMapIntensity` and `material.envMapRotation`.
  `envMapIntensity` does not attenuate `scene.environment` since r163.
- Background appearance is independent: use `scene.backgroundIntensity` and
  `scene.backgroundRotation`. r184 aligned environment/background rotations with object rotations.
  ([r162→r163](https://github.com/mrdoob/three.js/wiki/Migration-Guide#162--r163),
  [r183→r184](https://github.com/mrdoob/three.js/wiki/Migration-Guide#183--184),
  [revision 185 `Scene`](https://github.com/mrdoob/three.js/blob/r185/src/scenes/Scene.js))
- `MeshBasicMaterial` responds only to its explicit `envMap`; tune it with `reflectivity`, `combine`,
  and `refractionRatio`.
- `MeshLambertMaterial` and `MeshPhongMaterial` also support `envMapIntensity` for an explicit
  `envMap`. Without one, they inherit `scene.environment` and use `scene.environmentIntensity`.
  ([revision 185 Lambert](https://github.com/mrdoob/three.js/blob/r185/src/materials/MeshLambertMaterial.js),
  [revision 185 Phong](https://github.com/mrdoob/three.js/blob/r185/src/materials/MeshPhongMaterial.js),
  [revision 185 WebGL uniforms](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLMaterials.js))

## Mutation, cloning, and disposal

- Change uniform-like values directly: `material.color.set(...)`, `roughness`, and `opacity` do not
  require `material.needsUpdate`.
- Swapping non-null textures needs no update only when shader-keyed characteristics are unchanged.
  Set `material.needsUpdate = true` when the replacement changes `Texture.channel`, normal-map
  representation, or video-texture decoding.
  ([revision 185 program parameters](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLPrograms.js),
  [revision 185 renderer](https://github.com/mrdoob/three.js/blob/r185/src/renderers/WebGLRenderer.js))
- Set `needsUpdate = true` when program features change: map presence (`null`↔texture), transparency,
  alpha-test mode, fog/vertex-color features, flat shading, or shader source. Keep it out of hot loops;
  it increments `version` and can compile another program.
  ([updating materials](https://threejs.org/manual/en/how-to-update-things.html#materials),
  [`needsUpdate`](https://threejs.org/docs/pages/Material.html#needsUpdate))
- Set `texture.needsUpdate = true` after changing texture source data; changing dimensions, format,
  or type after first use requires disposal and a new texture.
- `material.clone()` copies value objects such as colors but shares texture references. Clone a texture
  only when its transform/channel state must diverge.
- `material.dispose()` releases material/program resources only. It does not dispose referenced
  textures or geometry and does not remove meshes. Dispose every owned texture and geometry once,
  after all users have finished; never dispose a shared resource early.
  ([revision 185 material copy/dispose](https://github.com/mrdoob/three.js/blob/r185/src/materials/Material.js),
  [disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html))

## Draw calls and performance

- Share identical materials to reduce allocations, shader programs, and state changes. Shared material
  identity does **not** batch separate meshes; they still issue separate render submissions.
- Reduce submissions with `InstancedMesh`, `BatchedMesh`, or merged compatible geometry.
  ([object optimization](https://threejs.org/manual/en/optimize-lots-of-objects.html))
- Every geometry group/material pair is another submission. Avoid gratuitous multi-material meshes.
- Prefer opaque or cutout rendering over blended transparency; minimize overlapping transparent pixels.
- Disable unused Physical lobes and maps. Budget dynamic lights and shadows with the lighting owner.
- Measure on target hardware and inspect renderer statistics; do not infer performance from class names.

## Custom-material boundary and common corrections

Shader tutorials belong to `shaders-and-tsl`, but material decisions must respect these boundaries:

- `ShaderMaterial` and `RawShaderMaterial` are `WebGLRenderer` APIs in 0.185.1. Use NodeMaterial/TSL from
  `three/webgpu` and `three/tsl` for `WebGPURenderer`.
  ([`ShaderMaterial`](https://threejs.org/docs/pages/ShaderMaterial.html),
  [r170→r171](https://github.com/mrdoob/three.js/wiki/Migration-Guide#170--171))
- `ShaderMaterial` supplies built-in declarations; `RawShaderMaterial` does not. A raw material must
  declare and update transforms such as model-view itself; an identity matrix is not a working substitute.
- Custom fragment output must apply output color-space conversion and, when intended, tone mapping.
  With explicit `THREE.GLSL3`, use GLSL 3 `in`/`out`, declare a fragment output, and use `texture()`;
  replacing only `texture2D()` is invalid. Output meaningful alpha only when transparency is enabled.
  ([custom-material color management](https://threejs.org/manual/en/color-management.html#roles-of-color-spaces),
  [revision 185 WebGL program construction](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLProgram.js#L810-L828))
- Use `THREE.Timer` in 0.185.1, call `timer.update()` once per frame, then read `timer.getElapsed()`;
  `Clock` was deprecated in r183.
  ([`Timer`](https://threejs.org/docs/pages/Timer.html),
  [r182→r183](https://github.com/mrdoob/three.js/wiki/Migration-Guide#182--183))

## Official sources

- [Material](https://threejs.org/docs/pages/Material.html)
- [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html)
- [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)
- [Texture](https://threejs.org/docs/pages/Texture.html)
- [Color management](https://threejs.org/manual/en/color-management.html)
- [Revision 185 material sources](https://github.com/mrdoob/three.js/tree/r185/src/materials)
- [Migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
