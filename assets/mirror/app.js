/* Mirror: game UI. Uses MirrorEngine (simulation) and Charts (the Quant Lab chart helpers). */
(function () {
  'use strict';
  var E = window.MirrorEngine, $ = function (id) { return document.getElementById(id); };
  var NAMES = ['Audit', 'Bounty', 'Drought', 'Windfall'];
  var g, sel = { type: null, region: null }, busy = false, hover = -1, lastMove = null, anim = null;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function pct(v) { return Math.round(v * 100) + '%'; }
  function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  /* ---------- Map ---------- */

  var canvas = $('map'), ctx = canvas.getContext('2d'), W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    draw();
  }

  function rect(r) {
    var gap = 10, w = (W - gap) / 2, h = (H - gap) / 2;
    return { x: (r % 2) * (w + gap), y: Math.floor(r / 2) * (h + gap), w: w, h: h };
  }
  var TOP = 52, PAD = 14;
  function spot(r, ax, ay) {
    var b = rect(r);
    return { x: b.x + PAD + ax * (b.w - 2 * PAD), y: b.y + TOP + ay * (b.h - TOP - PAD) };
  }

  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
  }

  // t: 0..1 progress of the agents' move animation; flash: 0..1 strength of the intervention overlay
  function draw(t, flash) {
    if (!g || !W) return;
    t = t == null ? 1 : t;
    var c = { bg: css('--bg'), surface: css('--surface'), border: css('--border'), text: css('--text'), muted: css('--muted'),
      accent: css('--accent'), soft: css('--accent-soft'), coop: css('--s1'), comp: css('--s2'), font: css('--font'), head: css('--font-head') };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var maxRes = Math.max.apply(null, g.base) * 1.6;
    for (var r = 0; r < 4; r++) {
      var b = rect(r), picked = sel.region === r, landed = lastMove && lastMove.region === r;
      roundRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 12);
      ctx.fillStyle = landed && flash ? c.soft : c.bg; ctx.fill();
      ctx.lineWidth = picked ? 2.5 : 1; ctx.strokeStyle = picked ? c.accent : hover === r ? c.muted : c.border; ctx.stroke();
      var compact = b.w < 260;                       // phones: shorter labels, land bar without its number
      ctx.fillStyle = c.text; ctx.font = '600 ' + (compact ? 13 : 15) + 'px ' + c.head; ctx.textBaseline = 'alphabetic';
      ctx.fillText(g.regions[r], b.x + PAD, b.y + 24);
      ctx.fillStyle = c.muted; ctx.font = (compact ? 11 : 12) + 'px ' + c.font;
      ctx.fillText(compact ? g.nc[r] + ' coop · ' + g.nk[r] + ' compete' : g.nc[r] + ' cooperating · ' + g.nk[r] + ' competing', b.x + PAD, b.y + 41);
      // land (resources) bar, top right
      var bw = compact ? Math.min(36, b.w * 0.22) : Math.min(90, b.w * 0.28), bx = b.x + b.w - PAD - bw, frac = Math.min(1, g.res[r] / maxRes);
      if (!compact) { ctx.textAlign = 'right'; ctx.fillText('Land ' + Math.round(g.res[r]), bx - 8, b.y + 26); ctx.textAlign = 'left'; }
      roundRect(bx, b.y + 18, bw, 8, 4); ctx.fillStyle = c.border; ctx.fill();
      if (frac > 0.02) { roundRect(bx, b.y + 18, Math.max(8, bw * frac), 8, 4); ctx.fillStyle = c.muted; ctx.fill(); }
    }
    // agents (tweened from where they were to where they chose to go)
    var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    g.agents.forEach(function (ag, i) {
      var to = spot(ag.r, ag.x, ag.y), from = anim ? anim.from[i] : to;
      var x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e;
      var s = anim && t < 0.5 ? anim.from[i].s : ag.s;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 7);
      ctx.fillStyle = s === 0 ? c.coop : c.comp; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = c.surface; ctx.stroke();
    });
    // what your last intervention did
    if (lastMove && flash) {
      var lb = rect(lastMove.region), label = NAMES[lastMove.type].toUpperCase() + (lastMove.tag ? ' · ' + lastMove.tag : '');
      ctx.font = '600 13px ' + c.font;
      var tw = ctx.measureText(label).width + 22, px = lb.x + lb.w / 2 - tw / 2, py = lb.y + lb.h - 40;
      ctx.globalAlpha = Math.min(1, flash);
      roundRect(px, py, tw, 26, 13); ctx.fillStyle = c.accent; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, lb.x + lb.w / 2, py + 17.5); ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }

  function regionAt(e) {
    var b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    for (var r = 0; r < 4; r++) { var q = rect(r); if (x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) return r; }
    return -1;
  }
  canvas.addEventListener('pointermove', function (e) { var r = regionAt(e); if (r !== hover) { hover = r; if (!anim) draw(1, 1); } });
  canvas.addEventListener('pointerleave', function () { hover = -1; if (!anim) draw(1, 1); });
  canvas.addEventListener('click', function (e) { var r = regionAt(e); if (r >= 0 && !busy && !g.done) pickRegion(r); });

  /* ---------- Controls ---------- */

  function pickType(t) {
    sel.type = t;
    document.querySelectorAll('#moves .move').forEach(function (b) { b.setAttribute('aria-checked', +b.dataset.type === t); });
    syncCommit();
  }
  function pickRegion(r) {
    sel.region = r;
    document.querySelectorAll('#regions .chip').forEach(function (b) { b.setAttribute('aria-checked', +b.dataset.region === r); });
    syncCommit(); draw(1, 1);
  }
  function syncCommit() {
    var ok = sel.type != null && sel.region != null && !busy && !g.done;
    $('commit').disabled = !ok;
    $('commit').textContent = sel.type != null && sel.region != null ? NAMES[sel.type] + ' ' + g.regions[sel.region] : 'Commit move';
  }
  $('moves').addEventListener('click', function (e) { var b = e.target.closest('.move'); if (b && !busy) pickType(+b.dataset.type); });
  $('regions').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (b && !busy) pickRegion(+b.dataset.region); });
  $('commit').addEventListener('click', commit);
  $('new-game').addEventListener('click', function () { newGame(); });
  $('again').addEventListener('click', function () { newGame(); $('report').scrollIntoView({ behavior: 'smooth', block: 'center' }); });

  function setSeasonUI() {
    var n = Math.min(g.season + 1, g.seasons);
    $('season-label').textContent = g.done ? 'All 12 seasons played' : 'Season ' + n + ' of ' + g.seasons;
    var pips = $('pips'); pips.textContent = '';
    for (var i = 0; i < g.seasons; i++) { var p = document.createElement('i'); if (i < g.season) p.className = 'done'; else if (i === g.season && !g.done) p.className = 'now'; pips.appendChild(p); }
    var H = g.history;
    $('score').textContent = H.length ? pct(H.reduce(function (s, h) { return s + h.coop; }, 0) / H.length) : '–';
    document.querySelectorAll('.controls fieldset').forEach(function (f) { f.disabled = g.done; });
  }

  function setKPIs(rec, prev) {
    var coop = g.nc.reduce(function (a, b) { return a + b; }, 0);
    $('k-coop').textContent = coop + '%';
    if (rec) {
      var d = Math.round((rec.coop - (prev ? prev.coop : rec.view.nc.reduce(function (a, b) { return a + b; }, 0) / 100)) * 100);
      $('k-coop-sub').textContent = (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d) + ' points this season';
      $('k-saw').textContent = rec.sawIt;
      $('k-saw-sub').textContent = 'of 100 predicted it exactly';
      $('k-unpred').textContent = pct(rec.unpred);
      $('k-unpred-sub').textContent = prev ? (rec.unpred > prev.unpred + 0.03 ? 'rising: harder to read' : rec.unpred < prev.unpred - 0.03 ? 'falling: easier to read' : 'steady') : 'how hard they are to read';
      $('k-wealth').textContent = rec.welfare.toFixed(1);
      ['k-coop', 'k-saw', 'k-unpred', 'k-wealth'].forEach(function (id) { var el = $(id); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
    } else {
      $('k-coop-sub').textContent = 'of 100 agents';
      $('k-saw').textContent = '?'; $('k-saw-sub').textContent = 'agents who predicted it exactly';
      $('k-unpred').textContent = '–'; $('k-unpred-sub').textContent = 'how hard they are to read';
      $('k-wealth').textContent = '–';
    }
    var tot = g.nc.map(function (c, r) { return c + g.nk[r]; });
    $('map-summary').textContent = g.regions.map(function (n, r) { return n + ': ' + tot[r] + ' agents (' + g.nc[r] + ' cooperating)'; }).join(' · ');
    canvas.setAttribute('aria-label', 'Map of the colony. ' + $('map-summary').textContent);
  }

  /* ---------- Playing a season ---------- */

  function commit() {
    if (busy || g.done || sel.type == null || sel.region == null) return;
    busy = true; syncCommit();
    var from = g.agents.map(function (ag) { var p = spot(ag.r, ag.x, ag.y); p.s = ag.s; return p; });
    var prev = g.history[g.history.length - 1];
    var rec = E.play(g, sel.type, sel.region);
    lastMove = { type: rec.type, region: rec.region, tag: rec.type === 0 ? rec.caught + ' caught' : rec.type === 1 ? rec.rewarded + ' rewarded' : rec.hitAgents + ' hit' };
    anim = { from: from };
    var t0 = performance.now(), MOVE = 1100, FLASH = 450;
    $('report-title').textContent = 'Season ' + rec.season + ': ' + NAMES[rec.type] + ' in ' + g.regions[rec.region];
    $('report-text').textContent = 'The agents are moving into position, based on what they expect you to do…';
    (function step(now) {
      var k = (now - t0) / MOVE;
      if (k < 1) { draw(k, 0); requestAnimationFrame(step); return; }
      var f = Math.min(1, (now - t0 - MOVE) / FLASH);
      anim = null; draw(1, f);
      if (f < 1) { requestAnimationFrame(step); return; }
      finishSeason(rec, prev);
    })(t0);
  }

  function finishSeason(rec, prev) {
    $('report-text').textContent = reportText(rec, prev);
    setKPIs(rec, prev); setSeasonUI(); addLog(rec);
    busy = false; syncCommit();
    if (g.done) setTimeout(showReveal, 900);
  }

  function reportText(rec, prev) {
    var where = g.regions[rec.region], out = [];
    var inRegion = rec.nc[rec.region] + rec.nk[rec.region];
    if (rec.type === 0) out.push(rec.caught ? 'Your audit caught ' + rec.caught + ' competitor' + (rec.caught > 1 ? 's' : '') + ' in ' + where + '.' : 'Your audit caught nobody: ' + where + '\'s competitors had moved on or switched to cooperating.');
    if (rec.type === 1) out.push(rec.rewarded ? 'Your bounty paid ' + rec.rewarded + ' cooperators in ' + where + '. The land there pays for it next season.' : 'Nobody in ' + where + ' was cooperating, so your bounty paid nothing.');
    if (rec.type === 2) out.push('The drought hit ' + inRegion + ' agents in ' + where + '. Scarcity will linger there.');
    if (rec.type === 3) out.push(inRegion + ' agents in ' + where + ' shared a bigger harvest.');
    if (rec.sawIt >= 50) out.push(rec.sawIt + ' of 100 agents had predicted this exact move.');
    else if (rec.sawIt >= 10) out.push(rec.sawIt + ' agents saw it coming.');
    else out.push('Almost nobody saw it coming.');
    if (prev && rec.unpred > prev.unpred + 0.05) out.push('The colony is acting less predictably than before.');
    if (rec.event) out.push(rec.event);
    return out.join(' ');
  }

  function addLog(rec) {
    $('log-panel').hidden = false;
    var li = document.createElement('li');
    li.innerHTML = '<span class="when"></span><span class="what"><b></b> · <span></span></span><span class="res"></span>';
    li.querySelector('.when').textContent = 'Season ' + rec.season;
    li.querySelector('.what b').textContent = NAMES[rec.type];
    li.querySelector('.what span').textContent = g.regions[rec.region];
    li.querySelector('.res').textContent = pct(rec.coop) + ' cooperating · ' + rec.sawIt + ' saw it coming';
    $('log').appendChild(li);
  }

  /* ---------- The reveal ---------- */

  var rampLight = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
  var rampDark = ['#0d366b', '#104281', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
  function rampColor(v) {
    var R = document.documentElement.getAttribute('data-theme') === 'dark' ? rampDark : rampLight;
    var x = Math.max(0, Math.min(0.9999, v)) * (R.length - 1), i = Math.floor(x), f = x - i;
    var a = R[i], b = R[i + 1], o = '#';
    for (var k = 1; k < 7; k += 2) { var c = Math.round(parseInt(a.substr(k, 2), 16) * (1 - f) + parseInt(b.substr(k, 2), 16) * f); o += (c < 16 ? '0' : '') + c.toString(16); }
    return o;
  }

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function heatmap(el) {
    var Hs = g.history, n = Hs.length, labelW = 76, top = 6, bottom = 24, rowH = 40;
    el.textContent = '';
    var Wd = Math.max(320, el.clientWidth), Ht = top + rowH * 4 + bottom, cw = (Wd - labelW) / n;
    var svg = svgEl('svg', { width: Wd, height: Ht, viewBox: '0 0 ' + Wd + ' ' + Ht, 'class': 'chart-svg', role: 'img',
      'aria-label': 'Heatmap of the colony\'s forecast of your intervention for each season, with your actual choice outlined.' }, el);
    // Colour runs from the lowest to the highest forecast in the game, so differences are visible
    var max = 0, min = 1; Hs.forEach(function (h) { h.typeFc.forEach(function (v) { if (v > max) max = v; if (v < min) min = v; }); });
    min = Math.floor(min * 20) / 20; max = Math.max(min + 0.1, Math.ceil(max * 20) / 20);
    var level = function (v) { return (v - min) / (max - min); };
    var tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; el.appendChild(tip);
    for (var t = 0; t < 4; t++) {
      var lt = svgEl('text', { x: labelW - 10, y: top + rowH * t + rowH / 2 + 4, 'text-anchor': 'end', 'class': 'ax-text strong' }, svg); lt.textContent = NAMES[t];
    }
    Hs.forEach(function (h, i) {
      var xt = svgEl('text', { x: labelW + cw * (i + 0.5), y: Ht - 6, 'text-anchor': 'middle', 'class': 'ax-text' }, svg); xt.textContent = h.season;
      for (var t2 = 0; t2 < 4; t2++) (function (t2) {
        var x = labelW + cw * i, y = top + rowH * t2, v = h.typeFc[t2];
        var cell = svgEl('rect', { x: x + 1, y: y + 1, width: cw - 2, height: rowH - 2, rx: 4, 'class': 'heat-cell', fill: rampColor(level(v)), tabindex: 0,
          'aria-label': 'Season ' + h.season + ', ' + NAMES[t2] + ': ' + pct(v) + (h.type === t2 ? ' (your move)' : '') }, svg);
        if (h.type === t2) svgEl('rect', { x: x + 3, y: y + 3, width: cw - 6, height: rowH - 6, rx: 3, 'class': 'heat-actual' }, svg);
        function show() {
          cell.classList.add('hot');
          tip.textContent = '';
          var tt = document.createElement('div'); tt.className = 'tip-title'; tt.textContent = 'Season ' + h.season + ' · ' + NAMES[t2]; tip.appendChild(tt);
          var row = document.createElement('div'); row.className = 'tip-row';
          row.innerHTML = '<b></b><span>predicted chance</span>'; row.querySelector('b').textContent = pct(v); tip.appendChild(row);
          var row2 = document.createElement('div'); row2.className = 'tip-row'; row2.innerHTML = '<span></span>';
          row2.querySelector('span').textContent = h.type === t2 ? 'You played ' + NAMES[t2] + ' in ' + g.regions[h.region] : 'You played ' + NAMES[h.type];
          tip.appendChild(row2);
          tip.hidden = false;
          var left = x + cw + 8; if (left + tip.offsetWidth > el.clientWidth) left = x - tip.offsetWidth - 8;
          tip.style.left = Math.max(0, left) + 'px'; tip.style.top = Math.max(0, y - 6) + 'px';
        }
        function hide() { cell.classList.remove('hot'); tip.hidden = true; }
        cell.addEventListener('pointerenter', show); cell.addEventListener('pointerleave', hide);
        cell.addEventListener('focus', show); cell.addEventListener('blur', hide);
      })(t2);
    });
    var stops = []; for (var s = 0; s <= 6; s++) stops.push(rampColor(s / 6));
    $('heat-ramp').style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
    $('heat-min').textContent = pct(min); $('heat-max').textContent = pct(max);
  }

  function drawReveal() {
    var Hs = g.history, P = E.profile(g), x = Hs.map(function (h) { return 'Season ' + h.season; });
    var ticks = Hs.map(function (h, i) { return { i: i, label: String(h.season) }; });
    heatmap($('c-heat'));
    Charts.line($('c-read'), {
      x: x, xTicks: ticks, height: 240, zero: true, min: 0, max: 100, left: 44, ref: { value: 6.25, label: 'chance (6.25%)' },
      series: [{ name: 'their probability for your move', values: Hs.map(function (h) { return h.pActual * 100; }), color: css('--s1') }],
      yFmt: function (v) { return Math.round(v) + '%'; }, tipFmt: function (v) { return v.toFixed(1) + '%'; },
      aria: 'Line chart: probability the colony assigned to your actual move, per season, against a chance baseline of 6.25%.'
    });
    Charts.line($('c-colony'), {
      x: x, xTicks: ticks, height: 240, zero: true, min: 0, max: 100, left: 44,
      series: [
        { name: 'cooperating', values: Hs.map(function (h) { return h.coop * 100; }), color: css('--s1') },
        { name: 'unpredictability', values: Hs.map(function (h) { return h.unpred * 100; }), color: css('--s3') }
      ],
      yFmt: function (v) { return Math.round(v) + '%'; }, tipFmt: function (v) { return Math.round(v) + '%'; },
      aria: 'Line chart: share of agents cooperating and colony unpredictability per season.'
    });
    var fav = P.fav, rules = E.RULES;
    $('rules-title').textContent = 'How they think you pick a region for ' + (fav === 0 ? 'an ' : 'a ') + NAMES[fav];
    var ruleRows = rules.map(function (r, i) { return { i: i, w: P.favWeights[i] }; }).sort(function (a, b) { return b.w - a.w; });
    $('rules-sub').textContent = 'The colony\'s learned weight on each rule for your most-used move (' + NAMES[fav] + ', ' + P.counts[fav] + ' of ' + Hs.length + ' seasons).';
    Charts.hbars($('c-rules'), {
      color: css('--s1'), labelWidth: 170, aria: 'Bar chart of the colony\'s learned weights for how you choose a region.',
      rows: ruleRows.map(function (r) { return { label: rules[r.i].short, value: r.w, text: pct(r.w), tip: pct(r.w), tipName: 'weight: ' + rules[r.i].text }; })
    });
  }

  function showReveal() {
    var Hs = g.history, P = E.profile(g), chance = 1 / 16, last = Hs[Hs.length - 1];
    var sc = P.coop;
    $('r-score').textContent = pct(sc);
    $('r-score-sub').textContent = sc >= 0.55 ? 'Masterful: a thriving commons' : sc >= 0.45 ? 'Thriving' : sc >= 0.35 ? 'Holding together' : 'The colony fell apart';
    $('r-read').textContent = (P.late / chance).toFixed(1) + '× chance';
    $('r-read-sub').textContent = 'first 6 seasons: ' + (P.early / chance).toFixed(1) + '× chance';
    $('r-saw').textContent = last.sawIt;
    $('r-unpred').textContent = pct(P.unpredEnd);
    $('r-unpred-sub').textContent = 'started at ' + pct(P.unpredStart);

    var items = [];
    items.push('You chose <b>' + NAMES[P.fav] + '</b> in ' + P.counts[P.fav] + ' of ' + Hs.length + ' seasons' + (P.counts.filter(function (c) { return c === 0; }).length ? ', and never tried ' + P.counts.map(function (c, i) { return c ? null : NAMES[i]; }).filter(Boolean).join(' or ') : '') + '.');
    items.push('You repeated your previous intervention ' + P.repeats + ' of ' + (Hs.length - 1) + ' times.');
    var an = function (i) { return (i === 0 ? 'an ' : 'a ') + NAMES[i]; };
    if (P.bestPair && P.bestPair[2] >= 2) items.push('After ' + an(P.bestPair[0]) + ' you played ' + (P.bestPair[0] === P.bestPair[1] ? 'it again' : an(P.bestPair[1])) + ' ' + P.bestPair[2] + ' of ' + P.bestPair[3] + ' times.');
    var hits = P.ruleHits.map(function (v, i) { return { v: v, i: i }; }).filter(function (o) { return E.RULES[o.i].id !== 'random'; }).sort(function (a, b) { return b.v - a.v; });
    if (hits[0] && hits[0].v >= 3) items.push('You targeted ' + E.RULES[hits[0].i].text + ' in ' + hits[0].v + ' of ' + Hs.length + ' seasons.');
    items.push('By the end they believed your ' + NAMES[P.fav] + ' usually goes to ' + E.RULES[P.topRule].text + ' (' + pct(P.topRuleWeight) + ' weight).');
    items.push('Their forecasts of you went from ' + (P.early / chance).toFixed(1) + '× to ' + (P.late / chance).toFixed(1) + '× better than chance.');
    if (P.unpredEnd > P.unpredStart + 0.04) items.push('They learned to hide: the colony became ' + Math.round((P.unpredEnd - P.unpredStart) * 100) + ' points less predictable while you played.');
    else if (P.unpredEnd < P.unpredStart - 0.04) items.push('The colony grew ' + Math.round((P.unpredStart - P.unpredEnd) * 100) + ' points more predictable: they stopped expecting you to exploit them.');
    $('profile').innerHTML = items.map(function (s) { return '<li>' + s + '</li>'; }).join('');

    var tb = '<thead><tr><th>Season</th><th>Your move</th><th>Their top forecast</th><th>P(your move)</th><th>Saw it</th><th>Cooperating</th><th>Unpredictability</th></tr></thead><tbody>';
    Hs.forEach(function (h) {
      var top = h.colony.indexOf(Math.max.apply(null, h.colony));
      tb += '<tr><th>' + h.season + '</th><td>' + NAMES[h.type] + ' · ' + g.regions[h.region] + '</td><td>' + NAMES[top >> 2] + ' · ' + g.regions[top & 3] + '</td><td>' + (h.pActual * 100).toFixed(1) + '%</td><td>' + h.sawIt + '</td><td>' + pct(h.coop) + '</td><td>' + pct(h.unpred) + '</td></tr>';
    });
    $('t-seasons').innerHTML = tb + '</tbody>';

    var rv = $('reveal');
    rv.hidden = false; rv.classList.remove('show'); void rv.offsetWidth; rv.classList.add('show');
    drawReveal();
    rv.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Setup ---------- */

  function newGame(seed) {
    seed = seed || (Math.floor(Math.random() * 1e9) + 1);
    g = E.create(seed);
    sel = { type: null, region: null }; lastMove = null; anim = null; busy = false;
    $('seed-label').textContent = 'Colony #' + seed;
    var rg = $('regions'); rg.textContent = '';
    g.regions.forEach(function (n, r) {
      var b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.dataset.region = r; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false'); b.textContent = n;
      rg.appendChild(b);
    });
    document.querySelectorAll('#moves .move').forEach(function (b) { b.setAttribute('aria-checked', 'false'); });
    $('log').textContent = ''; $('log-panel').hidden = true; $('reveal').hidden = true;
    $('report-title').textContent = 'A new colony';
    $('report-text').textContent = '100 agents have settled across four regions. Some cooperate and share; others compete and grab twice as much, which wastes the land. Pick an intervention and a region.';
    setKPIs(null); setSeasonUI(); syncCommit(); resize();
  }

  new ResizeObserver(function () { resize(); if (g && g.done && !$('reveal').hidden) drawReveal(); }).observe(canvas);
  new MutationObserver(function () { draw(1, 1); if (g && g.done && !$('reveal').hidden) drawReveal(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  var q = new URLSearchParams(location.search).get('seed');
  newGame(q ? +q : null);
  window.__mirror = function () { return g; };      // handy for debugging in the console
})();
