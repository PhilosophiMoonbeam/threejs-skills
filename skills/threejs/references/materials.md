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
- For `WebGLRenderer`, use built-in materials from `three`. For `WebGPURenderer`, use
  `MeshBasicNodeMaterial`, `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`,
  `LineBasicNodeMaterial`, or `SpriteNodeMaterial` from `three/webgpu`; import TSL nodes from
  `three/tsl`. Do not substitute WebGL `ShaderMaterial` for a WebGPU node material.
  ([r170→r171](https://github.com/mrdoob/three.js/wiki/Migration-Guide#170--171),
  [revision 185 node material exports](https://github.com/mrdoob/three.js/blob/r185/src/materials/nodes/NodeMaterials.js))
- Treat `Material.type` as read-only serialization/type metadata. Test with `isMeshStandardMaterial`
  flags or `instanceof`; use `needsUpdate` or `customProgramCacheKey()` for shader variants.
  ([`Material.type`](https://threejs.org/docs/pages/Material.html#type),
  [r169→r170](https://github.com/mrdoob/three.js/wiki/Migration-Guide#169--170))

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

The WebGPU counterparts are `MeshBasicNodeMaterial`, `MeshStandardNodeMaterial`,
`MeshPhysicalNodeMaterial`, `LineBasicNodeMaterial`, and `SpriteNodeMaterial`. They are
NodeMaterials, not aliases for the WebGL built-ins; use `three/webgpu` and compose custom behavior
with TSL from `three/tsl`.

`linewidth`, `linecap`, and `linejoin` only affect `SVGRenderer` in 0.185.1. Use the line add-ons for
wide GPU lines. ([revision 185 `LineBasicMaterial`](https://github.com/mrdoob/three.js/blob/r185/src/materials/LineBasicMaterial.js))
Measure actual cost: maps, lights, shadows, transparency, overdraw, and enabled Physical lobes matter
more than a fixed material-name ranking.

## Canonical PBR pattern

This WebGL example loads its own inputs and adds a PBR sphere to an existing `scene`. Host the three asset URLs; the owner must remain alive until setup settles. It owns the new mesh and textures and requires an initially unused `scene.environment`. For cancellation or shared assets, use the asset-loading topic in the skill index.

<!-- check: pbr-surface -->
```js
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const loader = new THREE.TextureLoader();
const results = await Promise.allSettled([
  loader.loadAsync('/assets/base-color.png'),
  loader.loadAsync('/assets/orm.png'),
  new HDRLoader().loadAsync('/assets/studio.hdr'),
]);
const failure = results.find(result => result.status === 'rejected');
if (failure) {
  for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
  throw failure.reason;
}
const [baseColor, orm, environment] = results.map(result => result.value);
baseColor.colorSpace = THREE.SRGBColorSpace;
// ORM stays NoColorSpace: R=AO, G=roughness, B=metalness; all slots share UVs.
environment.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = environment; // WebGL automatically preprocesses PBR environments.

const geometry = new THREE.SphereGeometry(1, 64, 32);
const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: baseColor,
  aoMap: orm,
  roughness: 1,
  roughnessMap: orm,
  metalness: 1,
  metalnessMap: orm,
});
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

function disposeSurface() {
  scene.remove(mesh);
  if (scene.environment === environment) scene.environment = null;
  geometry.dispose();
  material.dispose();
  baseColor.dispose();
  orm.dispose(); // Shared by three slots, owned once.
  environment.dispose();
}
```

The setup includes the input annotations needed to use the material directly; texture sampling and explicit environment preprocessing remain owned by the textures topic. [r185 HDRLoader](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/HDRLoader.js), [r185 WebGL environments](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLEnvironments.js), [color management](https://threejs.org/manual/en/color-management.html)

Reuse one packed texture when slots share UV and sampler state. For different UV sets or transforms, use the texture-cloning rules in the textures topic.

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

| Effect | Scalar/property rule | Map channel |
|---|---|---|
| clearcoat | `clearcoat`; separate roughness and normal layer | `clearcoatMap` R, `clearcoatRoughnessMap` G, `clearcoatNormalMap` RGB |
| sheen | `sheen`, `sheenColor`, `sheenRoughness` | `sheenColorMap` RGB (sRGB), `sheenRoughnessMap` A |
| transmission | `transmission`; keep `opacity = 1` | `transmissionMap` R |
| volume | `thickness`, `attenuationDistance`, `attenuationColor` | `thicknessMap` G; attenuation has no map |
| dielectric specular | `ior`, `specularIntensity`, `specularColor`; no effect at full metalness | `specularIntensityMap` A, `specularColorMap` RGB (sRGB) |
| iridescence | strength, IOR, and thickness range | `iridescenceMap` R, `iridescenceThicknessMap` G |
| anisotropy | strength and tangent-space rotation | `anisotropyMap` R/G direction, B strength |
| dispersion | `0` disables it; meaningful with transmission | no map; extra spectral cost |

For physical glass, prefer transmission rather than low opacity: use `metalness: 0`, nonzero
`transmission`, suitable `ior` and roughness, and an environment. Give closed volumes nonzero
`thickness`; leave thin surfaces at `0`. `attenuationDistance` is in mesh/world-space units.
([`transmission`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#transmission),
[`thickness`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#thickness),
[`attenuationDistance`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#attenuationDistance),
[`dispersion`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#dispersion))

## Map roles, channels, and color spaces

| Slots | Sampled data | `texture.colorSpace` |
|---|---|---|
| `map`, `emissiveMap`, `sheenColorMap`, `specularMap`, `specularColorMap` | displayed/color RGB | `THREE.SRGBColorSpace` |
| `envMap` and HDR/EXR environment textures | scene-referred radiance | `THREE.LinearSRGBColorSpace` for linear radiance |
| `lightMap` | baked illuminance; select the authored UV set | `THREE.LinearSRGBColorSpace` when authored as linear data |
| `roughnessMap` G, `metalnessMap` B, `aoMap` R, `alphaMap` G | scalar data | `THREE.NoColorSpace` |
| `normalMap`, `bumpMap`, `displacementMap`, `transmissionMap`, `thicknessMap` | vectors, heights, or scalars | `THREE.NoColorSpace` |
| `anisotropyMap`, `clearcoatMap`, `clearcoatRoughnessMap`, `iridescenceMap`, `iridescenceThicknessMap`, `sheenRoughnessMap`, `specularIntensityMap` | packed physical data | `THREE.NoColorSpace` |

`lightMap` is not automatically linear merely because it is a light map: annotate it according to
the data actually stored. Linear HDR/EXR light maps use `LinearSRGBColorSpace`; an encoded color
texture must use its encoded color space. Color constants and CSS-style color inputs are interpreted
as sRGB and converted into the working space. Do not tag data maps as sRGB. `HDRLoader` produces a
Linear-sRGB texture in 0.185.1.
([color-space roles](https://threejs.org/manual/en/color-management.html#roles-of-color-spaces),
[revision 185 `HDRLoader`](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/HDRLoader.js),
[revision 185 `MeshStandardMaterial`](https://github.com/mrdoob/three.js/blob/r185/src/materials/MeshStandardMaterial.js))

Texture loading, UV attribute names, `Texture.channel`, and transforms belong to the textures topic; return to the skill index for that setup.

## Alpha, blending, and depth state

Choose one primary transparency strategy:

- Hard foliage/fences: `alphaTest` discards below a threshold and stays in the opaque path.
- Sorting-resistant coverage: `alphaHash = true`; accept noise, preferably with TAA.
- MSAA edges: `alphaToCoverage = true` only when the render target/context is multisampled.
- Smooth compositing: enable `transparent = true` and use `opacity < 1` and/or meaningful texture
  alpha; expect sorting and overdraw. `alphaMap` samples the green channel. Without transparent
  mode, 0.185.1 forces fragment alpha to `1`.
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

- In the built-in WebGL path, `scene.environment` is the default IBL for Standard/Physical and
  Lambert/Phong materials; an explicit `material.envMap` prevents that inheritance. `MeshBasicMaterial`
  responds only to its explicit `envMap`.
- Standard/Physical environment maps use the renderer's PMREM path. Explicit Lambert/Phong `envMap`
  textures are not automatically PMREM-filtered in WebGL; provide an appropriate prefiltered map when
  needed. Tune explicit maps with `material.envMapIntensity` and `material.envMapRotation`.
- Scene/background intensity and rotation belong to the lighting topic. An explicit material map
  uses the material's own intensity and rotation. [r185 WebGL material uniforms](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLMaterials.js)
- For WebGPU NodeMaterials, use the renderer's node environment path; do not assume a WebGL
  `envMap` or WebGL shader define is portable.

## Mutation, cloning, and disposal

- Change uniform-like values directly: `material.color.set(...)`, `roughness`, and `opacity` do not
  require `material.needsUpdate`.
- Swapping a non-null texture needs no material update only when the shader-keyed characteristics are
  unchanged. Set `material.needsUpdate = true` when the replacement changes `Texture.channel`,
  normal-map representation/format, or video-texture decoding.
  ([revision 185 program parameters](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLPrograms.js))
- Set `needsUpdate = true` when a shader feature changes: map or `envMap` presence (`null`↔texture),
  activation of a Physical lobe or map, transparency, alpha-test mode, fog/vertex-color features,
  flat shading, shadow-map variant, or shader source. Keep it out of hot loops; it increments
  `version` and can compile another program.
  ([updating materials](https://threejs.org/manual/en/how-to-update-things.html#materials),
  [`needsUpdate`](https://threejs.org/docs/pages/Material.html#needsUpdate),
  [revision 185 program parameters](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLPrograms.js))
- Set `texture.needsUpdate = true` after changing texture source data; changing dimensions, format,
  or type after first use requires disposal and a new texture.
- `material.clone()` copies value objects such as colors but shares texture references. Clone a
  texture only when its transform/channel state must diverge.
- `material.dispose()` releases material/program resources only. It does not dispose referenced
  textures or geometry and does not remove meshes. Dispose every owned texture (including channel
  clones) and geometry once, after all users have finished; never dispose a shared resource early.
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

## Custom-material boundary

Route custom GLSL declarations, renderer-owned matrix uniforms, shader output conversion, and TSL graphs through the shaders topic in the skill index. `ShaderMaterial` and `RawShaderMaterial` use `WebGLRenderer`; NodeMaterials use `WebGPURenderer`. [r185 node-material exports](https://github.com/mrdoob/three.js/blob/r185/src/materials/nodes/NodeMaterials.js)

## Official sources

- [Material](https://threejs.org/docs/pages/Material.html)
- [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html)
- [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)
- [Texture](https://threejs.org/docs/pages/Texture.html)
- [Color management](https://threejs.org/manual/en/color-management.html)
- [Revision 185 material sources](https://github.com/mrdoob/three.js/tree/r185/src/materials)
- [Migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
