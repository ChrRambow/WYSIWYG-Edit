/*
 * The styles a user sets in the editor.
 *
 * They are kept as  selector -> device -> { property: value }  and written
 * into one <style id="wysiwyg-edit-styles"> block in the page's <head>.
 * Desktop rules apply everywhere; tablet and mobile rules are media queries
 * that come after them, so smaller screens override bigger ones.
 */
(function () {
  var STYLE_ID = 'wysiwyg-edit-styles';
  var DEVICES = ['desktop', 'tablet', 'mobile'];
  var MEDIA = {
    tablet: '(max-width: 991.98px)',
    mobile: '(max-width: 575.98px)'
  };
  var WIDTHS = { desktop: null, tablet: 768, mobile: 375 };

  function create() {
    return { order: [], rules: {}, extra: [] };
  }

  function clone(model) {
    return JSON.parse(JSON.stringify(model));
  }

  function ensure(model, selector) {
    if (!model.rules[selector]) {
      model.rules[selector] = { desktop: {}, tablet: {}, mobile: {} };
      model.order.push(selector);
    }
    return model.rules[selector];
  }

  function get(model, selector, device, prop) {
    var r = model.rules[selector];
    return r && r[device][prop] !== undefined ? r[device][prop] : '';
  }

  function set(model, selector, device, prop, value) {
    var r = ensure(model, selector);
    value = (value || '').trim();
    if (value) r[device][prop] = value;
    else delete r[device][prop];
    var empty = DEVICES.every(function (d) { return !Object.keys(r[d]).length; });
    if (empty) {
      delete model.rules[selector];
      model.order = model.order.filter(function (s) { return s !== selector; });
    }
  }

  function deviceOfMedia(text) {
    if (/991/.test(text)) return 'tablet';
    if (/575/.test(text)) return 'mobile';
    return null;
  }

  /* Split text at a character, ignoring it inside quotes and brackets. */
  function splitOutside(text, sep) {
    var parts = [], depth = 0, quote = null, last = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === sep && depth === 0) { parts.push(text.slice(last, i)); last = i + 1; }
    }
    parts.push(text.slice(last));
    return parts;
  }

  /* Index of the "}" that closes the "{" at position open. */
  function closing(text, open) {
    var depth = 0, quote = null;
    for (var i = open; i < text.length; i++) {
      var c = text[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return i;
    }
    return text.length;
  }

  function parseRules(model, css, device) {
    var i = 0;
    while (i < css.length) {
      var open = css.indexOf('{', i);
      if (open < 0) break;
      var header = css.slice(i, open).trim();
      var end = closing(css, open);
      var body = css.slice(open + 1, end);
      i = end + 1;
      if (header.charAt(0) === '@') {
        var d = device === 'desktop' && /^@media\b/i.test(header) ? deviceOfMedia(header) : null;
        if (d) parseRules(model, body, d);
        else model.extra.push(header + ' {' + body + '}'); // keep what we do not understand
        continue;
      }
      var decl = ensure(model, header)[device];
      splitOutside(body, ';').forEach(function (line) {
        var colon = line.indexOf(':');
        if (colon < 0) return;
        var prop = line.slice(0, colon).trim().toLowerCase();
        var value = line.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim();
        if (prop && value) decl[prop] = value;
      });
    }
  }

  /* Build the model from the text of an existing style block. */
  function parse(css) {
    var model = create();
    parseRules(model, (css || '').replace(/\/\*[\s\S]*?\*\//g, ''), 'desktop');
    return model;
  }

  function block(selector, decl, indent) {
    var props = Object.keys(decl);
    if (!props.length) return '';
    var lines = props.map(function (p) {
      return indent + '  ' + p + ': ' + decl[p] + ' !important;';
    });
    return indent + selector + ' {\n' + lines.join('\n') + '\n' + indent + '}\n';
  }

  function serialize(model) {
    var out = '';
    model.order.forEach(function (sel) { out += block(sel, model.rules[sel].desktop, ''); });
    ['tablet', 'mobile'].forEach(function (device) {
      var inner = '';
      model.order.forEach(function (sel) { inner += block(sel, model.rules[sel][device], '  '); });
      if (inner) out += '@media ' + MEDIA[device] + ' {\n' + inner + '}\n';
    });
    model.extra.forEach(function (text) { out += text + '\n'; });
    return out;
  }

  window.WSEStyles = {
    STYLE_ID: STYLE_ID,
    DEVICES: DEVICES,
    MEDIA: MEDIA,
    WIDTHS: WIDTHS,
    create: create,
    clone: clone,
    get: get,
    set: set,
    parse: parse,
    serialize: serialize
  };
})();
