#!/usr/bin/env python3
"""WYSIWYG Edit - a small visual editor for static HTML websites.

Run it with:  python3 server.py [path/to/site-folder] [--port 8000]

It starts a local web server, opens the editor in your browser and serves
the site you are editing. Only the Python standard library is used, so
nothing needs to be installed on a Mac that has python3.
"""

import argparse
import datetime
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import urllib.parse
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath

APP_DIR = Path(__file__).resolve().parent / "editor"
CONFIG_DIR = Path.home() / ".wysiwyg-edit"
BACKUP_DIR = CONFIG_DIR / "backups"
RECENT_FILE = CONFIG_DIR / "recent.json"

HTML_EXT = {".html", ".htm"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico"}
SAVE_EXT = HTML_EXT | {".css", ".js"}
NEW_SITE_EXT = {".html", ".css", ".js", ".svg", ".txt", ".json"}
SKIP_DIRS = {".git", "node_modules", ".wysiwyg-edit", "__pycache__"}
MAX_UPLOAD = 50 * 1024 * 1024

# The editor compares this with its own number: a server still running from
# before an update lacks newer features and has to be restarted.
API_VERSION = 4
SERVER_FILE = Path(__file__).resolve()
STARTED_MTIME = SERVER_FILE.stat().st_mtime

SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script\s*>", re.I | re.S)

mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/avif", ".avif")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")


class State:
    """The site folder that is currently open."""

    def __init__(self):
        self.root = None
        self.lock = threading.Lock()
        self.phone_server = None
        self.backed_up = set()
        self.renders = {}  # page path -> HTML the editor shows (with the editor's markers)


STATE = State()


# ---------------------------------------------------------------- helpers

def safe_path(rel):
    """Resolve a site-relative path and make sure it stays inside the site."""
    if STATE.root is None:
        raise PermissionError("No site folder is open")
    rel = urllib.parse.unquote(rel or "").lstrip("/")
    target = (STATE.root / rel).resolve()
    if target != STATE.root and STATE.root not in target.parents:
        raise PermissionError("Path is outside the site folder")
    return target


def find_scripts(source):
    """Return the <script> elements of a page with their positions."""
    return [{"text": m.group(0), "start": m.start(), "end": m.end()} for m in SCRIPT_RE.finditer(source)]


def read_text(path):
    """Read a text file, returning (text, encoding)."""
    data = path.read_bytes()
    encodings = ("utf-8", "cp1252", "latin-1")
    if data.startswith(b"\xef\xbb\xbf"):
        encodings = ("utf-8-sig",) + encodings  # keep the byte order mark when saving
    for enc in encodings:
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace"), "utf-8"


def list_site():
    pages, images = [], []
    for dirpath, dirnames, filenames in os.walk(STATE.root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            rel = (Path(dirpath) / name).relative_to(STATE.root).as_posix()
            ext = Path(name).suffix.lower()
            if ext in HTML_EXT:
                pages.append(rel)
            elif ext in IMAGE_EXT:
                images.append(rel)
    pages.sort(key=lambda p: (p.count("/"), p != "index.html", p))
    return pages, images


def backup(path):
    """Copy a file to ~/.wysiwyg-edit/backups before it is overwritten."""
    if not path.exists():
        return None
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    rel = path.relative_to(STATE.root)
    dest = BACKUP_DIR / STATE.root.name / stamp / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest)
    return str(dest)


def load_recent():
    try:
        return [p for p in json.loads(RECENT_FILE.read_text()) if Path(p).is_dir()]
    except (OSError, ValueError):
        return []


def remember(folder):
    recent = [str(folder)] + [p for p in load_recent() if p != str(folder)]
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        RECENT_FILE.write_text(json.dumps(recent[:8], indent=2))
    except OSError:
        pass


def open_folder(folder):
    folder = Path(folder).expanduser().resolve()
    if not folder.is_dir():
        raise FileNotFoundError("Folder not found: %s" % folder)
    with STATE.lock:
        STATE.root = folder
        STATE.backed_up = set()
        STATE.renders = {}
    remember(folder)
    return folder


def applescript_text(text):
    return str(text).replace("\\", "\\\\").replace('"', '\\"')


def existing_folder(path):
    """The folder itself or its nearest parent that exists, or None."""
    if not path:
        return None
    folder = Path(str(path)).expanduser()
    if not folder.is_absolute():
        return None
    for candidate in [folder] + list(folder.parents):
        if candidate.is_dir():
            return candidate
    return None


def choose_folder_dialog(prompt=None, start=None):
    """Show the native macOS folder picker. Returns None if cancelled."""
    if sys.platform != "darwin":
        raise RuntimeError("The folder dialog is only available on macOS. Please type the path.")
    prompt = str(prompt or "Choose the folder of your website")[:200]
    choose = 'choose folder with prompt "%s"' % applescript_text(prompt)
    folder = existing_folder(start)
    if folder:
        choose += ' default location (POSIX file "%s")' % applescript_text(folder)
    # The server runs in the background, so the dialog could open hidden
    # behind the browser window: bring it to the front first.
    attempts = [["tell me to activate", "POSIX path of (%s)" % choose], ["POSIX path of (%s)" % choose]]
    for lines in attempts:
        args = ["osascript"]
        for line in lines:
            args += ["-e", line]
        result = subprocess.run(args, capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
        if "-128" in result.stderr:  # the user clicked Cancel
            return None
    raise RuntimeError("The folder dialog did not open (%s). Please type the path instead."
                       % (result.stderr.strip() or "osascript failed"))


def server_changed():
    """True when server.py was updated on disk after this server started."""
    try:
        return SERVER_FILE.stat().st_mtime != STARTED_MTIME
    except OSError:
        return False


def default_parent():
    """Where new websites go unless the user picks another folder."""
    docs = Path.home() / "Documents"
    return str((docs if docs.is_dir() else Path.home()) / "Websites")


def create_site(parent, name, files):
    """Write the files of a new website into parent/name and open it."""
    name = (name or "").strip()
    if not name or name in (".", "..") or re.search(r"[/\\:\x00]", name):
        raise ValueError("Please choose a name without / or :")
    base = Path(str(parent or default_parent()).strip()).expanduser()
    if not base.is_absolute():
        base = Path.home() / base
    folder = (base / name).resolve()
    if folder.exists() and (not folder.is_dir() or any(folder.iterdir())):
        raise ValueError("The folder %s already exists and is not empty" % folder)
    checked = []
    for item in files or []:
        rel = PurePosixPath(str(item.get("path", "")))
        content = item.get("content")
        if rel.is_absolute() or ".." in rel.parts or not rel.parts or not isinstance(content, str):
            raise ValueError("Invalid file in the new website: %s" % rel)
        if rel.suffix.lower() not in NEW_SITE_EXT:
            raise ValueError("Unexpected file type in the new website: %s" % rel)
        checked.append((rel, content))
    if not any(rel.suffix.lower() in HTML_EXT for rel, _ in checked):
        raise ValueError("A website needs at least one page")
    try:
        for rel, content in checked:
            target = folder.joinpath(*rel.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content.encode("utf-8"))
    except PermissionError:
        raise ValueError("No permission to write to %s. Choose another folder, or allow Terminal to use it "
                         "(System Settings > Privacy & Security > Files and Folders)." % folder.parent)
    except OSError as e:
        raise ValueError("The website could not be written to %s (%s)." % (folder, e.strerror or e))
    return open_folder(folder)


def write_keeping_encoding(target, content):
    """Write a site file in the encoding it had, after a backup (once per session)."""
    encoding = read_text(target)[1] if target.exists() else "utf-8"
    backup_path = None
    if target.exists() and target not in STATE.backed_up:
        backup_path = backup(target)
        STATE.backed_up.add(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".wse-tmp")
    # Keep the file's original encoding (older sites may use Windows-1252).
    tmp.write_bytes(content.encode(encoding, "xmlcharrefreplace"))
    os.replace(tmp, target)
    return backup_path


def html_page(rel, must_exist):
    target = safe_path(rel)
    if target.suffix.lower() not in HTML_EXT:
        raise ValueError("Pages end in .html")
    if must_exist and not target.is_file():
        raise FileNotFoundError(rel)
    if not must_exist and target.exists():
        raise ValueError("A page with this name already exists: %s" % rel)
    return target


def rename_page(old, new):
    """Rename a page and change the links to it on every page of the site."""
    source, target = html_page(old, True), html_page(new, False)
    backup(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    os.replace(source, target)
    STATE.backed_up.discard(source)
    changed = 0
    for rel in list_site()[0]:
        page = STATE.root / rel
        text, _ = read_text(page)
        old_link = Path(os.path.relpath(source, page.parent)).as_posix()
        new_link = Path(os.path.relpath(target, page.parent)).as_posix()
        pattern = re.compile(r"(\bhref\s*=\s*([\"']))(?:\./)?%s(?=[#?\"'])" % re.escape(old_link), re.I)
        updated = pattern.sub(lambda m: m.group(1) + new_link, text)
        if updated != text:
            write_keeping_encoding(page, updated)
            changed += 1
    return changed


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 80))  # no packet is sent, this only picks the interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


# ---------------------------------------------------------------- handlers

class SiteOnlyHandler(SimpleHTTPRequestHandler):
    """Read-only server for viewing the site on a phone in the same Wi-Fi."""

    def translate_path(self, path):
        path = urllib.parse.urlsplit(path).path
        try:
            return str(safe_path(path))
        except PermissionError:
            return str(Path("/nonexistent"))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


class EditorHandler(SimpleHTTPRequestHandler):
    server_version = "WYSIWYGEdit/1.0"

    def log_message(self, fmt, *args):
        if os.environ.get("WSE_DEBUG"):
            super().log_message(fmt, *args)

    # -- responses

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, message):
        self.send_json({"error": message}, status)

    def send_file(self, path, body=None, utf8=False):
        if body is None:
            body = path.read_bytes()
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if utf8:
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # -- safety

    def host_ok(self):
        """Refuse requests whose Host is not this machine (DNS rebinding)."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        return host in ("localhost", "127.0.0.1", "::1")

    def api_ok(self):
        """Writes need a custom header, which other websites cannot send."""
        return self.headers.get("X-WSE") == "1"

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    # -- routing

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.host_ok():
            return self.send_error_json(403, "Forbidden host")
        url = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(url.query)
        try:
            if url.path == "/":
                return self.send_file(APP_DIR / "index.html", utf8=True)
            if url.path.startswith("/app/"):
                target = (APP_DIR / url.path[5:]).resolve()
                if APP_DIR not in target.parents or not target.is_file():
                    return self.send_error_json(404, "Not found")
                return self.send_file(target, utf8=target.suffix in (".html", ".css", ".js", ".svg"))
            if url.path == "/api/state":
                return self.api_state()
            if url.path == "/api/page":
                return self.api_page(query.get("path", [""])[0])
            if url.path.startswith("/site/"):
                return self.serve_site(url.path[6:], "wse-render" in query)
            if url.path == "/favicon.ico":
                return self.send_file(APP_DIR / "icon.svg")
            return self.send_error_json(404, "Not found")
        except PermissionError as exc:
            return self.send_error_json(403, str(exc))
        except (FileNotFoundError, IsADirectoryError):
            return self.send_error_json(404, "Not found")

    def do_POST(self):
        if not self.host_ok() or not self.api_ok():
            return self.send_error_json(403, "Forbidden")
        url = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(url.query)
        try:
            if url.path == "/api/open":
                return self.api_open(self.read_json())
            if url.path == "/api/choose-folder":
                data = self.read_json()
                path = choose_folder_dialog(data.get("prompt"), data.get("start"))
                if not path:
                    return self.send_json({"cancelled": True})
                open_folder(path)
                return self.api_state()
            if url.path == "/api/pick-folder":
                data = self.read_json()
                path = choose_folder_dialog(data.get("prompt") or "Where should the new website be saved?", data.get("start"))
                return self.send_json({"cancelled": True} if not path else {"path": path})
            if url.path == "/api/create-site":
                data = self.read_json()
                create_site(data.get("parent"), data.get("name"), data.get("files"))
                return self.api_state()
            if url.path == "/api/create-page":
                data = self.read_json()
                if not isinstance(data.get("content"), str):
                    raise ValueError("Missing content")
                target = html_page(data.get("path", ""), False)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data["content"].encode("utf-8"))
                return self.api_state()
            if url.path == "/api/delete-page":
                target = html_page(self.read_json().get("path", ""), True)
                backup_path = backup(target)
                target.unlink()
                STATE.renders.pop(target, None)
                return self.send_json({"ok": True, "backup": backup_path})
            if url.path == "/api/rename-page":
                data = self.read_json()
                changed = rename_page(data.get("from", ""), data.get("to", ""))
                return self.send_json({"ok": True, "changed": changed})
            if url.path == "/api/save":
                return self.api_save(self.read_json())
            if url.path == "/api/render":
                data = self.read_json()
                target = safe_path(data.get("path", ""))
                if target.suffix.lower() not in HTML_EXT or not isinstance(data.get("html"), str):
                    raise ValueError("Only HTML pages can be shown")
                STATE.renders[target] = data["html"]
                return self.send_json({"ok": True})
            if url.path == "/api/upload":
                return self.api_upload(query)
            if url.path == "/api/phone":
                return self.api_phone()
            return self.send_error_json(404, "Not found")
        except PermissionError as exc:
            return self.send_error_json(403, str(exc))
        except (FileNotFoundError, RuntimeError, ValueError) as exc:
            return self.send_error_json(400, str(exc))

    # -- site files

    def serve_site(self, rel, rendered):
        target = safe_path(rel)
        if target.is_dir():
            if not self.path.split("?")[0].endswith("/"):
                self.send_response(301)
                self.send_header("Location", self.path.split("?")[0] + "/")
                self.end_headers()
                return
            target = target / "index.html"
        if not target.is_file():
            raise FileNotFoundError(rel)
        if rendered and target in STATE.renders:
            # The page as the editor shows it: the user's unsaved changes plus
            # markers that let the editor match what it shows to the file.
            return self.send_file(target, STATE.renders[target].encode("utf-8"), utf8=True)
        return self.send_file(target)

    # -- api

    def api_state(self):
        data = {"root": None, "recent": load_recent(), "platform": sys.platform, "defaultParent": default_parent(),
                "api": API_VERSION, "restart": server_changed()}
        if STATE.root is not None:
            pages, images = list_site()
            data.update(root=str(STATE.root), name=STATE.root.name, pages=pages, images=images)
        return self.send_json(data)

    def api_open(self, data):
        open_folder(data.get("path", ""))
        return self.api_state()

    def api_page(self, rel):
        target = safe_path(rel)
        source, _ = read_text(target)
        return self.send_json({"path": rel, "source": source, "scripts": find_scripts(source)})

    def api_save(self, data):
        target = safe_path(data.get("path", ""))
        if target.suffix.lower() not in SAVE_EXT:
            raise ValueError("Only HTML, CSS and JavaScript files can be saved")
        content = data.get("content")
        if not isinstance(content, str):
            raise ValueError("Missing content")
        backup_path = write_keeping_encoding(target, content)
        return self.send_json({"ok": True, "backup": backup_path})

    def api_upload(self, query):
        name = Path(query.get("name", [""])[0]).name
        folder = query.get("dir", ["images"])[0]
        if Path(name).suffix.lower() not in IMAGE_EXT:
            raise ValueError("Only image files can be uploaded")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_UPLOAD:
            raise ValueError("File is empty or too large")
        dest_dir = safe_path(folder)
        dest_dir.mkdir(parents=True, exist_ok=True)
        stem, ext = Path(name).stem or "image", Path(name).suffix.lower()
        stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-") or "image"
        dest = dest_dir / (stem + ext)
        n = 2
        while dest.exists():
            dest = dest_dir / ("%s-%d%s" % (stem, n, ext))
            n += 1
        dest.write_bytes(self.rfile.read(length))
        return self.send_json({"ok": True, "path": dest.relative_to(STATE.root).as_posix()})

    def api_phone(self):
        if STATE.root is None:
            raise RuntimeError("No site folder is open")
        if STATE.phone_server is None:
            base = self.server.server_address[1] + 1
            for port in range(base, base + 20):
                try:
                    srv = ThreadingHTTPServer(("0.0.0.0", port), SiteOnlyHandler)
                    break
                except OSError:
                    continue
            else:
                raise RuntimeError("Could not start the phone preview server")
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            STATE.phone_server = srv
        port = STATE.phone_server.server_address[1]
        return self.send_json({"url": "http://%s:%d/" % (lan_ip(), port)})


# ---------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(description="Visual editor for static HTML websites")
    parser.add_argument("folder", nargs="?", help="website folder to open")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser")
    args = parser.parse_args(argv)

    if args.folder:
        open_folder(args.folder)

    server = None
    for port in range(args.port, args.port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), EditorHandler)
            break
        except OSError:
            continue
    if server is None:
        sys.exit("Could not find a free port near %d" % args.port)

    url = "http://localhost:%d/" % server.server_address[1]
    print("WYSIWYG Edit is running at %s" % url)
    if STATE.root:
        print("Editing: %s" % STATE.root)
    print("Keep this window open while you edit. Press Ctrl+C to stop.")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
