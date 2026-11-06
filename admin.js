/* =========================================================
   119 宿舍 · 「管理」面板（照片 + 成员）
   ---------------------------------------------------------
   照片：在你自己的浏览器里压到长边 1600px，生成 photos.js 或直接发布
   成员：改名字、身份、一句话介绍，生成 members.js 或直接发布
   所有处理都在本地完成，不上传任何东西。
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

  var tabPhotos = $('#tab-photos');
  var tabMembers = $('#tab-members');
  var tabText = $('#tab-text');
  var panePhotos = $('#pane-photos');
  var paneMembers = $('#pane-members');
  var paneText = $('#pane-text');
  var memberEditor = $('#member-editor');
  var btnAddMember = $('#btn-add-member');
  var btnMembersCopy = $('#btn-members-copy');
  var btnMembersPublish = $('#btn-members-publish');
  var memberMsgEl = $('#member-msg');

  var textForm = $('#text-form');
  var btnTextPublish = $('#btn-text-publish');
  var textMsgEl = $('#text-msg');
  var bgInput = $('#bg-input');
  var bgPreview = $('#bg-preview');
  var bgClear = $('#bg-clear');
  var bgNote = $('#bg-note');
  var bgBlob = null;
  var bgUrl = null;

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
    if (msgEl.scrollIntoView) msgEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

  // 缺 Token 时，把底部的配置区展开并滚到眼前
  function revealConfig() {
    var box = document.getElementById('gh-config');
    if (!box) return;
    box.open = true;
    if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------------- 本机草稿（刷新 / 关页面都不丢） ---------------- */

  var DRAFT_KEY = 'dorm119-draft-v1';
  var saveTimer = null;

  function setDraftFlag(on) {
    var flag = document.getElementById('draft-flag');
    if (flag) flag.hidden = !on;
  }

  function saveDraft() {
    setDraftFlag(true);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          v: 1,
          savedAt: new Date().toISOString(),
          content: CONTENT,
          members: typeof MEMBERS === 'undefined' ? [] : MEMBERS,
        }));
      } catch (e) { /* 存不下就算了，不影响编辑 */ }
    }, 400);
  }

  function clearDraft() {
    if (saveTimer) clearTimeout(saveTimer);
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    setDraftFlag(false);
  }

  function hasDraft() {
    try { return !!localStorage.getItem(DRAFT_KEY); } catch (e) { return false; }
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  function openPanel() {
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    document.body.classList.add('no-scroll');
    if (closeBtn) closeBtn.focus();
    loadConfig();
    renderMemberEditor();
    buildTextForm();
    refreshBg();
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

  async function compress(file, maxEdge, quality) {
    var edge = maxEdge || MAX_EDGE;
    var q = quality || QUALITY;
    var url = URL.createObjectURL(file);
    try {
      var img = await loadImage(url);
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      if (!w || !h) throw new Error('图片尺寸异常');

      var scale = Math.min(1, edge / Math.max(w, h));
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
        canvas.toBlob(function (b) { resolve(b); }, 'image/jpeg', q);
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
      if (String(err.message).indexOf('Token') >= 0) revealConfig();
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

  /* ---------------- 标签页 ---------------- */

  function switchTab(name) {
    var tabs = [
      { key: 'photos', tab: tabPhotos, pane: panePhotos },
      { key: 'members', tab: tabMembers, pane: paneMembers },
      { key: 'text', tab: tabText, pane: paneText }
    ];

    tabs.forEach(function (item) {
      var active = item.key === name;
      if (item.tab) {
        item.tab.classList.toggle('is-active', active);
        item.tab.setAttribute('aria-selected', String(active));
      }
      if (item.pane) item.pane.hidden = !active;
    });
  }

  if (tabPhotos) tabPhotos.addEventListener('click', function () { switchTab('photos'); });
  if (tabMembers) tabMembers.addEventListener('click', function () { switchTab('members'); });
  if (tabText) tabText.addEventListener('click', function () { switchTab('text'); });

  /* ---------------- 成员编辑 ---------------- */

  function sayMember(text, isError) {
    if (!memberMsgEl) return;
    memberMsgEl.hidden = false;
    memberMsgEl.textContent = text;
    memberMsgEl.classList.toggle('is-error', !!isError);
    if (memberMsgEl.scrollIntoView) memberMsgEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function refreshMembers() {
    if (typeof window.renderMembers === 'function') window.renderMembers();
    if (btnMembersPublish) {
      btnMembersPublish.disabled = !(typeof MEMBERS !== 'undefined' && MEMBERS.length);
    }
  }

  function memberField(person, key, label, placeholder, className) {
    var input = document.createElement('input');
    input.type = 'text';
    input.className = className || '';
    input.value = person[key] || '';
    input.placeholder = placeholder || '';
    input.setAttribute('aria-label', label);
    input.addEventListener('input', function () {
      person[key] = input.value;
      refreshMembers();
      saveDraft();
    });
    return input;
  }

  function buildMemberRow(person, index) {
    var li = document.createElement('li');
    li.className = 'member-row';

    var head = document.createElement('div');
    head.className = 'mr-head';

    var avatar = memberField(person, 'avatar', '头像字', '字', 'mr-avatar');
    avatar.maxLength = 2;

    var name = memberField(person, 'name', '姓名', '姓名');

    var tools = document.createElement('div');
    tools.className = 'mr-tools';

    var up = document.createElement('button');
    up.type = 'button';
    up.className = 'mr-btn';
    up.textContent = '↑';
    up.title = '上移';
    up.addEventListener('click', function () {
      if (index === 0) return;
      var tmp = MEMBERS[index - 1];
      MEMBERS[index - 1] = MEMBERS[index];
      MEMBERS[index] = tmp;
      renderMemberEditor();
      refreshMembers();
      saveDraft();
    });

    var down = document.createElement('button');
    down.type = 'button';
    down.className = 'mr-btn';
    down.textContent = '↓';
    down.title = '下移';
    down.addEventListener('click', function () {
      if (index >= MEMBERS.length - 1) return;
      var tmp = MEMBERS[index + 1];
      MEMBERS[index + 1] = MEMBERS[index];
      MEMBERS[index] = tmp;
      renderMemberEditor();
      refreshMembers();
      saveDraft();
    });

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'mr-btn mr-del';
    del.textContent = '✕';
    del.title = '删除这一位';
    del.addEventListener('click', function () {
      MEMBERS.splice(index, 1);
      renderMemberEditor();
      refreshMembers();
      saveDraft();
      sayMember('已删除一位（还没发布，可以点「放弃未发布的改动」撤销）。');
    });

    tools.appendChild(up);
    tools.appendChild(down);
    tools.appendChild(del);
    head.appendChild(avatar);
    head.appendChild(name);
    head.appendChild(tools);

    var role = memberField(person, 'role', '身份', '身份 / 标签，比如：寝室长 · 计算机', 'mr-role');
    var note = memberField(person, 'note', '一句话介绍', '写一句关于 TA 的话', 'mr-note');

    li.appendChild(head);
    li.appendChild(role);
    li.appendChild(note);
    return li;
  }

  function renderMemberEditor() {
    if (!memberEditor) return;
    memberEditor.innerHTML = '';
    if (typeof MEMBERS === 'undefined') return;

    MEMBERS.forEach(function (person, index) {
      memberEditor.appendChild(buildMemberRow(person, index));
    });
    refreshMembers();
  }

  if (btnAddMember) {
    btnAddMember.addEventListener('click', function () {
      if (typeof MEMBERS === 'undefined') return;
      MEMBERS.push({ avatar: '', name: '', role: '119 成员', note: '' });
      renderMemberEditor();
      saveDraft();
      var rows = memberEditor.querySelectorAll('.member-row');
      var last = rows[rows.length - 1];
      if (last) {
        var inputs = last.querySelectorAll('input[type="text"]');
        if (inputs[1]) inputs[1].focus();
      }
    });
  }

  function buildMembersFile() {
    var head = [
      '/* =========================================================',
      '   成员信息 —— 由「管理」面板生成',
      '   最近更新：' + new Date().toLocaleString('zh-CN'),
      '   ========================================================= */',
      '',
      'const MEMBERS = ['
    ].join('\n');

    var body = MEMBERS.map(function (m) {
      return '  { avatar: ' + JSON.stringify(m.avatar || '') +
        ', name: ' + JSON.stringify(m.name || '') +
        ', role: ' + JSON.stringify(m.role || '') +
        ', note: ' + JSON.stringify(m.note || '') + ' },';
    }).join('\n');

    return head + '\n' + body + '\n];\n';
  }

  if (btnMembersCopy) {
    btnMembersCopy.addEventListener('click', async function () {
      try {
        await copyText(buildMembersFile());
        sayMember('已复制 members.js 的全部内容，粘到仓库同名文件里即可。');
      } catch (err) {
        sayMember('复制被浏览器拦了，可以手动编辑 members.js。', true);
      }
    });
  }

  if (btnMembersPublish) {
    btnMembersPublish.addEventListener('click', async function () {
      if (typeof MEMBERS === 'undefined' || !MEMBERS.length) return;
      btnMembersPublish.disabled = true;
      sayMember('正在发布成员信息 ……');
      try {
        await putFile('members.js', base64OfText(buildMembersFile()), '更新成员信息');
        clearDraft();
        sayMember('已发布，约 1 分钟后生效。');
      } catch (err) {
        sayMember('发布失败：' + err.message, true);
        if (String(err.message).indexOf('Token') >= 0) revealConfig();
        btnMembersPublish.disabled = false;
      }
    });
  }

  /* ---------------- 文字与背景 ---------------- */

  var TEXT_SCHEMA = [
    { legend: '站名', fields: [
      { path: 'siteName', label: '宿舍名（导航、页脚、浏览器标题都用它）' },
    ] },
    { legend: '首屏', fields: [
      { path: 'hero.kicker', label: '小字（年级 / 楼栋）' },
      { path: 'hero.title', label: '主标题（回车换行）', area: true },
      { path: 'hero.lead', label: '介绍文字', area: true },
    ] },
    { legend: '关于', fields: [
      { path: 'about.title', label: '小标题' },
      { path: 'about.headline', label: '那句话', area: true },
      { path: 'about.text', label: '正文', area: true },
    ] },
    { legend: '区块标题', fields: [
      { path: 'members.title', label: '成员区标题' },
      { path: 'members.sub', label: '成员区副标题', area: true },
      { path: 'gallery.title', label: '照片墙标题' },
      { path: 'gallery.sub', label: '照片墙副标题', area: true },
      { path: 'moments.title', label: '日常标题' },
    ] },
    { legend: '页脚', fields: [
      { path: 'footer.note', label: '第一行（{year} 会变成年份）', area: true },
      { path: 'footer.small', label: '第二行', area: true },
    ] },
  ];

  function getPath(obj, path) {
    return path.split('.').reduce(function (acc, key) {
      return acc == null ? undefined : acc[key];
    }, obj);
  }

  function setPath(obj, path, value) {
    var keys = path.split('.');
    var cur = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }

  function refreshSite() {
    saveDraft();
    if (typeof window.applyContent === 'function') window.applyContent();
  }

  function sayText(text, isError) {
    if (!textMsgEl) return;
    textMsgEl.hidden = false;
    textMsgEl.textContent = text;
    textMsgEl.classList.toggle('is-error', !!isError);
    if (textMsgEl.scrollIntoView) textMsgEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function smallButton(text, title, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mr-btn';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function makeFieldset(title) {
    var fs = document.createElement('fieldset');
    fs.className = 'tf-group';
    var legend = document.createElement('legend');
    legend.textContent = title;
    fs.appendChild(legend);
    return fs;
  }

  function buildTextField(spec) {
    var wrap = document.createElement('label');
    wrap.className = 'tf';

    var label = document.createElement('span');
    label.textContent = spec.label;

    var input = document.createElement(spec.area ? 'textarea' : 'input');
    if (spec.area) input.rows = 2;
    else input.type = 'text';
    input.value = getPath(CONTENT, spec.path) || '';

    input.addEventListener('input', function () {
      setPath(CONTENT, spec.path, input.value);
      refreshSite();
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function moveItem(list, index, delta) {
    var target = index + delta;
    if (target < 0 || target >= list.length) return false;
    var tmp = list[target];
    list[target] = list[index];
    list[index] = tmp;
    return true;
  }

  function buildStatRow(item, index) {
    var row = document.createElement('div');
    row.className = 'tf-row';

    var value = document.createElement('input');
    value.type = 'text';
    value.placeholder = '320+';
    value.value = item.value || '';
    value.addEventListener('input', function () { item.value = value.value; refreshSite(); });

    var label = document.createElement('input');
    label.type = 'text';
    label.placeholder = '顿一起吃的饭';
    label.value = item.label || '';
    label.addEventListener('input', function () { item.label = label.value; refreshSite(); });

    var tools = document.createElement('div');
    tools.className = 'mr-tools';
    tools.appendChild(smallButton('↑', '上移', function () {
      if (moveItem(CONTENT.stats, index, -1)) { buildTextForm(); refreshSite(); }
    }));
    tools.appendChild(smallButton('↓', '下移', function () {
      if (moveItem(CONTENT.stats, index, 1)) { buildTextForm(); refreshSite(); }
    }));
    tools.appendChild(smallButton('✕', '删除', function () {
      CONTENT.stats.splice(index, 1);
      buildTextForm();
      refreshSite();
    }));

    row.appendChild(value);
    row.appendChild(label);
    row.appendChild(tools);
    return row;
  }

  function buildMomentRow(item, index) {
    var row = document.createElement('div');
    row.className = 'tf-row tf-row--col';

    var top = document.createElement('div');
    top.className = 'tf-row';

    var time = document.createElement('input');
    time.type = 'text';
    time.placeholder = '2023.09';
    time.className = 'tf-time';
    time.value = item.time || '';
    time.addEventListener('input', function () { item.time = time.value; refreshSite(); });

    var title = document.createElement('input');
    title.type = 'text';
    title.placeholder = '搬进 119';
    title.value = item.title || '';
    title.addEventListener('input', function () { item.title = title.value; refreshSite(); });

    var tools = document.createElement('div');
    tools.className = 'mr-tools';
    tools.appendChild(smallButton('↑', '上移', function () {
      if (moveItem(CONTENT.moments.items, index, -1)) { buildTextForm(); refreshSite(); }
    }));
    tools.appendChild(smallButton('↓', '下移', function () {
      if (moveItem(CONTENT.moments.items, index, 1)) { buildTextForm(); refreshSite(); }
    }));
    tools.appendChild(smallButton('✕', '删除', function () {
      CONTENT.moments.items.splice(index, 1);
      buildTextForm();
      refreshSite();
    }));

    top.appendChild(time);
    top.appendChild(title);
    top.appendChild(tools);

    var text = document.createElement('textarea');
    text.rows = 2;
    text.placeholder = '那天发生了什么';
    text.value = item.text || '';
    text.addEventListener('input', function () { item.text = text.value; refreshSite(); });

    row.appendChild(top);
    row.appendChild(text);
    return row;
  }

  function buildTextForm() {
    if (!textForm || typeof CONTENT === 'undefined') return;
    textForm.innerHTML = '';

    TEXT_SCHEMA.forEach(function (group) {
      var fs = makeFieldset(group.legend);
      group.fields.forEach(function (spec) { fs.appendChild(buildTextField(spec)); });
      textForm.appendChild(fs);
    });

    // 首屏小标签
    var chipsBox = makeFieldset('首屏小标签');
    CONTENT.chips = CONTENT.chips || [];
    CONTENT.chips.forEach(function (text, index) {
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'tf-line';
      input.value = text;
      input.addEventListener('input', function () {
        CONTENT.chips[index] = input.value;
        refreshSite();
      });
      chipsBox.appendChild(input);
    });
    textForm.appendChild(chipsBox);

    // 数字
    var statsBox = makeFieldset('关于区那三块数字');
    CONTENT.stats = CONTENT.stats || [];
    CONTENT.stats.forEach(function (item, index) {
      statsBox.appendChild(buildStatRow(item, index));
    });
    var addStat = document.createElement('button');
    addStat.type = 'button';
    addStat.className = 'btn ghost tf-add';
    addStat.textContent = '＋ 再加一块数字';
    addStat.addEventListener('click', function () {
      CONTENT.stats.push({ value: '', label: '' });
      buildTextForm();
      refreshSite();
    });
    statsBox.appendChild(addStat);
    textForm.appendChild(statsBox);

    // 日常时间线
    var momentsBox = makeFieldset('日常时间线');
    CONTENT.moments = CONTENT.moments || { title: '', items: [] };
    CONTENT.moments.items = CONTENT.moments.items || [];
    CONTENT.moments.items.forEach(function (item, index) {
      momentsBox.appendChild(buildMomentRow(item, index));
    });
    var addMoment = document.createElement('button');
    addMoment.type = 'button';
    addMoment.className = 'btn ghost tf-add';
    addMoment.textContent = '＋ 再加一条日常';
    addMoment.addEventListener('click', function () {
      CONTENT.moments.items.push({ time: '', title: '', text: '' });
      buildTextForm();
      refreshSite();
    });
    momentsBox.appendChild(addMoment);
    textForm.appendChild(momentsBox);
  }

  /* ---------------- 背景图 ---------------- */

  function refreshBg() {
    if (!bgPreview) return;

    if (CONTENT.background) {
      bgPreview.src = CONTENT.background;
      bgPreview.hidden = false;
      if (bgClear) bgClear.disabled = false;
      if (bgNote) {
        bgNote.textContent = bgBlob
          ? '新背景还没发布，点下面「发布文字与背景」才会生效。'
          : '当前背景已生效（' + CONTENT.background.split('/').pop() + '）。';
      }
    } else {
      bgPreview.hidden = true;
      if (bgClear) bgClear.disabled = true;
      if (bgNote) bgNote.textContent = '还没设置背景，现在用的是纯色。';
    }
  }

  if (bgInput) {
    bgInput.addEventListener('change', async function () {
      var file = bgInput.files && bgInput.files[0];
      bgInput.value = '';
      if (!file) return;

      try {
        sayText('正在处理背景图 ……');
        var blob = await compress(file, 2200, 0.8);

        if (bgUrl) URL.revokeObjectURL(bgUrl);
        bgBlob = blob;
        bgUrl = URL.createObjectURL(blob);
        CONTENT.background = bgUrl;

        refreshSite();
        refreshBg();
        sayText('背景已换（只在本机）。点「发布文字与背景」让所有人看到。');
      } catch (err) {
        sayText('这张图用不了：' + err.message, true);
      }
    });
  }

  if (bgClear) {
    bgClear.addEventListener('click', function () {
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      bgUrl = null;
      bgBlob = null;
      CONTENT.background = '';
      refreshSite();
      refreshBg();
      sayText('背景已去掉（还没发布）。');
    });
  }

  function buildContentFile() {
    var data = JSON.parse(JSON.stringify(CONTENT));
    if (data.background && data.background.indexOf('blob:') === 0) data.background = '';

    var head = '/* =========================================================\n' +
      '   站点文字 —— 由「管理」面板生成\n' +
      '   最近更新：' + new Date().toLocaleString('zh-CN') + '\n' +
      '   ========================================================= */\n\n';

    return head + 'const CONTENT = ' + JSON.stringify(data, null, 2) + ';\n';
  }

  var btnTextCopy = $('#btn-text-copy');
  if (btnTextCopy) {
    btnTextCopy.addEventListener('click', async function () {
      try {
        await copyText(buildContentFile());
        sayText('已复制 content.js 的全部内容，粘到仓库同名文件里即可。');
      } catch (err) {
        sayText('复制被浏览器拦了，可以手动编辑 content.js。', true);
      }
    });
  }

  if (btnTextPublish) {
    btnTextPublish.addEventListener('click', async function () {
      btnTextPublish.disabled = true;
      try {
        if (bgBlob) {
          sayText('正在上传背景图 ……');
          var name = 'images/bg-' + Date.now() + '.jpg';
          await putFile(name, await base64Of(bgBlob), '更新背景图');
          CONTENT.background = name;
          bgBlob = null;
          refreshBg();
        }

        sayText('正在发布文字 ……');
        await putFile('content.js', base64OfText(buildContentFile()), '更新站点文字');
        clearDraft();
        sayText('已发布，约 1 分钟后生效。');
      } catch (err) {
        sayText('发布失败：' + err.message, true);
        if (String(err.message).indexOf('Token') >= 0) revealConfig();
      }
      btnTextPublish.disabled = false;
    });
  }

  /* ---------------- 放弃改动 ---------------- */

  var btnDiscard = $('#btn-discard');
  if (btnDiscard) {
    btnDiscard.addEventListener('click', function () {
      if (!window.confirm('放弃所有未发布的改动？页面会重新加载成线上版本。')) return;
      clearDraft();
      window.location.reload();
    });
  }

  /* ---------------- 初始状态 ---------------- */

  refreshLabels();
  renderMemberEditor();
  buildTextForm();
  refreshBg();
  setDraftFlag(hasDraft());
})();
