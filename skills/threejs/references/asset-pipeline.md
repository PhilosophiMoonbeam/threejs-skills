# Asset Pipeline — Three.js 0.186.1

## Scope and prerequisites

This is an **offline, third-party toolchain**, not a Three.js addon. Use it to inspect, validate,
optimize, and generate React code from glTF 2.0. Runtime loader configuration has one owner:
asset loading through the skill index. React component/cache ownership belongs to React Three
Fiber through that index; performance owns measurement. Do not install these tools in the
browser bundle.

Baseline: `three@0.186.1`, `@gltf-transform/cli@4.5.1`, and `gltfjsx@6.5.3`.
The CLI requires Node >=20; use this repository's Node >=22 baseline. Commands below pin the
entry package; commit a tool workspace lockfile as well for repeatable transitive dependencies.
The CLI uses native Sharp/libvips for image work: install supported platform binaries and permit
its required installation steps in that isolated workspace. gltfjsx's image/DOM packages are
optional dependencies but are required by its generator/transform implementation; do not omit
optional dependencies. Neither tool's internal Three.js version is the application's runtime pin.
[CLI package](https://unpkg.com/@gltf-transform/cli@4.5.1/package.json) ·
[gltfjsx package](https://unpkg.com/gltfjsx@6.5.3/package.json)

- Keep the editable authoring source and original exports immutable. Export deliberate units,
  axes, pivots, names, material slots, UVs, skinning/morphs, and animation clips; glTF uses meters,
  +Y up, and a right-handed coordinate system. Preview under the application's lighting.
- Work in a fresh output directory. Never reuse an input path as output; commands may overwrite
  existing outputs. A `.gltf` has referenced buffers/images: retain its complete resource tree.
  Use `.glb` for self-contained delivery when practical, but inspect for external references.
- Treat names, hierarchy, extras, material identity, and animation targets as application data.
  An asset can validate and still break picking, per-part edits, attachments, or clip playback.
- Order: inspect/validate → structural edits → resizing/texture encoding → geometry compression
  → inspect/validate and visual/runtime comparison → optional HTTP content compression.
  Do not repeatedly recompress a lossy delivery artifact.
[glTF 2.0 coordinate conventions](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)

## Inspect, validate, then choose

Create `build/assets` first and keep source assets under `assets/source`. The example paths are
inputs to supply, not files created by the CLI. Use new output names for each alternative.

<!-- check: pipeline-inspect-optimize -->
```bash
mkdir -p build/assets
npx --yes @gltf-transform/cli@4.5.1 inspect assets/source/model.glb
npx --yes @gltf-transform/cli@4.5.1 validate assets/source/model.glb
npx --yes @gltf-transform/cli@4.5.1 optimize assets/source/model.glb build/assets/model.opt.glb --compress draco --texture-compress webp --texture-size 2048 --simplify false
npx --yes @gltf-transform/cli@4.5.1 inspect build/assets/model.opt.glb --format csv
npx --yes @gltf-transform/cli@4.5.1 validate build/assets/model.opt.glb
```

This is a candidate for a delivery-only model, not an identity-preserving preset. Inspect reports
scenes, meshes, materials, textures, animations, generator, and used/required extensions.
Compare geometry bytes, texture dimensions/formats, primitive counts, and clips before choosing
passes. `--format csv` or `--format md` changes the report format. Validation uses Khronos'
validator, reports errors/warnings/info/hints, and fails on errors; warnings need review too.
`--ignore CODE1,CODE2` exists for documented waivers, not as a default fix. Validator support for
new extensions can lag; a report alone does not establish runtime support.
[4.5.1 commands](https://unpkg.com/@gltf-transform/cli@4.5.1/src/cli.ts) ·
[validator implementation](https://unpkg.com/@gltf-transform/cli@4.5.1/src/validate.ts)

## What optimize changes

`optimize` runs dedup, optional instancing/palette/flatten/join/weld/simplify, animation resampling,
pruning, sparse storage, texture conversion, then geometry compression. Defaults include meshopt,
texture recompression in the original format (`auto`) capped at 2048, and simplification enabled.
Omitting a flag is not a preservation policy. Boolean options take explicit values.

| Control | Decision |
| --- | --- |
| `--compress draco\|meshopt\|quantize` | Choose geometry codec; `--compress false` disables it. Texture codecs do not belong here. |
| `--texture-compress ktx2\|webp\|avif\|auto` | Choose texture delivery; `false` skips this stage. `--texture-size` caps dimensions. |
| `--simplify false` | Keep the triangle budget; otherwise tune `--simplify-ratio`, `--simplify-error`, `--simplify-lock-border`. |
| `--instance false`, `--instance-min` | Preserve separately addressable copies, or batch repeated static meshes. |
| `--palette false` | Preserve distinct editable material objects instead of converting factors to palette textures. |
| `--flatten false --join false` | Preserve scene structure. Joining requires flattening; `--join-meshes false` and `--join-named false` restrict joining, not every other identity change. |
| `--weld`, `--resample`, `--prune`, `--sparse` | Control vertex merging, redundant animation keyframes, unreachable properties, and zero-filled storage. |

For identity-sensitive content prefer individual passes rather than a long list of disabled
`optimize` defaults. Deduplication itself can merge materials that the application intends to edit
independently; pruning can remove attachment/metadata-only nodes and unused attributes. Preserve
those deliberately. With simplification keep welding enabled; Draco welds even when optimize's
`--weld false` is requested. For KTX2, optimize uses UASTC on normal/occlusion/metallic-roughness
slots and ETC1S on remaining eligible textures. This is a starting policy, not a quality guarantee.
[4.5.1 optimize ordering and options](https://unpkg.com/@gltf-transform/cli@4.5.1/src/cli.ts)

## Structural passes

Run only the passes justified by inspection and application semantics. Each row is an independent
alternative; do not overwrite one file repeatedly or concatenate all rows automatically.

| Command after `npx --yes @gltf-transform/cli@4.5.1` | Effect and constraint |
| --- | --- |
| `weld input.glb welded.glb` | Index and merge bitwise-identical vertices; points are skipped. Run before simplification/meshopt when appropriate. |
| `simplify welded.glb simplified.glb --ratio 0.5 --error 0.001 --lock-border true` | Lossy target fraction of vertices retained, bounded by relative mesh error; topology/error can stop it early. Compare seams, silhouette, morphs, and deformed poses. |
| `join input.glb joined.glb` | Runs material dedup and flatten first, then merges compatible primitives. Can destroy part identity or increase vertices for reused geometry. |
| `instance input.glb instanced.glb --min 5` | Writes `EXT_mesh_gpu_instancing` for repeated mesh references sharing materials; skips animated files and skinned nodes. Instances are not independent scene nodes. |
| `dedup input.glb deduped.glb` | Merge redundant accessors/materials/meshes/skins/textures; changes shared identity. |
| `prune input.glb pruned.glb` | Remove properties unreachable from scenes, including orphan animation targets. Review unused nodes/attributes before pruning. |

`palette`, `flatten`, `resample`, and `sparse` are also available individually; choose them only
when their material/hierarchy/keyframe/storage changes meet the asset contract. Named-node retention
is not automatic preservation of application semantics. Bounds, collision meshes, name lookups,
animation clips, and authored pivots must be checked after structural changes.
[CLI command definitions](https://unpkg.com/@gltf-transform/cli@4.5.1/src/cli.ts) ·
[4.5.1 instancing restrictions](https://unpkg.com/@gltf-transform/functions@4.5.1/src/instance.ts)

## Texture delivery

WebP/AVIF optimize transfer size but browser decoding ordinarily yields uncompressed GPU pixels.
KTX2 with Basis Universal can transcode to a supported GPU-compressed format; actual storage/upload
behavior depends on the device and target, with an uncompressed fallback. Measure rather than
promising a fixed memory reduction. Test alpha edges, normal maps, packed data channels, mipmaps,
and glTF material extensions, not only base color.

<!-- check: pipeline-textures -->
```bash
# Run on an uncompressed editable export, before geometry compression.
npx --yes @gltf-transform/cli@4.5.1 resize assets/source/model.glb build/assets/model.resized.glb --width 1024 --height 1024
npx --yes @gltf-transform/cli@4.5.1 webp build/assets/model.resized.glb build/assets/model.webp.glb --quality 80
# Alternative download codec; verify browser support on target devices.
npx --yes @gltf-transform/cli@4.5.1 avif build/assets/model.resized.glb build/assets/model.avif.glb --quality 80
```

`resize` caps PNG/JPEG dimensions without enlargement and preserves aspect ratio. WebP/AVIF quality
uses a 1–100 scale; normal/data textures may need a different quality policy from color textures.
The CLI uses material slots to infer transfer functions: base-color/emissive are sRGB, scalar maps
are data. Keep roles correct in the source; do not mark normal/roughness/metalness as sRGB.
[4.5.1 texture commands](https://unpkg.com/@gltf-transform/cli@4.5.1/src/cli.ts) ·
[r186 KTX2 transcode targets](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/KTX2Loader.js)

### KTX2 prerequisites and slot-aware conversion

Install **Khronos KTX-Software >=4.4.0** separately and expose `ktx` on `PATH`; confirm `ktx --version`
before encoding. CLI 4.5.1's internal transform is named `toktx`, but invokes **`ktx create`**, not
an npm package and not the legacy `toktx` executable alone. It also uses Sharp for resizing.
KTX-Software is an offline encoder; the browser instead needs Three's Basis transcoder assets.
Do not pass WebP/AVIF intermediates into these passes: this version accepts PNG/JPEG and skips
other input image types, including already-KTX2 textures.
[4.5.1 executable/version check and encoding](https://unpkg.com/@gltf-transform/cli@4.5.1/src/transforms/toktx.ts) ·
[KTX-Software releases](https://github.com/KhronosGroup/KTX-Software/releases)

<!-- check: pipeline-ktx2 -->
```bash
ktx --version
npx --yes @gltf-transform/cli@4.5.1 uastc assets/source/model.glb build/assets/model.uastc.glb --slots '{normalTexture,occlusionTexture,metallicRoughnessTexture}' --level 4 --jobs 2
npx --yes @gltf-transform/cli@4.5.1 etc1s build/assets/model.uastc.glb build/assets/model.ktx2.glb --quality 128 --jobs 2
```

The second pass skips the already-KTX2 textures, so the split remains intact. Without `--slots`,
`etc1s` or `uastc` applies one bitstream to every eligible texture. ETC1S quality is 1–255; UASTC
`--level` is 0–4 (encoding effort, not a universal quality setting). Mipmaps are generated by
default. `--slots` takes a quoted glob of actual material-slot names; `--pattern` matches image
names/URIs. Limit `--jobs` for the build machine. Shared images used in incompatible roles should
be separated at authoring, not assigned one transfer function by guesswork.
[4.5.1 texture filtering and options](https://unpkg.com/@gltf-transform/cli@4.5.1/src/transforms/toktx.ts)

## Geometry compression last

Pick one final geometry codec. These commands are alternatives on the same precompressed input;
the first example uses the WebP texture candidate above.

<!-- check: pipeline-geometry -->
```bash
npx --yes @gltf-transform/cli@4.5.1 draco build/assets/model.webp.glb build/assets/model.draco.glb --method edgebreaker --quantize-position 14
npx --yes @gltf-transform/cli@4.5.1 meshopt build/assets/model.webp.glb build/assets/model.meshopt.glb --level high
npx --yes @gltf-transform/cli@4.5.1 quantize build/assets/model.webp.glb build/assets/model.quantized.glb
npx --yes @gltf-transform/cli@4.5.1 gzip build/assets/model.meshopt.glb
```

- Draco compresses triangle geometry, not textures, animation tracks, or morph targets. Quantized
  precision is lossy; review mesh seams and small features. Draco's vertex order is not stable
  application identity.
- Meshopt covers point/line/triangle geometry, morphs, and animation; its preset also reorders and
  quantizes. It does not replace welding. Pair delivered bytes with HTTP gzip/Brotli when useful.
- Quantization stores reduced-precision attributes in integer accessors; supported directly by
  GLTFLoader. Positions can be normalized integers restored by node transforms: CPU attribute
  values are not necessarily model-unit coordinates. Dequantize only when a CPU consumer needs it.

Rewriting compressed input through a normal CLI transform removes Draco/meshopt encoding before
writing. Geometry compression must therefore be the final **model rewrite**. Read-only inspect and
validate do not rewrite it; `gzip` merely writes `input.glb.gz`. Serve that representation with
`Content-Encoding: gzip` and the appropriate glTF content type; renaming a `.gz` or serving it as
raw `.glb` without the header is not sufficient. Avoid double compression by the server.
[4.5.1 compression commands](https://unpkg.com/@gltf-transform/cli@4.5.1/src/cli.ts) ·
[compression removal on rewrite](https://unpkg.com/@gltf-transform/cli@4.5.1/src/session.ts) ·
[meshopt transform](https://unpkg.com/@gltf-transform/functions@4.5.1/src/meshopt.ts)

## Runtime handoff contract

Inspect the final `extensionsRequired` and test on the actual renderer/browser. Route loader
setup, decoder assets, readiness, worker sharing, late results, and teardown through **asset
loading in the skill index**, not a second configuration recipe here.

| Delivered feature | Three.js 0.186.1 requirement |
| --- | --- |
| `KHR_draco_mesh_compression` | `DRACOLoader` attached to GLTFLoader. |
| `EXT_meshopt_compression` or `KHR_meshopt_compression` | `MeshoptDecoder` attached. CLI 4.5.1's preset emits EXT. |
| `KHR_texture_basisu` | `KTX2Loader`, support detection on the ready renderer, accessible matching Basis assets. |
| `KHR_mesh_quantization`, `EXT_mesh_gpu_instancing` | Built-in GLTFLoader handling; no separate decoder. Preserve CPU/identity semantics. |
| `EXT_texture_webp`, `EXT_texture_avif` | Browser codec support; no extra Three decoder. Unsupported required textures fail. |

WebGPU uses the same loaders: await renderer initialization before KTX2 support detection. Loading
completion is not a guarantee that uploads/shader compilation have finished; evaluate first-use
latency separately. Retain animation/metadata needed by the application, and assign ownership of
GPU resources, decoded bitmaps, cache entries, and decoder workers.
[r186 GLTFLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js) ·
[r186 KTX2Loader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/KTX2Loader.js)

## Scripted pipelines

Use the SDK for batch processing or explicit per-project policy. In a separate tool workspace,
install matching SDK packages and lock the dependencies; then save this as `pipeline.mjs` and run
`node pipeline.mjs assets/source/model.glb build/assets/model.sdk.glb`.

```bash
npm install --save-exact @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 draco3dgltf@1.5.7
```

<!-- check: pipeline-sdk-draco -->
```js
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

async function compressGLTF(input, output) {
  if (!input || !output || resolve(input) === resolve(output)) {
    throw new Error('Provide distinct input and output paths.');
  }
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });
  const document = await io.read(input);
  await document.transform(weld(), draco({ method: 'edgebreaker', quantizePosition: 14 }));
  await io.write(output, document);
}

await compressGLTF(process.argv[2], process.argv[3]);
```

The parent directory must already exist and the output must be disposable. This deliberately
omits dedup/prune, which can alter editable identity. Register extensions needed on both read and
write: `ALL_EXTENSIONS` means those implemented by this SDK version, not every custom/future
extension. Unsupported optional extensions may be lost; required ones can throw. Keep original
exports and reject unsupported content rather than accepting silent loss. Compression is deferred
to the I/O write. For meshopt use `meshoptimizer@1.2.0`, await `MeshoptEncoder.ready`, register
`'meshopt.encoder'` (plus a ready `'meshopt.decoder'` for compressed inputs), and use
`meshopt({ encoder: MeshoptEncoder })`. For scripted image work use `textureCompress` with Sharp
as `encoder` and `targetFormat: 'webp'`, before geometry compression.
[4.5.1 CLI dependency registration](https://unpkg.com/@gltf-transform/cli@4.5.1/src/config.ts) ·
[4.5.1 Draco transform](https://unpkg.com/@gltf-transform/functions@4.5.1/src/draco.ts) ·
[4.5.1 meshopt API](https://unpkg.com/@gltf-transform/functions@4.5.1/src/meshopt.ts)

## React output with gltfjsx

`gltfjsx@6.5.3` generates editable JSX for **React Three Fiber/drei**, not Three core. To preserve
an asset's authored structure, generate from an uncompressed export without `--transform` first.
Supply `public/models/model.glb` (and its dependencies), create `src/generated`, then run:

<!-- check: pipeline-gltfjsx -->
```bash
mkdir -p src/generated
npx --yes gltfjsx@6.5.3 public/models/model.glb --output src/generated/Model.jsx --root public --keepnames --keepgroups --meta
```

This emits a component loading `/models/model.glb`; it does not copy the asset into the public
folder or establish runtime dependencies. `--types` plus a `.tsx` output enables TypeScript.
`--keepnames`, `--keepgroups`, `--meta`, and `--bones` affect generated structure/metadata; they do
not promise that another offline transform preserves it. Inspect generated names, transforms,
materials, skins, and useAnimations actions before hand-editing. Keep edits separate from files
that regeneration overwrites, or deliberately review every regeneration diff.
[6.5.3 CLI flags](https://unpkg.com/gltfjsx@6.5.3/cli.js) ·
[output paths](https://unpkg.com/gltfjsx@6.5.3/src/gltfjsx.js) ·
[component generation](https://unpkg.com/gltfjsx@6.5.3/src/utils/parser.js)

### Optional transformed output

For a delivery-only candidate, put generated JSX **beside** the generated public asset so the
asset URL can be computed relative to the public root. Create `public/generated` first:

```bash
mkdir -p public/generated
npx --yes gltfjsx@6.5.3 public/models/model.glb --transform --output public/generated/Model.jsx --root public --resolution 1024 --keepmeshes --keepmaterials
```

This writes `public/generated/model-transformed.glb` and JSX referring to
`/generated/model-transformed.glb`. Move the JSX to application source before deployment; retain
the GLB under the public root. Do not publish generated source unnecessarily. `--keepmeshes` and
`--keepmaterials` disable joining and palette generation, but transformation still flattens,
deduplicates, welds, resamples, prunes, sparsifies, and Draco-compresses. It can change identity.
The default texture policy is WebP at the requested resolution except normals, which become JPEG
at `max(resolution, 2048)`. Review data-map artifacts. `--simplify --ratio 0.5 --error 0.001` opts
into lossy simplification; values are explicit because CLI defaults differ from help prose.
`--instance`/`--instanceall` also trigger the asset transform, not just JSX restructuring.
[6.5.3 actual transform ordering/codecs](https://unpkg.com/gltfjsx@6.5.3/src/utils/transform.js)

This generator bundles Three 0.159.0 and glTF Transform 4.1.0 internally; it is not an r186
extension-compatibility guarantee. Use an uncompressed compatible input and validate/inspect the
output independently with CLI 4.5.1. The CLI catches some errors without a failing exit status:
require expected nonempty outputs as well. Generated code uses drei `useGLTF`, preload, and
`dispose={null}`; align load **and preload** decoder configuration and final cache ownership in
the React Three Fiber topic through the skill index. `--draco` sets a generated decoder path but
does not automatically configure every emitted preload call. Do not change your runtime Three pin
to the generator's internal dependency. Do not run another model rewrite after final compression
without explicitly regenerating compression and rechecking generated node/material references.
[6.5.3 package dependencies](https://unpkg.com/gltfjsx@6.5.3/package.json) ·
[generated loader and preload calls](https://unpkg.com/gltfjsx@6.5.3/src/utils/parser.js)
