import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { example } from './examples.mjs';

// Serve only the pinned dependency and modules assembled from the documented examples.
const packageRoot = new URL('../', import.meta.resolve('three'));
const modules = {
  baseline: `${await example('webgl-baseline')}\nexport { renderer, camera, scene, resize, dispose };`,
  material: `${await example('tsl-material')}\nexport { createPulseMaterial };`,
  compute: `${await example('tsl-compute')}\nexport { computeSquares };`,
  post: `const { scene, camera, width, height } = globalThis.fixture;\n${await example('post-webgl')}
    ${await example('post-resize')}\nexport { renderer, composer, resize };`,
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<style>html,body{margin:0;width:100%;height:100%}#view{display:block;width:100%;height:100%}</style>
        <script type="importmap">{"imports":{
          "three":"/three/build/three.module.js",
          "three/webgpu":"/three/build/three.webgpu.js",
          "three/tsl":"/three/build/three.tsl.js",
          "three/addons/":"/three/examples/jsm/"
        }}</script><canvas id="view"></canvas>`);
    } else if (path.startsWith('/examples/')) {
      const code = modules[path.slice('/examples/'.length)];
      if (!code) throw new Error('Unknown example');
      res.setHeader('Content-Type', 'text/javascript'); res.end(code);
    } else if (path.startsWith('/three/')) {
      const file = new URL(path.slice('/three/'.length), packageRoot);
      if (!file.href.startsWith(packageRoot.href)) throw new Error('Invalid path');
      res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(file));
    } else if (path === '/favicon.ico') { res.writeHead(204); res.end(); }
    else { res.writeHead(404); res.end(); }
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => { globalThis.baseline = await import('/examples/baseline'); });
  await page.setViewportSize({ width: 480, height: 240 });
  await page.waitForFunction(() => baseline.renderer.domElement.width === 480 && baseline.camera.aspect === 2);
  const baseline = await page.evaluate(async () => {
    const { renderer, scene, camera, dispose } = globalThis.baseline;
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const pixels = new Uint8Array(4);
    gl.readPixels(240, 120, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let frames = 0;
    const render = renderer.render.bind(renderer);
    renderer.render = (...args) => { frames++; return render(...args); };
    dispose();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { pixels: [...pixels], stopped: frames === 0, canvasRetained: !!document.querySelector('#view') };
  });
  assert.ok(baseline.pixels[2] > baseline.pixels[0], 'baseline renders its blue mesh');
  assert.ok(baseline.stopped && baseline.canvasRetained, 'teardown stops the loop and retains the host-owned canvas');
  console.log('PASS: documented WebGL baseline renders, resizes, and tears down.');

  const post = await page.evaluate(async () => {
    const THREE = await import('three');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); camera.position.z = 3;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: 0x3366ff }));
    scene.add(mesh);
    globalThis.fixture = { scene, camera, width: 160, height: 90 };
    const { renderer, composer, resize } = await import('/examples/post');
    try {
      const sizes = [];
      for (const [width, height, dpr] of [[320, 180, 2], [150, 100, 1]]) {
        resize(width, height, dpr); composer.render();
        sizes.push({ canvas: [renderer.domElement.width, renderer.domElement.height],
          target: [composer.readBuffer.width, composer.readBuffer.height], aspect: camera.aspect });
      }
      return sizes;
    } finally {
      renderer.setAnimationLoop(null);
      for (const pass of composer.passes) pass.dispose();
      composer.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); renderer.dispose();
    }
  });
  assert.deepEqual(post, [
    { canvas: [640, 360], target: [640, 360], aspect: 320 / 180 },
    { canvas: [150, 100], target: [150, 100], aspect: 1.5 },
  ]);
  console.log('PASS: documented composer sizing applies DPR once and updates camera/targets.');

  for (const forceWebGL of [true, false]) {
    const result = await page.evaluate(async forceWebGL => {
      const THREE = await import('three/webgpu');
      const { createPulseMaterial } = await import('/examples/material');
      const { computeSquares } = await import('/examples/compute');
      const renderer = new THREE.WebGPURenderer({ forceWebGL, antialias: false });
      await renderer.init();
      if (!forceWebGL && !renderer.backend.isWebGPUBackend) { renderer.dispose(); return { skipped: true }; }
      const material = createPulseMaterial();
      const geometry = new THREE.PlaneGeometry(2, 2);
      const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material.material));
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera.position.z = 1;
      const target = new THREE.RenderTarget(8, 8, { type: THREE.UnsignedByteType });
      try {
        renderer.setRenderTarget(target);
        const samples = [];
        for (const time of [Math.PI / 2, 3 * Math.PI / 2]) {
          material.update(time); renderer.render(scene, camera);
          samples.push([...await renderer.readRenderTargetPixelsAsync(target, 4, 4, 1, 1)]);
        }
        renderer.setRenderTarget(null);
        // A non-workgroup multiple also exercises dispatch bounds.
        const squares = [...await computeSquares(renderer, 65)];
        return { samples, squares };
      } finally {
        scene.clear(); target.dispose(); geometry.dispose(); material.dispose(); renderer.dispose();
      }
    }, forceWebGL);
    const backend = forceWebGL ? 'WebGL 2 fallback' : 'WebGPU';
    if (result.skipped) {
      assert.notEqual(process.env.REQUIRE_WEBGPU, '1', 'WebGPU unavailable but REQUIRE_WEBGPU=1');
      console.log('SKIP: WebGPU adapter unavailable; this is not a native WebGPU pass.');
      continue;
    }
    assert.ok(result.samples[0][2] > result.samples[1][2], `${backend}: uniform changes rendered color`);
    assert.deepEqual(result.squares.slice(0, 65), Array.from({ length: 65 }, (_, i) => i * i));
    console.log(`PASS: documented TSL material renders and compute readback is correct on ${backend}.`);
  }
  assert.deepEqual(errors, [], 'browser/shader errors');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
