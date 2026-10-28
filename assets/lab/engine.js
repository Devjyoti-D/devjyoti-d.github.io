/* Quant Lab engine: synthetic equity market, ML models and a walk-forward backtest.
   Plain JavaScript, no dependencies. Runs in the browser and in Node (for tests). */
(function (root) {
  'use strict';

  /* ---------- Utilities ---------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    var u = mulberry32(seed), spare = null;
    return {
      u: u,
      n: function () {
        if (spare !== null) { var s = spare; spare = null; return s; }
        var a, b;
        do { a = u(); } while (a < 1e-12);
        b = u();
        var r = Math.sqrt(-2 * Math.log(a));
        spare = r * Math.sin(2 * Math.PI * b);
        return r * Math.cos(2 * Math.PI * b);
      }
    };
  }

  function tick() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }

  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function std(a) {
    if (a.length < 2) return 0;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }

  // Cross-sectional z-score in place (stride 1 array)
  function zscore(a) {
    var n = a.length, m = 0, s = 0, i;
    for (i = 0; i < n; i++) m += a[i];
    m /= n;
    for (i = 0; i < n; i++) s += (a[i] - m) * (a[i] - m);
    s = Math.sqrt(s / n) || 1;
    for (i = 0; i < n; i++) a[i] = (a[i] - m) / s;
    return a;
  }

  // Average ranks (ties share the mean rank)
  function ranks(a) {
    var n = a.length, idx = new Array(n), i;
    for (i = 0; i < n; i++) idx[i] = i;
    idx.sort(function (p, q) { return a[p] - a[q]; });
    var r = new Float64Array(n);
    i = 0;
    while (i < n) {
      var j = i;
      while (j + 1 < n && a[idx[j + 1]] === a[idx[i]]) j++;
      var avg = (i + j) / 2;
      for (var k = i; k <= j; k++) r[idx[k]] = avg;
      i = j + 1;
    }
    return r;
  }

  function pearson(a, b) {
    var n = a.length, ma = mean(a), mb = mean(b), sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < n; i++) {
      var da = a[i] - ma, db = b[i] - mb;
      sab += da * db; saa += da * da; sbb += db * db;
    }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }

  // Rank IC: Spearman correlation between predictions and realised returns
  function spearman(a, b) { return pearson(ranks(a), ranks(b)); }

  /* ---------- Synthetic market ---------- */

  var FEATURES = [
    { key: 'mom',  name: 'Momentum (12-1m)',        phi: 0.92, w: 1.0 },
    { key: 'val',  name: 'Value (book/price)',      phi: 0.97, w: 0.8 },
    { key: 'qual', name: 'Quality (profitability)', phi: 0.97, w: 0.6 },
    { key: 'lvol', name: 'Low volatility',          phi: 0.95, w: 0.5 },
    { key: 'rev',  name: 'Short-term reversal',     phi: 0.10, w: 0.4 },
    { key: 'size', name: 'Small-cap tilt',          phi: 0.99, w: 0.3 }
  ];
  var IDIO_VOL = 0.08;     // monthly idiosyncratic volatility
  var MKT_MEAN = 0.006, MKT_VOL = 0.045;

  /* Each month every stock has P features (cross-sectionally standardised). Next-month
     return = beta * market + IDIO_VOL * (rho * signal + sqrt(1 - rho^2) * noise), where the
     signal mixes a linear factor model with a nonlinear part (an interaction and a U-shape).
     `rho` is therefore the true information coefficient: the best any model could ever do. */
  function generateMarket(cfg) {
    var rng = makeRng(cfg.seed), n = cfg.n, T = cfg.T, K = FEATURES.length;
    var P = K + cfg.junk, p, i, t;
    var phi = [], names = [], wTrue = [], keys = [];
    for (p = 0; p < K; p++) { phi.push(FEATURES[p].phi); names.push(FEATURES[p].name); wTrue.push(FEATURES[p].w); keys.push(FEATURES[p].key); }
    for (p = K; p < P; p++) { phi.push(0.5); names.push('Noise ' + (p - K + 1)); wTrue.push(0); keys.push('junk' + (p - K + 1)); }

    var lat = new Float64Array(n * P);
    for (i = 0; i < lat.length; i++) lat[i] = rng.n();
    var beta = new Float64Array(n);
    for (i = 0; i < n; i++) beta[i] = 1 + 0.3 * rng.n();

    var breakT = cfg.regime ? Math.round(T * 0.62) : -1;
    var nl = Math.min(Math.max(cfg.nonlin, 0), 0.95), rho = cfg.rho;
    var X = [], R = [], Y = [], col = new Float64Array(n);
    var lin = new Float64Array(n), g = new Float64Array(n), s = new Float64Array(n);

    for (t = 0; t < T; t++) {
      var x = new Float64Array(n * P);
      for (p = 0; p < P; p++) {
        var f = phi[p], inn = Math.sqrt(1 - f * f);
        for (i = 0; i < n; i++) {
          if (t > 0) lat[i * P + p] = f * lat[i * P + p] + inn * rng.n();
          col[i] = lat[i * P + p];
        }
        zscore(col);
        for (i = 0; i < n; i++) x[i * P + p] = Math.max(-3, Math.min(3, col[i]));
      }
      var wt = wTrue.slice();
      if (breakT >= 0 && t >= breakT) { wt[0] = -wt[0]; wt[1] *= 0.3; }   // momentum crash

      for (i = 0; i < n; i++) {
        var l = 0;
        for (p = 0; p < K; p++) l += wt[p] * x[i * P + p];
        lin[i] = l;
        var mo = x[i * P], va = x[i * P + 1], qu = x[i * P + 2];
        g[i] = mo * qu + 0.7 * (va * va - 1);
      }
      zscore(lin); zscore(g);
      var a = Math.sqrt(1 - nl), b = Math.sqrt(nl);
      for (i = 0; i < n; i++) s[i] = a * lin[i] + b * g[i];
      zscore(s);

      var m = MKT_MEAN + MKT_VOL * rng.n();
      var r = new Float64Array(n);
      for (i = 0; i < n; i++) {
        var c = 0;
        for (var d = 0; d < 5; d++) { var z = rng.n(); c += z * z; }
        var eps = rng.n() / Math.sqrt(c / 5) / Math.sqrt(5 / 3);        // fat-tailed noise (t, 5 d.o.f.)
        r[i] = beta[i] * m + IDIO_VOL * (rho * s[i] + Math.sqrt(1 - rho * rho) * eps);
      }
      var y = Float64Array.from(r);
      zscore(y);
      for (i = 0; i < n; i++) y[i] = Math.max(-3, Math.min(3, y[i]));
      X.push(x); R.push(r); Y.push(y);
    }
    return { n: n, T: T, P: P, names: names, keys: keys, wTrue: wTrue, X: X, R: R, Y: Y, rho: rho, breakT: breakT, nFeat: K };
  }

  /* ---------- Models ---------- */

  function solve(A, b, P) {
    var M = new Float64Array(P * (P + 1)), i, j, k;
    for (i = 0; i < P; i++) { for (j = 0; j < P; j++) M[i * (P + 1) + j] = A[i * P + j]; M[i * (P + 1) + P] = b[i]; }
    for (i = 0; i < P; i++) {
      var piv = i;
      for (k = i + 1; k < P; k++) if (Math.abs(M[k * (P + 1) + i]) > Math.abs(M[piv * (P + 1) + i])) piv = k;
      if (piv !== i) for (j = 0; j <= P; j++) { var tmp = M[i * (P + 1) + j]; M[i * (P + 1) + j] = M[piv * (P + 1) + j]; M[piv * (P + 1) + j] = tmp; }
      var d = M[i * (P + 1) + i] || 1e-12;
      for (k = i + 1; k < P; k++) {
        var f = M[k * (P + 1) + i] / d;
        if (f !== 0) for (j = i; j <= P; j++) M[k * (P + 1) + j] -= f * M[i * (P + 1) + j];
      }
    }
    var w = new Float64Array(P);
    for (i = P - 1; i >= 0; i--) {
      var sum = M[i * (P + 1) + P];
      for (j = i + 1; j < P; j++) sum -= M[i * (P + 1) + j] * w[j];
      w[i] = sum / (M[i * (P + 1) + i] || 1e-12);
    }
    return w;
  }

  function linearModel(w, mx, my, P) {
    return {
      weights: w,
      predict: function (x, n, out) {
        for (var i = 0; i < n; i++) {
          var s = my;
          for (var p = 0; p < P; p++) s += w[p] * (x[i * P + p] - mx[p]);
          out[i] = s;
        }
        return out;
      }
    };
  }

  function colMeans(X, n, P) {
    var mx = new Float64Array(P), i, p;
    for (i = 0; i < n; i++) for (p = 0; p < P; p++) mx[p] += X[i * P + p];
    for (p = 0; p < P; p++) mx[p] /= n;
    return mx;
  }

  function fitRidge(X, y, n, P, lambda) {
    var mx = colMeans(X, n, P), my = mean(y), A = new Float64Array(P * P), b = new Float64Array(P), i, a, c;
    for (i = 0; i < n; i++) {
      var yi = y[i] - my;
      for (a = 0; a < P; a++) {
        var xa = X[i * P + a] - mx[a];
        b[a] += xa * yi;
        for (c = 0; c <= a; c++) A[a * P + c] += xa * (X[i * P + c] - mx[c]);
      }
    }
    for (a = 0; a < P; a++) {
      for (c = 0; c <= a; c++) { A[a * P + c] /= n; A[c * P + a] = A[a * P + c]; }
      b[a] /= n; A[a * P + a] += lambda + 1e-9;
    }
    return linearModel(solve(A, b, P), mx, my, P);
  }

  function fitLasso(X, y, n, P, lambda) {
    var mx = colMeans(X, n, P), my = mean(y), Xc = new Float64Array(n * P), r = new Float64Array(n), i, p;
    for (i = 0; i < n; i++) { for (p = 0; p < P; p++) Xc[i * P + p] = X[i * P + p] - mx[p]; r[i] = y[i] - my; }
    var cj = new Float64Array(P), w = new Float64Array(P);
    for (p = 0; p < P; p++) { var q = 0; for (i = 0; i < n; i++) q += Xc[i * P + p] * Xc[i * P + p]; cj[p] = q / n || 1; }
    for (var sweep = 0; sweep < 80; sweep++) {
      var maxd = 0;
      for (p = 0; p < P; p++) {
        var g = 0;
        for (i = 0; i < n; i++) g += Xc[i * P + p] * r[i];
        var rhoj = g / n + cj[p] * w[p];
        var nw = Math.abs(rhoj) <= lambda ? 0 : (rhoj > 0 ? rhoj - lambda : rhoj + lambda) / cj[p];
        var dw = nw - w[p];
        if (dw !== 0) { for (i = 0; i < n; i++) r[i] -= dw * Xc[i * P + p]; w[p] = nw; }
        if (Math.abs(dw) > maxd) maxd = Math.abs(dw);
      }
      if (maxd < 1e-6) break;
    }
    return linearModel(w, mx, my, P);
  }

  /* Gradient-boosted regression trees (histogram splits, squared loss) */
  function fitGBM(X, y, n, P, o) {
    var B = 16, rng = makeRng(o.seed), i, p, b;
    var edges = [], bins = new Uint8Array(n * P), tmp = new Float64Array(n);
    for (p = 0; p < P; p++) {
      for (i = 0; i < n; i++) tmp[i] = X[i * P + p];
      var sorted = Float64Array.from(tmp).sort();
      var e = [];
      for (b = 1; b < B; b++) e.push(sorted[Math.floor(b * n / B)]);
      edges.push(e);
      for (i = 0; i < n; i++) {
        var v = tmp[i], bi = 0;
        while (bi < B - 1 && e[bi] < v) bi++;
        bins[i * P + p] = bi;
      }
    }
    var base = mean(y), pred = new Float64Array(n), resid = new Float64Array(n);
    for (i = 0; i < n; i++) pred[i] = base;
    var minLeaf = Math.max(60, Math.floor(n * o.minLeafFrac)), trees = [], gain = new Float64Array(P);
    var sumB = new Float64Array(B), cntB = new Float64Array(B);

    function build(idx, depth) {
      var m = idx.length, tot = 0, j;
      for (j = 0; j < m; j++) tot += resid[idx[j]];
      var leaf = { v: o.lr * tot / (m + o.l2) };
      if (depth >= o.depth || m < 2 * minLeaf) return leaf;
      var bestG = 1e-12, bestP = -1, bestB = -1;
      for (var f = 0; f < P; f++) {
        sumB.fill(0); cntB.fill(0);
        for (j = 0; j < m; j++) { var ri = idx[j], bb = bins[ri * P + f]; sumB[bb] += resid[ri]; cntB[bb]++; }
        var sl = 0, cl = 0;
        for (var k = 0; k < B - 1; k++) {
          sl += sumB[k]; cl += cntB[k];
          var cr = m - cl;
          if (cl < minLeaf || cr < minLeaf) continue;
          var sr = tot - sl;
          var gn = sl * sl / cl + sr * sr / cr - tot * tot / m;
          if (gn > bestG) { bestG = gn; bestP = f; bestB = k; }
        }
      }
      if (bestP < 0) return leaf;
      gain[bestP] += bestG;
      var L = [], Rr = [];
      for (j = 0; j < m; j++) (bins[idx[j] * P + bestP] <= bestB ? L : Rr).push(idx[j]);
      return { f: bestP, t: edges[bestP][bestB], l: build(L, depth + 1), r: build(Rr, depth + 1) };
    }
    function walk(node, x, off) {
      while (node.l) node = x[off + node.f] <= node.t ? node.l : node.r;
      return node.v;
    }

    for (var it = 0; it < o.trees; it++) {
      for (i = 0; i < n; i++) resid[i] = y[i] - pred[i];
      var idx = [];
      for (i = 0; i < n; i++) if (rng.u() < o.subsample) idx.push(i);
      var tree = build(idx, 0);
      trees.push(tree);
      for (i = 0; i < n; i++) pred[i] += walk(tree, X, i * P);
    }
    return {
      gain: gain,
      predict: function (x, m, out) {
        for (var q = 0; q < m; q++) {
          var s = base;
          for (var t = 0; t < trees.length; t++) s += walk(trees[t], x, q * P);
          out[q] = s;
        }
        return out;
      }
    };
  }

  /* Small neural network: P -> H (tanh) -> 1, trained with Adam and weight decay */
  function fitMLP(X, y, n, P, o) {
    var H = o.hidden, rng = makeRng(o.seed), i, j, p;
    var nW1 = H * P, total = nW1 + H + H + 1;
    var th = new Float64Array(total), gr = new Float64Array(total), m1 = new Float64Array(total), m2 = new Float64Array(total);
    var oB1 = nW1, oW2 = nW1 + H, oB2 = nW1 + 2 * H;
    for (j = 0; j < nW1; j++) th[j] = rng.n() * Math.sqrt(1 / P);
    for (j = 0; j < H; j++) th[oW2 + j] = rng.n() * 0.3 / Math.sqrt(H);

    var rows = [];
    for (i = 0; i < n; i++) rows.push(i);
    for (i = rows.length - 1; i > 0; i--) { var k = Math.floor(rng.u() * (i + 1)), tt = rows[i]; rows[i] = rows[k]; rows[k] = tt; }
    if (rows.length > o.maxRows) rows.length = o.maxRows;
    var my = mean(y), h = new Float64Array(H), step = 0, bs = o.batch;

    for (var ep = 0; ep < o.epochs; ep++) {
      for (i = rows.length - 1; i > 0; i--) { var k2 = Math.floor(rng.u() * (i + 1)), t2 = rows[i]; rows[i] = rows[k2]; rows[k2] = t2; }
      for (var s0 = 0; s0 < rows.length; s0 += bs) {
        var s1 = Math.min(rows.length, s0 + bs), cnt = s1 - s0;
        gr.fill(0);
        for (var q = s0; q < s1; q++) {
          var r = rows[q], off = r * P, out = th[oB2];
          for (j = 0; j < H; j++) {
            var z = th[oB1 + j], wo = j * P;
            for (p = 0; p < P; p++) z += th[wo + p] * X[off + p];
            h[j] = Math.tanh(z);
            out += th[oW2 + j] * h[j];
          }
          var err = out - (y[r] - my);
          gr[oB2] += err;
          for (j = 0; j < H; j++) {
            gr[oW2 + j] += err * h[j];
            var dh = err * th[oW2 + j] * (1 - h[j] * h[j]);
            gr[oB1 + j] += dh;
            var wo2 = j * P;
            for (p = 0; p < P; p++) gr[wo2 + p] += dh * X[off + p];
          }
        }
        step++;
        var c1 = 1 - Math.pow(0.9, step), c2 = 1 - Math.pow(0.999, step);
        for (j = 0; j < total; j++) {
          var gj = gr[j] / cnt + (j < nW1 || (j >= oW2 && j < oB2) ? o.wd * th[j] : 0);
          m1[j] = 0.9 * m1[j] + 0.1 * gj;
          m2[j] = 0.999 * m2[j] + 0.001 * gj * gj;
          th[j] -= o.lr * (m1[j] / c1) / (Math.sqrt(m2[j] / c2) + 1e-8);
        }
      }
    }
    return {
      predict: function (x, m, out) {
        var hh = new Float64Array(H);
        for (var q = 0; q < m; q++) {
          var off = q * P, s = th[oB2];
          for (var jj = 0; jj < H; jj++) {
            var z = th[oB1 + jj], wo = jj * P;
            for (var pp = 0; pp < P; pp++) z += th[wo + pp] * x[off + pp];
            s += th[oW2 + jj] * Math.tanh(z);
          }
          out[q] = s + my;
        }
        return out;
      }
    };
  }

  var MODELS = {
    ridge: {
      name: 'Ridge regression',
      blurb: 'A linear model with an L2 penalty that shrinks every coefficient toward zero.',
      param: { label: 'Penalty (λ)', values: [0, 0.01, 0.1, 1, 10], def: 1 },
      fit: function (X, y, n, P, v, seed) { return fitRidge(X, y, n, P, v); }
    },
    lasso: {
      name: 'Lasso',
      blurb: 'A linear model with an L1 penalty that sets weak features to exactly zero.',
      param: { label: 'Penalty (λ)', values: [0.0005, 0.002, 0.005, 0.01, 0.03], def: 2 },
      fit: function (X, y, n, P, v, seed) { return fitLasso(X, y, n, P, v); }
    },
    gbm: {
      name: 'Gradient boosting',
      blurb: 'Hundreds of small decision trees, each correcting the errors of the last. Captures nonlinear effects.',
      param: { label: 'Number of trees', values: [10, 25, 50, 100, 200], def: 2 },
      fit: function (X, y, n, P, v, seed) {
        return fitGBM(X, y, n, P, { trees: v, depth: 2, lr: 0.08, l2: 20, subsample: 0.5, minLeafFrac: 0.03, seed: seed });
      }
    },
    mlp: {
      name: 'Neural network',
      blurb: 'A small one-hidden-layer network trained by gradient descent. Flexible, but easy to overfit.',
      param: { label: 'Hidden units', values: [2, 4, 8, 16, 32], def: 2 },
      fit: function (X, y, n, P, v, seed) {
        return fitMLP(X, y, n, P, { hidden: v, epochs: 8, lr: 0.004, wd: 0.002, batch: 128, maxRows: 9000, seed: seed });
      }
    }
  };

  /* ---------- Backtest ---------- */

  function metrics(r) {
    var n = r.length, m = mean(r), s = std(r), eq = 1, peak = 1, mdd = 0, hit = 0;
    for (var i = 0; i < n; i++) {
      eq *= 1 + r[i];
      if (eq > peak) peak = eq;
      mdd = Math.min(mdd, eq / peak - 1);
      if (r[i] > 0) hit++;
    }
    return {
      ann: n ? Math.pow(Math.max(eq, 1e-9), 12 / n) - 1 : 0,
      vol: s * Math.sqrt(12),
      sharpe: s > 0 ? m / s * Math.sqrt(12) : 0,
      maxdd: mdd,
      hit: n ? hit / n : 0,
      total: eq - 1
    };
  }

  function cumulative(r) { var out = [1], e = 1; for (var i = 0; i < r.length; i++) { e *= 1 + r[i]; out.push(e); } return out; }
  function drawdown(eq) { var out = [], peak = 0; for (var i = 0; i < eq.length; i++) { peak = Math.max(peak, eq[i]); out.push(eq[i] / peak - 1); } return out; }

  function trainData(data, t, windowMonths) {
    var s0 = windowMonths > 0 ? Math.max(0, t - windowMonths) : 0, months = t - s0, n = data.n, P = data.P;
    var X = new Float64Array(months * n * P), y = new Float64Array(months * n);
    for (var s = s0; s < t; s++) {
      X.set(data.X[s], (s - s0) * n * P);
      y.set(data.Y[s], (s - s0) * n);
    }
    return { X: X, y: y, n: months * n, s0: s0 };
  }

  /* Walk-forward: at each month fit only on past data (known by that date), predict the
     cross-section, trade the top/bottom group, and pay costs on turnover. */
  async function runBacktest(data, cfg, hooks) {
    hooks = hooks || {};
    var n = data.n, P = data.P, T = data.T, t0 = cfg.startMonth || 60;
    var spec = MODELS[cfg.model], pv = spec.param.values[cfg.paramIdx];
    var q = Math.max(1, Math.round(n * cfg.quantile));
    var cost = cfg.costBps / 1e4;
    var res = {
      months: [], ic: [], lsGross: [], lsNet: [], longGross: [], longNet: [], bench: [], turnover: [],
      trainIC: [], quint: [0, 0, 0, 0, 0], modelAt: {}, cfg: cfg
    };
    var model = null, prevW = null, pred = new Float64Array(n), last = null;
    var total = T - t0, done = 0;

    for (var t = t0; t < T; t++) {
      if ((t - t0) % cfg.refit === 0) {
        if (hooks.cancelled && hooks.cancelled()) return null;
        var td = trainData(data, t, cfg.window);
        model = spec.fit(td.X, td.y, td.n, P, pv, cfg.seed + t);
        // In-sample IC over the last few training months (how good it looks on data it has seen)
        var ics = [], tp = new Float64Array(n), from = Math.max(td.s0, t - 12);
        for (var s = from; s < t; s++) { model.predict(data.X[s], n, tp); ics.push(spearman(tp, data.Y[s])); }
        res.trainIC.push(mean(ics));
        if (hooks.progress) hooks.progress(done / total);
        await tick();
      }
      res.modelAt[t] = model;
      model.predict(data.X[t], n, pred);
      var rt = data.R[t];
      var order = new Array(n), i;
      for (i = 0; i < n; i++) order[i] = i;
      order.sort(function (a, b) { return pred[b] - pred[a]; });      // best predicted first

      var w = new Float64Array(n), lg = 0, sg = 0;
      for (i = 0; i < q; i++) { w[order[i]] = 1 / q; lg += rt[order[i]]; w[order[n - 1 - i]] = -1 / q; sg += rt[order[n - 1 - i]]; }
      lg /= q; sg /= q;
      var traded = 0, tradedLong = 0;
      for (i = 0; i < n; i++) {
        var pw = prevW ? prevW[i] : 0;
        traded += Math.abs(w[i] - pw);
        if (w[i] > 0 || pw > 0) tradedLong += Math.abs(Math.max(w[i], 0) - Math.max(pw, 0));
      }
      prevW = w;

      var bench = mean(rt);
      res.months.push(t);
      res.ic.push(spearman(pred, rt));
      res.lsGross.push(lg - sg);
      res.lsNet.push(lg - sg - cost * traded);
      res.longGross.push(lg);
      res.longNet.push(lg - cost * tradedLong);
      res.bench.push(bench);
      res.turnover.push(traded / 4);

      var qs = Math.floor(n / 5);
      for (var b = 0; b < 5; b++) {
        var sum = 0, lo = b * qs, hi = b === 4 ? n : lo + qs;
        for (i = lo; i < hi; i++) sum += rt[order[i]];
        res.quint[b] += sum / (hi - lo);
      }
      last = { t: t, pred: Float64Array.from(pred) };
      done++;
      if (done % 15 === 0) await tick();
    }
    for (var bq = 0; bq < 5; bq++) res.quint[bq] /= res.months.length;

    res.last = last;
    res.finalModel = model;
    res.eqLS = cumulative(res.lsNet);
    res.eqLSGross = cumulative(res.lsGross);
    res.eqLong = cumulative(res.longNet);
    res.eqBench = cumulative(res.bench);
    res.ddLS = drawdown(res.eqLS);
    res.mLS = metrics(res.lsNet);
    res.mLSGross = metrics(res.lsGross);
    res.mLong = metrics(res.longNet);
    res.mBench = metrics(res.bench);
    var icM = mean(res.ic), icS = std(res.ic);
    res.icMean = icM; res.icStd = icS;
    res.icT = icS > 0 ? icM / icS * Math.sqrt(res.ic.length) : 0;
    res.turnoverMean = mean(res.turnover);
    res.trainICMean = mean(res.trainIC);
    return res;
  }

  /* Permutation importance: how much does the out-of-sample IC fall when one feature is shuffled? */
  async function permutationImportance(data, res, hooks) {
    var n = data.n, P = data.P, rng = makeRng(data.T * 7 + 1), imp = new Float64Array(P), cnt = 0;
    var xs = new Float64Array(n * P), pr = new Float64Array(n), base = new Float64Array(n);
    for (var k = 0; k < res.months.length; k += 2) {
      var t = res.months[k], m = res.modelAt[t];
      m.predict(data.X[t], n, base);
      var ic0 = spearman(base, data.R[t]);
      for (var p = 0; p < P; p++) {
        xs.set(data.X[t]);
        for (var i = n - 1; i > 0; i--) {
          var j = Math.floor(rng.u() * (i + 1)), tmp = xs[i * P + p];
          xs[i * P + p] = xs[j * P + p]; xs[j * P + p] = tmp;
        }
        m.predict(xs, n, pr);
        imp[p] += ic0 - spearman(pr, data.R[t]);
      }
      cnt++;
      if (k % 30 === 0) { if (hooks && hooks.cancelled && hooks.cancelled()) return null; await tick(); }
    }
    for (var f = 0; f < P; f++) imp[f] /= cnt;
    return imp;
  }

  root.QuantLab = {
    FEATURES: FEATURES, MODELS: MODELS,
    generateMarket: generateMarket, runBacktest: runBacktest, permutationImportance: permutationImportance,
    metrics: metrics, spearman: spearman, mean: mean, std: std, cumulative: cumulative
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.QuantLab;
})(typeof window !== 'undefined' ? window : globalThis);
