/*
 * End-to-end test: starts the editor on a copy of the example site and a
 * tricky page, edits through the real UI in Chromium, saves and checks the
 * files on disk.
 *
 * Run:  node tests/e2e.js      (needs Playwright: npm i -D playwright)
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;
const BASE = `http://localhost:${PORT}/`;

const TRICKY = `<!doctype html>
<!-- keep this comment -->
<html>
<head>
<meta charset="utf-8">
<title>Tricky</title>
<script>
  // a string that looks like markup: "<body class='nope'>" and </div>
  window.headRan = true;
</script>
<style>p { color: rgb(1, 2, 3); }</style>
</head>
<body class="home"   data-x='1'>
<div id="app"><p>Static text</p></div>
<p onclick="alert(1)">Handler &amp; entity</p>
<script type="module">
  document.getElementById('app').innerHTML = '<p class="made">made by script</p>';
</script>
<script>if (1 < 2 && 3 > 2) { console.log("</p>"); }</script>
</body>
</html>
<script src="after-body.js"></script>
`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + 'api/state'); return; } catch (e) { await sleep(100); }
  }
  throw new Error('server did not start');
}

(async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'wse-site-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wse-home-'));
  fs.cpSync(path.join(ROOT, 'example-site'), site, { recursive: true });
  fs.writeFileSync(path.join(site, 'tricky.html'), TRICKY);
  fs.writeFileSync(path.join(site, 'after-body.js'), '');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'fixed-header.html'), path.join(site, 'fixed-header.html'));
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'menu-accordion.html'), path.join(site, 'menu-accordion.html'));
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'menu-page2.html'), path.join(site, 'menu-page2.html'));
  const originalIndex = fs.readFileSync(path.join(site, 'index.html'), 'utf8');

  const server = spawn('python3', [path.join(ROOT, 'server.py'), site, '--port', String(PORT), '--no-browser'],
    { env: { ...process.env, HOME: home }, stdio: 'inherit' });
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '?lang=en');

    // The live view is rebuilt after structural changes; wait until it shows the latest state.
    const settle = async () => {
      await page.waitForFunction(() => window.WSE && WSE.ready());
      await sleep(150);
    };
    const frame = () => page.frameLocator('iframe.frame.active');
    const live = (fn, arg) => page.evaluate(fn, arg);
    await settle();

    // 1. The site's scripts run in the editor: sections fade in, tab buttons get built.
    assert.strictEqual(await frame().locator('.tab-buttons button').count(), 2, 'tabs built by the site script');
    await frame().locator('.card').first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => WSE.state.doc.querySelector('.card').classList.contains('visible'));

    // 2. Saving without changes writes the file back byte for byte.
    await live(() => WSE.save());
    assert.strictEqual(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), originalIndex, 'unchanged save is identical');

    // 3. Edit the heading text by double-clicking and typing.
    await live(() => WSE.state.win.scrollTo(0, 0));
    await frame().locator('h1').dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Fresh bread and cake');
    await page.keyboard.press('Escape');

    // 4. Style it: color on desktop, smaller font on mobile.
    await frame().locator('h1').click();
    await page.fill('.prop-color input.unit', '#ff0000');
    await page.press('.prop-color input.unit', 'Enter');
    await page.click('.device[data-device="mobile"]');
    await page.fill('input[data-prop="font-size"]', '20');
    await page.press('input[data-prop="font-size"]', 'Enter');
    await page.click('.device[data-device="desktop"]');

    // 5. Insert a paragraph after the selected heading, then delete the contact section.
    await page.click('.block:has-text("Paragraph")');
    await settle();
    assert.strictEqual(await frame().locator('.hero-text p').count(), 2, 'paragraph inserted');
    await frame().locator('#contact').click({ position: { x: 5, y: 5 } });
    await page.click('#el-toolbar [data-act="delete"]');
    await settle();

    // 6. Undo the delete and redo it.
    await page.click('#btn-undo');
    await settle();
    assert.strictEqual(await frame().locator('#contact').count(), 1, 'undo restores');
    await page.click('#btn-redo');
    await settle();
    assert.strictEqual(await frame().locator('#contact').count(), 0, 'redo deletes again');

    // 7. Change the link of the button.
    await live(() => WSE.state.win.scrollTo(0, 0));
    await frame().locator('.hero .button').click();
    await page.click('.rtab[data-tab="settings"]');
    const href = page.locator('#tab-settings input').first();
    await href.fill('https://example.com');
    await href.press('Enter');
    await page.click('.rtab[data-tab="style"]');

    // 8. Enter at the end of a paragraph starts a new one.
    await frame().locator('.card p').first().scrollIntoViewIfNeeded();
    await frame().locator('.card p').first().dblclick();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line');
    await page.keyboard.press('Escape');

    // 9. Swap the hero image through the image picker.
    await live(() => WSE.state.win.scrollTo(0, 0));
    await frame().locator('.hero-image').dblclick();
    await page.click('.thumb[title="images/cake.svg"]');

    // 10. Drag the "Coffee" card in front of the "Bread" card, without selecting it first.
    async function dragTo(source, tx, ty) {
      const b = await source.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + 12);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 20, b.y + 30, { steps: 3 });
      await page.mouse.move(tx, ty, { steps: 10 });
      await page.mouse.up();
      await settle();
    }
    await page.keyboard.press('Escape');
    await frame().locator('.features').scrollIntoViewIfNeeded();
    const to = await frame().locator('.card').first().boundingBox();
    await dragTo(frame().locator('.card').nth(2), to.x + 8, to.y + to.height / 2);
    assert.deepStrictEqual(await frame().locator('.card h2').allInnerTexts(), ['Coffee', 'Bread', 'Cakes']);
    assert.strictEqual(await live(() => WSE.state.selected && WSE.state.selected.querySelector('h2').textContent), 'Coffee',
      'the dragged card is selected');

    // 11. Drag a new heading block from the panel to the top of the features.
    await live(() => WSE.state.doc.querySelector('.features').scrollIntoView({ block: 'center' }));
    await sleep(300);
    const block = await page.locator('.block:has-text("Heading")').boundingBox();
    await page.mouse.move(block.x + 20, block.y + 20);
    await page.mouse.down();
    await page.mouse.move(block.x + 60, block.y + 40, { steps: 3 });
    const card = await frame().locator('.card').first().boundingBox();
    await page.mouse.move(card.x + card.width / 2, card.y + 4, { steps: 8 });
    await page.mouse.up();
    await settle();
    assert.strictEqual(await frame().locator('.features > h2').count(), 1, 'block dropped into the grid');

    // 12. Insert an accordion, type in a title (with a space), close an item, add a row of boxes.
    await page.click('.block:has-text("Accordion")');
    await settle();
    assert.strictEqual(await frame().locator('details').count(), 3);
    await frame().locator('summary').first().dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Opening hours');
    await page.keyboard.press('Enter');
    await page.click('#el-toolbar [data-act="toggle"]');
    assert.strictEqual(await frame().locator('details[open]').count(), 0, 'first item closed');
    await page.click('.block:has-text("Row of boxes")');
    await settle();
    assert.strictEqual(await frame().locator('div[style*="flex:1 1 220px"]').count(), 3);

    // 13. An image dropped between two words lands inside the text.
    await page.keyboard.press('Escape');
    await live(() => WSE.state.win.scrollTo(0, 0));
    const heroP = await frame().locator('.hero-text p', { hasText: 'Baked' }).boundingBox();
    await dragTo(frame().locator('.logo img'), heroP.x + 2, heroP.y + 12);
    assert.strictEqual(await frame().locator('.hero-text p img').count(), 1, 'image dropped into the text');
    assert.strictEqual(await frame().locator('.logo img').count(), 0);

    // 14. "Use page" mode: the page's own tabs work; Escape goes back to editing.
    await frame().locator('.hours').scrollIntoViewIfNeeded();
    await page.click('#btn-interact');
    await frame().locator('.tab-buttons button', { hasText: 'Weekend' }).click();
    assert.ok(await frame().locator('.tab-panel').nth(1).evaluate((n) => n.classList.contains('active')), 'site tabs work');
    await page.keyboard.press('Escape');
    assert.strictEqual(await live(() => WSE.state.interact), false);

    // 15. Clicking a button made by a script selects the nearest real element instead.
    await frame().locator('.tab-buttons button').first().click();
    assert.strictEqual(await live(() => WSE.state.selected.className), 'tab-buttons');

    // 16. Moving something into a hidden place warns and offers undo. The "Weekend" tab opened in
    //     step 14 stays open after changes, so the first panel is the hidden one.
    await page.click('.ltab[data-ltab="layers"]');
    await page.locator('.layer:has(.layer-cls:text-is(".tab-buttons"))').waitFor();
    const panelRow = page.locator('.layer:has(.layer-cls:text-is(".tab-panel"))').nth(0);
    await panelRow.locator('.layer-caret').click(); // not needed for the drop, keeps the tree stable
    await page.locator('.layer:has(.layer-cls:text-is(".tab-buttons"))').dragTo(
      page.locator('.layer:has(.layer-cls:text-is(".tab-panel"))').nth(0));
    await settle();
    await page.waitForSelector('#toast-action:not([hidden])');
    await page.click('#toast-action');
    await settle();
    assert.strictEqual(await frame().locator('.tabs > .tab-buttons').count(), 1, 'undo brought it back');
    await page.click('.ltab[data-ltab="add"]');

    await page.click('#btn-save');
    await page.waitForFunction(() => !document.querySelector('#btn-save').classList.contains('dirty'));
    const saved = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
    assert.match(saved, /<h1 class="wse-[a-z0-9]+">Fresh bread and cake<\/h1>/);
    assert.match(saved, /<style id="wysiwyg-edit-styles">[\s\S]*color: #ff0000 !important;[\s\S]*@media \(max-width: 575\.98px\)[\s\S]*font-size: 20px !important;[\s\S]*<\/style>\n<\/head>/);
    assert.match(saved, /<\/h1>\n\s+<p>Write your text here.<\/p>\n\s+<p><img src="images\/logo.svg"[^>]*>Baked by hand/);
    assert.ok(!saved.includes('id="contact"'), 'section deleted');
    assert.ok(saved.includes('<a class="button" href="https://example.com">'), 'link changed');
    assert.match(saved, /from organic flour\.<\/p>\s*<p>Second line<\/p>/);
    assert.ok(saved.includes('<img class="hero-image" src="images/cake.svg" alt="A loaf of bread">'), 'image changed');
    assert.match(saved, /<summary style="cursor:pointer;font-weight:600">Opening hours<\/summary>/);
    assert.ok(!saved.includes('<details open'), 'closed state saved');
    assert.ok(saved.indexOf('<h2>Coffee</h2>') < saved.indexOf('<h2>Bread</h2>'), 'card order saved');
    assert.ok(saved.includes('<div class="tab-buttons"></div>'), 'buttons made by the script are not saved');
    assert.ok(!/ visible|class="card reveal visible|active"|data-wse|contenteditable|wse-helper|x-wse-off/.test(saved), 'no editor or script leftovers');
    assert.ok(saved.includes('  <script src="js/main.js"></script>\n</body>\n</html>\n'), 'script kept');
    assert.ok(fs.readdirSync(path.join(home, '.wysiwyg-edit', 'backups')).length === 1, 'backup made');

    // 17. Reload: styles from the saved block come back into the editor, and saving again changes nothing.
    await page.reload();
    await settle();
    await frame().locator('h1').click();
    assert.strictEqual(await page.inputValue('.prop-color input.unit'), '#ff0000');
    await live(() => WSE.save());
    assert.strictEqual(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), saved, 'second save is stable');

    // 18. The tricky page: its scripts run in the editor, and it is saved untouched.
    await page.selectOption('#page-select', 'tricky.html');
    await page.waitForFunction(() => WSE.state.page === 'tricky.html' && WSE.ready());
    await page.waitForFunction(() => WSE.state.doc.querySelector('#app .made'));
    await live(() => WSE.save());
    assert.strictEqual(fs.readFileSync(path.join(site, 'tricky.html'), 'utf8'), TRICKY, 'tricky page unchanged');
    await frame().locator('p[onclick]').dblclick();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Escape');
    await live(() => WSE.save());
    assert.strictEqual(fs.readFileSync(path.join(site, 'tricky.html'), 'utf8'),
      TRICKY.replace('Handler &amp; entity', 'Handler &amp; entity!'), 'only the edited text changed');

    // 19. A page with a header that stays on top (a reported bug: dragged things vanished into it).
    await page.selectOption('#page-select', 'fixed-header.html');
    await page.waitForFunction(() => WSE.state.page === 'fixed-header.html' && WSE.ready());
    await sleep(500);
    const order = () => live(() => Array.from(WSE.state.doc.querySelectorAll('section'))
      .map((s) => (s.id || 'hero') + '@' + s.parentElement.tagName).join(' '));
    await frame().locator('#nachhaltigkeit').scrollIntoViewIfNeeded();
    await sleep(900);
    const sec = await frame().locator('#nachhaltigkeit h2').boundingBox();
    const wrapBox = await page.locator('#frame-wrap').boundingBox();
    await page.mouse.move(sec.x + 300, sec.y - 20);
    await page.mouse.down();
    await page.mouse.move(sec.x + 320, sec.y, { steps: 3 });
    for (let i = 0; i < 40; i++) { await page.mouse.move(sec.x + 320 + (i % 2), wrapBox.y + 60); await sleep(25); }
    const lei = await frame().locator('#leistungen').boundingBox();
    await page.mouse.move(sec.x + 320, lei.y + 20, { steps: 5 });
    await page.mouse.up();
    await settle();
    assert.strictEqual(await order(), 'hero@MAIN nachhaltigkeit@MAIN leistungen@MAIN team@MAIN kontakt@MAIN',
      'section moved within the page, not into the header');
    assert.strictEqual(await live(() => WSE.state.selected.id), 'nachhaltigkeit', 'moved section stays selected');
    // Dragging a menu link moves its whole menu item.
    const team = await frame().locator('nav li', { hasText: 'Team' }).boundingBox();
    const first = await frame().locator('nav li', { hasText: 'Leistungen' }).boundingBox();
    await page.mouse.move(team.x + 5, team.y + team.height / 2);
    await page.mouse.down();
    await page.mouse.move(team.x + 15, team.y + team.height / 2, { steps: 3 });
    await page.mouse.move(first.x + 3, first.y + first.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle();
    assert.strictEqual(await live(() => Array.from(WSE.state.doc.querySelectorAll('nav li')).map((l) => l.textContent).join(',')),
      'Team,Leistungen,Nachhaltigkeit,Kontakt');
    await live(() => WSE.save());
    const fixedSaved = fs.readFileSync(path.join(site, 'fixed-header.html'), 'utf8');
    assert.ok(fixedSaved.indexOf('id="nachhaltigkeit"') < fixedSaved.indexOf('id="leistungen"'));
    assert.ok(!/ show"|class="fade show/.test(fixedSaved), 'classes added by the page script are not saved');

    // 20. Menus with submenus and accordions (reported: moved menu items and accordion items vanished).
    await page.selectOption('#page-select', 'menu-accordion.html');
    await page.waitForFunction(() => WSE.state.page === 'menu-accordion.html' && WSE.ready());
    await sleep(300);
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 10, from.y + 5, { steps: 3 });
      await page.mouse.move(to.x, to.y, { steps: 10 });
      await page.mouse.up();
      await settle();
    };
    const spot = async (loc, fx, fy) => {
      const b = await loc.boundingBox();
      return { x: b.x + b.width * fx, y: b.y + b.height * fy };
    };
    const titles = () => live(() => Array.from(WSE.state.src.querySelectorAll('.accordion > *'))
      .map((d) => d.tagName === 'DETAILS' && d.firstElementChild.tagName === 'SUMMARY' ? d.firstElementChild.textContent : d.tagName).join(','));
    const menu = () => live(() => Array.from(WSE.state.src.querySelectorAll('#nav > ul > li'))
      .map((li) => li.firstElementChild.textContent + (li.querySelector('.sub') ? '+' : '')).join(','));
    const summary = (text) => frame().locator('summary', { hasText: text });
    // An accordion title moves its whole item, and never into a closed item.
    await drag(await spot(summary('Nachhaltigkeit'), 0.3, 0.5), await spot(summary('Prophylaxe'), 0.3, 0.9));
    assert.strictEqual(await titles(), 'Online Anamnese,Prophylaxe,Nachhaltigkeit', 'accordion item moved as a whole');
    // The link of a menu entry moves the entry with its submenu.
    const link = (text) => frame().locator('#nav > ul > li > a', { hasText: text });
    await drag(await spot(link('Team'), 0.5, 0.5), await spot(link('Über uns'), 0.1, 0.5));
    assert.strictEqual(await menu(), 'Team+,Über uns+,Praxisräume,Leistungen');
    await drag(await spot(link('Leistungen'), 0.5, 0.5), await spot(link('Team'), 0.6, 0.5));
    assert.strictEqual(await menu(), 'Team+,Leistungen,Über uns+,Praxisräume', 'never a link inside a link');
    // What the visitor opened stays open after a change, without being saved.
    await page.click('#btn-interact');
    await summary('Nachhaltigkeit').click();
    await page.keyboard.press('Escape');
    const para = (i) => frame().locator('details:has(summary:text("Nachhaltigkeit")) p').nth(i);
    await drag(await spot(para(1), 0.5, 0.5), await spot(para(0), 0.5, 0.1));
    assert.strictEqual(await para(0).innerText(), 'Zweiter Absatz.');
    assert.ok(await frame().locator('details:has(summary:text("Nachhaltigkeit"))').evaluate((d) => d.open), 'accordion item stays open');
    await page.click('.device[data-device="mobile"]');
    await settle();
    await page.click('#btn-interact');
    await frame().locator('.nav-toggle').click();
    await page.keyboard.press('Escape');
    await drag(await spot(link('Praxisräume'), 0.3, 0.5), await spot(link('Team'), 0.3, 0.1));
    assert.strictEqual(await menu(), 'Praxisräume,Team+,Leistungen,Über uns+');
    assert.ok(await frame().locator('#nav').evaluate((n) => n.classList.contains('open')), 'opened menu stays open');
    await page.keyboard.press('ControlOrMeta+z');
    await settle();
    assert.strictEqual(await menu(), 'Team+,Leistungen,Über uns+,Praxisräume', 'keyboard undo works after a change');
    await page.click('.device[data-device="desktop"]');
    await settle();
    // The menu is the same on another page: saving offers to change it there too.
    await live(() => WSE.select(WSE.state.doc.querySelector('#nav li')));
    assert.match(await page.locator('#crumbs .shared-chip').innerText(), /1/, 'shared part is shown');
    await page.click('#btn-save');
    await page.waitForSelector('#shared-dialog[open]');
    await page.click('#shared-all');
    await page.waitForFunction(() => !document.querySelector('#shared-dialog').open);
    await page.waitForFunction(() => !document.querySelector('#btn-save').classList.contains('dirty'));
    await sleep(500);
    const page2 = fs.readFileSync(path.join(site, 'menu-page2.html'), 'utf8');
    const original2 = fs.readFileSync(path.join(__dirname, 'fixtures', 'menu-page2.html'), 'utf8');
    assert.ok(/Team<\/a>[\s\S]*Leistungen<\/a>[\s\S]*Über uns<\/a>[\s\S]*Praxisräume<\/a>/.test(page2), 'menu changed on the other page');
    assert.ok(page2.includes('<li class="has-sub current"><a href="#">Team</a>'), 'the other page keeps its current entry');
    assert.ok(page2.includes('<li><a href="#" aria-current="page">Mitarbeiter</a></li>'));
    assert.strictEqual(page2.slice(page2.indexOf('</header>')), original2.slice(original2.indexOf('</header>')), 'rest of the page unchanged');
    assert.strictEqual(page2.slice(0, page2.indexOf('<header>')), original2.slice(0, original2.indexOf('<header>')));
    const menuSaved = fs.readFileSync(path.join(site, 'menu-accordion.html'), 'utf8');
    assert.ok(!/main-menu open|<details open>\s*<summary>Nachhaltigkeit/.test(menuSaved), 'opened things are not saved open');
    assert.match(menuSaved, /<summary>Prophylaxe<\/summary>[\s\S]*<summary>Nachhaltigkeit<\/summary>/);

    // 21. The preview serves the real page with its scripts.
    const preview = await browser.newPage();
    await preview.goto(BASE + 'site/index.html');
    assert.strictEqual(await preview.locator('#year').innerText(), String(new Date().getFullYear()), 'scripts run in preview');

    // 22. Writes are refused without the editor's header.
    const res = await fetch(BASE + 'api/save', { method: 'POST', body: '{"path":"index.html","content":"x"}' });
    assert.strictEqual(res.status, 403);

    // 23. Without a folder the start screen opens a site from a typed path.
    await live(() => { WSE.state.savedKey = ''; });
    await page.click('#btn-folder');
    await page.fill('#path-input', path.join(site));
    await page.click('#path-form button');
    await page.waitForFunction(() => !document.querySelector('#app').hidden && WSE.ready());

    // 24. The phone preview serves the site read-only on the network.
    const phone = await (await fetch(BASE + 'api/phone', { method: 'POST', headers: { 'X-WSE': '1' } })).json();
    const port = new URL(phone.url).port;
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/index.html`)).status, 200);
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../../etc/passwd`)).status, 404);

    assert.deepStrictEqual(errors, [], 'no page errors');
    await page.screenshot({ path: path.join(os.tmpdir(), 'wse-editor.png') });
    console.log('E2E OK');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
