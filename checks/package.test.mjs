import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { toTrianglesDrawMode } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { files, root, skillRoot, codeBlocks, example } from './examples.mjs';

test('one entry point reaches every reference exactly once, with no reference chains', async () => {
  const entry = await readFile(new URL('SKILL.md', skillRoot), 'utf8');
  assert.ok(entry.split('\n').length < 500);
  const routes = [...entry.matchAll(/\]\((references\/[^)#]+)(?:#[^)]*)?\)/g)].map(m => m[1]);
  const references = files.slice(1).map(file => `references/${file.pathname.split('/').at(-1)}`);
  assert.deepEqual(routes.toSorted(), references.toSorted());
  for (const file of [...files, new URL('README.md', root)]) {
    const source = await readFile(file, 'utf8');
    for (const [, link] of source.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^[a-z]+:|^#/i.test(link)) continue;
      const target = new URL(link.split('#')[0], file);
      await access(target);
      if (file.pathname.includes('/references/')) assert.ok(!target.pathname.endsWith('.md'), `${file}: reference chain`);
    }
    const fences = source.match(/^\s*```/gm) ?? [];
    assert.equal(fences.length % 2, 0, `${file}: unbalanced code fences`);
  }
});

test('JavaScript examples parse and explicit imports exist in the pinned package', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.resolve('three')), 'utf8'));
  assert.equal(pkg.version, '0.186.1');
  assert.equal(THREE.REVISION, '186');
  let snippets = 0;
  const modules = new Map();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const { language, code } of codeBlocks(source)) {
      if (!['js', 'javascript'].includes(language)) continue;
      snippets++;
      const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: code, encoding: 'utf8' });
      assert.equal(result.status, 0, `${file}: ${result.stderr}`);
    }
    for (const [, names, , specifier] of source.matchAll(/import\s+(\*\s+as\s+\w+|\{[^}]+\})\s+from\s+(['"])(three[^'"]*)\2/g)) {
      assert.match(specifier, /^three(?:\/(?:webgpu|tsl|addons\/.+))?$/);
      if (!modules.has(specifier)) modules.set(specifier, await import(specifier));
      if (names.startsWith('{')) {
        for (const part of names.slice(1, -1).split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0];
          if (name) assert.ok(name in modules.get(specifier), `${specifier}: missing ${name}`);
        }
      }
    }
  }
  console.log(`Parsed ${snippets} JavaScript examples; checked ${modules.size} module imports.`);
});

test('vertex index 65535 requires 32-bit storage for the WebGL primitive-restart boundary', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex([0, 1, 65534]);
  assert.ok(geometry.index.array instanceof Uint16Array);
  geometry.setIndex([0, 1, 65535]);
  assert.ok(geometry.index.array instanceof Uint32Array);
  geometry.dispose();
});

test('transformed primitive serialization preserves edited vertex and index data', () => {
  const geometry = new THREE.BoxGeometry(1, 2, 3);
  const material = new THREE.MeshBasicMaterial();
  let restored;
  try {
    geometry.translate(4, 5, 6);
    const mesh = new THREE.Mesh(geometry, material);
    restored = new THREE.ObjectLoader().parse(mesh.toJSON());
    assert.deepEqual(restored.geometry.getAttribute('position').array, geometry.getAttribute('position').array);
    assert.deepEqual(restored.geometry.getAttribute('normal').array, geometry.getAttribute('normal').array);
    assert.deepEqual(restored.geometry.index.array, geometry.index.array);
    restored.geometry.computeBoundingBox();
    assert.deepEqual(restored.geometry.boundingBox.min.toArray(), [3.5, 4, 4.5]);
    assert.deepEqual(restored.geometry.boundingBox.max.toArray(), [4.5, 6, 7.5]);
  } finally {
    restored?.geometry.dispose(); restored?.material.dispose(); geometry.dispose(); material.dispose();
  }
});

test('documented r186 geometry conversion and async simplification preserve distinct ownership', async () => {
  const code = (await example('geometry-r186')).replace(/from\s+(['"])(three[^'"]*)\1/g,
    (_, quote, specifier) => `from ${quote}${import.meta.resolve(specifier)}${quote}`);
  const { createGeometryR186 } = await import(`data:text/javascript,${encodeURIComponent(`${code}\nexport { createGeometryR186 };`)}`);
  const { source, triangles, simplified } = await createGeometryR186();
  const candidate = source.clone();
  try {
    const position = candidate.getAttribute('position');
    assert.equal(toTrianglesDrawMode(candidate, THREE.TriangleStripDrawMode), candidate);
    assert.equal(candidate.getAttribute('position'), position);
    assert.deepEqual([...candidate.index.array], [0, 1, 2, 3, 2, 1]);
    assert.deepEqual(candidate.groups, []);
    assert.equal(source.index, null);
    assert.deepEqual(source.groups, [{ start: 0, count: 4, materialIndex: 0 }]);
    assert.deepEqual([...triangles.index.array], [0, 1, 2, 3, 2, 1]);
    assert.notEqual(triangles.getAttribute('position').array, source.getAttribute('position').array);
    assert.notEqual(simplified, triangles);
    assert.ok(simplified.index && simplified.index.count >= 3 && simplified.index.count <= triangles.index.count);
    const referenced = new Set(simplified.index.array);
    assert.equal(referenced.size, simplified.getAttribute('position').count, 'simplified buffers contain only referenced vertices');
    for (const index of referenced) assert.ok(index >= 0 && index < simplified.getAttribute('position').count);
    assert.notEqual(simplified.getAttribute('position').array, triangles.getAttribute('position').array);
    assert.ok(simplified.boundingBox && simplified.boundingSphere);
    const inputValue = triangles.getAttribute('position').getX(0);
    simplified.getAttribute('position').setX(0, 99);
    assert.equal(triangles.getAttribute('position').getX(0), inputValue, 'editing the result does not mutate its input');
  } finally {
    candidate.dispose(); source.dispose(); triangles.dispose(); simplified.dispose();
  }
});

test('async simplification reduces an indexed surface without mutating consumer-owned buffers', async () => {
  const source = new THREE.PlaneGeometry(2, 2, 8, 8);
  const originalIndex = source.index.array.slice();
  const originalPositions = source.getAttribute('position').array.slice();
  let simplified;
  try {
    const pending = new SimplifyModifier().modify(source, 40);
    assert.ok(pending instanceof Promise);
    simplified = await pending;
    assert.notEqual(simplified, source);
    assert.ok(simplified.index.count < source.index.count, 'requested simplification removes triangles');
    assert.ok(simplified.index.count >= 3 && simplified.index.count % 3 === 0);
    assert.deepEqual(source.index.array, originalIndex);
    assert.deepEqual(source.getAttribute('position').array, originalPositions);
    const referenced = new Set(simplified.index.array);
    assert.equal(referenced.size, simplified.getAttribute('position').count);
    for (const index of referenced) assert.ok(index < simplified.getAttribute('position').count);
    for (const name of ['position', 'normal', 'uv']) {
      assert.notEqual(simplified.getAttribute(name).array, source.getAttribute(name).array);
      assert.equal(simplified.getAttribute(name).count, referenced.size);
    }
  } finally {
    simplified?.dispose(); source.dispose();
  }
});
