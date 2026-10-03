"""Synthetic actual-host tensor and head-pairing guards, no native model files."""

import argparse
from copy import deepcopy
import hashlib
import importlib.machinery
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

import face_render_model_parity as probe
from face_render_model_parity_guard_test import torch_free_modules


def tensor_record(*, name="data", inference=0, dims=None, raw=None, path="/synthetic.bin", sha256="0" * 64):
    return dict(name=name, inference=inference, dims_nwhc=dims if dims is not None else [1, 1, 1, 3],
                raw=raw if raw is not None else [4, 0], path=path, sha256=sha256)


def graph_text(*, size=120):
    return "\n".join(["1 6", f"DataV2 data 1 {size} {size} 3 {2 if size == 120 else 1} 6",
                      "PoolingDown pool 1 1 1 1 0 0 4 0 AVE data pooled GLOBAL",
                      *(f"Sigmoid layer-{index} pooled head-{index} 4 0" for index in range(5))])


def network_record(*, size=120):
    names = [f"head-{index}" for index in range(5)]
    return dict(graph_path="/graph.txt", graph_sha256=hashlib.sha256(graph_text(size=size).encode()).hexdigest(),
                declared_outputs=[*names, ""], successful_inferences=[0],
                inputs=[tensor_record(dims=[1, size, size, 3], raw=[2 if size == 120 else 1, 6])],
                outputs=[tensor_record(name=name) for name in names])


def capture_inventory():
    return dict(networks={"101": network_record()}, metadata_records=8, successful_inferences=1)


def capture_report():
    return dict(passed=True, native_analysis_bypassed=False, comparisons=[dict(equal=True) for _ in range(4)],
                captures=capture_inventory())


def export_report():
    return dict(passed=True, native_oracle_sha256=probe.espresso_oracle.RUNTIME_SHA256,
                float_policies={name: list(value) for name, value in probe.FLOAT_LIMITS.items()},
                artifacts={f"align-{size}/artifacts/model.onnx": "0" * 64 for size in (120, 160)},
                networks={str(size): dict(graph_sha256=network_record(size=size)["graph_sha256"],
                                         terminal_names=[f"head-{index}" for index in range(5)],
                                         cases={"recorded-face": {"input_sha256": {"data": "0" * 64}}})
                          for size in (120, 160)})


class TensorTests(unittest.TestCase):
    def test_nwhc_metadata_becomes_nhwc_without_channel_swapping(self):
        with tempfile.TemporaryDirectory() as directory:
            source = np.arange(24, dtype=np.int16).reshape(1, 2, 4, 3)
            path = Path(directory) / "tensor.bin"
            path.write_bytes(source.tobytes())
            item = dict(path=str(path), dims_nwhc=[1, 4, 2, 3], raw=[2, 6],
                        sha256=hashlib.sha256(source.tobytes()).hexdigest())
            actual = probe.load_tensor(item=item)
            np.testing.assert_array_equal(actual, source)
            actual[0, 0, 0, 0] = 99
            self.assertEqual(path.read_bytes(), source.tobytes())

    def test_all_storage_types_keep_original_values(self):
        with tempfile.TemporaryDirectory() as directory:
            for kind, dtype in ((1, np.int8), (2, np.int16), (4, np.float32)):
                source = np.array([-1, 0, 1], dtype=dtype).reshape(1, 1, 1, 3)
                path = Path(directory) / f"{kind}.bin"
                path.write_bytes(source.tobytes())
                item = dict(path=str(path), dims_nwhc=[1, 1, 1, 3], raw=[kind, 0],
                            sha256=hashlib.sha256(source.tobytes()).hexdigest())
                np.testing.assert_array_equal(probe.load_tensor(item=item), source)

    def test_truncation_hash_mismatch_and_nonfinite_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tensor.bin"
            for data, identity in ((b"\0", None), (b"\0" * 4, "a" * 64),
                                   (np.array([np.nan], np.float32).tobytes(), None)):
                path.write_bytes(data)
                item = dict(path=str(path), dims_nwhc=[1, 1, 1, 1], raw=[4, 0],
                            sha256=identity or hashlib.sha256(data).hexdigest())
                with self.subTest(data=data), self.assertRaises(ValueError):
                    probe.load_tensor(item=item)

    def test_unknown_or_unbounded_descriptor_is_rejected_before_io(self):
        for raw, dims in (([3, 0], [1, 1, 1, 1]), ([4, 0], [0, 1, 1, 1]),
                          ([4, 0], [1, 4096, 4096, 3]), ([True, 0], [1, 1, 1, 1]),
                          ([1, 25], [1, 1, 1, 1]), ([1, 0], [1, 1.0, 1, 1]),
                          ([1, 0], [1, False, 1, 1]), ([1, 0], [1, -1, -1, 1]),
                          ([1], [1, 1, 1, 1]), ([1, 0], [1, 1, 1])):
            with self.subTest(raw=raw, dims=dims), self.assertRaises(ValueError):
                probe.load_tensor(item=dict(path="/does-not-exist", raw=raw, dims_nwhc=dims))

    def test_malformed_fields_are_rejected_before_io(self):
        for field, values in (("path", (None, False, 0, [], {}, "", "bad\0path")),
                              ("sha256", (None, False, [], {}, "a" * 63, "g" * 64, "A" * 64)),
                              ("raw", (None, [], {}, "4,0", [4, False], [4.0, 0])),
                              ("dims_nwhc", (None, {}, "1,1,1,3", [True, 1, 1, 3]))):
            for value in values:
                with self.subTest(field=field, value=value), patch.object(probe, "bounded_bytes") as reader:
                    with self.assertRaises(ValueError):
                        probe.load_tensor(item={**tensor_record(), field: value})
                    reader.assert_not_called()
        for value in (None, [], True, "tensor", {}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.load_tensor(item=value)

    def test_oversized_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tensor.bin"
            data = b"\0" * 13
            path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, "byte limit"):
                probe.load_tensor(item=tensor_record(path=str(path), sha256=hashlib.sha256(data).hexdigest()))


class HeadTests(unittest.TestCase):
    def records(self):
        return [dict(name=f"head-{index}", inference=0, sha256=f"{index:064x}", raw=[4, 0],
                     dims_nwhc=[1, 1, 1, 1], path=f"/{index}.bin") for index in range(5)]

    def test_only_requested_inference_and_heads_are_selected(self):
        original = self.records()
        names = [item["name"] for item in original]
        unrelated = [dict(**original[0], extra=True), dict(original[0], inference=-1),
                     dict(original[0], name="data", inference=0)]
        result = probe.select_heads(outputs=[*original, *unrelated], inference=0, names=names)
        self.assertEqual(set(result), set(names))

    def test_equal_repeated_extraction_is_accepted(self):
        original = self.records()
        names = [item["name"] for item in original]
        result = probe.select_heads(outputs=[*original, dict(original[0], path="/repeat.bin")],
                                    inference=0, names=names)
        self.assertEqual(result[names[0]]["path"], "/repeat.bin")

    def test_repeated_head_cannot_change_hash_type_or_shape(self):
        original = self.records()
        names = [item["name"] for item in original]
        for key, value in (("sha256", "a" * 64), ("raw", [2, 0]), ("dims_nwhc", [1, 1, 1, 2])):
            changed = dict(original[0], **{key: value})
            with self.subTest(key=key), self.assertRaises(ValueError):
                probe.select_heads(outputs=[*original, changed], inference=0, names=names)

    def test_all_five_heads_required(self):
        original = self.records()
        for outputs, names in ((original[:4], [item["name"] for item in original]),
                               (original, [item["name"] for item in original[:4]]),
                               ([], [item["name"] for item in original])):
            with self.subTest(outputs=outputs), self.assertRaises(ValueError):
                probe.select_heads(outputs=outputs, inference=0, names=names)

    def test_completed_integer_inference_and_unique_heads_required(self):
        original = self.records()
        names = [item["name"] for item in original]
        for inference in (-1, False, 0.0):
            with self.subTest(inference=inference), self.assertRaises(ValueError):
                probe.select_heads(outputs=original, inference=inference, names=names)
        with self.assertRaises(ValueError):
            probe.select_heads(outputs=original, inference=0, names=[names[0]] * 5)

    def test_record_inference_must_not_alias_an_integer(self):
        original = self.records()
        names = [item["name"] for item in original]
        for value in (False, True, 0.0, "0", None, -2, 129):
            changed = [dict(original[0], inference=value), *original[1:]]
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.select_heads(outputs=changed, inference=0, names=names)

    def test_malformed_lists_names_and_unrelated_records_are_rejected(self):
        original = self.records()
        names = [item["name"] for item in original]
        for value in (None, {}, "heads", [None, *original]):
            with self.subTest(outputs=value), self.assertRaises(ValueError):
                probe.select_heads(outputs=value, inference=0, names=names)
        for value in (None, {}, "heads", [None, *names[1:]], [[], *names[1:]],
                      ["", *names[1:]], ["../escape", *names[1:]], [".", *names[1:]]):
            with self.subTest(names=value), self.assertRaises(ValueError):
                probe.select_heads(outputs=original, inference=0, names=value)
        for changes in ({"name": []}, {"raw": [4, False]}, {"dims_nwhc": [True, 1, 1, 1]}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                probe.select_heads(outputs=[*original, dict(original[0], inference=-1, **changes)],
                                   inference=0, names=names)


class ReportTests(unittest.TestCase):
    def test_typed_reports_and_inventory_are_accepted(self):
        captured, exported = capture_report(), export_report()
        self.assertEqual(probe.load_report(data=json.dumps(captured).encode()), captured)
        self.assertEqual(probe.load_report(data=b'{"nested":[{"value":1e308}]}'),
                         {"nested": [{"value": 1e308}]})
        probe.validate_capture(captured=captured)
        probe.validate_export(exported=exported)

    def test_json_objects_unique_fields_and_finite_numbers_required(self):
        for data in (b"null", b"[]", b"1", b'"report"', b'{"passed":false,"passed":true}',
                     b'{"model":{"raw":1,"raw":2}}', b'{"value":NaN}', b'{"value":Infinity}',
                     b'{"value":-Infinity}', b'{"value":1e999}', b'{"value":-1e999}',
                     b'{"nested":[{"value":1e999}]}', b'{"nested":[-1e999]}', b"{"):
            with self.subTest(data=data), self.assertRaises(ValueError):
                probe.load_report(data=data)

    def test_malformed_or_non_neutral_capture_is_rejected(self):
        for field, values in (("passed", (1, False, None)), ("native_analysis_bypassed", (0, True, None)),
                              ("comparisons", (None, {}, "xxxx", [], [dict(equal=True)] * 3,
                                               [True] * 4, [dict(equal=1)] * 4, [dict(equal=False)] * 4)),
                              ("captures", (None, [], {}, {**capture_inventory(), "successful_inferences": True}))):
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    probe.validate_capture(captured={**capture_report(), field: value})
        for value in (None, [], True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.validate_capture(captured=value)

    def test_malformed_export_descriptors_are_rejected(self):
        for field, values in (("passed", (1, False)), ("native_oracle_sha256", (None, "0" * 64)),
                              ("networks", (None, [], {}, {"120": {}}, {"120": None, "160": None})),
                              ("float_policies", (None, [], {}, {"Sigmoid": [0.1, 0.1, None]})),
                              ("artifacts", (None, [], {}))):
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    probe.validate_export(exported={**export_report(), field: value})
        for value in (None, [], True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.validate_export(exported=value)
        for field, values in (("graph_sha256", (None, "g" * 64)),
                              ("terminal_names", (None, ["head-0"] * 5, ["../escape", "a", "b", "c", "d"])),
                              ("cases", (None, [], {}, {"recorded-face": None},
                                         {"recorded-face": {"input_sha256": {"data": False}}},
                                         {"recorded-face": {"input_sha256": {"data": "0" * 64, "extra": "0" * 64}}}))):
            for value in values:
                exported = export_report()
                exported["networks"]["120"][field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    probe.validate_export(exported=exported)
        exported = export_report()
        exported["networks"]["160"]["graph_sha256"] = exported["networks"]["120"]["graph_sha256"]
        with self.assertRaisesRegex(ValueError, "distinct"):
            probe.validate_export(exported=exported)

    def test_policy_equality_cannot_hide_boolean_or_integer_values(self):
        for value in ([False, 0.0, None], [0, 0.0, None], [0.0, 0, None], [0.0, 0.0, False],
                      (0.0, 0.0, None), [0.0, 0.0], [0.0001, 0.0, None]):
            exported = export_report()
            exported["float_policies"]["PoolingDown"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.validate_export(exported=exported)


class InventoryTests(unittest.TestCase):
    def test_pre_inference_records_and_inactive_networks_are_valid(self):
        evidence = capture_inventory()
        network = evidence["networks"]["101"]
        network["inputs"].append(dict(network["inputs"][0], inference=-1))
        network["outputs"].append(dict(network["outputs"][0], inference=-1))
        evidence["networks"]["202"] = dict(network_record(size=160), successful_inferences=[], inputs=[], outputs=[])
        probe.validate_inventory(evidence=evidence)

    def test_malformed_inventory_counters_and_networks_are_rejected(self):
        for field, values in (("metadata_records", (True, 8.0, 0, 4097, None)),
                              ("successful_inferences", (True, 1.0, 0, 2, None)),
                              ("networks", (None, [], {}, {"0": network_record()},
                                            {True: network_record()}, {"101": None}))):
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    probe.validate_inventory(evidence={**capture_inventory(), field: value})
        for field, values in (("successful_inferences", (None, {}, [False], [0.0], [-1], [1], [0, 0], [0, 2])),
                              ("declared_outputs", (None, "head-0;", [], [None], ["head-0", "head-0", ""],
                                                    ["head-0", "", "head-1"])),
                              ("inputs", (None, {}, [], [None])), ("outputs", (None, {}, [None])),
                              ("graph_path", (None, "")), ("graph_sha256", (None, "wrong"))):
            for value in values:
                evidence = capture_inventory()
                evidence["networks"]["101"][field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    probe.validate_inventory(evidence=evidence)

    def test_duplicate_missing_and_uncompleted_inputs_are_rejected(self):
        network = network_record()
        for records in (network["inputs"] * 2, [dict(network["inputs"][0], inference=-1)],
                        [dict(network["inputs"][0], inference=1)], [dict(network["inputs"][0], inference=False)]):
            evidence = capture_inventory()
            evidence["networks"]["101"]["inputs"] = records
            with self.subTest(records=records), self.assertRaises(ValueError):
                probe.validate_inventory(evidence=evidence)
        evidence = capture_inventory()
        evidence["networks"]["101"]["outputs"][0]["inference"] = 1
        with self.assertRaisesRegex(ValueError, "successful inference"):
            probe.validate_inventory(evidence=evidence)


class GraphTests(unittest.TestCase):
    def check_graph(self, *, text=None, network=None, names=None, size=120):
        probe.validate_graph(graph=probe.analyze(text if text is not None else graph_text(size=size)), size=size,
                             names=names if names is not None else [f"head-{index}" for index in range(5)],
                             network=network if network is not None else network_record(size=size))

    def test_five_float_terminals_and_captured_storage_are_associated(self):
        for size in (120, 160):
            with self.subTest(size=size):
                self.check_graph(size=size)
        network = network_record()
        network["outputs"].append(tensor_record(name="pooled"))
        self.check_graph(network=network)

    def test_raw_input_extractions_are_valid_but_not_selected_as_heads(self):
        for inference in (-1, 0):
            network = network_record()
            network["outputs"].append(dict(network["inputs"][0], inference=inference))
            with self.subTest(inference=inference):
                self.check_graph(network=network)
                names = [f"head-{index}" for index in range(5)]
                self.assertEqual(set(probe.select_heads(outputs=network["outputs"], inference=0, names=names)), set(names))

    def test_intermediates_unknown_heads_and_nonfloat_terminals_are_rejected(self):
        for names in (["pooled", "head-1", "head-2", "head-3", "head-4"],
                      ["unknown", "head-1", "head-2", "head-3", "head-4"]):
            with self.subTest(names=names), self.assertRaisesRegex(ValueError, "terminals"):
                self.check_graph(names=names)
        with self.assertRaisesRegex(ValueError, "terminals"):
            self.check_graph(text=graph_text().replace("head-0 4 0", "head-0 2 0"))

    def test_duplicate_producer_and_wrong_profile_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.check_graph(text=graph_text().replace("head-4", "head-3"))
        with self.assertRaisesRegex(ValueError, "input profile"):
            self.check_graph(text=graph_text(size=160))
        with self.assertRaisesRegex(ValueError, "input profile"):
            self.check_graph(text=graph_text().replace("3 2 6", "3 2 5"))

    def test_tensor_names_shapes_and_storage_must_match_graph(self):
        for key, field, value in (("inputs", "name", "head-0"), ("outputs", "name", "unknown"),
                                  ("outputs", "name", ".."), ("outputs", "dims_nwhc", [1, 3, 1, 1]),
                                  ("outputs", "raw", [2, 0]), ("outputs", "raw", [4, 1])):
            network = network_record()
            network[key][0][field] = value
            with self.subTest(key=key, field=field, value=value), self.assertRaises(ValueError):
                self.check_graph(network=network)
        network = network_record()
        network["declared_outputs"] = ["unknown", ""]
        with self.assertRaisesRegex(ValueError, "association"):
            self.check_graph(network=network)


class RunTests(unittest.TestCase):
    def setUp(self):
        self.real_no_torch = probe.no_torch
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        base = Path(directory.name)
        self.capture, self.root, self.out = (base / name for name in ("capture", "export", "out"))
        for path in (self.capture, self.root, self.out):
            path.mkdir()
        self.evidence = dict(networks={}, metadata_records=16, successful_inferences=2)
        self.exported, self.captured, self.runners = export_report(), capture_report(), []
        for size in (120, 160):
            network = network_record(size=size)
            graph = self.capture / f"graph-{size}.txt"
            graph.write_text(graph_text(size=size))
            network["graph_path"] = str(graph)
            values = np.zeros((1, size, size, 3), dtype=np.int16 if size == 120 else np.int8)
            tensors = [(network["inputs"][0], values),
                       *((item, np.zeros((1, 1, 1, 3), np.float32)) for item in network["outputs"])]
            for index, (item, value) in enumerate(tensors):
                path = self.capture / f"tensor-{size}-{index}.bin"
                path.write_bytes(value.tobytes())
                item.update(path=str(path), sha256=hashlib.sha256(value.tobytes()).hexdigest())
            self.evidence["networks"][str(size)] = network
            model = self.exported["networks"][str(size)]
            model["cases"]["recorded-face"]["input_sha256"]["data"] = network["inputs"][0]["sha256"]
            artifact = self.root / f"align-{size}/artifacts/model.onnx"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(b"synthetic ONNX placeholder")
            self.exported["artifacts"][str(artifact.relative_to(self.root))] = hashlib.sha256(artifact.read_bytes()).hexdigest()
            reference = self.root / f"align-{size}/recorded-face/input.npy"
            reference.parent.mkdir()
            np.save(reference, values)
            self.runners.append(Mock(get_outputs=Mock(return_value=[SimpleNamespace(name=name) for name in model["terminal_names"]]),
                                     get_inputs=Mock(return_value=[SimpleNamespace(name="data", shape=[1, size, size, 3], type="tensor(int64)")]),
                                     run=Mock(return_value=[value for _, value in tensors[1:]])))
        self.captured["captures"] = self.evidence
        self.session = Mock()
        patches = (patch.object(probe, "fresh_output", return_value=self.out),
                   patch.object(probe.espresso_oracle, "private_path", side_effect=lambda *, path: path),
                   patch.object(probe, "inventory", side_effect=lambda *, capture: deepcopy(self.evidence)),
                   patch.object(probe, "no_torch", return_value=None),
                   patch.dict(sys.modules, {"onnxruntime": SimpleNamespace(__version__="1.22.1"),
                                            "espresso_onnx_runtime": SimpleNamespace(session=self.session)}))
        for replacement in patches:
            replacement.start()
            self.addCleanup(replacement.stop)

    def run_probe(self):
        (self.capture / "report.json").write_text(json.dumps(self.captured))
        (self.root / "summary.json").write_text(json.dumps(self.exported))
        self.session.reset_mock()
        self.session.side_effect = self.runners
        return probe.run(args=argparse.Namespace(capture=self.capture, root=self.root, out=self.out))

    def assert_failed(self, *, message, error=ValueError, before_session=False):
        with self.assertRaisesRegex(error, message):
            self.run_probe()
        result = json.loads((self.out / "report.json").read_text())
        self.assertIs(result["passed"], False)
        self.assertEqual(len(result["failures"]), 1)
        if before_session:
            self.session.assert_not_called()

    def test_complete_pure_run_checks_ten_heads_without_native_calls(self):
        result = self.run_probe()
        self.assertIs(result["passed"], True)
        self.assertEqual(result["head_comparisons"], 10)
        self.assertFalse(result["native_inference_called"])
        parser = Path(probe.__file__).with_name("face_alignment_replay.py")
        self.assertEqual(result["source_sha256"][parser.name], hashlib.sha256(parser.read_bytes()).hexdigest())
        self.assertEqual(len(list(self.out.glob("*.npy"))), 10)
        for runner in self.runners:
            self.assertEqual(runner.run.call_args.args[1]["data"].dtype, np.int64)

    def test_pure_run_is_independent_of_ambient_torch_modules(self):
        with patch.dict(sys.modules, {"torch": None, "torch.ambient": None}), \
                patch("importlib.util.find_spec") as lookup:
            self.assertIs(self.run_probe()["passed"], True)
            lookup.assert_not_called()

    def test_malformed_reports_and_graph_head_mismatch_fail_before_session(self):
        original = deepcopy(self.captured)
        self.captured = []
        self.assert_failed(message="report object", before_session=True)
        self.captured = deepcopy(original)
        self.captured["captures"]["successful_inferences"] = 2.0
        self.assert_failed(message="typed capture inventory", before_session=True)
        self.captured = deepcopy(original)
        self.exported["networks"]["120"]["terminal_names"][0] = "pooled"
        self.assert_failed(message="terminals", before_session=True)

    def test_duplicate_or_inactive_hash_matched_network_is_rejected(self):
        self.evidence["networks"]["303"] = deepcopy(self.evidence["networks"]["120"])
        self.evidence["successful_inferences"] = 3
        self.assert_failed(message="one active", before_session=True)
        self.evidence["networks"].pop("303")
        self.evidence["networks"]["120"].update(successful_inferences=[], inputs=[], outputs=[])
        self.evidence["successful_inferences"] = 1
        self.assert_failed(message="one active", before_session=True)

    def test_duplicate_and_extra_stage1_inputs_are_rejected(self):
        network = self.evidence["networks"]["120"]
        network["inputs"].append(deepcopy(network["inputs"][0]))
        self.assert_failed(message="duplicate inputs", before_session=True)
        network["inputs"][-1]["name"] = "extra"
        self.assert_failed(message="graph association", before_session=True)

    def test_boolean_onnx_dimension_is_not_an_integer_dimension(self):
        self.runners[0].get_inputs.return_value[0].shape[0] = True
        self.assert_failed(message="input metadata")
        self.runners[0].run.assert_not_called()

    def test_nonparity_outputs_still_fail_the_fixed_gates(self):
        self.runners[0].run.return_value = [np.ones((1, 1, 1, 3), np.float32) for _ in range(5)]
        self.assert_failed(message="without loosening gates", error=RuntimeError)

    def test_torch_guard_precedes_runtime_imports_and_records_failure(self):
        spec = importlib.machinery.ModuleSpec("torch", loader=None)
        with patch.dict(sys.modules, torch_free_modules(), clear=True), \
                patch.object(probe, "no_torch", self.real_no_torch), \
                patch("importlib.util.find_spec", return_value=spec) as lookup, \
                patch("builtins.__import__", wraps=__import__) as importer:
            self.assert_failed(message="Torch-free", before_session=True)
            lookup.assert_called_once_with("torch")
            self.assertFalse(any(call.args[0] in {"onnxruntime", "espresso_onnx_runtime"} for call in importer.call_args_list))

    def test_late_torch_import_is_rejected(self):
        with patch.dict(sys.modules, torch_free_modules(), clear=True), \
                patch.object(probe, "no_torch", self.real_no_torch), \
                patch("importlib.util.find_spec", return_value=None):
            outputs = self.runners[1].run.return_value
            def late_import(*_args):
                sys.modules["torch.late"] = None
                return outputs
            self.runners[1].run.side_effect = late_import
            self.assert_failed(message="Torch-free")


if __name__ == "__main__":
    unittest.main()
