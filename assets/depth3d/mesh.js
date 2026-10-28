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

var RAMP = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
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
