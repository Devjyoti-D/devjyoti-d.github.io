/* Tiny SVG chart helpers for the Quant Lab (line/area, columns, horizontal bars).
   Colours come from CSS variables so light/dark mode switches without a redraw. */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceTicks(lo, hi, count) {
    if (hi === lo) { hi = lo + 1; }
    var span = hi - lo, raw = span / count, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var f = raw / mag, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    var start = Math.floor(lo / step) * step, out = [];
    for (var v = start; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  function prepare(el, height) {
    el.textContent = '';
    var W = Math.max(260, el.clientWidth || 600);
    var svg = svgEl('svg', { width: W, height: height, viewBox: '0 0 ' + W + ' ' + height, role: 'img', 'class': 'chart-svg' }, el);
    return { svg: svg, W: W };
  }

  function makeTip(el) {
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    el.appendChild(tip);
    return {
      show: function (x, y, title, rows) {
        tip.textContent = '';
        if (title) { var t = document.createElement('div'); t.className = 'tip-title'; t.textContent = title; tip.appendChild(t); }
        rows.forEach(function (r) {
          var row = document.createElement('div'); row.className = 'tip-row';
          if (r.color) { var k = document.createElement('i'); k.style.background = r.color; row.appendChild(k); }
          var v = document.createElement('b'); v.textContent = r.value; row.appendChild(v);
          var n = document.createElement('span'); n.textContent = r.name; row.appendChild(n);
          tip.appendChild(row);
        });
        tip.hidden = false;
        var w = tip.offsetWidth, h = tip.offsetHeight, W = el.clientWidth;
        var left = x + 14; if (left + w > W - 4) left = x - w - 14;
        tip.style.left = Math.max(4, left) + 'px';
        tip.style.top = Math.max(4, Math.min(y - h / 2, el.clientHeight - h - 4)) + 'px';
      },
      hide: function () { tip.hidden = true; }
    };
  }

  function axes(svg, m, W, H, yTicks, yFmt) {
    var plotW = W - m.l - m.r;
    yTicks.forEach(function (t) {
      svgEl('line', { x1: m.l, x2: m.l + plotW, y1: t.y, y2: t.y, 'class': t.zero ? 'ax-base' : 'ax-grid' }, svg);
      var tx = svgEl('text', { x: m.l - 8, y: t.y + 4, 'text-anchor': 'end', 'class': 'ax-text' }, svg);
      tx.textContent = yFmt(t.v);
    });
  }

  /* ---------- Line / area chart with crosshair tooltip ---------- */
  function line(el, o) {
    var H = o.height || 280, m = { t: 12, r: 18, b: 26, l: o.left || 48 };
    var p = prepare(el, H), svg = p.svg, W = p.W, N = o.x.length;
    svg.setAttribute('aria-label', o.aria || '');
    var plotW = W - m.l - m.r, plotH = H - m.t - m.b, i, lo = Infinity, hi = -Infinity;
    o.series.forEach(function (s) { s.values.forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; }); });
    if (o.baseline != null) { lo = Math.min(lo, o.baseline); hi = Math.max(hi, o.baseline); }
    if (o.zero) { hi = Math.max(hi, 0); lo = Math.min(lo, 0); }
    var ticks, Y;
    if (o.log) {
      lo = Math.max(lo, 1e-6) * 0.95; hi *= 1.05;
      var steps = [0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 200, 300, 500, 1000];
      ticks = steps.filter(function (v) { return v >= lo && v <= hi; });
      if (ticks.length > 6) ticks = ticks.filter(function (v) { return [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].indexOf(v) >= 0; });
      if (ticks.length < 3) ticks = niceTicks(lo, hi, 4).filter(function (v) { return v >= lo && v <= hi; });
      var l0 = Math.log(lo), l1 = Math.log(hi);
      Y = function (v) { return m.t + (1 - (Math.log(v) - l0) / (l1 - l0)) * plotH; };
    } else {
      var pad = (hi - lo) * 0.06 || 0.1; lo -= pad; hi += pad;
      if (o.min != null) lo = Math.max(lo, o.min);           // optional floor/ceiling (e.g. 0..100 for percentages)
      if (o.max != null) hi = Math.min(hi, o.max);
      ticks = niceTicks(lo, hi, 5);
      lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
      Y = function (v) { return m.t + (1 - (v - lo) / (hi - lo)) * plotH; };
    }
    function X(i) { return m.l + (N > 1 ? i / (N - 1) : 0.5) * plotW; }

    axes(svg, m, W, H, ticks.map(function (v) { return { v: v, y: Y(v), zero: o.baseline != null ? Math.abs(v - o.baseline) < 1e-9 : v === 0 }; }), o.yFmt);
    (o.xTicks || []).forEach(function (t) {
      var tx = svgEl('text', { x: X(t.i), y: H - 7, 'text-anchor': 'middle', 'class': 'ax-text' }, svg);
      tx.textContent = t.label;
    });
    if (o.ref) {                                              // optional labelled horizontal reference (e.g. chance level)
      svgEl('line', { x1: m.l, x2: m.l + plotW, y1: Y(o.ref.value), y2: Y(o.ref.value), 'class': 'ax-ref', 'stroke-dasharray': '4 4' }, svg);
      var rt = svgEl('text', { x: m.l + plotW, y: Y(o.ref.value) - 6, 'text-anchor': 'end', 'class': 'ax-text', style: 'paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round' }, svg);
      rt.textContent = o.ref.label;
      svg.__refLabel = rt;
    }
    (o.marks || []).forEach(function (mk) {
      svgEl('line', { x1: X(mk.i), x2: X(mk.i), y1: m.t, y2: m.t + plotH, 'class': 'ax-mark' }, svg);
      var tx = svgEl('text', { x: X(mk.i) + 6, y: m.t + 12, 'class': 'ax-text' }, svg);
      tx.textContent = mk.label;
    });

    o.series.forEach(function (s) {
      var d = '';
      for (i = 0; i < N; i++) d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(s.values[i]).toFixed(1);
      if (s.area) {
        var base = Y(o.baseline != null ? o.baseline : 0);
        svgEl('path', { d: d + 'L' + X(N - 1).toFixed(1) + ' ' + base + 'L' + X(0).toFixed(1) + ' ' + base + 'Z', style: 'fill:' + s.color + ';opacity:.12' }, svg);
      }
      svgEl('path', { d: d, 'class': 'ln', style: 'stroke:' + s.color }, svg);
      svgEl('circle', { cx: X(N - 1), cy: Y(s.values[N - 1]), r: 4, 'class': 'dot', style: 'fill:' + s.color }, svg);
    });

    if (svg.__refLabel) svg.appendChild(svg.__refLabel);      // keep the reference label on top of the lines
    var cross = svgEl('line', { y1: m.t, y2: m.t + plotH, 'class': 'ax-cross', visibility: 'hidden' }, svg);
    var dots = o.series.map(function (s) { return svgEl('circle', { r: 4.5, 'class': 'dot', style: 'fill:' + s.color, visibility: 'hidden' }, svg); });
    var tip = makeTip(el), cur = N - 1;
    function show(idx) {
      cur = Math.max(0, Math.min(N - 1, idx));
      var x = X(cur);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      var rows = o.series.map(function (s, k) {
        dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', Y(s.values[cur])); dots[k].setAttribute('visibility', 'visible');
        return { color: s.color, value: o.tipFmt(s.values[cur]), name: s.name };
      });
      tip.show(x, m.t + plotH / 3, o.x[cur], rows);
    }
    function hide() {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
      tip.hide();
    }
    var hit = svgEl('rect', { x: m.l, y: m.t, width: plotW, height: plotH, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', function (e) {
      var r = svg.getBoundingClientRect();
      show(Math.round((e.clientX - r.left - m.l) / plotW * (N - 1)));
    });
    hit.addEventListener('pointerleave', hide);
    svg.setAttribute('tabindex', '0');
    svg.addEventListener('focus', function () { show(cur); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { show(cur - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { show(cur + 1); e.preventDefault(); }
    });
  }

  function roundedBar(x, y, w, h, up) {
    var r = Math.min(4, w / 2, Math.abs(h));
    if (h <= 0) return '';
    return up
      ? 'M' + x + ' ' + (y + h) + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) + 'V' + (y + h) + 'Z'
      : 'M' + x + ' ' + y + 'H' + (x + w) + 'V' + (y + h - r) + 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + r) + 'Q' + x + ' ' + (y + h) + ' ' + x + ' ' + (y + h - r) + 'Z';
  }

  /* ---------- Columns (with optional overlay line and reference line) ---------- */
  function columns(el, o) {
    var H = o.height || 240, m = { t: 12, r: 18, b: 26, l: o.left || 48 };
    var p = prepare(el, H), svg = p.svg, W = p.W, N = o.values.length;
    svg.setAttribute('aria-label', o.aria || '');
    var plotW = W - m.l - m.r, plotH = H - m.t - m.b;
    var lo = 0, hi = 0, all = o.values.concat(o.overlay ? o.overlay.values.filter(isFinite) : [], o.ref ? [o.ref.value] : []);
    all.forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; });
    var pad = (hi - lo) * 0.08 || 0.01; if (hi > 0) hi += pad; if (lo < 0) lo -= pad;
    var ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    function Y(v) { return m.t + (1 - (v - lo) / (hi - lo)) * plotH; }
    var slot = plotW / N, bw = Math.min(24, Math.max(1.2, slot - (slot > 8 ? 4 : 0.8)));
    function X(i) { return m.l + slot * i + (slot - bw) / 2; }

    axes(svg, m, W, H, ticks.map(function (v) { return { v: v, y: Y(v), zero: v === 0 }; }), o.yFmt);
    (o.xTicks || []).forEach(function (t) {
      var tx = svgEl('text', { x: m.l + slot * (t.i + 0.5), y: H - 7, 'text-anchor': 'middle', 'class': 'ax-text' }, svg);
      tx.textContent = t.label;
    });
    var y0 = Y(0), bars = [];
    o.values.forEach(function (v, i) {
      var y = Y(v), top = Math.min(y, y0), h = Math.abs(y - y0);
      var color = (o.colors && o.colors[i]) || o.color;
      var b;
      if (bw >= 8) b = svgEl('path', { d: roundedBar(X(i), top, bw, h, v >= 0) || 'M0 0', style: 'fill:' + color }, svg);
      else b = svgEl('rect', { x: X(i), y: top, width: bw, height: Math.max(h, 0.5), style: 'fill:' + color + ';opacity:.7' }, svg);
      bars.push(b);
      if (o.valueLabels) {
        var lbl = svgEl('text', { x: X(i) + bw / 2, y: v >= 0 ? top - 6 : top + h + 14, 'text-anchor': 'middle', 'class': 'ax-val' }, svg);
        lbl.textContent = o.valueLabels(v);
      }
    });
    if (o.ref) {
      svgEl('line', { x1: m.l, x2: m.l + plotW, y1: Y(o.ref.value), y2: Y(o.ref.value), 'class': 'ax-ref' }, svg);
    }
    if (o.overlay) {
      var d = '', started = false;
      o.overlay.values.forEach(function (v, i) {
        if (!isFinite(v)) return;
        d += (started ? 'L' : 'M') + (m.l + slot * (i + 0.5)).toFixed(1) + ' ' + Y(v).toFixed(1); started = true;
      });
      svgEl('path', { d: d, 'class': 'ln', style: 'stroke:' + o.overlay.color }, svg);
    }
    var tip = makeTip(el);
    function show(i) {
      var rows = [{ color: o.color, value: o.tipFmt(o.values[i]), name: o.name }];
      if (o.overlay && isFinite(o.overlay.values[i])) rows.push({ color: o.overlay.color, value: o.tipFmt(o.overlay.values[i]), name: o.overlay.name });
      bars[i].classList.add('hot');
      tip.show(m.l + slot * (i + 0.5), m.t + plotH / 3, o.labels[i], rows);
    }
    function clear() { bars.forEach(function (b) { b.classList.remove('hot'); }); tip.hide(); }
    for (var i = 0; i < N; i++) (function (i) {
      var hit = svgEl('rect', { x: m.l + slot * i, y: m.t, width: slot, height: plotH, fill: 'transparent' }, svg);
      if (N <= 12) { hit.setAttribute('tabindex', 0); hit.setAttribute('aria-label', o.labels[i] + ': ' + o.tipFmt(o.values[i])); }
      hit.addEventListener('pointerenter', function () { clear(); show(i); });
      hit.addEventListener('pointerleave', clear);
      hit.addEventListener('focus', function () { clear(); show(i); });
      hit.addEventListener('blur', clear);
    })(i);
  }

  /* ---------- Horizontal bars ---------- */
  function hbars(el, o) {
    var rowH = 30, H = o.rows.length * rowH + 10, labelW = Math.min(o.labelWidth || 190, el.clientWidth * 0.5);
    var p = prepare(el, H), svg = p.svg, W = p.W;
    svg.setAttribute('aria-label', o.aria || '');
    var barMax = W - labelW - 70, max = 0;
    o.rows.forEach(function (r) { if (r.value > max) max = r.value; });
    max = max || 1;
    var tip = makeTip(el);
    o.rows.forEach(function (r, i) {
      var y = 5 + i * rowH, cy = y + rowH / 2;
      var tx = svgEl('text', { x: labelW - 10, y: cy + 4, 'text-anchor': 'end', 'class': 'ax-text strong' }, svg);
      tx.textContent = r.label;
      var w = Math.max(0, r.value / max * barMax);
      var bar = svgEl('path', { d: w > 0.5 ? 'M' + labelW + ' ' + (cy - 8) + 'H' + (labelW + Math.max(w - 4, 0)) + 'Q' + (labelW + w) + ' ' + (cy - 8) + ' ' + (labelW + w) + ' ' + (cy - 4) + 'V' + (cy + 4) + 'Q' + (labelW + w) + ' ' + (cy + 8) + ' ' + (labelW + Math.max(w - 4, 0)) + ' ' + (cy + 8) + 'H' + labelW + 'Z' : 'M0 0', style: 'fill:' + (r.color || o.color) }, svg);
      var vt = svgEl('text', { x: labelW + w + 8, y: cy + 4, 'class': 'ax-val' }, svg);
      vt.textContent = r.text;
      var hit = svgEl('rect', { x: 0, y: y, width: W, height: rowH, fill: 'transparent', tabindex: 0, 'aria-label': r.label + ': ' + r.tip }, svg);
      hit.addEventListener('pointermove', function () { bar.classList.add('hot'); tip.show(labelW + w, cy, r.label, [{ value: r.tip, name: r.tipName || '' }]); });
      hit.addEventListener('pointerleave', function () { bar.classList.remove('hot'); tip.hide(); });
      hit.addEventListener('focus', function () { bar.classList.add('hot'); tip.show(labelW + w, cy, r.label, [{ value: r.tip, name: r.tipName || '' }]); });
      hit.addEventListener('blur', function () { bar.classList.remove('hot'); tip.hide(); });
    });
  }

  root.Charts = { line: line, columns: columns, hbars: hbars };
})(window);
