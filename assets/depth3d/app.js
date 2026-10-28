// 3D Lab: photo -> depth (neural network in the browser) -> 3D mesh viewer and export

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { normalizeDepth, buildMesh } from './mesh.js';
import { readFocal35, measure as measureDist, formatMeters } from './measure.js';

const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';
const MODEL = 'onnx-community/depth-anything-v2-small';
const MAX_SIDE = 1024;
const MAX_BYTES = 20 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const state = { photoCanvas: null, photo: null, depth: null, mesh: null, data: null, mode: 'texture', job: 0, device: '', imageId: 0 };
// Distance tool: scene type, camera focal length (35 mm equiv.), calibration scale, picked points, metric depth maps per scene
const M = { on: false, scene: 'indoor', f35: 26, f35From: 'assumed', scale: 1, pts: [], maps: {}, est: null, estScene: '', group: null, mid: null, result: null };
let dlLabel = 'the depth model';

/* ---------- Status ---------- */

function setStatus(text, frac) {
  $('status-text').textContent = text;
  $('bar').style.width = (frac == null ? 0 : Math.round(frac * 100)) + '%';
  $('status').classList.toggle('done', frac === 1);
}

/* ---------- Viewer ---------- */

let renderer, scene, camera, controls, texture, points = null, raf = 0, wiggle = true, baseDist = 2;
const viewer = $('viewer');
const mats = {};

function initViewer() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, alpha: true, preserveDrawingBuffer: false });
  } catch (e) {
    setStatus('Your browser could not start WebGL, which the 3D viewer needs.', 0);
    return false;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(-1, 1.5, 2);
  scene.add(key);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', () => { wiggle = false; $('c-wiggle').checked = false; });
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!M.on || !down) return;
    const click = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.t < 500;
    down = null;
    if (click) pick3D(e);
  });
  new ResizeObserver(resize).observe(viewer);
  resize();
  return true;
}

function resize() {
  const w = viewer.clientWidth, h = viewer.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}

function requestRender() { if (!raf) raf = requestAnimationFrame(frame); }

function frame(t) {
  raf = 0;
  if (wiggle && state.mesh) {
    const a = 0.45 * Math.sin(t * 0.0012), e = 0.12 * Math.sin(t * 0.0007 + 1);
    camera.position.set(Math.sin(a) * baseDist, Math.sin(e) * baseDist * 0.6, Math.cos(a) * baseDist);
    camera.lookAt(0, 0, 0);
    controls.update();
  }
  renderer.render(scene, camera);
  updateLabel();
  if (wiggle && state.mesh && !document.hidden) requestRender();
}

function fitCamera() {
  const m = state.data, tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const w = m.aspect * 1.15, h = 1.15;
  baseDist = Math.max(h / 2 / tan, w / 2 / (tan * camera.aspect)) + m.zmax * 0.6;
  camera.position.set(0, 0, baseDist);
  camera.near = baseDist / 50; camera.far = baseDist * 10;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

function accent() { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7a30c4'; }

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toLinear = (a) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = srgbToLinear(a[i]); return o; };

function applyMode() {
  if (!state.mesh) return;
  const m = state.mode, solid = !!state.data.solid;
  const front = m === 'texture' ? new THREE.MeshLambertMaterial({ map: texture })
    : m === 'depth' ? new THREE.MeshLambertMaterial({ vertexColors: true })
    : new THREE.MeshBasicMaterial({ color: accent(), wireframe: true });
  const back = m === 'texture' ? new THREE.MeshLambertMaterial({ color: 0x8c909c })
    : m === 'depth' ? new THREE.MeshLambertMaterial({ vertexColors: true })
    : new THREE.MeshBasicMaterial({ color: accent(), wireframe: true });
  [].concat(state.mesh.material).forEach((x) => x.dispose());
  state.mesh.material = solid ? [front, back] : [front];
  state.mesh.visible = m !== 'points';
  if (points) points.visible = m === 'points';
  requestRender();
}

function rebuild() {
  if (!state.depth) return;
  const o = {
    res: +$('c-res').value, strength: +$('c-strength').value, smooth: +$('c-smooth').value, cutoff: +$('c-cutoff').value,
    edge: +$('c-edge').value, invert: $('c-invert').checked, solid: $('c-solid').checked, thickness: +$('c-thick').value
  };
  const d = buildMesh(state.depth.data, state.depth.w, state.depth.h, state.photo, o);
  if (!d.V) { setStatus('Nothing left to show. Lower "Remove background" or "Cut stretched edges".', 0); return; }
  state.data = d;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(toLinear(d.depthColor), 3));
  geo.setIndex(new THREE.BufferAttribute(d.index, 1));
  geo.addGroup(0, d.frontCount, 0);
  if (d.backCount) geo.addGroup(d.frontCount, d.backCount, 1);
  geo.computeVertexNormals();

  if (state.mesh) { state.mesh.geometry.dispose(); scene.remove(state.mesh); }
  if (points) { points.geometry.dispose(); points.material.dispose(); scene.remove(points); }
  state.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  state.mesh.position.z = -d.zmax / 2;
  scene.add(state.mesh);

  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(d.position.subarray(0, d.V * 3), 3));
  pg.setAttribute('color', new THREE.BufferAttribute(toLinear(d.color.subarray(0, d.V * 3)), 3));
  points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 1.7 * d.long / o.res, vertexColors: true, sizeAttenuation: true }));
  points.position.z = state.mesh.position.z;
  scene.add(points);

  applyMode();
  setStatsText(d);
  place3D();
}

function setStatsText(d) {
  const tris = Math.round((d.frontCount + d.backCount) / 3);
  $('viewer-hint').textContent = 'Drag to rotate · scroll to zoom · right-drag to pan · ' + d.V.toLocaleString() + ' points, ' + tris.toLocaleString() + ' triangles';
}

/* ---------- Depth model ---------- */

let estimator = null, tf = null;
const files = {};

function onProgress(p) {
  if (p.status === 'progress' && p.total) {
    files[p.file] = { loaded: p.loaded, total: p.total };
    let l = 0, t = 0;
    Object.keys(files).forEach((k) => { l += files[k].loaded; t += files[k].total; });
    setStatus('Downloading ' + dlLabel + ' (first time only): ' + Math.round(l / 1048576) + ' of ' + Math.round(t / 1048576) + ' MB', 0.05 + 0.6 * (l / t));
  }
}

let chain = Promise.resolve();          // model loads/runs share global settings, so run them one at a time
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

async function loadEstimator(device) {
  const dtype = device === 'webgpu' ? 'fp16' : 'q8';
  dlLabel = 'the depth model'; Object.keys(files).forEach((k) => delete files[k]);
  tf.env.allowLocalModels = false; tf.env.allowRemoteModels = true;
  if (device === 'wasm') tf.env.backends.onnx.wasm.proxy = true;     // keep the page responsive while the CPU works
  estimator = await tf.pipeline('depth-estimation', MODEL, { device, dtype, progress_callback: onProgress });
  state.device = device;
}

function getEstimator() {
  return serial(async () => {
    if (estimator) return estimator;
    setStatus('Loading the depth model…', 0.05);
    tf = tf || await import(TF_URL);
    let device = 'wasm';
    try { if (navigator.gpu && (await navigator.gpu.requestAdapter())) device = 'webgpu'; } catch (e) { /* use wasm */ }
    try { await loadEstimator(device); }
    catch (e) { if (device === 'wasm') throw e; await loadEstimator('wasm'); }
    return estimator;
  });
}

async function estimateDepth(canvas) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  const url = URL.createObjectURL(blob);
  try {
    let out;
    try { out = await estimator(url); }
    catch (e) {
      if (state.device !== 'webgpu') throw e;
      estimator = null; await serial(() => loadEstimator('wasm')); out = await estimator(url);
    }
    return Array.isArray(out) ? out[0] : out;
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Image handling ---------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be read as an image. Try a JPG, PNG or WebP.'));
    img.src = src;
  });
}

function setEnabled(on) { ['shape', 'view', 'measure', 'export'].forEach((id) => { $(id).disabled = !on; }); }

async function processSource(src, revoke) {
  const job = ++state.job, t0 = performance.now();
  setEnabled(false);
  $('drop').classList.add('busy');
  try {
    setStatus('Reading image…', 0.02);
    state.imageId = job;
    resetMeasure(await focalFromSource(src));
    const img = await loadImage(src);
    if (revoke) URL.revokeObjectURL(src);
    const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(2, Math.round(img.naturalWidth * s)), h = Math.max(2, Math.round(img.naturalHeight * s));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    state.photoCanvas = cv;
    state.photo = { data: ctx.getImageData(0, 0, w, h).data, w, h };
    drawThumb($('cv-photo'), cv);
    $('thumbs').hidden = false;

    await getEstimator();
    if (job !== state.job) return;
    setStatus('Estimating depth…', 0.7);
    await new Promise((r) => setTimeout(r, 30));
    const out = await estimateDepth(cv);
    if (job !== state.job) return;
    const dims = out.predicted_depth.dims, dh = dims[dims.length - 2], dw = dims[dims.length - 1];
    state.depth = { data: normalizeDepth(out.predicted_depth.data, dw, dh), w: dw, h: dh };
    drawDepthThumb();

    if (texture) texture.dispose();
    texture = new THREE.CanvasTexture(cv);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    setStatus('Building the 3D mesh…', 0.92);
    rebuild();
    if (!state.data) return;
    fitCamera();
    $('drop').hidden = true;
    $('viewer-hint').hidden = false;
    wiggle = $('c-wiggle').checked;
    setEnabled(true);
    requestRender();
    if (matchMedia('(max-width: 1100px)').matches) viewer.scrollIntoView({ behavior: 'smooth', block: 'center' });   // controls stack above the viewer on small screens
    setStatus('Done in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s · ' + (state.device === 'webgpu' ? 'WebGPU' : 'CPU (WebAssembly)') + ' · ' + w + '×' + h + ' px photo', 1);
    if (M.on) ensureMetric();
  } catch (e) {
    console.error(e);
    setStatus('Something went wrong: ' + (e && e.message ? e.message : e), 0);
  } finally { $('drop').classList.remove('busy'); }
}

function drawThumb(canvas, src) {
  canvas.width = src.width; canvas.height = src.height;
  canvas.getContext('2d').drawImage(src, 0, 0);
}

function drawDepthThumb() {
  const { data, w, h } = state.depth, c = $('cv-depth'), ctx = c.getContext('2d');
  c.width = w; c.height = h;
  const im = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = Math.round(data[i] * 255); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  ctx.putImageData(im, 0, 0);
}

function handleFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { setStatus('Please choose an image file (JPG, PNG or WebP).', 0); return; }
  if (file.size > MAX_BYTES) { setStatus('That image is over 20 MB. Please use a smaller one.', 0); return; }
  processSource(URL.createObjectURL(file), true);
}

/* ---------- Distance measurement ---------- */

async function focalFromSource(src) {
  try { return readFocal35(await (await fetch(src)).arrayBuffer()); } catch (e) { return null; }
}

function resetMeasure(f35) {
  M.pts = []; M.maps = {}; M.scale = 1; M.result = null;
  M.f35 = f35 || 26; M.f35From = f35 ? "from the photo's EXIF data" : 'assumed: typical phone lens';
  syncMeasureLabels(); updateMeasureUI();
}

function syncMeasureLabels() {
  $('c-focal').value = M.f35;
  $('o-focal').textContent = M.f35 + ' mm';
  $('focal-note').textContent = '35 mm-equivalent, ' + M.f35From + '. Change it if you know your lens.';
  $('scale-note').textContent = M.scale === 1 ? '' : 'Calibrated: all distances scaled ×' + M.scale.toFixed(2) + '.';
  $('reset-scale').hidden = M.scale === 1;
}

function ensureMetric() {
  const scene = M.scene, img = state.imageId;
  if (!state.photoCanvas) return Promise.resolve(null);
  if (M.maps[scene]) return Promise.resolve(M.maps[scene]);
  return serial(async () => {
    if (M.maps[scene]) return M.maps[scene];
    tf = tf || await import(TF_URL);
    if (M.estScene !== scene) {
      if (M.est) { try { await M.est.dispose(); } catch (e) { /* ignore */ } M.est = null; }
      dlLabel = 'the ' + (scene === 'indoor' ? 'close-range' : 'far-range') + ' metric depth model'; Object.keys(files).forEach((k) => delete files[k]);
      setStatus('Loading the ' + (scene === 'indoor' ? 'close-range' : 'far-range') + ' metric depth model…', 0.05);
      tf.env.allowLocalModels = true; tf.env.allowRemoteModels = false; tf.env.localModelPath = '/assets/models/';
      M.est = await tf.pipeline('depth-estimation', 'da2-metric-' + scene, { device: 'wasm', dtype: 'q8', progress_callback: onProgress });
      M.estScene = scene;
    }
    setStatus('Estimating real-world distances (metric depth)…', 0.8);
    await new Promise((r) => setTimeout(r, 30));
    const blob = await new Promise((r) => state.photoCanvas.toBlob(r, 'image/jpeg', 0.92)), url = URL.createObjectURL(blob);
    let out;
    try { out = await M.est(url); } finally { URL.revokeObjectURL(url); }
    out = Array.isArray(out) ? out[0] : out;
    const dims = out.predicted_depth.dims, map = { data: Float32Array.from(out.predicted_depth.data), w: dims[dims.length - 1], h: dims[dims.length - 2] };
    if (img === state.imageId && scene === M.scene) { M.maps[scene] = map; updateMeasureUI(); }
    setStatus('Metric depth ready. Click two points to measure.', 1);
    return map;
  }).catch((e) => { console.error(e); setStatus('Could not load the metric model: ' + (e && e.message ? e.message : e), 0); return null; });
}

function setPoint(u, v) {
  if (M.pts.length >= 2) M.pts = [];
  M.pts.push({ u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) });
  if (!M.maps[M.scene]) ensureMetric();
  updateMeasureUI();
}

function pick3D(e) {
  if (!state.mesh) return;
  const r = renderer.domElement.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObject(state.mesh).find((h) => h.face && h.face.materialIndex === 0 && h.uv);
  if (hit) setPoint(hit.uv.x, 1 - hit.uv.y);
}

// Where the relief surface sits for a given image position (ray from the front, straight down the z axis)
function surfacePoint(u, v) {
  const d = state.data, x = (u - 0.5) * d.aspect, y = 0.5 - v;
  state.mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 50), new THREE.Vector3(0, 0, -1));
  const hit = ray.intersectObject(state.mesh).find((h) => h.face && h.face.materialIndex === 0);
  return hit ? hit.point.clone() : new THREE.Vector3(x, y, state.mesh.position.z + d.zmax * 0.3);
}

function place3D() {
  if (M.group) { scene.remove(M.group); M.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); M.group = null; }
  M.mid = null;
  if (!M.on || !state.mesh || !M.pts.length) { $('dist-label').hidden = true; requestRender(); return; }
  const g = new THREE.Group(), col = getComputedStyle(document.documentElement).getPropertyValue('--s2').trim() || '#eb6834';
  const pts = M.pts.map((p) => surfacePoint(p.u, p.v));
  pts.forEach((p) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.014 * state.data.long, 16, 12), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
    m.position.copy(p); m.renderOrder = 10; g.add(m);
  });
  if (pts.length === 2) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, depthTest: false }));
    l.renderOrder = 10; g.add(l);
    M.mid = pts[0].clone().add(pts[1]).multiplyScalar(0.5);
  }
  scene.add(g); M.group = g;
  requestRender();
}

function updateLabel() {
  const el = $('dist-label');
  if (!M.mid || !M.result) { el.hidden = true; return; }
  const p = M.mid.clone().project(camera);
  if (p.z > 1) { el.hidden = true; return; }
  el.hidden = false;
  el.style.left = ((p.x + 1) / 2 * viewer.clientWidth) + 'px';
  el.style.top = ((1 - p.y) / 2 * viewer.clientHeight) + 'px';
}

function compute() {
  const map = M.maps[M.scene];
  if (M.pts.length < 2 || !map) return null;
  const r = measureDist(map.data, map.w, map.h, M.pts[0], M.pts[1], state.photo.w, state.photo.h, M.f35), k = M.scale;
  return { distance: r.distance * k, dx: r.dx * k, dy: r.dy * k, dz: r.dz * k, za: r.za * k, zb: r.zb * k, raw: r.distance };
}

function updateMeasureUI() {
  const ln = $('ov-line');
  ['pt-a', 'pt-b'].forEach((id, i) => {
    const el = $(id), p = M.pts[i];
    el.hidden = !(M.on && p);
    if (p) { el.style.left = (p.u * 100) + '%'; el.style.top = (p.v * 100) + '%'; }
  });
  if (M.on && M.pts.length === 2) {
    ln.setAttribute('x1', M.pts[0].u * 100); ln.setAttribute('y1', M.pts[0].v * 100);
    ln.setAttribute('x2', M.pts[1].u * 100); ln.setAttribute('y2', M.pts[1].v * 100);
    ln.setAttribute('visibility', 'visible');
  } else ln.setAttribute('visibility', 'hidden');

  M.result = M.on && state.photo ? compute() : null;
  place3D();
  renderCard();
}

function renderCard() {
  const card = $('measure-card'), out = $('measure-out');
  card.hidden = !(M.on && state.photo);
  if (card.hidden) { $('dist-label').hidden = true; return; }
  out.textContent = '';
  const add = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; out.appendChild(e); return e; };
  if (M.pts.length < 2) { add('p', 'muted', M.pts.length === 0 ? 'Click point A on the photo or in the 3D view.' : 'Now click point B.'); $('dist-label').hidden = true; return; }
  if (!M.result) { add('p', 'muted', 'Estimating real-world distances. The first run downloads a 27 MB model.'); return; }
  const r = M.result;
  add('div', 'big', formatMeters(r.distance));
  $('dist-label').textContent = formatMeters(r.distance);
  add('p', 'sub', 'Straight-line distance between A and B.');
  const grid = document.createElement('dl'); grid.className = 'facts';
  [['Sideways', formatMeters(r.dx)], ['Up / down', formatMeters(r.dy)], ['Depth difference', formatMeters(r.dz)],
    ['A from camera', formatMeters(r.za)], ['B from camera', formatMeters(r.zb)]].forEach(([k, v]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; grid.append(dt, dd);
  });
  out.appendChild(grid);
  add('p', 'sub', 'Using the ' + (M.scene === 'indoor' ? 'close-range' : 'far-range') + ' model and a ' + M.f35 + ' mm lens (' + M.f35From + ')' + (M.scale !== 1 ? ', calibrated ×' + M.scale.toFixed(2) : '') + '. ' + (M.scale !== 1 ? 'Rescaled to match the length you entered; other distances are still estimates. ' : 'This is a rough estimate and can easily be off by 20% or more; calibrate with a known length to improve it. ') + 'Click inside surfaces, not on outlines.');
}

function setMeasureOn(on) {
  M.on = on;
  $('measure-toggle').textContent = on ? 'Stop measuring' : 'Start measuring';
  $('measure-toggle').setAttribute('aria-pressed', on);
  $('measure-opts').hidden = !on;
  $('photo-wrap').classList.toggle('measuring', on);
  viewer.classList.toggle('measuring', on);
  $('photo-sub').textContent = on ? 'Click two points on the photo to measure between them.' : 'Switch on "Measure distance" to click points here.';
  if (on) { wiggle = false; $('c-wiggle').checked = false; ensureMetric(); }
  updateMeasureUI();
}

$('measure-toggle').addEventListener('click', () => setMeasureOn(!M.on));
$('scenes').addEventListener('click', (e) => {
  const c = e.target.closest('.chip'); if (!c || c.dataset.scene === M.scene) return;
  M.scene = c.dataset.scene; M.scale = 1;
  document.querySelectorAll('#scenes .chip').forEach((x) => { const a = x === c; x.classList.toggle('active', a); x.setAttribute('aria-checked', a); });
  syncMeasureLabels(); updateMeasureUI(); ensureMetric();
});
$('c-focal').addEventListener('input', function () { M.f35 = +this.value; M.f35From = 'set by you'; M.scale = 1; syncMeasureLabels(); updateMeasureUI(); });
$('clear-pts').addEventListener('click', () => { M.pts = []; updateMeasureUI(); });
$('reset-scale').addEventListener('click', () => { M.scale = 1; syncMeasureLabels(); updateMeasureUI(); });
$('calibrate').addEventListener('click', () => {
  const known = parseFloat($('c-known').value), r = compute();
  if (!r) { setStatus('Place points A and B first, then enter the true length between them.', 0); return; }
  if (!(known > 0)) { setStatus('Enter the true length (in metres) of the line between A and B.', 0); return; }
  M.scale = known / r.raw;
  syncMeasureLabels(); updateMeasureUI();
});
$('photo-wrap').addEventListener('click', (e) => {
  if (!M.on) return;
  const r = $('cv-photo').getBoundingClientRect();
  setPoint((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
});

/* ---------- Export ---------- */

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function exportGeometry(scale) {
  const d = state.data, g = new THREE.BufferGeometry();
  const pos = d.position.slice();
  for (let i = 0; i < pos.length; i += 3) { pos[i] *= scale; pos[i + 1] *= scale; pos[i + 2] *= scale; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.color.slice(), 3));
  g.setIndex(new THREE.BufferAttribute(d.index.slice(), 1));
  g.computeVertexNormals();
  return g;
}

function exportAs(fmt) {
  if (!state.data) return;
  const name = 'photo-to-3d.' + fmt;
  if (fmt === 'glb') {
    const g = state.mesh.geometry.clone(); g.deleteAttribute('color');
    const mats = [new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }), new THREE.MeshStandardMaterial({ color: 0x8c909c, roughness: 1, metalness: 0 })];
    const m = new THREE.Mesh(g, state.data.solid ? mats : [mats[0]]);
    new GLTFExporter().parse(m, (buf) => download(new Blob([buf], { type: 'model/gltf-binary' }), name), (e) => setStatus('Export failed: ' + e.message, 0), { binary: true });
    return;
  }
  const scale = fmt === 'stl' ? 100 : 1;            // STL in millimetres: longer side = 100 mm
  const mesh = new THREE.Mesh(exportGeometry(scale), new THREE.MeshBasicMaterial());
  if (fmt === 'obj') download(new Blob([new OBJExporter().parse(mesh)], { type: 'text/plain' }), name);
  else if (fmt === 'ply') new PLYExporter().parse(mesh, (r) => download(new Blob([r], { type: 'application/octet-stream' }), name), { binary: true });
  else if (fmt === 'stl') download(new Blob([new STLExporter().parse(mesh, { binary: true })], { type: 'model/stl' }), name);
}

/* ---------- Events ---------- */

function syncLabels() {
  $('o-strength').textContent = Math.round($('c-strength').value * 100) + '%';
  $('o-res').textContent = $('c-res').value;
  $('o-smooth').textContent = $('c-smooth').value;
  $('o-cutoff').textContent = $('c-cutoff').value > 0 ? Math.round($('c-cutoff').value * 100) + '%' : 'off';
  $('o-edge').textContent = $('c-edge').value > 0 ? Math.round($('c-edge').value * 100) + '%' : 'off';
  $('o-thick').textContent = Math.round($('c-thick').value * 100) + '%';
  $('thick-wrap').hidden = !$('c-solid').checked;
}

let rebuildTimer = null;
function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 60); }

['c-strength', 'c-res', 'c-smooth', 'c-cutoff', 'c-edge', 'c-thick'].forEach((id) => $(id).addEventListener('input', () => { syncLabels(); scheduleRebuild(); }));
['c-invert', 'c-solid'].forEach((id) => $(id).addEventListener('change', () => { syncLabels(); scheduleRebuild(); }));

$('modes').addEventListener('click', (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  state.mode = c.dataset.mode;
  document.querySelectorAll('#modes .chip').forEach((x) => { const on = x === c; x.classList.toggle('active', on); x.setAttribute('aria-checked', on); });
  applyMode();
});
$('c-wiggle').addEventListener('change', function () { wiggle = this.checked; requestRender(); });
$('reset-view').addEventListener('click', () => { if (!state.data) return; wiggle = false; $('c-wiggle').checked = false; fitCamera(); requestRender(); });
document.querySelectorAll('.exports button').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.fmt)));

$('pick').addEventListener('click', () => $('file').click());
$('drop').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', function () { handleFile(this.files[0]); this.value = ''; });
$('samples').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) processSource(c.dataset.src, false); });

['dragenter', 'dragover'].forEach((t) => viewer.addEventListener(t, (e) => { e.preventDefault(); viewer.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => viewer.addEventListener(t, (e) => { e.preventDefault(); viewer.classList.remove('over'); }));
viewer.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
document.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.indexOf('image') === 0);
  if (f) handleFile(f.getAsFile());
});

document.getElementById('year').textContent = new Date().getFullYear();
syncLabels();
if (!initViewer()) { $('pick').disabled = true; }
const start = new URLSearchParams(location.search).get('sample');
if (start === 'cattle') processSource('/assets/images/L1.jpg', false);
window.__lab3d = state; state.measure = M;       // handy for debugging in the console
