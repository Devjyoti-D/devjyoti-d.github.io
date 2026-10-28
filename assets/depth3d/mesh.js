// Depth map -> triangle mesh. Pure functions (no three.js), so they can be tested in Node.

// Rescale raw model output to 0..1 (near = 1), ignoring the extreme 2% at each end
export function normalizeDepth(data, w, h) {
  var n = w * h, sample = [], step = Math.max(1, Math.floor(n / 20000)), i;
  for (i = 0; i < n; i += step) sample.push(data[i]);
  sample.sort(function (a, b) { return a - b; });
  var lo = sample[Math.floor(sample.length * 0.02)], hi = sample[Math.floor(sample.length * 0.98)];
  var span = hi - lo || 1, out = new Float32Array(n);
  for (i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, (data[i] - lo) / span));
  return out;
}

function bilinear(a, w, h, u, v) {
  var x = u * (w - 1), y = v * (h - 1), x0 = Math.floor(x), y0 = Math.floor(y);
  var x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  return (a[y0 * w + x0] * (1 - fx) + a[y0 * w + x1] * fx) * (1 - fy) + (a[y1 * w + x0] * (1 - fx) + a[y1 * w + x1] * fx) * fy;
}

function blur(g, nx, ny, passes) {
  var tmp = new Float32Array(g.length);
  for (var p = 0; p < passes; p++) {
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var s = 0, c = 0;
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        var x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
        s += g[y * nx + x]; c++;
      }
      tmp[j * nx + i] = s / c;
    }
    g.set(tmp);
  }
}

// Single-hue blue ramp for the depth view: far = deep navy, near = pale blue
var RAMP = [[13, 54, 107], [24, 79, 149], [57, 135, 229], [158, 197, 244], [205, 226, 251]];
function ramp(t) {
  var x = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1), i = Math.floor(x), f = x - i;
  return [0, 1, 2].map(function (k) { return (RAMP[i][k] * (1 - f) + RAMP[i + 1][k] * f) / 255; });
}

/* depth: Float32Array 0..1 (near = 1), size dw x dh.   photo: {data: RGBA bytes, w, h}
   o: res (grid points on the longer side), strength (relief as a fraction of the longer side),
      smooth (blur passes), cutoff (0..1, drop pixels farther than this), edge (0..1, cut stretched
      triangles), invert, solid, thickness (fraction of the longer side)
   World units: the image's longer side is 1 unit wide. */
export function buildMesh(depth, dw, dh, photo, o) {
  var aspect = photo.w / photo.h, long = Math.max(aspect, 1);
  var nx, ny;
  if (aspect >= 1) { nx = o.res; ny = Math.max(2, Math.round(o.res / aspect)); }
  else { ny = o.res; nx = Math.max(2, Math.round(o.res * aspect)); }
  var N = nx * ny, d = new Float32Array(N), i, j;
  for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) d[j * nx + i] = bilinear(depth, dw, dh, i / (nx - 1), j / (ny - 1));
  if (o.smooth > 0) blur(d, nx, ny, o.smooth);
  if (o.invert) for (i = 0; i < N; i++) d[i] = 1 - d[i];

  var maxJump = o.edge > 0 ? 0.5 * Math.pow(1 - o.edge, 2) + 0.02 : Infinity;
  var idx = [];
  function ok(a, b, c) {
    if (d[a] < o.cutoff || d[b] < o.cutoff || d[c] < o.cutoff) return false;
    return Math.max(d[a], d[b], d[c]) - Math.min(d[a], d[b], d[c]) <= maxJump;
  }
  for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
    var tl = j * nx + i, tr = tl + 1, bl = tl + nx, br = bl + 1;
    if (ok(tl, bl, br)) idx.push(tl, bl, br);
    if (ok(tl, br, tr)) idx.push(tl, br, tr);
  }

  // Keep only vertices that are used
  var remap = new Int32Array(N).fill(-1), V = 0;
  for (i = 0; i < idx.length; i++) if (remap[idx[i]] < 0) remap[idx[i]] = V++;
  var pos = new Float32Array(V * 3 * (o.solid ? 2 : 1)), uv = new Float32Array(V * 2 * (o.solid ? 2 : 1));
  var col = new Float32Array(V * 3 * (o.solid ? 2 : 1)), dcol = new Float32Array(V * 3 * (o.solid ? 2 : 1));
  var back = -o.thickness * long;
  for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
    var k = remap[j * nx + i];
    if (k < 0) continue;
    var u = i / (nx - 1), v = j / (ny - 1), z = d[j * nx + i] * o.strength * long;
    pos[k * 3] = (u - 0.5) * aspect; pos[k * 3 + 1] = 0.5 - v; pos[k * 3 + 2] = z;
    uv[k * 2] = u; uv[k * 2 + 1] = 1 - v;
    var px = Math.min(photo.w - 1, Math.round(u * (photo.w - 1))), py = Math.min(photo.h - 1, Math.round(v * (photo.h - 1))), p = (py * photo.w + px) * 4;
    col[k * 3] = photo.data[p] / 255; col[k * 3 + 1] = photo.data[p + 1] / 255; col[k * 3 + 2] = photo.data[p + 2] / 255;
    var rc = ramp(d[j * nx + i]);
    dcol[k * 3] = rc[0]; dcol[k * 3 + 1] = rc[1]; dcol[k * 3 + 2] = rc[2];
  }
  var tris = new Uint32Array(idx.length);
  for (i = 0; i < idx.length; i++) tris[i] = remap[idx[i]];
  var out = { V: V, nx: nx, ny: ny, aspect: aspect, long: long, frontCount: tris.length, zmax: o.strength * long };

  if (!o.solid) {
    out.position = pos; out.uv = uv; out.color = col; out.depthColor = dcol; out.index = tris; out.backCount = 0;
    return out;
  }

  // Solid: a flat back plane (ids V..2V-1) plus walls along the boundary
  for (i = 0; i < V; i++) {
    pos[(V + i) * 3] = pos[i * 3]; pos[(V + i) * 3 + 1] = pos[i * 3 + 1]; pos[(V + i) * 3 + 2] = back;
    uv[(V + i) * 2] = uv[i * 2]; uv[(V + i) * 2 + 1] = uv[i * 2 + 1];
    col[(V + i) * 3] = col[(V + i) * 3 + 1] = col[(V + i) * 3 + 2] = 0.55;
    dcol[(V + i) * 3] = dcol[(V + i) * 3 + 1] = dcol[(V + i) * 3 + 2] = 0.4;
  }
  var edges = new Map(), T = tris.length, a, b, c, key;
  function addEdge(p1, p2) {
    key = p1 < p2 ? p1 * V + p2 : p2 * V + p1;
    var e = edges.get(key);
    if (e) e.n++; else edges.set(key, { a: p1, b: p2, n: 1 });
  }
  for (i = 0; i < T; i += 3) { a = tris[i]; b = tris[i + 1]; c = tris[i + 2]; addEdge(a, b); addEdge(b, c); addEdge(c, a); }
  var extra = [];
  for (i = 0; i < T; i += 3) extra.push(tris[i] + V, tris[i + 2] + V, tris[i + 1] + V);       // back face, reversed
  edges.forEach(function (e) {
    if (e.n !== 1) return;
    extra.push(e.a, e.a + V, e.b + V, e.a, e.b + V, e.b);                                       // wall quad
  });
  var all = new Uint32Array(T + extra.length);
  all.set(tris); all.set(extra, T);
  out.position = pos; out.uv = uv; out.color = col; out.depthColor = dcol; out.index = all; out.backCount = extra.length; out.solid = true;
  return out;
}

/* ---------- Full object: visible front from depth, hidden back estimated ---------- */

// Blur that only averages pixels inside the mask, so the background does not bleed into the object
function maskedBlur(g, m, nx, ny, passes) {
  var tmp = new Float32Array(g.length);
  for (var p = 0; p < passes; p++) {
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var k = j * nx + i;
      if (!m[k]) { tmp[k] = g[k]; continue; }
      var s = 0, c = 0;
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        var x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= nx || y >= ny || !m[y * nx + x]) continue;
        s += g[y * nx + x]; c++;
      }
      tmp[k] = s / c;
    }
    g.set(tmp);
  }
}

// Keep connected pieces of the mask that are at least 5% the size of the biggest one
function keepMainParts(m, nx, ny) {
  var lab = new Int32Array(m.length), sizes = [0], stack = [], n = 0, k, i;
  for (k = 0; k < m.length; k++) {
    if (!m[k] || lab[k]) continue;
    n++; var size = 0; lab[k] = n; stack.push(k);
    while (stack.length) {
      var q = stack.pop(), x = q % nx, y = (q - x) / nx; size++;
      var nb = [x > 0 ? q - 1 : -1, x < nx - 1 ? q + 1 : -1, y > 0 ? q - nx : -1, y < ny - 1 ? q + nx : -1];
      for (i = 0; i < 4; i++) if (nb[i] >= 0 && m[nb[i]] && !lab[nb[i]]) { lab[nb[i]] = n; stack.push(nb[i]); }
    }
    sizes.push(size);
  }
  var big = Math.max.apply(null, sizes);
  for (k = 0; k < m.length; k++) if (m[k] && sizes[lab[k]] < 0.05 * big) m[k] = 0;
}

// Close one-cell gaps (dilate, then erode) and fill holes that do not reach the border
function closeAndFill(m, nx, ny) {
  function morph(src, grow) {
    var out = new Uint8Array(src.length);
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var v = grow ? 0 : 1;
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        var x = Math.min(nx - 1, Math.max(0, i + di)), y = Math.min(ny - 1, Math.max(0, j + dj));
        if (grow) v |= src[y * nx + x]; else v &= src[y * nx + x];
      }
      out[j * nx + i] = v;
    }
    return out;
  }
  m.set(morph(morph(m, true), false));
  var seen = new Uint8Array(m.length), stack = [], k;
  for (k = 0; k < m.length; k++) {
    var x = k % nx, y = (k - x) / nx;
    if ((x === 0 || y === 0 || x === nx - 1 || y === ny - 1) && !m[k]) { seen[k] = 1; stack.push(k); }
  }
  while (stack.length) {
    var q = stack.pop(), qx = q % nx, qy = (q - qx) / nx;
    [qx > 0 ? q - 1 : -1, qx < nx - 1 ? q + 1 : -1, qy > 0 ? q - nx : -1, qy < ny - 1 ? q + nx : -1].forEach(function (nb) {
      if (nb >= 0 && !m[nb] && !seen[nb]) { seen[nb] = 1; stack.push(nb); }
    });
  }
  for (k = 0; k < m.length; k++) if (!m[k] && !seen[k]) m[k] = 1;
}

// "Inflate" the silhouette: solve laplacian(phi) = -1 inside, phi = 0 outside (SOR).
// sqrt(2 phi) is the half-thickness of a round cross-section: a strip W cells wide gets W/2.
function inflate(m, nx, ny) {
  var phi = new Float32Array(m.length), w = 1.9, iters = Math.max(200, 3 * Math.max(nx, ny)), it, i, j, k;
  for (it = 0; it < iters; it++) {
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      k = j * nx + i;
      if (!m[k]) continue;
      var s = (i > 0 ? phi[k - 1] : 0) + (i < nx - 1 ? phi[k + 1] : 0) + (j > 0 ? phi[k - nx] : 0) + (j < ny - 1 ? phi[k + nx] : 0);
      phi[k] += w * ((s + 1) / 4 - phi[k]);
    }
  }
  for (k = 0; k < m.length; k++) phi[k] = m[k] ? Math.sqrt(2 * Math.max(0, phi[k])) : 0;
  return phi;
}

/* mask: Uint8Array (non-zero = object), size mw x mh.  o: res, strength (front relief as a fraction of
   the object's size), smooth, round (back depth: 1 = round cross-sections, as deep as the object is wide).
   The front follows the predicted depth; the hidden back mirrors it, pushed back by the inflated thickness.
   Returns the same shape as buildMesh, plus center and size of the object (world units). */
export function buildObject(depth, dw, dh, mask, mw, mh, photo, o) {
  var aspect = photo.w / photo.h, long = Math.max(aspect, 1), nx, ny, i, j, k;
  if (aspect >= 1) { nx = o.res; ny = Math.max(2, Math.round(o.res / aspect)); }
  else { ny = o.res; nx = Math.max(2, Math.round(o.res * aspect)); }
  var N = nx * ny, m = new Uint8Array(N), d = new Float32Array(N);
  for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
    k = j * nx + i;
    m[k] = mask[Math.round(j / (ny - 1) * (mh - 1)) * mw + Math.round(i / (nx - 1) * (mw - 1))] ? 1 : 0;
    d[k] = bilinear(depth, dw, dh, i / (nx - 1), j / (ny - 1));
  }
  closeAndFill(m, nx, ny);
  keepMainParts(m, nx, ny);

  // Depth range and bounding box of the object
  var vals = [], i0 = nx, i1 = 0, j0 = ny, j1 = 0;
  for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) if (m[j * nx + i]) {
    vals.push(d[j * nx + i]);
    if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
  }
  if (vals.length < 12) return { V: 0 };
  vals.sort(function (a, b) { return a - b; });
  var lo = vals[Math.floor(vals.length * 0.05)], hi = vals[Math.floor(vals.length * 0.98)], span = hi - lo || 1;
  var cell = aspect / (nx - 1);                                          // world units per grid step
  var objSize = Math.max(i1 - i0, j1 - j0) * cell;

  // Front relief from depth (re-scaled within the object), plus a heavily smoothed copy for the back
  // (a few extra passes soften cliffs where one part overlaps another, e.g. a head in front of a body)
  maskedBlur(d, m, nx, ny, o.smooth + 3);
  var zf = new Float32Array(N);
  // (0.7: the inflated thickness already adds roundness, so the depth relief needs less than in "Whole photo")
  for (k = 0; k < N; k++) zf[k] = Math.min(1, Math.max(0, (d[k] - lo) / span)) * o.strength * 0.7 * objSize;
  var zs = zf.slice();
  maskedBlur(zs, m, nx, ny, 10);
  var hc = inflate(m, nx, ny), h = new Float32Array(N);                  // hc in grid cells
  for (k = 0; k < N; k++) h[k] = hc[k] * cell * o.round;

  // Triangles over the mask (cells with 3 of 4 corners inside get one triangle, for a smoother outline)
  var idx = [];
  for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
    var tl = j * nx + i, tr = tl + 1, bl = tl + nx, br = bl + 1, a = m[tl], b = m[tr], c = m[bl], e = m[br];
    if (a + b + c + e < 3) continue;
    if (a && c && e) idx.push(tl, bl, br);
    if (a && e && b) idx.push(tl, br, tr);
    if (!a) idx.push(bl, br, tr);
    if (!e) idx.push(tl, bl, tr);
  }
  var remap = new Int32Array(N).fill(-1), V = 0;
  for (i = 0; i < idx.length; i++) if (remap[idx[i]] < 0) remap[idx[i]] = V++;
  if (!V) return { V: 0 };

  // Vertices 0..V-1 are the front, V..2V-1 the back
  var pos = new Float32Array(V * 6), uv = new Float32Array(V * 4), col = new Float32Array(V * 6), dcol = new Float32Array(V * 6);
  var zmin = Infinity, zmax = -Infinity;
  for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
    var src = j * nx + i, f = remap[src];
    if (f < 0) continue;
    var u = i / (nx - 1), v = j / (ny - 1), x = (u - 0.5) * aspect, y = 0.5 - v;
    var zF = zf[src] + h[src], zB = Math.min(zs[src], zf[src]) - h[src];
    // Near the outline, take the colour from a little further inside so background pixels are not smeared
    var tu = u, tv = v;
    if (hc[src] < 2.5) {
      var gx = hc[j * nx + Math.min(nx - 1, i + 1)] - hc[j * nx + Math.max(0, i - 1)];
      var gy = hc[Math.min(ny - 1, j + 1) * nx + i] - hc[Math.max(0, j - 1) * nx + i], gl = Math.hypot(gx, gy);
      if (gl > 0) { var st = (2.5 - hc[src]) * 0.8 / gl; tu = Math.min(1, Math.max(0, u + gx * st / (nx - 1))); tv = Math.min(1, Math.max(0, v + gy * st / (ny - 1))); }
    }
    var px = Math.min(photo.w - 1, Math.round(tu * (photo.w - 1))), py = Math.min(photo.h - 1, Math.round(tv * (photo.h - 1))), p = (py * photo.w + px) * 4;
    [[f, zF], [f + V, zB]].forEach(function (q) {
      var n = q[0];
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = q[1];
      uv[n * 2] = tu; uv[n * 2 + 1] = 1 - tv;
      col[n * 3] = photo.data[p] / 255; col[n * 3 + 1] = photo.data[p + 1] / 255; col[n * 3 + 2] = photo.data[p + 2] / 255;
    });
    zmin = Math.min(zmin, zB); zmax = Math.max(zmax, zF);
  }
  for (var n = 0; n < 2 * V; n++) {
    var rc = ramp((pos[n * 3 + 2] - zmin) / (zmax - zmin || 1));
    dcol[n * 3] = rc[0]; dcol[n * 3 + 1] = rc[1]; dcol[n * 3 + 2] = rc[2];
  }

  // Front faces, back faces (reversed), and a seam joining them along the outline
  var T = idx.length, tris = [], edges = new Map(), key;
  for (i = 0; i < T; i++) tris.push(remap[idx[i]]);
  function addEdge(p1, p2) {
    key = p1 < p2 ? p1 * V + p2 : p2 * V + p1;
    var ed = edges.get(key);
    if (ed) ed.n++; else edges.set(key, { a: p1, b: p2, n: 1 });
  }
  for (i = 0; i < T; i += 3) { addEdge(tris[i], tris[i + 1]); addEdge(tris[i + 1], tris[i + 2]); addEdge(tris[i + 2], tris[i]); }
  for (i = 0; i < T; i += 3) tris.push(tris[i] + V, tris[i + 2] + V, tris[i + 1] + V);
  edges.forEach(function (ed) { if (ed.n === 1) tris.push(ed.a, ed.a + V, ed.b + V, ed.a, ed.b + V, ed.b); });

  var cx = ((i0 + i1) / 2 / (nx - 1) - 0.5) * aspect, cy = 0.5 - (j0 + j1) / 2 / (ny - 1);
  return {
    V: 2 * V, nx: nx, ny: ny, aspect: aspect, long: long, object: true,
    position: pos, uv: uv, color: col, depthColor: dcol, index: Uint32Array.from(tris), frontCount: tris.length, backCount: 0,
    center: [cx, cy, (zmin + zmax) / 2], size: [(i1 - i0) * cell, (j1 - j0) * cell, zmax - zmin], zmax: zmax - zmin
  };
}
