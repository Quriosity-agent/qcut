"""Synthetic stdlib-only CPU receipts; no native execution or pixel-parity proof."""
from __future__ import annotations

import copy
import struct
import unittest
from unittest import mock

import face_live_makeup_render_audit as render_audit
from face_live_makeup_point_audit_test import fixture as point_fixture, replaced
from face_live_makeup_render_audit import audit


def float32(*, value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def conversion_bits(*, source_bits, width, height):
    destination = []
    for pair in source_bits:
        x, y = struct.unpack("<2f", struct.pack("<2I", *pair))
        scaled_x = float32(value=x * width)
        flipped_y = float32(value=height - float32(value=y * height))
        destination.append(list(struct.unpack("<2I", struct.pack("<2f", scaled_x, flipped_y))))
    return destination


def fixture(*, width=640, height=640):
    data = point_fixture(width=width, height=height)
    rows = data["records"]
    publication = rows[10]
    context = dict(prediction=1, timestamp_us=0, binding_id=2, graph_id=1)
    points = data["worker"][1]["result"]["faces"][0]["points"]
    source_bits = [list(struct.unpack("<2I", struct.pack("<2f", *pair))) for pair in points]
    geometry = dict(event="live_makeup_geometry_enter", **context, graph=publication["graph"],
        thread=publication["thread"], object=0x50000, source_base=publication["owned_base"],
        source_points=publication["owned_points"], destination_base=0x60000, destination_points=0x62000,
        caller_offset=0x9EBA4C, process_offset=0xA0BB54, face_id=0, width=width, height=height,
        source_bits=source_bits, destination_bits=conversion_bits(source_bits=source_bits, width=width, height=height),
        renderer_consumption=False)
    complete = dict(event="live_makeup_geometry_complete", **context, thread=publication["thread"],
        object=geometry["object"], native_returned=True, source_points_unchanged=True, renderer_consumption=False)
    conversion = dict(event="live_makeup_conversion", **context, native_returned=True,
                      source_points_unchanged=True, renderer_consumption=True)
    rows[-1]["event"] = "live_owned_restored"
    rows[11:11] = [geometry, complete, conversion]
    rows.append(dict(event="live_render_stage_complete", stage="rendering", prediction=1, timestamp_us=0,
                     source_restored=True, renderer_consumption=True))
    return data


class RenderAuditTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture()

    def reject_values(self, *, path, values):
        for value in values:
            with self.subTest(path=path, value=value), self.assertRaises(ValueError):
                audit(**replaced(data=self.data, path=path, value=value))

    def test_complete_receipts_are_narrow_and_inputs_unchanged(self):
        original = copy.deepcopy(self.data)
        proof = audit(**self.data)
        self.assertEqual(self.data, original)
        self.assertEqual(proof["schema"], "face-live-makeup-render-audit-v1")
        for key, value in dict(point_count=106, read_count=106, pass_count=1, conversions=1, restorations=1,
                initialization_publications=1, native_pid=1234, predictions=2, prediction=1, timestamp_us=0,
                binding_id=2, graph_id=1, graph=0x8000, thread=52, face_id=0, width=640, height=640).items():
            self.assertEqual(proof[key], value)
        for key in ("candidate_xy_reads_verified", "geometry_conversion_verified", "renderer_consumption"):
            self.assertIs(proof[key], True)
        for key in ("initialization_rendered", "product_parity_verified", "extra_points_verified",
                    "pipeline_acceptance", "target_memory_written"):
            self.assertIs(proof[key], False)
        for private in (self.data["token"], self.data["source_key"], "source_bits", "destination_bits", "rgba"):
            self.assertNotIn(private, str(proof))

    def test_reuses_helpers_with_original_objects_never_old_audit(self):
        helpers = render_audit.point_audit
        with mock.patch.object(helpers, "audit", side_effect=AssertionError("rollback audit called")), \
                mock.patch.object(helpers, "worker_points", wraps=helpers.worker_points) as worker, \
                mock.patch.object(helpers, "validate_publication", wraps=helpers.validate_publication) as publication, \
                mock.patch.object(helpers, "validate_isolation", wraps=helpers.validate_isolation) as isolation, \
                mock.patch.object(helpers, "point_reads", wraps=helpers.point_reads) as reads, \
                mock.patch.object(render_audit.conversion_math, "audit_conversion",
                                  wraps=render_audit.conversion_math.audit_conversion) as conversion:
            audit(**self.data)
        self.assertIs(worker.call_args.kwargs["worker"], self.data["worker"])
        self.assertEqual(publication.call_count, 2)
        for call, index in zip(publication.call_args_list, (2, 10), strict=True):
            self.assertIs(call.kwargs["row"], self.data["records"][index])
        self.assertIs(isolation.call_args.kwargs["published"][1], self.data["records"][10])
        self.assertIs(reads.call_args.kwargs["trace"], self.data["observer"]["point_trace"])
        self.assertIs(conversion.call_args.kwargs["source_bits"], self.data["records"][11]["source_bits"])

    def test_dimensions_follow_trace_not_worker_size(self):
        for width, height in ((1, 4096), (1280, 720), (4096, 1), (3, 7)):
            with self.subTest(width=width, height=height):
                data = fixture(width=width, height=height)
                for row in data["worker"]:
                    row["result"].update(algorithm_width=800, algorithm_height=480)
                proof = audit(**data)
                self.assertEqual((proof["width"], proof["height"]), (width, height))

    def test_diagnostics_are_not_consumption_and_rgba_is_not_compared(self):
        self.data["records"].insert(6, dict(event="live_inspection_conversion", prediction=0,
            timestamp_us=0, candidate_injected=False, renderer_consumption=False))
        self.data["records"].append(dict(event="live_inspection_conversion", prediction=1,
            timestamp_us=0, candidate_injected=False, renderer_consumption=False))
        self.data["records"].insert(2, dict(diagnostic="setup"))
        for prediction, row in enumerate(self.data["worker"]):
            row["result"]["algorithm_rgba_sha256"] = str(prediction) * 64
        self.assertIs(audit(**self.data)["renderer_consumption"], True)

    def test_observer_safety_and_session_identity(self):
        self.reject_values(path=("observer",), values=(None, [], 0))
        for key, values in dict(passed=(False, 1, None), pid=(0, -1, True, 2**31, 999),
                predictions=(0, 1, 3, 2.0, True), failures=(["failed"], None, ()),
                observer_failures=(["failed"], None, ()), unexpected_stops=(["failed"], None, ()),
                target_memory_written=(True, 0, None), software_breakpoints_used=(True, 0, None),
                target_functions_evaluated=(True, 0, None)).items():
            self.reject_values(path=("observer", key), values=values)
            data = copy.deepcopy(self.data)
            data["observer"].pop(key)
            with self.subTest(missing=key), self.assertRaises(ValueError):
                audit(**data)
        for key in ("token", "source_key"):
            self.reject_values(path=(key,), values=(None, "", True, "foreign"))

    def test_two_cold_workers_and_normalized_points(self):
        self.reject_values(path=("worker",), values=(None, {}, [], self.data["worker"][:1], self.data["worker"] * 2))
        for prediction in range(2):
            root = ("worker", prediction)
            self.reject_values(path=root, values=(None, [], 0))
            for key, values in dict(ok=(False, 1), token=("foreign", None), pid=(999, True),
                    prediction=(1 - prediction, False), timestamp_us=(1, False)).items():
                self.reject_values(path=(*root, key), values=values)
            result = (*root, "result")
            self.reject_values(path=result, values=(None, [], 0))
            for key, values in dict(schema=("foreign", None), source_key=("foreign", None),
                    prediction=(1 - prediction, True), frame_number=(1 - prediction, False), timestamp_us=(1, False),
                    algorithm_width=(0, True, 4097, 639), algorithm_height=(0, False, 4097)).items():
                self.reject_values(path=(*result, key), values=values)
            faces = (*result, "faces")
            self.reject_values(path=faces, values=(None, [], [None], [{}, {}]))
            self.reject_values(path=(*faces, 0, "id"), values=(True, 1, -1))
            points = (*faces, 0, "points")
            self.reject_values(path=points, values=(None, [], [[0, 0]] * 105, [[0, 0]] * 107))
            self.reject_values(path=(*points, 0), values=(None, [0], [0, 0, 0], (0, 0)))
            for axis in (0, 1):
                self.reject_values(path=(*points, 105, axis), values=(float("nan"), float("inf"),
                    float("-inf"), True, -0.1, 1.001, "0.5", None, 10**1000))

    def test_every_missing_duplicate_and_reordered_lifecycle_event(self):
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

    def test_legacy_rollback_and_inspection_cannot_replace_final_consumption(self):
        for index in (11, 12, 13, 15):
            self.reject_values(path=("records", index, "event"),
                               values=("live_owned_conversion", "live_inspection_conversion", "live_owned_rollback"))
        self.data["records"].append(dict(event="live_owned_conversion"))
        with self.assertRaises(ValueError):
            audit(**self.data)
        with self.assertRaises(ValueError):
            audit(**point_fixture())

    def test_host_shape_timestamps_predictions_and_all_optional_context(self):
        self.reject_values(path=("records",), values=(None, {}, [], [{}] * 4097))
        for index, (_, prediction) in enumerate(render_audit.LIFECYCLE):
            self.reject_values(path=("records", index), values=(None, [], 0))
            self.reject_values(path=("records", index, "event"), values=([], {}, True))
            self.reject_values(path=("records", index, "timestamp_us"), values=(False, 1, None))
            self.reject_values(path=("records", index, "prediction"), values=(1 - prediction, False, 2, None))
            publication = self.data["records"][2 if prediction == 0 else 10]
            for key in render_audit.CONTEXT_FIELDS:
                self.reject_values(path=("records", index, key), values=(publication[key] + 1, True, None))
            row = self.data["records"][index]
            for key, value in row.items():
                if type(value) is bool:
                    self.reject_values(path=("records", index, key), values=(not value, int(value), None))
                elif type(value) is int:
                    self.reject_values(path=("records", index, key), values=(True, float(value), None, -1))

    def test_stage_names_parameters_and_restoration(self):
        for index in (0, 5, 8, 16):
            stage = self.data["records"][index]["stage"]
            self.reject_values(path=("records", index, "stage"),
                               values=("rendering" if stage == "initializing" else "initializing", None, ""))
        self.reject_values(path=("records", 6, "result"), values=(1, False, "0", None))
        for index, keys in ((4, ("gpu_complete", "original_restored")),
                            (15, ("gpu_complete", "original_restored")),
                            (5, ("source_restored",)), (16, ("source_restored",)),
                            (12, ("native_returned", "source_points_unchanged")),
                            (13, ("native_returned", "source_points_unchanged"))):
            for key in keys:
                data = copy.deepcopy(self.data)
                data["records"][index].pop(key)
                with self.subTest(index=index, missing=key), self.assertRaises(ValueError):
                    audit(**data)

    def test_required_publication_geometry_and_completion_fields(self):
        for index in (2, 10, 11, 12, 13):
            for key in self.data["records"][index]:
                data = copy.deepcopy(self.data)
                data["records"][index].pop(key)
                with self.subTest(index=index, missing=key), self.assertRaises(ValueError):
                    audit(**data)
        for index in (4, 15):
            for key in ("binding_id", "graph_id"):
                data = copy.deepcopy(self.data)
                data["records"][index].pop(key)
                with self.subTest(index=index, missing=key), self.assertRaises(ValueError):
                    audit(**data)

    def test_consumption_flags_have_exactly_two_true_receipts(self):
        for index in (1, 4, 9, 15):
            self.reject_values(path=("records", index, "renderer_consumption"), values=(True, 0, None))
        for index, row in enumerate(self.data["records"]):
            if "renderer_consumption" not in row:
                continue
            data = copy.deepcopy(self.data)
            data["records"][index].pop("renderer_consumption")
            with self.subTest(missing=index), self.assertRaises(ValueError):
                audit(**data)
        for kind in ("live_inspection_conversion", "live_makeup_update_enter", "live_unknown"):
            for value in (True, 0, None):
                data = copy.deepcopy(self.data)
                data["records"].append(dict(event=kind, renderer_consumption=value))
                with self.subTest(kind=kind, value=value), self.assertRaises(ValueError):
                    audit(**data)

    def test_no_parity_or_pipeline_promotion(self):
        for root in (("worker", 0), ("worker", 1, "result"), ("observer",),
                     ("observer", "point_trace"), *(("records", index) for index in range(17))):
            for key in ("product_parity_verified", "pipeline_acceptance"):
                self.reject_values(path=(*root, key), values=(True, 1, None))
        for root in (("worker", 0), ("worker", 1, "result"), ("observer",), ("observer", "point_trace")):
            self.reject_values(path=(*root, "renderer_consumption"), values=(True, 0, None))

    def test_owned_storage_isolation_across_both_publications(self):
        for index in (2, 10):
            for owner in ("source", "owned"):
                for field in ("buffer", "base", "points"):
                    key = f"{owner}_{field}"
                    self.reject_values(path=("records", index, key), values=(0, True, 2**64))
            for field in ("buffer", "base", "points"):
                key = f"owned_{field}"
                aliases = {self.data["records"][other][f"{owner}_{part}"] for other in (2, 10)
                           for owner in ("source", "owned") for part in ("buffer", "base", "points")}
                aliases.discard(self.data["records"][index][key])
                self.reject_values(path=("records", index, key), values=aliases)
        for offset in (-8, 8):
            self.reject_values(path=("records", 2, "owned_points"),
                               values=(0x14000 + offset, 0x34000 + offset, 2**64 - 8))

    def test_destination_aliases_and_full_vector_spans(self):
        addresses = {row[f"{owner}_{field}"] for row in (self.data["records"][2], self.data["records"][10])
                     for owner in ("source", "owned") for field in ("buffer", "base", "points")}
        addresses.update((0x8000, 0x50000))
        for key in ("destination_base", "destination_points"):
            self.reject_values(path=("records", 11, key), values=(*addresses, 0, 4095, True, 2**64))
        self.reject_values(path=("records", 11, "destination_points"), values=(0x60000, 2**64 - 8))
        self.reject_values(path=("records", 11, "destination_base"), values=(0x62000, 0x62008, 0x6234F))
        for address in addresses:
            self.reject_values(path=("records", 11, "destination_points"), values=(address - 8, address - 847))
        for begin in (0x14000, 0x24000, 0x34000):
            for offset in (1, 8, 847):
                for key in ("destination_base", "destination_points"):
                    self.reject_values(path=("records", 11, key), values=(begin + offset,))

    def test_adjacent_nonoverlapping_destination_is_valid(self):
        self.data["records"][11]["destination_points"] = 0x34000 + 106 * 8
        self.assertIs(audit(**self.data)["geometry_conversion_verified"], True)

    def test_geometry_addresses_object_offsets_and_dimension_context(self):
        geometry = self.data["records"][11]
        for key in ("source_base", "source_points", "caller_offset", "process_offset", "width", "height"):
            self.reject_values(path=("records", 11, key), values=(geometry[key] + 1, None))
        for key in ("width", "height"):
            self.reject_values(path=("records", 11, key), values=(0, 4097, True))
        self.reject_values(path=("records", 11, "object"), values=(0, 4096, True, 2**64))
        self.reject_values(path=("records", 12, "object"), values=(0x50008, None, True))
        for index in (13, 15):
            self.reject_values(path=("records", index, "object"), values=(0x50008, None, True))
        self.reject_values(path=("records", 11, "source_base"), values=(0x12000, 0x22000))
        self.reject_values(path=("records", 11, "source_points"), values=(0x14000, 0x24000))

    def test_trace_requires_exactly_one_pass(self):
        trace = ("observer", "point_trace")
        self.reject_values(path=trace, values=(None, [], 0))
        for key in ("target_memory_written", "renderer_consumption"):
            self.reject_values(path=(*trace, key), values=(True, 0, None))
        self.reject_values(path=(*trace, "hits"), values=(0, 105, 107, 212, True, 106.0, None))
        self.reject_values(path=(*trace, "events"), values=(None, {}, []))
        for length in (1, 105, 107, 212, 848, 954):
            data = fixture()
            point_trace = data["observer"]["point_trace"]
            point_trace.update(events=(point_trace["events"] * 9)[:length], hits=length)
            with self.subTest(length=length), self.assertRaises(ValueError):
                audit(**data)

    def test_trace_order_and_every_context_field(self):
        root = ("observer", "point_trace", "events", 0)
        event = self.data["observer"]["point_trace"]["events"][0]
        self.reject_values(path=root, values=(None, [], 0))
        for key, value in event.items():
            data = copy.deepcopy(self.data)
            data["observer"]["point_trace"]["events"][0].pop(key)
            with self.subTest(missing=key), self.assertRaises(ValueError):
                audit(**data)
            if type(value) is int:
                self.reject_values(path=(*root, key), values=(value + 1, True, float(value), None, -1))
        self.reject_values(path=(*root, "timestamp_us"), values=(0,))
        self.reject_values(path=(*root, "observation"), values=("pre-load-source-xy", None))
        self.reject_values(path=(*root, "renderer_consumption"), values=(True, 0))
        for left, right in ((0, 1), (104, 105)):
            data = copy.deepcopy(self.data)
            events = data["observer"]["point_trace"]["events"]
            events[left], events[right] = events[right], events[left]
            with self.subTest(left=left, right=right), self.assertRaises(ValueError):
                audit(**data)

    def test_bits_exact_shape_words_and_float32_values(self):
        for key in ("source_bits", "destination_bits"):
            root = ("records", 11, key)
            self.reject_values(path=root, values=(None, {}, [], [[0, 0]] * 105, [[0, 0]] * 107))
            self.reject_values(path=(*root, 105), values=(None, (0, 0), [], [0], [0, 0, 0]))
            for axis in (0, 1):
                value = self.data["records"][11][key][105][axis]
                self.reject_values(path=(*root, 105, axis), values=(True, -1, 2**32, float(value),
                    value + 1, 0x7FC00000, 0x7F800000, 0xFF800000))
        for key in ("loaded_bits", "memory_bits"):
            root = ("observer", "point_trace", "events", 105, key)
            self.reject_values(path=root, values=(None, [], [0], [0, 0, 0], [0, 0]))
            for axis in (0, 1):
                value = self.data["observer"]["point_trace"]["events"][105][key][axis]
                self.reject_values(path=(*root, axis), values=(True, -1, 2**32, float(value), value + 1))

    def test_self_consistent_math_cannot_forge_candidate_provenance(self):
        for changed_source in ("different", "reordered"):
            data = copy.deepcopy(self.data)
            geometry = data["records"][11]
            if changed_source == "different":
                geometry["source_bits"][0] = [0, 0]
            else:
                geometry["source_bits"].reverse()
            geometry["destination_bits"] = conversion_bits(source_bits=geometry["source_bits"], width=640, height=640)
            with self.subTest(changed_source=changed_source), self.assertRaises(ValueError):
                audit(**data)
            for event, pair in zip(data["observer"]["point_trace"]["events"], geometry["source_bits"], strict=True):
                event.update(loaded_bits=pair[:], memory_bits=pair[:])
            with self.subTest(forged_loads=changed_source), self.assertRaises(ValueError):
                audit(**data)

    def test_float32_rounding_signed_zero_and_endpoints(self):
        data = fixture(width=3, height=7)
        pairs = ([1e-50, -0.0], [1.0, 1.0], [0.0, 0.0], [-0.0, 0.1], [0.3, 0.7])
        geometry = data["records"][11]
        for index, pair in enumerate(pairs):
            data["worker"][1]["result"]["faces"][0]["points"][index] = pair
            bits = list(struct.unpack("<2I", struct.pack("<2f", *pair)))
            geometry["source_bits"][index] = bits[:]
            data["observer"]["point_trace"]["events"][index].update(loaded_bits=bits[:], memory_bits=bits[:])
        geometry["destination_bits"] = conversion_bits(source_bits=geometry["source_bits"], width=3, height=7)
        self.assertIs(audit(**data)["geometry_conversion_verified"], True)
        geometry["source_bits"][0][1] = 0
        with self.assertRaises(ValueError):
            audit(**data)


if __name__ == "__main__":
    unittest.main()
