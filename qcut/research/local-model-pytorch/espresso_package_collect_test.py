"""Synthetic collector regressions; no vendor runtime, model weights or keys required."""
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import espresso_package_collect as collector

GRAPH = ("1 1 42\nDataV2 data 1 2 2 1 1 6 0\n"
         "Convolution cv 1 1 1 1 1 0 0 0 0 1 6 4 12 1 6 data out\n")
ARENA = b"\x01\x2a\x00\x00\x00"
CREATED = {"create": 0, "default_in": "data", "names": [
    {"dims": [1, 2, 2, 1], "raw": [1, 6]}, {"dims": [1, 2, 2, 1], "raw": [1, 6]},
]}


class CollectorTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.package = self.root / "package"
        self.package.mkdir()
        self.out = self.root / "collected"
        self.capture = self.root / "capture"
        self.capture.mkdir()

    def record(self, *, name="record", text=GRAPH, arena=ARENA):
        (self.package / f"{name}.config.bin").write_text(text)
        (self.package / f"{name}.weight.bin").write_bytes(arena)

    def collect(self):
        return collector.collect(package_dirs=[self.package], out=self.out, label="test", capture_dirs=[self.capture])

    def assert_clean_output(self):
        self.assertEqual(list(self.out.glob("*/")), [])
        self.assertEqual(list(self.root.glob(".espresso-package-*")), [])

    def test_same_graph_different_weights_survive_and_repeat_is_idempotent(self):
        self.record(name="first")
        self.record(name="second", arena=b"\x02" + ARENA[1:])
        with patch.object(collector, "probe", return_value=(0, CREATED)) as probe:
            manifest = self.collect()
            self.assertEqual(len(manifest["nets"]), 2)
            self.assertEqual(len({net["id"] for net in manifest["nets"]}), 2)
            for net in manifest["nets"]:
                self.assertEqual((self.out / net["id"] / "graph.txt").read_text(), GRAPH)
            self.assertEqual(len(self.collect()["nets"]), 2)
            self.assertEqual(probe.call_count, 2)

    def test_rejected_candidates_are_never_published(self):
        self.record()
        def reject(graph, arena, names):
            self.assertTrue(graph.exists() and arena.exists())
            self.assertFalse(graph.is_relative_to(self.out))
            self.assertEqual(list(self.out.glob("*/")), [])
            return 1, {"create": -4}
        with patch.object(collector, "probe", side_effect=reject):
            self.assertEqual(self.collect()["nets"], [])
        self.assert_clean_output()

    def test_accounting_mismatch_leaves_no_network(self):
        self.record(arena=ARENA[:-1])
        with patch.object(collector, "probe") as probe:
            self.assertEqual(self.collect()["nets"], [])
            probe.assert_not_called()
        self.assert_clean_output()

    def test_probe_exception_removes_staging(self):
        self.record()
        with patch.object(collector, "probe", side_effect=subprocess.TimeoutExpired("probe", 1)):
            with self.assertRaises(subprocess.TimeoutExpired):
                self.collect()
        self.assert_clean_output()

    def test_compressed_record_skips_broken_captures_and_hashes_stored_graph(self):
        self.record(text="F\n" + GRAPH, arena=b"\x01")
        invalid = [b"{", b"\xff", b"{}", b"[]", b'{"detail": {}}', b'{"detail": null}',
                   b'{"detail": "stamp=42 bytes=5"}']
        for index, data in enumerate(invalid):
            (self.capture / f"{index:03}-heap-stamp.json").write_bytes(data)
        (self.capture / "099-heap-stamp.json").write_text(json.dumps({"detail": "stamp=42 bytes=5"}))
        (self.capture / "099-heap-stamp.bin").write_bytes(b"prefix" + ARENA)
        with patch.object(collector, "probe", return_value=(0, CREATED)):
            net = self.collect()["nets"][0]
            self.assertEqual(len(self.collect()["nets"]), 1)
        graph = (self.out / net["id"] / "graph.txt").read_bytes()
        self.assertEqual(graph, GRAPH.encode())
        self.assertEqual(net["graph_bytes"], len(graph))
        self.assertEqual(net["graph_sha256"], hashlib.sha256(graph).hexdigest())
        self.assertEqual(net["source_graph_sha256"], hashlib.sha256(("F\n" + GRAPH).encode()).hexdigest())
        self.assertEqual((self.out / net["id"] / "arena.bin").read_bytes(), ARENA)

    def test_missing_compressed_window_leaves_no_network(self):
        self.record(text="F\n" + GRAPH, arena=b"\x01")
        self.assertEqual(self.collect()["nets"], [])
        self.assert_clean_output()

    def test_legacy_manifest_uses_stored_graph_for_duplicate_check(self):
        self.out.mkdir()
        legacy = self.out / "legacy-id"
        legacy.mkdir()
        (legacy / "graph.txt").write_bytes(GRAPH.encode())
        (legacy / "arena.bin").write_bytes(ARENA)
        (self.out / "manifest.json").write_text(json.dumps({"nets": [{
            "id": legacy.name, "graph_sha256": hashlib.sha256(("F\n" + GRAPH).encode()).hexdigest(),
            "arena_sha256": hashlib.sha256(ARENA).hexdigest(),
        }]}))
        self.record()
        with patch.object(collector, "probe") as probe:
            self.assertEqual(len(self.collect()["nets"]), 1)
            probe.assert_not_called()


if __name__ == "__main__":
    unittest.main()
