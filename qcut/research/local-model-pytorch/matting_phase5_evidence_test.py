"""Synthetic evidence/guard tests; never native or model-parity evidence."""
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from matting_phase5_report import checked_report, recheck_outputs
from matting_phase5_replay import deny_vendor_access, worker
from matting_torch import CPU_RUNTIME_SHA256, OUTPUT_SHAPES, SOURCE_SHA256


class EvidenceTests(unittest.TestCase):
    def report(self):
        return {"status": "native-parity-passed", "tolerances": {"atol": 1e-4, "rtol": 1e-4},
                "native": {"status": "completed", "forced_cpu": True, "forward_type": 0,
                           "runtime_sha256": CPU_RUNTIME_SHA256}, "artifact_sha256": "x", "source_sha256": SOURCE_SHA256}

    def test_checked_report_accepts_pinned_status_and_tolerance(self):
        value = self.report()
        with patch.object(Path, "read_text", return_value=json.dumps(value)):
            self.assertEqual(checked_report(path=Path("unused"), artifact_sha256="x"), value)

    def test_relaxed_tolerance_and_failed_case_not_promoted(self):
        for value in ({**self.report(), "tolerances": {"atol": .01, "rtol": .01}},
                      {**self.report(), "status": "native-parity-failed"}):
            with patch.object(Path, "read_text", return_value=json.dumps(value)):
                with self.assertRaisesRegex(ValueError, "fixed-tolerance"):
                    checked_report(path=Path("unused"))

    def test_native_backend_and_runtime_must_match(self):
        for key, wrong in (("status", "unverified"), ("forward_type", 1), ("forced_cpu", False), ("runtime_sha256", "other")):
            value = self.report()
            value["native"][key] = wrong
            with patch.object(Path, "read_text", return_value=json.dumps(value)):
                with self.assertRaisesRegex(ValueError, "pinned forced CPU"):
                    checked_report(path=Path("unused"))

    def test_artifact_provenance_must_match(self):
        with patch.object(Path, "read_text", return_value=json.dumps(self.report())):
            with self.assertRaisesRegex(ValueError, "provenance"):
                checked_report(path=Path("unused"), artifact_sha256="y")

    def test_empty_and_duplicate_cases_rejected(self):
        for cases in ([], [{"case": "case-000"}, {"case": "case-000"}]):
            with self.assertRaisesRegex(ValueError, "unique case"):
                recheck_outputs(root=Path("unused"), report={"cases": cases}, temporal=False)

    def test_partial_outputs_and_path_traversal_rejected_before_read(self):
        for case in ({"case": "case-000", "outputs": {"nn_3": {}}},
                     {"case": "../case-000", "outputs": OUTPUT_SHAPES}):
            with patch("matting_phase5_report.read_tensor", side_effect=AssertionError("no file read")):
                with self.assertRaisesRegex(ValueError, "four-output"):
                    recheck_outputs(root=Path("unused"), report={"cases": [case]}, temporal=False)

    def test_guard_rejects_sources_libraries_and_subprocesses(self):
        for event, args in (("open", ("/tmp/PrivateRuntimes/source",)), ("open", ("/tmp/arena-fp32.private.bin",)),
                            ("open", ("/tmp/graph.private.txt",)), ("ctypes.dlopen", ("libbytenn.dylib",)),
                            ("subprocess.Popen", ("native-probe",))):
            with self.assertRaises(RuntimeError):
                deny_vendor_access(event, args)

    def test_guard_allows_bundle_and_frozen_tensor_reads(self):
        for event, args in (("open", ("/private/run/matting-gru.pt",)), ("open", ("/private/run/in-data.f32",)),
                            ("open", (3,)), ("import", ("torch",)), ("ctypes.dlopen", ("libtorch.dylib",))):
            deny_vendor_access(event, args)

    def test_worker_thread_bounds_fail_before_read(self):
        with patch.object(Path, "read_text", side_effect=AssertionError("no file read")):
            for threads in (0, 3, 8):
                with self.assertRaisesRegex(ValueError, "thread count"):
                    worker(manifest=Path("missing"), out=Path("unused"), threads=threads)


if __name__ == "__main__":
    unittest.main()
