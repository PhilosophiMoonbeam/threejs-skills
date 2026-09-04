import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { files, root, skillRoot, codeBlocks } from './examples.mjs';

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
  assert.equal(pkg.version, '0.185.1');
  assert.equal(THREE.REVISION, '185');
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
