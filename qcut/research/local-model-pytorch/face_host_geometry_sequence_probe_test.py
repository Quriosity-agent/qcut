"""Pure synthetic sidecar contracts/lifecycle tests; never launch vendor code."""
import argparse
from copy import deepcopy
import json
import math
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from PIL import Image

import face_host_geometry_sequence_probe as probe
from face_host_geometry_contract_test import geometry_row, inactive_row


def events(*, count, timestamp=0):
    rows = []
    for _ in range(count):
        rows.extend([dict(event="owned_face_conversion", raw_clone_verified=True, original_restored=False,
                          native_analysis_bypassed=False, eye_shift=0, faces=0, external_points=False,
                          source_points_unchanged=True, owned_points_isolated=True,
                          timestamp_us=math.floor(timestamp * 1_000_000 + 0.5)),
                     dict(event="owned_face_restored", gpu_complete=True, original_restored=True)])
    return b"".join(json.dumps(row).encode() + b"\n" for row in rows)


class ContractTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)

    def manifest(self, *, frames):
        path = self.base / "manifest.json"
        path.write_text(json.dumps(dict(version=1, frames=frames)))
        return path

    def frame(self, *, image="image.png", timestamp=0):
        return dict(image=image, timestamp=timestamp, parameters={})

    def test_manifest_limits_local_paths_and_strict_json_are_reused(self):
        for frames in ([], [self.frame()] * 25, [self.frame(image="https://example.test/image.png")],
                       [self.frame(timestamp=float("nan"))], [dict(self.frame(), surprise=True)]):
            with self.subTest(count=len(frames)), self.assertRaises(ValueError):
                probe.prepare_inputs(manifest=self.manifest(frames=frames), out=self.base, locked=probe.LockedFiles())
        path = self.base / "manifest.json"
        path.write_text('{"version":1,"version":1,"frames":[]}')
        with self.assertRaisesRegex(ValueError, "duplicate JSON"):
            probe.prepare_inputs(manifest=path, out=self.base, locked=probe.LockedFiles())

    def test_one_and_24_images_repeat_reverse_timestamps_and_hash_guards(self):
        Image.new("RGB", (2, 1), "red").save(self.base / "image.png")
        for count in (1, 24):
            out = self.base / str(count)
            out.mkdir()
            locked = probe.LockedFiles()
            frames, size = probe.prepare_inputs(manifest=self.manifest(frames=[self.frame(timestamp=(count - i) / 30)
                for i in range(count)]), out=out, locked=locked)
            self.assertEqual((len(frames), size), (count, (2, 1)))
            self.assertEqual((out / "input-00.rgba").stat().st_size, 8)
            locked.verify()
        (self.base / "image.png").write_bytes(b"mutated")
        with self.assertRaises(ValueError):
            locked.verify()

    def test_mismatched_or_oversized_dimensions_reject_before_conversion(self):
        for size in ((3, 1), (4097, 1)):
            Image.new("RGB", (2, 1)).save(self.base / "image.png")
            Image.new("RGB", size).save(self.base / "other.png")
            with self.subTest(size=size), self.assertRaises(ValueError):
                probe.prepare_inputs(manifest=self.manifest(frames=[self.frame(), self.frame(image="other.png")]),
                                     out=self.base, locked=probe.LockedFiles())

    def read_snapshots(self, *, rows):
        directory = Mock(spec=Path)
        paths = [Path(f"prediction-{index}.json") for index in range(len(rows))]
        directory.glob.return_value = paths
        locked = Mock(read=Mock(side_effect=[json.dumps(row).encode() for row in rows]))
        return probe.snapshots(directory=directory, locked=locked)

    def test_snapshot_empty_faces_inactive_pool_and_repeated_markers_are_allowed(self):
        rows = [geometry_row(), inactive_row(), geometry_row(index=2)]
        rows[0]["faces"] = []
        rows[1].update(index=1, bytenn_sequence=16)
        rows[2]["bytenn_sequence"] = 16
        self.assertEqual(self.read_snapshots(rows=rows), rows)

    def test_snapshot_gaps_decreasing_markers_unstable_provenance_and_wrong_dimensions_reject(self):
        for key, value in (("index", 2), ("bytenn_sequence", 1), ("handle", 12288),
                           ("request", [0, 641, 480, 2564, 0]), ("error", "native failure")):
            rows = [geometry_row(), dict(geometry_row(index=1), **{key: value})]
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.read_snapshots(rows=rows)
        for key in ("predictors", "tables"):
            rows = [geometry_row(), geometry_row(index=1)]
            if key == "tables":
                rows[1][key]["base"][0] = 0.6
            else:
                rows[1][key][0]["network"] += 4096
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.read_snapshots(rows=rows)
        self.assertEqual(self.read_snapshots(rows=[geometry_row()])[0]["request"], [0, 640, 480, 2560, 0])
        for count in (0, 65):
            with self.subTest(count=count), self.assertRaises(ValueError):
                self.read_snapshots(rows=[geometry_row()] * count)

    def test_exact_counts_rounding_gpu_restores_and_conversion_isolation(self):
        data = events(count=2, timestamp=1 / 30)
        self.assertEqual(probe.exact_events(data=data, count=2, timestamp=1 / 30)["owned_face_restorations"], 2)
        for count in (0, 1, 3):
            with self.subTest(count=count), self.assertRaises(RuntimeError):
                probe.exact_events(data=events(count=count), count=2)
        for field, value in (("gpu_complete", False), ("original_restored", False), ("external_points", True),
                             ("source_points_unchanged", False), ("owned_points_isolated", False), ("timestamp_us", False)):
            rows = [json.loads(line) for line in events(count=2).splitlines()]
            rows[1 if field in {"gpu_complete", "original_restored"} else 0][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                probe.exact_events(data=b"\n".join(json.dumps(row).encode() for row in rows), count=2, timestamp=0)
        rows = events(count=2).splitlines()
        with self.assertRaisesRegex(RuntimeError, "restoration order"):
            probe.exact_events(data=b"\n".join([rows[0], rows[2], rows[1], rows[3]]), count=2)


class RunTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.capture, self.runtime, self.package = (self.base / name for name in ("capture", "runtime", "package"))
        for name in ("capture/control/original", "capture/control/clone-audit", "runtime/Frameworks", "runtime/Models", "package"):
            (self.base / name).mkdir(parents=True)
        self.pixels = bytes((1, 2, 3, 255))
        for path in (self.capture / "control/input.rgba", *(self.capture / f"control/original/frame-{i}.rgba" for i in range(4))):
            path.write_bytes(self.pixels)
        self.host_path, self.byte_observer = self.capture / "control/clone-audit/host", self.capture / "observer.dylib"
        self.host_path.write_bytes(b"synthetic owned host")
        self.byte_observer.write_bytes(b"synthetic ByteNN observer")
        for name in ("liblens.dylib", "libbytenn.dylib"):
            (self.runtime / "Frameworks" / name).write_bytes(b"synthetic runtime")
        tensor = dict(name="data", inference=0, dims_nwhc=[1, 1, 1, 4], raw=[1, 0],
                      path="/synthetic/input.bin", sha256="0" * 64)
        self.previous = dict(passed=True, native_analysis_bypassed=False, comparisons=[dict(equal=True)] * 4,
                             host_sha256=probe.digest(data=self.host_path.read_bytes()),
                             observer_sha256=probe.digest(data=self.byte_observer.read_bytes()), source_sha256={},
                             captures=dict(metadata_records=1, successful_inferences=1, networks={"32768": dict(
                                 graph_path="/synthetic/graph.txt", graph_sha256="0" * 64, declared_outputs=["data"],
                                 successful_inferences=[0], inputs=[tensor], outputs=[])}))
        self.control = dict(passed=True, owned_result_rendered=True, native_analysis_bypassed=False, width=1, height=1,
                            input_rgba_sha256=probe.digest(data=self.pixels), source_sha256={},
                            frames=[dict(sha256=probe.digest(data=self.pixels))] * 4)
        self.manifest = self.base / "manifest.json"
        Image.frombytes("RGBA", (1, 1), self.pixels).save(self.base / "image.png")
        self.frames = [dict(image="image.png", timestamp=value, parameters={}, label=f"frame-{i}")
                       for i, value in enumerate((0.5, 1 / 30, 1 / 30, 0))]
        self.hosts, self.entries = [], []
        self.host_error, self.close_error, self.reader_error = None, None, None
        self.protocol_bad, self.changed, self.truncated, self.event_count, self.gpu = False, False, False, 2, True
        self.compiler = Mock(side_effect=self.compile_observer)
        self.factory = Mock(side_effect=self.create_host)
        self.library = Mock()
        replacements = (patch.object(probe.sequence, "fresh_output", side_effect=self.fresh_output),
                        patch.object(probe.consumer, "verify_library", self.library),
                        patch.object(probe.subprocess, "run", self.compiler),
                        patch.object(probe.sequence, "BoundedHost", self.factory),
                        patch.object(probe.models, "inventory", side_effect=lambda **_: deepcopy(self.inventory)),
                        patch.object(probe.geometry, "LIBRARY_SHA256", probe.digest(data=b"synthetic runtime")),
                        patch.object(probe.geometry, "BYTENN_SHA256", probe.digest(data=b"synthetic runtime")))
        for replacement in replacements:
            replacement.start()
            self.addCleanup(replacement.stop)
        self.attempt = 0

    def fresh_output(self, *, path):
        path.mkdir()
        return path

    def compile_observer(self, command, **_kwargs):
        out = Path(command[-1]).parent
        Path(command[-1]).write_bytes(b"synthetic geometry observer")
        graph = out / "capture/graph.txt"
        graph.write_bytes(b"synthetic graph")
        self.inventory = dict(successful_inferences=1, metadata_records=1, networks={
            str(address): dict(graph_path=str(graph), graph_sha256=probe.digest(data=graph.read_bytes()),
                               successful_inferences=[0] if address == 32768 else [], inputs=[], outputs=[])
            for address in (32768, 57344)})
        (out / "capture/000.json").write_text(json.dumps(dict(index=0, kind="espresso-inference", bytes=0,
                                                             detail="self=32768 inference=0 rc=0")))
        for index, row in enumerate((geometry_row(), inactive_row(), geometry_row(index=2))):
            row.update(index=index, request=[0, 1, 1, 4, 0], bytenn_sequence=16,
                       frame_file=f"frame-{index}.rgba", frame_bytes=4)
            row["faces"] = [] if index != 1 else row["faces"]
            (out / f"geometry/prediction-{index}.json").write_text(json.dumps(row))
            (out / f"geometry/frame-{index}.rgba").write_bytes(self.pixels)

    def create_host(self, **kwargs):
        directory = kwargs["log"].parent
        records = directory / "records.jsonl"
        records.write_bytes(b"")
        kwargs["log"].write_text("synthetic bounded log\n")
        host = Mock(protocol_rows=["QCUT\tREADY\t1"], reader_error=self.reader_error)
        self.hosts.append(host)
        self.entries.append(kwargs)
        if self.host_error == "receive":
            host.receive.side_effect = RuntimeError("receive failed")
        if self.host_error == "finish":
            host.finish.side_effect = RuntimeError("finish failed")
        if self.close_error:
            host.close.side_effect = RuntimeError("close failed")

        def render(**request):
            if self.host_error == "render":
                raise RuntimeError("render failed")
            warmup = request["request_id"].startswith("warmup")
            data = bytes((9, 2, 3, 255)) if self.changed and directory.name == "observed" else self.pixels
            request["output_path"].write_bytes(data[:3] if self.truncated else data)
            count = 0 if request["request_id"] == "warmup-0" else (2 if warmup else self.event_count)
            trace = events(count=count, timestamp=request["timestamp"])
            with records.open("ab") as stream:
                stream.write(trace if self.gpu else trace.replace(b'"gpu_complete": true', b'"gpu_complete": false'))
            if not self.protocol_bad:
                host.protocol_rows.append(f"QCUT\tRESULT\t{request['request_id']}\t0")
        host.render.side_effect = render
        return host

    def run_probe(self):
        self.attempt += 1
        self.out = self.base / f"out-{self.attempt}"
        (self.capture / "report.json").write_text(json.dumps(self.previous))
        (self.capture / "control/report.json").write_text(json.dumps(self.control))
        self.manifest.write_text(json.dumps(dict(version=1, frames=self.frames)))
        return probe.run(args=argparse.Namespace(capture=self.capture, manifest=self.manifest,
                                                runtime=self.runtime, package=self.package, out=self.out))

    def assert_failed(self, *, message, error=RuntimeError):
        with self.assertRaisesRegex(error, message):
            self.run_probe()
        report = json.loads((self.out / "report.json").read_text())
        self.assertIs(report["passed"], False)
        self.assertIs(report["per_face_inference_association_verified"], False)
        self.assertTrue(report["failures"])
        for host in self.hosts:
            host.close.assert_called_once_with()
        return report

    def test_success_two_same_owned_hosts_observer_only_on_second_and_artifacts(self):
        report = self.run_probe()
        self.assertTrue(report["passed"] and report["observer_pixel_parity_verified"])
        self.assertIs(report["per_prediction_inference_association_verified"], True)
        self.assertIs(report["per_face_inference_association_verified"], False)
        self.assertEqual(report["prediction_inferences"][1]["inferences"], [])
        self.assertEqual(self.entries[0]["command"], self.entries[1]["command"])
        self.assertNotIn("DYLD_INSERT_LIBRARIES", self.entries[0]["environment"])
        self.assertEqual(self.entries[1]["environment"]["DYLD_INSERT_LIBRARIES"],
                         f"{self.byte_observer.resolve()}:{self.out / 'geometry-observer.dylib'}")
        for host, entry in zip(self.hosts, self.entries, strict=True):
            host.finish.assert_called_once_with()
            host.close.assert_called_once_with()
            self.assertEqual(host.render.call_count, 6 + len(self.frames))
            self.assertEqual(entry["max_rows"], 7 + len(self.frames))
            self.assertNotIn("QCUT_FACE_BIND_REPLAY", entry["environment"])
            self.assertTrue(all(call.kwargs["timestamp"] == 0.5 for call in host.render.call_args_list[:6]))
        self.compiler.assert_called_once()
        self.assertIn("-Werror", self.compiler.call_args.args[0])
        self.assertEqual(self.compiler.call_args.kwargs, dict(check=True, timeout=180))
        for index in range(len(self.frames)):
            for run in ("baseline", "observed"):
                self.assertTrue((self.out / run / f"frame-{index:02d}.png").is_file())
            with Image.open(self.out / f"frame-{index:02d}-diff-gain8.png") as gray:
                self.assertEqual(gray.getpixel((0, 0)), 0)
        self.assertEqual(len(report["algorithm_frames"]), 3)

    def test_24_frame_budget_and_exact_counts(self):
        self.frames *= 6
        report = self.run_probe()
        self.assertEqual(len(report["comparisons"]), 24)
        self.assertTrue(all(entry["owned_face_conversions"] == 58 for entry in report["runs"]))
        self.assertTrue(all(entry["max_rows"] == 31 for entry in self.entries))

    def test_strict_static_capture_and_control_flags_reject_before_compile(self):
        for owner, key, value in ((self.previous, "passed", 1), (self.previous, "comparisons", [dict(equal=True)] * 3),
                                  (self.previous, "native_analysis_bypassed", True),
                                  (self.control, "owned_result_rendered", 1), (self.control, "native_analysis_bypassed", 0)):
            original = owner[key]
            owner[key] = value
            with self.subTest(key=key):
                self.assert_failed(message="capture|baseline", error=ValueError)
                self.compiler.assert_not_called()
                self.factory.assert_not_called()
            owner[key] = original

    def test_bad_hash_and_compile_failure_are_saved_without_host_launch(self):
        self.previous["host_sha256"] = "0" * 64
        self.assert_failed(message="hash mismatch", error=ValueError)
        self.factory.assert_not_called()
        self.previous["host_sha256"] = probe.digest(data=self.host_path.read_bytes())
        self.compiler.side_effect = subprocess.CalledProcessError(1, ["synthetic compiler"])
        self.assert_failed(message="non-zero exit", error=subprocess.CalledProcessError)

    def test_host_creation_failure_is_reported_without_native_retry(self):
        self.factory.side_effect = RuntimeError("host creation failed")
        self.assert_failed(message="host creation failed")
        self.factory.assert_called_once()
        self.compiler.assert_called_once()

    def test_baseline_observer_and_source_hashes_are_not_relaxed_for_temporal_mode(self):
        for key in ("observer_sha256", "source_sha256"):
            original = self.previous[key]
            self.previous[key] = "0" * 64 if key == "observer_sha256" else {
                "local-model-pytorch/face_host_geometry_sequence_probe.py": "0" * 64}
            with self.subTest(key=key):
                self.assert_failed(message="hash mismatch", error=ValueError)
                self.factory.assert_not_called()
            self.previous[key] = original

    def test_receive_render_finish_and_close_failures_always_close(self):
        for operation in ("receive", "render", "finish", "close"):
            self.host_error, self.close_error = operation, operation == "close"
            with self.subTest(operation=operation):
                self.assert_failed(message=f"{operation} failed")
        self.host_error, self.close_error = "render", True
        report = self.assert_failed(message="render failed")
        self.assertIn("close failed", report["runs"][0]["close_error"])

    def test_protocol_reader_truncation_count_and_gpu_failures_reject(self):
        for field, value, message, error in (("protocol_bad", True, "protocol", RuntimeError),
                ("reader_error", RuntimeError("reader failed"), "protocol", RuntimeError),
                ("truncated", True, "byte count", ValueError), ("event_count", 3, "exact seek count", RuntimeError),
                ("gpu", False, "GPU-completion", RuntimeError)):
            original = getattr(self, field)
            setattr(self, field, value)
            with self.subTest(field=field):
                self.assert_failed(message=message, error=error)
            setattr(self, field, original)

    def test_pixel_change_retains_all_comparisons_gray_and_closed_hosts(self):
        self.changed = True
        report = self.assert_failed(message="changed beauty pixels")
        self.assertEqual(len(report["comparisons"]), len(self.frames))
        self.assertFalse(report["observer_pixel_parity_verified"])
        with Image.open(self.out / "frame-00-diff-gain8.png") as gray:
            self.assertEqual(gray.getpixel((0, 0)), 64)

    def test_association_and_final_guard_failures_stay_failed(self):
        with patch.object(probe, "associate_inferences", side_effect=ValueError("bad temporal metadata")):
            self.assert_failed(message="bad temporal metadata", error=ValueError)
        self.library.side_effect = [None, ValueError("runtime mutated")]
        self.assert_failed(message="runtime mutated", error=ValueError)

    def test_generated_frame_inventory_and_locked_observer_mutations_reject(self):
        with patch.object(probe.geometry, "algorithm_frames", return_value=[]):
            self.assert_failed(message="algorithm frames required", error=ValueError)
        with patch.object(probe.models, "inventory", side_effect=[{}, {}]):
            self.assert_failed(message="networks", error=KeyError)
        original = self.create_host

        def mutating_host(**kwargs):
            host = original(**kwargs)
            host.finish.side_effect = lambda: self.byte_observer.write_bytes(b"changed observer")
            return host
        self.factory.side_effect = mutating_host
        self.assert_failed(message="fixture changed|hash mismatch", error=ValueError)

    def test_cli_parses_exact_requested_paths(self):
        paths = dict(capture=self.capture, manifest=self.manifest, runtime=self.runtime, package=self.package, out=self.base / "out")
        argv = ["probe", *(item for name, path in paths.items() for item in (f"--{name}", str(path)))]
        with patch.object(probe.sys, "argv", argv), patch.object(probe, "run", return_value={
                "passed": True, "predictions": 1, "comparisons": []}) as run, patch("builtins.print"):
            probe.main()
        self.assertEqual(vars(run.call_args.kwargs["args"]), paths)


if __name__ == "__main__":
    unittest.main()
