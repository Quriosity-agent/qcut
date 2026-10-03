"""Synthetic campaign/subprocess regressions; no native host is executed."""
import argparse
from contextlib import ExitStack
from copy import deepcopy
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from face_host_geometry_contract_test import geometry_row
import face_temporal_campaign as campaign


def write_bytes(*, path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return campaign.digest(data=data)


def write_json(*, path, value):
    return write_bytes(path=path, data=json.dumps(value, allow_nan=False).encode())


def inventory(*, root):
    tensor = dict(name="data", inference=0, dims_nwhc=[1, 120, 120, 3], raw=[2, 6],
                  path=str(root / "synthetic-input"), sha256="a" * 64)
    network = dict(graph_sha256="b" * 64, graph_path=str(root / "synthetic-graph"), declared_outputs=["landmarks", ""],
                   successful_inferences=[0], inputs=[tensor], outputs=[])
    return dict(metadata_records=1, successful_inferences=1, networks={"123": network})


def metrics(*, sha, index):
    return dict(index=index, equal=True, changed_pixels=0, max_delta=0, bbox=None, sha256=sha, baseline_sha256=sha)


def point_metric():
    return dict(exact=True, within=True, max_abs=0, mean_l2=0, max_l2=0, worst_point_index=0, tolerance=0)


class FakeProcess:
    def __init__(self, *, code=0, text=b"synthetic stage completed\n"):
        reader, writer = os.pipe()
        os.write(writer, text)
        os.close(writer)
        self.stdout = os.fdopen(reader, "rb", buffering=0)
        self.pid, self.code = 987654321, code

    def poll(self):
        return self.code

    def wait(self, *, timeout):
        return self.code


class SyntheticCampaign:
    def __init__(self, *, root, count=1):
        root = root.resolve(strict=True)
        self.root, self.calls, self.fail_stage, self.mutation = root, [], None, None
        source = root / "research"
        scripts = source / "local-model-pytorch"
        sources = {*campaign.SCRIPTS.values(), "face_host_geometry_probe.py", "face_host_geometry_capture.mm",
                   "face_host_geometry_contract.py", "face_alignment_replay.py", "face_alignment_warp_native.py",
                   "face_geometry_native.py", "face_render_model_parity.py", "face_temporal_campaign.py"}
        for name in sources:
            write_bytes(path=scripts / name, data=f"synthetic source {name}\n".encode())
        write_bytes(path=source / "jianying-runtime-probe/host.mm", data=b"synthetic native source\n")
        self.source, self.scripts = source, scripts
        self.source_hashes = {"local-model-pytorch/face_host_geometry_sequence_probe.py": campaign.digest(data=(scripts / "face_host_geometry_sequence_probe.py").read_bytes())}
        base = root / "base"
        sha = write_bytes(path=base / "control/input.rgba", data=b"synthetic rgba")
        frames = []
        for index in range(4):
            frames.append(dict(sha256=write_bytes(path=base / f"control/original/frame-{index}.rgba", data=b"synthetic frame")))
        host = base / "control/clone-audit/host"
        host_sha = write_bytes(path=host, data=b"synthetic host, never executed\n")
        host.chmod(0o700)
        observer_sha = write_bytes(path=base / "observer.dylib", data=b"synthetic observer")
        write_json(path=base / "control/report.json", value=dict(passed=True, owned_result_rendered=True, native_analysis_bypassed=False,
                   width=1448, height=1086, source_sha256=self.source_hashes, input_rgba_sha256=sha, frames=frames))
        write_json(path=base / "report.json", value=dict(passed=True, failures=[], native_analysis_bypassed=False, source_sha256=self.source_hashes,
                   host_sha256=host_sha, observer_sha256=observer_sha, comparisons=[dict(equal=True)] * 4, captures=inventory(root=root)))
        models, artifacts, networks = root / "models", {}, {}
        for side in (120, 160):
            name = f"align-{side}/artifacts/model.onnx"
            artifacts[name] = write_bytes(path=models / name, data=f"synthetic onnx {side}".encode())
            networks[str(side)] = dict(graph_sha256=("a" if side == 120 else "b") * 64,
                terminal_names=["landmark", "visible", "prob", "yaw", "pitch"],
                cases={"recorded-face": dict(input_sha256={"data": "a" * 64})})
        write_json(path=models / "summary.json", value=dict(passed=True, native_oracle_sha256=campaign.parity.espresso_oracle.RUNTIME_SHA256,
            float_policies={name: list(value) for name, value in campaign.parity.FLOAT_LIMITS.items()}, artifacts=artifacts, networks=networks))
        runtime, self.pins = root / "runtime", {}
        for name in campaign.RUNTIME_HASHES:
            self.pins[name] = write_bytes(path=runtime / "Frameworks" / name, data=f"synthetic library {name}".encode())
        self.model_pin = write_bytes(path=runtime / "Models" / campaign.MODEL.name, data=b"synthetic native model")
        package = runtime / "package"
        write_bytes(path=package / "config.json", data=b'{"synthetic": true}')
        image = root / "images/face.png"
        image.parent.mkdir()
        Image.new("RGB", campaign.DIMENSIONS, (128, 90, 60)).save(image)
        self.manifests = []
        for index in range(count):
            path = root / f"manifest-{index}.json"
            write_json(path=path, value=dict(version=1, frames=[dict(image=str(image), timestamp=frame / 30, parameters={"eye": 1},
                         label=f"frame-{frame}", expect_change=frame not in (3, 5)) for frame in range(7)]))
            self.manifests.append(path)
        executables = []
        for name in ("warp", "ort"):
            path = root / name / "bin/python"
            write_bytes(path=path, data=f"synthetic {name} python, never executed\n".encode())
            path.chmod(0o700)
            write_bytes(path=path.parent.parent / "pyvenv.cfg", data=b"include-system-site-packages = false\n")
            executables.append(path)
        self.args = argparse.Namespace(base_capture=base, models_root=models, runtime=runtime, package=package, warp_python=executables[0],
            ort_python=executables[1], manifest=self.manifests, out=root / "out", stage_timeout=10, deadline=300,
            owned_initialization=False, independent_160_sampling=False)

    def patched(self):
        stack = ExitStack()
        for target, name, value in ((campaign, "SOURCE_ROOT", self.source), (campaign, "SCRIPT_ROOT", self.scripts),
                (campaign, "RUNTIME_HASHES", self.pins), (campaign, "MODEL_SHA256", self.model_pin),
                (campaign.sequence, "PRIVATE", self.root), (campaign.probe, "__file__", str(self.scripts / campaign.SCRIPTS["probe"]))):
            stack.enter_context(patch.object(target, name, value))
        stack.enter_context(patch.object(campaign.subprocess, "Popen", side_effect=self.spawn))
        stack.enter_context(patch.object(campaign.os, "killpg"))
        return stack

    def spawn(self, command, **kwargs):
        self.calls.append((command, kwargs))
        name = next(name for name, script in campaign.SCRIPTS.items() if Path(command[3]).name == script)
        output = Path(command[command.index("--out") + 1])
        output.mkdir(mode=0o700)
        value = self.stage_report(name=name, output=output, command=command)
        code = 0
        if self.fail_stage is not None:
            target, mode = self.fail_stage
            if name == target:
                if mode == "exit":
                    code = 7
                elif mode == "diagnostic":
                    value.update(passed=False, completed=True, diagnostic_only=True)
                elif mode == "missing":
                    return FakeProcess()
                elif mode == "partial":
                    value = dict(passed=True, failures=[])
                elif mode == "link":
                    value["capture_sha256"] = "f" * 64
                elif mode == "audit_link":
                    value["report_sha256"]["capture"] = "f" * 64
                elif mode == "policy":
                    value["owned_initialization_used"] = not self.args.owned_initialization
        write_json(path=output / "report.json", value=value)
        if self.mutation is not None and name == "probe":
            self.mutation()
        return FakeProcess(code=code)

    def stage_report(self, *, name, output, command):
        value = dict(passed=True, failures=[], native_analysis_bypassed=False, source_sha256=self.source_hashes)
        directory = output.parent
        if name == "probe":
            path = Path(command[command.index("--manifest") + 1])
            frames = campaign.sequence.validate_manifest(value=json.loads(path.read_text()), base=path.parent)
            for frame in frames:
                data = Path(frame["image"]).read_bytes()
                with Image.open(frame["image"]) as image:
                    frame.update(image_sha256=campaign.digest(data=data), input_rgba_sha256=campaign.digest(data=image.convert("RGBA").tobytes()))
            profile = campaign.audit.request_profile(frames=frames)
            requests = [dict(request_id=request, timestamp=stamp, passed=True, owned_face_conversions=0 if index == 0 else 2,
                             owned_face_restorations=0 if index == 0 else 2) for index, (request, stamp) in enumerate(profile)]
            protocol = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\t{request}\t0" for request, _ in profile)]
            snapshots = [geometry_row(index=index) for index in range(26)]
            for snapshot in snapshots:
                snapshot["faces"][0]["active"] = snapshot["index"] not in (18, 19)
            value.update(capture=str(self.args.base_capture), runtime=str(self.args.runtime), package=str(self.args.package), manifest=str(path),
                frames=frames, width=1448, height=1086, predictions=26, geometry_snapshots=snapshots,
                geometry_observer_only=True, observer_pixel_parity_verified=True, per_prediction_inference_association_verified=True,
                warmup_requests_per_host=6, seeks_per_request=2, captures=inventory(root=self.root), comparisons=[dict(equal=True)] * 7,
                runs=[dict(name=name, protocol_rows=protocol, reader_error=None, owned_face_conversions=24, owned_face_restorations=24,
                           records_sha256="a" * 64, requests=deepcopy(requests)) for name in ("baseline", "observed")])
            return value
        capture = json.loads((directory / "probe/report.json").read_text())
        cap_sha = campaign.digest(data=(directory / "probe/report.json").read_bytes())
        manifest_sha = campaign.digest(data=Path(capture["manifest"]).read_bytes())
        value.update(completed=True)
        if name in ("replay", "audit"):
            value.update(owned_initialization_used=self.args.owned_initialization,
                         independent_160_sampling_input_used=self.args.independent_160_sampling,
                         native_smoothing_seed_required=not self.args.owned_initialization,
                         native_160_sampling_input_required=not self.args.independent_160_sampling,
                         native_smoothing_seed_predictions=[] if self.args.owned_initialization else [0, 20],
                         owned_smoothing_seed_predictions=[0, 20] if self.args.owned_initialization else [])
        if name == "replay":
            times = [stamp for _, stamp in campaign.audit.request_profile(frames=capture["frames"]) for _ in range(2)][2:]
            payload, cases = [], []
            for index, snapshot in enumerate(capture["geometry_snapshots"]):
                active = snapshot["faces"][0]["active"]
                checks = {key: point_metric() for key in ("stage1", "tracked")} if active else {}
                if index >= 2:
                    faces = [dict(id=1, points=[[0.5, 0.5]] * 106)] if active else []
                    payload.append(dict(timestamp_us=round(times[index - 2] * 1_000_000), faces=faces))
                    if active:
                        checks["normalized"] = point_metric()
                cases.append(dict(prediction=index, active_faces=int(active), published_faces=int(active), idle=index == 19, checks=checks))
            sha = write_json(path=output / "replay.json", value=dict(version=1, coordinate_space=campaign.consumer.COORDINATE_SPACE,
                width=1448, height=1086, image_sha256=manifest_sha, frames=payload))
            value.update(geometry_exact=True, independent_120_sampling_input_used=True, owned_temporal_smoothing_used=True,
                         diagnostic_only=False, capture_sha256=cap_sha, replay_sha256=sha, manifest_frames=7, cases=cases)
            return value
        replay_value = json.loads((directory / "replay/report.json").read_text())
        if name == "render":
            value.update(external_replay_verified=True, pixel_parity_verified=True, diagnostic_only=False, capture_sha256=cap_sha,
                replay_sha256=replay_value["replay_sha256"], manifest_sha256=manifest_sha, frames=capture["frames"], capture=str(directory / "probe"),
                candidate=str(directory / "replay/replay.json"), comparisons=[metrics(sha="a" * 64, index=index) for index in range(7)])
            return value
        value.update(pipeline_parity=True, source_hashes_verified=True, predictions=26, conversions=24, manifest_frames=7,
            stages={key: dict(compared=7, exact=True, required_failed_indices=[]) for key in campaign.audit.STAGES},
            report_sha256={key: campaign.digest(data=(directory / stage / "report.json").read_bytes()) for key, stage in
                           (("capture", "probe"), ("sequence_replay", "replay"), ("sequence_render", "render"))})
        return value


class CampaignTests(unittest.TestCase):
    def test_four_explicit_profiles_run_whitelisted_local_chain(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = SyntheticCampaign(root=Path(directory), count=4)
            with fixture.patched(), patch.dict(os.environ, {"QCUT_BAD": "1", "PYTHONPATH": "/wrong", "LD_PRELOAD": "/wrong"}):
                report = campaign.run(args=fixture.args)
            self.assertTrue(report["passed"], report["failures"])
            self.assertTrue(report["pipeline_parity"])
            self.assertFalse(report["product_parity_verified"])
            self.assertEqual(len(fixture.calls), 16)
            self.assertEqual(len(report["campaigns"]), 4)
            for index, (command, options) in enumerate(fixture.calls):
                stage = list(campaign.SCRIPTS)[index % 4]
                self.assertEqual(Path(command[3]).name, campaign.SCRIPTS[stage])
                self.assertEqual(command[0], str(fixture.args.warp_python if stage in ("probe", "render") else fixture.args.ort_python))
                self.assertIs(options["shell"], False)
                self.assertTrue(options["start_new_session"])
                self.assertNotIn("QCUT_BAD", options["env"])
                self.assertNotIn("PYTHONPATH", options["env"])
                self.assertNotIn("LD_PRELOAD", options["env"])
                self.assertNotIn("--diagnostic", command)
                if stage == "replay":
                    self.assertIn("--owned-smoothing", command)
                    self.assertNotIn("--owned-initialization", command)
                    self.assertNotIn("--independent-160-sampling", command)
                if stage == "audit":
                    self.assertIn("--current-source-root", command)
            self.assertTrue(all(stage["status"] == "passed" for entry in report["campaigns"] for stage in entry["stages"]))

    def test_optional_initialization_is_explicit_typed_and_forwarded(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = SyntheticCampaign(root=Path(directory))
            fixture.args.owned_initialization = True
            with fixture.patched():
                report = campaign.run(args=fixture.args)
            self.assertTrue(report["passed"], report["failures"])
            self.assertTrue(report["owned_initialization_requested"])
            self.assertIn("--owned-initialization", fixture.calls[1][0])
        with tempfile.TemporaryDirectory() as directory:
            fixture = SyntheticCampaign(root=Path(directory))
            fixture.args.owned_initialization = 1
            with fixture.patched():
                self.assertFalse(campaign.run(args=fixture.args)["passed"])
            self.assertEqual(fixture.calls, [])

    def test_virtual_environment_entry_paths_are_not_resolved_to_system_python(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = SyntheticCampaign(root=Path(directory))
            target = fixture.root / "system/python"
            write_bytes(path=target, data=b"synthetic shared interpreter")
            target.chmod(0o700)
            for path in (fixture.args.warp_python, fixture.args.ort_python):
                path.unlink()
                path.symlink_to(target)
            with fixture.patched():
                report = campaign.run(args=fixture.args)
            self.assertTrue(report["passed"], report["failures"])
            self.assertEqual(fixture.calls[0][0][0], str(fixture.args.warp_python))
            self.assertEqual(fixture.calls[1][0][0], str(fixture.args.ort_python))
            self.assertNotEqual(fixture.calls[1][0][0], str(target))

    def test_requested_initialization_cannot_silently_use_another_route(self):
        for owned in (False, True):
            for stage in ("replay", "audit"):
                with self.subTest(owned=owned, stage=stage), tempfile.TemporaryDirectory() as directory:
                    fixture = SyntheticCampaign(root=Path(directory))
                    fixture.args.owned_initialization = owned
                    fixture.fail_stage = stage, "policy"
                    with fixture.patched():
                        report = campaign.run(args=fixture.args)
                    self.assertFalse(report["passed"])
                    self.assertIn("requested policy", report["failures"][0])
                    self.assertEqual(len(fixture.calls), list(campaign.SCRIPTS).index(stage) + 1)

    def test_owned_policy_requires_typed_seed_provenance_and_native_dependencies(self):
        value = dict(owned_initialization_used=True, independent_160_sampling_input_used=False,
                     native_smoothing_seed_required=False, native_smoothing_seed_predictions=[],
                     owned_smoothing_seed_predictions=[0])
        campaign.validate_policy(value=value, owned_initialization=True, independent_160_sampling=False)
        for key, replacement in (("owned_initialization_used", 1), ("native_smoothing_seed_required", True),
                ("native_smoothing_seed_predictions", [0]), ("owned_smoothing_seed_predictions", []),
                ("owned_smoothing_seed_predictions", [False]), ("owned_smoothing_seed_predictions", [0, 0]),
                ("owned_smoothing_seed_predictions", [20, 0]), ("owned_smoothing_seed_predictions", [26]),
                ("independent_160_sampling_input_used", True)):
            with self.subTest(key=key, value=replacement), self.assertRaises(ValueError):
                campaign.validate_policy(value=dict(value, **{key: replacement}), owned_initialization=True, independent_160_sampling=False)
        with self.assertRaisesRegex(ValueError, "native 160"):
            campaign.validate_policy(value=dict(value, independent_160_sampling_input_used=True, native_160_sampling_input_required=True),
                                     owned_initialization=True, independent_160_sampling=True)

    def test_empty_markers_are_guarded_and_script_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = SyntheticCampaign(root=Path(directory))
            write_bytes(path=fixture.scripts / "__init__.py", data=b"")
            write_bytes(path=fixture.args.package / ".marker", data=b"")
            with fixture.patched():
                report = campaign.run(args=fixture.args)
            self.assertTrue(report["passed"], report["failures"])
        with tempfile.TemporaryDirectory() as directory:
            fixture = SyntheticCampaign(root=Path(directory))
            script = fixture.scripts / campaign.SCRIPTS["render"]
            script.unlink()
            script.symlink_to(fixture.scripts / campaign.SCRIPTS["probe"])
            with fixture.patched():
                self.assertFalse(campaign.run(args=fixture.args)["passed"])
            self.assertEqual(fixture.calls, [])

    def test_independent_160_sampling_is_typed_dependent_and_forwarded(self):
        for value, initialization, success in ((True, True, True), (True, False, False), (1, True, False)):
            with self.subTest(value=value, initialization=initialization), tempfile.TemporaryDirectory() as directory:
                fixture = SyntheticCampaign(root=Path(directory))
                fixture.args.independent_160_sampling, fixture.args.owned_initialization = value, initialization
                with fixture.patched():
                    report = campaign.run(args=fixture.args)
                self.assertEqual(report["passed"], success, report["failures"])
                if success:
                    self.assertTrue(report["independent_160_sampling_requested"])
                    self.assertIn("--independent-160-sampling", fixture.calls[1][0])
                    self.assertIn("--owned-initialization", fixture.calls[1][0])
                else:
                    self.assertEqual(fixture.calls, [])

    def test_wrong_profile_counts_duplicates_and_dimensions_fail_before_subprocess(self):
        for target in ("zero", "five", "duplicate", "six_frames", "24_frames", "dimensions"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                fixture = SyntheticCampaign(root=Path(directory))
                if target == "zero":
                    fixture.args.manifest = []
                elif target == "five":
                    fixture.args.manifest *= 5
                elif target == "duplicate":
                    fixture.args.manifest *= 2
                elif target in ("six_frames", "24_frames"):
                    value = json.loads(fixture.manifests[0].read_text())
                    value["frames"] = (value["frames"] * 4)[:6 if target == "six_frames" else 24]
                    write_json(path=fixture.manifests[0], value=value)
                else:
                    Image.new("RGB", (8, 8)).save(fixture.root / "images/face.png")
                with fixture.patched():
                    self.assertFalse(campaign.run(args=fixture.args)["passed"])
                self.assertEqual(fixture.calls, [])

    def test_every_failed_or_partial_stage_stops_and_skips_remaining_campaigns(self):
        for stage in campaign.SCRIPTS:
            for mode in ("exit", "diagnostic", "missing", "partial"):
                with self.subTest(stage=stage, mode=mode), tempfile.TemporaryDirectory() as directory:
                    fixture = SyntheticCampaign(root=Path(directory), count=2)
                    fixture.fail_stage = (stage, mode)
                    with fixture.patched():
                        report = campaign.run(args=fixture.args)
                    self.assertFalse(report["passed"])
                    self.assertFalse(report["completed"])
                    self.assertEqual(len(fixture.calls), list(campaign.SCRIPTS).index(stage) + 1)
                    self.assertEqual(report["campaigns"][0]["stages"][list(campaign.SCRIPTS).index(stage)]["status"], "failed")
                    self.assertTrue(all(row["status"] == "skipped" for row in report["campaigns"][1]["stages"]))

    def test_producer_render_and_audit_cross_run_links_are_rejected(self):
        for stage, mode in (("replay", "link"), ("render", "link"), ("audit", "audit_link")):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as directory:
                fixture = SyntheticCampaign(root=Path(directory))
                fixture.fail_stage = stage, mode
                with fixture.patched():
                    report = campaign.run(args=fixture.args)
                self.assertFalse(report["pipeline_parity"])
                self.assertEqual(len(fixture.calls), list(campaign.SCRIPTS).index(stage) + 1)

    def test_source_runtime_model_package_manifest_mutations_fail_closed(self):
        for target in ("source", "added_source", "runtime", "native_model", "package", "manifest", "onnx", "prior_report"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                fixture = SyntheticCampaign(root=Path(directory))
                paths = {"source": fixture.scripts / "face_host_geometry_capture.mm", "added_source": fixture.scripts / "new.py",
                         "runtime": fixture.args.runtime / "Frameworks/liblens.dylib", "native_model": fixture.args.runtime / "Models" / campaign.MODEL.name,
                         "package": fixture.args.package / "config.json", "manifest": fixture.manifests[0],
                         "onnx": fixture.args.models_root / "align-120/artifacts/model.onnx", "prior_report": fixture.args.base_capture / "report.json"}
                fixture.mutation = lambda: paths[target].write_bytes(b"changed fixture")
                with fixture.patched():
                    report = campaign.run(args=fixture.args)
                self.assertFalse(report["passed"])
                self.assertEqual(len(fixture.calls), 1)

    def test_failed_baseline_and_stale_source_are_rejected(self):
        for target in ("baseline", "source", "model", "runtime"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                fixture = SyntheticCampaign(root=Path(directory))
                if target == "baseline":
                    value = json.loads((fixture.args.base_capture / "report.json").read_text())
                    value["passed"] = False
                    write_json(path=fixture.args.base_capture / "report.json", value=value)
                elif target == "source":
                    (fixture.scripts / campaign.SCRIPTS["probe"]).write_bytes(b"stale source")
                elif target == "model":
                    (fixture.args.models_root / "align-120/artifacts/model.onnx").write_bytes(b"bad onnx")
                else:
                    (fixture.args.runtime / "Frameworks/liblens.dylib").write_bytes(b"bad library")
                with fixture.patched():
                    self.assertFalse(campaign.run(args=fixture.args)["passed"])
                self.assertEqual(fixture.calls, [])

    def test_fresh_private_output_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = SyntheticCampaign(root=Path(directory))
            fixture.args.out.mkdir()
            with fixture.patched(), self.assertRaises(FileExistsError):
                campaign.run(args=fixture.args)
            fixture.args.out = fixture.root.parent / "not-private-campaign"
            with fixture.patched(), self.assertRaisesRegex(ValueError, "beneath"):
                campaign.run(args=fixture.args)
            self.assertEqual(fixture.calls, [])

    def test_deadline_and_timeout_arguments_are_bounded_typed(self):
        for key, value in (("deadline", True), ("deadline", 0), ("deadline", 14401), ("stage_timeout", 1.0), ("stage_timeout", 3601)):
            with self.subTest(key=key, value=value), tempfile.TemporaryDirectory() as directory:
                fixture = SyntheticCampaign(root=Path(directory))
                setattr(fixture.args, key, value)
                with fixture.patched():
                    self.assertFalse(campaign.run(args=fixture.args)["passed"])
                self.assertEqual(fixture.calls, [])

    def test_expired_global_deadline_never_starts_host(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = SyntheticCampaign(root=Path(directory))
            fixture.args.deadline = 1
            with fixture.patched(), patch.object(campaign.time, "monotonic", side_effect=[0, 2, 2, 2, 2, 2]):
                report = campaign.run(args=fixture.args)
            self.assertFalse(report["passed"])
            self.assertEqual(report["campaigns"][0]["stages"][0]["status"], "timeout")
            self.assertEqual(fixture.calls, [])


class SubprocessBoundsTests(unittest.TestCase):
    def test_log_overflow_stops_entire_process_group(self):
        with tempfile.TemporaryDirectory() as directory:
            process = FakeProcess()
            with patch.object(campaign.subprocess, "Popen", return_value=process), patch.object(campaign, "LOG_LIMIT", 8), \
                    patch.object(campaign.os, "killpg") as kill, self.assertRaisesRegex(ValueError, "log exceeds"):
                campaign.execute(command=["never-executed"], log=Path(directory) / "stage.log", deadline=campaign.time.monotonic() + 10, timeout=10)
            self.assertEqual([call.args[1] for call in kill.call_args_list], [signal.SIGTERM, signal.SIGKILL])
            self.assertTrue(process.stdout.closed)

    def test_timeout_kills_descendants_even_when_parent_already_exited(self):
        with tempfile.TemporaryDirectory() as directory:
            process = FakeProcess(code=0)
            with patch.object(campaign.subprocess, "Popen", return_value=process), patch.object(campaign.os, "killpg") as kill, \
                    patch.object(campaign.time, "monotonic", side_effect=[0, 0, 2]), self.assertRaises(TimeoutError):
                campaign.execute(command=["never-executed"], log=Path(directory) / "stage.log", deadline=100, timeout=1)
            self.assertEqual([call.args[1] for call in kill.call_args_list], [signal.SIGTERM, signal.SIGKILL])

    def test_exit_timeout_is_not_reported_as_success(self):
        with tempfile.TemporaryDirectory() as directory:
            process = FakeProcess()
            with patch.object(campaign.subprocess, "Popen", return_value=process), patch.object(campaign.os, "killpg"), \
                    patch.object(process, "wait", side_effect=[subprocess.TimeoutExpired("stage", 1), 0, 0]), self.assertRaises(TimeoutError):
                campaign.execute(command=["never-executed"], log=Path(directory) / "stage.log", deadline=campaign.time.monotonic() + 10, timeout=10)

    def test_cli_failure_exits_nonzero(self):
        argv = ["campaign", "--base-capture", "base", "--models-root", "models", "--runtime", "runtime", "--package", "package",
                "--warp-python", "warp", "--ort-python", "ort", "--manifest", "manifest", "--out", "out"]
        with patch("sys.argv", argv), patch.object(campaign, "run", return_value=dict(passed=False, completed=False, pipeline_parity=False, failures=["failed"])), \
                patch("builtins.print"):
            self.assertEqual(campaign.main(), 1)


if __name__ == "__main__":
    unittest.main()
