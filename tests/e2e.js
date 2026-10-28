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
  document.getElementById('app').innerHTML = '<p>made by script</p>';
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
    await page.waitForFunction(() => window.WSE && WSE.state.doc && WSE.state.history.length === 1);
    const frame = page.frameLocator('#frame');

    // 1. Saving without changes writes the file back byte for byte.
    await page.evaluate(() => WSE.save());
    assert.strictEqual(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), originalIndex, 'unchanged save is identical');

    // 2. Edit the heading text by double-clicking and typing.
    await frame.locator('h1').dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Fresh bread and cake');
    await page.keyboard.press('Escape');

    // 3. Style it: color on desktop, smaller font on mobile.
    await frame.locator('h1').click();
    await page.fill('.prop-color input.unit', '#ff0000');
    await page.press('.prop-color input.unit', 'Enter');
    await page.click('.device[data-device="mobile"]');
    await page.fill('input[data-prop="font-size"]', '20');
    await page.press('input[data-prop="font-size"]', 'Enter');
    await page.click('.device[data-device="desktop"]');

    // 4. Insert a paragraph after the selected heading, then delete the contact section.
    await page.click('.block:has-text("Paragraph")');
    await frame.locator('#contact').click({ position: { x: 5, y: 5 } });
    await page.click('#el-toolbar [data-act="delete"]');

    // 5. Undo the delete and redo it.
    await page.click('#btn-undo');
    assert.strictEqual(await frame.locator('#contact').count(), 1, 'undo restores');
    await page.click('#btn-redo');
    assert.strictEqual(await frame.locator('#contact').count(), 0, 'redo deletes again');

    // 6. Change the link of the button.
    await frame.locator('.hero .button').click();
    await page.click('.tab[data-tab="settings"]');
    const href = page.locator('#tab-settings input').first();
    await href.fill('https://example.com');
    await href.press('Enter');

    // 7. Enter at the end of a paragraph starts a new one.
    await frame.locator('.card p').first().dblclick();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line');
    await page.keyboard.press('Escape');

    // 8. Swap the hero image through the image picker.
    await frame.locator('.hero-image').dblclick();
    await page.click('.thumb[title="images/cake.svg"]');

    // 9. Drag the "Coffee" card in front of the "Bread" card.
    const coffee = frame.locator('.card').nth(2);
    await coffee.click({ position: { x: 5, y: 5 } });
    const from = await coffee.boundingBox();
    const to = await frame.locator('.card').first().boundingBox();
    await page.mouse.move(from.x + 10, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y + 20, { steps: 3 });
    await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.deepStrictEqual(await frame.locator('.card h2').allInnerTexts(), ['Coffee', 'Bread', 'Cakes']);

    // 10. Drag a new heading block from the panel to the top of the features.
    const block = await page.locator('.block:has-text("Heading")').boundingBox();
    await page.mouse.move(block.x + 20, block.y + 20);
    await page.mouse.down();
    await page.mouse.move(block.x + 60, block.y + 40, { steps: 3 });
    const card = await frame.locator('.card').first().boundingBox();
    await page.mouse.move(card.x + card.width / 2, card.y + 4, { steps: 8 });
    await page.mouse.up();
    assert.strictEqual(await frame.locator('.features > h2').count(), 1, 'block dropped into the grid');

    // 11. Insert an accordion, type in a title (with a space), close an item, add a row of boxes.
    await page.click('.block:has-text("Accordion")');
    assert.strictEqual(await frame.locator('details').count(), 3);
    await frame.locator('summary').first().dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Opening hours');
    await page.keyboard.press('Enter');
    await page.click('#el-toolbar [data-act="toggle"]');
    assert.strictEqual(await frame.locator('details[open]').count(), 0, 'first item closed');
    await page.click('.block:has-text("Row of boxes")');
    assert.strictEqual(await frame.locator('div[style*="flex:1 1 220px"]').count(), 3);

    await page.click('#btn-save');
    await page.waitForFunction(() => !document.querySelector('#btn-save').classList.contains('dirty'));
    const saved = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
    assert.match(saved, /<h1 class="wse-[a-z0-9]+">Fresh bread and cake<\/h1>/);
    assert.match(saved, /<style id="wysiwyg-edit-styles">[\s\S]*color: #ff0000 !important;[\s\S]*@media \(max-width: 575\.98px\)[\s\S]*font-size: 20px !important;[\s\S]*<\/style>\n<\/head>/);
    assert.match(saved, /<h1[^>]*>Fresh bread and cake<\/h1>\n<p>Write your text here.<\/p>/);
    assert.ok(!saved.includes('id="contact"'), 'section deleted');
    assert.ok(saved.includes('<a class="button" href="https://example.com">'), 'link changed');
    assert.ok(saved.includes('  <script src="js/main.js"></script>\n</body>\n</html>\n'), 'script kept');
    assert.match(saved, /<summary style="cursor:pointer;font-weight:600">Opening hours<\/summary>/);
    assert.ok(!saved.includes('<details open'), 'closed state saved');
    assert.match(saved, /from organic flour\.<\/p><p>Second line<\/p>/);
    assert.ok(saved.includes('<img class="hero-image" src="images/cake.svg" alt="A loaf of bread">'), 'image changed');
    assert.ok(!/contenteditable|wse-helper|x-wse-off/.test(saved), 'no editor leftovers');
    assert.ok(fs.readdirSync(path.join(home, '.wysiwyg-edit', 'backups')).length === 1, 'backup made');

    // 7. Reload the page: styles from the saved block come back into the editor.
    await page.reload();
    await page.waitForFunction(() => window.WSE && WSE.state.doc && WSE.state.history.length === 1);
    await frame.locator('h1').click();
    assert.strictEqual(await page.inputValue('.prop-color input.unit'), '#ff0000');
    await page.evaluate(() => WSE.save());
    assert.strictEqual(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), saved, 'second save is stable');

    // 8. The tricky page: scripts did not run in the editor, and are saved untouched.
    await page.selectOption('#page-select', 'tricky.html');
    await page.waitForFunction(() => WSE.state.page === 'tricky.html' && WSE.state.doc && WSE.state.doc.querySelector('#app'));
    await sleep(300);
    assert.strictEqual(await frame.locator('#app p').innerText(), 'Static text', 'scripts paused while editing');
    await page.evaluate(() => WSE.save());
    assert.strictEqual(fs.readFileSync(path.join(site, 'tricky.html'), 'utf8'), TRICKY, 'tricky page unchanged');
    await frame.locator('#app p').dblclick();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Escape');
    await page.evaluate(() => WSE.save());
    assert.strictEqual(fs.readFileSync(path.join(site, 'tricky.html'), 'utf8'),
      TRICKY.replace('Static text', 'Static text!'), 'only the edited text changed');

    // 9. The preview serves the real page with its scripts.
    const preview = await browser.newPage();
    await preview.goto(BASE + 'site/index.html');
    assert.strictEqual(await preview.locator('#year').innerText(), String(new Date().getFullYear()), 'scripts run in preview');

    // 10. Writes are refused without the editor's header.
    const res = await fetch(BASE + 'api/save', { method: 'POST', body: '{"path":"index.html","content":"x"}' });
    assert.strictEqual(res.status, 403);

    assert.deepStrictEqual(errors, [], 'no page errors');
    await page.screenshot({ path: path.join(os.tmpdir(), 'wse-editor.png') });
    // 11. Without a folder the start screen opens a site from a typed path.
    await page.evaluate(() => { WSE.state.savedKey = ''; });
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => d.accept());
    await page.click('#btn-folder');
    await page.fill('#path-input', path.join(site));
    await page.click('#path-form button');
    await page.waitForFunction(() => !document.querySelector('#app').hidden && WSE.state.doc);

    // 12. The phone preview serves the site read-only on the network.
    const phone = await (await fetch(BASE + 'api/phone', { method: 'POST', headers: { 'X-WSE': '1' } })).json();
    const port = new URL(phone.url).port;
    const fromPhone = await fetch(`http://127.0.0.1:${port}/index.html`);
    assert.strictEqual(fromPhone.status, 200);
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/../../etc/passwd`)).status, 404);

    console.log('E2E OK');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
