"""Synthetic files and mocked preparation/probes only; never loads native assets."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import beauty_dual_isolated_matrix as matrix
import beauty_dual_matrix_report as viewer


class IsolatedMatrixTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        for name in ("runtime", "models", "package", "dynamic", "extra", "source"):
            directory = self.root / name
            directory.mkdir()
            (directory / "fixture.txt").write_text(name)
        self.image = self.root / "portrait.png"
        self.image.write_bytes(b"synthetic portrait, never decoded")
        self.case = dict(id="face-small-p80", label="Small face +80", category="face-shape",
            runtimePackage="small-face", key="face_adjust_YouTaiFace", value=80, available=True,
            expectedChange=True, package=str(self.root / "package"), dependencies=[str(self.root / "package")],
            parameters={"face_adjust_YouTaiFace": [{"id": -1, "intensity": 0.8}]},
            adjustments={"enabled": True, "values": {"face_adjust_YouTaiFace": 80}})
        self.catalog = self.root / "catalog.json"
        self.portraits = self.root / "portraits.json"
        self.write_inputs()
        self.probe = self.enter_patch(target="beauty_dual_isolated_matrix.run_probe", side_effect=self.fake_probe)
        self.prepare = self.enter_patch(target="beauty_dual_isolated_matrix.bundle.prepare_inputs", side_effect=self.fake_prepare)
        self.enter_patch(target="beauty_dual_isolated_matrix.bundle.lock_dependencies", side_effect=self.fake_dependencies)
        self.enter_patch(target="beauty_dual_isolated_matrix.fresh_output", side_effect=self.fresh_output)
        self.enter_patch(target="builtins.print")
        self.enter_patch(target="subprocess.Popen", side_effect=AssertionError("native/process launch forbidden in tests"))

    def enter_patch(self, *, target, **kwargs):
        patcher = patch(target, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def write_inputs(self, *, cases=None, portraits=None):
        self.catalog.write_text(json.dumps({"cases": cases if cases is not None else [self.case]}))
        self.portraits.write_text(json.dumps(portraits if portraits is not None else
                                           [dict(id="front", image=str(self.image))]))

    def args(self, **overrides):
        values = dict(catalog=self.catalog, portraits=self.portraits, runtime=self.root / "runtime",
            models=self.root / "models", out=self.root / "out", route="face", case=[self.case["id"]],
            category=None, execute_native=False, lease=None, extra_root=None, max_jobs=24, timeout=120)
        values.update(overrides)
        return argparse.Namespace(**values)

    def makeup(self, *, case_id="makeup-lip-p80"):
        return dict(self.case, id=case_id, category="makeup", runtimePackage="makeup", cardId="lip",
            makeupCategory="lip", key="face_adjust_lip", dependencies=[str(self.root / "package"), str(self.root / "dynamic")],
            parameters={"face_adjust_lip": [{"id": -1, "intensity": 0.8, "path": str(self.root / "dynamic")}]},
            adjustments={"enabled": True, "values": {}, "makeup": {"lip": {"cardId": "lip", "intensity": 80}}})

    def fresh_output(self, *, path):
        path.mkdir(mode=0o700)
        return path

    def fake_dependencies(self, *, runtime, package, models, guard):
        for path in (runtime, package, models, self.root / "source"):
            guard.tree(directory=path)

    def fake_prepare(self, *, manifest, out, guard, single_frame):
        self.assertTrue(single_frame)
        frames = matrix.strict_json(data=guard.locked.read(path=manifest))["frames"]
        self.assertEqual(len(frames), 1)
        for frame in frames:
            guard.locked.read(path=Path(frame["image"]))
            rgba = out / "input-00.rgba"
            rgba.write_bytes(bytes([0, 1, 2, 255]))
            data = guard.locked.read(path=rgba)
            frame.update(input=str(rgba), input_sha256=hashlib.sha256(data).hexdigest())
        return frames, (1, 1)

    def report(self, *, passed=True, safe=True):
        return dict(schema="face-live-bridge-probe-v1", passed=passed, completed=passed,
            native_execution_performed=True, live_checks_completed=passed,
            failures=[] if passed else [dict(phase="live-audit", error="synthetic pixel mismatch")],
            cleanup=dict(completed=safe, failures=[] if safe else ["synthetic unreaped child"]),
            dependencies_unchanged=True)

    def persist_report(self, *, args, report):
        args.out.mkdir()
        matrix.bundle.write_json(path=args.out / "report.json", value=report)
        return report

    def fake_probe(self, *, args):
        return self.persist_report(args=args, report=self.report())

    def execute(self, **overrides):
        return matrix.run_matrix(args=self.args(execute_native=True, lease="parent-test-lease", **overrides))

    def select(self, *, cases=None, route="face", selected=None, categories=None):
        return matrix.select_cases(catalog={"cases": cases if cases is not None else [self.case]},
            cases=selected if selected is not None else [self.case["id"]], categories=categories, route=route)

    def test_debugger_selection_forwarded_per_case_without_altering_gates(self):
        args = self.args(lldb_executable=self.root / "alternate lldb", debugserver=self.root / "debugserver",
                         rotate_makeup_points=True)
        selected = matrix.probe_arguments(args=args, case=self.case, directory=self.root / "case")
        self.assertEqual(selected.lldb_executable, args.lldb_executable)
        self.assertEqual(selected.debugserver, args.debugserver)
        self.assertTrue(selected.rotate_makeup_points)
        self.assertTrue(selected.cold_frame)
        self.assertTrue(selected.single_frame)
        defaults = matrix.probe_arguments(args=self.args(), case=self.case, directory=self.root / "case")
        self.assertIsNone(defaults.lldb_executable)
        self.assertIsNone(defaults.debugserver)
        self.assertFalse(defaults.rotate_makeup_points)

    def test_dry_prepares_inputs_but_never_calls_probe_or_claims_parity(self):
        result = matrix.run_matrix(args=self.args())
        self.probe.assert_not_called()
        self.assertEqual(self.prepare.call_count, 1)
        self.assertTrue(result["prepared"])
        self.assertTrue(result["completed"])
        self.assertFalse(result["passed"])
        self.assertFalse(result["product_backend_acceptance"])
        self.assertFalse(result["temporal_acceptance"])
        self.assertFalse(result["native_independence_verified"])
        row = result["cases"][0]
        self.assertEqual(row["status"], "prepared")
        self.assertEqual(row["input_catalog"], self.case)
        self.assertEqual(row["parameters"], self.case["parameters"])
        self.assertEqual(row["source_image_sha256"], hashlib.sha256(self.image.read_bytes()).hexdigest())
        self.assertEqual(row["catalog_sha256"], hashlib.sha256(self.catalog.read_bytes()).hexdigest())
        self.assertIn("hash_provenance", row)
        self.assertTrue(row["cleanup"]["completed"])
        self.assertIn("audit_path", row)
        self.assertNotIn("audit", row)

    def test_execute_uses_fresh_job_for_each_portrait_and_card(self):
        second = dict(self.case, id="face-jaw-p80")
        self.write_inputs(cases=[self.case, second], portraits=[dict(id=name, image=str(self.image)) for name in ("front", "side")])
        result = self.execute(case=[self.case["id"], second["id"]])
        self.assertTrue(result["passed"])
        self.assertEqual(self.probe.call_count, 4)
        calls = [call.kwargs["args"] for call in self.probe.call_args_list]
        self.assertEqual(len({id(args) for args in calls}), 4)
        self.assertEqual(len({args.out for args in calls}), 4)
        self.assertEqual(len({args.manifest for args in calls}), 4)
        self.assertEqual(len({str(row["preparation"]["frames"][0]["input"]) for row in result["cases"]}), 4)
        for args in calls:
            manifest = json.loads(args.manifest.read_text())
            self.assertEqual(len(manifest["frames"]), 1)
            self.assertEqual(manifest["frames"][0]["timestamp"], 0)
            self.assertTrue(args.single_frame)
            self.assertTrue(args.cold_frame)
            self.assertFalse(args.static_controls)
        self.assertEqual(result["retries"], 0)
        self.assertFalse(result["native_pixel_fallback"])

    def test_face_flags_match_r24_without_any_makeup_flag(self):
        self.execute()
        args = self.probe.call_args.kwargs["args"]
        for name in ("stable_host", "single_frame", "cold_frame", "trace_face_readers", "trace_stages", "execute_native"):
            self.assertIs(getattr(args, name), True)
        for name in matrix.MAKEUP_FLAGS:
            self.assertIs(getattr(args, name), False)
        self.assertIsNone(args.extra_root)
        self.assertFalse(args.trace_extra_model)

    def test_makeup_flags_match_r20_r22_and_bind_extra_explicitly(self):
        case = self.makeup()
        self.write_inputs(cases=[case])
        result = self.execute(case=[case["id"]], route="makeup", extra_root=self.root / "extra")
        self.assertTrue(result["passed"])
        args = self.probe.call_args.kwargs["args"]
        for name in (*matrix.MAKEUP_FLAGS, "single_frame", "cold_frame", "stable_host", "trace_stages"):
            self.assertIs(getattr(args, name), True)
        self.assertFalse(args.trace_face_readers)
        self.assertFalse(args.trace_extra_model)
        self.assertEqual(args.extra_root, self.root / "extra")
        self.assertEqual(args.additional_packages, [self.root / "dynamic"])

    def test_makeup_route_allows_explicit_face_consumer_investigation(self):
        result = self.execute(route="makeup", extra_root=self.root / "extra")
        self.assertEqual(result["cases"][0]["category"], "face-shape")
        self.assertEqual(result["cases"][0]["route"], "makeup")
        self.assertTrue(self.probe.call_args.kwargs["args"].consume_makeup_candidate)

    def test_makeup_does_not_implicitly_enable_extra_model(self):
        self.execute(route="makeup")
        self.assertIsNone(self.probe.call_args.kwargs["args"].extra_root)

    def test_label_never_selects_makeup_routing(self):
        self.case["label"] = "Makeup lipstick look +80"
        self.write_inputs()
        self.execute()
        self.assertFalse(self.probe.call_args.kwargs["args"].consume_makeup_candidate)

    def test_makeup_card_cannot_use_face_only_route(self):
        case = self.makeup()
        with self.assertRaisesRegex(ValueError, "explicit --route makeup"):
            self.select(cases=[case], selected=[case["id"]])

    def test_missing_or_invalid_route_is_rejected(self):
        for route in (None, "auto", "MAKEUP", ""):
            with self.subTest(route=route), self.assertRaisesRegex(ValueError, "route"):
                matrix.run_matrix(args=self.args(route=route))
        self.probe.assert_not_called()

    def test_extra_root_refuses_face_route(self):
        with self.assertRaisesRegex(ValueError, "extra-root"):
            matrix.run_matrix(args=self.args(extra_root=self.root / "extra"))

    def test_explicit_execute_requires_nonempty_bounded_lease(self):
        for lease in (None, "", " ", "bad\nlease", " leading", "x" * 161, 1):
            with self.subTest(lease=lease), self.assertRaisesRegex(ValueError, "lease"):
                matrix.run_matrix(args=self.args(execute_native=True, lease=lease))
        self.probe.assert_not_called()

    def test_lease_alone_never_executes(self):
        result = matrix.run_matrix(args=self.args(lease="parent-lease"))
        self.probe.assert_not_called()
        self.assertIsNone(result["lease"])

    def test_normal_failed_case_does_not_drop_following_cases(self):
        second = dict(self.case, id="second")
        self.write_inputs(cases=[self.case, second])

        def probe(*, args):
            failed = self.probe.call_count == 1
            return self.persist_report(args=args, report=self.report(passed=not failed))

        self.probe.side_effect = probe
        result = self.execute(case=[self.case["id"], second["id"]])
        self.assertEqual([row["status"] for row in result["cases"]], ["failed", "passed"])
        self.assertTrue(result["completed"])
        self.assertFalse(result["passed"])
        self.assertFalse(result["aborted"])
        self.assertEqual(self.probe.call_count, 2)
        self.assertIn("synthetic pixel mismatch", result["cases"][0]["error"])
        self.assertIn("audit_sha256", result["cases"][0])

    def two_case_run(self, *, report=None, exception=None):
        second = dict(self.case, id="second")
        self.write_inputs(cases=[self.case, second])

        def probe(*, args):
            if report is not None:
                self.persist_report(args=args, report=report)
            if exception is not None:
                raise exception
            return report

        self.probe.side_effect = probe
        return self.execute(case=[self.case["id"], second["id"]])

    def test_unsafe_cleanup_stops_remaining_launches(self):
        result = self.two_case_run(report=self.report(safe=False))
        self.assertTrue(result["aborted"])
        self.assertFalse(result["completed"])
        self.assertEqual(self.probe.call_count, 1)
        self.assertEqual(result["cases"][1]["status"], "blocked")
        self.assertFalse(result["cases"][0]["cleanup"]["completed"])

    def test_changed_dependency_receipt_stops_remaining_launches(self):
        report = self.report()
        report["dependencies_unchanged"] = False
        result = self.two_case_run(report=report)
        self.assertTrue(result["aborted"])
        self.assertFalse(result["passed"])
        self.assertEqual(self.probe.call_count, 1)

    def test_exception_without_cleanup_receipt_stops_and_checkpoints(self):
        result = self.two_case_run(exception=RuntimeError("unexpected probe crash"))
        self.assertTrue(result["aborted"])
        self.assertEqual(self.probe.call_count, 1)
        self.assertFalse(result["cases"][0]["cleanup"]["completed"])
        self.assertTrue(result["cases"][0]["native_launch_attempted"])
        self.assertIsNone(result["cases"][0]["native_execution_performed"])
        self.assertIn("unexpected probe crash", result["cases"][0]["error"])
        self.assertTrue((self.root / "out/progress-001.json").is_file())
        self.assertTrue((self.root / "out/matrix.json").is_file())

    def test_exception_with_durable_safe_receipt_continues_without_retry(self):
        result = self.two_case_run(report=self.report(passed=False), exception=RuntimeError("return failed"))
        self.assertFalse(result["aborted"])
        self.assertEqual(self.probe.call_count, 2)
        self.assertIn("return failed", result["cases"][0]["error"])

    def test_missing_cleanup_or_invalid_receipt_is_fail_closed(self):
        variants = [[], {"schema": "wrong"}, dict(self.report(), cleanup=None),
                    dict(self.report(), cleanup={"completed": True}), dict(self.report(), failures="bad")]
        for index, report in enumerate(variants):
            with self.subTest(index=index):
                self.probe.side_effect = lambda *, args: self.persist_report(args=args, report=report)
                result = self.execute(out=self.root / f"out-{index}")
                self.assertTrue(result["aborted"])
                self.assertFalse(result["passed"])

    def test_returned_report_must_match_durable_receipt(self):
        def probe(*, args):
            self.persist_report(args=args, report=self.report(passed=False))
            return self.report()

        self.probe.side_effect = probe
        result = self.execute()
        self.assertTrue(result["aborted"])
        self.assertIn("disagree", result["cases"][0]["error"])

    def test_incomplete_probe_cannot_be_false_green(self):
        for index, key in enumerate(("passed", "completed", "live_checks_completed", "native_execution_performed")):
            with self.subTest(key=key):
                report = self.report()
                report[key] = False
                self.probe.side_effect = lambda *, args: self.persist_report(args=args, report=report)
                result = self.execute(out=self.root / f"out-{index}")
                self.assertFalse(result["passed"])
                self.assertEqual(result["cases"][0]["status"], "failed")

    def test_source_change_aborts_even_if_probe_claims_dependencies_unchanged(self):
        second = dict(self.case, id="second")
        self.write_inputs(cases=[self.case, second])

        def probe(*, args):
            (self.root / "source/fixture.txt").write_text("mutated source")
            return self.fake_probe(args=args)

        self.probe.side_effect = probe
        result = self.execute(case=[self.case["id"], second["id"]])
        self.assertTrue(result["aborted"])
        self.assertFalse(result["cases"][0]["dependencies_unchanged"])
        self.assertEqual(self.probe.call_count, 1)

    def test_portrait_or_catalog_mutation_aborts(self):
        for index, path in enumerate((self.image, self.catalog, self.portraits)):
            with self.subTest(path=path):
                self.write_inputs()
                self.image.write_bytes(b"synthetic portrait, never decoded")

                def probe(*, args):
                    path.write_bytes(b"changed")
                    return self.fake_probe(args=args)

                self.probe.side_effect = probe
                result = self.execute(out=self.root / f"out-{index}")
                self.assertTrue(result["aborted"])
                self.assertFalse(result["passed"])

    def test_preparation_change_never_launches_native(self):
        def prepare(**kwargs):
            prepared = self.fake_prepare(**kwargs)
            (self.root / "models/fixture.txt").write_text("changed model")
            return prepared

        self.prepare.side_effect = prepare
        result = self.execute()
        self.probe.assert_not_called()
        self.assertTrue(result["aborted"])

    def test_keyboard_interrupt_stops_remaining_cases_and_preserves_receipt(self):
        result = self.two_case_run(exception=KeyboardInterrupt())
        self.assertTrue(result["aborted"])
        self.assertEqual(result["cases"][0]["status"], "interrupted")
        self.assertEqual(self.probe.call_count, 1)

    def test_missing_image_does_not_drop_independent_portrait(self):
        self.write_inputs(portraits=[dict(id="missing", image=str(self.root / "missing.png")),
                                    dict(id="valid", image=str(self.image))])
        result = self.execute()
        self.assertEqual([row["status"] for row in result["cases"]], ["failed", "passed"])
        self.assertEqual(self.probe.call_count, 1)
        self.assertFalse(result["aborted"])

    def test_unavailable_or_missing_package_keeps_independent_case(self):
        for index, missing in enumerate((dict(self.case, available=False),
                dict(self.case, package=str(self.root / "missing"), dependencies=[str(self.root / "missing")]))):
            with self.subTest(index=index):
                valid = dict(self.case, id="valid")
                self.write_inputs(cases=[missing, valid])
                result = self.execute(case=[missing["id"], valid["id"]], out=self.root / f"out-{index}")
                self.assertEqual([row["status"] for row in result["cases"]], ["failed", "passed"])
                self.assertIn("audit_path", result["cases"][0])
                self.assertFalse(result["aborted"])

    def test_missing_additional_makeup_package_has_no_native_fallback(self):
        case = self.makeup()
        (self.root / "dynamic/fixture.txt").unlink()
        (self.root / "dynamic").rmdir()
        self.write_inputs(cases=[case])
        result = self.execute(route="makeup", case=[case["id"]])
        self.probe.assert_not_called()
        self.assertFalse(result["passed"])
        self.assertIn("missing asset directory", result["cases"][0]["error"])

    def test_probe_mutation_cannot_leak_to_later_job_arguments_or_input_catalog(self):
        self.write_inputs(portraits=[dict(id=name, image=str(self.image)) for name in ("one", "two")])

        def probe(*, args):
            self.assertEqual(args.additional_packages, [])
            report = self.fake_probe(args=args)
            args.additional_packages.append(Path("/injected"))
            args.package = Path("/changed")
            return report

        self.probe.side_effect = probe
        result = self.execute()
        self.assertTrue(result["passed"])
        for row in result["cases"]:
            self.assertEqual(row["input_catalog"], self.case)
            self.assertEqual(row["probe_args"]["additional_packages"], [])

    def test_plan_and_checkpoints_are_immutable_and_output_is_never_reused(self):
        self.write_inputs(portraits=[dict(id=name, image=str(self.image)) for name in ("one", "two")])
        self.execute()
        out = self.root / "out"
        plan = json.loads((out / "plan.json").read_text())
        first = json.loads((out / "progress-001.json").read_text())
        last = json.loads((out / "progress-002.json").read_text())
        self.assertEqual([row["status"] for row in plan["cases"]], ["pending", "pending"])
        self.assertEqual([row["status"] for row in first["cases"]], ["passed", "pending"])
        self.assertEqual([row["status"] for row in last["cases"]], ["passed", "passed"])
        before = {path.name: path.read_bytes() for path in out.glob("*.json")}
        with self.assertRaises(FileExistsError):
            self.execute()
        self.assertEqual(before, {path.name: path.read_bytes() for path in out.glob("*.json")})

    def test_dry_output_cannot_be_overwritten_by_execute(self):
        matrix.run_matrix(args=self.args())
        with self.assertRaises(FileExistsError):
            self.execute()
        self.probe.assert_not_called()

    def test_reporter_accepts_dry_and_runner_failure_rows_without_audits(self):
        result = matrix.run_matrix(args=self.args())
        report = viewer.generate(matrix=self.root / "out/matrix.json", out=self.root / "view")
        self.assertEqual(report["counts"], {"RUNNER_FAILED": 1})
        self.assertEqual(report["cases"][0]["input"]["parameters"], result["cases"][0]["parameters"])

    def test_reporter_accepts_native_rows_and_preserves_failure_evidence(self):
        self.execute()
        report = viewer.generate(matrix=self.root / "out/matrix.json", out=self.root / "view")
        self.assertEqual(len(report["cases"]), 1)
        self.assertEqual(report["cases"][0]["audit_status"], "PASSED")
        self.assertEqual(report["cases"][0]["status"], "INVALID")  # Mock contains no pixel dimensions.

    def test_selection_requires_explicit_nonempty_match_and_no_silent_drops(self):
        second = dict(self.case, id="second", category="eyes")
        for selectors in (dict(cases=[], categories=[]), dict(cases=["missing"], categories=[]),
                dict(cases=[], categories=["not-a-category"]),
                dict(cases=[self.case["id"]], categories=["eyes"]),
                dict(cases=[self.case["id"], second["id"]], categories=["eyes"]),
                dict(cases=[self.case["id"]], categories=["eyes", "face-shape"]),
                dict(cases=[self.case["id"], self.case["id"]], categories=[]),
                dict(cases=[], categories=["face-shape", "face-shape"])):
            with self.subTest(selectors=selectors), self.assertRaises(ValueError):
                matrix.select_cases(catalog=[self.case, second], route="face", **selectors)

    def test_duplicate_catalog_ids_are_rejected_even_if_unselected(self):
        duplicate = dict(self.case, id="unselected")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.select(cases=[self.case, duplicate, duplicate])

    def test_list_and_wrapped_catalogs_preserve_order_and_are_detached(self):
        second = dict(self.case, id="second")
        for catalog in ([self.case, second], {"cases": [self.case, second]}):
            selected = matrix.select_cases(catalog=catalog, cases=["second", self.case["id"]], categories=None, route="face")
            self.assertEqual([row["id"] for row in selected], [self.case["id"], "second"])
            selected[0]["parameters"].clear()
            self.assertTrue(self.case["parameters"])

    def test_invalid_catalog_fields_are_rejected_before_any_output(self):
        fields = (("available", "yes"), ("expectedChange", 1), ("expectedChange", False),
            ("parameters", []), ("parameters", {}), ("adjustments", []), ("category", "unknown"),
            ("runtimePackage", None), ("id", "../escape"), ("key", "bad/key"), ("value", True),
            ("value", 101), ("value", float("inf")), ("value", 0), ("label", ""),
            ("dependencies", []), ("dependencies", "path"), ("dependencies", [str(self.root / "other")]),
            ("dependencies", [str(self.root / "package")] * 2), ("package", "relative"))
        for key, value in fields:
            with self.subTest(key=key, value=value), self.assertRaises((ValueError, TypeError)):
                self.select(cases=[dict(self.case, **{key: value})])
        self.probe.assert_not_called()

    def test_inconsistent_makeup_identity_is_rejected(self):
        for fields in (dict(category="makeup"), dict(runtimePackage="makeup"), dict(cardId="lip"),
                       dict(makeupCategory="lip")):
            with self.subTest(fields=fields), self.assertRaisesRegex(ValueError, "makeup identity"):
                self.select(cases=[dict(self.case, **fields)], route="makeup")

    def test_undeclared_dynamic_parameter_path_is_rejected(self):
        case = self.makeup()
        case["parameters"]["face_adjust_lip"][0]["path"] = str(self.root / "unbound")
        with self.assertRaisesRegex(ValueError, "declared package"):
            self.select(cases=[case], selected=[case["id"]], route="makeup")

    def test_oversized_parameters_and_nonfinite_nested_values_are_rejected(self):
        for parameters in ({"oversized": "x" * 17000}, {"intensity": float("nan")},
                           {"intensity": [{"value": float("inf")}]}):
            with self.subTest(parameters=str(parameters)[:40]), self.assertRaises(ValueError):
                self.select(cases=[dict(self.case, parameters=parameters)])

    def test_timeout_and_job_budget_are_strictly_bounded(self):
        for key, values in (("timeout", [0, 241, True, float("nan")]), ("max_jobs", [0, 73, True, 1.5])):
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    matrix.run_matrix(args=self.args(**{key: value}))
        self.write_inputs(portraits=[dict(id=name, image=str(self.image)) for name in ("one", "two")])
        with self.assertRaisesRegex(ValueError, "budget"):
            matrix.run_matrix(args=self.args(max_jobs=1))

    def test_more_than_24_selected_cards_is_rejected(self):
        cases = [dict(self.case, id=f"card-{index}") for index in range(25)]
        with self.assertRaisesRegex(ValueError, "24"):
            matrix.select_cases(catalog=cases, cases=[], categories=["face-shape"], route="face")

    def test_portrait_inventory_shape_duplicates_and_paths_are_checked(self):
        variants = [[], {}, [dict(id="bad", image="relative")],
            [dict(id="bad", image=str(self.image), parameters={})],
            [dict(id="same", image=str(self.image))] * 2,
            [dict(id=str(index), image=str(self.image)) for index in range(13)]]
        for portraits in variants:
            self.write_inputs(portraits=portraits)
            with self.subTest(portraits=portraits), self.assertRaises(ValueError):
                matrix.run_matrix(args=self.args())

    def test_combined_id_collisions_are_rejected(self):
        self.write_inputs(cases=[dict(self.case, id="x--y"), dict(self.case, id="y")],
            portraits=[dict(id="a", image=str(self.image)), dict(id="a--x", image=str(self.image))])
        with self.assertRaisesRegex(ValueError, "ambiguous combined"):
            matrix.run_matrix(args=self.args(case=["x--y", "y"]))

    def test_symlinks_relative_paths_and_protocol_delimiters_are_refused(self):
        link = self.root / "linked"
        link.symlink_to(self.root / "package", target_is_directory=True)
        for path in ("relative", str(self.root / "a/../b"), str(self.root) + "/line\nbreak",
                     str(link), str(link / "missing")):
            with self.subTest(path=path), self.assertRaises(ValueError):
                matrix.local_path(value=path)

    def test_duplicate_json_keys_are_rejected_before_selection(self):
        self.catalog.write_text('{"cases": [], "cases": []}')
        with self.assertRaisesRegex(ValueError, "duplicate JSON"):
            matrix.run_matrix(args=self.args())
        self.assertFalse((self.root / "out").exists())

    def test_no_matched_case_creates_no_output_or_probe(self):
        with self.assertRaises(ValueError):
            matrix.run_matrix(args=self.args(case=["absent"]))
        self.assertFalse((self.root / "out").exists())
        self.probe.assert_not_called()

    def test_cli_requires_route_and_uses_preparation_success_exit(self):
        argv = [item for key in ("catalog", "portraits", "runtime", "models", "out")
                for item in (f"--{key}", str(getattr(self.args(), key)))]
        with patch("sys.stderr"), self.assertRaises(SystemExit) as error:
            matrix.main(argv=argv)
        self.assertEqual(error.exception.code, 2)
        self.assertEqual(matrix.main(argv=[*argv, "--route", "face", "--case", self.case["id"]]), 0)
        self.probe.assert_not_called()

    def test_72_jobs_share_large_provenance_without_exceeding_report_reader_limit(self):
        cases = [self.makeup(case_id=f"makeup-{index}-p80") for index in range(24)]
        self.write_inputs(cases=cases, portraits=[dict(id=name, image=str(self.image)) for name in ("one", "two", "three")])
        tree = dict(directory=str(self.root / "large-model"), source=False,
            files={f"{self.root}/model-{index}-{'x' * 350}": dict(sha256="a" * 64,
                identity=[f"/fixture/{'y' * 350}", 1, index, 100, 100]) for index in range(1500)})
        self.assertGreater(len(json.dumps(tree, indent=2)) * 72, viewer.LIMIT)
        original = matrix.bundle.DependencyGuard.evidence

        def evidence(guard):
            value = original(guard)
            value["trees"].append(tree)
            return value

        with patch.object(matrix.bundle.DependencyGuard, "evidence", evidence):
            result = self.execute(route="makeup", case=[case["id"] for case in cases], max_jobs=72)
        self.assertTrue(result["passed"])
        self.assertEqual(self.probe.call_count, 72)
        self.assertEqual(len({row["audit_path"] for row in result["cases"]}), 72)
        paths = {row["hash_provenance"]["trees"][-1]["snapshot"] for row in result["cases"]}
        self.assertEqual(len(paths), 1)
        receipt = result["cases"][0]["hash_provenance"]["trees"][-1]
        self.assertEqual(receipt["sha256"], hashlib.sha256(Path(receipt["snapshot"]).read_bytes()).hexdigest())
        self.assertEqual(receipt["files"], 1500)
        self.assertLess((self.root / "out/matrix.json").stat().st_size, viewer.LIMIT)
        report = viewer.generate(matrix=self.root / "out/matrix.json", out=self.root / "view72")
        self.assertEqual(len(report["cases"]), 72)

    def test_repeated_tree_snapshots_verify_once_without_ignoring_conflicts(self):
        guards = [matrix.bundle.DependencyGuard(), matrix.bundle.DependencyGuard()]
        for guard in guards:
            guard.tree(directory=self.root / "source")
        with patch.object(matrix.bundle.TreeGuard, "verify", autospec=True) as verify:
            matrix.verify_guards(locked=matrix.LockedFiles(), guards=guards)
            self.assertEqual(verify.call_count, 1)
        guards[1].trees[0].files = {}
        with self.assertRaisesRegex(ValueError, "tree changed between cases"):
            matrix.verify_guards(locked=matrix.LockedFiles(), guards=guards)

    def test_duplicate_input_digest_and_identity_must_both_match(self):
        for kind in ("digest", "identity"):
            guards = [matrix.bundle.DependencyGuard(), matrix.bundle.DependencyGuard()]
            for guard in guards:
                guard.locked.read(path=self.image)
            if kind == "digest":
                guards[1].locked.files[str(self.image)] = "f" * 64
            else:
                guards[1].locked.identities[str(self.image)] = ("different", 0, 0, 0, 0)
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "input changed between cases"):
                matrix.verify_guards(locked=matrix.LockedFiles(), guards=guards)

    def test_matrix_and_case_lock_overlap_must_keep_initial_identity(self):
        locked, guard = matrix.LockedFiles(), matrix.bundle.DependencyGuard()
        locked.read(path=self.image)
        guard.locked.read(path=self.image)
        guard.locked.identities[str(self.image)] = ("different", 0, 0, 0, 0)
        with self.assertRaisesRegex(ValueError, "input changed between cases"):
            matrix.verify_guards(locked=locked, guards=[guard])

    def test_duplicate_library_fingerprints_must_match_and_verify_once(self):
        guards = [matrix.bundle.DependencyGuard(), matrix.bundle.DependencyGuard()]
        fingerprint = {"sha256": "a" * 64, "identity": ["library", 1, 2, 3, 4]}
        for guard in guards:
            guard.libraries["/synthetic/library"] = deepcopy(fingerprint)
        with patch.object(matrix.bundle, "file_fingerprint", return_value=fingerprint) as verify:
            matrix.verify_guards(locked=matrix.LockedFiles(), guards=guards)
            self.assertEqual(verify.call_count, 1)
        guards[1].libraries["/synthetic/library"]["sha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "library changed between cases"):
            matrix.verify_guards(locked=matrix.LockedFiles(), guards=guards)

    def test_snapshot_mutation_is_detected_before_following_native_launch(self):
        self.write_inputs(portraits=[dict(id=name, image=str(self.image)) for name in ("one", "two")])

        def prepare(**kwargs):
            result = self.fake_prepare(**kwargs)
            if self.prepare.call_count == 2:
                next((self.root / "out/provenance").glob("*.json")).write_text("changed")
            return result

        self.prepare.side_effect = prepare
        result = self.execute()
        self.assertTrue(result["aborted"])
        self.assertEqual(self.probe.call_count, 1)

    def test_provenance_write_or_read_fault_preserves_cleanup_and_aborted_matrix(self):
        for operation in ("write", "read"):
            with self.subTest(operation=operation):
                self.probe.reset_mock()
                self.write_inputs(portraits=[dict(id=name, image=str(self.image)) for name in ("one", "two")])
                original_write, original_read = matrix.bundle.write_json, matrix.LockedFiles.read

                def write(*, path, value):
                    if operation == "write" and path.parent.name == "provenance":
                        raise OSError("injected snapshot write fault")
                    return original_write(path=path, value=value)

                def read(locked, *, path, **kwargs):
                    if operation == "read" and Path(path).parent.name == "provenance":
                        raise OSError("injected snapshot read fault")
                    return original_read(locked, path=path, **kwargs)

                out = self.root / f"out-{operation}"
                with patch.object(matrix.bundle, "write_json", write), patch.object(matrix.LockedFiles, "read", read):
                    result = self.execute(out=out)
                self.assertTrue(result["aborted"])
                self.assertFalse(result["passed"])
                self.assertFalse(result["completed"])
                self.assertTrue(result["cases"][0]["cleanup"]["completed"])
                self.assertIn(f"snapshot {operation} fault", result["cases"][0]["error"])
                self.assertEqual(result["cases"][1]["status"], "blocked")
                self.assertEqual(self.probe.call_count, 1)
                self.assertEqual(json.loads((out / "matrix.json").read_text()), json.loads(json.dumps(result)))
                self.assertTrue((out / "progress-001.json").is_file())


if __name__ == "__main__":
    unittest.main()
