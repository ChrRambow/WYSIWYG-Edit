/*
 * WYSIWYG Edit - the editor.
 *
 * Two copies of the page are kept:
 *
 *  - The *source copy* (state.src) is the page parsed without running any
 *    script. It is what gets saved. Every element in its <body> carries a
 *    data-wse-id marker, and its <script> elements are inert placeholders
 *    whose original text is put back byte for byte on save.
 *
 *  - The *live view* is an iframe that shows the source copy served from
 *    the local server with all scripts running, so the page looks and
 *    behaves exactly like the real site (sliders, menus, animations...).
 *
 * The user points at elements in the live view; the data-wse-id markers tell
 * which source element they are. Text, attribute and style changes are made
 * in both copies at once. Structural changes (move, insert, delete...) are
 * made in the source copy and the live view is rebuilt from it in a second,
 * hidden iframe that is swapped in when ready, so the page never flickers.
 * Anything the site's scripts add or change is never saved.
 *
 * On save, everything outside <body> (doctype, <head>, comments) is taken
 * from the original file unchanged; the only addition is one <style> block
 * in the <head> with the styles changed in the editor.
 */
(function () {
  'use strict';

  var S = window.WSEStyles;
  var ID = 'data-wse-id';

  // ------------------------------------------------------------ helpers

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ic');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function api(path, body, raw) {
    var opts = { headers: { 'X-WSE': '1' } };
    if (body !== undefined) {
      opts.method = 'POST';
      if (raw) {
        opts.body = body;
      } else {
        opts.body = JSON.stringify(body);
        opts.headers['Content-Type'] = 'application/json';
      }
    }
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
      });
    });
  }

  var toastTimer;
  function toast(msg, isError, action) {
    var box = $('#toast');
    $('#toast-text').textContent = msg;
    var btn = $('#toast-action');
    btn.hidden = !action;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = function () { box.hidden = true; action.run(); };
    }
    box.className = 'toast' + (isError ? ' error' : '');
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, isError || action ? 8000 : 3500);
  }

  function fail(err) {
    console.error(err);
    toast(t('error', { msg: err.message || err }), true);
  }

  function dirname(path) {
    var i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
  }

  /* Path of a site file as seen from the current page (e.g. "../images/a.png"). */
  function relFromPage(sitePath) {
    var from = dirname(state.page).split('/').filter(Boolean);
    var to = sitePath.split('/');
    var i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
    var up = from.slice(i).map(function () { return '..'; });
    return up.concat(to.slice(i)).join('/');
  }

  function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  function rgbToHex(value) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value || '');
    if (!m) return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
    return '#' + [m[1], m[2], m[3]].map(function (n) { return ('0' + (+n).toString(16)).slice(-2); }).join('');
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function applyI18n(root) {
    $$('[data-i18n]', root).forEach(function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
    $$('[data-i18n-title]', root).forEach(function (n) { n.title = t(n.getAttribute('data-i18n-title')); });
  }

  // ------------------------------------------------------------ state

  var state = {
    site: null,          // { root, name, pages, images }
    page: null,          // path of the page being edited, relative to the site
    prefix: '',          // original source up to and including <body ...>
    suffix: '',          // original source from </body> to the end
    scripts: [],         // original <script> elements, by placeholder index
    dropScripts: {},     // placeholder indexes that live outside <body> in the source
    wholeDoc: false,     // the page has no <body> tag; save the whole document
    src: null,           // the source copy (see top of file)
    nextId: 1,
    frame: null,         // the iframe currently shown
    doc: null,           // ... its document and window
    win: null,
    styleEl: null,       // <style id="wysiwyg-edit-styles"> in the live view
    model: S.create(),   // the styles changed in the editor
    device: 'desktop',
    selected: null,      // selected element in the live view
    selectedId: null,
    hovered: null,
    editing: null,
    target: 'self',      // "self" or a class name the style panel applies to
    interact: false,     // clicks go to the page (menus, sliders) instead of selecting
    history: [],
    hIndex: -1,
    savedKey: ''
  };

  var frames = [$('#frame-a'), $('#frame-b')];
  state.frame = frames[0];

  // ------------------------------------------------------------ ids: live view <-> source copy

  function idOf(node) {
    return node && node.nodeType === 1 ? node.getAttribute(ID) : null;
  }

  function srcById(id) {
    return id ? state.src.querySelector('[' + ID + '="' + id + '"]') : null;
  }

  function liveById(id) {
    return id && state.doc ? state.doc.querySelector('[' + ID + '="' + id + '"]') : null;
  }

  /* The source element for an element of the live view. */
  function twin(live) {
    if (!live) return null;
    if (state.doc && live === state.doc.body) return state.src.body;
    var id = idOf(live);
    if (id) return srcById(id);
    var sidx = live.tagName === 'SCRIPT' ? live.getAttribute('data-wse-sidx') : null;
    return sidx !== null ? state.src.querySelector('script[data-wse-idx="' + sidx + '"]') : null;
  }

  function newId(node) {
    var id = String(state.nextId++);
    node.setAttribute(ID, id);
    return id;
  }

  function isPlaceholder(node) {
    return node.tagName === 'SCRIPT' && node.getAttribute('type') === 'text/x-wse-off';
  }

  /* Give every element below (and including) root a data-wse-id. */
  function annotate(root) {
    var list = root.nodeType === 1 ? [root].concat($$('*', root)) : $$('*', root);
    list.forEach(function (n) {
      if (isPlaceholder(n)) return;
      if (n.getAttribute(ID)) {
        var m = +n.getAttribute(ID);
        if (m >= state.nextId) state.nextId = m + 1;
      } else {
        newId(n);
      }
    });
  }

  function placeholder(idx) {
    var p = state.src.createElement('script');
    p.setAttribute('type', 'text/x-wse-off');
    p.setAttribute('data-wse-idx', String(idx));
    return p;
  }

  function stripIds(html) {
    return html.replace(/ data-wse-id="\d+"/g, '');
  }

  /* Insert into the source copy, keeping each element on its own line. */
  function srcInsert(parent, node, before) {
    if (before && before.nodeType === 3 && !before.nodeValue.trim()) before = before.nextSibling;
    parent.insertBefore(node, before || null);
    var prev = node.previousSibling;
    if (prev && prev.nodeType === 3 && !prev.nodeValue.trim() && /\n/.test(prev.nodeValue)) {
      parent.insertBefore(state.src.createTextNode(prev.nodeValue), node.nextSibling);
    }
  }

  function srcRemove(node) {
    var prev = node.previousSibling;
    if (prev && prev.nodeType === 3 && !prev.nodeValue.trim() && node.nextSibling) prev.remove();
    node.remove();
  }

  /* The source element to insert before, for a "before" node of the live view. */
  function srcBefore(liveBefore, srcParent) {
    for (var n = liveBefore; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      var t = twin(n);
      if (t && t.parentNode === srcParent) return t;
    }
    return null;
  }

  /* Set an attribute in both copies (value null removes it). */
  function setAttr(live, name, value) {
    [live, twin(live)].forEach(function (n) {
      if (!n) return;
      if (value === null || value === undefined) n.removeAttribute(name);
      else n.setAttribute(name, value);
    });
    rebase(live, name, value);
  }

  function classesOf(live) {
    var s = twin(live) || live;
    return Array.prototype.slice.call(s.classList);
  }

  /*
   * Copy the content of a live element into its source element. Elements are
   * matched by id; elements without id were made by the editing itself (kept,
   * keepNew says which) or by the site's scripts (left out).
   */
  function poolOf(srcRoot) {
    var pool = { ids: {}, used: {} };
    if (srcRoot) $$('[' + ID + ']', srcRoot).forEach(function (n) { pool.ids[n.getAttribute(ID)] = n; });
    return pool;
  }

  function convert(c, pool, keepNew) {
    if (c.nodeType === 3) return state.src.createTextNode(c.nodeValue);
    if (c.nodeType === 8) return state.src.createComment(c.nodeValue);
    if (c.nodeType !== 1) return null;
    if (c.tagName === 'SCRIPT') {
      var sidx = c.getAttribute('data-wse-sidx') || (isPlaceholder(c) ? c.getAttribute('data-wse-idx') : null);
      if (sidx !== null) return placeholder(sidx);
      return keepNew(c) ? state.src.importNode(c, true) : null;
    }
    var id = c.getAttribute(ID);
    var s;
    if (id && pool.ids[id] && !pool.used[id]) {
      pool.used[id] = true;
      s = pool.ids[id].cloneNode(false);
    } else if (id || keepNew(c)) {
      s = state.src.importNode(c, false);
      s.removeAttribute('contenteditable');
      c.setAttribute(ID, newId(s));
    } else {
      return null; // made by a script of the site
    }
    syncChildren(c, s, pool, keepNew);
    return s;
  }

  function syncChildren(live, src, pool, keepNew) {
    while (src.firstChild) src.removeChild(src.firstChild);
    Array.prototype.forEach.call(live.childNodes, function (c) {
      var s = convert(c, pool, keepNew);
      if (s) src.appendChild(s);
    });
  }

  // ------------------------------------------------------------ start screen

  function showStart(error) {
    $('#app').hidden = true;
    $('#new-site').hidden = true;
    $('#start').hidden = false;
    var err = $('#start-error');
    err.hidden = !error;
    err.textContent = error ? t('error', { msg: error }) : '';
    api('/api/state').then(function (data) {
      var list = $('#recent');
      list.innerHTML = '';
      (data.recent || []).forEach(function (path) {
        var name = path.replace(/[\/\\]+$/, '').split(/[\/\\]/).pop();
        list.appendChild(el('li', {}, [el('button', { 'class': 'recent-item', title: path, onclick: function () { openFolder(path); } },
          [icon('folder'), el('b', { text: name }), el('span', { text: path })])]));
      });
      $('#recent-wrap').hidden = !(data.recent || []).length;
      state.platform = data.platform;
    }).catch(fail);
  }

  function openFolder(path) {
    api('/api/open', { path: path }).then(openSite, function (e) { showStart(e.message); });
  }

  $('#choose-folder').addEventListener('click', function () {
    if (state.platform !== 'darwin') { $('#path-input').focus(); return; } // the folder dialog needs macOS
    api('/api/choose-folder', {}).then(function (data) {
      if (!data.cancelled) openSite(data);
    }, function (e) { showStart(e.message); });
  });

  $('#path-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var path = $('#path-input').value.trim();
    if (path) openFolder(path);
  });

  $('#btn-folder').addEventListener('click', function () {
    if (isDirty() && !confirm(t('unsavedSwitch'))) return;
    state.savedKey = currentKey();
    showStart();
  });

  function openSite(data) {
    state.site = data;
    $('#start').hidden = true;
    $('#new-site').hidden = true;
    $('#app').hidden = false;
    $('#site-name').textContent = data.name;
    fillPages(data);
    if (!data.pages.length) {
      showStart(data.root + ': no .html files');
      return;
    }
    loadPage(data.pages[0]);
  }

  function fillPages(data) {
    var select = $('#page-select');
    select.innerHTML = '';
    data.pages.forEach(function (p) { select.appendChild(el('option', { value: p, text: p })); });
    if (state.page) select.value = state.page;
  }

  function refreshSite() {
    return api('/api/state').then(function (data) { state.site = data; return data; });
  }

  // ------------------------------------------------------------ a new website

  var NS = { template: 'business', color: WSETemplates.PALETTES[0].color, font: 'modern', width: 1280 };
  var nsTimer = null;

  /* Little pictures of the templates (120 x 80). */
  var TPL_THUMBS = {
    business: '<rect x="0" y="0" width="120" height="10" class="o"/><rect x="6" y="3" width="18" height="4" rx="2" class="f"/>' +
      '<rect x="8" y="18" width="46" height="7" rx="2" class="f"/><rect x="8" y="29" width="40" height="3" rx="1.5"/><rect x="8" y="35" width="34" height="3" rx="1.5"/>' +
      '<rect x="8" y="43" width="20" height="7" rx="3.5" class="f"/><rect x="66" y="16" width="46" height="34" rx="5" class="o"/>' +
      '<rect x="8" y="58" width="32" height="18" rx="3" class="o"/><rect x="44" y="58" width="32" height="18" rx="3" class="o"/><rect x="80" y="58" width="32" height="18" rx="3" class="o"/>',
    personal: '<rect x="0" y="0" width="120" height="10" class="o"/><rect x="6" y="3" width="18" height="4" rx="2" class="f"/>' +
      '<rect x="8" y="17" width="40" height="7" rx="2" class="f"/><rect x="8" y="28" width="46" height="3" rx="1.5"/><rect x="8" y="35" width="20" height="7" rx="3.5" class="f"/>' +
      '<rect x="66" y="15" width="46" height="30" rx="5" class="o"/>' +
      '<rect x="8" y="52" width="32" height="24" rx="3" class="o"/><rect x="44" y="52" width="32" height="24" rx="3" class="o"/><rect x="80" y="52" width="32" height="24" rx="3" class="o"/>',
    blank: '<rect x="0" y="0" width="120" height="10" class="o"/><rect x="6" y="3" width="18" height="4" rx="2" class="f"/>' +
      '<rect x="30" y="28" width="60" height="7" rx="2" class="f"/><rect x="36" y="40" width="48" height="3" rx="1.5"/>' +
      '<rect x="0" y="66" width="120" height="14" class="o"/>'
  };

  function nsLang() {
    return window.WSE_LANG === 'de' ? 'de' : 'en';
  }

  function showNewSite() {
    $('#start').hidden = true;
    $('#new-site').hidden = false;
    $('#ns-error').hidden = true;
    var name = $('#ns-name');
    if (!name.value) name.value = t('nsNameDefault');
    api('/api/state').then(function (data) {
      state.platform = data.platform;
      if (!$('#ns-parent').value) $('#ns-parent').value = data.defaultParent || '';
      $('#ns-pick').hidden = data.platform !== 'darwin';
      nsNote();
    }).catch(fail);
    renderNewSite();
    nsPreview();
    name.focus();
    name.select();
  }

  function renderNewSite() {
    var tpls = $('#ns-templates');
    tpls.innerHTML = '';
    WSETemplates.TEMPLATES.forEach(function (id) {
      tpls.appendChild(el('button', {
        type: 'button', 'class': 'ns-template' + (NS.template === id ? ' active' : ''), 'data-template': id,
        onclick: function () { NS.template = id; renderNewSite(); nsPreview(); }
      }, [el('span', { 'class': 'ns-tpl-thumb', html: '<svg viewBox="0 0 120 80">' + TPL_THUMBS[id] + '</svg>' }),
        el('b', { text: t('tpl_' + id) }), el('span', { text: t('tpl_' + id + '_hint') })]));
    });
    var colors = $('#ns-colors');
    colors.innerHTML = '';
    var known = false;
    WSETemplates.PALETTES.forEach(function (p) {
      if (p.color === NS.color) known = true;
      colors.appendChild(el('button', {
        type: 'button', 'class': 'swatch' + (NS.color === p.color ? ' active' : ''), style: 'background:' + p.color, title: p.color,
        onclick: function () { NS.color = p.color; renderNewSite(); nsPreview(); }
      }));
    });
    var custom = el('input', { type: 'color', value: NS.color, title: t('nsCustomColor'), 'class': 'swatch-input' + (known ? '' : ' active') });
    custom.addEventListener('input', function () { NS.color = custom.value; nsPreview(); });
    custom.addEventListener('change', function () { renderNewSite(); });
    colors.appendChild(el('label', { 'class': 'swatch-custom', title: t('nsCustomColor') }, [custom, el('span', { text: t('nsCustomColor') })]));
    var fonts = $('#ns-fonts');
    fonts.innerHTML = '';
    WSETemplates.FONTS.forEach(function (f) {
      fonts.appendChild(el('button', {
        type: 'button', 'class': 'ns-font' + (NS.font === f.id ? ' active' : ''),
        onclick: function () { NS.font = f.id; renderNewSite(); nsPreview(); }
      }, [el('span', { 'class': 'ns-font-sample', style: 'font-family:' + f.heading, text: 'Aa' }), el('span', { text: t('font_' + f.id) })]));
    });
  }

  function nsOptions() {
    return { template: NS.template, name: $('#ns-name').value.trim() || t('nsNameDefault'), lang: nsLang(), color: NS.color, font: NS.font };
  }

  function nsPreview() {
    clearTimeout(nsTimer);
    nsTimer = setTimeout(function () {
      $('#ns-frame').srcdoc = WSETemplates.preview(nsOptions());
      nsScale();
    }, 120);
  }

  function nsScale() {
    var stage = $('#ns-stage'), frame = $('#ns-frame');
    var scale = Math.min(1, (stage.clientWidth - 2) / NS.width);
    frame.style.width = NS.width + 'px';
    frame.style.height = Math.ceil(stage.clientHeight / scale) + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    frame.style.left = Math.max(0, (stage.clientWidth - NS.width * scale) / 2) + 'px';
  }

  function nsNote() {
    var parent = $('#ns-parent').value.trim().replace(/[\/\\]+$/, '');
    var name = $('#ns-name').value.trim();
    $('#ns-folder-note').textContent = parent && name ? t('nsFolderNote', { path: parent + '/' + name }) : '';
  }

  $('#btn-new-site').addEventListener('click', showNewSite);
  $('#ns-back').addEventListener('click', function () { showStart(); });
  $('#ns-name').addEventListener('input', function () { nsNote(); nsPreview(); });
  $('#ns-parent').addEventListener('input', nsNote);
  $('#ns-pick').addEventListener('click', function () {
    api('/api/pick-folder', {}).then(function (data) {
      if (data.path) { $('#ns-parent').value = data.path; nsNote(); }
    }).catch(fail);
  });
  $$('.ns-device').forEach(function (b) {
    b.addEventListener('click', function () {
      NS.width = +b.getAttribute('data-width');
      $$('.ns-device').forEach(function (x) { x.classList.toggle('active', x === b); });
      nsScale();
    });
  });
  window.addEventListener('resize', function () { if (!$('#new-site').hidden) nsScale(); });

  $('#ns-create').addEventListener('click', function () {
    var name = $('#ns-name').value.trim();
    var error = $('#ns-error');
    error.hidden = true;
    if (!name) { $('#ns-name').focus(); return; }
    var button = $('#ns-create'), label = button.querySelector('span');
    button.disabled = true;
    label.textContent = t('nsCreating');
    var options = nsOptions();
    options.name = name;
    api('/api/create-site', { parent: $('#ns-parent').value.trim(), name: name, files: WSETemplates.build(options) }).then(function (data) {
      $('#ns-name').value = '';
      openSite(data);
    }, function (e) {
      error.textContent = t('error', { msg: e.message });
      error.hidden = false;
    }).then(function () {
      button.disabled = false;
      label.textContent = t('nsCreate');
    });
  });

  $('#page-select').addEventListener('change', function (e) {
    if (isDirty() && !confirm(t('unsavedSwitch'))) {
      e.target.value = state.page;
      return;
    }
    loadPage(e.target.value);
  });

  // ------------------------------------------------------------ loading a page

  function loadPage(path) {
    deselect();
    state.page = path;
    state.doc = null;
    state.win = null;
    $('#page-select').value = path;
    $('#loading').hidden = false;
    api('/api/page?path=' + encodeURIComponent(path)).then(function (data) {
      splitSource(data.source, data.scripts);
      buildSource(data.source, data.scripts);
      var styleEl = state.src.getElementById(S.STYLE_ID);
      state.model = S.parse(styleEl ? styleEl.textContent : '');
      state.history = [];
      state.hIndex = -1;
      commit();
      state.savedKey = currentKey();
      updateDirty();
      render();
      findShared();
      loadDesign();
    }).catch(fail);
  }

  /* Find <body ...> and </body> in the original source (ignoring scripts). */
  function splitSource(source, scripts) {
    function inScript(pos) {
      return scripts.some(function (s) { return pos >= s.start && pos < s.end; });
    }
    var open = null, close = -1, m;
    var openRe = /<body\b[^>]*>/gi;
    while ((m = openRe.exec(source))) {
      if (!inScript(m.index)) { open = m; break; }
    }
    if (open) {
      var closeRe = /<\/body\s*>/gi;
      closeRe.lastIndex = open.index;
      while ((m = closeRe.exec(source))) {
        if (!inScript(m.index)) close = m.index;
      }
    }
    state.scripts = scripts.map(function (s) { return s.text; });
    state.dropScripts = {};
    state.entities = {};
    state.asciiOnly = false;
    state.bodyTrail = '';
    state.bareAttrs = {};
    state.wholeDoc = !open;
    if (open) {
      var bodyStart = open.index + open[0].length;
      var bodyEnd = close < 0 ? source.length : close;
      state.prefix = source.slice(0, bodyStart);
      state.suffix = source.slice(bodyEnd);
      var bodySource = source.slice(bodyStart, bodyEnd);
      state.bodyTrail = /\s*$/.exec(bodySource)[0];
      learnEntities(bodySource);
      learnBareAttributes(bodySource);
      learnTagLayout(bodySource);
      scripts.forEach(function (s, i) {
        if (s.start < bodyStart || s.start >= bodyEnd) state.dropScripts[i] = true;
      });
    }
  }

  /* Parse the page without running scripts: the source copy. */
  function buildSource(source, scripts) {
    var html = source;
    for (var i = scripts.length - 1; i >= 0; i--) {
      html = html.slice(0, scripts[i].start) + '<script type="text/x-wse-off" data-wse-idx="' + i + '"></script>' +
        html.slice(scripts[i].end);
    }
    state.src = new DOMParser().parseFromString(html, 'text/html');
    state.nextId = 1;
    annotate(state.src.body);
  }

  /*
   * The browser turns "&copy;" into "©" when it reads the page. To keep
   * unchanged text exactly as it was, remember which named entities the
   * page uses and write them back the same way. A page written only in
   * ASCII stays ASCII, so it shows correctly even without a charset.
   */
  function learnEntities(bodySource) {
    var decoder = document.createElement('textarea');
    state.entities = {};
    state.asciiOnly = !/[^\x00-\x7f]/.test(bodySource);
    (bodySource.match(/&[a-zA-Z][a-zA-Z0-9]*;/g) || []).forEach(function (ent) {
      if (/^&(amp|lt|gt|quot|apos|nbsp);$/.test(ent)) return; // the browser keeps these
      decoder.innerHTML = ent;
      var ch = decoder.value;
      if (ch !== ent && Array.from(ch).length === 1 && !state.entities[ch]) state.entities[ch] = ent;
    });
  }

  /*
   * The browser writes a bare attribute such as "data-tabs" or "defer" as
   * data-tabs="". Write those back bare: known boolean attributes always,
   * other ones when the page itself writes them bare.
   */
  var BOOLEAN_ATTRS = ('allowfullscreen async autofocus autoplay checked controls default defer disabled ' +
    'formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline ' +
    'readonly required reversed selected').split(' ');

  function learnBareAttributes(bodySource) {
    state.bareAttrs = {};
    BOOLEAN_ATTRS.forEach(function (a) { state.bareAttrs[a] = true; });
    var tagRe = /<[a-zA-Z][^\s\/>]*([^>]*)>/g, attrRe = /([^\s="'\/>]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g, m, a;
    while ((m = tagRe.exec(bodySource))) {
      attrRe.lastIndex = 0;
      while ((a = attrRe.exec(m[1]))) {
        if (!a[2]) state.bareAttrs[a[1].toLowerCase()] = true;
      }
    }
  }

  /*
   * Start tags written over several lines (or with extra spaces) in the
   * original file: remember them, so an unchanged tag is saved the same way.
   */
  function learnTagLayout(bodySource) {
    state.tagLayout = {};
    var tagRe = /<([a-zA-Z][^\s\/>]*)((?:\s+[^\s="'\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
    var attrRe = /([^\s="'\/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g, m, a;
    while ((m = tagRe.exec(bodySource))) {
      var tidy = '<' + m[1].toLowerCase(), plain = true;
      attrRe.lastIndex = 0;
      while ((a = attrRe.exec(m[2]))) {
        if (a[2] && a[2][0] !== '"') plain = false;
        tidy += ' ' + a[1].toLowerCase() + (a[2] ? '=' + a[2] : '');
      }
      tidy += '>';
      if (plain && !m[3] && tidy !== m[0]) state.tagLayout[tidy] = m[0];
    }
  }

  function keepTagLayout(html) {
    var map = state.tagLayout || {};
    if (!Object.keys(map).length) return html;
    return html.split(/(<(style|script|noscript)\b[\s\S]*?<\/\2\s*>)/i).map(function (part, i) {
      if (i % 3 === 1) return part;
      if (i % 3 === 2) return '';
      return part.replace(/<[a-zA-Z][^>]*>/g, function (tag) {
        return Object.prototype.hasOwnProperty.call(map, tag) ? map[tag] : tag;
      });
    }).join('');
  }

  function bareAttributes(html) {
    return html.split(/(<(style|script|noscript)\b[\s\S]*?<\/\2\s*>)/i).map(function (part, i) {
      if (i % 3 === 1) return part;
      if (i % 3 === 2) return '';
      return part.replace(/<[a-zA-Z][^\s\/>]*\s[^>]*>/g, function (tag) {
        return tag.replace(/ ([a-zA-Z_:][-\w:.]*)=""(?=[\s>\/])/g, function (m, name) {
          return state.bareAttrs[name.toLowerCase()] ? ' ' + name : m;
        });
      });
    }).join('');
  }

  function keepEntities(html) {
    var map = state.entities || {};
    var chars = Object.keys(map).map(function (c) { return c.replace(/[\\^\]\-]/g, '\\$&'); }).join('');
    if (!chars && !state.asciiOnly) return html;
    var re = new RegExp((chars ? '[' + chars + ']' : '') + (chars && state.asciiOnly ? '|' : '') +
      (state.asciiOnly ? '[^\\x00-\\x7f]' : ''), 'gu');
    // Leave the raw text of <style>, <script> and <noscript> alone.
    return html.split(/(<(style|script|noscript)\b[\s\S]*?<\/\2\s*>)/i).map(function (part, i) {
      if (i % 3 === 1) return part;
      if (i % 3 === 2) return '';
      return part.replace(re, function (ch) { return map[ch] || '&#' + ch.codePointAt(0) + ';'; });
    }).join('');
  }

  // ------------------------------------------------------------ the live view

  var HOOK = '<script data-wse-hook>try{parent.WSE_hook(window)}catch(e){}</script>';
  var renderSeq = 0;
  var pendingRender = null;

  /* The page as the live view shows it: source copy, real scripts, editor hook. */
  function renderHtml() {
    var css = S.serialize(state.model);
    var html;
    if (state.wholeDoc) {
      syncWholeDocStyle(css);
      html = '<!DOCTYPE html>\n' + restoreScripts(state.src.documentElement.outerHTML, true);
    } else {
      html = headWithStyles(state.prefix, css) + restoreScripts(state.src.body.innerHTML, true) + state.suffix;
    }
    // The hook runs before any script of the site, so the editor's mouse
    // handling comes first.
    var m = /<head\b[^>]*>/i.exec(html) || /<html\b[^>]*>/i.exec(html) || /<!doctype[^>]*>/i.exec(html);
    var at = m ? m.index + m[0].length : 0;
    return html.slice(0, at) + HOOK + html.slice(at);
  }

  /* Show the source copy in the live view. after() runs once it is shown. */
  function render(after) {
    var seq = ++renderSeq;
    var html = renderHtml();
    return api('/api/render', { path: state.page, html: html }).then(function () {
      if (seq !== renderSeq) return;
      var spare = state.doc ? frames[frames[0] === state.frame ? 1 : 0] : state.frame;
      pendingRender = { seq: seq, frame: spare, after: after || null, done: false };
      spare.src = '/site/' + encodePath(state.page) + '?wse-render=' + seq;
    }).catch(fail);
  }

  /* Called by the hook script at the top of every page the live view loads. */
  window.WSE_hook = function (win) {
    var frame = frames.filter(function (f) { return f.contentWindow === win; })[0];
    if (!frame) return;
    attachFrame(win);
    var swap = function () { swapIn(frame); };
    win.addEventListener('DOMContentLoaded', function () { setTimeout(swap, 1500); });
    win.addEventListener('load', swap);
  };

  function swapIn(frame) {
    var p = pendingRender;
    if (!p || p.done || p.frame !== frame) return;
    p.done = true;
    pendingRender = null;
    state.shownSeq = p.seq;
    var old = state.frame;
    var oldWin = state.doc ? state.win : null;
    var win = frame.contentWindow;
    if (oldWin) {
      try { win.scrollTo({ left: oldWin.scrollX, top: oldWin.scrollY, behavior: 'instant' }); } catch (e) { /* ignore */ }
    }
    applyDesign(frame.contentDocument);
    var base = viewBase(frame.contentDocument);
    if (oldWin) carryViewState(state.doc, frame.contentDocument, state.viewBase);
    state.viewBase = base;
    state.frame = frame;
    state.win = win;
    state.doc = frame.contentDocument;
    state.styleEl = state.doc.getElementById(S.STYLE_ID);
    if (!state.styleEl) {
      state.styleEl = state.doc.createElement('style');
      state.styleEl.id = S.STYLE_ID;
      (state.doc.head || state.doc.documentElement).appendChild(state.styleEl);
    }
    frame.classList.add('active');
    if (old !== frame) {
      // Keyboard shortcuts keep working when the page had the focus.
      if (document.activeElement === old) { try { win.focus(); } catch (e) { /* ignore */ } }
      old.classList.remove('active');
      setTimeout(function () { if (old !== state.frame) old.src = 'about:blank'; }, 100);
    }
    $('#loading').hidden = true;
    state.hovered = null;
    state.selected = liveById(state.selectedId);
    renderPanels();
    renderLayers();
    if (p.after) p.after();
  }

  /*
   * After a change the page is shown fresh, with its scripts started again.
   * What the visitor (or the scripts) had changed on the screen, such as an
   * opened menu or accordion item, stays as it was: otherwise an element
   * moved into an open menu would seem to vanish when the menu closes again.
   * Only the view changes, never the saved copy.
   */
  var VIEW_ATTRS = ['open', 'hidden', 'aria-expanded', 'aria-hidden', 'aria-selected'];

  function viewClasses(node) {
    return Array.prototype.filter.call(node.classList, function (c) { return !/^wse-/.test(c); });
  }

  /* How the page shows each element (classes and the attributes above) once its scripts started. */
  function viewBase(doc) {
    var base = {};
    $$('[' + ID + ']', doc.body).forEach(function (n) {
      var attrs = {};
      VIEW_ATTRS.forEach(function (a) { attrs[a] = n.getAttribute(a); });
      base[n.getAttribute(ID)] = { cls: viewClasses(n), attrs: attrs };
    });
    return base;
  }

  /* The editor changed an attribute in both copies: that is not a change of the view. */
  function rebase(live, name, value) {
    var b = state.viewBase && state.viewBase[idOf(live)];
    if (!b) return;
    if (name === 'class') b.cls = (value || '').split(/\s+/).filter(function (c) { return c && !/^wse-/.test(c); });
    else if (VIEW_ATTRS.indexOf(name) >= 0) b.attrs[name] = value === undefined ? null : value;
  }

  function carryViewState(oldDoc, newDoc, base) {
    try {
      if (!base || !oldDoc || !newDoc || oldDoc.location.pathname !== newDoc.location.pathname) return;
    } catch (e) { return; }
    var fresh = {};
    $$('[' + ID + ']', newDoc.body).forEach(function (n) { fresh[n.getAttribute(ID)] = n; });
    $$('[' + ID + ']', oldDoc.body).forEach(function (old) {
      var id = old.getAttribute(ID), b = base[id], now = fresh[id];
      if (!b || !now) return;
      viewClasses(old).forEach(function (c) {
        if (b.cls.indexOf(c) < 0) now.classList.add(c);
      });
      b.cls.forEach(function (c) {
        if (!old.classList.contains(c)) now.classList.remove(c);
      });
      VIEW_ATTRS.forEach(function (a) {
        var value = old.getAttribute(a);
        if (value === b.attrs[a] || value === now.getAttribute(a)) return;
        if (value === null) now.removeAttribute(a);
        else now.setAttribute(a, value);
      });
    });
  }

  function writeStyles() {
    if (state.styleEl) state.styleEl.textContent = S.serialize(state.model);
  }

  function helperCss() {
    return state.interact ? '' : 'body *{cursor:grab}[contenteditable],[contenteditable] *{outline:none;cursor:text}';
  }

  // ------------------------------------------------------------ live view events

  function attachFrame(win) {
    var doc = win.document;
    function active() { return win === state.win; }
    function editingHere(e) { return state.editing && state.editing.contains(e.target); }

    // Editor-only helper styles; they never reach the saved page.
    var helper = doc.createElement('style');
    helper.id = 'wse-helper';
    helper.textContent = helperCss();
    (doc.head || doc.documentElement).appendChild(helper);

    win.addEventListener('mousemove', function (e) { if (active()) onDragMove(e); }, true);
    win.addEventListener('mouseover', function (e) {
      if (active() && !state.interact && !drag.active) state.hovered = selectable(e.target);
    }, true);
    win.addEventListener('mouseout', function (e) {
      if (active() && !e.relatedTarget && !drag.active) state.hovered = null;
    }, true);
    win.addEventListener('mousedown', function (e) {
      if (!active() || state.interact) return;
      e.stopPropagation();
      onFrameMouseDown(e);
    }, true);
    win.addEventListener('mouseup', function (e) {
      if (!active()) return;
      onDragEnd(e);
      if (!state.interact) e.stopPropagation();
    }, true);
    // Keep the site's own scripts (sliders, swipe handlers...) from reacting while editing.
    ['pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach(function (type) {
      win.addEventListener(type, function (e) { if (active() && !state.interact) e.stopPropagation(); }, true);
    });
    win.addEventListener('click', function (e) {
      if (!active()) return;
      if (state.interact) {
        // Try menus and buttons, but stay on this page.
        var a = e.target.closest && e.target.closest('a[href]');
        var href = a ? a.getAttribute('href') : '';
        if (a && !/^(#|javascript:)/i.test(href)) e.preventDefault();
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      if (drag.justDropped) return; // the click that ends a drag keeps the moved element selected
      if (!editingHere(e)) select(selectable(e.target));
    }, true);
    win.addEventListener('dblclick', function (e) {
      if (!active() || state.interact) return;
      e.stopPropagation();
      e.preventDefault();
      onFrameDblClick(e);
    }, true);
    win.addEventListener('submit', function (e) { e.preventDefault(); }, true);
    win.addEventListener('keydown', function (e) {
      if (!active()) return;
      if (state.interact) {
        if (e.key === 'Escape') setInteract(false);
        return;
      }
      onKey(e);
      e.stopPropagation();
    }, true);
    win.addEventListener('paste', function (e) { if (active()) onPaste(e); }, true);
    win.addEventListener('dragstart', function (e) { if (active() && !state.editing) e.preventDefault(); }, true);
  }

  /* The element a click selects: the nearest element that exists in the source. */
  function selectable(node) {
    if (node && node.nodeType !== 1) node = node.parentElement;
    if (!node || !state.doc) return null;
    var body = state.doc.body;
    var svg = node.closest && node.closest('svg');
    if (svg) node = svg; // select the whole icon, not its paths
    while (node && node !== body && !node.hasAttribute(ID)) node = node.parentElement;
    if (!node || node === body || !body || !body.contains(node)) return null;
    return node;
  }

  function onFrameMouseDown(e) {
    if (state.editing && !state.editing.contains(e.target)) finishEditing();
    if (state.editing || e.button !== 0) return;
    // Pressing on an element and moving the mouse drags that element.
    var target = selectable(e.target);
    if (target) {
      e.preventDefault(); // no text selection while dragging; click and double-click still work
      beginDrag(e, { node: dragUnit(target) });
    }
  }

  /*
   * What a drag picks up: a link that is the only thing in a menu item moves
   * the whole menu item (and likewise a lone link or image in a paragraph).
   */
  var PHRASING = /^(A|SPAN|STRONG|EM|B|I|U|S|SMALL|MARK|CODE|ABBR|TIME|SUB|SUP|IMG|PICTURE|SVG|svg|LABEL|BUTTON)$/;

  /*
   * What a press on an element drags: a link alone in a list item (or the
   * link of a menu entry with a submenu) moves the whole entry, the title of
   * an accordion item moves the whole item.
   */
  function dragUnit(node) {
    for (;;) {
      var parent = node.parentElement;
      if (!parent || parent === state.doc.body || !parent.hasAttribute(ID)) break;
      if (node.tagName === 'SUMMARY' && parent.tagName === 'DETAILS') { node = parent; break; }
      if (hasText(parent) || !(PHRASING.test(node.tagName) || isInline(node))) break;
      var others = Array.prototype.filter.call(parent.children, function (c) { return c !== node && c.tagName !== 'SCRIPT'; });
      var menuEntry = parent.tagName === 'LI' && parent.firstElementChild === node &&
        others.every(function (c) { return /^(UL|OL)$/.test(c.tagName); });
      if (others.length && !menuEntry) break;
      node = parent;
    }
    return node;
  }

  function onFrameDblClick(e) {
    var target = selectable(e.target);
    if (!target) return;
    if (target.tagName === 'IMG') {
      select(target);
      changeImage();
      return;
    }
    var text = textTarget(target);
    if (text) {
      select(text);
      startEditing(text, e);
    }
  }

  function onPaste(e) {
    if (!state.editing) return;
    e.preventDefault();
    var text = (e.clipboardData || state.win.clipboardData).getData('text/plain');
    state.doc.execCommand('insertText', false, text);
  }

  function setInteract(on) {
    if (on && state.editing) finishEditing();
    state.interact = on;
    if (on) deselect();
    $('#btn-interact').classList.toggle('on', on);
    $('#frame-wrap').classList.toggle('interact', on);
    frames.forEach(function (f) {
      var h = f.contentDocument && f.contentDocument.getElementById('wse-helper');
      if (h) h.textContent = helperCss();
    });
    updateStatus();
  }

  $('#btn-interact').addEventListener('click', function () { setInteract(!state.interact); });

  function updateStatus() {
    var chip = $('#status-chip');
    chip.textContent = state.interact ? t('interactOn') : t('scriptsOn');
    chip.className = 'status-chip' + (state.interact ? ' interact' : '');
  }

  // ------------------------------------------------------------ overlay

  function placeBox(box, node) {
    if (!node || !state.doc || !state.doc.contains(node) || state.interact) {
      box.hidden = true;
      return null;
    }
    var r = node.getBoundingClientRect();
    box.hidden = false;
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    return r;
  }

  function placeToolbar(bar, r) {
    if (!r) { bar.hidden = true; return; }
    bar.hidden = false;
    var wrap = $('#frame-wrap').getBoundingClientRect();
    var h = bar.offsetHeight || 32;
    var top = r.top - h - 6;
    if (top < 4) top = r.bottom + 6;
    if (top + h > wrap.height - 4) top = Math.max(4, r.top + 4);
    var left = Math.min(Math.max(4, r.left), Math.max(4, wrap.width - bar.offsetWidth - 4));
    bar.style.top = top + 'px';
    bar.style.left = left + 'px';
  }

  var lastHover = null;
  function tick() {
    if (state.selected && !(state.doc && state.doc.contains(state.selected))) {
      state.selected = liveById(state.selectedId);
      if (!state.selected) deselect();
    }
    var hover = state.hovered !== state.selected ? state.hovered : null;
    placeBox($('#hover-box'), hover);
    if (hover !== lastHover) {
      lastHover = hover;
      $('#hover-tag').textContent = hover ? label(hover) : '';
    }
    var r = placeBox($('#select-box'), state.selected);
    if (state.editing) {
      $('#el-toolbar').hidden = true;
      placeToolbar($('#rte-toolbar'), r);
    } else {
      $('#rte-toolbar').hidden = true;
      placeToolbar($('#el-toolbar'), drag.active ? null : r);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ------------------------------------------------------------ selection

  function label(node) {
    var tag = node.tagName.toLowerCase();
    var name = t('tag_' + tag);
    if (name === 'tag_' + tag) name = '<' + tag + '>';
    var classes = classesOf(node).filter(function (c) { return !/^wse-/.test(c); });
    if (node.id) name += ' #' + node.id;
    else if (classes[0]) name += ' .' + classes[0];
    return name;
  }

  function select(node) {
    if (state.editing && node !== state.editing) finishEditing();
    state.selected = node || null;
    state.selectedId = idOf(node);
    state.target = 'self';
    renderPanels();
    renderLayers();
  }

  function deselect() {
    if (state.editing) finishEditing();
    state.selected = null;
    state.selectedId = null;
    renderPanels();
    renderLayers();
  }

  function renderCrumbs() {
    var nav = $('#crumbs');
    nav.innerHTML = '';
    var node = state.selected;
    var chain = [];
    while (node && state.doc && node !== state.doc.body) {
      if (node.hasAttribute(ID)) chain.unshift(node);
      node = node.parentElement;
    }
    chain.forEach(function (n, i) {
      if (i) nav.appendChild(el('span', { 'class': 'crumb-sep' }, [icon('chevron')]));
      nav.appendChild(el('button', { 'class': 'crumb' + (n === state.selected ? ' current' : ''), text: label(n), onclick: function () { select(n); } }));
    });
    if (!chain.length) nav.appendChild(el('span', { 'class': 'hint', text: t('crumbsHint') }));
    var part = state.selected && sharedPartOf(state.selected);
    if (part) nav.appendChild(el('span', { 'class': 'shared-chip', title: t('sharedHint'), text: t('sharedChip', { n: part.pages.length }) }));
  }

  function renderPanels() {
    var has = !!state.selected;
    $('#empty-note').hidden = has;
    renderCrumbs();
    if (!has) {
      $('#tab-style').hidden = true;
      $('#tab-settings').hidden = true;
      $('#tab-html').hidden = true;
      return;
    }
    var tab = $('.rtab.active').getAttribute('data-tab');
    $('#tab-style').hidden = tab !== 'style';
    $('#tab-settings').hidden = tab !== 'settings';
    $('#tab-html').hidden = tab !== 'html';
    $('#tb-label').textContent = label(state.selected);
    $('#el-toolbar [data-act="edit"]').hidden = !textTarget(state.selected);
    $('#el-toolbar [data-act="image"]').hidden = state.selected.tagName !== 'IMG';
    $('#el-toolbar [data-act="toggle"]').hidden = !accordionOf(state.selected);
    refreshStylePanel();
    renderSettings();
    var s = twin(state.selected);
    $('#html-code').value = s ? restoreScripts(stripIds(s.outerHTML)) : '';
  }

  $$('.rtab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.rtab').forEach(function (x) { x.classList.toggle('active', x === tab); });
      renderPanels();
    });
  });

  $$('.ltab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.ltab').forEach(function (x) { x.classList.toggle('active', x === tab); });
      $('#ltab-add').hidden = tab.getAttribute('data-ltab') !== 'add';
      $('#ltab-layers').hidden = tab.getAttribute('data-ltab') !== 'layers';
      $('#ltab-design').hidden = tab.getAttribute('data-ltab') !== 'design';
      renderLayers();
    });
  });

  // ------------------------------------------------------------ changes to the page

  /*
   * After a structural change of the source copy: remember it for undo and
   * rebuild the live view. opts.check warns if the element ends up hidden.
   */
  function changed(selectId, opts) {
    opts = opts || {};
    if (state.editing) finishEditing();
    state.selectedId = selectId || null;
    commit();
    renderLayers();
    return render(function () {
      var node = liveById(selectId);
      if (node && opts.reveal !== false) revealNode(node, false);
      // Some pages fade elements in; look again a moment later before warning.
      if (node && opts.check) setTimeout(function () { revealNode(liveById(selectId), true); }, 400);
      if (opts.then) opts.then(node);
    });
  }

  function revealNode(node, warnIfHidden) {
    if (!node || !state.doc || !state.doc.contains(node)) return;
    var r = node.getBoundingClientRect();
    var visible = node.getClientRects().length > 0 && r.width * r.height > 0 &&
      state.win.getComputedStyle(node).visibility !== 'hidden' && visibleShare(node) > 0.25;
    if (!visible) {
      if (warnIfHidden) toast(t('droppedHidden'), true, { label: t('undo'), run: undo });
      return;
    }
    if (!warnIfHidden && (r.bottom < 0 || r.top > state.win.innerHeight)) node.scrollIntoView({ block: 'center' });
  }

  /* How much of an element is not cut off by boxes around it that hide overflow (0..1). */
  function visibleShare(node) {
    var r = node.getBoundingClientRect();
    var left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    for (var n = node.parentElement; n && n !== state.doc.body && n !== state.doc.documentElement; n = n.parentElement) {
      var cs = state.win.getComputedStyle(n);
      if (cs.display === 'contents') continue;
      if (+cs.opacity === 0) return 0;
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        var c = n.getBoundingClientRect();
        if (cs.overflowX !== 'visible') { left = Math.max(left, c.left); right = Math.min(right, c.right); }
        if (cs.overflowY !== 'visible') { top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
      }
    }
    var area = r.width * r.height;
    return area ? Math.max(0, right - left) * Math.max(0, bottom - top) / area : 0;
  }

  function newStyleClass() {
    return 'wse-' + Math.random().toString(36).slice(2, 8);
  }

  function ownClass(node) {
    return classesOf(node).filter(function (c) { return /^wse-[a-z0-9]+$/.test(c); })[0];
  }

  function srcElementSibling(s, dir) {
    var n = dir < 0 ? s.previousSibling : s.nextSibling;
    while (n && (n.nodeType !== 1 || isPlaceholder(n))) n = dir < 0 ? n.previousSibling : n.nextSibling;
    return n;
  }

  function act(name) {
    var node = state.selected;
    if (!node) return;
    var s = twin(node);
    if (name === 'parent') {
      var p = node.parentElement;
      while (p && p !== state.doc.body && !p.hasAttribute(ID)) p = p.parentElement;
      if (p && p !== state.doc.body) select(p);
      return;
    }
    if (name === 'edit') {
      var text = textTarget(node);
      if (text) { select(text); startEditing(text); }
      return;
    }
    if (name === 'image') return changeImage();
    if (name === 'toggle') return toggleAccordion(accordionOf(node));
    if (name === 'drag' || !s) return; // drag is handled on mousedown
    if (name === 'up' || name === 'down') {
      var sib = srcElementSibling(s, name === 'up' ? -1 : 1);
      if (!sib) return;
      var parent = s.parentNode;
      var before = name === 'up' ? sib : srcElementSibling(sib, 1);
      srcRemove(s);
      srcInsert(parent, s, before || (name === 'down' ? sib.nextSibling : null));
      changed(idOf(s));
      return;
    }
    if (name === 'duplicate') {
      var copy = s.cloneNode(true);
      [copy].concat($$('*', copy)).forEach(function (n) {
        n.removeAttribute('id'); // ids must stay unique
        if (n.hasAttribute(ID)) newId(n);
      });
      var own = ownClass(node);
      if (own) {
        // The copy gets its own styles, so changing one does not change the other.
        var fresh = newStyleClass();
        copy.classList.replace(own, fresh);
        var rule = state.model.rules['.' + own];
        S.DEVICES.forEach(function (d) {
          Object.keys(rule ? rule[d] : {}).forEach(function (p) { S.set(state.model, '.' + fresh, d, p, rule[d][p]); });
        });
        writeStyles();
      }
      srcInsert(s.parentNode, copy, s.nextSibling);
      changed(idOf(copy));
      return;
    }
    if (name === 'delete') {
      var next = srcElementSibling(s, 1) || srcElementSibling(s, -1);
      if (!next && s.parentNode !== state.src.body) next = s.parentNode;
      srcRemove(s);
      state.selected = null;
      changed(idOf(next), { reveal: false });
    }
  }

  /* The <details> an element is (the title of), for opening and closing it. */
  function accordionOf(node) {
    if (!node) return null;
    if (node.tagName === 'DETAILS') return node;
    if (node.tagName === 'SUMMARY' && node.parentElement && node.parentElement.tagName === 'DETAILS') return node.parentElement;
    return null;
  }

  function toggleAccordion(details) {
    if (!details) return;
    setAttr(details, 'open', details.open ? null : '');
    commit();
    renderPanels();
  }

  $$('#el-toolbar button').forEach(function (b) {
    b.addEventListener('click', function () { act(b.getAttribute('data-act')); });
  });

  // ------------------------------------------------------------ text editing

  var INLINE = /^(inline|contents)$/;

  function isInline(node) {
    return INLINE.test(state.win.getComputedStyle(node).display);
  }

  function hasText(node) {
    return Array.prototype.some.call(node.childNodes, function (c) { return c.nodeType === 3 && c.nodeValue.trim(); });
  }

  /* The element whose text should become editable for a given element. */
  function textTarget(node) {
    if (!node || /^(IMG|VIDEO|AUDIO|IFRAME|SVG|svg|HR|BR|INPUT|SELECT|TEXTAREA|SCRIPT|PICTURE|CANVAS|OBJECT|EMBED)$/.test(node.tagName)) return null;
    // Typing in a word inside a paragraph edits the whole paragraph.
    while (node.parentElement && node.parentElement !== state.doc.body && isInline(node) && node.parentElement.hasAttribute(ID)) {
      node = node.parentElement;
    }
    var blockChild = Array.prototype.some.call(node.children, function (c) {
      return !isInline(c) && c.tagName !== 'BR' && c.tagName !== 'SCRIPT';
    });
    if (hasText(node) || (!blockChild && node.textContent.trim())) return node;
    if (!blockChild && !node.children.length) return node; // empty element
    return null;
  }

  function startEditing(node, evt) {
    if (state.editing === node) return;
    if (state.editing) finishEditing();
    state.editing = node;
    state.editingAttr = node.getAttribute('contenteditable');
    // Elements without id inside were made by a script of the site: never saved.
    state.editMadeByScript = new Set($$('*', node).filter(function (n) { return !n.hasAttribute(ID); }));
    state.editPool = poolOf(twin(node));
    node.setAttribute('contenteditable', 'true');
    node.focus();
    var doc = state.doc;
    var sel = doc.getSelection();
    var range = null;
    if (evt && doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(evt.clientX, evt.clientY);
    if (!range) {
      range = doc.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    $('#frame-wrap').classList.add('typing');
  }

  function keepTyped(n) {
    return !state.editMadeByScript.has(n);
  }

  function finishEditing() {
    var node = state.editing;
    if (!node) return;
    state.editing = null;
    $('#frame-wrap').classList.remove('typing');
    if (state.editingAttr === null) node.removeAttribute('contenteditable');
    else node.setAttribute('contenteditable', state.editingAttr);
    var sel = state.doc.getSelection();
    if (sel) sel.removeAllRanges();
    var s = twin(node);
    if (s) syncChildren(node, s, state.editPool, keepTyped);
    commit();
    renderPanels();
    renderLayers();
  }

  /* Enter in a paragraph or list item starts a new one, like a word processor. */
  function splitBlock() {
    var node = state.editing;
    var doc = state.doc;
    var sel = doc.getSelection();
    if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var rest = doc.createRange();
    rest.setStart(range.endContainer, range.endOffset);
    rest.setEnd(node, node.childNodes.length);
    var fresh = doc.createElement(node.tagName);
    var classes = classesOf(node).filter(function (c) { return !/^wse-/.test(c); });
    if (classes.length) fresh.className = classes.join(' ');
    var own = ownClass(node);
    if (own) fresh.classList.add(own);
    fresh.appendChild(rest.extractContents());
    if (!fresh.textContent) fresh.innerHTML = '<br>';
    if (!node.textContent && !node.querySelector('img')) node.innerHTML = '<br>';
    node.after(fresh);
    // Put the new element into the source copy too, right after the old one.
    var srcFresh = convert(fresh, state.editPool, function () { return true; });
    var s = twin(node);
    finishEditing();
    if (s && srcFresh) srcInsert(s.parentNode, srcFresh, s.nextSibling);
    commit();
    select(fresh);
    startEditing(fresh);
    var r = doc.createRange();
    r.setStart(fresh, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  $$('#rte-toolbar button').forEach(function (b) {
    b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep the text selection
    b.addEventListener('click', function () {
      var cmd = b.getAttribute('data-cmd');
      var doc = state.doc;
      if (cmd === 'done') return finishEditing();
      if (cmd === 'createLink') {
        var sel = doc.getSelection();
        var range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        var url = prompt(t('enterUrl'), 'https://');
        if (!url || url === 'https://') return;
        state.editing.focus();
        if (range) { sel.removeAllRanges(); sel.addRange(range); }
        if (range && !range.collapsed) doc.execCommand('createLink', false, url);
        else doc.execCommand('insertHTML', false, '<a href="' + escapeHtml(url) + '">' + escapeHtml(url) + '</a>');
        return;
      }
      doc.execCommand(cmd, false, null);
    });
  });

  // ------------------------------------------------------------ images

  var imageCallback = null;

  function openImagePicker(callback) {
    imageCallback = callback;
    var grid = $('#image-grid');
    grid.innerHTML = '';
    var images = state.site.images || [];
    if (!images.length) grid.appendChild(el('p', { 'class': 'hint', text: t('noImages') }));
    images.forEach(function (path) {
      grid.appendChild(el('button', {
        'class': 'thumb', title: path,
        onclick: function () { pickImage(path); }
      }, [el('img', { src: '/site/' + encodePath(path), alt: '', loading: 'lazy' }), el('span', { text: path })]));
    });
    $('#image-dialog').showModal();
  }

  function pickImage(path) {
    $('#image-dialog').close();
    var cb = imageCallback;
    imageCallback = null;
    if (cb) cb(relFromPage(path));
  }

  function uploadFolder() {
    var images = state.site.images || [];
    var counts = {};
    images.forEach(function (p) { var d = dirname(p); counts[d] = (counts[d] || 0) + 1; });
    var best = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    return best !== undefined ? best : 'images';
  }

  $('#image-upload').addEventListener('change', function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var url = '/api/upload?dir=' + encodeURIComponent(uploadFolder()) + '&name=' + encodeURIComponent(file.name);
    api(url, file, true).then(function (res) {
      return refreshSite().then(function () { pickImage(res.path); });
    }).catch(fail);
  });

  function changeImage() {
    var node = state.selected;
    if (!node || node.tagName !== 'IMG') return;
    openImagePicker(function (src) {
      setAttr(node, 'src', src);
      setAttr(node, 'srcset', null); // the old responsive versions would win otherwise
      var pic = node.parentElement && node.parentElement.tagName === 'PICTURE' ? node.parentElement : null;
      if (pic) {
        $$('source', pic).forEach(function (srcEl) {
          var s = twin(srcEl);
          if (s) srcRemove(s);
          srcEl.remove();
        });
      }
      commit();
      renderPanels();
    });
  }

  // ------------------------------------------------------------ style panel

  var FONTS = [
    'Arial, Helvetica, sans-serif', 'Helvetica, Arial, sans-serif', 'Verdana, Geneva, sans-serif',
    'Tahoma, Geneva, sans-serif', '"Trebuchet MS", sans-serif', 'Georgia, serif',
    '"Times New Roman", Times, serif', 'Garamond, serif', '"Courier New", monospace',
    'system-ui, -apple-system, sans-serif', 'inherit'
  ];

  function opts(list) {
    return list.map(function (v) { return Array.isArray(v) ? v : [v, v]; });
  }

  var SECTIONS = [
    { title: 'secText', props: [
      { prop: 'font-family', label: 'font', type: 'font' },
      { prop: 'font-size', label: 'fontSize', type: 'unit' },
      { prop: 'font-weight', label: 'fontWeight', type: 'select', unitless: true,
        options: opts([['300', 'light 300'], ['400', 'normal 400'], ['500', 'medium 500'], ['600', 'semibold 600'], ['700', 'bold 700'], ['800', 'extra bold 800']]) },
      { prop: 'font-style', label: 'fontStyle', type: 'select', options: opts(['normal', 'italic']) },
      { prop: 'color', label: 'color', type: 'color' },
      { prop: 'text-align', label: 'textAlign', type: 'buttons',
        options: [['left', '⇤'], ['center', '↔'], ['right', '⇥'], ['justify', '☰']] },
      { prop: 'line-height', label: 'lineHeight', type: 'unit', unitless: true },
      { prop: 'letter-spacing', label: 'letterSpacing', type: 'unit' },
      { prop: 'text-transform', label: 'textTransform', type: 'select', options: opts(['none', 'uppercase', 'lowercase', 'capitalize']) },
      { prop: 'text-decoration-line', label: 'textDecoration', type: 'select', options: opts(['none', 'underline', 'line-through']) }
    ] },
    { title: 'secBackground', props: [
      { prop: 'background-color', label: 'bgColor', type: 'color' },
      { prop: 'background-image', label: 'bgImage', type: 'bgimage' },
      { prop: 'background-size', label: 'bgSize', type: 'select', options: opts(['auto', 'cover', 'contain']) },
      { prop: 'background-position', label: 'bgPosition', type: 'select',
        options: opts(['center', 'top', 'bottom', 'left', 'right']) }
    ] },
    { title: 'secSpacing', props: [
      { prop: 'margin', label: 'margin', type: 'box' },
      { prop: 'padding', label: 'padding', type: 'box' }
    ] },
    { title: 'secSize', props: [
      { prop: 'width', label: 'width', type: 'unit' },
      { prop: 'max-width', label: 'maxWidth', type: 'unit' },
      { prop: 'height', label: 'height', type: 'unit' },
      { prop: 'min-height', label: 'minHeight', type: 'unit' }
    ] },
    { title: 'secLayout', props: [
      { prop: 'display', label: 'display', type: 'select', options: opts(['block', 'inline-block', 'inline', 'flex', 'grid']) },
      { prop: 'flex-direction', label: 'flexDirection', type: 'select', options: opts(['row', 'column', 'row-reverse', 'column-reverse']) },
      { prop: 'flex-wrap', label: 'flexWrap', type: 'select', options: opts(['nowrap', 'wrap']) },
      { prop: 'justify-content', label: 'justify', type: 'select',
        options: opts(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']) },
      { prop: 'align-items', label: 'alignItems', type: 'select', options: opts(['stretch', 'flex-start', 'center', 'flex-end', 'baseline']) },
      { prop: 'gap', label: 'gap', type: 'unit' }
    ] },
    { title: 'secBorder', props: [
      { prop: 'border-width', label: 'borderWidth', type: 'unit' },
      { prop: 'border-style', label: 'borderStyle', type: 'select', options: opts(['none', 'solid', 'dashed', 'dotted', 'double']) },
      { prop: 'border-color', label: 'borderColor', type: 'color' },
      { prop: 'border-radius', label: 'borderRadius', type: 'unit' },
      { prop: 'box-shadow', label: 'shadow', type: 'select',
        options: [['none', 'none'], ['0 1px 3px rgba(0,0,0,0.2)', 'S'], ['0 4px 12px rgba(0,0,0,0.15)', 'M'], ['0 12px 32px rgba(0,0,0,0.2)', 'L']] },
      { prop: 'opacity', label: 'opacity', type: 'unit', unitless: true }
    ] }
  ];

  var SIDES = ['top', 'right', 'bottom', 'left'];
  var controls = []; // { def, set(value, placeholder), reset }

  /* The selector style changes go to. Creates the element's own class if needed. */
  function styleSelector(create) {
    var node = state.selected;
    if (!node) return null;
    if (state.target !== 'self') return '.' + CSS.escape(state.target);
    var own = ownClass(node);
    if (!own && create) {
      own = newStyleClass();
      [node, twin(node)].forEach(function (n) { if (n) n.classList.add(own); });
    }
    return own ? '.' + own : null;
  }

  function normalize(def, value) {
    value = (value || '').trim();
    if (def.type === 'unit' && /^-?\d*\.?\d+$/.test(value) && !def.unitless) value += 'px';
    return value;
  }

  function setStyle(prop, value) {
    var sel = styleSelector(!!value);
    if (!sel) return;
    S.set(state.model, sel, state.device, prop, value);
    if (!value && state.target === 'self' && !state.model.rules[sel]) {
      // No styles left: drop the helper class again.
      [state.selected, twin(state.selected)].forEach(function (n) {
        if (!n) return;
        n.classList.remove(sel.slice(1));
        if (!n.classList.length) n.removeAttribute('class');
      });
    }
    writeStyles();
    commit();
    refreshStylePanel();
  }

  function unitInput(prop, def) {
    var input = el('input', { type: 'text', 'class': 'unit', spellcheck: 'false', 'data-prop': prop });
    input.addEventListener('change', function () { setStyle(prop, normalize(def, input.value)); });
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      var m = /^(-?\d*\.?\d+)([a-z%]*)$/.exec(input.value || input.placeholder);
      if (!m) return;
      e.preventDefault();
      var step = (e.shiftKey ? 10 : 1) * (m[2] === 'em' || m[2] === 'rem' || (def.unitless && !m[2]) ? 0.1 : 1);
      var n = Math.round((parseFloat(m[1]) + (e.key === 'ArrowUp' ? step : -step)) * 100) / 100;
      input.value = n + m[2];
      setStyle(prop, normalize(def, input.value));
    });
    return input;
  }

  function buildStylePanel() {
    var root = $('#tab-style');
    root.innerHTML = '';
    root.appendChild(el('div', { 'class': 'apply-row' }, [
      el('label', { 'for': 'apply-to', text: t('applyTo') }),
      el('select', { id: 'apply-to', onchange: function (e) { state.target = e.target.value; refreshStylePanel(); } })
    ]));
    root.appendChild(el('p', { 'class': 'device-note', id: 'device-note' }));
    root.appendChild(el('label', { 'class': 'check hide-row' }, [
      el('input', { type: 'checkbox', id: 'hide-here', onchange: function (e) { setStyle('display', e.target.checked ? 'none' : ''); } }),
      el('span', { text: t('hideHere') })
    ]));

    SECTIONS.forEach(function (sec, i) {
      var details = el('details', { 'class': 'sec', open: i < 3 ? '' : null }, [
        el('summary', {}, [el('span', { text: t(sec.title) }), icon('toggle')])
      ]);
      sec.props.forEach(function (def) { details.appendChild(buildControl(def)); });
      root.appendChild(details);
    });
  }

  function buildControl(def) {
    var row = el('div', { 'class': 'prop prop-' + def.type });
    var reset = el('button', { 'class': 'reset', title: t('reset') }, [icon('x')]);
    row.appendChild(el('label', { text: t(def.label) }));
    var fieldBox = el('div', { 'class': 'field' });
    row.appendChild(fieldBox);
    row.appendChild(reset);
    var ctl = { def: def, reset: reset };
    reset.onclick = function () { setStyle(def.prop, ''); };

    if (def.type === 'unit') {
      var input = unitInput(def.prop, def);
      fieldBox.appendChild(input);
      ctl.set = function (v, ph) { input.value = v; input.placeholder = ph; };
    } else if (def.type === 'font') {
      var fin = el('input', { type: 'text', list: 'font-list', spellcheck: 'false' });
      var list = el('datalist', { id: 'font-list' }, FONTS.map(function (f) { return el('option', { value: f }); }));
      fin.addEventListener('change', function () { setStyle(def.prop, fin.value); });
      fieldBox.appendChild(fin);
      fieldBox.appendChild(list);
      ctl.set = function (v, ph) { fin.value = v; fin.placeholder = ph; };
    } else if (def.type === 'select') {
      var sel = el('select', {}, [el('option', { value: '', text: '–' })].concat(def.options.map(function (o) {
        return el('option', { value: o[0], text: o[1] });
      })));
      sel.addEventListener('change', function () { setStyle(def.prop, sel.value); });
      fieldBox.appendChild(sel);
      ctl.set = function (v, ph) {
        sel.value = v;
        sel.options[0].textContent = ph ? '– (' + ph + ')' : '–';
      };
    } else if (def.type === 'color') {
      var color = el('input', { type: 'color' });
      var text = el('input', { type: 'text', 'class': 'unit', spellcheck: 'false' });
      color.addEventListener('input', function () { text.value = color.value; });
      color.addEventListener('change', function () { setStyle(def.prop, color.value); });
      text.addEventListener('change', function () { setStyle(def.prop, text.value); });
      fieldBox.appendChild(color);
      fieldBox.appendChild(text);
      ctl.set = function (v, ph) { color.value = rgbToHex(v || ph); text.value = v; text.placeholder = ph; };
    } else if (def.type === 'buttons') {
      var btns = def.options.map(function (o) {
        var b = el('button', { 'class': 'seg', title: o[0], text: o[1], onclick: function () { setStyle(def.prop, o[0]); } });
        fieldBox.appendChild(b);
        return b;
      });
      ctl.set = function (v, ph) {
        btns.forEach(function (b, i) {
          b.classList.toggle('on', def.options[i][0] === v);
          b.classList.toggle('inherited', !v && def.options[i][0] === ph);
        });
      };
    } else if (def.type === 'bgimage') {
      var thumb = el('span', { 'class': 'bg-thumb' });
      var choose = el('button', { 'class': 'btn small', text: t('choose'), onclick: function () {
        openImagePicker(function (src) { setStyle(def.prop, 'url("' + src + '")'); });
      } });
      fieldBox.appendChild(thumb);
      fieldBox.appendChild(choose);
      ctl.set = function (v) {
        thumb.textContent = v ? decodeURIComponent(v.replace(/^url\(["']?|["']?\)$/g, '').split('/').pop()) : t('none');
      };
    } else if (def.type === 'box') {
      var inputs = SIDES.map(function (side) {
        var sub = { prop: def.prop + '-' + side, type: 'unit' };
        var inp = unitInput(sub.prop, sub);
        inp.title = t(side);
        fieldBox.appendChild(el('span', { 'class': 'side' }, [inp, el('small', { text: t(side) })]));
        return inp;
      });
      ctl.set = function (values, phs) {
        inputs.forEach(function (inp, i) { inp.value = values[i]; inp.placeholder = phs[i]; });
      };
      reset.onclick = function () {
        var s = styleSelector(false);
        if (!s) return;
        SIDES.forEach(function (side) { S.set(state.model, s, state.device, def.prop + '-' + side, ''); });
        setStyle(def.prop, '');
      };
    }
    controls.push(ctl);
    return row;
  }

  function refreshStylePanel() {
    var node = state.selected;
    if (!node || !state.win) return;
    // "Apply to" choices: this element, or every element sharing one of its classes.
    var apply = $('#apply-to');
    var classes = classesOf(node).filter(function (c) { return !/^wse-/.test(c); });
    apply.innerHTML = '';
    apply.appendChild(el('option', { value: 'self', text: t('thisElement') }));
    classes.forEach(function (c) { apply.appendChild(el('option', { value: c, text: t('allWithClass') + ' .' + c })); });
    if (state.target !== 'self' && classes.indexOf(state.target) < 0) state.target = 'self';
    apply.value = state.target;

    var deviceName = { desktop: 'deviceDesktop', tablet: 'deviceTablet', mobile: 'deviceMobile' }[state.device];
    $('#device-note').textContent = t('deviceNote', { device: t(deviceName) });
    $('#device-note').className = 'device-note ' + state.device;

    var sel = styleSelector(false);
    var cs = state.win.getComputedStyle(node);
    function val(p) { return sel ? S.get(state.model, sel, state.device, p) : ''; }

    $('#hide-here').checked = val('display') === 'none';
    controls.forEach(function (ctl) {
      var def = ctl.def;
      if (def.type === 'box') {
        var vals = SIDES.map(function (s) { return val(def.prop + '-' + s); });
        ctl.set(vals, SIDES.map(function (s) { return cs.getPropertyValue(def.prop + '-' + s); }));
        ctl.reset.hidden = !vals.some(Boolean);
        return;
      }
      var v = val(def.prop);
      if (def.prop === 'display' && v === 'none') v = '';
      var ph = cs.getPropertyValue(def.prop);
      if (def.type === 'font') ph = ph.split(',')[0].replace(/"/g, '');
      ctl.set(v, ph);
      ctl.reset.hidden = !v;
    });
  }

  // ------------------------------------------------------------ settings panel

  function field(labelText, input) {
    return el('div', { 'class': 'setting' }, [el('label', { text: labelText }), input]);
  }

  function attrInput(node, attr, options) {
    options = options || {};
    var s = twin(node) || node;
    var input = el('input', { type: 'text', value: s.getAttribute(attr) || '', spellcheck: 'false', list: options.list || null });
    input.addEventListener('change', function () {
      var v = input.value.trim();
      if (attr === 'class') {
        var own = ownClass(node);
        v = (v + (own ? ' ' + own : '')).trim();
      }
      setAttr(node, attr, v || null);
      if (attr === 'src' && node.tagName === 'IMG') setAttr(node, 'srcset', null);
      commit();
      renderPanels();
      renderLayers();
    });
    return input;
  }

  function renderSettings() {
    var root = $('#tab-settings');
    var node = state.selected;
    root.innerHTML = '';
    var tag = node.tagName;
    var s = twin(node) || node;

    if (tag === 'A') {
      var pages = el('datalist', { id: 'page-list' }, state.site.pages.map(function (p) { return el('option', { value: relFromPage(p) }); }));
      root.appendChild(pages);
      root.appendChild(field(t('linkUrl'), attrInput(node, 'href', { list: 'page-list' })));
      var box = el('input', { type: 'checkbox' });
      box.checked = s.getAttribute('target') === '_blank';
      box.addEventListener('change', function () {
        setAttr(node, 'target', box.checked ? '_blank' : null);
        if (box.checked) setAttr(node, 'rel', 'noopener');
        else if (s.getAttribute('rel') === 'noopener') setAttr(node, 'rel', null);
        commit();
      });
      root.appendChild(el('label', { 'class': 'check' }, [box, el('span', { text: t('newTab') })]));
    }
    var details = accordionOf(node);
    if (details) {
      var openBox = el('input', { type: 'checkbox' });
      openBox.checked = details.open;
      openBox.addEventListener('change', function () { toggleAccordion(details); });
      root.appendChild(el('label', { 'class': 'check' }, [openBox, el('span', { text: t('openOnLoad') })]));
    }
    if (tag === 'IMG') {
      var row = el('div', { 'class': 'row' }, [attrInput(node, 'src'),
        el('button', { 'class': 'btn small', text: t('choose'), onclick: changeImage })]);
      root.appendChild(field(t('imageSrc'), row));
      root.appendChild(field(t('imageAlt'), attrInput(node, 'alt')));
    }
    if (/^(IFRAME|VIDEO|AUDIO|SOURCE|EMBED)$/.test(tag)) {
      root.appendChild(field(t('source'), attrInput(node, 'src')));
    }
    var classInput = attrInput(node, 'class');
    classInput.value = classesOf(node).filter(function (c) { return !/^wse-/.test(c); }).join(' ');
    root.appendChild(field(t('classes'), classInput));
    root.appendChild(field(t('id'), attrInput(node, 'id')));
  }

  // ------------------------------------------------------------ HTML panel

  /* Parse HTML into source-copy nodes with fresh ids. */
  function parseFragment(html) {
    var tpl = state.src.createElement('template');
    tpl.innerHTML = html;
    var nodes = Array.prototype.slice.call(state.src.importNode(tpl.content, true).childNodes);
    nodes.forEach(function (n) {
      if (n.nodeType !== 1) return;
      [n].concat($$('*', n)).forEach(function (x) { x.removeAttribute(ID); });
      annotate(n);
    });
    return nodes;
  }

  $('#html-apply').addEventListener('click', function () {
    var s = twin(state.selected);
    if (!s) return;
    var nodes = parseFragment($('#html-code').value);
    if (!nodes.length) return;
    var first = nodes.filter(function (n) { return n.nodeType === 1; })[0];
    s.replaceWith.apply(s, nodes);
    changed(idOf(first));
  });

  // ------------------------------------------------------------ blocks

  /*
   * Ready-made sections. They carry their own styles, using the site's
   * colors where it has them (the CSS variables of the templates), so they
   * look right on any site.
   */
  var V = {
    primary: 'var(--color-primary, #2563eb)', onPrimary: 'var(--color-primary-text, #ffffff)',
    surface: 'var(--color-surface, #f4f6f8)', border: 'var(--color-border, #e5e7eb)', muted: 'var(--color-muted, #6b7280)',
    background: 'var(--color-background, #ffffff)', radius: 'var(--radius, 12px)', width: 'var(--width, 1120px)'
  };

  function sectionWrap(lines, background) {
    return '<section style="padding:64px 20px' + (background ? ';background:' + background : '') + '">\n' +
      '  <div style="max-width:' + V.width + ';margin:0 auto">\n' + lines.map(function (l) { return '    ' + l; }).join('\n') + '\n  </div>\n</section>';
  }

  function placeholderImg(ratio) {
    return '<img src="' + escapeHtml(relFromPage(placeholderPath())) + '" alt="' + escapeHtml(t('placeholderAlt')) +
      '" style="display:block;width:100%;height:auto;aspect-ratio:' + (ratio || '4/3') + ';object-fit:cover;border-radius:' + V.radius + '">';
  }

  function buttonHtml(text, inverted) {
    return '<a href="#" style="display:inline-block;padding:13px 26px;border-radius:999px;font-weight:600;text-decoration:none;' +
      (inverted ? 'background:' + V.onPrimary + ';color:' + V.primary : 'background:' + V.primary + ';color:' + V.onPrimary) + '">' + text + '</a>';
  }

  var GRID = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px';
  var CARD = 'padding:28px;border:1px solid ' + V.border + ';border-radius:' + V.radius + ';background:' + V.background;

  var SECTION_BLOCKS = [
    { key: 'blkHero', thumb: 'hero', images: true, html: function () {
      return '<section style="padding:72px 20px;background:' + V.surface + '">\n' +
        '  <div style="max-width:' + V.width + ';margin:0 auto;display:flex;flex-wrap:wrap;gap:48px;align-items:center">\n' +
        '    <div style="flex:1 1 340px">\n      <h1>' + t('secHeroTitle') + '</h1>\n' +
        '      <p style="font-size:1.2rem;color:' + V.muted + '">' + t('secHeroText') + '</p>\n' +
        '      <p>' + buttonHtml(t('secButton')) + '</p>\n    </div>\n' +
        '    <div style="flex:1 1 340px">' + placeholderImg() + '</div>\n  </div>\n</section>';
    } },
    { key: 'blkTextImage', thumb: 'textimage', images: true, html: function () {
      return '<section style="padding:64px 20px">\n' +
        '  <div style="max-width:' + V.width + ';margin:0 auto;display:flex;flex-wrap:wrap;gap:48px;align-items:center">\n' +
        '    <div style="flex:1 1 320px">\n      <h2>' + t('secTextTitle') + '</h2>\n      <p>' + t('secBodyText') + '</p>\n    </div>\n' +
        '    <div style="flex:1 1 320px">' + placeholderImg() + '</div>\n  </div>\n</section>';
    } },
    { key: 'blkCards', thumb: 'cards', html: function () {
      var card = '  <div style="' + CARD + '">\n    <h3>' + t('secCardTitle') + '</h3>\n    <p style="margin-bottom:0">' + t('secCardText') + '</p>\n  </div>';
      return sectionWrap(['<h2>' + t('blkCards') + '</h2>', '<div style="' + GRID + '">', card, card, card, '</div>']);
    } },
    { key: 'blkTeam', thumb: 'team', images: true, html: function () {
      var person = '  <div>\n    ' + placeholderImg('1/1') + '\n    <h3 style="margin:16px 0 2px">' + t('secPerson') + '</h3>\n' +
        '    <p style="color:' + V.muted + '">' + t('secRole') + '</p>\n  </div>';
      return sectionWrap(['<h2>' + t('blkTeam') + '</h2>', '<div style="' + GRID.replace('240px', '200px') + '">', person, person, person, '</div>'], V.surface);
    } },
    { key: 'blkQuote', thumb: 'quote', html: function () {
      return sectionWrap(['<blockquote style="max-width:760px;margin:0 auto;text-align:center;font-size:1.6rem;line-height:1.45">' + t('secQuote') + '</blockquote>',
        '<p style="text-align:center;color:' + V.muted + '">' + t('secQuoteBy') + '</p>']);
    } },
    { key: 'blkCta', thumb: 'cta', html: function () {
      return sectionWrap(['<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:24px;padding:48px;border-radius:' + V.radius +
        ';background:' + V.primary + ';color:' + V.onPrimary + '">',
        '  <div>\n      <h2 style="margin:0;color:inherit">' + t('secCtaTitle') + '</h2>\n      <p style="margin:8px 0 0">' + t('secCtaText') + '</p>\n    </div>',
        '  ' + buttonHtml(t('secCtaButton'), true), '</div>']);
    } },
    { key: 'blkContact', thumb: 'contact', html: function () {
      var rows = t('secHours').map(function (r) {
        return '      <tr><th style="text-align:left;padding:8px 16px 8px 0">' + r[0] + '</th><td style="padding:8px 0">' + r[1] + '</td></tr>';
      }).join('\n');
      return sectionWrap(['<h2>' + t('secContactTitle') + '</h2>', '<div style="' + GRID.replace('240px', '260px') + '">',
        '  <div style="' + CARD + '">\n      <p>' + t('secAddress') + '</p>\n      <p style="margin-bottom:0">' + t('secPhone') +
        ': <a href="tel:+491234567890">0123 456 7890</a><br>' + t('secEmail') + ': <a href="mailto:info@example.com">info@example.com</a></p>\n    </div>',
        '  <div style="' + CARD + '">\n      <h3>' + t('secHoursTitle') + '</h3>\n      <table style="border-collapse:collapse">\n' + rows + '\n      </table>\n    </div>',
        '</div>']);
    } },
    { key: 'blkGallery', thumb: 'gallery', images: true, html: function () {
      var list = [];
      for (var i = 0; i < 6; i++) list.push('  ' + placeholderImg('1/1'));
      return sectionWrap(['<h2>' + t('secGalleryTitle') + '</h2>', '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">']
        .concat(list, ['</div>']));
    } },
    { key: 'blkFaq', thumb: 'accordion', html: function () {
      var items = [];
      for (var i = 1; i <= 3; i++) items.push(accordionItem(t('newQuestion') + ' ' + i, i === 1).replace(/\n/g, '\n    '));
      return sectionWrap(['<h2>' + t('secFaqTitle') + '</h2>', '<div style="display:flex;flex-direction:column;gap:12px;max-width:800px">']
        .concat(items.map(function (x) { return '  ' + x; }), ['</div>']));
    } }
  ];
  SECTION_BLOCKS.forEach(function (b) { b.section = true; });

  var BLOCKS = [
    { key: 'blkHeading', thumb: 'heading', html: function () { return '<h2>' + t('newHeading') + '</h2>'; } },
    { key: 'blkParagraph', thumb: 'text', html: function () { return '<p>' + t('newParagraph') + '</p>'; } },
    { key: 'blkImage', thumb: 'image', image: true, html: function () { return '<img src="" alt="" style="max-width:100%;height:auto">'; } },
    { key: 'blkButton', thumb: 'button', html: function () {
      return '<a href="#" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">' + t('newButton') + '</a>';
    } },
    { key: 'blkLink', thumb: 'link', html: function () { return '<a href="#">' + t('newLink') + '</a>'; } },
    { key: 'blkList', thumb: 'list', html: function () {
      return '<ul>\n  <li>' + t('newItem') + '</li>\n  <li>' + t('newItem') + '</li>\n</ul>';
    } },
    { key: 'blkSection', thumb: 'section', html: function () {
      return '<section style="padding:48px 20px">\n  <h2>' + t('newHeading') + '</h2>\n  <p>' + t('newParagraph') + '</p>\n</section>';
    } },
    { key: 'blkBox', thumb: 'box', html: function () { return box(); } },
    { key: 'blkRow', thumb: 'row', html: function () {
      return '<div style="display:flex;flex-wrap:wrap;gap:24px">\n' + box('flex:1 1 220px;') + '\n' +
        box('flex:1 1 220px;') + '\n' + box('flex:1 1 220px;') + '\n</div>';
    } },
    { key: 'blkTwoCols', thumb: 'cols2', html: function () { return columns(2); } },
    { key: 'blkThreeCols', thumb: 'cols3', html: function () { return columns(3); } },
    { key: 'blkAccordion', thumb: 'accordion', html: function () {
      var out = '<div style="display:flex;flex-direction:column;gap:8px">\n';
      for (var i = 1; i <= 3; i++) out += accordionItem(t('newQuestion') + ' ' + i, i === 1) + '\n';
      return out + '</div>';
    } },
    { key: 'blkAccordionItem', thumb: 'accitem', html: function () { return accordionItem(t('newQuestion'), true); } },
    { key: 'blkDivider', thumb: 'divider', html: function () { return '<hr>'; } },
    { key: 'blkSpacer', thumb: 'spacer', html: function () { return '<div style="height:40px"></div>'; } },
    { key: 'blkVideo', thumb: 'video', video: true }
  ];

  /* Small wireframe pictures of the blocks (48 x 32). */
  var THUMBS = {
    heading: '<rect x="8" y="10" width="32" height="6" rx="2" class="f"/><rect x="8" y="20" width="22" height="3" rx="1.5"/>',
    text: '<rect x="8" y="8" width="32" height="3" rx="1.5"/><rect x="8" y="14" width="32" height="3" rx="1.5"/><rect x="8" y="20" width="24" height="3" rx="1.5"/>',
    image: '<rect x="8" y="6" width="32" height="20" rx="3"/><circle cx="17" cy="13" r="2.5" class="f"/><path d="M8 24l10-8 7 6 5-3 10 7" class="s"/>',
    button: '<rect x="10" y="10" width="28" height="12" rx="6" class="f"/>',
    link: '<rect x="8" y="14" width="32" height="3" rx="1.5" class="f"/><rect x="8" y="19" width="32" height="1"/>',
    list: '<circle cx="11" cy="10" r="2" class="f"/><rect x="16" y="9" width="24" height="3" rx="1.5"/><circle cx="11" cy="17" r="2" class="f"/><rect x="16" y="16" width="24" height="3" rx="1.5"/><circle cx="11" cy="24" r="2" class="f"/><rect x="16" y="23" width="18" height="3" rx="1.5"/>',
    section: '<rect x="4" y="4" width="40" height="24" rx="3"/><rect x="10" y="10" width="20" height="4" rx="2" class="f"/><rect x="10" y="18" width="28" height="3" rx="1.5"/>',
    box: '<rect x="8" y="5" width="32" height="22" rx="4" class="o"/><rect x="13" y="10" width="16" height="3" rx="1.5" class="f"/><rect x="13" y="17" width="22" height="3" rx="1.5"/>',
    row: '<rect x="4" y="8" width="12" height="16" rx="3" class="o"/><rect x="18" y="8" width="12" height="16" rx="3" class="o"/><rect x="32" y="8" width="12" height="16" rx="3" class="o"/>',
    cols2: '<rect x="6" y="6" width="17" height="20" rx="2"/><rect x="25" y="6" width="17" height="20" rx="2"/>',
    cols3: '<rect x="4" y="6" width="12" height="20" rx="2"/><rect x="18" y="6" width="12" height="20" rx="2"/><rect x="32" y="6" width="12" height="20" rx="2"/>',
    accordion: '<rect x="6" y="4" width="36" height="7" rx="2" class="o"/><rect x="6" y="13" width="36" height="7" rx="2" class="o"/><rect x="6" y="22" width="36" height="7" rx="2" class="o"/><path d="M36 7l2 2 2-2" class="s"/>',
    accitem: '<rect x="6" y="6" width="36" height="20" rx="3" class="o"/><rect x="10" y="10" width="18" height="3" rx="1.5" class="f"/><rect x="10" y="17" width="26" height="3" rx="1.5"/>',
    divider: '<rect x="6" y="15" width="36" height="2" rx="1" class="f"/>',
    spacer: '<path d="M24 6v20M20 10l4-4 4 4M20 22l4 4 4-4" class="s"/>',
    video: '<rect x="6" y="5" width="36" height="22" rx="4"/><path d="M21 11l9 5-9 5z" class="f"/>',
    hero: '<rect x="2" y="3" width="44" height="26" rx="3"/><rect x="6" y="9" width="16" height="4" rx="2" class="f"/><rect x="6" y="16" width="14" height="2" rx="1" class="o"/><rect x="6" y="21" width="9" height="4" rx="2" class="f"/><rect x="26" y="7" width="16" height="18" rx="2" class="o"/>',
    textimage: '<rect x="6" y="8" width="16" height="3" rx="1.5" class="f"/><rect x="6" y="14" width="16" height="2" rx="1"/><rect x="6" y="19" width="12" height="2" rx="1"/><rect x="26" y="6" width="16" height="20" rx="2" class="o"/>',
    cards: '<rect x="4" y="7" width="12" height="18" rx="2" class="o"/><rect x="18" y="7" width="12" height="18" rx="2" class="o"/><rect x="32" y="7" width="12" height="18" rx="2" class="o"/><rect x="6" y="10" width="5" height="3" rx="1" class="f"/><rect x="20" y="10" width="5" height="3" rx="1" class="f"/><rect x="34" y="10" width="5" height="3" rx="1" class="f"/>',
    team: '<circle cx="10" cy="13" r="5" class="o"/><circle cx="24" cy="13" r="5" class="o"/><circle cx="38" cy="13" r="5" class="o"/><rect x="5" y="21" width="10" height="2" rx="1" class="f"/><rect x="19" y="21" width="10" height="2" rx="1" class="f"/><rect x="33" y="21" width="10" height="2" rx="1" class="f"/>',
    quote: '<path d="M10 10h5v6h-3c0 2 1 3 3 3v2c-3 0-5-2-5-5z" class="f"/><rect x="18" y="12" width="22" height="2" rx="1"/><rect x="18" y="17" width="16" height="2" rx="1"/>',
    cta: '<rect x="3" y="7" width="42" height="18" rx="4" class="f"/><rect x="7" y="12" width="16" height="3" rx="1.5" class="w"/><rect x="31" y="13" width="10" height="6" rx="3" class="w"/>',
    contact: '<rect x="4" y="6" width="19" height="20" rx="2" class="o"/><rect x="25" y="6" width="19" height="20" rx="2" class="o"/><rect x="7" y="10" width="12" height="2" rx="1" class="f"/><rect x="7" y="15" width="10" height="2" rx="1"/><rect x="28" y="10" width="12" height="2" rx="1" class="f"/><rect x="28" y="15" width="13" height="2" rx="1"/><rect x="28" y="19" width="13" height="2" rx="1"/>',
    gallery: '<rect x="5" y="4" width="11" height="11" rx="2" class="o"/><rect x="18" y="4" width="11" height="11" rx="2" class="o"/><rect x="31" y="4" width="11" height="11" rx="2" class="o"/><rect x="5" y="17" width="11" height="11" rx="2" class="o"/><rect x="18" y="17" width="11" height="11" rx="2" class="o"/><rect x="31" y="17" width="11" height="11" rx="2" class="o"/>'
  };

  function box(extra) {
    return '<div style="' + (extra || '') + 'padding:24px;border:1px solid #e5e7eb;border-radius:8px;background:#ffffff">\n' +
      '  <h3>' + t('newHeading') + '</h3>\n  <p>' + t('newParagraph') + '</p>\n</div>';
  }

  /* A native <details> element: opens and closes without any JavaScript. */
  function accordionItem(title, open) {
    return '<details' + (open ? ' open' : '') + ' style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;background:#ffffff">\n' +
      '  <summary style="cursor:pointer;font-weight:600">' + title + '</summary>\n' +
      '  <p>' + t('newAnswer') + '</p>\n</details>';
  }

  function columns(n) {
    var col = '  <div style="flex:1 1 240px">\n    <p>' + t('newColumn') + '</p>\n  </div>\n';
    var out = '<div style="display:flex;flex-wrap:wrap;gap:24px">\n';
    for (var i = 0; i < n; i++) out += col;
    return out + '</div>';
  }

  function youtubeEmbed(url) {
    var m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{6,})/.exec(url || '');
    if (!m) return null;
    return '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden">' +
      '<iframe src="https://www.youtube-nocookie.com/embed/' + m[1] + '" title="YouTube video" ' +
      'style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" ' +
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
  }

  /* Where a new block goes without a drop position: after the selected element. */
  function insertPoint() {
    var s = twin(state.selected);
    if (s) {
      while (s.parentNode && s.parentNode !== state.src.body &&
             (/^(LI|TD|TH|TR|THEAD|TBODY|DT|DD|FIGCAPTION|SOURCE|SUMMARY|SPAN|A|STRONG|EM|B|I|SMALL|IMG)$/.test(s.tagName))) {
        s = s.parentNode;
      }
      return { parent: s.parentNode, before: s.nextSibling };
    }
    var container = state.src.querySelector('main') || state.src.body;
    var last = container.lastElementChild;
    while (last && last.tagName === 'SCRIPT') last = last.previousElementSibling;
    return { parent: container, before: last ? last.nextSibling : null };
  }

  /* Where a new section goes: after the section (or other part of the main area) that holds the selection. */
  function sectionPoint() {
    var main = state.src.querySelector('main') || state.src.body;
    var s = twin(state.selected);
    if (s && main.contains(s) && s !== main) {
      while (s.parentNode !== main) s = s.parentNode;
      return { parent: main, before: s.nextSibling };
    }
    if (s && main !== state.src.body && (main.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING)) {
      return { parent: main, before: main.firstChild }; // something above the main area (the header) is selected
    }
    var last = main.lastElementChild;
    while (last && last.tagName === 'SCRIPT') last = last.previousElementSibling;
    return { parent: main, before: last ? last.nextSibling : null };
  }

  function insertBlock(block, livePos) {
    if (!state.doc) return;
    if (block.images && !block.ready) {
      ensurePlaceholder().then(function () {
        insertBlock({ html: block.html, section: block.section, ready: true }, livePos);
      }).catch(fail);
      return;
    }
    var html = block.html ? block.html() : null;
    if (block.video) {
      html = youtubeEmbed(prompt(t('videoPrompt'), 'https://www.youtube.com/watch?v='));
      if (!html) return;
    }
    var node = parseFragment(html).filter(function (n) { return n.nodeType === 1; })[0];
    var at;
    if (livePos) {
      var parent = twin(livePos.parent);
      if (!parent) return;
      at = { parent: parent, before: srcBefore(livePos.before, parent) };
    } else {
      at = block.section ? sectionPoint() : insertPoint();
    }
    srcInsert(at.parent, node, at.before);
    changed(idOf(node), { check: true, then: block.image ? function () { changeImage(); } : null });
  }

  function buildBlocks() {
    var root = $('#blocks');
    [['blkGroupSections', SECTION_BLOCKS], ['blkGroupElements', BLOCKS]].forEach(function (group) {
      root.appendChild(el('h3', { 'class': 'blocks-title', text: t(group[0]) }));
      group[1].forEach(function (b) {
        var svg = '<svg viewBox="0 0 48 32" class="thumb-svg">' + THUMBS[b.thumb] + '</svg>';
        root.appendChild(el('button', {
          'class': 'block' + (b.section ? ' section-block' : ''),
          'data-block': b.key,
          title: t('addHint'),
          onclick: function () { if (!drag.justDropped) insertBlock(b); },
          onmousedown: function (e) { if (e.button === 0) beginDrag(e, { block: b }); }
        }, [el('span', { 'class': 'block-thumb', html: svg }), el('span', { 'class': 'block-name', text: t(b.key) })]));
      });
    });
  }

  function placeholderPath() {
    return 'images/' + WSETemplates.placeholderName(nsLang());
  }

  /* Sections with pictures use a placeholder picture; put it into the site first. */
  function ensurePlaceholder() {
    var path = placeholderPath();
    if ((state.site.images || []).indexOf(path) >= 0) return Promise.resolve();
    var name = baseName(path);
    return api('/api/upload?dir=images&name=' + encodeURIComponent(name), new Blob([WSETemplates.placeholderSvg()], { type: 'image/svg+xml' }), true)
      .then(function () { return refreshSite(); });
  }

  // ------------------------------------------------------------ drag and drop on the page

  /*
   * Elements (and new blocks from the left panel) can be dragged to another
   * place on the page. While dragging, a transparent cover lies over the
   * page; the element under the pointer is found with elementFromPoint and
   * a line shows where the dragged element will land. Only elements that
   * exist in the source (not ones made by the site's scripts) are targets.
   */
  var CONTAINERS = /^(DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|ASIDE|NAV|FIGURE|FORM|BLOCKQUOTE|TD|TH|LI|BODY|UL|OL|DETAILS)$/;
  var drag = { pending: null, active: false, pos: null, justDropped: false };

  function beginDrag(e, what) {
    drag.pending = { what: what, x: e.screenX, y: e.screenY };
    drag.justDropped = false;
  }

  function onDragMove(e) {
    if (!drag.pending || !state.doc) return;
    if (!drag.active) {
      if (Math.abs(e.screenX - drag.pending.x) + Math.abs(e.screenY - drag.pending.y) < 6) return;
      drag.active = true;
      drag.topInset = pinnedInset();
      $('#drag-cover').hidden = false;
      document.body.classList.add('dragging');
      state.hovered = null;
    }
    e.preventDefault();
    var wrap = $('#frame-wrap').getBoundingClientRect();
    var x, y;
    if (e.view === window) { x = e.clientX - wrap.left; y = e.clientY - wrap.top; }
    else { x = e.clientX; y = e.clientY; } // event from inside the page
    if (x < 0 || y < 0 || x > wrap.width || y > wrap.height) {
      drag.pos = null; // outside the page: dropping cancels
    } else {
      autoScroll(y, wrap.height);
      drag.pos = dropPosition(x, y);
    }
    showDropLine(drag.pos);
    $('#drag-cover').classList.toggle('nodrop', !drag.pos);
    // Outline the box the element will land in.
    state.hovered = drag.pos && drag.pos.parent !== state.doc.body ? drag.pos.parent : null;
  }

  function onDragEnd() {
    var pending = drag.pending;
    drag.pending = null;
    if (!drag.active) return;
    drag.active = false;
    drag.justDropped = true;
    setTimeout(function () { drag.justDropped = false; }, 0);
    $('#drag-cover').hidden = true;
    $('#drop-line').hidden = true;
    document.body.classList.remove('dragging');
    state.hovered = null;
    var pos = drag.pos;
    drag.pos = null;
    if (!pos) return;
    if (pending.what.block) return insertBlock(pending.what.block, pos);
    moveTo(pending.what.node, pos);
  }

  /* Move a live element to a drop position (in the source copy, then show it). */
  function moveTo(node, pos) {
    var s = twin(node);
    if (!s) return;
    if (pos.split !== undefined) {
      // Between two words: do it in the live view, then copy that paragraph back.
      var parent = twin(pos.parent);
      if (!parent || s.contains(parent)) return;
      var pool = poolOf(parent);
      [s].concat($$('[' + ID + ']', s)).forEach(function (n) { pool.ids[n.getAttribute(ID)] = n; });
      pos.parent.insertBefore(node, pos.before.splitText(pos.split));
      srcRemove(s);
      syncChildren(pos.parent, parent, pool, function () { return false; });
      changed(idOf(s), { check: true });
      return;
    }
    var srcParent = twin(pos.parent);
    if (!srcParent || s === srcParent || s.contains(srcParent)) return;
    var before = srcBefore(pos.before, srcParent);
    if (before === s) return;
    srcRemove(s);
    srcInsert(srcParent, s, before);
    changed(idOf(s), { check: true });
  }

  /* Height of a header that stays on top of the page (it covers the content below it). */
  function pinnedInset() {
    var w = state.win.innerWidth, inset = 0;
    [0.25, 0.5, 0.75].forEach(function (f) {
      var n = state.doc.elementFromPoint(w * f, 2);
      var pin = n && pinnedRoot(n);
      if (pin) inset = Math.max(inset, pin.getBoundingClientRect().bottom);
    });
    return Math.min(inset, state.win.innerHeight / 3);
  }

  /* Scroll the page while dragging near its top or bottom edge. */
  function autoScroll(y, height) {
    var edge = 50, top = (drag.topInset || 0) + edge;
    if (y < top) state.win.scrollBy(0, -Math.ceil((top - y) / 3));
    else if (y > height - edge) state.win.scrollBy(0, Math.ceil((y - height + edge) / 3));
  }

  /* Lays the children of a container out side by side? */
  function isRow(container) {
    var cs = state.win.getComputedStyle(container);
    return (/flex/.test(cs.display) && !/column/.test(cs.flexDirection)) || /grid/.test(cs.display);
  }

  function known(node) {
    return node === state.doc.body || node.hasAttribute(ID);
  }

  function shown(node) {
    if (!node.getClientRects().length) return false;
    var cs = state.win.getComputedStyle(node);
    return cs.visibility !== 'hidden' && +cs.opacity > 0;
  }

  function children(container, except) {
    return Array.prototype.filter.call(container.children, function (c) {
      return c !== except && c.hasAttribute(ID) && shown(c);
    });
  }

  /* Elements that only belong in one kind of parent (and parents that only take them). */
  var ONLY_IN = {
    LI: /^(UL|OL)$/, SUMMARY: /^DETAILS$/, DT: /^DL$/, DD: /^DL$/, TR: /^(TABLE|TBODY|THEAD|TFOOT)$/,
    TD: /^TR$/, TH: /^TR$/, OPTION: /^(SELECT|OPTGROUP|DATALIST)$/, SOURCE: /^(PICTURE|VIDEO|AUDIO)$/
  };
  var ONLY_TAKES = /^(UL|OL|DL|TABLE|TBODY|THEAD|TFOOT|TR|SELECT|PICTURE)$/;

  // Whole page areas (a section, the header...) do not go into the header, a menu or another section.
  var AREAS = /^(SECTION|HEADER|FOOTER|MAIN|NAV|ASIDE)$/;

  function allowedParent(parent, moving) {
    var tag = moving ? moving.tagName : '';
    // No link inside a link, only pictures and text styles.
    if (parent.closest('a, button')) {
      return !!moving && PHRASING.test(tag) && !/^(A|BUTTON)$/.test(tag) && !moving.querySelector('a, button');
    }
    if (ONLY_IN[tag]) return ONLY_IN[tag].test(parent.tagName);
    if (AREAS.test(tag) && !/^(BODY|MAIN|DIV|ARTICLE)$/.test(parent.tagName)) return false;
    if (tag === 'DETAILS' && parent.tagName === 'DETAILS') return false;
    return !ONLY_TAKES.test(parent.tagName);
  }

  /* On the page, only visible places take a drop: not the content of a closed accordion item. */
  function pageParent(parent, moving) {
    if (parent.tagName === 'DETAILS' && !parent.open) return false;
    return allowedParent(parent, moving);
  }

  /* The title of an accordion item stays its first child. */
  function afterSummary(pos) {
    if (!pos || pos.parent.tagName !== 'DETAILS') return pos;
    var summary = pos.parent.querySelector(':scope > summary');
    if (!summary) return pos;
    for (var n = pos.before; n; n = n.nextSibling) if (n === summary) {
      return { parent: pos.parent, before: summary.nextSibling, ref: summary, after: true, row: false };
    }
    return pos;
  }

  var TEXT_BLOCKS = /^(P|H[1-6]|LI|SUMMARY|BLOCKQUOTE|FIGCAPTION|TD|TH|LABEL|DT|DD|SPAN|STRONG|EM|B|I|SMALL)$/;

  /* The outermost fixed or sticky box (a header that stays on top) an element is in. */
  function pinnedRoot(node) {
    var root = null;
    for (var n = node; n && n.nodeType === 1 && n !== state.doc.body; n = n.parentElement) {
      if (/^(fixed|sticky)$/.test(state.win.getComputedStyle(n).position)) root = n;
    }
    return root;
  }

  /*
   * The element under the pointer that can take a drop. Headers that stay on
   * top of the page cover the content while dragging; they only take
   * elements that already are in them.
   */
  function targetAt(x, y, moving) {
    var allowed = moving ? pinnedRoot(moving) : null;
    var list = state.doc.elementsFromPoint(x, y);
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n === state.doc.documentElement || n === state.doc.body) return state.doc.body;
      if (n.closest('[data-wse-hook]')) continue;
      var pin = pinnedRoot(n);
      if (!pin || pin === allowed) return n;
    }
    return state.doc.body;
  }

  /* An inline element (link, image, bold text...) can be dropped between two words. */
  function textDrop(x, y, moving) {
    if (!moving || !state.doc.caretRangeFromPoint || ONLY_IN[moving.tagName]) return null;
    if (!isInline(moving) && !/^(IMG|BR)$/.test(moving.tagName)) return null;
    var range = state.doc.caretRangeFromPoint(x, y);
    if (!range || range.startContainer.nodeType !== 3) return null;
    var text = range.startContainer;
    var parent = text.parentNode;
    if (!parent || moving.contains(parent) || !TEXT_BLOCKS.test(parent.tagName) || !known(parent)) return null;
    if (!text.nodeValue.trim() || !shown(parent) || parent.closest('a')) return null;
    if (pinnedRoot(parent) !== pinnedRoot(moving)) return null;
    // Never split a word: move to the nearest space (or the start or end of the text).
    var value = text.nodeValue, at = range.startOffset;
    var left = at, right = at;
    while (left > 0 && !/\s/.test(value[left - 1])) left--;
    while (right < value.length && !/\s/.test(value[right])) right++;
    at = at - left <= right - at ? left : right;
    range.setStart(text, at);
    range.collapse(true);
    var rect = range.getBoundingClientRect();
    if (!rect.height) return null;
    return { parent: parent, before: text, split: at, caret: rect };
  }

  /* Where to drop, as { parent, before } for parent.insertBefore(). */
  function dropPosition(x, y) {
    var doc = state.doc;
    var moving = drag.pending.what.node || null;
    var inText = textDrop(x, y, moving);
    if (inText) return inText;
    var target = targetAt(x, y, moving);
    // Never drop an element into itself.
    if (moving && moving.contains(target)) target = moving;
    var node = target;
    while (node && node !== doc.body) {
      if (known(node) && shown(node) && node !== moving) {
        if (CONTAINERS.test(node.tagName) && pageParent(node, moving)) {
          var r = node.getBoundingClientRect();
          var inner = Math.min(16, r.width / 4, r.height / 4);
          var inside = x > r.left + inner && x < r.right - inner && y > r.top + inner && y < r.bottom - inner;
          if (inside) return afterSummary(positionAmong(node, x, y, moving));
        }
        var parent = node.parentElement;
        if (parent && known(parent) && parent !== moving && pageParent(parent, moving)) {
          // Near the edge of an element: before or after it.
          var pr = node.getBoundingClientRect();
          var row = isRow(parent);
          var after = row ? x > pr.left + pr.width / 2 : y > pr.top + pr.height / 2;
          return afterSummary({ parent: parent, before: after ? node.nextSibling : node, ref: node, after: after, row: row });
        }
      }
      node = node.parentElement;
    }
    return allowedParent(doc.body, moving) ? positionAmong(doc.body, x, y, moving) : null;
  }

  function positionAmong(container, x, y, moving) {
    var list = children(container, moving);
    var row = isRow(container);
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      var before = row ? (x < r.left + r.width / 2 && y < r.bottom) : y < r.top + r.height / 2;
      if (before) return { parent: container, before: list[i], ref: list[i], after: false, row: row };
    }
    var last = list[list.length - 1];
    if (last) return { parent: container, before: last.nextSibling, ref: last, after: true, row: row };
    return { parent: container, before: null, ref: container, empty: true };
  }

  function showDropLine(pos) {
    var line = $('#drop-line');
    if (!pos) { line.hidden = true; return; }
    line.hidden = false;
    if (pos.caret) {
      line.className = 'drop-line vertical';
      line.style.left = pos.caret.left - 1 + 'px'; line.style.top = pos.caret.top + 'px';
      line.style.width = '3px'; line.style.height = Math.max(pos.caret.height, 14) + 'px';
      return;
    }
    var r = pos.ref.getBoundingClientRect();
    line.className = 'drop-line' + (pos.empty ? ' fill' : pos.row ? ' vertical' : '');
    if (pos.empty) {
      line.style.left = r.left + 'px'; line.style.top = r.top + 'px';
      line.style.width = r.width + 'px'; line.style.height = Math.max(r.height, 8) + 'px';
    } else if (pos.row) {
      line.style.left = (pos.after ? r.right : r.left) - 2 + 'px'; line.style.top = r.top + 'px';
      line.style.width = '4px'; line.style.height = r.height + 'px';
    } else {
      line.style.left = r.left + 'px'; line.style.top = (pos.after ? r.bottom : r.top) - 2 + 'px';
      line.style.width = r.width + 'px'; line.style.height = '4px';
    }
  }

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  $('#el-toolbar [data-act="drag"]').addEventListener('mousedown', function (e) {
    e.preventDefault();
    if (e.button === 0 && state.selected) beginDrag(e, { node: state.selected });
  });

  // ------------------------------------------------------------ structure panel (layers)

  var expanded = {};
  var layersQueued = false;

  function layerChildren(s) {
    return Array.prototype.filter.call(s.children, function (c) {
      return c.hasAttribute(ID) && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BR|LINK|META)$/.test(c.tagName);
    });
  }

  function layerText(s) {
    var text = '';
    Array.prototype.some.call(s.childNodes, function (c) {
      if (c.nodeType === 3 && c.nodeValue.trim()) { text = c.nodeValue.trim(); return true; }
      return false;
    });
    if (!text && s.tagName === 'IMG') text = s.getAttribute('alt') || s.getAttribute('src') || '';
    return text.length > 28 ? text.slice(0, 27) + '…' : text;
  }

  function renderLayers() {
    if (layersQueued) return;
    layersQueued = true;
    requestAnimationFrame(function () {
      layersQueued = false;
      if ($('#ltab-layers').hidden || !state.src) return;
      var selected = srcById(state.selectedId);
      for (var p = selected && selected.parentNode; p && p !== state.src.body; p = p.parentNode) {
        if (p.nodeType === 1) expanded[p.getAttribute(ID)] = true;
      }
      var root = $('#layers');
      var scroll = root.scrollTop;
      root.innerHTML = '';
      layerChildren(state.src.body).forEach(function (c) { addLayer(root, c, 0); });
      root.scrollTop = scroll;
      var cur = $('.layer.current', root);
      if (cur && cur.scrollIntoViewIfNeeded) cur.scrollIntoViewIfNeeded(false);
    });
  }

  function addLayer(root, s, depth) {
    var id = s.getAttribute(ID);
    var kids = layerChildren(s);
    var open = !!expanded[id];
    var tag = s.tagName.toLowerCase();
    var name = t('tag_' + tag);
    if (name === 'tag_' + tag) name = tag;
    var cls = Array.prototype.filter.call(s.classList, function (c) { return !/^wse-/.test(c); })[0];
    var row = el('div', {
      'class': 'layer' + (id === state.selectedId ? ' current' : ''),
      draggable: 'true', role: 'treeitem', 'data-id': id,
      style: 'padding-left:' + (6 + depth * 14) + 'px'
    }, [
      el('button', { 'class': 'layer-caret' + (open ? ' open' : '') + (kids.length ? '' : ' none'), tabindex: '-1',
        onclick: function (e) { e.stopPropagation(); expanded[id] = !open; renderLayers(); } }, [icon('chevron')]),
      el('span', { 'class': 'layer-name', text: name }),
      cls || s.id ? el('span', { 'class': 'layer-cls', text: s.id ? '#' + s.id : '.' + cls }) : null,
      el('span', { 'class': 'layer-text', text: layerText(s) })
    ]);
    row.addEventListener('click', function () {
      var live = liveById(id);
      if (!live) return;
      select(live);
      revealNode(live, false);
    });
    row.addEventListener('mouseenter', function () { state.hovered = liveById(id); });
    row.addEventListener('mouseleave', function () { state.hovered = null; });
    row.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
      layerDrag = id;
    });
    row.addEventListener('dragend', function () { layerDrag = null; clearLayerMarks(); });
    row.addEventListener('dragover', function (e) {
      var zone = layerZone(e, row, s);
      clearLayerMarks();
      if (!zone) return;
      e.preventDefault();
      row.classList.add('drop-' + zone);
    });
    row.addEventListener('drop', function (e) {
      e.preventDefault();
      var zone = layerZone(e, row, s);
      clearLayerMarks();
      var moving = srcById(layerDrag);
      layerDrag = null;
      if (!zone || !moving) return;
      if (zone === 'inside') {
        expanded[id] = true;
        var first = layerChildren(s)[0];
        srcRemove(moving);
        srcInsert(s, moving, first || null);
      } else {
        var next = zone === 'after' ? s.nextSibling : s;
        srcRemove(moving);
        srcInsert(s.parentNode, moving, next);
      }
      changed(idOf(moving), { check: true });
    });
    root.appendChild(row);
    if (open) kids.forEach(function (c) { addLayer(root, c, depth + 1); });
  }

  var layerDrag = null;

  function clearLayerMarks() {
    $$('.layer.drop-before, .layer.drop-after, .layer.drop-inside').forEach(function (r) {
      r.classList.remove('drop-before', 'drop-after', 'drop-inside');
    });
  }

  function layerZone(e, row, s) {
    var moving = srcById(layerDrag);
    if (!moving || moving === s || moving.contains(s)) return null;
    var r = row.getBoundingClientRect();
    var f = (e.clientY - r.top) / r.height;
    var canInside = CONTAINERS.test(s.tagName) && allowedParent(s, moving);
    var canSibling = s.parentNode && allowedParent(s.parentNode, moving);
    if (canInside && (f > 0.3 && f < 0.7 || !canSibling)) return 'inside';
    if (!canSibling) return null;
    return f < 0.5 ? 'before' : 'after';
  }

  // ------------------------------------------------------------ history

  function snapshot() {
    return { html: state.src.body.innerHTML, css: S.serialize(state.model), model: S.clone(state.model) };
  }

  function currentKey(designEdits) {
    if (!state.src) return '';
    var edits = designEdits || design.edits;
    return state.src.body.innerHTML + '\u0000' + S.serialize(state.model) + '\u0000' + (state.prefix || '') +
      (isEmpty(edits) ? '' : '\u0000' + JSON.stringify(edits));
  }

  function isEmpty(obj) {
    return !obj || !Object.keys(obj).length;
  }

  function commit() {
    if (!state.src) return;
    var snap = snapshot();
    var cur = state.history[state.hIndex];
    if (cur && cur.html === snap.html && cur.css === snap.css) return;
    state.history = state.history.slice(0, state.hIndex + 1);
    state.history.push(snap);
    if (state.history.length > 100) state.history.shift();
    state.hIndex = state.history.length - 1;
    updateDirty();
  }

  function restore(index) {
    if (state.editing) finishEditing();
    if (index < 0 || index >= state.history.length) return;
    state.hIndex = index;
    var snap = state.history[index];
    state.src.body.innerHTML = snap.html;
    state.model = S.clone(snap.model);
    writeStyles();
    updateDirty();
    renderLayers();
    render();
  }

  function undo() { restore(state.hIndex - 1); }
  function redo() { restore(state.hIndex + 1); }

  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);

  function isDirty() {
    return !!state.src && currentKey() !== state.savedKey;
  }

  function updateDirty() {
    var dirty = isDirty();
    $('#btn-save').classList.toggle('dirty', dirty);
    $('#btn-undo').disabled = state.hIndex <= 0;
    $('#btn-redo').disabled = state.hIndex >= state.history.length - 1;
    document.title = (dirty ? '● ' : '') + (state.page || '') + ' – WYSIWYG Edit';
  }

  window.addEventListener('beforeunload', function (e) {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  // ------------------------------------------------------------ parts shared by several pages

  /*
   * A website repeats its header, menu and footer on every page. Parts that
   * are the same on other pages are found when a page opens. When such a
   * part is changed here, saving offers to make the change on those pages
   * too. What marks the current page (aria-current="page", a class like
   * "current" or "active") stays as it was on each page.
   */
  var SHARED_TAGS = /^(HEADER|FOOTER|NAV|ASIDE)$/;
  var SHARED_NAMES = /(^|[-_\s])(header|footer|nav|navbar|navigation|menu|topbar|sidebar)([-_\s]|$)/i;
  var MARK_CLASS = /^(current|active|is-active|is-current|selected|current-menu-item|current_page_item|current-menu-parent|current-menu-ancestor|current-page-ancestor)$/;
  var sharedSeq = 0;

  function sharedCandidate(n) {
    return SHARED_TAGS.test(n.tagName) ||
      (/^(DIV|UL)$/.test(n.tagName) && SHARED_NAMES.test((n.id || '') + ' ' + (n.getAttribute('class') || '')));
  }

  function partKey(n) {
    var classes = Array.prototype.filter.call(n.classList, function (c) { return !MARK_CLASS.test(c) && !/^wse-/.test(c); });
    return n.tagName + '#' + (n.id || '') + '.' + classes.sort().join('.');
  }

  function unmark(n) {
    [n].concat($$('*', n)).forEach(function (e) {
      e.removeAttribute(ID);
      e.removeAttribute('aria-current');
      Array.prototype.slice.call(e.classList).forEach(function (c) { if (MARK_CLASS.test(c)) e.classList.remove(c); });
      if (e.hasAttribute('class') && !e.classList.length) e.removeAttribute('class');
    });
    return n;
  }

  /* A part as text, without the marks of its page and with spaces made equal. */
  function partText(n) {
    return unmark(n.cloneNode(true)).outerHTML.replace(/\s+/g, ' ');
  }

  function candidatesIn(root) {
    var map = {};
    $$('*', root).forEach(function (n) {
      if (!sharedCandidate(n)) return;
      var key = partKey(n);
      (map[key] = map[key] || []).push(n);
    });
    return map;
  }

  /* Look at the other pages of the site (after a page opened). */
  function findShared() {
    state.sharedReady = findSharedNow();
    return state.sharedReady;
  }

  function findSharedNow() {
    var seq = ++sharedSeq, page = state.page;
    state.shared = [];
    var own = candidatesIn(state.src.body);
    var others = (state.site.pages || []).filter(function (p) { return p !== page; }).slice(0, 300);
    var found = {};
    var next = function (i) {
      if (seq !== sharedSeq) return null;
      if (i >= others.length) return finish();
      return api('/api/page?path=' + encodeURIComponent(others[i])).then(function (data) {
        if (seq !== sharedSeq) return;
        var doc = new DOMParser().parseFromString(data.source, 'text/html');
        var theirs = candidatesIn(doc.body);
        Object.keys(own).forEach(function (key) {
          if (own[key].length !== 1 || !theirs[key] || theirs[key].length !== 1) return;
          if (partText(theirs[key][0]) !== partText(own[key][0])) return;
          (found[key] = found[key] || []).push(others[i]);
        });
      }, function () { /* a page that cannot be read is left out */ }).then(function () { return next(i + 1); });
    };
    var finish = function () {
      Object.keys(found).forEach(function (key) {
        var n = own[key][0];
        // A part inside a shared part goes with it.
        for (var p = n.parentElement; p; p = p.parentElement) {
          if (p.hasAttribute(ID) && found[partKey(p)] && own[partKey(p)] && own[partKey(p)][0] === p) return;
        }
        state.shared.push({ id: n.getAttribute(ID), key: key, tag: n.tagName, pages: found[key], text: partText(n) });
      });
      renderCrumbs();
    };
    return next(0);
  }

  function sharedPartOf(node) {
    var parts = state.shared || [];
    for (var n = node; n && n.nodeType === 1; n = n.parentElement) {
      var id = idOf(n);
      for (var i = 0; i < parts.length; i++) if (parts[i].id === id && parts[i].pages.length) return parts[i];
    }
    return null;
  }

  function changedParts() {
    return (state.shared || []).filter(function (part) {
      var n = srcById(part.id);
      return n && part.pages.length && partText(n) !== part.text;
    });
  }

  /* Ask which changed parts go to the other pages. Resolves with the chosen parts (or none). */
  function askShared(parts) {
    return new Promise(function (resolve) {
      var dialog = $('#shared-dialog'), list = $('#shared-list');
      list.innerHTML = '';
      var boxes = parts.map(function (part) {
        var box = el('input', { type: 'checkbox', checked: true });
        list.appendChild(el('label', { 'class': 'check' }, [box, el('span', {
          text: t('sharedPart', { name: label(liveById(part.id) || srcById(part.id)), n: part.pages.length })
        })]));
        return box;
      });
      var done = function (choice) {
        dialog.onclose = null;
        dialog.close();
        resolve(choice);
      };
      $('#shared-all').onclick = function () {
        done(parts.filter(function (p, i) { return boxes[i].checked; }).concat(
          parts.filter(function (p, i) { return !boxes[i].checked; }).map(function (p) { return { only: p }; })));
      };
      $('#shared-here').onclick = function () { done(parts.map(function (p) { return { only: p }; })); };
      dialog.onclose = function () { resolve([]); };
      dialog.showModal();
    });
  }

  /* Where a part starts and ends in the text of another page. */
  function partRange(source, part) {
    var re = /<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s="'\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
    var name = part.tag.toLowerCase(), start = -1, depth = 0, m;
    while ((m = re.exec(source))) {
      if (!m[3] || m[3].toLowerCase() !== name) continue;
      if (start < 0) {
        if (m[2]) continue;
        var tag = new DOMParser().parseFromString('<body>' + m[0], 'text/html').body.firstElementChild;
        if (tag && partKey(tag) === part.key) { start = m.index; depth = 1; }
      } else {
        depth += m[2] ? -1 : 1;
        if (!depth) return [start, m.index + m[0].length];
      }
    }
    return null;
  }

  /* The changed part for another page, with that page's marks. */
  function partFor(part, theirs) {
    // An element is found again by its link (address and text), else by its text.
    var sig = function (e, loose) {
      var link = e.getAttribute('href') !== null ? e : e.querySelector(':scope > a[href]');
      var text = (link || e).textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
      return e.tagName + '|' + (link ? link.getAttribute('href') : '') + '|' + (loose && link ? '' : text);
    };
    var copy = unmark(srcById(part.id).cloneNode(true));
    var all = [copy].concat($$('*', copy));
    var find = function (e) {
      var exact = all.filter(function (c) { return sig(c) === sig(e); });
      if (exact.length) return exact[0];
      var loose = all.filter(function (c) { return sig(c, true) === sig(e, true); });
      return loose.length === 1 ? loose[0] : null; // the link text was changed
    };
    [theirs].concat($$('*', theirs)).forEach(function (e) {
      var marks = Array.prototype.filter.call(e.classList, function (c) { return MARK_CLASS.test(c); });
      var current = e.getAttribute('aria-current');
      if (!marks.length && current === null) return;
      var match = find(e);
      if (!match) return;
      marks.forEach(function (c) { match.classList.add(c); });
      if (current !== null) match.setAttribute('aria-current', current);
    });
    return copy;
  }

  /* Copy the editor's styles of a part's elements into another page's style block. */
  function withPartStyles(source, copy) {
    var used = {};
    [copy].concat($$('*', copy)).forEach(function (e) {
      Array.prototype.forEach.call(e.classList, function (c) { if (/^wse-/.test(c)) used['.' + c] = true; });
    });
    var sels = Object.keys(used).filter(function (sel) { return state.model.rules[sel]; });
    if (!sels.length) return source;
    var bodyAt = source.search(/<body\b/i);
    if (bodyAt < 0) return source;
    var head = source.slice(0, bodyAt);
    var block = /<style\b[^>]*\bid\s*=\s*["']?wysiwyg-edit-styles\b[^>]*>([\s\S]*?)<\/style\s*>/i.exec(head);
    var model = S.parse(block ? block[1] : '');
    sels.forEach(function (sel) {
      model.rules[sel] = JSON.parse(JSON.stringify(state.model.rules[sel]));
      if (model.order.indexOf(sel) < 0) model.order.push(sel);
    });
    return headWithStyles(head, S.serialize(model)) + source.slice(bodyAt);
  }

  function shareToPage(page, parts) {
    return api('/api/page?path=' + encodeURIComponent(page)).then(function (data) {
      var source = data.source;
      var doc = new DOMParser().parseFromString(source, 'text/html');
      var theirs = candidatesIn(doc.body);
      var changed = false;
      parts.forEach(function (part) {
        if (part.pages.indexOf(page) < 0 || !theirs[part.key] || theirs[part.key].length !== 1) return;
        if (partText(theirs[part.key][0]) !== part.text) return; // changed there in the meantime
        var range = partRange(source, part);
        if (!range) return;
        var copy = partFor(part, theirs[part.key][0]);
        var html = restoreScripts(keepTagLayout(bareAttributes(keepEntities(stripIds(copy.outerHTML)))));
        source = withPartStyles(source.slice(0, range[0]) + html + source.slice(range[1]), copy);
        changed = true;
      });
      return changed ? api('/api/save', { path: page, content: source }).then(function () { return 1; }) : 0;
    });
  }

  /* After saving this page: offer the changes of shared parts to the other pages. */
  function saveShared(auto) {
    var parts = changedParts();
    if (!parts.length) return Promise.resolve(0);
    return (auto ? Promise.resolve(parts) : askShared(parts)).then(function (choice) {
      var go = choice.filter(function (c) { return !c.only; });
      choice.forEach(function (c) { if (c.only) c.only.pages = []; }); // differs from the other pages now
      var pages = {};
      go.forEach(function (part) { part.pages.forEach(function (p) { pages[p] = true; }); });
      var count = 0;
      return Object.keys(pages).reduce(function (chain, page) {
        return chain.then(function () { return shareToPage(page, go); }).then(function (n) { count += n; });
      }, Promise.resolve()).then(function () {
        go.forEach(function (part) { part.text = partText(srcById(part.id)); });
        return count;
      });
    });
  }

  // ------------------------------------------------------------ pages: new, settings, rename, delete

  var TITLE_RE = /(<title\b[^>]*>)([\s\S]*?)(<\/title\s*>)/i;
  var DESC_RE = /<meta\b[^>]*\bname\s*=\s*["']?description["']?[^>]*>/i;
  var CONTENT_RE = /\bcontent\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i;

  function decodeText(text) {
    var box = document.createElement('textarea');
    box.innerHTML = text;
    return box.value;
  }

  function pageTitle(head) {
    var m = TITLE_RE.exec(head || '');
    return m ? decodeText(m[2]).replace(/\s+/g, ' ').trim() : '';
  }

  function pageDescription(head) {
    var m = DESC_RE.exec(head || '');
    var c = m && CONTENT_RE.exec(m[0]);
    return c ? decodeText(c[1].replace(/^["']|["']$/g, '')) : '';
  }

  /* Put a tag on its own line after <title> (or at the end of <head>). */
  function insertInHead(head, tag) {
    var eol = /\r\n/.test(head) ? '\r\n' : '\n';
    var m = TITLE_RE.exec(head);
    if (m) {
      var lineStart = head.lastIndexOf('\n', m.index) + 1;
      var indent = /^[ \t]*/.exec(head.slice(lineStart))[0];
      var at = m.index + m[0].length;
      return head.slice(0, at) + eol + indent + tag + head.slice(at);
    }
    var end = head.search(/<\/head\s*>/i);
    if (end >= 0) return head.slice(0, end) + '  ' + tag + eol + head.slice(end);
    var open = /<head\b[^>]*>/i.exec(head);
    if (!open) return head;
    var after = open.index + open[0].length;
    return head.slice(0, after) + eol + '  ' + tag + head.slice(after);
  }

  function withTitle(head, title) {
    if (TITLE_RE.test(head)) return head.replace(TITLE_RE, function (m, open, text, close) { return open + escapeHtml(title) + close; });
    return insertInHead(head, '<title>' + escapeHtml(title) + '</title>');
  }

  function withDescription(head, text) {
    var m = DESC_RE.exec(head);
    if (m) {
      var tag = CONTENT_RE.test(m[0]) ? m[0].replace(CONTENT_RE, 'content="' + escapeHtml(text) + '"')
        : m[0].replace(/\s*\/?>$/, ' content="' + escapeHtml(text) + '">');
      return head.slice(0, m.index) + tag + head.slice(m.index + m[0].length);
    }
    return text ? insertInHead(head, '<meta name="description" content="' + escapeHtml(text) + '">') : head;
  }

  function baseName(path) {
    return path.split('/').pop();
  }

  function validFile(name) {
    return /^[\w\-.]+\.html?$/i.test(name) && !/^\./.test(name);
  }

  function showError(sel, msg) {
    var box = $(sel);
    box.textContent = msg;
    box.hidden = !msg;
  }

  /* Load the list of pages again and open one of them. */
  function reopenSite(page) {
    return refreshSite().then(function (data) {
      fillPages(data);
      loadPage(data.pages.indexOf(page) >= 0 ? page : data.pages[0]);
    });
  }

  /* The main menu: the list in the header's (or the first) <nav>. */
  function mainMenuList() {
    var nav = state.src.querySelector('header nav') || state.src.querySelector('nav');
    return nav ? nav.querySelector('ul, ol') : null;
  }

  function addMenuEntry(file, title) {
    var list = mainMenuList();
    var items = $$(':scope > li', list);
    var simple = items.filter(function (li) { return li.children.length === 1 && li.firstElementChild.tagName === 'A'; });
    var model = simple[simple.length - 1] || items[items.length - 1];
    var li;
    if (model) {
      li = unmark(model.cloneNode(true));
      $$('ul, ol', li).forEach(function (sub) { sub.remove(); });
    } else {
      li = state.src.createElement('li');
    }
    var a = li.querySelector('a');
    if (!a) {
      li.textContent = '';
      a = li.appendChild(state.src.createElement('a'));
    }
    a.setAttribute('href', baseName(file));
    a.textContent = title;
    annotate(li);
    srcInsert(list, li, items.length ? items[items.length - 1].nextSibling : null);
    changed(idOf(li));
  }

  /* The title of a new page, built like the title of this one ("Page – Site"). */
  function newTitle(title) {
    var current = pageTitle(state.prefix);
    var site = current;
    var sep = /\s+[–|·—-]\s+/.exec(current);
    if (baseName(state.page) !== 'index.html' && sep) site = current.slice(sep.index + sep[0].length);
    return site && site !== title ? title + ' – ' + site : title;
  }

  function siteHasClass(name) {
    var re = new RegExp('\\.' + name + '(?![\\w-])');
    return Array.prototype.some.call(state.doc ? state.doc.styleSheets : [], function (sheet) {
      try {
        return Array.prototype.some.call(sheet.cssRules, function (r) { return r.selectorText && re.test(r.selectorText); });
      } catch (e) { return false; }
    });
  }

  function lineIndent(text, at) {
    var start = text.lastIndexOf('\n', at - 1) + 1;
    return /^[ \t]*/.exec(text.slice(start))[0];
  }

  /* The source of a new page made from this one. */
  function newPageSource(file, title, empty) {
    var text = buildOutput();
    var bodyAt = text.search(/<body\b/i);
    if (bodyAt >= 0) text = withDescription(withTitle(text.slice(0, bodyAt), newTitle(title)), '') + text.slice(bodyAt);
    // Menus and other repeated parts: mark the new page as the current one.
    var own = baseName(state.page), link = baseName(file);
    $$('*', state.src.body).forEach(function (part) {
      if (!sharedCandidate(part)) return;
      for (var p = part.parentElement; p; p = p.parentElement) if (sharedCandidate(p)) return;
      var copy = unmark(part.cloneNode(true));
      var targets = $$('a', copy).filter(function (a) { return (a.getAttribute('href') || '').replace(/^\.\//, '') === link; });
      $$('a', part).forEach(function (a) {
        var current = a.getAttribute('aria-current');
        if ((a.getAttribute('href') || '').replace(/^\.\//, '') !== own) return;
        targets.forEach(function (target) { if (current !== null) target.setAttribute('aria-current', current); });
        // Classes like "current" on the link or on a box around it.
        for (var e = a; e && e !== part.parentElement; e = e.parentElement) {
          Array.prototype.forEach.call(e.classList, function (c) {
            if (!MARK_CLASS.test(c)) return;
            targets.forEach(function (target) {
              var same = target.closest(e.tagName);
              if (same && copy.contains(same)) same.classList.add(c);
            });
          });
        }
      });
      var range = partRange(text, { tag: part.tagName, key: partKey(part) });
      if (!range) return;
      var html = restoreScripts(keepTagLayout(bareAttributes(keepEntities(stripIds(copy.outerHTML)))));
      text = text.slice(0, range[0]) + html + text.slice(range[1]);
    });
    var main = state.src.querySelector('main');
    if (empty && main) {
      var range = partRange(text, { tag: 'MAIN', key: partKey(main) });
      if (range) {
        var whole = text.slice(range[0], range[1]);
        var open = /^<main\b[^>]*>/i.exec(whole)[0];
        var pad = lineIndent(text, range[0]), inner = pad + '  ', eol = /\r\n/.test(text) ? '\r\n' : '\n';
        var lines;
        if (siteHasClass('page-head')) {
          lines = ['<section class="page-head">', '  <div class="container">', '    <h1>' + escapeHtml(title) + '</h1>', '  </div>', '</section>',
            '<section class="section">', '  <div class="narrow">', '    <p>' + escapeHtml(t('npText')) + '</p>', '  </div>', '</section>'];
        } else {
          lines = ['<h1>' + escapeHtml(title) + '</h1>', '<p>' + escapeHtml(t('npText')) + '</p>'];
        }
        var body = eol + lines.map(function (l) { return inner + l; }).join(eol) + eol + pad;
        text = text.slice(0, range[0]) + open + body + '</main>' + text.slice(range[1]);
      }
    }
    return text;
  }

  var npFileTouched = false;

  $('#btn-new-page').addEventListener('click', function () {
    if (!state.src) return;
    $('#np-title').value = '';
    $('#np-file').value = '';
    npFileTouched = false;
    showError('#np-error', '');
    $('#np-menu-wrap').hidden = !mainMenuList();
    var hasMain = !!state.src.querySelector('main');
    var radios = $$('input[name="np-kind"]');
    radios[0].disabled = !hasMain;
    radios[hasMain ? 0 : 1].checked = true;
    $('#page-dialog').showModal();
    $('#np-title').focus();
  });

  $('#np-title').addEventListener('input', function () {
    if (!npFileTouched) $('#np-file').value = WSETemplates.slug($('#np-title').value) ? WSETemplates.slug($('#np-title').value) + '.html' : '';
  });
  $('#np-file').addEventListener('input', function () { npFileTouched = true; });
  $('#page-form').addEventListener('submit', function (e) { e.preventDefault(); createPage(); });
  $('#np-create').addEventListener('click', createPage);

  function createPage() {
    var title = $('#np-title').value.trim(), name = $('#np-file').value.trim();
    if (!title) { $('#np-title').focus(); return; }
    if (!validFile(name)) { showError('#np-error', t('npBadFile')); return; }
    var dir = dirname(state.page), file = (dir ? dir + '/' : '') + name;
    if (state.site.pages.indexOf(file) >= 0) { showError('#np-error', t('error', { msg: file })); return; }
    var empty = $('input[name="np-kind"]:checked').value === 'empty';
    var addMenu = !$('#np-menu-wrap').hidden && $('#np-menu').checked;
    $('#page-dialog').close();
    (isDirty() ? save() : Promise.resolve()).then(function () {
      return state.sharedReady;
    }).then(function () {
      if (!addMenu) return null;
      addMenuEntry(file, title);
      return save({ autoShare: true });
    }).then(function () {
      return api('/api/create-page', { path: file, content: newPageSource(file, title, empty) });
    }).then(function (data) {
      state.site = data;
      toast(t('npCreated', { name: title }) + ' ✓');
      state.page = file;
      fillPages(data);
      loadPage(file);
    }).catch(fail);
  }

  $('#btn-page-settings').addEventListener('click', function () {
    if (!state.src) return;
    $('#ps-title').value = pageTitle(state.prefix);
    $('#ps-desc').value = pageDescription(state.prefix);
    $('#ps-file').value = baseName(state.page);
    $('#ps-title').disabled = $('#ps-desc').disabled = !!state.wholeDoc;
    showError('#ps-error', '');
    $('#settings-dialog').showModal();
  });

  $('#ps-apply').addEventListener('click', function () {
    var name = $('#ps-file').value.trim();
    if (name !== baseName(state.page) && !validFile(name)) { showError('#ps-error', t('npBadFile')); return; }
    if (!state.wholeDoc) {
      var title = $('#ps-title').value.trim(), desc = $('#ps-desc').value.trim();
      if (title !== pageTitle(state.prefix)) state.prefix = withTitle(state.prefix, title);
      if (desc !== pageDescription(state.prefix)) state.prefix = withDescription(state.prefix, desc);
      updateDirty();
    }
    $('#settings-dialog').close();
    if (name === baseName(state.page)) return;
    var dir = dirname(state.page), to = (dir ? dir + '/' : '') + name;
    (isDirty() ? save() : Promise.resolve()).then(function () {
      return api('/api/rename-page', { from: state.page, to: to });
    }).then(function (res) {
      toast(t('psRenamed', { n: res.changed }) + ' ✓');
      state.page = to;
      return reopenSite(to);
    }).catch(fail);
  });

  $('#ps-delete').addEventListener('click', function () {
    var page = state.page;
    if (!confirm(t('psDeleteConfirm', { page: page }))) return;
    $('#settings-dialog').close();
    Promise.resolve(state.sharedReady).then(function () {
      // Take the page out of the menus on the other pages.
      var link = baseName(page);
      var parts = (state.shared || []).filter(function (part) { return part.pages.length; });
      parts.forEach(function (part) {
        var n = srcById(part.id);
        $$('a', n).forEach(function (a) {
          if ((a.getAttribute('href') || '').replace(/^\.\//, '') !== link) return;
          var li = a.parentElement;
          if (li && li.tagName === 'LI' && li.children.length === 1) srcRemove(li);
          else if (a.parentElement && /^(NAV|DIV|P)$/.test(a.parentElement.tagName)) srcRemove(a);
        });
      });
      return saveShared(true);
    }).then(function () {
      return api('/api/delete-page', { path: page });
    }).then(function (res) {
      state.savedKey = currentKey(); // its unsaved changes go with it
      toast(t('psDeleted', { path: res.backup || '' }));
      state.page = null;
      return reopenSite('index.html');
    }).catch(fail);
  });

  // ------------------------------------------------------------ design: colors and fonts of the whole site

  /*
   * Sites made with the templates (and many others) keep their colors and
   * fonts as CSS variables in :root of their stylesheet. The Design tab
   * shows them; a change is shown at once and written into the CSS file
   * when the page is saved, replacing only the value.
   */
  var design = { files: [], vars: [], edits: {} };
  var designSeq = 0;

  function joinPath(dir, href) {
    var parts = (dir ? dir.split('/') : []).concat(href.split('/'));
    var out = [];
    parts.forEach(function (p) {
      if (p === '..') out.pop();
      else if (p && p !== '.') out.push(p);
    });
    return out.join('/');
  }

  /* The custom properties set at the top level of :root rules, with where their values are. */
  function rootVars(text) {
    var clean = text.replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.replace(/[^\n]/g, ' '); });
    var out = [], depth = 0, from = 0, i;
    for (i = 0; i < clean.length; i++) {
      var c = clean[i];
      if (c === '{') {
        if (depth === 0) {
          var selector = clean.slice(from, i).trim();
          if (/^(:root|html)(\s*,\s*(:root|html))*$/.test(selector)) {
            var end = clean.indexOf('}', i);
            if (end < 0) break;
            var block = clean.slice(i + 1, end), re = /(--[\w-]+)(\s*:\s*)([^;{}]*?)(\s*)(?=;|$)/g, m;
            while ((m = re.exec(block))) {
              var start = i + 1 + m.index + m[1].length + m[2].length;
              out.push({ name: m[1], start: start, end: start + m[3].length, value: text.slice(start, start + m[3].length) });
            }
            i = end;
            from = end + 1;
            continue;
          }
        }
        depth++;
      } else if (c === '}') {
        depth = Math.max(0, depth - 1);
        if (depth === 0) from = i + 1;
      } else if (c === ';' && depth === 0) {
        from = i + 1;
      }
    }
    return out;
  }

  function varKind(name, value) {
    if (/var\(/.test(value)) return 'other';
    if (window.CSS && CSS.supports('color', value) && !/^(inherit|initial|unset|currentcolor|transparent)$/i.test(value)) return 'color';
    if (/font/i.test(name) && /[a-z]/i.test(value) && !/^[\d.]/.test(value)) return 'font';
    return 'other';
  }

  function varLabel(name) {
    var key = 'var_' + name.replace(/^--/, '').replace(/-/g, '_');
    var label = t(key);
    if (label !== key) return label;
    var words = name.replace(/^--/, '').replace(/[-_]+/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function loadDesign() {
    var seq = ++designSeq, dir = dirname(state.page);
    design = { files: [], vars: [], edits: {} };
    var hrefs = $$('link[rel~="stylesheet"][href]', state.src).map(function (l) { return l.getAttribute('href'); })
      .filter(function (h) { return !/^([a-z]+:|\/\/|\/)/i.test(h); })
      .map(function (h) { return joinPath(dir, h.split(/[?#]/)[0]); });
    return Promise.all(hrefs.map(function (path) {
      return api('/api/page?path=' + encodeURIComponent(path)).then(function (d) { return { path: path, text: d.source }; }, function () { return null; });
    })).then(function (files) {
      if (seq !== designSeq) return;
      var byName = {};
      design.files = files.filter(Boolean);
      design.files.forEach(function (f) {
        rootVars(f.text).forEach(function (v) {
          var entry = byName[v.name];
          if (!entry) {
            entry = byName[v.name] = { name: v.name, at: [] };
            design.vars.push(entry);
          }
          entry.at.push({ file: f.path, start: v.start, end: v.end });
          entry.value = v.value.trim(); // the last one wins, as in CSS
        });
      });
      design.vars.forEach(function (v) { v.kind = varKind(v.name, v.value); });
      renderDesign();
    });
  }

  function designValue(v) {
    return Object.prototype.hasOwnProperty.call(design.edits, v.name) ? design.edits[v.name] : v.value;
  }

  function cssColorToHex(value) {
    var probe = document.createElement('span');
    probe.style.color = value;
    document.body.appendChild(probe);
    var rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgbToHex(rgb);
  }

  function colorAlpha(value) {
    var probe = document.createElement('span');
    probe.style.color = value;
    document.body.appendChild(probe);
    var m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(getComputedStyle(probe).color);
    probe.remove();
    return m ? +m[1] : 1;
  }

  function setDesign(v, value) {
    if (value === v.value || value === '') delete design.edits[v.name];
    else design.edits[v.name] = value;
    applyDesign(state.doc);
    updateDirty();
  }

  /* Show the changed values in the page view (before they are saved). */
  function applyDesign(doc) {
    if (!doc || !doc.documentElement) return;
    design.vars.forEach(function (v) {
      if (Object.prototype.hasOwnProperty.call(design.edits, v.name)) doc.documentElement.style.setProperty(v.name, design.edits[v.name]);
      else doc.documentElement.style.removeProperty(v.name);
    });
    if (!doc.documentElement.getAttribute('style')) doc.documentElement.removeAttribute('style');
  }

  function fontOptions(current) {
    var seen = {}, list = [];
    WSETemplates.FONTS.forEach(function (f) {
      [['heading', f.heading], ['body', f.body]].forEach(function (pair) {
        if (seen[pair[1]]) return;
        seen[pair[1]] = true;
        var first = pair[1].split(',')[0].replace(/["']/g, '').trim();
        list.push({ value: pair[1], label: t('font_' + f.id) + ' (' + (first === 'system-ui' ? 'System' : first) + ')' });
      });
    });
    if (!seen[current]) list.unshift({ value: current, label: t('fontCustom', { font: current.split(',')[0].replace(/["']/g, '').trim() }) });
    return list;
  }

  function renderDesign() {
    var root = $('#design');
    root.innerHTML = '';
    if (!design.vars.length) {
      root.appendChild(el('p', { 'class': 'hint', text: t('designNone') }));
      return;
    }
    var groups = { color: [], font: [], other: [] };
    design.vars.forEach(function (v) { groups[v.kind].push(v); });
    var row = function (v, control) {
      var reset = el('button', { type: 'button', 'class': 'icon-btn small', title: t('designReset'), onclick: function () { setDesign(v, v.value); renderDesign(); } }, [icon('undo')]);
      reset.hidden = !Object.prototype.hasOwnProperty.call(design.edits, v.name);
      control.addEventListener('input', function () { reset.hidden = !Object.prototype.hasOwnProperty.call(design.edits, v.name); });
      control.addEventListener('change', function () { reset.hidden = !Object.prototype.hasOwnProperty.call(design.edits, v.name); });
      return el('div', { 'class': 'design-row', title: v.name }, [el('span', { 'class': 'design-label', text: varLabel(v.name) }), control, reset]);
    };
    if (groups.color.length) {
      root.appendChild(el('h3', { text: t('designColors') }));
      groups.color.forEach(function (v) {
        var value = designValue(v);
        var pick = el('input', { type: 'color', value: cssColorToHex(value) });
        var text = el('input', { type: 'text', value: value, spellcheck: 'false' });
        pick.addEventListener('input', function () {
          // Keep the transparency of the color (the color picker has none).
          var alpha = colorAlpha(v.value), val = pick.value;
          if (alpha < 1) {
            var n = parseInt(val.slice(1), 16);
            val = 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + alpha + ')';
          }
          text.value = val;
          setDesign(v, val);
        });
        text.addEventListener('change', function () {
          var val = text.value.trim();
          if (val && !CSS.supports('color', val)) { text.value = designValue(v); return; }
          setDesign(v, val || v.value);
          pick.value = cssColorToHex(designValue(v));
        });
        root.appendChild(row(v, el('span', { 'class': 'color-pair' }, [pick, text])));
      });
    }
    if (groups.font.length) {
      root.appendChild(el('h3', { text: t('designFonts') }));
      groups.font.forEach(function (v) {
        var value = designValue(v);
        var select = el('select', {});
        fontOptions(value).forEach(function (o) {
          var opt = el('option', { value: o.value, text: o.label, style: 'font-family:' + o.value });
          if (o.value === value) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener('change', function () { setDesign(v, select.value); });
        root.appendChild(row(v, select));
      });
    }
    if (groups.other.length) {
      var more = el('details', { 'class': 'design-more' }, [el('summary', { text: t('designOther') })]);
      groups.other.forEach(function (v) {
        var input = el('input', { type: 'text', value: designValue(v), spellcheck: 'false' });
        input.addEventListener('change', function () { setDesign(v, input.value.trim()); });
        more.appendChild(row(v, input));
      });
      root.appendChild(more);
    }
    root.appendChild(el('p', { 'class': 'hint', text: t('designFrom', { file: design.files.map(function (f) { return f.path; }).join(', ') }) }));
  }

  /* Write changed values into the CSS files: only the values change, the rest stays as it is. */
  function saveDesign() {
    if (isEmpty(design.edits)) return Promise.resolve();
    var byFile = {};
    design.vars.forEach(function (v) {
      if (!Object.prototype.hasOwnProperty.call(design.edits, v.name)) return;
      v.at.forEach(function (at) { (byFile[at.file] = byFile[at.file] || []).push({ start: at.start, end: at.end, value: design.edits[v.name] }); });
    });
    return Object.keys(byFile).reduce(function (chain, path) {
      return chain.then(function () {
        var file = design.files.filter(function (f) { return f.path === path; })[0];
        var text = file.text;
        byFile[path].sort(function (a, b) { return b.start - a.start; }).forEach(function (r) {
          text = text.slice(0, r.start) + r.value + text.slice(r.end);
        });
        return api('/api/save', { path: path, content: text });
      });
    }, Promise.resolve()).then(function () {
      return loadDesign();
    });
  }

  // ------------------------------------------------------------ saving

  var PLACEHOLDER_RE = /<script type="text\/x-wse-off" data-wse-idx="(\d+)"><\/script>/g;

  /* Put the original scripts back. mark: tag them so the live view can map them. */
  function restoreScripts(html, mark) {
    return html.replace(PLACEHOLDER_RE, function (_, i) {
      if (state.dropScripts[i]) return '';
      var text = state.scripts[+i] || '';
      return mark ? text.replace(/^<script/i, '<script data-wse-sidx="' + i + '"') : text;
    });
  }

  function styleBlock(css) {
    return '<style id="' + S.STYLE_ID + '">\n/* Styles changed with WYSIWYG Edit */\n' + css + '</style>';
  }

  function syncWholeDocStyle(css) {
    var styleEl = state.src.getElementById(S.STYLE_ID);
    if (!css) { if (styleEl) styleEl.remove(); return; }
    if (!styleEl) {
      styleEl = state.src.createElement('style');
      styleEl.id = S.STYLE_ID;
      state.src.head.appendChild(styleEl);
    }
    styleEl.textContent = '\n/* Styles changed with WYSIWYG Edit */\n' + css;
  }

  /* Put the editor's <style> block into the page's <head> source. */
  function headWithStyles(prefix, css) {
    var re = /([ \t]*)<style\b[^>]*\bid\s*=\s*["']?wysiwyg-edit-styles\b[^>]*>[\s\S]*?<\/style\s*>(\r?\n)?/i;
    var m = re.exec(prefix);
    if (m) {
      var replacement = css ? m[1] + styleBlock(css) + (m[2] || '') : '';
      return prefix.slice(0, m.index) + replacement + prefix.slice(m.index + m[0].length);
    }
    if (!css) return prefix;
    var eol = /\r\n/.test(prefix) ? '\r\n' : '\n';
    var headEnd = prefix.search(/<\/head\s*>/i);
    if (headEnd >= 0) {
      var indent = /\n([ \t]*)[^\n]*$/.exec(prefix.slice(0, headEnd));
      var pad = indent && !indent[0].slice(1).trim().length ? indent[1] : '';
      var lineStart = prefix.lastIndexOf('\n', headEnd - 1) + 1;
      var onOwnLine = !prefix.slice(lineStart, headEnd).trim();
      var at = onOwnLine ? lineStart : headEnd;
      return prefix.slice(0, at) + (onOwnLine ? pad + '  ' : '') + styleBlock(css) + eol + prefix.slice(at);
    }
    var bodyAt = prefix.search(/<body\b/i);
    return prefix.slice(0, bodyAt) + styleBlock(css) + eol + prefix.slice(bodyAt);
  }

  function buildOutput() {
    if (state.editing) finishEditing();
    var css = S.serialize(state.model);
    if (state.wholeDoc) {
      syncWholeDocStyle(css);
      return '<!DOCTYPE html>\n' + restoreScripts(stripIds(state.src.documentElement.outerHTML));
    }
    var body = state.src.body.innerHTML.replace(PLACEHOLDER_RE, function (m, i) { return state.dropScripts[i] ? '' : m; });
    body = stripIds(body);
    // Whitespace after </body> ends up inside <body> when the browser reads it; put it back.
    body = body.replace(/\s+$/, '') + state.bodyTrail;
    return headWithStyles(state.prefix, css) + restoreScripts(keepTagLayout(bareAttributes(keepEntities(body)))) + state.suffix;
  }

  /* Save the page (and the site's CSS when the Design tab changed it). opts.autoShare: no question about shared parts. */
  function save(opts) {
    if (!state.src) return Promise.resolve();
    var label = $('#save-label');
    label.textContent = t('saving');
    var content = buildOutput();
    var key = currentKey({});
    return api('/api/save', { path: state.page, content: content }).then(function (res) {
      state.savedKey = key + (isEmpty(design.edits) ? '' : '*');
      updateDirty();
      toast(res.backup ? t('savedTo', { path: res.backup }) : t('saved') + ' ✓');
      return saveDesign().then(function () {
        if (state.savedKey === key + '*') state.savedKey = key;
        updateDirty();
        return saveShared(opts && opts.autoShare === true);
      }).then(function (count) {
        if (count) toast(t('sharedDone', { n: count }) + ' ✓');
        renderCrumbs();
      });
    }).catch(fail).then(function () { label.textContent = t('save'); });
  }

  $('#btn-save').addEventListener('click', function () { save(); });

  // ------------------------------------------------------------ preview & devices

  $('#btn-preview').addEventListener('click', function () {
    var url = '/site/' + encodePath(state.page);
    var win = window.open('about:blank', 'wse-preview');
    if (isDirty() && confirm(t('unsavedPreview'))) {
      save().then(function () { if (win) win.location = url; });
    } else if (win) {
      win.location = url;
    }
  });

  $('#btn-phone').addEventListener('click', function () {
    api('/api/phone', {}).then(function (res) {
      var url = res.url + encodePath(state.page);
      var a = $('#phone-url');
      a.href = url;
      a.textContent = url;
      $('#phone-dialog').showModal();
    }).catch(fail);
  });

  $$('.device').forEach(function (b) {
    b.addEventListener('click', function () {
      state.device = b.getAttribute('data-device');
      $$('.device').forEach(function (x) { x.classList.toggle('active', x === b); });
      var width = S.WIDTHS[state.device];
      var wrap = $('#frame-wrap');
      wrap.style.width = width ? width + 'px' : '';
      wrap.classList.toggle('framed', !!width);
      setTimeout(refreshStylePanel, 250);
    });
  });

  $$('dialog [data-close]').forEach(function (b) {
    b.addEventListener('click', function () { b.closest('dialog').close(); });
  });

  // ------------------------------------------------------------ keyboard

  function typingInPanel(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    return e.target.ownerDocument === document && (tag === 'input' || tag === 'textarea' || tag === 'select');
  }

  function onKey(e) {
    var mod = e.metaKey || e.ctrlKey;
    var key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); save(); return; }
    if (state.editing) {
      if (e.key === 'Escape') { e.preventDefault(); finishEditing(); }
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (/^(P|LI)$/.test(state.editing.tagName)) splitBlock();
        else finishEditing();
      } else if (e.key === ' ' && state.editing.closest('summary')) {
        e.preventDefault(); // a space would open or close the accordion instead of typing
        state.doc.execCommand('insertText', false, ' ');
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        state.doc.execCommand('insertLineBreak');
      }
      return;
    }
    if (typingInPanel(e)) return;
    if (e.key === 'Escape' && state.interact) { setInteract(false); return; }
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    if (!state.selected) return;
    if (e.key === 'Escape') { e.preventDefault(); deselect(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); act('delete'); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.selected.tagName === 'IMG') changeImage();
      else act('edit');
    }
  }

  document.addEventListener('keydown', onKey);

  // ------------------------------------------------------------ start

  applyI18n(document);
  document.documentElement.lang = window.WSE_LANG;
  buildBlocks();
  buildStylePanel();
  updateStatus();
  api('/api/state').then(function (data) {
    if (data.root) openSite(data); else showStart();
  }).catch(fail);

  // For automated tests.
  window.WSE = {
    state: state, drag: drag, buildOutput: buildOutput, save: save, select: select, act: act, setStyle: setStyle,
    liveById: liveById, undo: undo, redo: redo, setInteract: setInteract,
    ready: function () { return !!state.doc && state.shownSeq === renderSeq; }
  };
})();
