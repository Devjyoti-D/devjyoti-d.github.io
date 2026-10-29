/* Beyond the Code page: content, animations and the session-booking widget */
(function () {
  'use strict';

  /* ============ EDIT ME: everything shown on the page lives here ============ */
  var EMAIL = 'er.devjyoti.das@gmail.com';
  var CONTENT = {
    podcast: {
      name: 'The Beyond the Code Podcast',
      status: 'Season 1 · In production',
      pitch: 'Conversations with the people building AI for the real world: farms, satellites, hospitals and cities. Less hype, more about what actually works, what fails, and what it takes to get there.',
      // Guests stay hidden until announced: set name to reveal one, e.g. { name: 'Dr Jane Doe', area: 'Remote sensing' }
      guests: [
        { name: null, area: 'Remote sensing and climate' },
        { name: null, area: 'AI in agriculture' },
        { name: null, area: 'Machine learning in industry' }
      ],
      episodes: [
        { title: 'Teaching machines to see the farm', text: 'Computer vision for livestock and crops, and what changes when a model leaves the lab for the barn.', tags: ['Computer vision', 'Agriculture'] },
        { title: 'Satellites, data and the planet', text: 'What satellite imagery can and cannot tell us about land, food and biodiversity.', tags: ['Remote sensing', 'Climate'] },
        { title: 'From student to researcher', text: 'The unglamorous, honest path into a research career, and what I wish I had known earlier.', tags: ['Careers', 'PhD life'] },
        { title: 'When models meet the real world', text: 'Deploying machine learning beyond the benchmark: messy data, edge cases and trust.', tags: ['Deployment', 'MLOps'] }
      ]
    },
    book: {
      title: 'Teaching Machines to See',
      subtitle: 'A practical journey from pixels to real-world AI',
      pitch: 'A hands-on guide to computer vision for people who want to build things that work outside the lab, drawn from research on farms, fields and satellites.',
      percent: 30,                                   // how much is written
      stages: ['Idea', 'Outline', 'Writing', 'Editing', 'Published'],
      stage: 2,                                      // index into stages: the one in progress
      chapters: [
        { title: 'Why seeing is hard', status: 'drafted' },
        { title: 'Pixels, features and learned representations', status: 'drafted' },
        { title: 'Data: the real bottleneck', status: 'writing' },
        { title: 'Models that travel: from benchmark to barn', status: 'planned' },
        { title: 'Seeing from space', status: 'planned' },
        { title: 'Depth, 3D and measurement', status: 'planned' },
        { title: 'Shipping vision systems', status: 'planned' },
        { title: 'The researcher\'s mindset', status: 'planned' }
      ]
    },
    services: [
      { id: 'career', icon: '🧭', title: 'AI career advice', minutes: 30, points: ['Industry, PhD or startup: choosing your path', 'The skills that actually get you hired', 'A quick review of your CV and LinkedIn'] },
      { id: 'research', icon: '🔬', title: 'Research guidance', minutes: 45, points: ['Finding a research question worth asking', 'Reading and writing papers effectively', 'PhD applications and supervisor fit'] },
      { id: 'portfolio', icon: '🧪', title: 'ML portfolio review', minutes: 45, points: ['Detailed feedback on 1 to 3 projects', 'What reviewers and recruiters look for', 'A clear plan to level it up'] }
    ],
    slotsUK: ['10:00', '11:30', '14:00', '16:00', '18:00'],   // available start times, UK time, Monday to Friday
    daysAhead: 10                                            // how many weekdays to offer
  };
  /* ========================================================================== */

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function mailto(subject, body) { return 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) + (body ? '&body=' + encodeURIComponent(body) : ''); }

  /* ---------- Podcast ---------- */
  var P = CONTENT.podcast;
  $('pod-name').textContent = P.name;
  $('pod-status').textContent = P.status;
  $('pod-pitch').textContent = P.pitch;
  $('pod-notify').href = mailto('Podcast: please notify me at launch', 'Hi Devjyoti,\n\nPlease let me know when the first episode of ' + P.name + ' is out.\n\nThanks!');
  $('pod-guest').href = mailto('Podcast: guest suggestion', 'Hi Devjyoti,\n\nI think this person would be a great guest:\n\nName:\nWhy:\nHow to reach them:\n');
  var wave = $('pod-wave');
  for (var i = 0; i < 56; i++) {
    var bar = el('i');
    bar.style.setProperty('--h', (0.25 + Math.random() * 0.75).toFixed(2));
    bar.style.animationDuration = (0.8 + Math.random() * 1.1).toFixed(2) + 's';
    bar.style.animationDelay = (-Math.random() * 2).toFixed(2) + 's';
    wave.appendChild(bar);
  }
  var silhouette = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="24" r="12"/><path d="M8 64c0-14 11-24 24-24s24 10 24 24z"/></svg>';
  P.guests.forEach(function (g, k) {
    var card = el('div', 'bt-guest reveal');
    card.style.setProperty('--d', (0.1 + k * 0.12) + 's');
    var who = el('div', 'who'); who.innerHTML = silhouette + '<b>' + (g.name ? '' : '?') + '</b>';
    card.appendChild(who);
    card.appendChild(el('strong', null, g.name || 'To be announced'));
    card.appendChild(el('span', null, g.area));
    $('pod-guests').appendChild(card);
  });
  P.episodes.forEach(function (ep, k) {
    var li = el('li', 'bt-ep reveal');
    li.style.setProperty('--d', (k * 0.1) + 's');
    li.appendChild(el('span', 'num', String(k + 1).padStart(2, '0')));
    var body = el('div');
    body.appendChild(el('h4', null, ep.title));
    body.appendChild(el('p', null, ep.text));
    var tags = el('div', 'tags'); ep.tags.forEach(function (t) { tags.appendChild(el('span', null, t)); }); body.appendChild(tags);
    li.appendChild(body);
    li.appendChild(el('span', 'bt-chip-soon', 'Coming soon'));
    $('pod-episodes').appendChild(li);
  });

  /* ---------- Book ---------- */
  var B = CONTENT.book;
  $('book-title').textContent = B.title;
  $('book-sub').textContent = B.subtitle;
  $('book-pitch').textContent = B.pitch;
  $('book-stage-label').textContent = 'Stage: ' + B.stages[B.stage];
  var drafted = B.chapters.filter(function (c) { return c.status === 'drafted'; }).length;
  $('book-chapters').textContent = drafted + ' of ' + B.chapters.length + ' chapters drafted';
  $('book-notify').href = mailto('Book: early chapters', 'Hi Devjyoti,\n\nI would love to read early chapters of ' + B.title + ' and share feedback.\n\nThanks!');
  B.stages.forEach(function (s, k) { $('book-timeline').appendChild(el('li', k < B.stage ? 'done' : k === B.stage ? 'now' : '', s)); });
  var STATUS = { drafted: 'Drafted', writing: 'Writing now', planned: 'Planned' };
  B.chapters.forEach(function (c, k) {
    var card = el('div', 'bt-ch reveal');
    card.style.setProperty('--d', (k % 4) * 0.08 + 's');
    card.appendChild(el('small', null, 'CHAPTER ' + (k + 1)));
    card.appendChild(el('h4', null, c.title));
    card.appendChild(el('span', 'st ' + c.status, STATUS[c.status]));
    $('book-toc').appendChild(card);
  });
  function fillRing() {
    var ring = $('book-ring'), pctEl = $('book-pct'), target = B.percent, t0 = performance.now();
    ring.style.strokeDashoffset = (326.7 * (1 - target / 100)).toFixed(1);
    (function count(now) {
      var k = Math.min(1, (now - t0 - 300) / 2000), e = 1 - Math.pow(1 - Math.max(0, k), 3);
      pctEl.textContent = Math.round(target * e) + '%';
      if (k < 1) requestAnimationFrame(count);
    })(t0);
  }
  // The book leans toward the pointer
  var stage = $('book-stage'), book = $('book3d');
  stage.addEventListener('pointermove', function (e) {
    var r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    book.style.setProperty('--ry', (x * 40).toFixed(1) + 'deg'); book.style.setProperty('--rx', (6 - y * 20).toFixed(1) + 'deg');
  });
  stage.addEventListener('pointerleave', function () { book.style.removeProperty('--ry'); book.style.removeProperty('--rx'); });

  /* ---------- Reveal on scroll ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      if (en.target.classList.contains('bt-book')) fillRing();
      io.unobserve(en.target);
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(function (r) { io.observe(r); });

  // Spotlight that follows the pointer on .glow cards
  document.addEventListener('pointermove', function (e) {
    document.querySelectorAll('.glow').forEach(function (c) {
      var r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  }, { passive: true });

  /* ---------- Hero network: drifting nodes that link up, and reach toward the pointer ---------- */
  (function () {
    var cv = $('bt-net'), ctx = cv.getContext('2d'), hero = cv.parentElement, nodes = [], W = 0, H = 0, dpr = 1, mouse = null, visible = true, raf = 0;
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1); W = hero.clientWidth; H = hero.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      var n = Math.round(Math.min(110, W * H / 11000));
      while (nodes.length < n) nodes.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35, r: 1 + Math.random() * 1.6 });
      nodes.length = n;
    }
    function frame() {
      raf = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      var LINK = 130, i, j;
      for (i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        if (mouse) { var mx = mouse.x - a.x, my = mouse.y - a.y, md = Math.hypot(mx, my); if (md < 180) { a.vx += mx / md * 0.012; a.vy += my / md * 0.012; } }
        a.vx *= 0.995; a.vy *= 0.995;
        var sp = Math.hypot(a.vx, a.vy); if (sp > 0.9) { a.vx *= 0.9 / sp; a.vy *= 0.9 / sp; }
        a.x += a.vx; a.y += a.vy;
        if (a.x < 0 || a.x > W) a.vx *= -1; if (a.y < 0 || a.y > H) a.vy *= -1;
      }
      for (i = 0; i < nodes.length; i++) for (j = i + 1; j < nodes.length; j++) {
        var d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (d < LINK) { ctx.strokeStyle = 'rgba(190,160,255,' + (0.28 * (1 - d / LINK)).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke(); }
      }
      if (mouse) nodes.forEach(function (a) {
        var d = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (d < 180) { ctx.strokeStyle = 'rgba(255,170,220,' + (0.45 * (1 - d / 180)).toFixed(3) + ')'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke(); }
      });
      nodes.forEach(function (a) { ctx.fillStyle = 'rgba(235,225,255,.85)'; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 7); ctx.fill(); });
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function go() { if (!raf) raf = requestAnimationFrame(frame); }
    hero.addEventListener('pointermove', function (e) { var r = hero.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    hero.addEventListener('pointerleave', function () { mouse = null; });
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) go(); }).observe(hero);
    document.addEventListener('visibilitychange', go);
    new ResizeObserver(size).observe(hero);
    size(); go();
  })();

  /* ---------- Booking ---------- */
  var sel = { service: null, day: null, slot: null };
  CONTENT.services.forEach(function (s, k) {
    var b = el('button', 'bt-service reveal'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false'); b.dataset.id = s.id;
    b.style.setProperty('--d', (k * 0.12) + 's');
    b.innerHTML = '<span class="tick"><svg viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7"/></svg></span><span class="ico" aria-hidden="true"></span><b></b><span class="dur"></span><ul></ul>';
    b.querySelector('.ico').textContent = s.icon;
    b.querySelector('b').textContent = s.title;
    b.querySelector('.dur').textContent = s.minutes + '-minute video call';
    s.points.forEach(function (p) { b.querySelector('ul').appendChild(el('li', null, p)); });
    b.addEventListener('click', function () {
      sel.service = s;
      document.querySelectorAll('.bt-service').forEach(function (x) { x.setAttribute('aria-checked', x === b); });
      update();
    });
    $('services').appendChild(b);
    io.observe(b);
  });

  // UK wall-clock time -> real Date (handles GMT/BST), shown in the visitor's own time zone
  function ukDate(y, m, d, hh, mm) {
    var guess = Date.UTC(y, m, d, hh, mm);
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    var h = +parts.find(function (p) { return p.type === 'hour'; }).value, mi = +parts.find(function (p) { return p.type === 'minute'; }).value;
    return new Date(guess - ((h * 60 + mi) - (hh * 60 + mm)) * 60000);
  }
  var localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time';
  $('tz').textContent = '(shown in your time: ' + localTZ.replace(/_/g, ' ') + ')';
  var days = [], d = new Date(); d.setHours(12, 0, 0, 0);
  while (days.length < CONTENT.daysAhead) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) days.push(new Date(d)); }
  days.forEach(function (day) {
    var b = el('button', 'bt-day'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
    b.appendChild(el('small', null, day.toLocaleDateString(undefined, { weekday: 'short' })));
    b.appendChild(el('b', null, day.getDate()));
    b.appendChild(el('small', null, day.toLocaleDateString(undefined, { month: 'short' })));
    b.setAttribute('aria-label', day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));
    b.addEventListener('click', function () {
      sel.day = day; sel.slot = null;
      document.querySelectorAll('.bt-day').forEach(function (x) { x.setAttribute('aria-checked', x === b); });
      renderSlots(); update();
    });
    $('days').appendChild(b);
  });
  function renderSlots() {
    var box = $('slots'); box.textContent = '';
    CONTENT.slotsUK.forEach(function (t) {
      var hm = t.split(':'), when = ukDate(sel.day.getFullYear(), sel.day.getMonth(), sel.day.getDate(), +hm[0], +hm[1]);
      var b = el('button', 'bt-slot', when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', function () {
        sel.slot = { when: when, uk: t };
        document.querySelectorAll('.bt-slot').forEach(function (x) { x.setAttribute('aria-checked', x === b); });
        update();
      });
      box.appendChild(b);
    });
  }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function update() {
    $('st2').classList.toggle('on', !!sel.service);
    $('st3').classList.toggle('on', !!(sel.service && sel.slot));
    var s = $('summary');
    if (sel.service && sel.slot) {
      s.innerHTML = '<b></b><br><span></span>';
      s.querySelector('b').textContent = sel.service.title + ' · ' + sel.service.minutes + ' min';
      s.querySelector('span').textContent = sel.slot.when.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' your time (' + sel.slot.uk + ' UK time)';
    } else s.textContent = !sel.service ? 'Choose a session above, then a day and a time.' : !sel.day ? 'Now pick a day.' : 'Now pick a time.';
    $('send').disabled = !(sel.service && sel.slot && $('f-name').value.trim() && validEmail($('f-email').value.trim()));
  }
  ['f-name', 'f-email'].forEach(function (id) { $(id).addEventListener('input', update); });
  $('form').addEventListener('submit', function (e) {
    e.preventDefault(); update();
    if ($('send').disabled) return;
    var whenLocal = sel.slot.when.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    var body = 'Hi Devjyoti,\n\nI would like to book a session.\n\n' +
      'Session: ' + sel.service.title + ' (' + sel.service.minutes + ' minutes)\n' +
      'Requested time: ' + whenLocal + ' (' + localTZ + ')\n' +
      'UK time: ' + sel.slot.when.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + '\n\n' +
      'Name: ' + $('f-name').value.trim() + '\nEmail: ' + $('f-email').value.trim() + '\n\n' +
      'What I would like to talk about:\n' + ($('f-msg').value.trim() || '(not specified)') + '\n\nThanks!';
    window.location.href = mailto('Session request: ' + sel.service.title + ' on ' + sel.slot.when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), body);
    $('done-mail').textContent = EMAIL; $('done-mail').href = 'mailto:' + EMAIL;
    document.querySelector('.bt-book-grid').hidden = true; document.querySelector('.bt-steps').hidden = true; $('done').hidden = false;
  });
  $('again').addEventListener('click', function () {
    document.querySelector('.bt-book-grid').hidden = false; document.querySelector('.bt-steps').hidden = false; $('done').hidden = true;
  });
  update();
})();
