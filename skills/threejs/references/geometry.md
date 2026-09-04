# Geometry — Three.js 0.185.1

## Scope
Use this reference for built-in geometry generators, custom `BufferGeometry`, lines,
points, instancing, geometry utilities, bounds, mutation, and disposal. Materials,
textures, shaders/TSL, animation, interaction, and render-loop policy have separate
owners.

Core classes import from `three`. Example addons import through `three/addons/...`.
All APIs and behavior below target Three.js 0.185.1 exactly.
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
  already use the correct width. [r185 index selection](https://github.com/mrdoob/three.js/blob/r185/src/core/BufferGeometry.js#L311-L325),
  [r185 primitive-restart threshold](https://github.com/mrdoob/three.js/blob/r185/src/utils.js#L61-L71)

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
is not stable against Three.js 0.185.1. [revision 185 source](https://github.com/mrdoob/three.js/blob/r185/src/geometries/CapsuleGeometry.js)
| [r176 change](https://github.com/mrdoob/three.js/releases/tag/r176)

Also use `DodecahedronGeometry`, `IcosahedronGeometry`, `OctahedronGeometry`, or
`TetrahedronGeometry` for regular solids; `PolyhedronGeometry` for explicit vertices
and faces; `LatheGeometry` for a `Vector2` profile; `ShapeGeometry` for flat shapes;
`ExtrudeGeometry` for depth/bevel; and `TubeGeometry` for a `Curve<Vector3>` path.
Generated geometry is ordinary `BufferGeometry` and follows the same lifecycle.
### TextGeometry addon
```js
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

const font = await new FontLoader().loadAsync("/fonts/helvetiker_regular.typeface.json");
const text = new TextGeometry("0.185.1", {
  font,
  size: 0.5,
  depth: 0.12,
  curveSegments: 8,
  bevelEnabled: false,
});
text.center();
```
The application must host that JSON URL. Three.js 0.185.1 no longer publishes `examples/fonts`
in the npm package. Use `depth`, not the pre-r163 option name `height`.
[Font asset removal](https://github.com/mrdoob/three.js/pull/33744) |
[TextGeometry revision 185 source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/geometries/TextGeometry.js)

## Custom BufferGeometry
This complete pattern creates a lit, indexed quad with two material groups:
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

For compact color storage, normalization is required:
```js
const bytes = new Uint8Array([255, 64, 0, 0, 128, 255]);
geometry.setAttribute("color", new THREE.BufferAttribute(bytes, 3, true));
```
With `normalized: true`, attribute getters/setters expose normalized values while
`.array` remains raw integer storage. Enable `material.vertexColors` when consuming
`color`. [BufferAttribute revision 185 source](https://github.com/mrdoob/three.js/blob/r185/src/core/BufferAttribute.js)

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
Changing positions invalidates any existing bounds: recompute the box and sphere
before culling, raycasting, or helpers use them. `computeVertexNormals()` updates
and marks the normal attribute; do not increment its version a second time.
Call `clearUpdateRanges()` only when resetting ranges manually; renderers consume
and clear uploaded ranges. For interleaved attributes, usage, ranges, and
`needsUpdate` belong to the shared `InterleavedBuffer`. Morph attribute data cannot
be changed after first render; dispose the geometry and create a replacement.
[BufferGeometry update manual](https://threejs.org/manual/en/how-to-update-things.html) |
[BufferAttribute update-range API](https://threejs.org/docs/pages/BufferAttribute.html) |
[revision 185 BufferGeometry source](https://github.com/mrdoob/three.js/blob/r185/src/core/BufferGeometry.js)

`applyMatrix4`, `rotateX/Y/Z`, `translate`, `scale`, and `center` mutate vertex
data; they mark affected attributes and refresh bounds that already exist. Use
`Object3D` transforms for ordinary runtime motion; these are one-time CPU edits.
[BufferGeometry#applyMatrix4, revision 185](https://github.com/mrdoob/three.js/blob/r185/src/core/BufferGeometry.js#L376-L424)

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
Use `LineLoop` for a closed chain and `LineSegments` when each vertex pair is an
independent segment. `EdgesGeometry(source, thresholdAngle)` emits boundary edges
and edges whose adjacent face-normal angle exceeds the threshold;
`WireframeGeometry(source)` emits all triangle edges.

## Instancing
Prefer `InstancedMesh` when geometry and material are shared:
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
scale. [InstancedMesh revision 185 source](https://github.com/mrdoob/three.js/blob/r185/src/objects/InstancedMesh.js)

For custom per-instance attributes, use `InstancedBufferGeometry` and a material
that consumes them. Set `instanceCount` explicitly:
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
[InstancedBufferGeometry revision 185 source](https://github.com/mrdoob/three.js/blob/r185/src/core/InstancedBufferGeometry.js)

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
[Utility revision 185 source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/utils/BufferGeometryUtils.js)

## Lifecycle and performance
- Reuse indexed vertices, merge compatible static geometry, or instance repeated
  geometry only when profiling shows draw-call pressure; segment counts are
  content- and device-dependent.
- Removing an object from a scene does not free GPU resources.
- Call `geometry.dispose()` and `material.dispose()` only after their final consumer.
  Dispose textures according to their owner.
- Call `InstancedMesh.dispose()` for resources owned by that instance object; it does
  not recursively dispose its shared geometry or material.

Official references: [BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html),
[geometry constants and constructors](https://threejs.org/docs/index.html#api/en/geometries/BoxGeometry),
[cleanup manual](https://threejs.org/manual/#en/cleanup), and
[r185 release notes](https://github.com/mrdoob/three.js/releases/tag/r185).
