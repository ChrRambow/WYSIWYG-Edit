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
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent / "editor"
CONFIG_DIR = Path.home() / ".wysiwyg-edit"
BACKUP_DIR = CONFIG_DIR / "backups"
RECENT_FILE = CONFIG_DIR / "recent.json"

HTML_EXT = {".html", ".htm"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico"}
SKIP_DIRS = {".git", "node_modules", ".wysiwyg-edit", "__pycache__"}
MAX_UPLOAD = 50 * 1024 * 1024

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


def split_scripts(source):
    """Replace every <script> element with an inert placeholder.

    The editor shows the page with these placeholders so that the site's
    JavaScript does not run (and change the page) while it is being edited.
    The original script elements are returned so the editor can put them
    back byte for byte when it saves.
    """
    scripts = []

    def repl(match):
        scripts.append(match.group(0))
        return '<script type="text/x-wse-off" data-wse-idx="%d"></script>' % (len(scripts) - 1)

    return SCRIPT_RE.sub(repl, source), scripts


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
    remember(folder)
    return folder


def choose_folder_dialog():
    """Show the native macOS folder picker. Returns None if cancelled."""
    if sys.platform != "darwin":
        raise RuntimeError("The folder dialog is only available on macOS. Please type the path.")
    script = 'POSIX path of (choose folder with prompt "Choose the folder of your website")'
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if result.returncode != 0:
        return None
    return result.stdout.strip()


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
                return self.serve_site(url.path[6:], "edit" in query)
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
                path = choose_folder_dialog()
                if not path:
                    return self.send_json({"cancelled": True})
                open_folder(path)
                return self.api_state()
            if url.path == "/api/save":
                return self.api_save(self.read_json())
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

    def serve_site(self, rel, edit_mode):
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
        if edit_mode and target.suffix.lower() in HTML_EXT:
            html, _ = split_scripts(read_text(target)[0])
            return self.send_file(target, html.encode("utf-8"), utf8=True)
        return self.send_file(target)

    # -- api

    def api_state(self):
        data = {"root": None, "recent": load_recent(), "platform": sys.platform}
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
        if target.suffix.lower() not in HTML_EXT:
            raise ValueError("Only HTML pages can be saved")
        content = data.get("content")
        if not isinstance(content, str):
            raise ValueError("Missing content")
        encoding = read_text(target)[1] if target.exists() else "utf-8"
        backup_path = None
        if target not in STATE.backed_up:
            backup_path = backup(target)
            STATE.backed_up.add(target)
        tmp = target.with_name(target.name + ".wse-tmp")
        # Keep the file's original encoding (older sites may use Windows-1252).
        tmp.write_bytes(content.encode(encoding, "xmlcharrefreplace"))
        os.replace(tmp, target)
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
