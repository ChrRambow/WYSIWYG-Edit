/*
 * WYSIWYG Edit - the editor.
 *
 * The page being edited is loaded into an iframe straight from the local
 * server, so it looks exactly like the real site: its own CSS, fonts,
 * images and media queries. Its <script> elements are swapped for inert
 * placeholders by the server, so scripts do not run (and change the page)
 * while editing. On save, the editor takes the edited <body>, puts the
 * original scripts back byte for byte, and splices the result into the
 * original file, so everything outside <body> (doctype, <head>, comments)
 * stays exactly as it was. The only addition is one <style> block in the
 * <head> with the styles changed in the editor.
 */
(function () {
  'use strict';

  var S = window.WSEStyles;

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
  function toast(msg, isError) {
    var box = $('#toast');
    box.textContent = msg;
    box.className = 'toast' + (isError ? ' error' : '');
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, isError ? 7000 : 3500);
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
    doc: null,           // the iframe's document
    win: null,
    styleEl: null,       // <style id="wysiwyg-edit-styles"> inside the iframe
    model: S.create(),
    device: 'desktop',
    selected: null,
    hovered: null,
    editing: null,
    editingAttr: null,
    target: 'self',      // "self" or a class name the style panel applies to
    history: [],
    hIndex: -1,
    savedKey: ''
  };

  var frame = $('#frame');

  // ------------------------------------------------------------ start screen

  function showStart(error) {
    $('#app').hidden = true;
    $('#start').hidden = false;
    var err = $('#start-error');
    err.hidden = !error;
    err.textContent = error ? t('error', { msg: error }) : '';
    api('/api/state').then(function (data) {
      var list = $('#recent');
      list.innerHTML = '';
      (data.recent || []).forEach(function (path) {
        list.appendChild(el('li', {}, [el('button', { 'class': 'link', text: path, onclick: function () { openFolder(path); } })]));
      });
      $('#recent-wrap').hidden = !(data.recent || []).length;
      $('#choose-folder').hidden = data.platform !== 'darwin';
    }).catch(fail);
  }

  function openFolder(path) {
    api('/api/open', { path: path }).then(openSite, function (e) { showStart(e.message); });
  }

  $('#choose-folder').addEventListener('click', function () {
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
    $('#app').hidden = false;
    $('#site-name').textContent = data.name;
    var select = $('#page-select');
    select.innerHTML = '';
    data.pages.forEach(function (p) { select.appendChild(el('option', { value: p, text: p })); });
    if (!data.pages.length) {
      showStart(data.root + ': no .html files');
      return;
    }
    loadPage(data.pages[0]);
  }

  function refreshSite() {
    return api('/api/state').then(function (data) { state.site = data; return data; });
  }

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
    $('#page-select').value = path;
    api('/api/page?path=' + encodeURIComponent(path)).then(function (data) {
      splitSource(data.source, data.scripts);
      frame.onload = setupFrame;
      frame.src = '/site/' + encodePath(path) + '?edit=1';
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
    state.wholeDoc = !open;
    if (open) {
      var bodyStart = open.index + open[0].length;
      var bodyEnd = close < 0 ? source.length : close;
      state.prefix = source.slice(0, bodyStart);
      state.suffix = source.slice(bodyEnd);
      var bodySource = source.slice(bodyStart, bodyEnd);
      state.bodyTrail = /\s*$/.exec(bodySource)[0];
      learnEntities(bodySource);
      scripts.forEach(function (s, i) {
        if (s.start < bodyStart || s.start >= bodyEnd) state.dropScripts[i] = true;
      });
    }
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

  function setupFrame() {
    var doc = frame.contentDocument;
    state.doc = doc;
    state.win = frame.contentWindow;
    state.styleEl = doc.getElementById(S.STYLE_ID);
    if (!state.styleEl) {
      state.styleEl = doc.createElement('style');
      state.styleEl.id = S.STYLE_ID;
      (doc.head || doc.documentElement).appendChild(state.styleEl);
    }
    state.model = S.parse(state.styleEl.textContent);
    writeStyles();

    // Editor-only helper styles, removed again before saving.
    var helper = doc.createElement('style');
    helper.id = 'wse-helper';
    helper.textContent = '[contenteditable]{outline:none;cursor:text}';
    doc.head.appendChild(helper);

    doc.addEventListener('mouseover', onFrameOver, true);
    doc.addEventListener('mouseleave', function () { state.hovered = null; }, true);
    doc.addEventListener('mousedown', onFrameMouseDown, true);
    doc.addEventListener('click', onFrameClick, true);
    doc.addEventListener('dblclick', onFrameDblClick, true);
    doc.addEventListener('submit', function (e) { e.preventDefault(); }, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('paste', onPaste, true);
    doc.addEventListener('dragstart', function (e) { if (!state.editing) e.preventDefault(); }, true);

    state.history = [];
    state.hIndex = -1;
    commit();
    state.savedKey = currentKey();
    updateDirty();
    renderPanels();
  }

  function writeStyles() {
    if (state.styleEl) state.styleEl.textContent = S.serialize(state.model);
  }

  // ------------------------------------------------------------ frame events

  function selectable(node) {
    if (!node || node.nodeType !== 1) return null;
    var body = state.doc.body;
    while (node && node !== body && node.closest && node.closest('svg') && node.tagName.toLowerCase() !== 'svg') {
      node = node.parentElement; // select the whole icon, not its paths
    }
    if (!node || node === body || node === state.doc.documentElement || !body.contains(node)) return null;
    return node;
  }

  function onFrameOver(e) {
    state.hovered = selectable(e.target);
  }

  function onFrameMouseDown(e) {
    if (state.editing && !state.editing.contains(e.target)) finishEditing();
  }

  function onFrameClick(e) {
    if (state.editing && state.editing.contains(e.target)) {
      e.preventDefault(); // keep links from navigating while typing
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    select(selectable(e.target));
  }

  function onFrameDblClick(e) {
    e.preventDefault();
    e.stopPropagation();
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

  // ------------------------------------------------------------ overlay

  function placeBox(box, node) {
    if (!node || !state.doc || !state.doc.contains(node)) {
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
    var h = bar.offsetHeight || 30;
    var top = r.top - h - 4;
    if (top < 2) top = r.bottom + 4;
    if (top + h > wrap.height) top = Math.max(2, r.top + 2);
    var left = Math.min(Math.max(2, r.left), Math.max(2, wrap.width - bar.offsetWidth - 2));
    bar.style.top = top + 'px';
    bar.style.left = left + 'px';
  }

  function tick() {
    if (state.selected && !(state.doc && state.doc.contains(state.selected))) deselect();
    var hover = state.hovered !== state.selected ? state.hovered : null;
    placeBox($('#hover-box'), hover);
    var r = placeBox($('#select-box'), state.selected);
    if (state.editing) {
      $('#el-toolbar').hidden = true;
      placeToolbar($('#rte-toolbar'), r);
    } else {
      $('#rte-toolbar').hidden = true;
      placeToolbar($('#el-toolbar'), r);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ------------------------------------------------------------ selection

  function label(node) {
    var tag = node.tagName.toLowerCase();
    var name = t('tag_' + tag);
    if (name === 'tag_' + tag) name = '<' + tag + '>';
    var cls = Array.prototype.filter.call(node.classList, function (c) { return !/^wse-/.test(c); })[0];
    if (node.id) name += ' #' + node.id;
    else if (cls) name += ' .' + cls;
    return name;
  }

  function select(node) {
    if (state.editing && node !== state.editing) finishEditing();
    state.selected = node || null;
    state.target = 'self';
    renderPanels();
  }

  function deselect() {
    if (state.editing) finishEditing();
    state.selected = null;
    renderPanels();
  }

  function renderCrumbs() {
    var nav = $('#crumbs');
    nav.innerHTML = '';
    var node = state.selected;
    var chain = [];
    while (node && node !== state.doc.body) { chain.unshift(node); node = node.parentElement; }
    chain.forEach(function (n, i) {
      if (i) nav.appendChild(el('span', { 'class': 'crumb-sep', text: '›' }));
      nav.appendChild(el('button', { 'class': 'crumb' + (n === state.selected ? ' current' : ''), text: label(n), onclick: function () { select(n); } }));
    });
    if (!chain.length) nav.appendChild(el('span', { 'class': 'hint', text: t('scriptsOff') }));
  }

  function renderPanels() {
    var has = !!state.selected;
    $('#empty-note').hidden = has;
    $$('.tab-body').forEach(function (b) { b.classList.toggle('disabled', !has); });
    if (state.doc) renderCrumbs();
    if (!has) {
      $('#tab-style').hidden = true;
      $('#tab-settings').hidden = true;
      $('#tab-html').hidden = true;
      return;
    }
    var tab = $('.tab.active').getAttribute('data-tab');
    $('#tab-style').hidden = tab !== 'style';
    $('#tab-settings').hidden = tab !== 'settings';
    $('#tab-html').hidden = tab !== 'html';
    $('#tb-label').textContent = label(state.selected);
    $('#el-toolbar [data-act="edit"]').hidden = !textTarget(state.selected);
    $('#el-toolbar [data-act="image"]').hidden = state.selected.tagName !== 'IMG';
    refreshStylePanel();
    renderSettings();
    $('#html-code').value = restoreScripts(state.selected.outerHTML);
  }

  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.tab').forEach(function (x) { x.classList.toggle('active', x === tab); });
      renderPanels();
    });
  });

  // ------------------------------------------------------------ element actions

  function newStyleClass() {
    return 'wse-' + Math.random().toString(36).slice(2, 8);
  }

  function ownClass(node) {
    return Array.prototype.filter.call(node.classList, function (c) { return /^wse-[a-z0-9]+$/.test(c); })[0];
  }

  function act(name) {
    var node = state.selected;
    if (!node) return;
    if (name === 'parent') {
      if (node.parentElement && node.parentElement !== state.doc.body) select(node.parentElement);
      return;
    }
    if (name === 'edit') {
      var text = textTarget(node);
      if (text) { select(text); startEditing(text); }
      return;
    }
    if (name === 'image') return changeImage();
    if (name === 'up' || name === 'down') {
      var sib = name === 'up' ? node.previousElementSibling : node.nextElementSibling;
      while (sib && isPlaceholder(sib)) sib = name === 'up' ? sib.previousElementSibling : sib.nextElementSibling;
      if (!sib) return;
      if (name === 'up') sib.before(node); else sib.after(node);
      commit();
      return;
    }
    if (name === 'duplicate') {
      var copy = node.cloneNode(true);
      copy.removeAttribute('id');
      $$('[id]', copy).forEach(function (n) { n.removeAttribute('id'); });
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
      node.after(copy);
      select(copy);
      commit();
      return;
    }
    if (name === 'delete') {
      var next = node.nextElementSibling || node.previousElementSibling || node.parentElement;
      node.remove();
      select(next && next !== state.doc.body && !isPlaceholder(next) ? next : null);
      commit();
    }
  }

  function isPlaceholder(node) {
    return node.tagName === 'SCRIPT' && node.getAttribute('type') === 'text/x-wse-off';
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
    while (node.parentElement && node.parentElement !== state.doc.body && isInline(node)) {
      node = node.parentElement;
    }
    var blockChild = Array.prototype.some.call(node.children, function (c) {
      return !isInline(c) && c.tagName !== 'BR' && !isPlaceholder(c);
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
    state.editingHadStyle = node.hasAttribute('style');
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
  }

  function finishEditing() {
    var node = state.editing;
    if (!node) return;
    state.editing = null;
    if (state.editingAttr === null) node.removeAttribute('contenteditable');
    else node.setAttribute('contenteditable', state.editingAttr);
    // Chrome sometimes leaves an empty style="" behind on edited text.
    if (!state.editingHadStyle && node.getAttribute('style') === '') node.removeAttribute('style');
    var sel = state.doc.getSelection();
    if (sel) sel.removeAllRanges();
    commit();
    renderPanels();
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
    var classes = Array.prototype.filter.call(node.classList, function (c) { return !/^wse-/.test(c); });
    if (classes.length) fresh.className = classes.join(' ');
    var own = ownClass(node);
    if (own) fresh.classList.add(own);
    fresh.appendChild(rest.extractContents());
    if (!fresh.textContent) fresh.innerHTML = '<br>';
    if (!node.textContent && !node.querySelector('img')) node.innerHTML = '<br>';
    node.after(fresh);
    finishEditing();
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
      node.setAttribute('src', src);
      node.removeAttribute('srcset'); // the old responsive versions would win otherwise
      if (node.parentElement && node.parentElement.tagName === 'PICTURE') {
        $$('source', node.parentElement).forEach(function (s) { s.remove(); });
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
  var controls = []; // { prop, def, set(value, placeholder), resetBtn }

  /* The selector style changes go to. Creates the element's own class if needed. */
  function styleSelector(create) {
    var node = state.selected;
    if (!node) return null;
    if (state.target !== 'self') return '.' + CSS.escape(state.target);
    var own = ownClass(node);
    if (!own && create) {
      own = newStyleClass();
      node.classList.add(own);
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
      state.selected.classList.remove(sel.slice(1)); // no styles left, drop the helper class
      if (!state.selected.classList.length) state.selected.removeAttribute('class');
    }
    writeStyles();
    commit();
    refreshStylePanel();
  }

  function unitInput(prop, def, placeholderOnly) {
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
      t('hideHere')
    ]));

    SECTIONS.forEach(function (sec, i) {
      var details = el('details', { 'class': 'sec', open: i < 3 ? '' : null }, [el('summary', { text: t(sec.title) })]);
      sec.props.forEach(function (def) { details.appendChild(buildControl(def)); });
      root.appendChild(details);
    });
  }

  function buildControl(def) {
    var row = el('div', { 'class': 'prop prop-' + def.type });
    var reset = el('button', { 'class': 'reset', title: t('reset'), text: '×' });
    var lbl = el('label', { text: t(def.label) });
    row.appendChild(lbl);
    var field = el('div', { 'class': 'field' });
    row.appendChild(field);
    row.appendChild(reset);
    var ctl = { def: def, reset: reset };

    if (def.type === 'unit') {
      var input = unitInput(def.prop, def);
      field.appendChild(input);
      ctl.set = function (v, ph) { input.value = v; input.placeholder = ph; };
      reset.onclick = function () { setStyle(def.prop, ''); };
    } else if (def.type === 'font') {
      var fin = el('input', { type: 'text', list: 'font-list', spellcheck: 'false' });
      var list = el('datalist', { id: 'font-list' }, FONTS.map(function (f) { return el('option', { value: f }); }));
      fin.addEventListener('change', function () { setStyle(def.prop, fin.value); });
      field.appendChild(fin);
      field.appendChild(list);
      ctl.set = function (v, ph) { fin.value = v; fin.placeholder = ph; };
      reset.onclick = function () { setStyle(def.prop, ''); };
    } else if (def.type === 'select') {
      var sel = el('select', {}, [el('option', { value: '', text: '–' })].concat(def.options.map(function (o) {
        return el('option', { value: o[0], text: o[1] });
      })));
      sel.addEventListener('change', function () { setStyle(def.prop, sel.value); });
      field.appendChild(sel);
      ctl.set = function (v, ph) {
        sel.value = v;
        sel.options[0].textContent = ph ? '– (' + ph + ')' : '–';
      };
      reset.onclick = function () { setStyle(def.prop, ''); };
    } else if (def.type === 'color') {
      var color = el('input', { type: 'color' });
      var text = el('input', { type: 'text', 'class': 'unit', spellcheck: 'false' });
      color.addEventListener('input', function () { text.value = color.value; });
      color.addEventListener('change', function () { setStyle(def.prop, color.value); });
      text.addEventListener('change', function () { setStyle(def.prop, text.value); });
      field.appendChild(color);
      field.appendChild(text);
      ctl.set = function (v, ph) { color.value = rgbToHex(v || ph); text.value = v; text.placeholder = ph; };
      reset.onclick = function () { setStyle(def.prop, ''); };
    } else if (def.type === 'buttons') {
      var btns = def.options.map(function (o) {
        var b = el('button', { 'class': 'seg', title: o[0], text: o[1], onclick: function () { setStyle(def.prop, o[0]); } });
        field.appendChild(b);
        return b;
      });
      ctl.set = function (v, ph) {
        btns.forEach(function (b, i) {
          b.classList.toggle('on', def.options[i][0] === v);
          b.classList.toggle('inherited', !v && def.options[i][0] === ph);
        });
      };
      reset.onclick = function () { setStyle(def.prop, ''); };
    } else if (def.type === 'bgimage') {
      var thumb = el('span', { 'class': 'bg-thumb' });
      var choose = el('button', { 'class': 'btn small', text: t('choose'), onclick: function () {
        openImagePicker(function (src) { setStyle(def.prop, 'url("' + src + '")'); });
      } });
      field.appendChild(thumb);
      field.appendChild(choose);
      ctl.set = function (v) {
        thumb.textContent = v ? decodeURIComponent(v.replace(/^url\(["']?|["']?\)$/g, '').split('/').pop()) : t('none');
      };
      reset.onclick = function () { setStyle(def.prop, ''); };
    } else if (def.type === 'box') {
      var inputs = SIDES.map(function (side) {
        var sub = { prop: def.prop + '-' + side, type: 'unit' };
        var inp = unitInput(sub.prop, sub);
        inp.title = t(side);
        field.appendChild(el('span', { 'class': 'side' }, [inp, el('small', { text: t(side) })]));
        return inp;
      });
      ctl.boxInputs = inputs;
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
    var classes = Array.prototype.filter.call(node.classList, function (c) { return !/^wse-/.test(c); });
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

  function attrInput(node, attr, opts) {
    opts = opts || {};
    var input = el('input', { type: 'text', value: node.getAttribute(attr) || '', spellcheck: 'false', list: opts.list || null });
    input.addEventListener('change', function () {
      var v = input.value.trim();
      if (attr === 'class') {
        var own = ownClass(node);
        v = (v + (own ? ' ' + own : '')).trim();
      }
      if (v) node.setAttribute(attr, v); else node.removeAttribute(attr);
      if (attr === 'src' && node.tagName === 'IMG') node.removeAttribute('srcset');
      commit();
      renderPanels();
    });
    return input;
  }

  function renderSettings() {
    var root = $('#tab-settings');
    var node = state.selected;
    root.innerHTML = '';
    var tag = node.tagName;

    if (tag === 'A') {
      var pages = el('datalist', { id: 'page-list' }, state.site.pages.map(function (p) { return el('option', { value: relFromPage(p) }); }));
      root.appendChild(pages);
      root.appendChild(field(t('linkUrl'), attrInput(node, 'href', { list: 'page-list' })));
      var box = el('input', { type: 'checkbox' });
      box.checked = node.getAttribute('target') === '_blank';
      box.addEventListener('change', function () {
        if (box.checked) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener');
        } else {
          node.removeAttribute('target');
          if (node.getAttribute('rel') === 'noopener') node.removeAttribute('rel');
        }
        commit();
      });
      root.appendChild(el('label', { 'class': 'check' }, [box, t('newTab')]));
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
    classInput.value = Array.prototype.filter.call(node.classList, function (c) { return !/^wse-/.test(c); }).join(' ');
    root.appendChild(field(t('classes'), classInput));
    root.appendChild(field(t('id'), attrInput(node, 'id')));
  }

  // ------------------------------------------------------------ HTML panel

  $('#html-apply').addEventListener('click', function () {
    var node = state.selected;
    if (!node) return;
    var tpl = state.doc.createElement('template');
    tpl.innerHTML = $('#html-code').value;
    var nodes = Array.prototype.slice.call(tpl.content.childNodes);
    if (!nodes.length) return;
    var first = nodes.filter(function (n) { return n.nodeType === 1; })[0];
    node.replaceWith.apply(node, nodes);
    select(first ? state.doc.body.contains(first) && first : null);
    commit();
  });

  // ------------------------------------------------------------ blocks

  var BLOCKS = [
    { key: 'blkHeading', icon: 'H', html: function () { return '<h2>' + t('newHeading') + '</h2>'; } },
    { key: 'blkParagraph', icon: '¶', html: function () { return '<p>' + t('newParagraph') + '</p>'; } },
    { key: 'blkImage', icon: '🖼', image: true, html: function () { return '<img src="" alt="" style="max-width:100%;height:auto">'; } },
    { key: 'blkButton', icon: '▭', html: function () {
      return '<a href="#" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">' + t('newButton') + '</a>';
    } },
    { key: 'blkLink', icon: '🔗', html: function () { return '<a href="#">' + t('newLink') + '</a>'; } },
    { key: 'blkList', icon: '•', html: function () {
      return '<ul>\n  <li>' + t('newItem') + '</li>\n  <li>' + t('newItem') + '</li>\n</ul>';
    } },
    { key: 'blkSection', icon: '▤', html: function () {
      return '<section style="padding:48px 20px">\n  <h2>' + t('newHeading') + '</h2>\n  <p>' + t('newParagraph') + '</p>\n</section>';
    } },
    { key: 'blkTwoCols', icon: '◫', html: function () { return columns(2); } },
    { key: 'blkThreeCols', icon: '▥', html: function () { return columns(3); } },
    { key: 'blkDivider', icon: '―', html: function () { return '<hr>'; } },
    { key: 'blkSpacer', icon: '↕', html: function () { return '<div style="height:40px"></div>'; } },
    { key: 'blkVideo', icon: '▶', video: true }
  ];

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

  /* Where a new block goes: after the selected element (or its block container). */
  function insertPoint() {
    var node = state.selected;
    var body = state.doc.body;
    if (node) {
      while (node.parentElement && node.parentElement !== body &&
             (/^(LI|TD|TH|TR|THEAD|TBODY|DT|DD|FIGCAPTION|SOURCE)$/.test(node.tagName) || isInline(node))) {
        node = node.parentElement;
      }
      return { after: node };
    }
    var container = state.doc.querySelector('main') || body;
    var last = container.lastElementChild;
    while (last && isPlaceholder(last)) last = last.previousElementSibling;
    return last ? { after: last } : { inside: container };
  }

  function insertBlock(block) {
    if (!state.doc) return;
    var html = block.html ? block.html() : null;
    if (block.video) {
      html = youtubeEmbed(prompt(t('videoPrompt'), 'https://www.youtube.com/watch?v='));
      if (!html) return;
    }
    var tpl = state.doc.createElement('template');
    tpl.innerHTML = html;
    var node = tpl.content.firstElementChild;
    var at = insertPoint();
    if (at.after) at.after.after(node); else at.inside.appendChild(node);
    // Keep the source readable: put the new block on its own line.
    node.before(state.doc.createTextNode('\n'));
    select(node);
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    commit();
    if (block.image) changeImage();
  }

  function buildBlocks() {
    var root = $('#blocks');
    BLOCKS.forEach(function (b) {
      root.appendChild(el('button', { 'class': 'block', onclick: function () { insertBlock(b); } }, [
        el('span', { 'class': 'block-icon', text: b.icon }), el('span', { text: t(b.key) })
      ]));
    });
  }

  // ------------------------------------------------------------ history

  function nodePath(node) {
    var path = [];
    while (node && node.parentElement && node !== state.doc.body) {
      path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
      node = node.parentElement;
    }
    return path;
  }

  function nodeAt(path) {
    var node = state.doc.body;
    for (var i = 0; i < path.length && node; i++) node = node.children[path[i]];
    return node && node !== state.doc.body ? node : null;
  }

  function snapshot() {
    return { html: state.doc.body.innerHTML, css: S.serialize(state.model), model: S.clone(state.model) };
  }

  function currentKey() {
    if (!state.doc) return '';
    var editing = state.editing;
    if (editing) editing.removeAttribute('contenteditable');
    var key = state.doc.body.innerHTML + '\u0000' + S.serialize(state.model);
    if (editing) editing.setAttribute('contenteditable', 'true');
    return key;
  }

  function commit() {
    if (!state.doc) return;
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
    var path = state.selected ? nodePath(state.selected) : null;
    state.hIndex = index;
    var snap = state.history[index];
    state.doc.body.innerHTML = snap.html;
    state.model = S.clone(snap.model);
    writeStyles();
    state.selected = path ? nodeAt(path) : null;
    state.hovered = null;
    renderPanels();
    updateDirty();
  }

  function undo() { restore(state.hIndex - 1); }
  function redo() { restore(state.hIndex + 1); }

  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);

  function isDirty() {
    return !!state.doc && currentKey() !== state.savedKey;
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

  // ------------------------------------------------------------ saving

  var PLACEHOLDER_RE = /<script type="text\/x-wse-off" data-wse-idx="(\d+)"><\/script>/g;

  function restoreScripts(html) {
    return html.replace(PLACEHOLDER_RE, function (_, i) {
      return state.dropScripts[i] ? '' : (state.scripts[+i] || '');
    });
  }

  function styleBlock(css) {
    return '<style id="' + S.STYLE_ID + '">\n/* Styles changed with WYSIWYG Edit */\n' + css + '</style>';
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
    var doc = state.doc;
    var css = S.serialize(state.model);
    if (state.wholeDoc) {
      var helper = doc.getElementById('wse-helper');
      if (helper) helper.remove();
      if (!css) state.styleEl.remove();
      var html = '<!DOCTYPE html>\n' + restoreScripts(doc.documentElement.outerHTML);
      if (!css) doc.head.appendChild(state.styleEl);
      if (helper) doc.head.appendChild(helper);
      return html;
    }
    var body = doc.body.innerHTML.replace(PLACEHOLDER_RE, function (m, i) { return state.dropScripts[i] ? '' : m; });
    // Whitespace after </body> ends up inside <body> when the browser reads it; put it back.
    body = body.replace(/\s+$/, '') + state.bodyTrail;
    return headWithStyles(state.prefix, css) + restoreScripts(keepEntities(body)) + state.suffix;
  }

  function save() {
    if (!state.doc) return Promise.resolve();
    var btn = $('#btn-save');
    btn.textContent = t('saving');
    var content = buildOutput();
    var key = currentKey();
    return api('/api/save', { path: state.page, content: content }).then(function (res) {
      state.savedKey = key;
      updateDirty();
      toast(res.backup ? t('savedTo', { path: res.backup }) : t('saved') + ' ✓');
    }).catch(fail).then(function () { btn.textContent = t('save'); });
  }

  $('#btn-save').addEventListener('click', save);

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
      setTimeout(refreshStylePanel, 50);
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
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        state.doc.execCommand('insertLineBreak');
      }
      return;
    }
    if (typingInPanel(e)) return;
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
  api('/api/state').then(function (data) {
    if (data.root) openSite(data); else showStart();
  }).catch(fail);

  // For automated tests.
  window.WSE = { state: state, buildOutput: buildOutput, save: save, select: select, act: act, setStyle: setStyle,
    insertBlock: function (key) { insertBlock(BLOCKS.filter(function (b) { return b.key === key; })[0]); },
    startEditing: startEditing, finishEditing: finishEditing, undo: undo, redo: redo };
})();
