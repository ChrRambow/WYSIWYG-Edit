# WYSIWYG Edit

A small, free visual editor for **existing static websites** (HTML, CSS,
JavaScript, images). Open the folder of a website, click on text, images and
blocks to change them, adjust colors, fonts and spacing for desktop, tablet
and phone, then save. The result is plain HTML and CSS that runs anywhere
without the editor.

It runs on your own computer: a tiny local server (Python, nothing to
install on a Mac) plus the editor in your web browser.

## Quick start on a Mac

1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Double-click **`Start Editor.command`**.
   - The first time, macOS may refuse to open it. Right-click the file,
     choose **Open**, then **Open** again.
   - If macOS asks to install the "command line developer tools", accept.
     That installs Python 3, which the editor needs.
3. Your browser opens the editor. Click **Choose folder…** and pick the folder
   of your website (the folder that contains `index.html`).
4. Keep the Terminal window open while you work. Close it (or press
   `Ctrl+C`) to stop the editor.

From the Terminal you can also run it directly:

```sh
python3 server.py ~/Documents/my-website
```

To try it out, open the included `example-site` folder.

## What you can do

| | |
|---|---|
| **Edit text** | Double-click any text and type. Bold, italic, underline and links are in the small toolbar. `Enter` starts a new paragraph, `Shift+Enter` a line break, `Esc` finishes. |
| **Change images** | Double-click an image, pick one from the website or upload a new one. |
| **Accordions** | Built from the standard HTML `<details>` element, so they open and close on the website without any JavaScript. In the editor, the ▾ button (or **Settings** → "Open when the page loads") opens and closes an item; it is saved the way you leave it. Add more items with the "Accordion item" block or by duplicating one. |
| **Links** | Select a link, then **Settings** → link address and "open in new tab". |
| **Add blocks** | Headings, paragraphs, images, buttons, lists, sections, 2 or 3 columns, boxes, a row of boxes, accordions, dividers, spacers and YouTube videos from the left panel. Click to insert below the selected element, or drag them onto the page. |
| **Move boxes** | Click a box to select it, then drag it with the mouse (or the ✥ handle) to another place. A blue line shows where it lands and a dashed outline shows the box it goes into. Blocks from the left panel can be dragged onto the page too. |
| **Duplicate, delete** | With the buttons above the selected element (↑ ↓ also move it one step), or `Delete` on the keyboard. |
| **Styles** | The **Style** panel changes font, size, color, alignment, background, spacing, size, layout, borders and shadows. |
| **Responsive** | Switch between **Desktop**, **Tablet** and **Mobile** at the top. Style changes made in Tablet or Mobile only apply to those screen sizes, and you can hide elements on one size only. |
| **HTML** | The **HTML** tab shows the code of the selected element for small fixes. |
| **Undo / redo** | The arrows at the top, or `Cmd+Z` / `Cmd+Shift+Z`. |
| **Save** | **Save** or `Cmd+S`. |
| **Preview** | **Preview** opens the saved page from the local server, with all scripts running, like it will be online. |
| **On the phone** | **On phone** shows an address you can open on a phone in the same Wi-Fi. |

The editor speaks German or English, following the browser's language
(`?lang=de` or `?lang=en` in the address forces one).

## How it keeps your website intact

- **JavaScript keeps working.** While you edit, the page's scripts are paused
  so they cannot change the page under your hands (for example a slider
  rewriting its content). When you save, every `<script>` is written back
  exactly as it was. Use **Preview** to see the page with scripts running.
- **Only what you change changes.** Everything outside `<body>` (doctype,
  `<head>`, comments) is kept character for character. Saving a page without
  changes writes the identical file. Entities such as `&copy;` stay as they
  were, and the file keeps its original text encoding.
- **Your CSS files are not touched.** Style changes go into one
  `<style id="wysiwyg-edit-styles">` block in the page's `<head>`, with media
  queries for tablet (up to 991 px) and phone (up to 575 px). Elements you
  style get a class like `wse-k3x9a1`.
- **Backups.** The first time you save a page in a session, the previous
  version is copied to `~/.wysiwyg-edit/backups/<website>/<date-time>/`.

## Limits

- Content that only appears through JavaScript (for example a menu that a
  script builds) cannot be edited visually, because scripts are paused.
  Content that is only hidden until a script shows it can be reached with the
  breadcrumb bar under the page or the **HTML** tab.
- Style changes apply to one element or to all elements with one of its
  classes. Editing the site's own `.css` files is not part of the editor yet.
- There is no "new page" command yet: copy an existing `.html` file in the
  Finder and open it in the editor.

## For developers

No build step and no dependencies at runtime: `server.py` uses only the
Python standard library (3.8+) and the editor in `editor/` is plain
JavaScript.

```
server.py          local server: serves the editor and the site, saves, uploads, backups
editor/            the editor (index.html, editor.js, styles.js, i18n.js, editor.css)
example-site/      a small responsive sample website
tests/             unit tests (Python) and an end-to-end test (Playwright)
```

Run the tests:

```sh
npm install         # installs Playwright for the end-to-end test
npx playwright install chromium
npm test
```

The server only listens on `localhost`. Write requests need a custom header
that other websites cannot send, and requests with a foreign `Host` header
are refused. The phone preview is a separate, read-only server.

## License

MIT
