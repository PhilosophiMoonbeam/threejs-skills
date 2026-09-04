import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import * as THREE from 'three';
import { evaluateExample } from './examples.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function loadingFixture() {
  const timers = new Map();
  let timerId = 0;
  const loadOwned = await evaluateExample('owned-load', {
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  }, 'loadOwned');
  const pending = deferred();
  const controller = new AbortController();
  const released = [];
  let started = 0, aborted = 0, settled = 0;
  const manager = new THREE.LoadingManager();
  const abort = manager.abort.bind(manager);
  manager.abort = () => { aborted++; abort(); };
  const loader = { manager, loadAsync() { started++; return pending.promise; } };
  const start = () => loadOwned(loader, 'model.glb', {
    signal: controller.signal,
    release(value) { released.push(value); },
    onSettled() { settled++; },
  });
  const clean = () => {
    assert.equal(timers.size, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  };
  return { start, pending, controller, released, timers, loader, clean,
    counts: () => ({ started, aborted, settled }) };
}

test('unmount rejects promptly and releases a late result exactly once', async () => {
  const f = await loadingFixture();
  const result = f.start();
  const reason = new Error('Unmounted');
  f.controller.abort(reason);
  await assert.rejects(result, error => error === reason);
  f.clean();
  assert.equal(f.counts().settled, 0, 'decoder retirement waits for the underlying load');
  const asset = {};
  f.pending.resolve(asset);
  await new Promise(setImmediate);
  assert.deepEqual(f.released, [asset]);
  assert.deepEqual(f.counts(), { started: 1, aborted: 1, settled: 1 });
});

test('timeout handles a loader that ignores transport abort', async () => {
  const f = await loadingFixture();
  const result = f.start();
  [...f.timers.values()][0]();
  await assert.rejects(result, /Timed out/);
  f.pending.resolve('late texture');
  await new Promise(setImmediate);
  assert.deepEqual(f.released, ['late texture']);
  assert.equal(f.counts().settled, 1);
  f.clean();
});

test('successful loading transfers ownership and removes cancellation hooks', async () => {
  const f = await loadingFixture();
  const result = f.start();
  const asset = {};
  f.pending.resolve(asset);
  assert.equal(await result, asset);
  f.controller.abort();
  await new Promise(setImmediate);
  assert.deepEqual(f.released, []);
  assert.deepEqual(f.counts(), { started: 1, aborted: 0, settled: 1 });
  f.clean();
});

test('pre-abort, load rejection, and synchronous throw release scheduling resources', async () => {
  for (const mode of ['pre-abort', 'reject', 'throw']) {
    const f = await loadingFixture();
    const error = new Error(mode);
    if (mode === 'pre-abort') f.controller.abort(error);
    if (mode === 'throw') f.loader.loadAsync = () => { throw error; };
    const result = f.start();
    if (mode === 'reject') f.pending.reject(error);
    await assert.rejects(result, e => e === error);
    await new Promise(setImmediate);
    f.clean();
    assert.equal(f.counts().settled, 1);
    if (mode === 'pre-abort') assert.equal(f.counts().started, 0);
  }
});

test('picking sees current parent/camera transforms before render and refreshes stationary hover', async () => {
  const canvas = new EventTarget();
  canvas.style = { cursor: 'crosshair' };
  canvas.getBoundingClientRect = () => ({ left: 40, top: 20, width: 200, height: 100 });
  const scene = new THREE.Scene();
  const modelRoot = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  modelRoot.add(mesh); scene.add(modelRoot);
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.z = 3;
  class Controls extends THREE.EventDispatcher { update() {} dispose() {} }
  const api = await evaluateExample('picking', {
    THREE, OrbitControls: Controls, scene, modelRoot, camera,
    renderer: { domElement: canvas, render() {} },
  }, '({ pickNearest, onPointerMove, invalidatePicking, render, disposeInteraction, controls, hovered: () => hovered })');
  const pointer = { clientX: 140, clientY: 70 };
  assert.equal(api.pickNearest(pointer).object, mesh, 'works before first render');
  modelRoot.position.x = 10;
  assert.equal(api.pickNearest(pointer), null, 'parent motion affects picking immediately');
  camera.position.x = 10;
  assert.equal(api.pickNearest(pointer).object, mesh, 'camera motion affects picking immediately');
  api.onPointerMove(pointer); api.render();
  assert.equal(api.hovered(), mesh);
  modelRoot.position.x = 20;
  api.invalidatePicking(); api.render();
  assert.equal(api.hovered(), null, 'scene invalidation refreshes hover without pointer motion');
  modelRoot.position.x = 10;
  api.controls.dispatchEvent({ type: 'change' }); api.render();
  assert.equal(api.hovered(), mesh);
  api.disposeInteraction();
  assert.equal(canvas.style.cursor, 'crosshair');
  assert.equal(getEventListeners(canvas, 'pointermove').length, 0);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('on-demand rendering coalesces changes, settles damping, and cannot restart after teardown', async () => {
  const frames = new Map();
  let nextId = 0, rendered = 0, disconnected = false, damping = 2;
  const controls = new THREE.EventDispatcher();
  controls.enableDamping = true;
  controls.update = () => { if (damping-- > 0) controls.dispatchEvent({ type: 'change' }); };
  const window = new EventTarget();
  const api = await evaluateExample('on-demand', {
    controls, window, scene: {}, camera: {}, resize() {},
    renderer: { domElement: {}, render() { rendered++; } },
    requestAnimationFrame(fn) { frames.set(++nextId, fn); return nextId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class { observe() {} disconnect() { disconnected = true; } },
  }, '({ invalidate, disposeScheduling })');
  api.invalidate(); api.invalidate();
  assert.equal(frames.size, 1);
  for (let i = 0; i < 3; i++) {
    assert.equal(frames.size, 1);
    const [id, frame] = [...frames][0]; frames.delete(id); frame();
  }
  assert.equal(rendered, 3);
  assert.equal(frames.size, 0, 'damping settles without a perpetual frame loop');
  api.invalidate(); api.disposeScheduling(); api.invalidate();
  controls.dispatchEvent({ type: 'change' });
  window.dispatchEvent(new Event('resize'));
  assert.equal(frames.size, 0);
  assert.ok(disconnected);
  assert.equal(getEventListeners(window, 'resize').length, 0);
});
