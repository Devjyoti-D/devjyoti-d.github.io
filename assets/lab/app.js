// Quant Lab page: wires the controls to the engine and renders results

(function () {
  var Q = window.QuantLab, C = window.Charts;
  var $ = function (id) { return document.getElementById(id); };
  var T = 240, START = 60, BASE_YEAR = 2005;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var S1 = 'var(--s1)', S2 = 'var(--s2)', S3 = 'var(--s3)';

  var state = { model: 'ridge', paramIdx: 2, seed: 7, expand: false };
  var market = null, marketKey = '', result = null, runId = 0, timer = null;

  function monthLabel(t) { return MONTHS[t % 12] + ' ' + (BASE_YEAR + Math.floor(t / 12)); }
  function pct(v, d) { return (v * 100).toFixed(d == null ? 1 : d) + '%'; }
  function sgn(v, d) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /* ---------- Controls ---------- */

  function readCfg() {
    return {
      mk: { n: +$('c-n').value, rho: +$('c-rho').value, nonlin: +$('c-nl').value, junk: +$('c-junk').value, regime: $('c-regime').checked, seed: state.seed, T: T },
      bt: {
        model: state.model, paramIdx: state.paramIdx, window: state.expand ? 0 : +$('c-window').value,
        refit: +$('c-refit').value, quantile: +$('c-quant').value, costBps: +$('c-cost').value, seed: 1, startMonth: START
      }
    };
  }

  function syncLabels() {
    $('o-n').textContent = $('c-n').value;
    $('o-rho').textContent = (+$('c-rho').value).toFixed(2);
    $('o-nl').textContent = Math.round($('c-nl').value * 100) + '%';
    $('o-junk').textContent = $('c-junk').value;
    $('o-window').textContent = state.expand ? 'all' : $('c-window').value + ' mo';
    $('c-window').disabled = state.expand;
    $('o-cost').textContent = $('c-cost').value + ' bps';
    $('seed-label').textContent = 'Market #' + state.seed;
    var spec = Q.MODELS[state.model];
    $('model-blurb').textContent = spec.blurb;
    $('param-label').textContent = spec.param.label;
    $('o-param').textContent = spec.param.values[state.paramIdx];
    $('c-param').value = state.paramIdx;
    document.querySelectorAll('#models .chip').forEach(function (c) {
      var on = c.dataset.model === state.model;
      c.classList.toggle('active', on); c.setAttribute('aria-checked', on);
    });
  }

  function schedule(delay) {
    clearTimeout(timer);
    runId++;                       // cancels any run in flight
    $('results').classList.add('busy');
    timer = setTimeout(run, delay == null ? 350 : delay);
  }

  function setModel(key) {
    state.model = key; state.paramIdx = Q.MODELS[key].param.def;
  }

  /* ---------- Running ---------- */

  function ensureMarket(mk) {
    var key = JSON.stringify(mk);
    if (key !== marketKey) { market = Q.generateMarket(mk); marketKey = key; }
    return market;
  }

  function setStatus(text, frac) {
    $('status-text').textContent = text;
    $('bar').style.width = (frac == null ? 0 : Math.round(frac * 100)) + '%';
    $('status').classList.toggle('done', frac === 1);
  }

  async function backtest(cfg, id, onProgress) {
    var data = ensureMarket(cfg.mk);
    return Q.runBacktest(data, cfg.bt, {
      cancelled: function () { return id !== runId; },
      progress: onProgress
    });
  }

  async function run() {
    var id = ++runId, cfg = readCfg(), t0 = performance.now();
    syncLabels();
    $('results').classList.add('busy');
    setStatus('Generating market and training ' + Q.MODELS[state.model].name + '…', 0.02);
    await new Promise(function (r) { setTimeout(r, 20); });
    var res;
    try {
      res = await backtest(cfg, id, function (f) { if (id === runId) setStatus('Training ' + Q.MODELS[cfg.bt.model].name + ' walk-forward…', 0.05 + f * 0.85); });
    } catch (e) { setStatus('Something went wrong: ' + e.message, 0); throw e; }
    if (!res || id !== runId) return;
    result = res; result.market = market;
    render(res);
    $('results').classList.remove('busy');
    setStatus('Computing feature importance…', 0.93);
    var imp = await Q.permutationImportance(market, res, { cancelled: function () { return id !== runId; } });
    if (!imp || id !== runId) return;
    res.imp = imp;
    renderImportance(imp);
    setStatus('Done in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s · ' + res.months.length + ' out-of-sample months, ' + (res.trainIC.length) + ' model refits', 1);
  }

  /* ---------- Rendering ---------- */

  function tile(label, value, sub, tone) {
    var d = el('div', 'kpi');
    d.appendChild(el('span', 'kpi-label', label));
    d.appendChild(el('b', 'kpi-value', value));
    var s = el('span', 'kpi-sub' + (tone ? ' ' + tone : ''), sub);
    d.appendChild(s);
    return d;
  }

  function renderKpis(r) {
    var k = $('kpis'); k.textContent = '';
    var m = r.mLS, mk = r.market;
    k.appendChild(tile('Sharpe ratio (net)', m.sharpe.toFixed(2), 'before costs ' + r.mLSGross.sharpe.toFixed(2) + ' · market ' + r.mBench.sharpe.toFixed(2)));
    k.appendChild(tile('Annual return (net)', pct(m.ann), 'volatility ' + pct(m.vol) + ' a year'));
    k.appendChild(tile('Worst drawdown', pct(m.maxdd), 'market ' + pct(r.mBench.maxdd)));
    k.appendChild(tile('Average rank IC', r.icMean.toFixed(3), 't-stat ' + r.icT.toFixed(1) + ' · ceiling ' + mk.rho.toFixed(2)));
    var gap = r.trainICMean - r.icMean, bad = gap > 0.03 && r.icMean < 0.6 * r.trainICMean;
    k.appendChild(tile('IC seen vs unseen', r.trainICMean.toFixed(3) + ' → ' + r.icMean.toFixed(3), bad ? '⚠ Looks overfit' : '✓ Generalises', bad ? 'warn' : 'ok'));
    var drag = r.mLSGross.ann - r.mLS.ann;
    k.appendChild(tile('Turnover', pct(r.turnoverMean, 0) + ' a month', 'costs drag returns by ' + pct(drag) + ' a year'));
  }

  function xTicks(count, labelFor, step) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var t = labelFor(i);
      if (t % 12 === 0 && (BASE_YEAR + t / 12) % step === 0) out.push({ i: i, label: String(BASE_YEAR + t / 12) });
    }
    return out;
  }

  function legend(id, items) {
    var box = $(id); box.textContent = '';
    items.forEach(function (it) {
      var s = el('span', 'lg');
      var i = el('i'); i.style.background = it.color; if (it.bar) i.className = 'bar-key';
      s.appendChild(i); s.appendChild(document.createTextNode(it.name));
      box.appendChild(s);
    });
  }

  function rolling(a, w) {
    return a.map(function (_, i) { return i + 1 < w ? NaN : Q.mean(a.slice(i + 1 - w, i + 1)); });
  }

  function render(r) {
    renderKpis(r);
    var months = r.months, N = months.length;

    // Growth of $1
    var labels = ['Start'].concat(months.map(monthLabel));
    var tickFor = function (i) { return i === 0 ? months[0] - 1 : months[i - 1]; };
    var breakIdx = r.market.breakT >= 0 ? months.indexOf(r.market.breakT) + 1 : -1;
    legend('legend-growth', [
      { name: 'Long–short (net of costs)', color: S1 }, { name: 'Long best stocks only', color: S2 }, { name: 'Equal-weight market', color: S3 }
    ]);
    C.line($('ch-growth'), {
      x: labels, height: 300, baseline: 1, log: true, xTicks: xTicks(N + 1, tickFor, 2),
      series: [
        { name: 'Long–short (net)', color: S1, values: r.eqLS },
        { name: 'Long only', color: S2, values: r.eqLong },
        { name: 'Market', color: S3, values: r.eqBench }
      ],
      marks: breakIdx > 0 ? [{ i: breakIdx, label: 'Momentum crash' }] : [],
      yFmt: function (v) { return '$' + (v < 1 ? v.toFixed(1) : v); }, tipFmt: function (v) { return '$' + v.toFixed(2); },
      aria: 'Growth of one dollar for the long-short strategy, long-only portfolio and market'
    });
    renderGrowthTable(r, labels);

    // Drawdown
    C.line($('ch-dd'), {
      x: labels, height: 220, baseline: 0, xTicks: xTicks(N + 1, tickFor, 4), left: 44,
      series: [{ name: 'Drawdown', color: S1, values: r.ddLS, area: true }],
      yFmt: function (v) { return Math.round(v * 100) + '%'; }, tipFmt: function (v) { return pct(v); },
      aria: 'Drawdown of the long-short strategy'
    });

    // Quintiles (left = least liked by the model, right = most liked)
    var q = r.quint.slice().reverse().map(function (v) { return v * 12; });
    C.columns($('ch-quint'), {
      labels: ['Q1 (least liked)', 'Q2', 'Q3', 'Q4', 'Q5 (most liked)'], values: q, height: 220, color: S1, name: 'Annualised return',
      xTicks: [{ i: 0, label: 'Q1 low' }, { i: 1, label: 'Q2' }, { i: 2, label: 'Q3' }, { i: 3, label: 'Q4' }, { i: 4, label: 'Q5 high' }],
      yFmt: function (v) { return Math.round(v * 100) + '%'; }, tipFmt: function (v) { return pct(v); }, valueLabels: function (v) { return Math.round(v * 100) + '%'; },
      aria: 'Average annualised return by predicted quintile'
    });

    // IC
    legend('legend-ic', [
      { name: 'Monthly IC', color: S1, bar: true }, { name: '12-month average', color: S2 }, { name: 'Ceiling (true IC)', color: 'var(--muted)' }
    ]);
    C.columns($('ch-ic'), {
      labels: months.map(monthLabel), values: r.ic, height: 230, color: S1, name: 'Rank IC',
      overlay: { name: '12-month average', color: S2, values: rolling(r.ic, 12) },
      ref: { value: r.market.rho },
      xTicks: xTicks(N, function (i) { return months[i]; }, 2).map(function (t) { return t; }),
      yFmt: function (v) { return v.toFixed(2); }, tipFmt: function (v) { return v.toFixed(3); },
      aria: 'Monthly rank information coefficient'
    });

    if (r.imp) renderImportance(r.imp);
    else { $('ch-imp').textContent = ''; $('ch-imp').appendChild(el('p', 'muted', 'Computing…')); }
    renderWhatIf(r);
  }

  function renderGrowthTable(r, labels) {
    var wrap = $('tbl-growth'); wrap.textContent = '';
    var t = el('table', 'data'), head = el('tr');
    ['Month', 'Long–short (net)', 'Long only', 'Market', 'Rank IC'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    t.appendChild(el('thead')).appendChild(head);
    var body = el('tbody');
    for (var i = 0; i < r.months.length; i++) {
      var tr = el('tr');
      [labels[i + 1], r.eqLS[i + 1].toFixed(3), r.eqLong[i + 1].toFixed(3), r.eqBench[i + 1].toFixed(3), r.ic[i].toFixed(3)].forEach(function (v, k) {
        var td = el(k === 0 ? 'th' : 'td', null, v); if (k === 0) td.scope = 'row'; tr.appendChild(td);
      });
      body.appendChild(tr);
    }
    t.appendChild(body); wrap.appendChild(t);
  }

  function renderImportance(imp) {
    var m = market, rows = [], total = 0, i;
    for (i = 0; i < imp.length; i++) total += Math.max(0, imp[i]);
    for (i = 0; i < imp.length; i++) {
      var real = i < m.nFeat, share = total > 0 ? Math.max(0, imp[i]) / total : 0;
      rows.push({
        label: m.names[i], value: share, text: pct(share, 0), color: real ? S1 : 'var(--muted-bar)',
        tip: 'IC falls by ' + imp[i].toFixed(3), tipName: real ? 'real driver in this simulation' : 'pure noise in this simulation'
      });
    }
    rows.sort(function (a, b) { return b.value - a.value; });
    var shown = rows.slice(0, 12), hidden = rows.length - shown.length;
    var box = $('ch-imp'); box.textContent = '';
    C.hbars(box, { rows: shown, color: S1, aria: 'Permutation importance by feature' });
    var noise = rows.filter(function (r) { return r.tipName.indexOf('noise') >= 0; }).reduce(function (s, r) { return s + r.value; }, 0);
    var note = el('p', 'sub', 'Blue bars are features that really drive returns here; grey bars are noise. ' + (m.P > m.nFeat ? 'Noise features take ' + pct(noise, 0) + ' of the model\'s attention.' : '') + (hidden > 0 ? ' Showing the top 12 of ' + rows.length + '.' : ''));
    box.appendChild(note);
  }

  /* ---------- What-if ---------- */

  var whatIfValues = null;
  function renderWhatIf(r) {
    var box = $('whatif'), m = r.market;
    if (!whatIfValues) whatIfValues = new Array(m.nFeat).fill(0);
    box.textContent = '';
    var out = el('div', 'wi-out');
    var sliders = el('div', 'wi-sliders');
    for (var f = 0; f < m.nFeat; f++) (function (f) {
      var lab = el('label', 'ctl'), top = el('span'), o = el('output');
      top.appendChild(document.createTextNode(m.names[f] + ' ')); top.appendChild(o);
      var inp = el('input'); inp.type = 'range'; inp.min = -3; inp.max = 3; inp.step = 0.25; inp.value = whatIfValues[f];
      function upd() { whatIfValues[f] = +inp.value; o.textContent = sgn(whatIfValues[f], 2).replace('+0.00', '0.00').replace('−0.00', '0.00'); score(); }
      inp.addEventListener('input', upd);
      o.textContent = sgn(whatIfValues[f], 2).replace('+0.00', '0.00').replace('−0.00', '0.00');
      lab.appendChild(top); lab.appendChild(inp); sliders.appendChild(lab);
    })(f);
    box.appendChild(sliders); box.appendChild(out);
    var reset = el('button', 'btn btn-sm', 'Reset to average stock'); reset.type = 'button';
    reset.addEventListener('click', function () { whatIfValues = null; renderWhatIf(result); });
    box.appendChild(reset);

    function score() {
      var x = new Float64Array(m.P);
      for (var i = 0; i < m.nFeat; i++) x[i] = whatIfValues[i];
      var out1 = new Float64Array(1); r.finalModel.predict(x, 1, out1);
      var last = r.last.pred, below = 0;
      for (var j = 0; j < last.length; j++) if (last[j] < out1[0]) below++;
      var rank = below / last.length, rt = m.R[r.last.t], sd = Q.std(rt);
      var q = r.cfg.quantile, bucket = rank >= 1 - q ? 'long' : rank <= q ? 'short' : 'neutral';
      out.textContent = '';
      out.appendChild(el('div', 'wi-score', sgn(out1[0] * sd * 1e4, 0) + ' bps'));
      out.appendChild(el('div', 'wi-cap', 'predicted return vs the average stock next month (model score ' + out1[0].toFixed(2) + ')'));
      var meter = el('div', 'meter'), fill = el('i'); fill.style.left = (rank * 100) + '%'; meter.appendChild(fill);
      var zl = el('b'); zl.style.width = (q * 100) + '%'; meter.appendChild(zl);
      var zr = el('b', 'right'); zr.style.width = (q * 100) + '%'; meter.appendChild(zr);
      out.appendChild(meter);
      var verdict = bucket === 'long' ? '▲ Ranks in the top ' + pct(1 - rank, 0) + ': the strategy would buy it'
        : bucket === 'short' ? '▼ Ranks in the bottom ' + pct(rank, 0) + ': the strategy would short it'
        : 'Ranks in the middle: the strategy would ignore it';
      out.appendChild(el('div', 'wi-cap', verdict));
    }
    score();
  }

  /* ---------- Model race ---------- */

  async function race() {
    clearTimeout(timer);
    var btn = $('race'), tbl = $('race-table'), cfg = readCfg(), id = ++runId;
    btn.disabled = true; $('results').classList.add('busy');
    tbl.textContent = '';
    var head = el('tr');
    ['Model', 'Sharpe', 'Return', 'IC seen → unseen', 'Time'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    tbl.appendChild(el('thead')).appendChild(head);
    var body = el('tbody'); tbl.appendChild(body);
    var rows = [], keys = Object.keys(Q.MODELS);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k], bt = Object.assign({}, cfg.bt, { model: key, paramIdx: Q.MODELS[key].param.def });
      var tr = el('tr'); tr.appendChild(el('th', null, Q.MODELS[key].name)); tr.appendChild(el('td', 'muted', 'training…')); body.appendChild(tr);
      setStatus('Racing: ' + Q.MODELS[key].name + ' (' + (k + 1) + ' of ' + keys.length + ')…', 0.1 + 0.85 * k / keys.length);
      var t0 = performance.now();
      var res = await Q.runBacktest(ensureMarket(cfg.mk), bt, { cancelled: function () { return id !== runId; } });
      if (!res || id !== runId) { btn.disabled = false; return; }
      tr.textContent = '';
      tr.appendChild(el('th', null, Q.MODELS[key].name));
      tr.appendChild(el('td', null, res.mLS.sharpe.toFixed(2)));
      tr.appendChild(el('td', null, pct(res.mLS.ann)));
      tr.appendChild(el('td', null, res.trainICMean.toFixed(3) + ' → ' + res.icMean.toFixed(3)));
      tr.appendChild(el('td', 'muted', ((performance.now() - t0) / 1000).toFixed(1) + ' s'));
      rows.push({ tr: tr, sharpe: res.mLS.sharpe });
    }
    var best = rows.reduce(function (a, b) { return b.sharpe > a.sharpe ? b : a; });
    best.tr.classList.add('best');
    best.tr.firstChild.appendChild(el('span', 'tag tag-accent', '✓ best'));
    btn.disabled = false; $('results').classList.remove('busy');
    setStatus('Race finished: ranked by net Sharpe ratio on unseen months.', 1);
  }

  /* ---------- Scenarios ---------- */

  var PRESETS = {
    easy: { desc: 'A strong, mostly linear signal. Every model should find it.', n: 200, rho: 0.12, nl: 0.2, junk: 2, regime: false, model: 'ridge', window: 60, refit: 12, quant: 0.2, cost: 10 },
    real: { desc: 'A weak signal buried in noise features, with realistic costs. This is closer to what quant researchers face.', n: 200, rho: 0.04, nl: 0.3, junk: 8, regime: false, model: 'lasso', window: 60, refit: 12, quant: 0.2, cost: 10 },
    trap: { desc: 'No real signal at all, 15 junk features and a flexible model. Watch the "seen" IC soar while the "unseen" IC collapses.', n: 100, rho: 0, nl: 0, junk: 15, regime: false, model: 'gbm', param: 4, window: 36, refit: 12, quant: 0.2, cost: 10 },
    nonlinear: { desc: 'Most of the signal is an interaction between features. Linear models miss it; trees and networks can find it. Press "Race the models".', n: 300, rho: 0.12, nl: 0.7, junk: 3, regime: false, model: 'gbm', window: 84, refit: 12, quant: 0.2, cost: 10 },
    crash: { desc: 'Momentum reverses mid-sample. Compare a long training window against a short one (or the expanding window) to see who adapts.', n: 200, rho: 0.1, nl: 0.1, junk: 4, regime: true, model: 'ridge', window: 120, refit: 6, quant: 0.2, cost: 10 }
  };

  function applyPreset(key) {
    var p = PRESETS[key];
    $('c-n').value = p.n; $('c-rho').value = p.rho; $('c-nl').value = p.nl; $('c-junk').value = p.junk;
    $('c-regime').checked = p.regime; $('c-window').value = p.window; $('c-refit').value = p.refit;
    $('c-quant').value = p.quant; $('c-cost').value = p.cost;
    state.expand = false; $('c-expand').checked = false;
    setModel(p.model); if (p.param != null) state.paramIdx = p.param;
    whatIfValues = null;
    document.querySelectorAll('#presets .chip').forEach(function (c) { c.classList.toggle('active', c.dataset.preset === key); });
    $('preset-desc').textContent = p.desc;
    syncLabels(); schedule(30);
  }

  /* ---------- Events ---------- */

  function clearPreset() {
    document.querySelectorAll('#presets .chip').forEach(function (c) { c.classList.remove('active'); });
    $('preset-desc').textContent = '';
  }

  ['c-n', 'c-rho', 'c-nl', 'c-junk', 'c-window', 'c-cost'].forEach(function (id) {
    $(id).addEventListener('input', function () { clearPreset(); syncLabels(); schedule(); });
  });
  ['c-refit', 'c-quant', 'c-regime'].forEach(function (id) {
    $(id).addEventListener('change', function () { clearPreset(); schedule(100); });
  });
  $('c-expand').addEventListener('change', function () { state.expand = this.checked; clearPreset(); syncLabels(); schedule(100); });
  $('c-param').addEventListener('input', function () { state.paramIdx = +this.value; clearPreset(); syncLabels(); schedule(); });
  $('models').addEventListener('click', function (e) {
    var c = e.target.closest('.chip'); if (!c) return;
    setModel(c.dataset.model); clearPreset(); syncLabels(); schedule(50);
  });
  $('presets').addEventListener('click', function (e) {
    var c = e.target.closest('.chip'); if (c) applyPreset(c.dataset.preset);
  });
  $('reseed').addEventListener('click', function () { state.seed = Math.floor(Math.random() * 9000) + 1000; whatIfValues = null; syncLabels(); schedule(30); });
  $('run').addEventListener('click', function () { schedule(0); });
  $('race').addEventListener('click', race);

  // Redraw charts when the width changes
  var lastW = window.innerWidth, rt = null;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(rt);
    rt = setTimeout(function () { if (result && !$('results').classList.contains('busy')) render(result); }, 150);
  });

  $('year').textContent = new Date().getFullYear();
  syncLabels();
  var start = new URLSearchParams(location.search).get('scenario');
  if (start && PRESETS[start]) applyPreset(start); else applyPreset('real');
})();
