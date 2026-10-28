// Homepage interactions: theme, mobile menu, active nav, carousel, filters, media toggle

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
  nav.querySelectorAll('a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window) {
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

  // Topic filters for projects and publications
  document.querySelectorAll('.filters').forEach(function (group) {
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
  moreBtn.addEventListener('click', function () {
    var expanded = mediaGrid.classList.toggle('expanded');
    moreBtn.textContent = expanded ? 'Show less' : 'Show more';
    moreBtn.setAttribute('aria-expanded', expanded);
  });

  document.getElementById('year').textContent = new Date().getFullYear();
})();
