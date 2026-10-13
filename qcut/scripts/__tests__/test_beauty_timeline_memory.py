import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location(
    "beauty_timeline_memory", Path(__file__).parents[1] / "analyze-beauty-timeline-memory.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def sample(*, seconds, rss=1024, worker_rss=0, empty=False):
    processes = [] if empty else [{"pid": 100, "parent": 1, "name": "Electron", "rssKiB": rss}]
    if worker_rss:
        processes.append({"pid": 200, "parent": 100, "name": "Python", "rssKiB": worker_rss})
    return {"seconds": seconds, "processes": processes, "totalRssKiB": sum(row["rssKiB"] for row in processes)}


class BeautyTimelineMemoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.write(name="app-process.json", value={"appPid": 100, "startedAt": "2026-10-13T00:00:05Z"})

    def tearDown(self):
        self.directory.cleanup()

    def write(self, *, name, value):
        (self.root / name).write_text(json.dumps(value))

    def memory(self, *, rows):
        (self.root / "memory.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

    def report(self, *, warmup_seconds=10):
        return MODULE.build_report(evidence_root=self.root, warmup_seconds=warmup_seconds)

    def test_missing_origin_never_uses_mtime_and_reports_true_simultaneous_peak(self):
        self.memory(rows=[sample(seconds=5, rss=10*1024), sample(seconds=7, worker_rss=8*1024)])
        report = self.report()
        self.assertFalse(report["phase_analysis"]["available"])
        self.assertEqual(report["overall"]["rss_mib"]["total"]["peak"], 10)
        self.assertEqual(report["overall"]["rss_mib"]["workers"]["peak"], 8)
        self.assertIsNone(report["acceptance_verdict"])
        self.assertFalse(report["cleanup_observed"]["app_absence_after_last_observation"])

    def test_explicit_iso_origin_assigns_boundary_sample_to_next_phase(self):
        self.write(name="command.json", value={"runnerStartedAt": "2026-10-13T11:00:00+11:00"})
        self.write(name="e2e-evidence.json", value={"appPid": 100, "duration": 12, "stageEvents": [
            {"pass": "native", "stage": "exportStart", "timestamp": "2026-10-13T00:00:10Z"},
            {"pass": "native", "stage": "exportEnd", "timestamp": "2026-10-13T00:00:20Z"},
            {"pass": "native", "stage": "previewEnd", "timestamp": "2026-10-13T00:00:30Z"},
        ]})
        self.memory(rows=[sample(seconds=time) for time in (5, 10, 15, 20, 25, 30)])
        phases = self.report()["phase_analysis"]
        self.assertTrue(phases["available"])
        self.assertEqual([phase["statistics"]["sample_count"] for phase in phases["phases"]], [1, 2, 2, 1])
        self.assertEqual(phases["phases"][1]["name"], "export")
        self.assertFalse(phases["phases"][-1]["end_stage_observed"])

    def test_warmup_slope_uses_actual_irregular_sample_times(self):
        self.memory(rows=[sample(seconds=0, rss=100*1024)] + [
            sample(seconds=time, rss=(time + 10)*1024) for time in (10, 25, 30)])
        trend = self.report()["overall"]["trend"]
        self.assertEqual(trend["after_warmup_samples"], 3)
        self.assertAlmostEqual(trend["groups"]["total"]["after_warmup_slope_mib_per_minute"], 60)
        self.assertIsNone(trend["verdict"])

    def test_sample_after_shutdown_reports_absence_without_claiming_termination(self):
        self.memory(rows=[sample(seconds=5, worker_rss=1024), sample(seconds=7, empty=True)])
        cleanup = self.report()["cleanup_observed"]
        self.assertTrue(cleanup["app_absence_after_last_observation"])
        self.assertEqual(cleanup["worker_pids_absent_from_final_tree"], [200])
        self.assertTrue(cleanup["all_previously_observed_workers_absent_from_final_tree"])
        self.assertIsNone(cleanup["verdict"])
        self.assertIn("Reparented", cleanup["scope"])

    def test_totals_are_recomputed_and_partial_tail_warns(self):
        row = sample(seconds=5)
        row["totalRssKiB"] = 999
        self.memory(rows=[row])
        with (self.root / "memory.jsonl").open("a") as target:
            target.write('{"seconds":7')
        report = self.report()
        self.assertEqual(report["overall"]["rss_mib"]["total"]["peak"], 1)
        self.assertEqual(len(report["warnings"]), 2)

    def test_invalid_samples_and_pid_mismatch_fail(self):
        for rows in ([sample(seconds=5), sample(seconds=4)], [sample(seconds=5, rss=-1)]):
            with self.subTest(rows=rows):
                self.memory(rows=rows)
                with self.assertRaises(ValueError):
                    self.report()
        self.memory(rows=[sample(seconds=5)])
        self.write(name="e2e-evidence.json", value={"appPid": 999})
        with self.assertRaisesRegex(ValueError, "PID mismatch"):
            self.report()

    def test_timezone_free_origin_does_not_produce_phases(self):
        self.memory(rows=[sample(seconds=5)])
        self.write(name="command.json", value={"runnerStartedAt": "2026-10-13T00:00:00"})
        self.assertFalse(self.report()["phase_analysis"]["available"])

    def test_interrupted_export_remains_an_open_phase(self):
        self.write(name="command.json", value={"runnerStartedAt": "2026-10-13T00:00:00Z"})
        self.write(name="e2e-evidence.json", value={"status": "failed", "stageEvents": [
            {"pass": "independent", "stage": "exportStart", "timestamp": "2026-10-13T00:00:10Z"},
        ]})
        self.memory(rows=[sample(seconds=5), sample(seconds=10), sample(seconds=12)])
        phase = self.report()["phase_analysis"]["phases"][-1]
        self.assertEqual(phase["name"], "export")
        self.assertEqual(phase["statistics"]["sample_count"], 2)
        self.assertFalse(phase["end_stage_observed"])

    def test_duplicate_pids_are_not_double_counted(self):
        row = sample(seconds=5)
        row["processes"].append(row["processes"][0].copy())
        self.memory(rows=[row])
        with self.assertRaisesRegex(ValueError, "duplicate PID"):
            self.report()

    def test_empty_input_is_not_zero_rss_success(self):
        self.memory(rows=[])
        with self.assertRaisesRegex(ValueError, "No complete"):
            self.report()


if __name__ == "__main__":
    unittest.main()
