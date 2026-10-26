# Geometry — Three.js 0.186.1

## Scope
Use this reference for built-in geometry generators, custom `BufferGeometry`, lines,
points, instancing, geometry utilities, bounds, mutation, and disposal. Materials,
textures, shaders/TSL, animation, interaction, and render-loop policy have separate
owners.

Core classes import from `three`. Example addons import through `three/addons/...`.
All APIs and behavior below target Three.js 0.186.1 exactly.
## Decisions and invariants
- A `BufferGeometry` is attribute streams plus an optional index. Ordinary vertex
  attributes (`position`, normals, UVs, and colors) must describe the same vertex
  domain; `InstancedBufferGeometry` may additionally carry per-instance attributes.
- `position` has item size 3; `normal` 3; `uv`, `uv1`, `uv2`, and `uv3` have item
  size 2 and correspond to texture channel indices 0–3.
- Indexed triangles reuse vertices; every three index values form one triangle.
  Non-indexed geometry consumes each consecutive three positions as a triangle.
- Groups partition draw elements for a material array. Groups must not overlap and
  must cover every index or vertex exactly once. `start` and `count` address indices
  on indexed geometry and vertices otherwise.
- Bounds are not automatically refreshed after vertex or instance mutation.
- Use `Uint32Array` when a vertex index reaches `65535`; WebGL 2 reserves the
  maximum 16-bit value for primitive restart. `setIndex()` selects the correct
  width for a regular JavaScript array. A manually supplied typed attribute must
  already use the correct width. [r186 index selection](https://github.com/mrdoob/three.js/blob/r186/src/core/BufferGeometry.js),
  [r186 primitive-restart threshold](https://github.com/mrdoob/three.js/blob/r186/src/utils.js)

## Built-in generators
Common full positional signatures, where positional detail is useful:
```text
BoxGeometry(width, height, depth, widthSegments, heightSegments, depthSegments)
CapsuleGeometry(radius, height, capSegments, radialSegments, heightSegments)
CircleGeometry(radius, segments, thetaStart, thetaLength)
ConeGeometry(radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength)
CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength)
PlaneGeometry(width, height, widthSegments, heightSegments)
RingGeometry(innerRadius, outerRadius, thetaSegments, phiSegments, thetaStart, thetaLength)
SphereGeometry(radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength)
TorusGeometry(radius, tube, radialSegments, tubularSegments, arc, thetaStart, thetaLength)
TorusKnotGeometry(radius, tube, tubularSegments, radialSegments, p, q)
```
`CapsuleGeometry.height` is the straight middle height; `heightSegments` defaults to
1. r176 rewrote its segmentation and UV distribution, so pre-r176 vertex/UV output
is not stable against Three.js 0.186.1. [revision 186 source](https://github.com/mrdoob/three.js/blob/r186/src/geometries/CapsuleGeometry.js)
| [r176 change](https://github.com/mrdoob/three.js/releases/tag/r176)

Also use `DodecahedronGeometry`, `IcosahedronGeometry`, `OctahedronGeometry`, or
`TetrahedronGeometry` for regular solids; `PolyhedronGeometry` for explicit vertices
and faces; `LatheGeometry` for a `Vector2` profile; `ShapeGeometry` for flat shapes;
`ExtrudeGeometry` for depth/bevel; and `TubeGeometry` for a `Curve<Vector3>` path.
Generated geometry is ordinary `BufferGeometry` and follows the same lifecycle.

Choose segmentation for projected size and silhouette, not a universal “good”
count. Longitude/latitude sweep parameters create sphere wedges or domes;
`CylinderGeometry` with a small radial segment count creates polygonal prisms.
Polyhedron `detail` adds subdivisions. Partial surfaces may have open boundaries.
For different distances, use `LOD` below rather than rebuilding geometry each frame.

Path-based generators have different input spaces: `LatheGeometry` rotates an
XY `Vector2` profile around Y; a `Shape` lies in XY, and ordinary extrusion extends
along +Z. `TubeGeometry` sweeps along a 3D curve. Their segment/bevel settings
control generated topology; changing the original curve or `.parameters` does not
regenerate existing buffers. Construct a replacement when topology changes.
[r186 LatheGeometry](https://github.com/mrdoob/three.js/blob/r186/src/geometries/LatheGeometry.js),
[r186 ExtrudeGeometry](https://github.com/mrdoob/three.js/blob/r186/src/geometries/ExtrudeGeometry.js),
[r186 TubeGeometry](https://github.com/mrdoob/three.js/blob/r186/src/geometries/TubeGeometry.js)

<!-- check: geometry-paths -->
```js
import * as THREE from "three";

function createPathGeometries() {
  const lathe = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0),
    new THREE.Vector2(0.5, 1), new THREE.Vector2(0, 1),
  ], 16);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(1, 0);
  shape.lineTo(1, 1);
  shape.lineTo(0, 1);
  shape.closePath();
  const extruded = new THREE.ExtrudeGeometry(shape, {
    depth: 0.25, steps: 1, bevelEnabled: false,
  });
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
  ]);
  const tube = new THREE.TubeGeometry(curve, 32, 0.1, 8, false);
  return { lathe, extruded, tube }; // Caller disposes all three.
}
```

### TextGeometry addon
```js
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

const font = await new FontLoader().loadAsync("/fonts/helvetiker_regular.typeface.json");
const text = new TextGeometry("0.186.1", {
  font,
  size: 0.5,
  depth: 0.12,
  curveSegments: 8,
  bevelEnabled: false,
});
text.center();
```
The application must host that JSON URL. Three.js 0.186.1 does not publish `examples/fonts`
in the npm package. Use `depth`, not the pre-r163 option name `height`.
`direction` accepts `"ltr"`, `"rtl"`, or `"tb"`; select a font whose glyphs cover
the text. This is extruded geometry, not a complete shaping/layout engine.
Dispose `text` after its last consumer; the loaded font is CPU data.
[Font asset removal](https://github.com/mrdoob/three.js/pull/33744) |
[TextGeometry revision 186 source](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/geometries/TextGeometry.js)

## Custom BufferGeometry
This complete pattern creates a lit, indexed quad with two material groups:
<!-- check: geometry-custom-quad -->
```js
import * as THREE from "three";
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.Float32BufferAttribute([
  -1, -1, 0,  1, -1, 0,  1, 1, 0,  -1, 1, 0,
], 3));
geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
  0, 0,  1, 0,  1, 1,  0, 1,
], 2));
geometry.setIndex([0, 1, 2, 0, 2, 3]);
geometry.computeVertexNormals();
geometry.addGroup(0, 3, 0);
geometry.addGroup(3, 3, 1);
geometry.computeBoundingBox();
geometry.computeBoundingSphere();
const mesh = new THREE.Mesh(geometry, [
  new THREE.MeshStandardMaterial({ color: 0x44aa88 }),
  new THREE.MeshStandardMaterial({ color: 0x8866cc }),
]);
scene.add(mesh);
```
Use `setDrawRange(start, count)` to render only a contiguous subset. Replace or
remove data with `setAttribute`/`deleteAttribute`, `setIndex`, and
`clearGroups`. Use `toNonIndexed()` only when duplicated per-corner data is needed;
it allocates a new geometry.

`BufferAttribute` requires a typed array; convenience classes such as
`Float32BufferAttribute` convert regular JavaScript arrays to typed storage.
[BufferAttribute constructor](https://threejs.org/docs/pages/BufferAttribute.html#constructor)

For compact color storage, normalization is required. These four Linear-sRGB
colors match the quad's four-vertex domain:
```js
const bytes = new Uint8Array([
  255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
]);
geometry.setAttribute("color", new THREE.BufferAttribute(bytes, 3, true));
```
With `normalized: true`, attribute getters/setters expose normalized values while
`.array` remains raw integer storage. Enable `material.vertexColors` when consuming
`color`. [BufferAttribute revision 186 source](https://github.com/mrdoob/three.js/blob/r186/src/core/BufferAttribute.js)
Normalization does not perform sRGB conversion. Convert authored CSS/sRGB colors
to the working space before packing vertex colors. Normals/UVs/color discontinuities
require separate vertices even when positions coincide; welding positions alone
would destroy seams and hard edges.

### Interleaved storage

Use interleaving when attributes share an update lifetime, not as a guaranteed
speedup. Stride and offsets count array components, not bytes; all attributes
share the buffer's usage/update ranges/version. This CPU-only factory returns
one owned geometry:

<!-- check: geometry-interleaved -->
```js
import * as THREE from "three";

function createInterleavedQuad() {
  const data = new THREE.InterleavedBuffer(new Float32Array([
    -1, -1, 0, 0, 0,  1, -1, 0, 1, 0,
     1,  1, 0, 1, 1, -1,  1, 0, 0, 1,
  ]), 5);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(data, 3, 0));
  geometry.setAttribute("uv", new THREE.InterleavedBufferAttribute(data, 2, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
```

`BufferGeometryUtils.interleaveAttributes()` can pack compatible existing
attributes. Dispose the geometry, not its attribute objects.
[r186 InterleavedBuffer](https://github.com/mrdoob/three.js/blob/r186/src/core/InterleavedBuffer.js),
[r186 InterleavedBufferAttribute](https://github.com/mrdoob/three.js/blob/r186/src/core/InterleavedBufferAttribute.js)


## Mutation, update ranges, and bounds

Set usage before first render; usage cannot be changed after first use. Update ranges
count array components, not vertices. Never use the removed singular `updateRange`.
```js
const position = geometry.getAttribute("position");
position.setUsage(THREE.DynamicDrawUsage);
position.setXYZ(2, 1.25, 1, 0);
position.addUpdateRange(2 * position.itemSize, position.itemSize);
position.needsUpdate = true;
geometry.computeVertexNormals(); // also marks the generated normal attribute
geometry.computeBoundingBox();
geometry.computeBoundingSphere();
```
Direct writes to an attribute's `.array` follow the same `needsUpdate` rule.
Uploaded attribute storage cannot grow in place: preallocate capacity and limit
rendered elements with `setDrawRange()` (index values for indexed geometry,
vertices otherwise), or retire the old geometry and allocate a replacement.
Draw ranges do not restrict the attributes scanned by bound computations; unused
capacity must not create invalid or misleading bounds.
Changing positions invalidates any existing bounds: recompute the box and sphere
before culling, raycasting, or helpers use them. `computeVertexNormals()` updates
and marks the normal attribute; do not increment its version a second time.
Call `clearUpdateRanges()` only when resetting ranges manually; renderers consume
and clear uploaded ranges. For interleaved attributes, usage, ranges, and
`needsUpdate` belong to the shared `InterleavedBuffer`. Morph attribute data cannot
be changed after first render; dispose the geometry and create a replacement.
[BufferGeometry update manual](https://threejs.org/manual/en/how-to-update-things.html) |
[BufferAttribute update-range API](https://threejs.org/docs/pages/BufferAttribute.html) |
[revision 186 BufferGeometry source](https://github.com/mrdoob/three.js/blob/r186/src/core/BufferGeometry.js)

`applyMatrix4`, `rotateX/Y/Z`, `translate`, `scale`, and `center` mutate vertex
data; they mark affected attributes and refresh bounds that already exist. Use
`Object3D` transforms for ordinary runtime motion; these are one-time CPU edits.
[BufferGeometry#applyMatrix4, revision 186](https://github.com/mrdoob/three.js/blob/r186/src/core/BufferGeometry.js)

## Lines, points, and derived geometry
```js
const pathGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, 0, 0),
]);
const line = new THREE.Line(pathGeometry, new THREE.LineBasicMaterial({ color: 0xff8844 }));
const points = new THREE.Points(pathGeometry, new THREE.PointsMaterial({ size: 0.08 }));
scene.add(line, points);
```
Use `LineLoop` for a closed chain on `WebGLRenderer`, and `LineSegments` when each
vertex pair is an independent segment. Common `Renderer`/`WebGPURenderer`
does not support `LineLoop`: repeat the first point and use `Line` instead.
`EdgesGeometry(source, thresholdAngle)` emits boundary edges and edges whose
adjacent face-normal angle meets the threshold (degrees);
`WireframeGeometry(source)` emits all triangle edges, including triangulation
diagonals. Render either result with `LineSegments`; dispose the derived geometry
separately from its source.
[r186 common line restrictions](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js),
[r186 EdgesGeometry](https://github.com/mrdoob/three.js/blob/r186/src/geometries/EdgesGeometry.js),
[r186 WireframeGeometry](https://github.com/mrdoob/three.js/blob/r186/src/geometries/WireframeGeometry.js)

### Wide lines

Do not rely on `LineBasicMaterial.linewidth` for portable thickness; native line
primitives are effectively one pixel on supported browser backends. Use mesh-based
wide-line addons. This factory is specifically for `WebGLRenderer`:

<!-- check: geometry-wide-line -->
```js
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

function createWideLine() {
  const geometry = new LineGeometry();
  geometry.setPositions([-1, 0, 0, 0, 1, 0, 1, 0, 0]);
  const material = new LineMaterial({ color: 0xff8844, linewidth: 4 });
  return new Line2(geometry, material);
}
```

With `WebGPURenderer` (including its WebGL fallback), instead import `Line2` from
`three/addons/lines/webgpu/Line2.js` and `Line2NodeMaterial` from `three/webgpu`;
retain the same `LineGeometry`. `linewidth` uses screen pixels unless
`worldUnits: true`. Built-in pre-render callbacks update the viewport resolution;
do not overwrite them without preserving that work. For dashed lines set
`dashed: true` and call `line.computeLineDistances()`. At retirement detach the
line, call `line.dispose()`, and dispose its owned geometry/material.
[r186 WebGL Line2](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/lines/Line2.js),
[r186 LineMaterial](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/lines/LineMaterial.js),
[r186 WebGPU Line2](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/lines/webgpu/Line2.js)

### Sized points under WebGPU

`PointsMaterial.size` is depth-attenuated under a perspective camera by default;
`sizeAttenuation: false` requests constant screen size. Native WebGPU point
primitives remain one physical pixel regardless of that setting. For sized points
on `WebGPURenderer`, instance a `Sprite` with `PointsNodeMaterial`:

<!-- check: geometry-webgpu-points -->
```js
import * as THREE from "three/webgpu";
import { instancedBufferAttribute } from "three/tsl";

function createSizedPoints() {
  const centers = new THREE.InstancedBufferAttribute(
    new Float32Array([-1, 0, 0, 0, 1, 0, 1, 0, 0]), 3,
  );
  const material = new THREE.PointsNodeMaterial({
    positionNode: instancedBufferAttribute(centers),
    color: 0xffffff, size: 8, sizeAttenuation: false,
  });
  const points = new THREE.Sprite(material);
  points.count = centers.count;
  points.frustumCulled = false; // Default sprite bounds omit these centers.
  return points;
}
```

Initialize the renderer before rendering; add the returned sprite to the scene.
The positions are local to its object transform. For larger clouds, partition into
spatially bounded objects or implement conservative bounds rather than disabling
culling globally. The sprite quad geometry is shared internally: retire this
object and its material, not the shared quad after each cloud.
[r186 PointsNodeMaterial](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/PointsNodeMaterial.js),
[r186 Sprite](https://github.com/mrdoob/three.js/blob/r186/src/objects/Sprite.js)

## Instancing
Prefer `InstancedMesh` when geometry and material are shared:
<!-- check: geometry-instanced-mesh -->
```js
const instances = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.2, 0.2, 0.2),
  new THREE.MeshStandardMaterial({ color: 0xffffff }), 100,
);
const transform = new THREE.Matrix4();
const color = new THREE.Color();
for (let i = 0; i < instances.count; i++) {
  transform.makeTranslation((i % 10) - 4.5, Math.floor(i / 10) - 4.5, 0);
  instances.setMatrixAt(i, transform);
  instances.setColorAt(i, color.setHSL(i / instances.count, 0.7, 0.5));
}
instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
instances.instanceMatrix.needsUpdate = true;
instances.instanceColor.needsUpdate = true;
instances.computeBoundingBox();
instances.computeBoundingSphere();
scene.add(instances);
```
After runtime transform changes, mark `instanceMatrix`, then recompute the sphere
before culling or raycasting; recompute the box when application code uses it.
After runtime color changes, mark `instanceColor.needsUpdate`. `Raycaster`
intersections report `instanceId`. Instance matrices must not encode a negative
scale. [InstancedMesh revision 186 source](https://github.com/mrdoob/three.js/blob/r186/src/objects/InstancedMesh.js)
All instance matrices are local to the `InstancedMesh`; its `matrixWorld` then
places the whole population. `getMatrixAt(id, target)` reads one matrix for editing.
One combined sphere culls the entire population, not individual instances: split
distant populations into spatial clusters when coarse bounds retain too much work.
Materials must consume instance color (`MeshBasicMaterial` and standard materials
do; `MeshNormalMaterial` does not). Material groups or multiple passes can still
produce multiple draws; instancing is not an unconditional one-draw guarantee.

For custom per-instance attributes, use `InstancedBufferGeometry` and a material
that consumes them. This GLSL example is for `WebGLRenderer` only.
Set `instanceCount` explicitly, including after `.copy(baseGeometry)`:
```js
const instanced = new THREE.InstancedBufferGeometry();
instanced.setAttribute("position", new THREE.Float32BufferAttribute([
  -0.1, -0.1, 0,  0.1, -0.1, 0,  0, 0.1, 0,
], 3));
instanced.setAttribute("offset", new THREE.InstancedBufferAttribute(
  new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), 3,
));
instanced.instanceCount = 3;
const dots = new THREE.Mesh(instanced, new THREE.ShaderMaterial({
  vertexShader: `attribute vec3 offset; void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position+offset,1.0);}`,
  fragmentShader: `void main(){gl_FragColor=vec4(1.0);}`,
}));
dots.frustumCulled = false; // Shader offsets are absent from CPU bounds.
scene.add(dots);
```
[InstancedBufferGeometry revision 186 source](https://github.com/mrdoob/three.js/blob/r186/src/core/InstancedBufferGeometry.js)

For `WebGPURenderer`, use TSL rather than `ShaderMaterial`. This factory uses
custom per-instance positions without `InstancedMesh`, skinning, or morph targets;
its `positionNode` explicitly defines the final object-local vertex position:

<!-- check: geometry-tsl-instances -->
```js
import * as THREE from "three/webgpu";
import { instancedBufferAttribute, positionGeometry } from "three/tsl";

function createOffsetTriangles() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.1, -0.1, 0, 0.1, -0.1, 0, 0, 0.1, 0,
  ], 3));
  const offsets = new THREE.InstancedBufferAttribute(
    new Float32Array([-1, 0, 0, 0, 0, 0, 1, 0, 0]), 3,
  );
  geometry.setAttribute("offset", offsets);
  geometry.instanceCount = offsets.count;
  const material = new THREE.MeshBasicNodeMaterial({ color: 0xff8844 });
  material.positionNode = positionGeometry.add(instancedBufferAttribute(offsets));
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1.1, -0.1, 0), new THREE.Vector3(1.1, 0.1, 0),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  return new THREE.Mesh(geometry, material);
}
```

Keep these explicit bounds synchronized with offset edits. Automatic geometry
bounds and CPU raycasting cannot infer shader displacement. Do not generalize
this replacement position to skinned/morphed/`InstancedMesh` pipelines; use the
shaders and TSL topic through the index for transform composition.
[r186 node position assignment](https://github.com/mrdoob/three.js/blob/r186/src/materials/nodes/NodeMaterial.js),
[r186 attribute nodes](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/BufferAttributeNode.js)

## BatchedMesh

Use a batch for different compatible geometries sharing a material, with
independently addressable geometry IDs and instance IDs. Adding geometry alone
does not render it: call `addInstance(geometryId)`. Allocate instance capacity
separately from the total unique-geometry vertex/index capacities. The first
geometry establishes the attribute layout; all later inputs must match its
attributes, item sizes, normalization, and indexed/non-indexed state.

<!-- check: geometry-batched -->
```js
import * as THREE from "three";

function createGeometryBatch() {
  const sources = [new THREE.BoxGeometry(), new THREE.SphereGeometry(0.5, 12, 8)];
  const vertexCount = sources.reduce((sum, geometry) => sum + geometry.attributes.position.count, 0);
  const indexCount = sources.reduce((sum, geometry) => sum + geometry.index.count, 0);
  const material = new THREE.MeshNormalMaterial();
  const batch = new THREE.BatchedMesh(2, vertexCount, indexCount, material);
  const geometryIds = sources.map((geometry) => batch.addGeometry(geometry));
  const instanceIds = geometryIds.map((geometryId) => batch.addInstance(geometryId));
  const matrix = new THREE.Matrix4();
  batch.setMatrixAt(instanceIds[0], matrix.makeTranslation(-1, 0, 0));
  batch.setMatrixAt(instanceIds[1], matrix.makeTranslation(1, 0, 0));
  batch.computeBoundingBox();
  batch.computeBoundingSphere();
  for (const geometry of sources) geometry.dispose(); // Data was copied into the batch.
  return { batch, material, geometryIds, instanceIds };
}
```

Add the batch to the scene. Matrices are batch-local; `setMatrixAt()` marks its
internal texture automatically, unlike `InstancedMesh`'s explicit upload flag.
Refresh aggregate bounds after moving/adding/removing instances; per-instance
culling (`perObjectFrustumCulled`, default `true`) does not repair a stale aggregate
sphere. `setVisibleAt()` controls an instance, `deleteInstance()` retires its ID,
and `deleteGeometry()` also retires its referencing instances. Deleted IDs may
be reused; do not treat them as permanent application identifiers.

WebGL uses `WEBGL_multi_draw` when available and otherwise loops over draws.
The native WebGPU backend currently issues a draw per visible batch entry, so
do not promise a single draw on either renderer. At teardown detach the batch,
call `batch.dispose()` **once** for its internal geometry/textures, then dispose
the externally owned material after its last consumer. Do not separately dispose
`batch.geometry`.
[r186 BatchedMesh](https://github.com/mrdoob/three.js/blob/r186/src/objects/BatchedMesh.js),
[r186 WebGL batch draws](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js),
[r186 WebGPU batch draws](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPUBackend.js)


## Utilities and tangents
```js
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
const merged = BufferGeometryUtils.mergeGeometries([geometryA, geometryB], true);
if (merged === null) throw new Error("Geometry attributes or indices are incompatible");
```
Inputs to `mergeGeometries` must consistently be indexed or non-indexed and expose
compatible attributes/morph attributes. `true` creates one group per input.
`geometry.computeTangents()` requires an index plus `position`, `normal`, and `uv`.
For authored tangent-space normal maps, prefer
`computeMikkTSpaceTangents(geometry, MikkTSpace)` after `await MikkTSpace.ready`,
importing `MikkTSpace` from `three/addons/libs/mikktspace.module.js`.
[Utility revision 186 source](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/utils/BufferGeometryUtils.js)

`mergeVertices(geometry, tolerance)` returns a new indexed geometry and only welds
vertices with matching attributes within tolerance, not all coincident positions.
Retain deliberate UV/normal seams. MikkTSpace computes tangents and converts an
indexed input to non-indexed data **in place**; clone first if other consumers need
the old topology.

For a single-material static merge, bake transforms into owned temporary geometry
and merge without groups. This CPU-only factory preserves its source generators'
separate coordinate placement in the result:

<!-- check: geometry-static-merge -->
```js
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function createMergedGeometry() {
  const box = new THREE.BoxGeometry();
  const sphere = new THREE.SphereGeometry(0.5, 12, 8);
  box.translate(-1, 0, 0);
  sphere.translate(1, 0, 0);
  const merged = mergeGeometries([box, sphere], false);
  box.dispose();
  sphere.dispose();
  if (merged === null) throw new Error("Incompatible geometry layouts");
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged; // Caller owns the returned geometry.
}
```

For existing meshes, clone each geometry before baking its transform into the
destination object's local space: use
`inverse(destination.matrixWorld) * source.matrixWorld`, with current world
matrices. Do not mutate shared source geometry. The utility does not read mesh
transforms, preserve arbitrary source material groups, or merge materials.
Using `useGroups: true` creates one group per input for a material array; each
group remains a separate draw. A merged object has one aggregate culling bound;
prefer spatial clusters over a world-sized static merge.
[r186 merge/weld/tangent utilities](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/utils/BufferGeometryUtils.js)


### Triangulation and simplification

`toTrianglesDrawMode(geometry, drawMode)` converts `TriangleFanDrawMode` or
`TriangleStripDrawMode` **in place**, returns the same geometry, rewrites its index
(creating one if needed), and clears groups. It does not copy attributes. Clone
first when preserving the input; rebuild material groups for the resulting triangle
index. `TrianglesDrawMode` already represents triangles and returns the input with
a warning. [r186 conversion](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/utils/BufferGeometryUtils.js)

`await new SimplifyModifier().modify(geometry, count)` returns a **new indexed**
`BufferGeometry`; `count` is the approximate number of vertices to remove, not
the target count or a ratio. The modifier awaits its bundled meshoptimizer
`MeshoptSimplifier`, welds non-indexed input, and compacts the result's vertex
attributes to referenced vertices without mutating the supplied geometry.
Normals and UVs affect the simplification error metric. Non-interleaved ordinary
attributes retain their typed-array class and normalization; groups, morph attributes, draw ranges,
and bounds are not copied. Use this for static triangle geometry, not a drop-in
replacement for skinned/morph or multi-material geometry. Recompute result bounds,
restore any applicable groups, and dispose the old geometry only after its last
consumer. Meshoptimizer is a bundled third-party library, not a core API; no
separate CDN script is required.
[r186 modifier](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/modifiers/SimplifyModifier.js)

The caller owns all three returned geometries and must dispose each after use:

<!-- check: geometry-r186 -->
```js
import * as THREE from "three";
import { toTrianglesDrawMode } from "three/addons/utils/BufferGeometryUtils.js";
import { SimplifyModifier } from "three/addons/modifiers/SimplifyModifier.js";

async function createGeometryR186() {
  const source = new THREE.BufferGeometry();
  source.setAttribute("position", new THREE.Float32BufferAttribute([
    -1, -1, 0,  1, -1, 0,  -1, 1, 0,  1, 1, 0,
  ], 3));
  source.addGroup(0, 4, 0);
  const triangles = toTrianglesDrawMode(source.clone(), THREE.TriangleStripDrawMode);
  const simplified = await new SimplifyModifier().modify(triangles, 1);
  simplified.computeBoundingBox();
  simplified.computeBoundingSphere();
  return { source, triangles, simplified };
}
```
## Morph target geometry

Each target must preserve the base vertex count/order. Targets are absolute
positions by default; set `morphTargetsRelative = true` for offsets. Assign targets
before constructing the mesh so influences/dictionary are initialized. For targets
added to an existing mesh before its first upload, call `mesh.updateMorphTargets()`
before setting influences (it resets that influence array). After upload, replace
the geometry instead of editing morph buffers in place.

<!-- check: geometry-morph -->
```js
import * as THREE from "three";

function createMorphQuad() {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const target = geometry.attributes.position.clone();
  for (let i = 0; i < target.count; i++) {
    target.setX(i, target.getX(i) * 1.5);
    target.setY(i, target.getY(i) * 0.5);
  }
  target.name = "stretch";
  geometry.morphAttributes.position = [target];
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshNormalMaterial());
  mesh.morphTargetInfluences[0] = 0.5;
  return mesh;
}
```

This planar stretch preserves normal direction. General deformations also need
appropriate normal targets; recomputing base normals does not generate target
normals. Bounds include authored position targets, but arbitrary influence
extrapolation or combined relative targets may require a larger conservative
bound. Use the animation topic through the index for animated influence bindings.
[r186 morph bounds](https://github.com/mrdoob/three.js/blob/r186/src/core/BufferGeometry.js),
[r186 Mesh morph setup](https://github.com/mrdoob/three.js/blob/r186/src/objects/Mesh.js)

## Geometry choice versus LOD

Choose a suitable fixed topology first. `LOD` switches among existing objects;
it does not generate reduced geometry or reduce resident asset memory. Use it
when projected detail changes enough to justify multiple retained variants.
Keep all variants aligned in the same local coordinates and use hysteresis to
reduce boundary flicker:

<!-- check: geometry-lod -->
```js
import * as THREE from "three";

function createSphereLOD() {
  const material = new THREE.MeshNormalMaterial();
  const lod = new THREE.LOD();
  lod.addLevel(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material), 0);
  lod.addLevel(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material), 20, 0.1);
  lod.addLevel(new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), material), 60, 0.1);
  return { lod, material };
}
```

The renderer calls `lod.update(camera)` when `autoUpdate` is true (default);
distance is camera-to-LOD world distance divided by `camera.zoom`, not a
screen-space error. Hysteresis is a fraction of each transition distance.
For CPU-only selection, update camera/LOD world matrices before `lod.update(camera)`.
With `autoUpdate = false`, the application owns all updates. At retirement notify
every variant and the LOD, dispose each owned geometry, and dispose the shared
material once. See the performance topic through the index for choosing LOD
versus batching/instancing based on measured cost.
[r186 LOD](https://github.com/mrdoob/three.js/blob/r186/src/objects/LOD.js)


## Gaussian splat representation

Use the official addon `GaussianSplat` from
`three/addons/objects/GaussianSplat.js`.
It requires `WebGPURenderer` and node materials; that renderer's `forceWebGL`
fallback is supported, ordinary `WebGLRenderer` is not. Resolve both `three/webgpu`
and `three/tsl`. [r186 object](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/objects/GaussianSplat.js)

There is no exported `GaussianSplatGeometry` class in 0.186.1. Loader output is
`BufferGeometry`; for authored arrays, use the exported factory:

```js
import { createGaussianSplatGeometry } from "three/addons/utils/GaussianSplatUtils.js";
import { GaussianSplat } from "three/addons/objects/GaussianSplat.js";

const data = createGaussianSplatGeometry(
  new Float32Array([0, 0, 0]),                         // centers: 3 values/splat
  new Float32Array([0.04, 0, 0, 0.04, 0, 0.04]),     // covariance: xx,xy,xz,yy,yz,zz
  new Uint8ClampedArray([255, 128, 64, 255]),          // linear RGBA: 4 bytes/splat
);
const splats = new GaussianSplat(data, { autoSort: true });
```

The factory wraps the supplied arrays without copying. Its optional fourth
argument supplies contiguous bands `{ sh1, sh2, sh3 }` through degree 3, using
packed `Uint32Array` words: 3/4/6 words per splat respectively, four clamped-byte
coefficients per word decoded as `(byte - 128) / 128`. Attribute names are
`position`, `covariance`, normalized `color`, and `sphericalHarmonics1/2/3`.
Do not feed ordinary PLY point geometry or floating SH arrays to `GaussianSplat`.
[r186 representation and factory](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/utils/GaussianSplatUtils.js)

`splats.splatGeometry` is the source data; `splats.geometry` is a separate internal
instanced quad. Treat source data as immutable once the object is constructed:
GPU storage is prepared from it, so ordinary attribute `needsUpdate` is not a
complete splat-update contract. Recreate the object for changed splat data.
Source geometry bounds cover centers only; `splats.computeBoundingBox()` and
`splats.computeBoundingSphere()` include covariance extents. Use these object
bounds for culling and helpers. Picking tests covariance ellipsoids, skips opacity
below 0.2, and reports the source splat `index`, with no triangle face or barycentric
coordinates; it is not exact rendered-pixel selection. Raycasting scans splats,
so bound query frequency for large assets. Automatic depth sorting is approximate
4096-bin counting sort; the official bundled `CountingSort` uses GPU compute or
CPU sorting for the WebGL fallback, not an external sort worker.
[r186 bounds, picking, and sorting](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/objects/GaussianSplat.js) ·
[r186 CountingSort](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/gpgpu/CountingSort.js)

## Lifecycle and performance
- Reuse indexed vertices, merge compatible static geometry, or instance repeated
  geometry only when profiling shows draw-call pressure; segment counts are
  content- and device-dependent.
- Removing an object from a scene does not free GPU resources.
- Call `geometry.dispose()` and `material.dispose()` only after their final consumer.
  Dispose textures according to their owner.
- For ordinary meshes/lines/points, notify the retiring object with `object.dispose()`
  separately from its externally owned geometry/materials; disposal is not recursive.
  For `BatchedMesh`, its override owns the internal geometry/textures: call it once
  and do not double-dispose those allocations. Stop frame/update producers before
  releasing resources, and retire shared resources only after their last user.
- Call `InstancedMesh.dispose()` for resources owned by that instance object; it does
  not recursively dispose its shared geometry or material.
- For `GaussianSplat`, separately dispose the object, its internal geometry/material,
  and the source `splatGeometry` after their final users. In r186, internal sort and
  SH compute resources have no public per-splat teardown API. With a renderer-created
  native `GPUDevice`, bound their GPU lifetime to the owning renderer and await its
  final disposal. A supplied device remains caller-owned; renderer disposal alone
  cannot guarantee private compute retirement, so its owner must retire the device
  after its final users.
  [r186 Object3D disposal](https://github.com/mrdoob/three.js/blob/r186/src/core/Object3D.js) ·
  [r186 renderer disposal](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js) ·
  [r186 native backend device ownership](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPUBackend.js#L3271-L3275)

Official references: [BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html),
[geometry constants and constructors](https://threejs.org/docs/index.html#api/en/geometries/BoxGeometry),
[cleanup manual](https://threejs.org/manual/#en/cleanup), and
[r186 release notes](https://github.com/mrdoob/three.js/releases/tag/r186).
