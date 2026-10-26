# Materials in Three.js 0.186.1

## Scope

This reference owns built-in material selection, PBR properties, texture-map roles and channels,
alpha and render state, environment response, material lifecycle, and draw-call decisions.
Use `textures-and-render-targets` for texture loading and sampler setup, `lighting-and-shadows`
for light design, and `shaders-and-tsl` for shader tutorials.

## 0.186.1 invariants

- Import core materials and constants from `three`.
- Import add-ons from `three/addons/...`; in 0.186.1, use `HDRLoader`, renamed from `RGBELoader` in r180.
  ([migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide#179--180),
  [revision 186 `HDRLoader`](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/HDRLoader.js))
- Work in the default Linear-sRGB working space and sRGB output workflow. Annotate color textures;
  do not use removed `encoding` or gamma APIs.
  ([color management](https://threejs.org/manual/en/color-management.html),
  [r151→r152](https://github.com/mrdoob/three.js/wiki/Migration-Guide#151--152))
- For `WebGLRenderer`, use built-in materials from `three`. `WebGPURenderer` converts supported
  built-ins to node materials, so ordinary Basic/Standard/Physical assets can carry over. Prefer
  explicit NodeMaterial classes from `three/webgpu` for custom behavior and TSL from `three/tsl`.
  `ShaderMaterial`, `RawShaderMaterial`, `MeshDepthMaterial`, and `MeshDistanceMaterial` do not have
  that conversion path. WebGPU's WebGL backend remains a node renderer, not `WebGLRenderer`.
  ([r186 conversion](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/nodes/NodeLibrary.js),
  [r186 supported mappings](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/nodes/StandardNodeLibrary.js))
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

`linewidth`, `linecap`, and `linejoin` only affect `SVGRenderer` in 0.186.1. Use the line add-ons for
wide GPU lines. ([revision 186 `LineBasicMaterial`](https://github.com/mrdoob/three.js/blob/r186/src/materials/LineBasicMaterial.js))
Measure actual cost: maps, lights, shadows, transparency, overdraw, and enabled Physical lobes matter
more than a fixed material-name ranking.

### Non-PBR controls and diagnostic primitives

- Basic supports an explicit `envMap`, `reflectivity`, and `combine` (`MultiplyOperation`,
  `MixOperation`, or `AddOperation`); `specularMap` masks the reflection contribution. Unlit does
  not mean always visible: depth, culling, fog, tone mapping, and render state still apply.
- Lambert adds diffuse lighting and emissive controls; Phong adds `specular` and `shininess`.
  Their `normalScale`, `bumpScale`, `displacementScale`/`displacementBias`, `aoMapIntensity`, and
  `lightMapIntensity` tune the corresponding map contributions.
- Matcap bakes the lighting appearance into a view-dependent image; annotate an LDR color matcap
  as sRGB. Toon `gradientMap` is non-color data; nearest filtering preserves hard bands.
- `MeshNormalMaterial` visualizes view-space normals. `MeshDepthMaterial` uses
  `BasicDepthPacking` by default; choose `RGBADepthPacking` only with matching unpacking in the consumer.
- `PointsMaterial.sizeAttenuation` scales size with view-space depth for perspective cameras.
  Hardware limits point size; the native WebGPU backend renders point primitives at one pixel.
  Use instanced sprite/quads and `PointsNodeMaterial` for larger WebGPU particles; custom node
  positioning and culling belong to the shaders and geometry topics in the index.
- Dashed lines need `line.computeLineDistances()` after constructing/changing the line.
  For wide lines use `Line2`/`LineGeometry`/`LineMaterial` from `three/addons/lines/` in WebGL;
  WebGPU uses `three/addons/lines/webgpu/Line2.js` with `Line2NodeMaterial`.

[r186 Basic](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshBasicMaterial.js) · [r186 Lambert](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshLambertMaterial.js) · [r186 Phong](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshPhongMaterial.js) · [r186 Points node material](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/PointsNodeMaterial.js) · [r186 dashed-line example](https://github.com/mrdoob/three.js/blob/r186/examples/webgl_lines_dashed.html)

The caller owns both the material and its gradient texture:

<!-- check: toon-gradient-material -->
```js
import * as THREE from 'three';

function createToonMaterial() {
  const gradientMap = new THREE.DataTexture(new Uint8Array([96, 180, 255]), 3, 1, THREE.RedFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  const material = new THREE.MeshToonMaterial({ color: 0x66aaee, gradientMap });
  return { material, dispose() { material.dispose(); gradientMap.dispose(); } };
}
```

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
  mesh.dispose(); // Retires object bindings; geometry/material/textures remain separately owned.
  if (scene.environment === environment) scene.environment = null;
  geometry.dispose();
  material.dispose();
  baseColor.dispose();
  orm.dispose(); // Shared by three slots, owned once.
  environment.dispose();
}
```

The setup includes the input annotations needed to use the material directly; texture sampling and explicit environment preprocessing remain owned by the textures topic. [r186 HDRLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/HDRLoader.js), [r186 WebGL environments](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLEnvironments.js), [color management](https://threejs.org/manual/en/color-management.html)

Reuse one packed texture when slots share UV and sampler state. For different UV sets or transforms, use the texture-cloning rules in the textures topic.

## Standard PBR decisions

- Model dielectrics with `metalness = 0` and metals with `metalness = 1`; intermediate values are
  mainly for mixed pixels such as rust boundaries. Base values multiply their maps.
- `roughness = 0` is mirror-like and `1` broadens the specular response; it does not remove
  specular reflection. Roughness uses green, metalness blue, and AO red.
- `normalMap` changes lighting only. `bumpMap` is ignored when a normal map exists.
- `displacementMap` moves vertices, so it needs tessellation. Pair it with authored normals because
  the renderer does not recompute normals after displacement.
- `emissiveMap` is multiplied by `emissive` and `emissiveIntensity`; a black emissive color suppresses it.
  ([revision 186 `MeshStandardMaterial`](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshStandardMaterial.js))
- In `MeshPhongMaterial`, `specularMap` modulates specular reflectivity/intensity; `shininess` controls
  highlight size. Treat the specular map as sRGB color data.
  ([revision 186 `MeshPhongMaterial`](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshPhongMaterial.js))

## Physical extensions

Enable only effects the asset needs. `MeshPhysicalMaterial` adds cost as features become active.
([revision 186 source](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshPhysicalMaterial.js))

| Effect | Scalar/property rule | Map channel |
|---|---|---|
| clearcoat | `clearcoat`; separate roughness and normal layer | `clearcoatMap` R, `clearcoatRoughnessMap` G, `clearcoatNormalMap` RGB |
| sheen | `sheen`, `sheenColor`, `sheenRoughness` | `sheenColorMap` RGB (sRGB), `sheenRoughnessMap` A |
| transmission | `transmission`; keep `opacity = 1` | `transmissionMap` R |
| volume | `thickness`, `attenuationDistance`, `attenuationColor` | `thicknessMap` G; attenuation has no map |
| dielectric specular | `ior`, `specularIntensity`, `specularColor`; no effect at full metalness | `specularIntensityMap` A, `specularColorMap` RGB (sRGB) |
| iridescence | `iridescence`, `iridescenceIOR`, `iridescenceThicknessRange` (default `[100, 400]`) | `iridescenceMap` R, `iridescenceThicknessMap` G |
| anisotropy | `anisotropy` strength; `anisotropyRotation` radians counter-clockwise from tangent | `anisotropyMap` R/G direction, B strength |
| dispersion | `0` disables it; meaningful with transmission | no map; extra spectral cost |
| retroreflection | `retroreflectivity`: number in `[0, 1]`; `0` disables it | no dedicated map |

For physical glass, prefer transmission rather than low opacity: use `metalness: 0`, nonzero
`transmission`, suitable `ior` (supported range `1`–`2.333`) and roughness, and an environment.
Give closed volumes nonzero mesh-space `thickness`; leave thin surfaces at `0`.
`attenuationDistance` is a positive world-space distance (`Infinity` disables absorption).
([`transmission`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#transmission),
[`thickness`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#thickness),
[`attenuationDistance`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#attenuationDistance),
[`dispersion`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#dispersion))

Built-in transmission is a screen-space approximation using a rendered scene buffer, not a
general transparent-volume solver. Opaque objects/background contribute; do not assume arbitrary
stacked blended/transmissive surfaces, offscreen content, or caustics will appear correctly.
[r186 transmission pass](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js) · [r186 Physical parameters](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshPhysicalMaterial.js)

### Retroreflective surfaces

Use retroreflection for reflective tape, road markings, and safety clothing: the specular lobe
returns toward the light source rather than behaving like an ordinary mirror. It is not emissive;
compare with a light near the viewer and with an off-axis light. `MeshPhysicalMaterial.retroreflectivity`
defaults to `0`; enabling it adds per-pixel shading work. Its setter changes the material version
when crossing zero, so do not toggle the feature per frame.

`MeshPhysicalNodeMaterial` has the same scalar property and a nullable `retroreflectivityNode`
override of type `Node<float>`; keep node outputs in `[0, 1]`. Use `materialRetroreflectivity` from
`three/tsl` to modify the inherited value. This does not imply parity for every Physical feature.
[r186 Physical material](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshPhysicalMaterial.js) · [r186 Physical node material](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/MeshPhysicalNodeMaterial.js) · [r186 node lighting model](https://github.com/mrdoob/three.js/blob/r186/src/nodes/functions/PhysicalLightingModel.js)

<!-- check: retroreflective-material -->
```js
import { MeshPhysicalNodeMaterial } from 'three/webgpu';

function createRetroreflectiveMaterial() {
  return new MeshPhysicalNodeMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.35,
    retroreflectivity: 1,
  });
}
```

This factory targets `WebGPURenderer`. The caller owns assignment, removal from consumers, and
`material.dispose()` after the last user. For `WebGLRenderer`, use `MeshPhysicalMaterial` from
`three` with the same scalar parameters; no compatibility shader is needed.

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
Linear-sRGB texture in 0.186.1.
([color-space roles](https://threejs.org/manual/en/color-management.html#roles-of-color-spaces),
[revision 186 `HDRLoader`](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/HDRLoader.js),
[revision 186 `MeshStandardMaterial`](https://github.com/mrdoob/three.js/blob/r186/src/materials/MeshStandardMaterial.js))

Texture loading, UV attribute names, `Texture.channel`, and transforms belong to the textures topic; return to the skill index for that setup.

## Alpha, blending, and depth state

Choose one primary transparency strategy:

- Hard foliage/fences: `alphaTest` discards below a threshold and stays in the opaque path.
- Sorting-resistant coverage: `alphaHash = true`; accept noise, preferably with TAA.
- MSAA edges: `alphaToCoverage = true` only when the render target/context is multisampled.
- Smooth compositing: enable `transparent = true` and use `opacity < 1` and/or meaningful texture
  alpha; expect sorting and overdraw. `alphaMap` samples the green channel. In WebGL's ordinary
  opaque path (`transparent = false`, `NormalBlending`, no alpha-to-coverage), final alpha is
  forced to `1` after cutout/hash discards; opacity alone does not enable blended transparency.
  ([r186 opaque-fragment chunk](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/opaque_fragment.glsl.js),
  [r186 opaque variant](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLPrograms.js))
- Physical glass: `MeshPhysicalMaterial.transmission` with `opacity = 1`.

Keep `depthTest = true` normally. Transparent surfaces commonly keep depth testing but disable
`depthWrite` when later transparent layers must remain visible; this can expose sorting artifacts.
Use `CustomBlending` before changing blend factors/equations. Since r177, `MultiplyBlending` and
`SubtractiveBlending` require `premultipliedAlpha = true`.
([r177→r178](https://github.com/mrdoob/three.js/wiki/Migration-Guide#177--178))

Double-sided transparent built-ins render back and front faces in two passes. `forceSinglePass = true`
is a performance option for flat, non-overlapping vegetation, not a general transparency fix.
([Material alpha/state APIs](https://threejs.org/docs/pages/Material.html))
For 0.186.1 `WebGPURenderer`, prefer an opaque scene or clear color; use a transparent canvas only for
HTML compositing because premultiplied-alpha handling changed.
([r184→r185](https://github.com/mrdoob/three.js/wiki/Migration-Guide#184--185))

### Other common render state

| Property | Operational rule |
|---|---|
| `visible` | skips this material's draws; does not remove objects or free resources |
| `side` | `FrontSide` by default; use `BackSide` or `DoubleSide` intentionally |
| `colorWrite` | disable for depth-only occluders or stencil masks |
| `polygonOffset`, `polygonOffsetFactor`, `polygonOffsetUnits` | offset polygon depth for decals/coplanar surfaces; tune for the backend and depth range |
| `toneMapped` | `false` bypasses material tone mapping, not input/output color management or later full-screen post-processing |
| `dithering` | WebGL built-ins can reduce color banding; not a substitute for adequate intermediate precision |
| `vertexColors` | enables geometry color attributes; supply values in the working color space |

Disabling `depthTest` also disables depth writes. `renderOrder` orders objects within render
queues, not across opaque/transmissive/transparent queues. Disabling tone mapping alone does not
guarantee exact UI pixel colors. [r186 Material state](https://github.com/mrdoob/three.js/blob/r186/src/materials/Material.js) · [r186 WebGL render queues](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js)

### Stencil masks

Enable the canvas stencil attachment at renderer creation with `{ stencil: true }` on either
renderer; offscreen targets instead need `{ stencilBuffer: true }`. `stencilWrite` enables both
comparison and writes. `stencilFuncMask` masks the comparison; `stencilWriteMask` masks writes.
There is no `stencilMask` property. `stencilFail`, `stencilZFail`, and `stencilZPass` select the
operations for stencil failure, depth failure, and both tests passing.

This WebGL example installs an opaque mask/content pair in an otherwise empty scene. Render
with stencil clearing enabled each frame (`autoClearStencil` defaults to `true`); in a multi-pass
pipeline explicitly clear stencil before the mask, not between mask and content. The caller owns
the scene/renderer; this function owns only its two meshes, one geometry, and two materials.

<!-- check: stencil-window -->
```js
import * as THREE from 'three';

function addStencilWindow(scene) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const maskMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true, stencilRef: 1,
    stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  const contentMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6655, stencilWrite: true, stencilRef: 1,
    stencilFunc: THREE.EqualStencilFunc, stencilWriteMask: 0,
  });
  const mask = new THREE.Mesh(geometry, maskMaterial);
  const content = new THREE.Mesh(geometry, contentMaterial);
  mask.scale.setScalar(0.5);
  mask.renderOrder = 0;
  content.renderOrder = 1;
  scene.add(mask, content);
  return {
    mask, content,
    dispose() {
      scene.remove(mask, content);
      mask.dispose(); content.dispose();
      geometry.dispose(); maskMaterial.dispose(); contentMaterial.dispose();
    },
  };
}
```

Use corresponding Basic NodeMaterials for explicit WebGPU authoring; the stencil state is the
same but the attachment must exist on the active target. [r186 stencil state](https://github.com/mrdoob/three.js/blob/r186/src/materials/Material.js) · [r186 common renderer stencil option](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js) · [r186 target attachments](https://github.com/mrdoob/three.js/blob/r186/src/core/RenderTarget.js)

## Environment response

- In the built-in WebGL path, `scene.environment` is the default IBL for Standard/Physical and
  Lambert/Phong materials; an explicit `material.envMap` prevents that inheritance. `MeshBasicMaterial`
  responds only to its explicit `envMap`.
- Standard/Physical environment maps use the renderer's PMREM path. Explicit Lambert/Phong `envMap`
  textures are not automatically PMREM-filtered in WebGL; provide an appropriate prefiltered map when
  needed. Tune explicit maps with `material.envMapIntensity` and `material.envMapRotation`.
- Scene/background intensity and rotation belong to the lighting topic. An explicit material map
  uses the material's own intensity and rotation. [r186 WebGL material uniforms](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLMaterials.js)
- In WebGPU, Standard/Physical inherit `scene.environment`; Lambert/Phong node materials do not.
  They can use their explicit environment path. Do not transfer WebGL shader defines or PMREM
  targets into a node graph.
  [r186 NodeMaterial environment](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/NodeMaterial.js) · [r186 Standard scene inheritance](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/MeshStandardNodeMaterial.js)
- Rebaseline PBR visuals when upgrading to r186: direct-light multiscattering compensation,
  Fresnel-based diffuse energy conservation, and GGX VNDF PMREM filtering change highlights,
  rough surfaces, and environment response. Compare under fixed lights, environment, exposure,
  and tone mapping before retuning authored values; do not restore old shading with a compatibility
  shader. Environment generation and lifetime remain owned by the textures topic.
  [r186 WebGL physical shading](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js) · [r186 node physical shading](https://github.com/mrdoob/three.js/blob/r186/src/nodes/functions/PhysicalLightingModel.js) · [r186 WebGL PMREM](https://github.com/mrdoob/three.js/blob/r186/src/extras/PMREMGenerator.js) · [r186 WebGPU PMREM](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/extras/PMREMGenerator.js)

## Mutation, cloning, and disposal

- Change uniform-like values directly: `material.color.set(...)`, `roughness`, and `opacity` do not
  require `material.needsUpdate`.
- Swapping a non-null texture needs no material update only when the shader-keyed characteristics are
  unchanged. Set `material.needsUpdate = true` when the replacement changes `Texture.channel`,
  normal-map representation/format, or video-texture decoding.
  ([revision 186 program parameters](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLPrograms.js))
- Set `needsUpdate = true` when a shader-keyed feature changes: map presence, transparency, side,
  blending/premultiplied-alpha variant, alpha hashing, dithering, fog/vertex colors, flat shading,
  shadow-map variant, or shader source. Keep it out of hot loops.
- `alphaTest` automatically increments `version` only when crossing zero; changing a positive
  cutoff is a uniform update. Physical-lobe setters similarly invalidate when crossing zero.
  WebGL detects effective environment changes during rendering; an explicit `needsUpdate` after
  changing environment representation is conservative, not a universal requirement.
  [r186 alpha-test setter](https://github.com/mrdoob/three.js/blob/r186/src/materials/Material.js) · [r186 environment detection](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js)
  ([updating materials](https://threejs.org/manual/en/how-to-update-things.html#materials),
  [`needsUpdate`](https://threejs.org/docs/pages/Material.html#needsUpdate),
  [revision 186 program parameters](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl/WebGLPrograms.js))
- Set `texture.needsUpdate = true` after changing texture source data; changing dimensions, format,
  or type after first use requires disposal and a new texture.
- `material.clone()` copies value objects such as colors but shares texture references. Clone a
  texture only when its transform/channel state must diverge.
- `material.dispose()` releases material/program resources only. It does not dispose referenced
  textures or geometry and does not remove meshes. Dispose every owned texture (including channel
  clones) and geometry once, after all users have finished; never dispose a shared resource early.
  ([revision 186 material copy/dispose](https://github.com/mrdoob/three.js/blob/r186/src/materials/Material.js),
  [disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html))

## Draw calls and performance

- Share identical materials to reduce allocations, shader programs, and state changes. Shared material
  identity does **not** batch separate meshes; they still issue separate render submissions.
- Reduce submissions with `InstancedMesh`, `BatchedMesh`, or merged compatible geometry.
  ([object optimization](https://threejs.org/manual/en/optimize-lots-of-objects.html))
- Every geometry group/material pair is another submission. Avoid gratuitous multi-material meshes.
- A material array uses geometry groups: `start`/`count` address indices for indexed geometry and
  vertices otherwise; `materialIndex` selects the array entry. For example, on a `BoxGeometry`,
  `clearGroups(); addGroup(0, 18, 0); addGroup(18, 18, 1);` splits its 36 indices into two draws.
  Ungrouped ranges are omitted when using an array. BoxGeometry's original six groups correspond
  to +X, −X, +Y, −Y, +Z, −Z. [r186 BoxGeometry](https://github.com/mrdoob/three.js/blob/r186/src/geometries/BoxGeometry.js) · [r186 group rendering](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js)
- Prefer opaque or cutout rendering over blended transparency; minimize overlapping transparent pixels.
- Disable unused Physical lobes and maps. Budget dynamic lights and shadows with the lighting owner.
- Measure on target hardware and inspect renderer statistics; do not infer performance from class names.

## Custom-material boundary

Route custom GLSL declarations, renderer-owned matrix uniforms, shader output conversion, and TSL graphs through the shaders topic in the skill index. `ShaderMaterial` and `RawShaderMaterial` use `WebGLRenderer`; NodeMaterials use `WebGPURenderer`. [r186 node-material exports](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/NodeMaterials.js)

## Official sources

- [Material](https://threejs.org/docs/pages/Material.html)
- [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html)
- [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)
- [Texture](https://threejs.org/docs/pages/Texture.html)
- [Color management](https://threejs.org/manual/en/color-management.html)
- [Revision 186 material sources](https://github.com/mrdoob/three.js/tree/r186/src/materials)
- [Migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
