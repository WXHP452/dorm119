/* =========================================================
   119 宿舍 · 「加照片」面板
   ---------------------------------------------------------
   做三件事：
   1. 在你自己的浏览器里把照片压到长边 1600px（不传服务器）
   2. 生成 photos.js 的内容，供你复制或直接发布
   3. 如果填了 GitHub Token，可以一键提交到仓库

   所有压缩都在本地完成，不上传任何东西。
   ========================================================= */

(function () {
  'use strict';

  var MAX_EDGE = 1600;
  var QUALITY = 0.82;
  var MAX_BATCH = 30;
  var STORE_KEY = 'dorm119-github';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  var fab = $('#fab-add');
  var panel = $('#photo-panel');
  if (!fab || !panel) return;

  var dropzone = $('#dropzone');
  var fileInput = $('#file-input');
  var queueEl = $('#queue');
  var msgEl = $('#panel-msg');
  var btnDownload = $('#btn-download');
  var btnCopy = $('#btn-copy');
  var btnPublish = $('#btn-publish');
  var closeBtn = $('#panel-close');

  var fields = {
    owner: $('#gh-owner'),
    repo: $('#gh-repo'),
    branch: $('#gh-branch'),
    token: $('#gh-token')
  };

  var queue = [];   // { id, blob, url, name, title, size }
  var seq = 0;

  /* ---------------- 小工具 ---------------- */

  function say(text, isError) {
    if (!msgEl) return;
    msgEl.hidden = false;
    msgEl.textContent = text;
    msgEl.classList.toggle('is-error', !!isError);
  }

  function hideMsg() {
    if (msgEl) msgEl.hidden = true;
  }

  function kb(n) {
    return n >= 1024 * 1024
      ? (n / 1024 / 1024).toFixed(1) + ' MB'
      : Math.round(n / 1024) + ' KB';
  }

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* 隐私模式下会失败，忽略 */ }
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  function openPanel() {
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    document.body.classList.add('no-scroll');
    if (closeBtn) closeBtn.focus();
    loadConfig();
  }

  function closePanel() {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('no-scroll');
    fab.focus();
  }

  fab.addEventListener('click', openPanel);
  if (closeBtn) closeBtn.addEventListener('click', closePanel);
  panel.addEventListener('click', function (e) {
    if (e.target === panel) closePanel();
  });
  document.addEventListener('keydown', function (e) {
    if (!panel.hidden && e.key === 'Escape') closePanel();
  });

  /* ---------------- 选照片 ---------------- */

  async function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return f.type && f.type.indexOf('image/') === 0;
    });

    if (!files.length) {
      say('这些文件不是图片，换一批试试。', true);
      return;
    }
    if (queue.length + files.length > MAX_BATCH) {
      files = files.slice(0, Math.max(0, MAX_BATCH - queue.length));
      say('一次最多 ' + MAX_BATCH + ' 张，先处理前 ' + files.length + ' 张。');
    }

    var failed = 0;
    for (var i = 0; i < files.length; i++) {
      say('正在压缩 ' + (i + 1) + ' / ' + files.length + ' ……');
      try {
        var blob = await compress(files[i]);
        addToQueue(blob, guessTitle(files[i].name));
      } catch (err) {
        failed++;
      }
    }

    refreshLabels();
    if (failed) {
      say('有 ' + failed + ' 张没处理成功（格式不支持或文件损坏），其余已经加进来了。', true);
    } else {
      hideMsg();
    }
  }

  function guessTitle(name) {
    return name
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .slice(0, 40);
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片打不开，可能格式不支持')); };
      img.src = url;
    });
  }

  async function compress(file) {
    var url = URL.createObjectURL(file);
    try {
      var img = await loadImage(url);
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      if (!w || !h) throw new Error('图片尺寸异常');

      var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));

      var canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);

      var blob = await new Promise(function (resolve) {
        canvas.toBlob(function (b) { resolve(b); }, 'image/jpeg', QUALITY);
      });
      if (!blob) throw new Error('压缩失败，换一张试试');
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  fileInput.addEventListener('change', function () {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    dropzone.addEventListener(type, function (e) {
      e.preventDefault();
      dropzone.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (type) {
    dropzone.addEventListener(type, function (e) {
      e.preventDefault();
      dropzone.classList.remove('is-drag');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });

  // 面板打开时，支持直接 Ctrl+V 粘贴截图
  document.addEventListener('paste', function (e) {
    if (panel.hidden || !e.clipboardData) return;
    var files = Array.prototype.slice.call(e.clipboardData.files || []);
    if (files.length) {
      e.preventDefault();
      handleFiles(files);
    }
  });

  /* ---------------- 队列 ---------------- */

  function addToQueue(blob, title) {
    var item = {
      id: ++seq,
      blob: blob,
      url: URL.createObjectURL(blob),
      name: '',
      title: title || '',
      size: blob.size
    };
    queue.push(item);

    var li = document.createElement('li');
    li.dataset.id = String(item.id);

    var thumb = document.createElement('img');
    thumb.src = item.url;
    thumb.alt = '';

    var main = document.createElement('div');
    main.className = 'q-main';

    var input = document.createElement('input');
    input.type = 'text';
    input.value = item.title;
    input.placeholder = '写个说明（可不填）';
    input.setAttribute('aria-label', '照片说明');
    input.addEventListener('input', function () { item.title = input.value; });

    var meta = document.createElement('span');
    meta.className = 'q-size';
    main.appendChild(input);
    main.appendChild(meta);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'q-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', '移除这张');
    del.addEventListener('click', function () {
      URL.revokeObjectURL(item.url);
      queue = queue.filter(function (q) { return q.id !== item.id; });
      li.remove();
      refreshLabels();
    });

    li.appendChild(thumb);
    li.appendChild(main);
    li.appendChild(del);
    queueEl.appendChild(li);

    refreshLabels();
  }

  function nextNames() {
    var used = {};
    (typeof PHOTOS !== 'undefined' ? PHOTOS : []).forEach(function (p) {
      used[String(p.src).split('/').pop()] = true;
    });
    var index = (typeof PHOTOS !== 'undefined' ? PHOTOS.length : 0) + 1;
    return queue.map(function () {
      var name;
      do {
        name = String(index).padStart(2, '0') + '.jpg';
        index++;
      } while (used[name]);
      used[name] = true;
      return name;
    });
  }

  function refreshLabels() {
    var names = nextNames();
    var rows = queueEl.children;
    for (var i = 0; i < queue.length; i++) {
      queue[i].name = names[i];
      var meta = rows[i] && rows[i].querySelector('.q-size');
      if (meta) meta.textContent = names[i] + ' · ' + kb(queue[i].size);
    }

    var has = queue.length > 0;
    btnDownload.disabled = !has;
    btnCopy.disabled = !has;
    btnPublish.disabled = !has;
  }

  /* ---------------- 落到本地 PHOTOS ---------------- */

  function commitLocal() {
    if (typeof PHOTOS === 'undefined') return [];
    var names = nextNames();
    var added = queue.map(function (item, i) {
      var name = names[i];
      var title = item.title.trim() || name.replace('.jpg', ' 号照片');
      var entry = { src: 'images/' + name, title: title };
      PHOTOS.push(entry);
      return { name: name, blob: item.blob, entry: entry };
    });

    queue.forEach(function (item) { URL.revokeObjectURL(item.url); });
    queue = [];
    queueEl.innerHTML = '';
    refreshLabels();

    if (typeof window.renderGallery === 'function') window.renderGallery();
    return added;
  }

  /* ---------------- 下载 ---------------- */

  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
  }

  btnDownload.addEventListener('click', async function () {
    if (!queue.length) return;
    var added = commitLocal();
    for (var i = 0; i < added.length; i++) {
      downloadBlob(added[i].blob, added[i].name);
      await new Promise(function (r) { setTimeout(r, 600); });
    }
    say('已下载 ' + added.length + ' 张（' + added.map(function (a) { return a.name; }).join('、') +
      '）。把它们放进 GitHub 仓库的 images/ 文件夹，再覆盖 photos.js 即可。' +
      '如果浏览器只让你存了一张，请看下载设置里的「允许多个文件下载」。');
  });

  /* ---------------- 生成 photos.js ---------------- */

  function buildPhotosFile() {
    return buildPhotosFileFor(PHOTOS);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      area.remove();
      ok ? resolve() : reject(new Error('复制失败，请手动选中'));
    });
  }

  btnCopy.addEventListener('click', async function () {
    if (!queue.length) return;
    var added = commitLocal();
    try {
      await copyText(buildPhotosFile());
      say('已复制 ' + added.length + ' 张照片的代码，把 photos.js 整个文件覆盖成这段内容就行。');
    } catch (err) {
      say('自动复制被浏览器拦了。可以打开 photos.js 手动加这几行：\n' +
        added.map(function (a) {
          return '{ src: "' + a.entry.src + '", title: "' + a.entry.title + '" },';
        }).join('\n'), true);
    }
  });

  /* ---------------- GitHub 发布 ---------------- */

  function loadConfig() {
    var raw = store(STORE_KEY);
    if (!raw) return;
    try {
      var cfg = JSON.parse(raw);
      if (cfg.owner) fields.owner.value = cfg.owner;
      if (cfg.repo) fields.repo.value = cfg.repo;
      if (cfg.branch) fields.branch.value = cfg.branch;
      if (cfg.token) fields.token.value = cfg.token;
    } catch (e) { /* 坏数据就算了 */ }
  }

  function saveConfig() {
    store(STORE_KEY, JSON.stringify({
      owner: fields.owner.value.trim(),
      repo: fields.repo.value.trim(),
      branch: fields.branch.value.trim() || 'main',
      token: fields.token.value.trim()
    }));
  }

  Object.keys(fields).forEach(function (k) {
    fields[k].addEventListener('change', saveConfig);
  });

  function readConfig() {
    var cfg = {
      owner: fields.owner.value.trim(),
      repo: fields.repo.value.trim(),
      branch: fields.branch.value.trim() || 'main',
      token: fields.token.value.trim()
    };
    if (!cfg.owner || !cfg.repo) throw new Error('先填仓库 owner 和仓库名');
    if (!cfg.token) throw new Error('先填 Token（没有的话用「下载」+ 手动上传）');
    return cfg;
  }

  async function api(path, options) {
    var cfg = readConfig();
    var url = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + path;
    var res = await fetch(url, {
      method: (options && options.method) || 'GET',
      headers: {
        Authorization: 'Bearer ' + cfg.token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: options && options.body ? JSON.stringify(options.body) : undefined
    });

    if (res.status === 404) {
      var method = (options && options.method) || 'GET';
      // 查文件时 404 表示"还没有这个文件"；写入时 404 说明仓库路径有问题
      if (method === 'GET') return null;
      throw new Error('仓库或分支不存在，检查 owner / 仓库名 / 分支');
    }

    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok) {
      var reason = (data && data.message) || ('HTTP ' + res.status);
      if (res.status === 401) reason = 'Token 无效或已过期';
      if (res.status === 403) reason = '没有权限，检查 Token 的 Contents 权限';
      if (res.status === 409) reason = '仓库内容冲突，刷新页面再试';
      throw new Error(reason);
    }
    return data;
  }

  async function base64Of(blob) {
    return base64OfBytes(new Uint8Array(await blob.arrayBuffer()));
  }

  function base64OfBytes(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64OfText(text) {
    return base64OfBytes(new TextEncoder().encode(text));
  }

  async function putFile(path, base64, message) {
    var cfg = readConfig();
    var encoded = path.split('/').map(encodeURIComponent).join('/');
    var existing = await api('/contents/' + encoded + '?ref=' + encodeURIComponent(cfg.branch));

    var body = { message: message, content: base64, branch: cfg.branch };
    if (existing && existing.sha) body.sha = existing.sha;

    await api('/contents/' + encoded, { method: 'PUT', body: body });
  }

  btnPublish.addEventListener('click', async function () {
    if (!queue.length) return;

    var cfg;
    try { cfg = readConfig(); } catch (err) { say(err.message, true); return; }

    btnPublish.disabled = true;
    var added = [];

    try {
      // 先按当前队列算出文件名，但先不提交到本地，失败时页面不会出现"假照片"
      var names = nextNames();

      for (var i = 0; i < queue.length; i++) {
        say('上传照片 ' + (i + 1) + ' / ' + queue.length + ' ……');
        var base64 = await base64Of(queue[i].blob);
        await putFile('images/' + names[i], base64, '加照片：' + names[i]);
        added.push(names[i]);
      }

      say('正在更新 photos.js ……');
      var nextList = PHOTOS.concat(queue.map(function (item, i) {
        return { src: 'images/' + names[i], title: item.title.trim() || names[i] };
      }));

      var fileText = buildPhotosFileFor(nextList);
      var fileB64 = base64OfText(fileText);
      await putFile('photos.js', fileB64, '更新照片列表');

      // 提交成功后，才更新本地页面
      commitLocal();

      say('✅ 已发布 ' + added.length + ' 张。GitHub Pages 大约 1 分钟后更新，' +
        '刷新 https://' + cfg.owner + '.github.io/' + cfg.repo + '/ 就能看到。');
    } catch (err) {
      say('发布失败：' + err.message + '。已经传上去的照片不会丢，' +
        '可以点「复制 photos.js」手动补上列表。', true);
      btnPublish.disabled = false;
    }
  });

  function buildPhotosFileFor(list) {
    var head = [
      '/* =========================================================',
      '   照片墙数据 —— 由「加照片」面板生成',
      '   最近更新：' + new Date().toLocaleString('zh-CN'),
      '   ========================================================= */',
      '',
      'const PHOTOS = ['
    ].join('\n');

    var body = list.map(function (p) {
      return '  { src: ' + JSON.stringify(p.src) + ', title: ' + JSON.stringify(p.title) + ' },';
    }).join('\n');

    return head + '\n' + body + '\n];\n';
  }

  /* ---------------- 初始状态 ---------------- */

  refreshLabels();
})();
