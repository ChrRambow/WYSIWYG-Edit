"""Unit tests for the server. Run:  python3 -m unittest discover tests"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


class ScriptTests(unittest.TestCase):
    def test_split_and_find_agree(self):
        src = '<head><script>var a = "<body>";</script></head><body><p>x</p><SCRIPT src="a.js"></SCRIPT ></body>'
        html, scripts = server.split_scripts(src)
        found = server.find_scripts(src)
        self.assertEqual(scripts, [s["text"] for s in found])
        self.assertEqual(len(scripts), 2)
        self.assertIn('<script type="text/x-wse-off" data-wse-idx="1"></script>', html)
        self.assertNotIn("a.js", html)
        for s in found:
            self.assertEqual(src[s["start"]:s["end"]], s["text"])


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


if __name__ == "__main__":
    unittest.main()
