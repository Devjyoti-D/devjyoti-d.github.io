// Site interactions (homepage and Quant Lab): theme, mobile menu, active nav, carousel, filters, media toggle

(function () {
  var root = document.documentElement;

  // Dark mode toggle
  document.getElementById('theme-toggle').addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });

  // Mobile menu
  var nav = document.getElementById('nav');
  var menuBtn = document.getElementById('menu-toggle');
  menuBtn.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', open);
  });
  nav.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      nav.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', false);
    });
  });

  // Highlight the nav link for the section in view
  var links = {};
  nav.querySelectorAll('a[href^="#"]').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window && Object.keys(links).length) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        Object.keys(links).forEach(function (id) { links[id].classList.toggle('active', id === entry.target.id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    Object.keys(links).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  }

  // Highlights carousel: 5s per slide, paused on hover
  var carousel = document.getElementById('carousel');
  if (carousel) {
    var slides = carousel.querySelectorAll('img');
    var dots = carousel.querySelectorAll('.dots span');
    var current = 0;
    var paused = false;
    carousel.addEventListener('mouseenter', function () { paused = true; });
    carousel.addEventListener('mouseleave', function () { paused = false; });
    setInterval(function () {
      if (paused || document.hidden) return;
      slides[current].classList.remove('active');
      dots[current].classList.remove('active');
      current = (current + 1) % slides.length;
      slides[current].classList.add('active');
      dots[current].classList.add('active');
    }, 5000);
  }

  // Topic filters for projects and publications
  document.querySelectorAll('.filters[data-target]').forEach(function (group) {
    var items = document.getElementById(group.dataset.target).children;
    group.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      group.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('active', c === chip); });
      var filter = chip.dataset.filter;
      Array.prototype.forEach.call(items, function (item) {
        var match = filter === 'all' || item.dataset.tags.split(' ').indexOf(filter) !== -1;
        item.classList.toggle('hidden', !match);
      });
    });
  });

  // Media "Show more"
  var mediaGrid = document.getElementById('media-grid');
  var moreBtn = document.getElementById('media-more');
  if (mediaGrid && moreBtn) {
    moreBtn.addEventListener('click', function () {
      var expanded = mediaGrid.classList.toggle('expanded');
      moreBtn.textContent = expanded ? 'Show less' : 'Show more';
      moreBtn.setAttribute('aria-expanded', expanded);
    });
  }

  // Hero heading: types itself in on load, then erases and retypes every 10 seconds
  var typed = document.getElementById('typed');
  if (typed) {
    var full = typed.textContent, h1 = typed.closest('h1'), run = 0;   // run: a newer cycle cancels an older one
    var setText = function (n) { typed.textContent = full.slice(0, n); };
    var type = function (id, n) {
      if (id !== run) return;
      setText(n);
      if (n < full.length) setTimeout(function () { type(id, n + 1); }, 70 + Math.random() * 70);
      else h1.classList.remove('typing');
    };
    var erase = function (id, n) {
      if (id !== run) return;
      setText(n);
      if (n > 0) setTimeout(function () { erase(id, n - 1); }, 35);
      else setTimeout(function () { type(id, 1); }, 350);
    };
    var cycle = function () {
      if (document.hidden) return;
      h1.classList.add('typing'); erase(++run, typed.textContent.length);
    };
    h1.classList.add('typing'); setText(0); setTimeout(function () { type(run, 1); }, 400);
    setInterval(cycle, 10000);
  }

  // Cat in the side margin: its irises slide toward the pointer
  var cat = document.getElementById('side-cat');
  if (cat) {
    var irises = [].slice.call(cat.querySelectorAll('.cat-iris')), vb = cat.viewBox.baseVal, target = null, queued = false;
    var look = function () {
      queued = false;
      var box = cat.getBoundingClientRect();
      if (!box.width) return;                                           // hidden on small screens
      var k = box.width / vb.width;                                      // screen px per image px
      irises.forEach(function (g) {
        var cx = +g.dataset.cx, cy = +g.dataset.cy;
        var dx = target.x - (box.left + (cx - vb.x) * k), dy = target.y - (box.top + (cy - vb.y) * k);
        var d = Math.sqrt(dx * dx + dy * dy) || 1, s = Math.min(1, d / 120);   // look less far when the pointer is close
        g.setAttribute('transform', 'translate(' + (cx + dx / d * s * g.dataset.rx).toFixed(1) + ' ' + (cy + dy / d * s * g.dataset.ry).toFixed(1) + ')');
      });
    };
    window.addEventListener('pointermove', function (e) {
      target = { x: e.clientX, y: e.clientY };
      if (!queued) { queued = true; requestAnimationFrame(look); }
    }, { passive: true });
  }

  document.getElementById('year').textContent = new Date().getFullYear();
})();
