"""Synthetic CPU Extra receipts; hashes never establish native render parity."""
import copy
import hashlib
import json
import unittest

import face_live_extra_audit as auditor


VERSION = "extra-heads-v1:" + "a" * 64
NATIVE_DEPENDENCY = "extra-inner-filter-crop-transforms-and-mean"
HASH_FIELDS = ("geometry_sha256", "algorithm_rgba_sha256", "input_tensor_sha256",
               "head_sha256", "primary_sha256")
FALSE_FLAGS = ("captured_tensor_input_used", "native_final_point_input_used", "product_parity_verified")


def receipts():
    worker = []
    for index in range(2):
        hashes = {key: hashlib.sha256(f"synthetic-{index}-{key}".encode()).hexdigest() for key in HASH_FIELDS}
        receipt = dict(schema="face-live-extra-refinement-v1", backend_version=VERSION, **hashes,
            head_shape=[240, 2], sampling="owned-from-algorithm-rgba",
            geometry="native-live-extra-transforms-and-mean", elapsed_ms=1.25 + index,
            **dict.fromkeys(FALSE_FLAGS, False))
        result = dict(algorithm_rgba_sha256=receipt["algorithm_rgba_sha256"], extra_refinement=receipt,
                      native_dependencies=["full-frame-to-algorithm-RGBA", NATIVE_DEPENDENCY])
        worker.append(dict(ok=True, prediction=index, timestamp_us=0, result=result))
    return dict(worker=worker, expected_version=VERSION)


def changed(*, data, path, value):
    result = copy.deepcopy(data)
    parent = result
    for key in path[:-1]:
        parent = parent[key]
    parent[path[-1]] = value
    return result


class ExtraReceiptAuditTests(unittest.TestCase):
    def setUp(self):
        self.data = receipts()

    def reject(self, *, path, values):
        for value in values:
            with self.subTest(path=path, value=repr(value)[:100]), self.assertRaises(ValueError):
                auditor.audit(**changed(data=self.data, path=path, value=value))

    def test_two_cold_receipts_succeed_without_mutation_or_parity_claims(self):
        original = json.dumps(self.data, sort_keys=True, allow_nan=False)
        report = auditor.audit(**self.data)
        self.assertEqual(report, dict(schema="face-live-extra-receipt-audit-v1", passed=True,
            predictions=2, backend_version=VERSION, elapsed_ms=[1.25, 2.25],
            receipts_are_hashes_not_native_comparisons=True, product_parity_verified=False))
        self.assertEqual(json.dumps(self.data, sort_keys=True, allow_nan=False), original)
        json.dumps(report, allow_nan=False)
        report["elapsed_ms"][0] = 999
        self.assertEqual(self.data["worker"][0]["result"]["extra_refinement"]["elapsed_ms"], 1.25)

    def test_expected_version_requires_exact_family_and_lowercase_sha256(self):
        self.reject(path=("expected_version",), values=(None, True, 0, [], {}, "", "extra-heads-v1:",
            "extra-heads-v1:" + "a" * 63, "extra-heads-v1:" + "a" * 65,
            "extra-heads-v1:" + "A" * 64, "extra-heads-v1:" + "g" * 64,
            "extra-heads-v2:" + "a" * 64, "dependency-core-v1:" + "a" * 64,
            "extra-heads-v1:" + "a" * 64 + ":extra", "extra-heads-v1:" + "a" * 63 + "\0"))

    def test_both_receipts_bind_to_the_explicit_expected_extra_version(self):
        other = "extra-heads-v1:" + "b" * 64
        for index in range(2):
            self.reject(path=("worker", index, "result", "extra_refinement", "backend_version"),
                        values=(other, None, True, VERSION.encode(), "dependency-core-v1:" + "a" * 64))
        self.reject(path=("expected_version",), values=(other,))
        data = copy.deepcopy(self.data)
        for row in data["worker"]:
            row["result"]["extra_refinement"]["backend_version"] = other
        with self.assertRaises(ValueError):
            auditor.audit(**data)
        data["expected_version"] = other
        self.assertEqual(auditor.audit(**data)["backend_version"], other)

    def test_exactly_two_ordered_list_receipts_are_required(self):
        rows = self.data["worker"]
        self.reject(path=("worker",), values=(None, {}, (), tuple(rows), [], rows[:1], rows + rows[:1],
            rows[::-1], [rows[0], rows[0]], [rows[1], rows[1]]))

    def test_worker_scope_flags_indices_and_timestamps_have_strict_types(self):
        for index in range(2):
            self.reject(path=("worker", index, "ok"), values=(False, 1, 1.0, "true", None, [], {}))
            self.reject(path=("worker", index, "prediction"),
                        values=(None, True, False, float(index), str(index), 1 - index, -1, 2))
            self.reject(path=("worker", index, "timestamp_us"),
                        values=(None, True, False, 0.0, "0", 1, -1, float("nan")))

    def test_missing_worker_scope_and_result_fields_rejected(self):
        for index in range(2):
            for key in ("ok", "prediction", "timestamp_us", "result"):
                data = copy.deepcopy(self.data)
                data["worker"][index].pop(key)
                with self.subTest(index=index, key=key), self.assertRaises(ValueError):
                    auditor.audit(**data)
            for key in ("extra_refinement", "algorithm_rgba_sha256", "native_dependencies"):
                data = copy.deepcopy(self.data)
                data["worker"][index]["result"].pop(key)
                with self.subTest(index=index, result_field=key), self.assertRaises(ValueError):
                    auditor.audit(**data)

    def test_nondict_worker_rows_rejected_with_validation_error(self):
        for index in range(2):
            self.reject(path=("worker", index), values=(None, False, 0, "row", [], ()))

    def test_nondict_results_rejected_with_validation_error(self):
        for index in range(2):
            self.reject(path=("worker", index, "result"), values=(None, False, 0, "result", [], ()))

    def test_receipt_requires_exact_object_fields_without_extensions(self):
        for index in range(2):
            path = ("worker", index, "result", "extra_refinement")
            self.reject(path=path, values=(None, False, 0, "receipt", [], ()))
            receipt = self.data["worker"][index]["result"]["extra_refinement"]
            for key in receipt:
                data = copy.deepcopy(self.data)
                data["worker"][index]["result"]["extra_refinement"].pop(key)
                with self.subTest(index=index, missing=key), self.assertRaises(ValueError):
                    auditor.audit(**data)
            self.reject(path=(*path, "unverified_extension"), values=(False, True))

    def test_schema_sampling_and_geometry_provenance_are_exact(self):
        wrong = dict(schema=(None, True, "face-live-extra-refinement-v2", "face-live-candidate-result-v1"),
            sampling=(None, True, "native-captured-tensor", "replayed", "owned-from-algorithm-rgba "),
            geometry=(None, True, "owned", "cached-extra-transforms", "native-live-extra-transforms-and-mean "))
        for index in range(2):
            for key, values in wrong.items():
                self.reject(path=("worker", index, "result", "extra_refinement", key), values=values)

    def test_head_shape_is_exact_240_by_2_with_integer_dimensions(self):
        for index in range(2):
            self.reject(path=("worker", index, "result", "extra_refinement", "head_shape"),
                values=(None, 480, "240x2", [], [240], [240, 2, 1], [2, 240], [106, 2], [480, 1],
                    [240, 3], [240.0, 2], [240, 2.0], [True, 2], [240, True], ["240", 2],
                    [float("nan"), 2], [[240, 2]], (240, 2), {"rows": 240, "cols": 2}))

    def test_every_hash_requires_lowercase_64_character_hex_even_if_source_matches(self):
        bad = (None, True, 0, [], {}, b"a" * 64, "", "a" * 63, "a" * 65, "A" * 64,
               "g" * 64, "a" * 63 + " ", "a" * 63 + "\n", "a" * 63 + "\0")
        for index in range(2):
            for key in HASH_FIELDS:
                for value in bad:
                    data = copy.deepcopy(self.data)
                    result = data["worker"][index]["result"]
                    result["extra_refinement"][key] = value
                    if key == "algorithm_rgba_sha256":
                        result[key] = value
                    with self.subTest(index=index, key=key, value=repr(value)), self.assertRaises(ValueError):
                        auditor.audit(**data)

    def test_source_hash_must_match_its_own_worker_result_not_the_other_prediction(self):
        for index in range(2):
            other = self.data["worker"][1 - index]["result"]["algorithm_rgba_sha256"]
            self.reject(path=("worker", index, "result", "extra_refinement", "algorithm_rgba_sha256"),
                        values=(other, "f" * 64))
            self.reject(path=("worker", index, "result", "algorithm_rgba_sha256"),
                        values=(other, "f" * 64, None, False))
        self.assertTrue(auditor.audit(**self.data)["passed"])

    def test_false_flags_reject_truthy_and_falsey_nonboolean_values(self):
        for index in range(2):
            for key in FALSE_FLAGS:
                self.reject(path=("worker", index, "result", "extra_refinement", key),
                            values=(True, 0, 0.0, 1, None, "false", "", [], {}))

    def test_elapsed_time_inclusive_limits_accept_ints_and_floats(self):
        for value in (0, 0.0, 1, 0.125, 120000, 120000.0):
            data = copy.deepcopy(self.data)
            for row in data["worker"]:
                row["result"]["extra_refinement"]["elapsed_ms"] = value
            with self.subTest(value=value):
                report = auditor.audit(**data)
                self.assertEqual(report["elapsed_ms"], [value, value])
                self.assertIs(type(report["elapsed_ms"][0]), type(value))

    def test_elapsed_time_rejects_nan_infinities_out_of_bounds_and_wrong_types(self):
        for index in range(2):
            self.reject(path=("worker", index, "result", "extra_refinement", "elapsed_ms"),
                values=(float("nan"), float("inf"), -float("inf"), -1, -0.001, 120001, 120000.001,
                        None, True, False, "0", [], {}))

    def test_extreme_integer_timings_reject_with_validation_error_not_overflow(self):
        for index in range(2):
            self.reject(path=("worker", index, "result", "extra_refinement", "elapsed_ms"),
                        values=(10**400, -(10**400)))

    def test_native_dependency_is_required_and_exactly_named(self):
        for index in range(2):
            self.reject(path=("worker", index, "result", "native_dependencies"),
                values=([], ["owned-only"], [NATIVE_DEPENDENCY.upper()], [NATIVE_DEPENDENCY + "-cached"],
                        ["prefix-" + NATIVE_DEPENDENCY], ["native-renderer"]))
        data = copy.deepcopy(self.data)
        for row in data["worker"]:
            row["result"]["native_dependencies"] = [NATIVE_DEPENDENCY]
        self.assertTrue(auditor.audit(**data)["passed"])

    def test_native_dependencies_reject_string_and_mapping_membership_shortcuts(self):
        for index in range(2):
            self.reject(path=("worker", index, "result", "native_dependencies"),
                values=(NATIVE_DEPENDENCY, "prefix:" + NATIVE_DEPENDENCY + ":suffix",
                        {NATIVE_DEPENDENCY: False}, (NATIVE_DEPENDENCY,)))

    def test_native_dependencies_reject_noncontainer_values_with_validation_error(self):
        for index in range(2):
            self.reject(path=("worker", index, "result", "native_dependencies"), values=(None, True, 0, 1.0))

    def test_native_dependency_entries_are_strings_not_mixed_evidence(self):
        for index in range(2):
            self.reject(path=("worker", index, "result", "native_dependencies"),
                values=([NATIVE_DEPENDENCY, None], [NATIVE_DEPENDENCY, True], [NATIVE_DEPENDENCY, 1],
                        [NATIVE_DEPENDENCY, {}], [NATIVE_DEPENDENCY, []]))

    def test_second_receipt_failure_never_returns_partial_success(self):
        for key, value in (("head_shape", [106, 2]), ("elapsed_ms", float("nan")),
                           ("product_parity_verified", True), ("backend_version", "extra-heads-v1:" + "b" * 64)):
            data = changed(data=self.data, path=("worker", 1, "result", "extra_refinement", key), value=value)
            with self.subTest(key=key), self.assertRaises(ValueError):
                auditor.audit(**data)
        self.assertTrue(auditor.audit(**self.data)["passed"])


if __name__ == "__main__":
    unittest.main()
