"""Unit tests for the server. Run:  python3 -m unittest discover tests"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


class ScriptTests(unittest.TestCase):
    def test_find_scripts(self):
        src = '<head><script>var a = "<body>";</script></head><body><p>x</p><SCRIPT src="a.js"></SCRIPT ></body>'
        found = server.find_scripts(src)
        self.assertEqual(len(found), 2)
        for s in found:
            self.assertEqual(src[s["start"]:s["end"]], s["text"])
        self.assertIn("a.js", found[1]["text"])


class PathTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        server.STATE.root = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def test_inside(self):
        self.assertEqual(server.safe_path("a/b.html"), server.STATE.root / "a" / "b.html")

    def test_outside_is_refused(self):
        for bad in ("../x", "a/../../x", "%2e%2e/x", "/../x"):
            with self.assertRaises(PermissionError):
                server.safe_path(bad)


class EncodingTests(unittest.TestCase):
    def test_read_text_keeps_encoding(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "a.html"
            p.write_bytes("Grüße".encode("cp1252"))
            self.assertEqual(server.read_text(p), ("Grüße", "cp1252"))
            p.write_bytes(b"\xef\xbb\xbfhi")
            self.assertEqual(server.read_text(p), ("hi", "utf-8-sig"))


class NewSiteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.parent = Path(self.tmp.name)
        self.config = server.CONFIG_DIR, server.RECENT_FILE
        server.CONFIG_DIR = self.parent / ".config"
        server.RECENT_FILE = server.CONFIG_DIR / "recent.json"

    def tearDown(self):
        server.CONFIG_DIR, server.RECENT_FILE = self.config
        self.tmp.cleanup()

    def test_creates_and_opens(self):
        files = [{"path": "index.html", "content": "<p>Grüße</p>"}, {"path": "css/style.css", "content": "p{}"}]
        folder = server.create_site(str(self.parent), "Meine Seite", files)
        self.assertEqual(folder, (self.parent / "Meine Seite").resolve())
        self.assertEqual((folder / "index.html").read_text("utf-8"), "<p>Grüße</p>")
        self.assertTrue((folder / "css" / "style.css").is_file())
        self.assertEqual(server.STATE.root, folder)

    def test_refuses_bad_input(self):
        page = [{"path": "index.html", "content": "x"}]
        for name in ("", "a/b", "..", "x:y"):
            with self.assertRaises(ValueError):
                server.create_site(str(self.parent), name, page)
        for bad in ("../x.html", "/abs.html", "run.sh"):
            with self.assertRaises(ValueError):
                server.create_site(str(self.parent), "s", page + [{"path": bad, "content": "x"}])
        with self.assertRaises(ValueError):
            server.create_site(str(self.parent), "s", [{"path": "a.css", "content": "x"}])
        (self.parent / "full").mkdir()
        (self.parent / "full" / "keep.txt").write_text("x")
        with self.assertRaises(ValueError):
            server.create_site(str(self.parent), "full", page)


class RenameTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        server.STATE.root = self.root
        server.STATE.backed_up = set()
        self.backups = server.BACKUP_DIR
        server.BACKUP_DIR = self.root.parent / (self.root.name + "-backups")
        (self.root / "blog").mkdir()
        (self.root / "index.html").write_text('<a href="old.html">a</a> <a href="./old.html#x">b</a> <a href="bold.html">c</a>', "utf-8")
        (self.root / "old.html").write_text('<a href="old.html">self</a>', "utf-8")
        (self.root / "blog" / "post.html").write_bytes('<a href="../old.html">ü</a>'.encode("cp1252"))

    def tearDown(self):
        server.BACKUP_DIR = self.backups
        self.tmp.cleanup()

    def test_rename_updates_links(self):
        changed = server.rename_page("old.html", "new.html")
        self.assertEqual(changed, 3)
        self.assertFalse((self.root / "old.html").exists())
        self.assertEqual((self.root / "index.html").read_text("utf-8"),
                         '<a href="new.html">a</a> <a href="new.html#x">b</a> <a href="bold.html">c</a>')
        self.assertEqual((self.root / "new.html").read_text("utf-8"), '<a href="new.html">self</a>')
        self.assertEqual((self.root / "blog" / "post.html").read_bytes(), '<a href="../new.html">ü</a>'.encode("cp1252"))

    def test_rename_refuses_existing(self):
        with self.assertRaises(ValueError):
            server.rename_page("old.html", "index.html")


if __name__ == "__main__":
    unittest.main()
