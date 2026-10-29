/* Mirror: a game of mutual modelling. Pure simulation (no DOM), so it also runs in Node for testing.

   100 agents live in 4 regions. Each season every agent picks a region and a stance (cooperate or compete)
   for sharing that region's resources. You pick one intervention (audit, bounty, drought, windfall) and a
   region. You both choose at the same time: the agents act on what they PREDICT you will do.

   Every agent keeps its own model of you, learned only from your past moves:
     - which intervention follows which (a Markov table plus overall frequencies, with forgetting)
     - which rule you use to pick a region (repeat, the crowd, the competitors, the richest, ...), per intervention
   Agents that get caught out while behaving predictably learn to randomise (their softmax temperature rises). */
(function (root) {
  'use strict';

  var REGIONS = ['Highlands', 'Riverside', 'Woodland', 'Saltmarsh'];
  var ACTIONS = ['audit', 'bounty', 'drought', 'windfall'];
  var ACTION_NAMES = { audit: 'Audit', bounty: 'Bounty', drought: 'Drought', windfall: 'Windfall' };
  var RULES = [
    { id: 'repeat', text: 'the same region as last time', short: 'Same as last time' },
    { id: 'crowd', text: 'the most crowded region', short: 'Most crowded' },
    { id: 'rivals', text: 'the region with the most competitors', short: 'Most competitors' },
    { id: 'quiet', text: 'the region with the fewest competitors', short: 'Fewest competitors' },
    { id: 'rich', text: 'the richest region', short: 'Richest' },
    { id: 'poor', text: 'the poorest region', short: 'Poorest' },
    { id: 'avoid', text: 'anywhere except last time\'s region', short: 'Anywhere but last time' },
    { id: 'random', text: 'no particular rule', short: 'No particular rule' }
  ];
  var NA = 4, NR = 4, NH = RULES.length, SEASONS = 12, N_AGENTS = 100;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function argmaxAll(v) { var m = Math.max.apply(null, v), out = []; v.forEach(function (x, i) { if (x >= m - 1e-9) out.push(i); }); return out; }
  function argminAll(v) { return argmaxAll(v.map(function (x) { return -x; })); }
  function spread(idx) { var p = [0, 0, 0, 0]; idx.forEach(function (i) { p[i] = 1 / idx.length; }); return p; }
  function norm(v) { var s = 0, i; for (i = 0; i < v.length; i++) s += v[i]; for (i = 0; i < v.length; i++) v[i] /= s || 1; return v; }
  function entropy(p) { var h = 0; p.forEach(function (x) { if (x > 1e-12) h -= x * Math.log(x); }); return h; }

  // Region distribution implied by each targeting rule, given what both sides could see before the move
  function ruleDists(view) {
    var tot = view.nc.map(function (c, r) { return c + view.nk[r]; });
    var last = view.lastRegion;
    var uniform = [0.25, 0.25, 0.25, 0.25];
    return [
      last == null ? uniform : spread([last]),
      spread(argmaxAll(tot)),
      spread(argmaxAll(view.nk)),
      spread(argminAll(view.nk)),
      spread(argmaxAll(view.res)),
      spread(argminAll(view.res)),
      last == null ? uniform : spread([0, 1, 2, 3].filter(function (r) { return r !== last; })),
      uniform
    ];
  }

  // What an agent gets for (region r, stance s) if the player plays action a (index 0..15 or -1 for none)
  function payoff(view, r, s, a, here) {
    var t = a >= 0 ? a >> 2 : -1, ar = a >= 0 ? a & 3 : -1, hit = ar === r;
    var R = view.res[r] * (hit && t === 2 ? 0.3 : hit && t === 3 ? 2.2 : 1);
    var nc = view.nc[r] + (s === 0 ? 1 : 0) - (here && view.self === 0 ? 1 : 0);
    var nk = view.nk[r] + (s === 1 ? 1 : 0) - (here && view.self === 1 ? 1 : 0);
    nc = Math.max(nc, s === 0 ? 1 : 0); nk = Math.max(nk, s === 1 ? 1 : 0);
    var n = nc + nk, perHead = R / n;
    // Competitors grab twice a cooperator's share; scarcity makes grabbing fiercer, abundance gentler
    var kw = perHead < 2.5 ? 3 : perHead > 7 ? 1.5 : 2;
    var Y = R * (0.7 + 0.6 * nc / n);                 // cooperation makes a region more productive
    var share = Y * (s === 0 ? 1 : kw) / (nc + kw * nk);
    if (hit && t === 0 && s === 1) share = -(share + 3);   // audit: competitors lose their take and are fined
    if (hit && t === 1 && s === 0) share += 2.5;           // bounty for cooperators
    return share;
  }

  function create(seed) {
    var rnd = mulberry32(seed >>> 0);
    var base = REGIONS.map(function () { return 70 + rnd() * 70; });
    var g = {
      seed: seed, season: 0, seasons: SEASONS, done: false,
      regions: REGIONS, actions: ACTIONS, actionNames: ACTION_NAMES, rules: RULES,
      base: base, res: base.slice(), lastAction: null, lastRegion: null, history: [], agents: [],
      event: { season: 5 + Math.floor(rnd() * 4), kind: rnd() < 0.5 ? 'dry' : 'rumour', fired: false }
    };
    for (var i = 0; i < N_AGENTS; i++) {
      var w = [];
      for (var t = 0; t < NA; t++) { w.push([]); for (var h = 0; h < NH; h++) w[t].push(1 / NH); }
      var tm = [];
      for (var p = 0; p < NA; p++) tm.push([1, 1, 1, 1]);
      g.agents.push({
        r: Math.floor(rnd() * NR), s: rnd() < 0.55 ? 0 : 1, prevR: null,
        memory: 0.75 + rnd() * 0.22,            // how slowly it forgets your old habits
        lr: 0.4 + rnd() * 1.0,                  // how quickly it changes its mind about your targeting rule
        markov: 0.3 + rnd() * 0.5,              // how much it thinks your last move predicts your next
        trust: 0.35 + rnd() * 0.4,              // how much it acts on its model of you at all
        bias: -1 + rnd() * 3,                   // its belief that cooperating pays (its model of the world)
        temp: 0.8 + rnd() * 0.8,                // how random its choices are
        tm: tm, freq: [1, 1, 1, 1], w: w,
        x: rnd(), y: rnd()                      // position inside its region, for drawing
      });
    }
    g.rnd = rnd;
    tally(g);
    return g;
  }

  function tally(g) {
    g.nc = [0, 0, 0, 0]; g.nk = [0, 0, 0, 0];
    g.agents.forEach(function (a) { if (a.s === 0) g.nc[a.r]++; else g.nk[a.r]++; });
  }

  // An agent's forecast of your next move: 16 probabilities (action * 4 + region)
  function forecast(ag, view, rules) {
    var pt = [0, 0, 0, 0], i, t, r;
    var fs = ag.freq.reduce(function (a, b) { return a + b; }, 0);
    for (t = 0; t < NA; t++) {
      var f = ag.freq[t] / fs;
      if (view.lastAction == null) pt[t] = f;
      else { var row = ag.tm[view.lastAction], rs = row.reduce(function (a, b) { return a + b; }, 0); pt[t] = ag.markov * row[t] / rs + (1 - ag.markov) * f; }
    }
    var out = new Array(16);
    for (t = 0; t < NA; t++) {
      var pr = [0, 0, 0, 0];
      for (i = 0; i < NH; i++) for (r = 0; r < NR; r++) pr[r] += ag.w[t][i] * rules[i][r];
      for (r = 0; r < NR; r++) out[t * 4 + r] = ag.trust * pt[t] * pr[r] + (1 - ag.trust) / 16;
    }
    return out;
  }

  /* Play one season. type: 0..3 (ACTIONS), region: 0..3. Returns this season's record. */
  function play(g, type, region) {
    if (g.done) return null;
    var view = { res: g.res.slice(), nc: g.nc.slice(), nk: g.nk.slice(), lastAction: g.lastAction, lastRegion: g.lastRegion };
    var rules = ruleDists(view), act = type * 4 + region;
    // Agents expect crowds to drift back toward an even spread rather than repeat last season exactly
    var coopFrac = view.nc.reduce(function (a, b) { return a + b; }, 0) / g.agents.length;
    var expect = {
      res: view.res,
      nc: view.nc.map(function (c) { return 0.5 * c + 0.5 * g.agents.length / NR * coopFrac; }),
      nk: view.nk.map(function (c) { return 0.5 * c + 0.5 * g.agents.length / NR * (1 - coopFrac); })
    };
    var colony = new Array(16).fill(0), sawIt = 0, pActual = 0, unpred = 0;

    // 1. Every agent forecasts you and picks the (region, stance) with the best expected payoff (softmax)
    g.agents.forEach(function (ag) {
      var fc = forecast(ag, view, rules), k;
      for (k = 0; k < 16; k++) colony[k] += fc[k] / g.agents.length;
      var best = 0; for (k = 1; k < 16; k++) if (fc[k] > fc[best]) best = k;
      if (best === act) sawIt++;
      pActual += fc[act] / g.agents.length;
      // Only some agents reconsider where to live each season (plus anyone hurt last season)
      var restless = ag.hurt || g.rnd() < 0.35;
      var util = [], opt;
      expect.self = ag.s;
      for (opt = 0; opt < 8; opt++) {
        var r = opt >> 1, s = opt & 1, here = r === ag.r, e = 0;
        if (!restless && !here) { util.push(-1e9); continue; }
        for (k = 0; k < 16; k++) e += fc[k] * payoff(expect, r, s, k, here);
        e += (s === 0 ? ag.bias : 0) - (here ? 0 : 1.5);
        util.push(e);
      }
      var mx = Math.max.apply(null, util), z = util.map(function (u) { return Math.exp((u - mx) / ag.temp); });
      norm(z);
      unpred += entropy(z) / Math.log(restless ? 8 : 2) / g.agents.length;
      var u = g.rnd(), c = 0;
      for (opt = 0; opt < 8; opt++) { c += z[opt]; if (u <= c) break; }
      opt = Math.min(opt, 7);
      ag.top = z.indexOf(Math.max.apply(null, z)) === opt;
      ag.fc = fc[act];
      ag.prevR = ag.r; ag.nr = opt >> 1; ag.ns = opt & 1;
    });
    g.agents.forEach(function (ag) {
      if (ag.nr !== ag.r) { ag.x = g.rnd(); ag.y = g.rnd(); }
      ag.r = ag.nr; ag.s = ag.ns;
    });
    tally(g);

    // 2. Your intervention lands; everyone is paid
    var after = { res: g.res, nc: g.nc, nk: g.nk }, caught = 0, rewarded = 0, hitAgents = 0, welfare = 0, payC = 0, nC = 0, payK = 0, nK = 0;
    g.agents.forEach(function (ag) {
      var v = { res: after.res, nc: after.nc, nk: after.nk, self: ag.s };
      var p = payoff(v, ag.r, ag.s, act, true);
      ag.pay = p; welfare += p / g.agents.length;
      if (ag.s === 0) { payC += p; nC++; } else { payK += p; nK++; }
      if (ag.r === region) {
        hitAgents++;
        if (type === 0 && ag.s === 1) caught++;
        if (type === 1 && ag.s === 0) rewarded++;
      }
    });
    var coop = g.nc.reduce(function (a, b) { return a + b; }, 0) / g.agents.length;

    // 3. Everyone learns: about you (your move is their training data) and about how predictable they are
    var caughtNow = caught;
    g.agents.forEach(function (ag) {
      var t, h, k;
      for (k = 0; k < NA; k++) ag.freq[k] *= ag.memory;
      ag.freq[type] += 1;
      if (g.lastAction != null) {
        for (k = 0; k < NA; k++) ag.tm[g.lastAction][k] *= ag.memory;
        ag.tm[g.lastAction][type] += 1;
      }
      for (t = 0; t < NA; t++) {
        var rate = ag.lr * (t === type ? 1 : 0.3);
        for (h = 0; h < NH; h++) ag.w[t][h] = Math.pow(ag.w[t][h], ag.memory) * Math.exp(rate * (rules[h][region] * 4 - 1));
        norm(ag.w[t]);
      }
      // Caught out while doing the obvious thing? Become harder to read.
      var harmed = ag.r === region && ((type === 0 && ag.s === 1) || type === 2);
      ag.hurt = harmed;
      var obvious = ag.top || ag.prevR === ag.r;
      if (harmed && obvious) ag.temp *= 1.45;
      // A big catch spooks everyone who saw it, not just those caught
      ag.temp = Math.max(0.6, Math.min(8, ag.temp * (1 + Math.min(0.3, caughtNow / 60)) * 0.95));
      // Trust the model of you more when it worked
      ag.trust = Math.min(0.95, Math.max(0.1, ag.trust + (ag.fc > 1 / 16 ? 0.04 : -0.03)));
      // Beliefs about the world: did cooperating pay this season?
      if (nC && nK) ag.bias = Math.max(-2, Math.min(3, ag.bias + 0.04 * Math.max(-3, Math.min(3, payC / nC - payK / nK))));
    });

    // 4. The world moves on
    for (var r = 0; r < NR; r++) {
      if (r === region && type === 2) g.res[r] *= 0.55;            // droughts linger
      else g.res[r] += 0.45 * (g.base[r] - g.res[r]);
      if (r === region && type === 1) g.res[r] -= rewarded * 0.6;   // bounties are paid from the land
      g.res[r] = Math.max(15, g.res[r]);
    }
    var eventText = null;
    if (!g.event.fired && g.season + 1 === g.event.season) {
      g.event.fired = true;
      if (g.event.kind === 'dry') { g.res = g.res.map(function (v) { return v * 0.6; }); eventText = 'A dry spell hits every region: resources fall by 40%.'; }
      else { g.agents.forEach(function (ag) { ag.trust *= 0.5; }); eventText = 'A rumour spreads that you are unpredictable: agents halve their trust in what they think they know about you.'; }
    }

    // Snapshot for the end-of-game reveal
    var typeFc = [0, 0, 0, 0], regFc = [0, 0, 0, 0], wAvg = [];
    for (var k2 = 0; k2 < 16; k2++) { typeFc[k2 >> 2] += colony[k2]; regFc[k2 & 3] += colony[k2]; }
    for (var t2 = 0; t2 < NA; t2++) {
      var row = new Array(NH).fill(0);
      g.agents.forEach(function (ag) { for (var h2 = 0; h2 < NH; h2++) row[h2] += ag.w[t2][h2] / g.agents.length; });
      wAvg.push(row);
    }
    var matched = rules.map(function (d) { return d[region] >= 0.5; });   // the rule pointed clearly at your region
    var rec = {
      season: g.season + 1, type: type, region: region, view: view,
      colony: colony, typeFc: typeFc, regFc: regFc, pActual: pActual, sawIt: sawIt,
      coop: coop, welfare: welfare, unpred: unpred, caught: caught, rewarded: rewarded, hitAgents: hitAgents,
      nc: g.nc.slice(), nk: g.nk.slice(), res: g.res.slice(), weights: wAvg, matched: matched,
      trust: g.agents.reduce(function (s, a) { return s + a.trust; }, 0) / g.agents.length,
      temp: g.agents.reduce(function (s, a) { return s + a.temp; }, 0) / g.agents.length,
      event: eventText
    };
    g.history.push(rec);
    g.lastAction = type; g.lastRegion = region; g.season++;
    if (g.season >= g.seasons) g.done = true;
    return rec;
  }

  // What the colony learned about you, in words, plus the numbers behind it
  function profile(g) {
    var H = g.history, n = H.length, i;
    var counts = [0, 0, 0, 0]; H.forEach(function (h) { counts[h.type]++; });
    var fav = counts.indexOf(Math.max.apply(null, counts));
    var repeats = 0; for (i = 1; i < n; i++) if (H[i].type === H[i - 1].type) repeats++;
    var ruleHits = RULES.map(function () { return 0; });
    H.forEach(function (h, k) { if (k > 0 || h.view.lastRegion != null) h.matched.forEach(function (m, j) { if (m) ruleHits[j]++; }); });
    var pairs = {}; for (i = 1; i < n; i++) { var key = H[i - 1].type + '>' + H[i].type; pairs[key] = (pairs[key] || 0) + 1; }
    var bestPair = null; Object.keys(pairs).forEach(function (k) { if (!bestPair || pairs[k] > pairs[bestPair]) bestPair = k; });
    var fromCount = bestPair ? H.slice(0, n - 1).filter(function (h) { return h.type === +bestPair[0]; }).length : 0;
    var half = Math.floor(n / 2);
    var mean = function (a) { return a.reduce(function (s, v) { return s + v; }, 0) / (a.length || 1); };
    var last = H[n - 1].weights[fav], topRule = last.indexOf(Math.max.apply(null, last));
    return {
      counts: counts, fav: fav, repeats: repeats, ruleHits: ruleHits, topRule: topRule, topRuleWeight: last[topRule],
      favWeights: last, bestPair: bestPair ? [+bestPair[0], +bestPair[2], pairs[bestPair], fromCount] : null,
      early: mean(H.slice(0, half).map(function (h) { return h.pActual; })),
      late: mean(H.slice(half).map(function (h) { return h.pActual; })),
      unpredStart: H[0].unpred, unpredEnd: H[n - 1].unpred,
      coop: mean(H.map(function (h) { return h.coop; }))
    };
  }

  var api = { create: create, play: play, profile: profile, REGIONS: REGIONS, ACTIONS: ACTIONS, ACTION_NAMES: ACTION_NAMES, RULES: RULES, payoff: payoff };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MirrorEngine = api;
})(this);
