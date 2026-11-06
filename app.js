/* =========================================================
   119 宿舍 · 页面交互
   一般不需要改这个文件；想加功能再回来看。
   ========================================================= */

(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  /* ---------------- 照片墙 ---------------- */

  var grid = $('#photo-grid');

  function renderGallery() {
    if (!grid || typeof PHOTOS === 'undefined') return;

    grid.innerHTML = '';

    if (!PHOTOS.length) {
      var empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '照片墙还是空的——点右下角「＋ 加照片」放几张进来。';
      grid.appendChild(empty);
      return;
    }

    grid.classList.toggle('grid--few', PHOTOS.length < 4);

    var frag = document.createDocumentFragment();

    PHOTOS.forEach(function (photo, index) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'photo';
      btn.setAttribute('aria-label', '查看照片：' + photo.title);

      var img = document.createElement('img');
      img.src = photo.src;
      img.alt = photo.title;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', function () { btn.classList.add('is-broken'); });

      var cap = document.createElement('span');
      cap.className = 'photo-cap';
      cap.textContent = photo.title;

      btn.appendChild(img);
      btn.appendChild(cap);
      btn.addEventListener('click', function () { openLightbox(index); });

      frag.appendChild(btn);
    });

    grid.appendChild(frag);
  }

  // 让「加照片」面板能在新照片后重绘
  window.renderGallery = renderGallery;

  /* ---------------- 大图查看 ---------------- */

  var lb = $('#lightbox');
  var lbImg = $('#lb-img');
  var lbCap = $('#lb-cap');
  var lbCount = $('#lb-count');
  var closeBtn = $('.lb-close', lb);
  var current = 0;
  var lastFocus = null;

  function show(index) {
    if (!PHOTOS.length) return;
    current = (index + PHOTOS.length) % PHOTOS.length;
    var photo = PHOTOS[current];
    lbImg.src = photo.src;
    lbImg.alt = photo.title;
    lbCap.textContent = photo.title;
    lbCount.textContent = (current + 1) + ' / ' + PHOTOS.length;
  }

  function openLightbox(index) {
    if (!lb) return;
    lastFocus = document.activeElement;
    show(index);
    lb.hidden = false;
    document.body.classList.add('no-scroll');
    if (closeBtn) closeBtn.focus();
  }

  function closeLightbox() {
    if (!lb || lb.hidden) return;
    lb.hidden = true;
    document.body.classList.remove('no-scroll');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function step(delta) { show(current + delta); }

  if (lb) {
    $('.lb-close', lb).addEventListener('click', closeLightbox);
    $('.lb-prev', lb).addEventListener('click', function () { step(-1); });
    $('.lb-next', lb).addEventListener('click', function () { step(1); });

    // 点空白处关闭
    lb.addEventListener('click', function (e) {
      if (e.target === lb) closeLightbox();
    });

    // 键盘：Esc 关闭，← → 翻页
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') { closeLightbox(); }
      else if (e.key === 'ArrowLeft') { step(-1); }
      else if (e.key === 'ArrowRight') { step(1); }
    });

    // 手机上左右滑动翻页
    var touchX = 0;
    lb.addEventListener('touchstart', function (e) {
      touchX = e.changedTouches[0].clientX;
    }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) step(dx > 0 ? -1 : 1);
    }, { passive: true });
  }

  /* ---------------- 首屏那张合影也能点开 ---------------- */

  var heroZoom = document.querySelector('.hero-zoom');
  if (heroZoom && typeof PHOTOS !== 'undefined' && PHOTOS.length) {
    heroZoom.addEventListener('click', function () {
      var img = heroZoom.querySelector('img');
      var src = img ? img.getAttribute('src') : '';
      var index = 0;
      for (var i = 0; i < PHOTOS.length; i++) {
        if (PHOTOS[i].src === src) { index = i; break; }
      }
      openLightbox(index);
    });
  }

  /* ---------------- 导航栏滚动变色 ---------------- */

  var nav = $('#nav');
  function onScroll() {
    if (!nav) return;
    nav.classList.toggle('scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------------- 当前所在区块高亮 ---------------- */

  var links = Array.prototype.slice.call(document.querySelectorAll('.links a'));
  var sections = links
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  function setActive(id) {
    links.forEach(function (a) {
      var on = a.getAttribute('href') === '#' + id;
      if (on) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------------- 滚动出现 ---------------- */

  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------------- 页脚年份 ---------------- */

  var year = $('#year');
  if (year) year.textContent = new Date().getFullYear();

  /* ---------------- 启动 ---------------- */

  renderGallery();
})();
