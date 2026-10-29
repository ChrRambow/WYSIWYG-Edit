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
3. Your browser opens the editor. Click **Create a new website** to start from
   a template, or **Open a website** and pick the folder of your website (the
   folder that contains `index.html`).
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
| **New website** | Pick a template (business or practice with six pages, personal or portfolio, or blank), a main color and fonts. A live preview shows the result before anything is written. The website gets its own folder with plain HTML, one CSS file, a tiny script for the phone menu and placeholder pictures. The fonts are the ones on every computer, nothing is loaded from other servers. |
| **Pages** | The page buttons next to the page list add a new page (empty with the same header and footer, or a copy) and can put it into the menu of every page. **Page settings** change the title and description for search engines, rename the page (links on all pages follow) or delete it (it leaves the menus, a backup is kept). |
| **Design** | The **Design** tab on the left changes the colors and fonts of the whole website at once. It works with every site that keeps its colors as CSS variables in `:root`, like the templates do; only the values in the CSS file change. |
| **Sections** | Ready-made sections in the **Add** tab: big intro, text and picture, services, team, quote, call to action, contact with opening hours, pictures and questions. They use the website's colors. |
| **Edit text** | Double-click any text and type. Bold, italic, underline and links are in the small toolbar. `Enter` starts a new paragraph, `Shift+Enter` a line break, `Esc` finishes. |
| **Change images** | Double-click an image, pick one from the website or upload a new one. |
| **Accordions** | Built from the standard HTML `<details>` element, so they open and close on the website without any JavaScript. In the editor, the ▾ button (or **Settings** → "Open when the page loads") opens and closes an item; it is saved the way you leave it. Add more items with the "Accordion item" block or by duplicating one. |
| **Links** | Select a link, then **Settings** → link address and "open in new tab". |
| **Add blocks** | Headings, paragraphs, images, buttons, lists, sections, 2 or 3 columns, boxes, a row of boxes, accordions, dividers, spacers and YouTube videos from the left panel. Click to insert below the selected element, or drag them onto the page. |
| **Move anything** | Every element can be dragged with the mouse: press on it and drag. A line shows where it lands and an outline shows the box it goes into. Links, images and other inline elements can also be dropped between two words. Dragging the title of an accordion item moves the whole item, and dragging a menu link moves the menu entry together with its submenu. To move a whole box rather than something inside it, select the box and drag it by the ✥ handle on its toolbar. If something lands in a place that is not visible (for example a hidden menu), the editor says so and offers to undo. |
| **Structure** | The **Structure** tab on the left lists every element of the page as a tree. Click to select, drag to move; dropping onto the middle of a box puts the element inside it. Handy for nested or hidden elements. |
| **Use page** | **Use page** lets you click the page like a visitor (open the mobile menu, switch tabs, move a slider) to reach content you want to edit. `Esc` goes back to editing. What you opened stays open while you edit, but is saved the way it was. |
| **Same on every page** | Header, menu and footer are usually the same on all pages. The editor notices this ("Same on 12 more pages" at the bottom when you select something in them). When you change such a part and save, it offers to make the same change on all those pages. Each page keeps its own highlighted menu entry. |
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

- **JavaScript runs in the editor.** The page is shown with all its scripts
  running, so animations, sliders, tabs and menus look and work like on the
  real site. The editor keeps a separate, script-free copy of the page and
  saves only that copy plus your own changes: whatever the scripts add or
  change on the screen (built buttons, classes like `visible`, the current
  year...) is never written into your files, and every `<script>` is written
  back exactly as it was.
- **Only what you change changes.** Everything outside `<body>` (doctype,
  `<head>`, comments) is kept character for character. Saving a page without
  changes writes the identical file. Entities such as `&copy;` and tags written over
  several lines stay as they were, and the file keeps its original text encoding.
- **Your CSS files are not touched.** Style changes go into one
  `<style id="wysiwyg-edit-styles">` block in the page's `<head>`, with media
  queries for tablet (up to 991 px) and phone (up to 575 px). Elements you
  style get a class like `wse-k3x9a1`.
- **Backups.** The first time you save a page in a session, the previous
  version is copied to `~/.wysiwyg-edit/backups/<website>/<date-time>/`.

## Limits

- Content that a script creates from scratch (for example tab buttons built
  from data) is not in the HTML file, so it cannot be edited; clicking it
  selects the nearest element that is in the file. Content that a script
  only hides or shows can be reached with **Use page**, the **Structure** tab
  or the **HTML** tab.
- Style changes apply to one element or to all elements with one of its
  classes. Of the site's own `.css` files, only the colors, fonts and sizes
  kept as CSS variables can be changed (in the **Design** tab).
- Design changes are not part of undo; the arrow next to a changed value
  takes it back until you save.

## For developers

No build step and no dependencies at runtime: `server.py` uses only the
Python standard library (3.8+) and the editor in `editor/` is plain
JavaScript.

```
server.py          local server: serves the editor and the site, saves, uploads, backups
editor/            the editor (index.html, editor.js, styles.js, templates.js, i18n.js, editor.css)
                   editor.js has an overview of how the live view and the saved copy work together
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
