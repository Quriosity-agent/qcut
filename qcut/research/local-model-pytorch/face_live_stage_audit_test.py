"""Synthetic CPU receipts only; no native execution, models or private files."""
from __future__ import annotations

import copy
import hashlib
import json
import unittest

import numpy as np

import face_live_stage_audit as auditor


TOKEN = "synthetic-stage-audit-session"
SOURCE_KEY = "synthetic-stage-source"
VERSION = "dependency-core-v1:" + "a" * 64
RUNTIME = dict(config_cache_mode=0, optimized_output_bit=False, cache_counter=0,
               cache_skip_bit=True, base_output_mode_bit=False)


def native_snapshot(*, candidate):
    stages = candidate["stages"]
    width, height = candidate["width"], candidate["height"]
    face = dict(id=candidate["face_id"], slot=0, alignment=candidate["alignment"],
        stage1=np.asarray(stages["decoded_120"], np.float32).T.tolist(),
        tracked=np.asarray(stages["mapped_120"], np.float32).T.tolist(), mapped=None,
        base_size=[160, 160], tracking_size=[120, 120], tracking_scale=1, frame_size=[height, width],
        published=dict(record=0x30000, count=106, storage_points=106, capacity_points=106,
                       points_xy=np.asarray(stages["smoothed"], np.float32).reshape(-1).tolist()),
        filters=[dict(copy.deepcopy(row), count=count, escale=10, width=height, height=width)
                 for row, count in zip(stages["filters"], (33, 73), strict=True)])
    face.update({key: [[1, 0, 0], [0, 1, 0]] for key in
                 ("forward", "inverse", "cached_forward", "cached_inverse", "detection_forward", "detection_inverse")})
    return dict(schema="face-live-native-stages-v1", pid=candidate["pid"], prediction=candidate["prediction"],
        timestamp_us=0, owner=0x10000, token_sha256=candidate["token_sha256"], width=width, height=height,
        algorithm_rgba_sha256=candidate["algorithm_rgba_sha256"], runtime_state=copy.deepcopy(RUNTIME),
        faces=[face], observation="post-native-predict-before-worker", native_points_sent_to_worker=False,
        product_parity_verified=False)


def receipts():
    points = np.column_stack((np.arange(106), np.arange(106) + 20)).astype(np.float32)
    normalized = auditor.normalized(points=points, request=[0, 320, 240, 1280, 0]).tolist()
    candidates, workers = [], []
    for index in range(2):
        filters = [dict(current_xy=group.reshape(-1).tolist(),
            previous_xy=[] if index == 0 else group.reshape(-1).tolist(),
            delta_x=[] if index == 0 else [0.0] * len(group),
            delta_y=[] if index == 0 else [0.0] * len(group), first=index == 0,
            alpha=float(np.float32(0.2)), scale=1.0) for group in (points[:33], points[33:])]
        candidate = dict(schema="face-live-candidate-stages-v1", prediction=index, timestamp_us=0,
            source_key=SOURCE_KEY, backend_version=VERSION, width=320, height=240, face_id=7,
            alignment=0x20000, route="ordinary-base-primary106", native_final_point_input_used=False,
            product_parity_verified=False, pid=123, token_sha256=hashlib.sha256(TOKEN.encode()).hexdigest(),
            algorithm_rgba_sha256=hashlib.sha256(f"synthetic-rgba-{index}".encode()).hexdigest(),
            stages=dict(seed_160=points.tolist() if index == 0 else None, decoded_120=(points / 2).tolist(),
                mapped_120=points.tolist(), smoothed=points.tolist(), normalized=copy.deepcopy(normalized), filters=filters))
        result = dict(schema="face-live-candidate-result-v1", source=auditor.SOURCE,
            source_key=SOURCE_KEY, backend_version=VERSION, prediction=index, frame_number=index, timestamp_us=0,
            algorithm_rgba_sha256=candidate["algorithm_rgba_sha256"], algorithm_width=320, algorithm_height=240,
            faces=[dict(id=7, points=copy.deepcopy(normalized))],
            primary_smoothing=dict(route=candidate["route"]), heads={"120": {}, **({"160": {}} if index == 0 else {})})
        result.update({key: False for key in ("native_final_point_input_used", "captured_tensor_input_used",
            "native_analysis_bypassed", "product_parity_verified", "candidate_parity_verified", "arbitrary_frame_backend_connected")})
        candidates.append(candidate)
        workers.append(dict(ok=True, token=TOKEN, pid=123, prediction=index, timestamp_us=0, result=result))
    return dict(native=[native_snapshot(candidate=row) for row in candidates], candidate=candidates,
                worker=workers, token=TOKEN, source_key=SOURCE_KEY)


def changed(*, data, path, value):
    result = copy.deepcopy(data)
    parent = result
    for key in path[:-1]:
        parent = parent[key]
    parent[path[-1]] = value
    return result


class StageAuditTests(unittest.TestCase):
    def setUp(self):
        self.data = receipts()

    def reject(self, *, path, values):
        for value in values:
            with self.subTest(path=path, value=repr(value)[:100]), self.assertRaises(ValueError):
                auditor.audit(**changed(data=self.data, path=path, value=value))

    def test_exact_receipts_are_json_pure_and_never_pipeline_parity(self):
        before = json.dumps(self.data, allow_nan=False, sort_keys=True)
        report = auditor.audit(**self.data)
        self.assertEqual(before, json.dumps(self.data, allow_nan=False, sort_keys=True))
        json.dumps(report, allow_nan=False)
        for key in ("passed", "receipt_validation_passed", "diagnostic_only", "all_available_comparisons_equal"):
            self.assertIs(report[key], True)
        for key in ("pipeline_parity_verified", "product_parity_verified", "first_mismatch_is_causal",
                    "seed_160_verified", "seed_160_native_counterpart_available"):
            self.assertIs(report[key], False)
        self.assertIsNone(report["first_available_mismatch"])
        self.assertEqual(report["comparison_domain"], "float32-bits")
        self.assertEqual(report["tolerance"], 0)
        self.assertNotIn(TOKEN, json.dumps(report))
        for row in report["predictions"]:
            self.assertIs(row["worker_normalized_points_verified"], True)
            for metric in row["stages"].values():
                self.assertEqual(metric["compared_values"], 212)
                self.assertEqual(metric["mismatched_values"], 0)

    def test_stage_differences_pass_receipts_and_first_mismatch_is_not_causal(self):
        for stage in auditor.STAGES:
            data = copy.deepcopy(self.data)
            data["candidate"][1]["stages"][stage][0][0] = 0.125
            if stage == "normalized":
                data["worker"][1]["result"]["faces"][0]["points"][0][0] = 0.125
            report = auditor.audit(**data)
            with self.subTest(stage=stage):
                self.assertTrue(report["passed"])
                self.assertFalse(report["all_available_comparisons_equal"])
                self.assertEqual(report["first_available_mismatch"], dict(prediction=1, comparison=stage))
                metric = report["predictions"][1]["stages"][stage]
                self.assertEqual(metric["mismatched_values"], 1)
                self.assertEqual(metric["max_abs_error"], 0.125)
                self.assertAlmostEqual(metric["rms_error"], 0.125 / np.sqrt(212))
                self.assertEqual(metric["first_mismatch"], [0, 0])

        data = copy.deepcopy(self.data)
        for stage in reversed(auditor.STAGES):
            if stage != "normalized":
                data["candidate"][0]["stages"][stage][0][0] = 2
        report = auditor.audit(**data)
        self.assertEqual(report["first_available_mismatch"], dict(prediction=0, comparison="decoded_120"))
        self.assertFalse(report["first_mismatch_is_causal"])
        self.assertNotIn("seed_160", report["comparison_order"])
        seed = report["predictions"][0]["seed_160"]
        self.assertTrue(seed["candidate_available"])
        self.assertFalse(seed["native_counterpart_available"])
        self.assertFalse(seed["verified"])
        self.assertFalse(report["predictions"][1]["seed_160"]["candidate_available"])

    def test_native_matrix_layout_and_existing_float32_normalization(self):
        for columns in (106, 280):
            data = copy.deepcopy(self.data)
            for snapshot in data["native"]:
                face = snapshot["faces"][0]
                for key in ("stage1", "tracked"):
                    face[key] = [row + [-123.0] * (columns - 106) for row in face[key]]
                face["published"].update(storage_points=columns, capacity_points=columns)
            with self.subTest(columns=columns):
                self.assertTrue(auditor.audit(**data)["all_available_comparisons_equal"])

        data = copy.deepcopy(self.data)
        points = np.array(data["candidate"][0]["stages"]["smoothed"], np.float32)
        points[0, 1] = np.float32(0.125)
        expected = auditor.normalized(points=points, request=[0, 320, 240, 1280, 0])
        naive_y = np.float32(1) - points[0, 1] / np.float32(240)
        self.assertNotEqual(expected[0, 1].view(np.uint32), naive_y.view(np.uint32))
        data["native"][0]["faces"][0]["published"]["points_xy"] = points.reshape(-1).tolist()
        data["candidate"][0]["stages"]["smoothed"] = points.tolist()
        data["candidate"][0]["stages"]["normalized"] = expected.tolist()
        data["worker"][0]["result"]["faces"][0]["points"] = expected.tolist()
        self.assertTrue(auditor.audit(**data)["all_available_comparisons_equal"])

    def test_unused_native_tracking_size_allows_only_typed_paired_zero(self):
        for snapshot in self.data["native"]:
            snapshot["faces"][0]["tracking_size"] = [0, 0]
        self.assertTrue(auditor.audit(**self.data)["all_available_comparisons_equal"])
        self.reject(path=("native", 0, "faces", 0, "tracking_size"), values=(
            [0, 120], [120, 0], [-1, -1], [0, -1], [4097, 4097], [0, 4097],
            [False, False], [0.0, 0], [0, 0.0], [None, None], [], [0], [0, 0, 0]))
        for key in ("base_size", "frame_size"):
            self.reject(path=("native", 0, "faces", 0, key), values=([0, 0],))

    def test_float32_bits_detect_one_ulp_and_signed_zero_not_float64_roundoff(self):
        data = copy.deepcopy(self.data)
        data["candidate"][0]["stages"]["decoded_120"][1][0] = 0.5 + 1e-10
        self.assertTrue(auditor.audit(**data)["all_available_comparisons_equal"])
        data["candidate"][0]["stages"]["decoded_120"][1][0] = float(np.nextafter(np.float32(0.5), np.float32(1)))
        self.assertFalse(auditor.audit(**data)["all_available_comparisons_equal"])

        data = changed(data=self.data, path=("candidate", 0, "stages", "decoded_120", 0, 0), value=-0.0)
        metric = auditor.audit(**data)["predictions"][0]["stages"]["decoded_120"]
        self.assertFalse(metric["equal"])
        self.assertEqual(metric["mismatched_values"], 1)
        self.assertEqual(metric["max_abs_error"], 0)
        self.assertEqual(metric["rms_error"], 0)

    def test_worker_points_mutation_including_signed_zero_invalidates_binding(self):
        for root in (("worker", 0, "result", "faces", 0, "points"), ("candidate", 0, "stages", "normalized")):
            self.reject(path=(*root, 0, 0), values=(0.001, -0.0, True, "0", float("nan"), -0.01, 1.01))

    def test_all_filter_arrays_parameters_and_flags_report_differences(self):
        for index in range(2):
            for key in auditor.FILTER_FIELDS:
                path = ("candidate", 1, "stages", "filters", index, key)
                value = True if key == "first" else 0.5
                if key in auditor.FILTER_ARRAYS:
                    path = (*path, 0)
                report = auditor.audit(**changed(data=self.data, path=path, value=value))
                with self.subTest(index=index, key=key):
                    self.assertTrue(report["passed"])
                    self.assertFalse(report["predictions"][1]["filters"][index][key]["equal"])
                    self.assertEqual(report["first_available_mismatch"],
                                     dict(prediction=1, comparison=f"filters.{index}.{key}"))

    def test_filter_empty_histories_and_signed_zero_are_not_erased(self):
        data = copy.deepcopy(self.data)
        state = data["candidate"][1]["stages"]["filters"][0]
        state.update(previous_xy=[], delta_x=[], delta_y=[], first=True)
        report = auditor.audit(**data)
        self.assertTrue(report["passed"])
        for key in ("previous_xy", "delta_x", "delta_y"):
            metric = report["predictions"][1]["filters"][0][key]
            self.assertFalse(metric["shape_equal"])
            self.assertFalse(metric["equal"])
            self.assertIsNone(metric["mismatched_values"])
            self.assertIsNone(metric["max_abs_error"])

        for key in (*auditor.FILTER_ARRAYS, "alpha", "scale"):
            data = copy.deepcopy(self.data)
            left = data["candidate"][1]["stages"]["filters"][0]
            right = data["native"][1]["faces"][0]["filters"][0]
            if key in auditor.FILTER_ARRAYS:
                left[key][0], right[key][0] = -0.0, 0.0
            else:
                left[key], right[key] = -0.0, 0.0
            with self.subTest(key=key):
                self.assertFalse(auditor.audit(**data)["predictions"][1]["filters"][0][key]["equal"])

    def test_exact_cold_lists_indices_and_times(self):
        for name in ("native", "candidate", "worker"):
            rows = self.data[name]
            self.reject(path=(name,), values=(None, {}, tuple(rows), rows[:1], rows + rows[:1], rows[::-1], [None, rows[1]]))
            for index in range(2):
                self.reject(path=(name, index, "prediction"), values=(True, float(index), 1 - index, -1, 2, None))
                self.reject(path=(name, index, "timestamp_us"), values=(True, 0.0, 1, -1, None))
        for key in ("prediction", "frame_number", "timestamp_us"):
            self.reject(path=("worker", 0, "result", key), values=(True, 0.0, 1, -1, None))

    def test_token_pid_source_backend_and_rgba_bind_each_receipt(self):
        self.reject(path=("token",), values=("foreign-session-token", "", True, "x" * 129, "x" * 16 + "\0"))
        self.reject(path=("source_key",), values=("foreign", "", True, "x" * 513, "bad\0key"))
        for index in range(2):
            self.reject(path=("worker", index, "token"), values=("foreign-session-token", None))
            self.reject(path=("worker", index, "ok"), values=(False, 1, None))
            for name in ("native", "candidate", "worker"):
                self.reject(path=(name, index, "pid"), values=(999, True, 0, 123.0, 2**31, None))
            for name in ("native", "candidate"):
                self.reject(path=(name, index, "token_sha256"), values=("b" * 64, "invalid", None))
            for path in (("native", index), ("candidate", index), ("worker", index, "result")):
                self.reject(path=(*path, "algorithm_rgba_sha256"), values=("b" * 64, "A" * 64, None, 0))
            for path in (("candidate", index), ("worker", index, "result")):
                self.reject(path=(*path, "source_key"), values=("foreign", None, True))
                self.reject(path=(*path, "backend_version"), values=("dependency-core-v1:" + "b" * 64, None, "bad"))
        data = copy.deepcopy(self.data)
        for name in ("native", "candidate", "worker"):
            data[name][1]["pid"] = 999
        with self.assertRaises(ValueError):
            auditor.audit(**data)
        data = copy.deepcopy(self.data)
        data["candidate"][1]["backend_version"] = "dependency-core-v1:" + "b" * 64
        data["worker"][1]["result"]["backend_version"] = data["candidate"][1]["backend_version"]
        with self.assertRaises(ValueError):
            auditor.audit(**data)

    def test_dimensions_face_inventory_identity_and_alignment(self):
        for key in ("width", "height"):
            for name in ("native", "candidate"):
                self.reject(path=(name, 0, key), values=(100, True, 0, 4097, 320.0, None))
            self.reject(path=("worker", 0, "result", f"algorithm_{key}"), values=(100, True, 0, 4097, None))
        for path in (("native", 0, "faces"), ("worker", 0, "result", "faces")):
            self.reject(path=path, values=([], [{}, {}], None, [None]))
        for path in (("native", 0, "faces", 0, "id"), ("candidate", 0, "face_id"), ("worker", 0, "result", "faces", 0, "id")):
            self.reject(path=path, values=(8, True, -1, 2**31, 7.0, None))
        for path in (("native", 0, "faces", 0, "alignment"), ("candidate", 0, "alignment")):
            self.reject(path=path, values=(0x21000, True, 0, 4095, float(0x20000), None))
        self.reject(path=("native", 1, "owner"), values=(0x50000, True, None, 0))

    def test_flags_observation_base_extra_routes_and_optional_source_context(self):
        for path in (("native", 0, "native_points_sent_to_worker"), ("candidate", 0, "native_final_point_input_used"),
                     ("native", 0, "product_parity_verified"), ("candidate", 0, "product_parity_verified")):
            self.reject(path=path, values=(True, 0, None, "false"))
        for key in ("native_final_point_input_used", "captured_tensor_input_used", "native_analysis_bypassed",
                    "product_parity_verified", "candidate_parity_verified", "arbitrary_frame_backend_connected"):
            self.reject(path=("worker", 0, "result", key), values=(True, 0, None))
        self.reject(path=("native", 0, "observation"), values=(None, "post-worker", "pre-predict"))
        for key, value in RUNTIME.items():
            self.reject(path=("native", 0, "runtime_state", key),
                        values=(None, int(value) if type(value) is bool else bool(value), 1 - value))
        self.reject(path=("candidate", 0, "route"), values=(None, "ordinary-extra-primary106", "optimized"))
        self.reject(path=("worker", 0, "result", "primary_smoothing"), values=(None, {}, {"route": "optimized"}))

        for index in range(2):
            self.data["native"][index]["runtime_state"]["base_output_mode_bit"] = True
            self.data["candidate"][index]["route"] = "ordinary-extra-primary106"
            self.data["candidate"][index]["source"] = auditor.SOURCE
            self.data["worker"][index]["result"]["primary_smoothing"]["route"] = "ordinary-extra-primary106"
        self.assertTrue(auditor.audit(**self.data)["all_available_comparisons_equal"])
        self.reject(path=("candidate", 0, "source"), values=(None, "replayed"))

    def test_shapes_finiteness_types_and_coordinate_ranges(self):
        for stage in ("seed_160", *auditor.STAGES):
            path = ("candidate", 0, "stages", stage)
            self.reject(path=path, values=([], [0] * 212, [[0, 0]] * 105, [[0, 0, 0]] * 106, None, "points"))
            self.reject(path=(*path, 0, 0), values=(True, "0", None, float("nan"), float("inf"), -float("inf"), 32769, 10**400))
        for key in ("stage1", "tracked"):
            path = ("native", 0, "faces", 0, key)
            self.reject(path=path, values=(None, [], [[0, 0]] * 106, [[0] * 107] * 2, [[0] * 106, [0] * 280]))
            self.reject(path=(*path, 0, 0), values=(True, None, float("nan"), 32769))
        self.reject(path=("native", 0, "faces", 0, "published", "points_xy"), values=([], [[0, 0]] * 106, [0] * 560))
        self.reject(path=("native", 0, "faces", 0, "published", "points_xy", 0), values=(-1, 321, float("nan"), True))
        data = copy.deepcopy(self.data)
        data["native"][0]["faces"][0]["stage1"] = [[0.0] * 280] * 2
        data["native"][0]["faces"][0]["stage1"][0][-1] = float("nan")
        with self.assertRaises(ValueError):
            auditor.audit(**data)

    def test_filter_and_envelope_shapes_types_ranges_and_inventory(self):
        for prefix in (("candidate", 0, "stages", "filters"), ("native", 0, "faces", 0, "filters")):
            self.reject(path=prefix, values=([], [None, None], None))
            for key in auditor.FILTER_ARRAYS:
                self.reject(path=(*prefix, 0, key), values=(None, [0], [[0, 0]] * 33, [0] * 146))
            self.reject(path=(*prefix, 0, "current_xy", 0), values=(True, float("nan"), "0", 32769))
            self.reject(path=(*prefix, 0, "first"), values=(0, 1, None, "false"))
            self.reject(path=(*prefix, 0, "alpha"), values=(True, -0.1, 1.01, float("nan")))
            self.reject(path=(*prefix, 0, "scale"), values=(True, -1, 2**20 + 1, float("inf")))
            self.reject(path=(*prefix, 0, "delta_x"), values=([0] * 33,))
        self.reject(path=("candidate", 0, "stages", "filters", 0, "current_xy"), values=([],))
        self.reject(path=("native", 0, "faces", 0, "filters", 0, "count"), values=(73, 33.0, True))
        self.reject(path=("native", 0, "faces", 0, "filters", 0, "width"), values=(320, True, 0))

        for name in ("native", "candidate"):
            self.reject(path=(name, 0, "schema"), values=(None, "wrong-v1"))
            for key in self.data[name][0]:
                data = copy.deepcopy(self.data)
                data[name][0].pop(key)
                with self.subTest(name=name, missing=key), self.assertRaises(ValueError):
                    auditor.audit(**data)
            self.reject(path=(name, 0, "pipeline_parity_verified"), values=(True,))
        self.reject(path=("worker", 0, "result", "heads"), values=({}, {"120": {}}, None))
        self.reject(path=("candidate", 1, "stages", "seed_160"), values=([[0, 0]] * 106,))
        self.reject(path=("worker", 0, "result"), values=(None, []))

    def test_actual_candidate_observer_and_worker_cpu_receipts(self):
        import face_live_candidate_test as fixtures
        import face_live_worker_test as packets
        from face_live_worker import LiveWorker

        models = fixtures.FakeHeads()
        models.version = VERSION
        worker = LiveWorker(models=models, token=packets.TOKEN, source_key="synthetic-worker-source")
        snapshots = []
        worker.core.stage_observer = lambda **kwargs: snapshots.append(kwargs["snapshot"])
        replies = [packets.feed(worker=worker, prediction=index, mode="seed-160" if index == 0 else "update")[0]
                   for index in range(2)]
        for snapshot in snapshots:
            snapshot.update(pid=123, token_sha256=hashlib.sha256(packets.TOKEN.encode()).hexdigest())
        report = auditor.audit(native=[native_snapshot(candidate=row) for row in snapshots], candidate=snapshots,
            worker=replies, token=packets.TOKEN, source_key="synthetic-worker-source")
        self.assertTrue(report["all_available_comparisons_equal"])
        self.assertTrue(report["receipt_validation_passed"])


if __name__ == "__main__":
    unittest.main()
