"""Synthetic CPU-only chain-input contracts; no captures, native runtime or GPU."""
from copy import deepcopy
import hashlib
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np

from face_host_geometry_contract_test import geometry_row
import face_preprocess_chain_inputs as chain


def sha(*, data):
    return hashlib.sha256(data).hexdigest()


class LockedBytes:
    def __init__(self, *, files):
        self.files = files
        self.calls = []

    def read(self, *, path, maximum, expected=None):
        self.calls.append(dict(path=path, maximum=maximum, expected=expected))
        data = self.files[path]
        if len(data) > maximum or (expected is not None and sha(data=data) != expected):
            raise ValueError("synthetic locked identity/size mismatch")
        return data


class ChainInputsTests(unittest.TestCase):
    def setUp(self):
        self.reset_fixture()
        loader = patch.object(chain.parity, "bounded_bytes", side_effect=self.bounded_bytes)
        loader.start()
        self.addCleanup(loader.stop)

    def reset_fixture(self):
        self.root = Path("/synthetic/preprocess-chain").absolute()
        self.files, self.frames, self.oracles = {}, {}, {}
        self.records, self.associations, self.events, self.descriptors = [], [], [], []
        inputs = []
        for index in range(26):
            row = geometry_row(index=index)
            row["request"] = [0, 6, 8, 24, 0]
            face = row["faces"][0]
            face.update(frame_size=[8, 6], active=index not in (18, 19),
                        id=0 if index < 20 else 1, tracking_id=0 if index < 20 else 1)
            lower = self.associations[-1]["neural_window"][1] if index else 0
            row["bytenn_sequence"] = lower if index in (18, 19) else lower + 16
            items = [] if not face["active"] else [dict(size=120, network="32768",
                                                       inference=index, record_index=lower + 2)]
            self.records.append(row)
            self.associations.append(dict(prediction=index, neural_window=[lower, row["bytenn_sequence"]],
                                          inferences=items))
            y, x = np.indices((8, 6))
            frame = np.stack(((x * 11 + index) % 256, (y * 17 + 37) % 256,
                              (x * 5 + y * 7 + 101) % 256, (x + y) % 256), axis=-1).astype(np.uint8)
            self.frames[index] = frame
            name = f"frame-{index}.rgba"
            self.files[self.root / "geometry" / name] = frame.tobytes()
            self.descriptors.append(dict(prediction=index, file=name, bytes=frame.nbytes,
                                         sha256=sha(data=frame.tobytes())))
            if index not in (0, 20):
                continue
            inference = len(inputs)
            items.append(dict(size=160, network="57344", inference=inference, record_index=lower + 1))
            source = frame[:, :, [2, 1, 0]].copy()
            crop = source[2:6, 1:5].copy()
            resized = np.repeat(np.repeat(crop, 40, axis=0), 40, axis=1)
            tensor = (resized.astype(np.int16) - 128).astype(np.int8)[None]
            self.oracles[index] = dict(source=source, crop=crop, resized=resized, tensor=tensor,
                                       post_crop_rect=[1, 2, 4, 4])
            event = dict(prediction=index, owner=row["handle"], **row["predictors"][1],
                         call=dict(alignment=face["alignment"], format=0, orientation=0, target=[160, 160],
                                   flags=[0, 0, 0], rect=dict(values=[1, 2, 4, 4]), expansion=1),
                         post_crop_rect=dict(values=[1, 2, 4, 4]))
            for stage in ("source", "crop", "resized"):
                pixels = self.oracles[index][stage]
                name = f"prediction-{index:02d}-{stage}.bgr"
                self.files[self.root / "trace" / name] = pixels.tobytes()
                event[stage] = dict(file=name, rows=pixels.shape[0], cols=pixels.shape[1],
                                    sha256=sha(data=pixels.tobytes()))
            path = self.root / "capture" / f"input-{inference}.bin"
            self.files[path] = tensor.tobytes()
            inputs.append(dict(name="data", inference=inference, raw=[1, 6], dims_nwhc=[1, 160, 160, 3],
                               path=str(path), sha256=sha(data=tensor.tobytes())))
            self.events.append(event)
        self.trace = dict(passed=True, software_breakpoints_used=False, target_memory_written=False,
                          target_functions_evaluated=False, failures=[], observer_failures=[], pending=None,
                          maximum_active_breakpoints=4, events=self.events,
                          predictions=[dict(index=row["index"], owner=row["handle"], request=list(row["request"]))
                                       for row in self.records])
        self.network = dict(inputs=inputs, successful_inferences=[0, 1])
        self.evidence = dict(geometry_snapshots=self.records, trace=self.trace, algorithm_frames=self.descriptors,
                             captures=dict(networks={"57344": self.network}))
        self.refresh_cases()
        self.locked = LockedBytes(files=self.files)

    def bounded_bytes(self, *, path, limit):
        data = self.files[path]
        if len(data) > limit:
            raise ValueError("synthetic tensor exceeds byte bound")
        return data

    def refresh_cases(self):
        self.evidence["cases"] = deepcopy(chain.validate_trace(trace=self.trace, records=self.records,
                                                              associations=self.associations))

    def build(self):
        return chain.build_inputs(root=self.root, evidence=self.evidence,
                                  associations=self.associations, locked=self.locked)

    def reject(self, *, message=None):
        with self.assertRaises((ValueError, RuntimeError, KeyError, TypeError, IndexError)) as caught:
            self.build()
        if message is not None:
            self.assertIn(message, str(caught.exception))
        return caught.exception

    def mutate_blob(self, *, prediction, stage, truncate=False):
        row = (self.network["inputs"][0 if prediction == 0 else 1] if stage == "tensor"
               else self.events[0 if prediction == 0 else 1][stage])
        path = Path(row["path"]) if stage == "tensor" else self.root / "trace" / row["file"]
        data = bytearray(self.files[path])
        if truncate:
            data = data[:-1]
        else:
            data[0] ^= 1
        self.files[path] = bytes(data)
        row["sha256"] = sha(data=data)
        self.refresh_cases()

    def test_exact_two_lifecycle_tensors_and_case_provenance(self):
        tensors, cases = self.build()
        self.assertEqual(set(tensors), {(160, 0), (160, 1)})
        self.assertEqual(len(cases), 2)
        for actual, expected in zip(cases, self.evidence["cases"], strict=True):
            prediction, inference = expected["prediction"], expected["inference"]
            for field in ("prediction", "face_id", "inference", "neural_window", "record_index"):
                self.assertEqual(actual[field], expected[field])
            self.assertEqual(actual["network"], "57344")
            self.assertIs(actual["passed"], True)
            self.assertEqual(actual["generated_tensor_sha256"], sha(data=self.oracles[prediction]["tensor"].tobytes()))
            self.assertEqual(set(actual["checks"]), {"source", "crop", "resized", "post_crop_rect", "tensor"})
            self.assertTrue(all(row["exact"] is True for row in actual["checks"].values()))
            for stage in ("source", "crop", "resized", "tensor"):
                self.assertEqual(actual["checks"][stage]["mismatches"], 0)
                self.assertEqual(actual["checks"][stage]["max_abs"], 0)
            np.testing.assert_array_equal(tensors[(160, inference)], self.oracles[prediction]["tensor"])

    def test_temporal_validation_and_actual_trace_are_always_used(self):
        with patch.object(chain, "validate_sequence", wraps=chain.validate_sequence) as sequence, \
                patch.object(chain, "validate_trace", wraps=chain.validate_trace) as trace:
            self.build()
        sequence.assert_called_once_with(records=self.records, temporal=True)
        trace.assert_called_once_with(trace=self.trace, records=self.records, associations=self.associations)

    def test_producer_inputs_are_only_algorithm_rgba_and_actual_call(self):
        with patch.object(chain, "prepare", wraps=chain.prepare) as producer:
            self.build()
        self.assertEqual(producer.call_count, 2)
        for invocation, prediction in zip(producer.call_args_list, (0, 20), strict=True):
            self.assertEqual(invocation.args, ())
            self.assertEqual(set(invocation.kwargs), {"frame", "call"})
            np.testing.assert_array_equal(invocation.kwargs["frame"], self.frames[prediction])
            self.assertIs(invocation.kwargs["call"], self.events[0 if prediction == 0 else 1]["call"])
            for stage in ("source", "crop", "resized", "tensor"):
                self.assertFalse(np.shares_memory(invocation.kwargs["frame"], self.oracles[prediction][stage]))

    def test_all_comparison_reads_are_hash_bound_and_bounded(self):
        self.build()
        self.assertEqual(len(self.locked.calls), 10)
        for row in self.locked.calls:
            self.assertEqual(row["expected"], sha(data=self.files[row["path"]]))
            if row["path"].suffix == ".rgba":
                self.assertEqual(row["maximum"], 8 * 6 * 4)
            elif row["path"].suffix == ".bin":
                self.assertEqual(row["maximum"], 160 * 160 * 3)
            else:
                self.assertEqual(row["maximum"], 16 * 1024**2)

    def test_tensor_selection_and_loader_use_actual_inference(self):
        with patch.object(chain.parity, "stage1_input", wraps=chain.parity.stage1_input) as selector, \
                patch.object(chain.parity, "load_tensor", wraps=chain.parity.load_tensor) as loader:
            self.build()
        self.assertEqual([row.kwargs["inference"] for row in selector.call_args_list], [0, 1])
        self.assertTrue(all(row.kwargs["network"] is self.network and row.kwargs["size"] == 160
                            for row in selector.call_args_list))
        self.assertEqual([row.kwargs["item"] for row in loader.call_args_list], self.network["inputs"])

    def test_success_does_not_mutate_evidence_associations_or_locked_bytes(self):
        before = deepcopy((self.evidence, self.associations, self.files))
        self.build()
        self.assertEqual((self.evidence, self.associations, self.files), before)

    def test_tensors_are_owned_contiguous_readonly_and_independent(self):
        produced = []
        original = chain.prepare
        def collect(*, frame, call):
            value = original(frame=frame, call=call)
            produced.append(value)
            return value
        with patch.object(chain, "prepare", side_effect=collect):
            tensors, _ = self.build()
        outputs = list(tensors.values())
        for tensor, values in zip(outputs, produced, strict=True):
            self.assertEqual((tensor.dtype, tensor.shape), (np.dtype("int8"), (1, 160, 160, 3)))
            self.assertTrue(tensor.flags.owndata and tensor.flags.c_contiguous)
            self.assertFalse(tensor.flags.writeable)
            self.assertFalse(np.shares_memory(tensor, values["tensor"]))
            with self.assertRaises(ValueError):
                tensor.flat[0] = 0
            previous = tensor.copy()
            values["tensor"].flat[0] ^= 1
            np.testing.assert_array_equal(tensor, previous)
        self.assertFalse(np.shares_memory(*outputs))

    def test_failure_does_not_mutate_inputs_or_expose_partial_replacements(self):
        self.mutate_blob(prediction=20, stage="tensor")
        before = deepcopy((self.evidence, self.associations, self.files))
        error = self.reject(message="native fallback forbidden")
        self.assertFalse(hasattr(error, "inputs"))
        self.assertEqual((self.evidence, self.associations, self.files), before)

    def test_evidence_must_be_object(self):
        for value in (None, [], False, "capture"):
            with self.subTest(value=value):
                self.evidence = value
                self.reject(message="evidence")

    def test_invalid_empty_duplicate_or_gapped_geometry_rejected(self):
        original = self.records
        for rows in (None, [], original[:-1], original + [original[-1]],
                     [original[0], *original[2:]], [original[0]] * 26):
            with self.subTest(count=len(rows) if isinstance(rows, list) else None):
                self.evidence["geometry_snapshots"] = rows
                self.reject()

    def test_malformed_association_container_order_and_rows(self):
        original = self.associations
        for rows in (None, {}, [], original[:-1], original + [original[-1]], list(reversed(original)),
                     [None, *original[1:]], [dict(original[0], prediction=False), *original[1:]],
                     [dict(original[0], prediction=0.0), *original[1:]],
                     [dict(original[0], inferences=None), *original[1:]]):
            with self.subTest(rows=type(rows).__name__):
                self.associations = rows
                self.reject(message="association")

    def test_missing_empty_extra_duplicate_and_reordered_recorded_cases(self):
        original = deepcopy(self.evidence["cases"])
        self.evidence.pop("cases")
        self.reject(message="lifecycle")
        for cases in (None, [], original[:1], original + [original[0]], [original[0]] * 2,
                      list(reversed(original)), [{}, original[1]]):
            with self.subTest(cases=cases):
                self.evidence["cases"] = cases
                self.reject(message="lifecycle")

    def test_case_metadata_must_equal_recomputed_trace_not_cached_claims(self):
        for field, value in (("prediction", 19), ("face_id", 123), ("inference", 99),
                              ("record_index", 999), ("neural_window", [0, 999]), ("event", {})):
            before = deepcopy(self.evidence["cases"])
            self.evidence["cases"][1][field] = value
            with self.subTest(field=field):
                self.reject(message="lifecycle")
            self.evidence["cases"] = before

    def test_empty_duplicate_unexpected_recomputed_lifecycle_cases_rejected(self):
        original = deepcopy(self.evidence["cases"])
        for cases in ([], original[:1], original + [original[1]], [original[0]] * 2,
                      [original[0], dict(original[1], prediction=19)]):
            self.evidence["cases"] = cases
            with self.subTest(count=len(cases)), patch.object(chain, "validate_trace", return_value=cases):
                self.reject(message="lifecycle")

    def test_wrong_seed_face_ids_do_not_pass_cached_cases(self):
        for prediction in (0, 20):
            face = self.records[prediction]["faces"][0]
            previous = face["id"]
            face["id"] = previous + 10
            with self.subTest(prediction=prediction):
                self.reject(message="lifecycle")
            face["id"] = previous

    def test_wrong_owner_alignment_predictor_provider_and_network_rejected(self):
        for field in ("owner", "predictor", "provider", "network", "alignment"):
            row = self.events[1]["call"] if field == "alignment" else self.events[1]
            previous = row[field]
            row[field] += 4096
            with self.subTest(field=field):
                self.reject(message="association")
            row[field] = previous

    def test_hardware_trace_must_be_readonly_completed_and_neutral(self):
        changes = [("passed", False), ("software_breakpoints_used", True), ("target_memory_written", True),
                   ("target_functions_evaluated", True), ("pending", {}), ("failures", ["failed"]),
                   ("observer_failures", ["failed"]), ("maximum_active_breakpoints", 5)]
        for field, value in changes:
            previous = self.trace[field]
            self.trace[field] = value
            with self.subTest(field=field):
                self.reject(message="read-only")
            self.trace[field] = previous

    def test_missing_unmatched_and_duplicate_160_associations_rejected(self):
        item = self.associations[20]["inferences"][-1]
        original = deepcopy(self.associations)
        mutations = [(20, []), (20, [dict(item, inference=99)]), (20, [item, item]),
                     (1, [dict(item, record_index=17)])]
        for prediction, items in mutations:
            self.associations = deepcopy(original)
            self.associations[prediction]["inferences"] = items
            with self.subTest(prediction=prediction, count=len(items)):
                self.reject()

    def test_reused_160_inference_across_lifecycles_rejected(self):
        self.associations[20]["inferences"][-1]["inference"] = 0
        self.refresh_cases()
        self.reject(message="reused")

    def test_frame_descriptor_container_must_cover_all_predictions(self):
        for descriptors in (None, [], {}, self.descriptors[:-1], self.descriptors + [self.descriptors[-1]]):
            self.evidence["algorithm_frames"] = descriptors
            with self.subTest(count=len(descriptors) if descriptors is not None else None):
                self.reject(message="descriptor")

    def test_wrong_algorithm_descriptor_identity_dimensions_and_sha_rejected(self):
        descriptor = self.descriptors[20]
        for field, value in (("prediction", 0), ("prediction", 20.0), ("file", "frame-0.rgba"),
                              ("file", "../outside.rgba"), ("bytes", 191), ("bytes", 192.0),
                              ("sha256", None), ("sha256", "f" * 64)):
            previous = descriptor[field]
            descriptor[field] = value
            with self.subTest(field=field, value=value):
                self.reject()
            descriptor[field] = previous

    def test_wrong_algorithm_bytes_and_truncation_rejected(self):
        path = self.root / "geometry" / "frame-20.rgba"
        original = self.files[path]
        for data in (original[:-1], original + b"\0", bytes(len(original))):
            self.files[path] = data
            with self.subTest(size=len(data)):
                self.reject()

    def test_changed_algorithm_frame_with_updated_hash_still_rejected_against_oracles(self):
        path = self.root / "geometry" / "frame-20.rgba"
        data = bytearray(self.files[path])
        data[0] ^= 1
        self.files[path] = bytes(data)
        self.descriptors[20]["sha256"] = sha(data=data)
        self.reject(message="native fallback forbidden")

    def test_missing_oracle_sha_rejected_for_each_pixel_stage(self):
        for stage in ("source", "crop", "resized"):
            row = self.events[1][stage]
            previous = row.pop("sha256")
            self.refresh_cases()
            with self.subTest(stage=stage):
                self.reject(message="hash")
            row["sha256"] = previous
            self.refresh_cases()

    def test_wrong_oracle_stage_name_dimensions_and_hash_rejected(self):
        row = self.events[1]["crop"]
        for field, value in (("file", "prediction-00-crop.bgr"), ("rows", 3), ("cols", 5),
                              ("sha256", "0" * 64), ("sha256", "not-sha")):
            previous = row[field]
            row[field] = value
            self.refresh_cases()
            with self.subTest(field=field):
                self.reject()
            row[field] = previous

    def test_one_value_difference_in_any_stage_rejects_without_fallback(self):
        for stage in ("source", "crop", "resized", "tensor"):
            self.reset_fixture()
            self.mutate_blob(prediction=20, stage=stage)
            with self.subTest(stage=stage):
                self.reject(message="native fallback forbidden")

    def test_truncated_pixel_and_tensor_oracles_rejected(self):
        for stage in ("source", "crop", "resized", "tensor"):
            self.reset_fixture()
            self.mutate_blob(prediction=20, stage=stage, truncate=True)
            with self.subTest(stage=stage):
                self.reject()

    def test_post_crop_rectangle_must_match_exactly(self):
        self.events[1]["post_crop_rect"]["values"][0] += 1
        self.refresh_cases()
        self.reject(message="native fallback forbidden")

    def test_wrong_format_orientation_target_and_flags_never_fall_back(self):
        row = self.events[1]["call"]
        for field, value in (("format", 1), ("orientation", 1), ("target", [120, 120]), ("flags", [1, 0, 1])):
            previous = row[field]
            row[field] = value
            self.refresh_cases()
            with self.subTest(field=field):
                self.reject()
            row[field] = previous

    def test_missing_duplicate_wrong_name_shape_and_storage_tensor_descriptors(self):
        original = deepcopy(self.network["inputs"])
        rows = [original[:1], original + [original[1]]]
        rows.extend([original[:1] + [dict(original[1], **{field: value})] for field, value in
                     (("name", "other"), ("dims_nwhc", [1, 120, 120, 3]), ("raw", [2, 6]),
                      ("raw", [1, 5]), ("sha256", None), ("path", ""), ("inference", 99))])
        for inputs in rows:
            self.network["inputs"] = inputs
            with self.subTest(inputs=inputs[-1] if inputs else None):
                self.reject()

    def test_generated_tensor_type_shape_dtype_are_strict(self):
        original = chain.prepare
        invalid = (None, [], np.zeros((160, 160, 3), np.int8), np.zeros((1, 160, 160, 3), np.int16),
                   np.zeros((1, 160, 160, 3), np.uint8), np.zeros((1, 160, 160, 3), np.float32))
        for tensor in invalid:
            def bad(*, frame, call):
                return dict(original(frame=frame, call=call), tensor=tensor)
            with self.subTest(kind=type(tensor).__name__), patch.object(chain, "prepare", side_effect=bad):
                self.reject(message="int8 160 tensor")

    def test_loader_identity_is_rechecked_after_locked_read(self):
        original = chain.parity.load_tensor
        def change(*, item):
            self.files[Path(item["path"])] = bytes(76800)
            return original(item=item)
        with patch.object(chain.parity, "load_tensor", side_effect=change):
            self.reject(message="identity mismatch")

    def test_160_association_fields_require_typed_bounded_identities(self):
        mutations = [("size", 160.0), ("inference", False), ("inference", 0.0),
                     ("record_index", True), ("record_index", 1.0), ("record_index", -1),
                     ("record_index", 16), ("network", 57344)]
        for field, value in mutations:
            self.reset_fixture()
            self.associations[0]["inferences"][-1][field] = value
            with self.subTest(field=field, value=value):
                try:
                    self.refresh_cases()
                except ValueError:
                    continue
                self.reject()

    def test_association_neural_windows_match_actual_marker_bounds(self):
        for window in (None, [], [0], [0, 16, 17], [False, 16], [0.0, 16], [-1, 16], [0, 17], [16, 0]):
            self.reset_fixture()
            self.associations[0]["neural_window"] = window
            self.refresh_cases()
            with self.subTest(window=window):
                self.reject()

    def test_malformed_inference_records_reject_before_production(self):
        original = deepcopy(self.associations[0]["inferences"][-1])
        malformed = [None, [], "inference", {}]
        malformed.extend([{key: value for key, value in original.items() if key != field}
                          for field in ("size", "inference", "network", "record_index")])
        for item in malformed:
            self.reset_fixture()
            self.associations[0]["inferences"][-1] = item
            with self.subTest(item=item), patch.object(chain, "prepare") as producer:
                self.reject()
                producer.assert_not_called()

    def test_generated_tensor_view_is_copied_not_frozen_in_place(self):
        backing = self.oracles[0]["tensor"].copy()
        view = backing[:, ::-1][:, ::-1]
        original = chain.prepare
        def produce(*, frame, call):
            value = original(frame=frame, call=call)
            if np.array_equal(frame, self.frames[0]):
                value["tensor"] = view
            return value
        with patch.object(chain, "prepare", side_effect=produce):
            tensors, _ = self.build()
        self.assertTrue(backing.flags.writeable and view.flags.writeable)
        self.assertFalse(np.shares_memory(tensors[(160, 0)], backing))
        backing.flat[0] ^= 1
        np.testing.assert_array_equal(tensors[(160, 0)], self.oracles[0]["tensor"])


if __name__ == "__main__":
    unittest.main()
