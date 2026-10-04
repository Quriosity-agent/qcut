"""Synthetic CPU receipts only; these tests establish no native acceptance."""
from __future__ import annotations

import copy
import struct
import unittest

from face_live_makeup_point_audit import audit


def fixture(*, passes=1, width=640, height=640):
    token, source_key, pid = "synthetic-session", "synthetic-source", 1234
    worker, publications = [], []
    for prediction in range(2):
        worker.append(dict(ok=True, token=token, pid=pid, prediction=prediction, timestamp_us=0,
            stage_ownership={"renderer": "native-owned-clone-required"}, result=dict(
                schema="face-live-candidate-result-v1", source_key=source_key, prediction=prediction,
                frame_number=prediction, timestamp_us=0, algorithm_width=640, algorithm_height=640,
                heads={}, faces=[dict(id=0, points=[[(index + prediction) / 200, 0.9 - index / 200]
                                                  for index in range(106)])])))
        owned = 0x20000 + prediction * 0x10000
        publications.append(dict(event="live_makeup_publication", prediction=prediction, timestamp_us=0,
            binding_id=prediction + 1, graph_id=1, graph=0x8000, source_buffer=0x10000, source_base=0x12000,
            source_points=0x14000, owned_buffer=owned, owned_base=owned + 0x2000, owned_points=owned + 0x4000,
            thread=52, face_id=0, faces=1, candidate_injected=True, renderer_consumption=False))
    records = []
    for prediction in range(2):
        records.extend([
            dict(event="live_render_stage_begin", stage="initializing" if prediction == 0 else "rendering",
                 timestamp_us=0, renderer_consumption=False),
            dict(event="live_candidate_received", prediction=prediction, timestamp_us=0),
            publications[prediction],
            dict(event="live_makeup_update_exit", prediction=prediction, timestamp_us=0, renderer_consumption=False),
            dict(event="live_owned_rollback", prediction=prediction, timestamp_us=0, binding_id=prediction + 1,
                 graph_id=1, gpu_complete=True, original_restored=True),
        ])
        if prediction == 0:
            records.extend([
                dict(event="live_render_stage_complete", stage="initializing", prediction=0, timestamp_us=0,
                     source_restored=True, renderer_consumption=False),
                dict(event="live_feature_parameters_applied", prediction=0, timestamp_us=0, result=0,
                     renderer_consumption=False),
                dict(event="live_initialization_output_suppressed", prediction=0, timestamp_us=0,
                     renderer_consumption=False),
            ])
    events, publication = [], publications[1]
    for pass_index in range(passes):
        for index, pair in enumerate(worker[1]["result"]["faces"][0]["points"]):
            bits = list(struct.unpack("<2I", struct.pack("<2f", *pair)))
            events.append(dict(prediction=1, thread=52, binding_id=2, graph_id=1, graph=0x8000,
                base=publication["owned_base"], points_begin=publication["owned_points"],
                source_address=publication["owned_points"] + index * 8, point_index=index, face_id=0,
                width=width, height=height, loaded_bits=bits[:], memory_bits=bits[:],
                caller_offset=(0x9EB7BC, 0x9EB9C4)[pass_index % 2], observation="post-load-source-xy",
                renderer_consumption=False))
    observer = dict(passed=True, pid=pid, predictions=2, failures=[], observer_failures=[], unexpected_stops=[],
        target_memory_written=False, software_breakpoints_used=False, target_functions_evaluated=False,
        point_trace=dict(hits=len(events), events=events, target_memory_written=False, renderer_consumption=False))
    return dict(worker=worker, observer=observer, records=records, token=token, source_key=source_key)


def replaced(*, data, path, value):
    changed = copy.deepcopy(data)
    parent = changed
    for key in path[:-1]:
        parent = parent[key]
    parent[path[-1]] = value
    return changed


class PointAuditTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture()

    def reject_values(self, *, path, values):
        for value in values:
            with self.subTest(path=path, value=value), self.assertRaises(ValueError):
                audit(**replaced(data=self.data, path=path, value=value))

    def test_complete_single_and_multiple_passes_have_narrow_proof(self):
        for passes in (1, 2, 8):
            data = fixture(passes=passes)
            original = copy.deepcopy(data)
            proof = audit(**data)
            with self.subTest(passes=passes):
                self.assertEqual(data, original)
                for key, value in dict(point_count=106, read_count=106 * passes, pass_count=passes,
                        binding_id=2, graph_id=1, prediction=1, predictions=2, timestamp_us=0, native_pid=1234).items():
                    self.assertEqual(proof[key], value)
                self.assertIs(proof["candidate_xy_reads_verified"], True)
                for key in ("renderer_consumption", "product_parity_verified", "pipeline_acceptance",
                            "extra_points_verified", "target_memory_written"):
                    self.assertIs(proof[key], False)
                self.assertNotIn("live_owned_conversion", str(proof))
                self.assertNotIn(data["token"], str(proof))

    def test_geometry_is_consistent_not_assumed_to_be_algorithm_size(self):
        for width, height in ((1, 4096), (1280, 720)):
            proof = audit(**fixture(width=width, height=height))
            self.assertEqual((proof["width"], proof["height"]), (width, height))
        for row in self.data["worker"]:
            row["result"].update(algorithm_width=800, algorithm_height=480)
        self.assertIs(audit(**self.data)["candidate_xy_reads_verified"], True)

    def test_diagnostics_and_inspection_are_not_consumption(self):
        self.data["records"].insert(6, dict(event="live_inspection_conversion", prediction=0,
            timestamp_us=0, candidate_injected=False, renderer_consumption=False))
        self.data["records"].insert(2, dict(diagnostic="native setup"))
        self.assertIs(audit(**self.data)["renderer_consumption"], False)

    def test_worker_session_pid_and_result_associations(self):
        for key in ("token", "source_key"):
            self.reject_values(path=(key,), values=(None, "", True, "foreign"))
        for prediction in range(2):
            row = ("worker", prediction)
            for key, values in dict(ok=(False, 1, None), token=("foreign", None), pid=(0, 999, True),
                    prediction=(1 - prediction, False, 2), timestamp_us=(1, False)).items():
                self.reject_values(path=(*row, key), values=values)
            for key, values in dict(schema=("foreign", None), source_key=("foreign", None),
                    prediction=(1 - prediction, True), frame_number=(1 - prediction, False),
                    timestamp_us=(1, False), algorithm_width=(0, True, 4097, 639),
                    algorithm_height=(0, False, 4097)).items():
                self.reject_values(path=(*row, "result", key), values=values)

    def test_worker_shapes_and_all_candidate_coordinates(self):
        self.reject_values(path=("worker",), values=(None, {}, self.data["worker"][:1], self.data["worker"] * 2))
        for prediction in range(2):
            root = ("worker", prediction)
            self.reject_values(path=root, values=(None, [], 0))
            self.reject_values(path=(*root, "result"), values=(None, [], 0))
            faces = (*root, "result", "faces")
            self.reject_values(path=faces, values=(None, [], [None], [{}, {}]))
            self.reject_values(path=(*faces, 0, "id"), values=(True, 1, -1))
            points = (*faces, 0, "points")
            self.reject_values(path=points, values=(None, [], [[0, 0]] * 105, [[0, 0]] * 107))
            self.reject_values(path=(*points, 0), values=(None, [0], [0, 0, 0], (0, 0)))
            for axis in (0, 1):
                self.reject_values(path=(*points, 105, axis), values=(float("nan"), float("inf"),
                    float("-inf"), True, -0.1, 1.001, "0.5", None, 10**1000))

    def test_failed_observer_and_readonly_claims(self):
        self.reject_values(path=("observer",), values=(None, [], 0))
        for key, values in dict(passed=(False, 1, None), pid=(0, -1, True, 2**31, 999),
                predictions=(0, 1, 3, 2.0, True), failures=(["failed"], None, ()),
                observer_failures=(["failed"], None, ()), unexpected_stops=(["failed"], None, ())).items():
            self.reject_values(path=("observer", key), values=values)
        for key in ("target_memory_written", "software_breakpoints_used", "target_functions_evaluated"):
            self.reject_values(path=("observer", key), values=(True, 0, None))
        self.reject_values(path=("observer", "point_trace"), values=(None, [], 0))
        for key in ("target_memory_written", "renderer_consumption"):
            self.reject_values(path=("observer", "point_trace", key), values=(True, 0, None))

    def test_missing_observer_safety_receipts_are_rejected(self):
        for key in ("target_memory_written", "software_breakpoints_used", "target_functions_evaluated",
                    "unexpected_stops", "failures", "observer_failures"):
            data = copy.deepcopy(self.data)
            data["observer"].pop(key)
            with self.subTest(key=key), self.assertRaises(ValueError):
                audit(**data)

    def test_count_budget_and_incomplete_passes(self):
        trace = ("observer", "point_trace")
        self.reject_values(path=(*trace, "hits"), values=(0, 105, 107, 849, True, 106.0, None))
        self.reject_values(path=(*trace, "events"), values=(None, {}, []))
        for length in (1, 105, 107, 211, 849, 954):
            data = fixture(passes=9)
            events = data["observer"]["point_trace"]
            events.update(events=events["events"][:length], hits=length)
            with self.subTest(length=length), self.assertRaises(ValueError):
                audit(**data)

    def test_point_order_and_prediction_zero_misattribution(self):
        for positions in ((0, 1), (104, 105), (0, 106)):
            data = fixture(passes=2)
            events = data["observer"]["point_trace"]["events"]
            left, right = positions
            events[left], events[right] = events[right], events[left]
            with self.subTest(positions=positions), self.assertRaises(ValueError):
                audit(**data)
        data = fixture()
        publication = data["records"][2]
        for event in data["observer"]["point_trace"]["events"]:
            event.update(prediction=0, binding_id=1, base=publication["owned_base"],
                         points_begin=publication["owned_points"],
                         source_address=publication["owned_points"] + event["point_index"] * 8)
        with self.assertRaises(ValueError):
            audit(**data)

    def test_every_event_field_required_and_no_unauthored_fields(self):
        events = self.data["observer"]["point_trace"]["events"]
        self.reject_values(path=("observer", "point_trace", "events", 0), values=(None, [], 0))
        for key in events[0]:
            data = copy.deepcopy(self.data)
            data["observer"]["point_trace"]["events"][0].pop(key)
            with self.subTest(key=key), self.assertRaises(ValueError):
                audit(**data)
        self.reject_values(path=("observer", "point_trace", "events", 0, "timestamp_us"), values=(0,))

    def test_point_context_and_typed_integer_fields(self):
        root = ("observer", "point_trace", "events", 0)
        event = self.data["observer"]["point_trace"]["events"][0]
        for key, value in event.items():
            if type(value) is int:
                self.reject_values(path=(*root, key), values=(True, False, float(value), None, -1))
        for key in ("prediction", "thread", "binding_id", "graph_id", "graph", "base", "points_begin",
                    "source_address", "point_index", "face_id", "width", "height", "caller_offset"):
            self.reject_values(path=(*root, key), values=(event[key] + 1,))
        for key in ("width", "height"):
            self.reject_values(path=(*root, key), values=(0, 4097))
        self.reject_values(path=(*root, "observation"), values=("pre-load-source-xy", None))
        self.reject_values(path=(*root, "renderer_consumption"), values=(True, 0))

    def test_float32_bits_exact_in_registers_and_memory(self):
        root = ("observer", "point_trace", "events", 0)
        for key in ("loaded_bits", "memory_bits"):
            self.reject_values(path=(*root, key), values=(None, [], [0], [0, 0, 0], [0, 0]))
            for axis in (0, 1):
                value = self.data["observer"]["point_trace"]["events"][0][key][axis]
                self.reject_values(path=(*root, key, axis), values=(True, -1, 2**32, float(value),
                    value + 1, 0x7FC00000, 0x7F800000))
        self.data["worker"][1]["result"]["faces"][0]["points"][0] = [1e-50, -0.0]
        event = self.data["observer"]["point_trace"]["events"][0]
        event.update(loaded_bits=[0, 0x80000000], memory_bits=[0, 0x80000000])
        self.assertIs(audit(**self.data)["candidate_xy_reads_verified"], True)
        event["loaded_bits"][1] = 0
        with self.assertRaises(ValueError):
            audit(**self.data)

    def test_missing_duplicate_reordered_host_records(self):
        for index in range(len(self.data["records"])):
            for operation in ("missing", "duplicate", "swap"):
                data = copy.deepcopy(self.data)
                rows = data["records"]
                if operation == "missing":
                    rows.pop(index)
                elif operation == "duplicate":
                    rows.insert(index, copy.deepcopy(rows[index]))
                else:
                    other = (index + 1) % len(rows)
                    rows[index], rows[other] = rows[other], rows[index]
                with self.subTest(index=index, operation=operation), self.assertRaises(ValueError):
                    audit(**data)

    def test_host_time_stage_parameters_restore_and_context(self):
        self.reject_values(path=("records",), values=(None, {}, [], [{}] * 4097))
        for index, row in enumerate(self.data["records"]):
            self.reject_values(path=("records", index), values=(None, [], 0))
            self.reject_values(path=("records", index, "event"), values=([], {}, True))
            self.reject_values(path=("records", index, "timestamp_us"), values=(False, 1, None))
            self.reject_values(path=("records", index, "thread"), values=(999, True))
            for key in row:
                if type(row[key]) is bool:
                    self.reject_values(path=("records", index, key), values=(not row[key], int(row[key]), None))
                elif type(row[key]) is int:
                    self.reject_values(path=("records", index, key), values=(True, float(row[key]), None, -1))
        for index, key, value in ((0, "stage", "rendering"), (8, "stage", "initializing"),
                (5, "stage", "rendering"), (6, "result", 1), (4, "binding_id", 2),
                (12, "binding_id", 1), (12, "graph_id", 2), (10, "thread", 999), (10, "graph", 0x9000)):
            self.reject_values(path=("records", index, key), values=(value,))

    def test_publication_fields_required(self):
        for index in (2, 10):
            for key in self.data["records"][index]:
                data = copy.deepcopy(self.data)
                data["records"][index].pop(key)
                with self.subTest(index=index, key=key), self.assertRaises(ValueError):
                    audit(**data)

    def test_owned_addresses_never_alias_sources_or_other_predictions(self):
        fields = ("buffer", "base", "points")
        for index in (2, 10):
            for field in fields:
                key = f"owned_{field}"
                aliases = {self.data["records"][other][f"{owner}_{part}"] for other in (2, 10)
                           for owner in ("source", "owned") for part in fields}
                aliases.discard(self.data["records"][index][key])
                self.reject_values(path=("records", index, key), values=(*aliases, 0, 1, 2**64))
        for offset in (-8, 8):
            self.reject_values(path=("records", 2, "owned_points"),
                               values=(0x14000 + offset, 0x34000 + offset, 2**64 - 8))

    def test_inspection_conversion_cannot_replace_a_required_publication(self):
        self.reject_values(path=("records", 10, "event"), values=("live_inspection_conversion",))
        for kind in ("live_owned_conversion", "live_owned_restored"):
            data = copy.deepcopy(self.data)
            data["records"].append(dict(event=kind))
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                audit(**data)

    def test_no_consumption_or_parity_claim_is_promoted(self):
        for root in (("worker", 0), ("worker", 1, "result"), ("observer",),
                     ("observer", "point_trace"), ("records", 0)):
            for key in ("renderer_consumption", "product_parity_verified", "pipeline_acceptance"):
                self.reject_values(path=(*root, key), values=(True, 1, None))


if __name__ == "__main__":
    unittest.main()
