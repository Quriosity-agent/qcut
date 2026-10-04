"""Fresh subprocesses must execute guarded source, not valid-but-stale bytecode."""
from pathlib import Path
import json
import os
import py_compile
import subprocess
import sys
import tempfile
import unittest

import face_live_bridge_probe as probe


class BytecodeTests(unittest.TestCase):
    def test_fresh_prefix_ignores_valid_stale_cache_without_writing_new_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            module = root / "cached_fixture.py"
            module.write_text('VALUE = "stale"\n')
            metadata = module.stat()
            py_compile.compile(str(module), doraise=True)
            module.write_text('VALUE = "fresh"\n')
            os.utime(module, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
            entry = root / "entry.py"
            entry.write_text("import cached_fixture; print(cached_fixture.VALUE)\n")
            ordinary = subprocess.run([sys.executable, "-B", str(entry)],
                capture_output=True, text=True, check=True, timeout=15)
            self.assertEqual(ordinary.stdout.strip(), "stale")
            prefix = root / "private-empty-cache"
            command = probe.python_command(script=entry, cache=prefix, arguments=[])
            fresh = subprocess.run(command, capture_output=True, text=True, check=True, timeout=15)
            self.assertEqual(fresh.stdout.strip(), "fresh")
            self.assertFalse(prefix.exists())

    def test_observer_prefix_precedes_every_research_import(self):
        config = Path("/private/fresh-audit/lldb-config.json")
        command = probe.lldb_command(config=config)
        setup = command[command.index("-o") + 1]
        self.assertIn('sys.pycache_prefix = "/private/fresh-audit/lldb-python-cache"', setup)
        self.assertIn("sys.dont_write_bytecode = True", setup)
        self.assertIn("sys.path.insert", setup)
        self.assertLess(command.index(setup), command.index(
            "command script import " + json.dumps(str(probe.bundle.HERE / "face_live_bridge_lldb.py"))))


if __name__ == "__main__":
    unittest.main()
