"""Original-source gates and both real owned samplers, with synthetic CPU oracles."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from face_alignment_sampling import signed_input
import face_full_frame_owned as owned
import face_full_frame_owned_inputs as inputs
import face_full_frame_owned_probe as probe
import face_preprocess_chain_inputs_test as legacy_tests
import face_preprocess_chain_inputs as chain
from face_render_stability_probe import digest


class MemoryLocked:
    def __init__(self, *, files):
        self.content, self.files = files, {}

    def read(self, *, path, maximum, expected=None):
        data = self.content[Path(path)]
        actual = digest(data=data)
        if (len(data) > maximum or (expected is not None and actual != expected) or
                (str(path) in self.files and self.files[str(path)] != actual)):
            raise ValueError("identity/size changed")
        self.files[str(path)] = actual
        return data

    def json(self, *, path, expected=None):
        return json.loads(self.read(path=path, maximum=32 * 1024**2, expected=expected))

    def verify(self):
        for name, expected in tuple(self.files.items()):
            self.read(path=Path(name), maximum=128 * 1024**2, expected=expected)


def fixture():
    value = legacy_tests.ChainInputsTests()
    value.reset_fixture()
    original = value.root / "original"
    frames, rows = [], []
    for index in range(7):
        path = original / f"input-{index:02d}.rgba"
        raw = bytes((10 + index, 30, 90, index)) * (1448 * 1086)
        value.files[path] = raw
        frames.append(dict(input=path, timestamp=index / 30))
        rows.append(dict(input_rgba_sha256=digest(data=raw), timestamp=index / 30))
    original_report = dict(width=1448, height=1086, warmup_requests_per_host=6, seeks_per_request=2, frames=rows)
    value.files[original / "report.json"] = json.dumps(original_report).encode()
    network120 = dict(inputs=[], successful_inferences=[])
    for index, row in enumerate(value.records):
        source_index = owned.prediction_frame(index=index)
        row["request"] = list(owned.REQUEST)
        row["faces"][0]["frame_size"] = [480, 640]
        value.trace["predictions"][index]["request"] = list(owned.REQUEST)
        raw = bytes((10 + source_index, 30, 90, source_index)) * (640 * 480)
        frame = np.frombuffer(raw, np.uint8).reshape(480, 640, 4)
        value.frames[index] = frame
        value.files[value.root / "geometry" / f"frame-{index}.rgba"] = raw
        value.descriptors[index].update(bytes=len(raw), sha256=digest(data=raw))
        if index in (18, 19):
            continue
        tensor = signed_input(frame=frame, forward=np.eye(2, 3, dtype=np.float32))
        path = value.root / "capture" / f"input120-{index}.bin"
        value.files[path] = tensor.tobytes()
        network120["inputs"].append(dict(name="data", inference=index, raw=[2, 6], dims_nwhc=[1, 120, 120, 3],
                                         path=str(path), sha256=digest(data=tensor.tobytes())))
        network120["successful_inferences"].append(index)
    for event, record in zip(value.events, value.network["inputs"], strict=True):
        index = event["prediction"]
        generated = chain.prepare(frame=value.frames[index], call=event["call"])
        for stage in ("source", "crop", "resized"):
            pixels = generated[stage]
            value.files[value.root / "trace" / event[stage]["file"]] = pixels.tobytes()
            event[stage].update(rows=pixels.shape[0], cols=pixels.shape[1], sha256=digest(data=pixels.tobytes()))
        value.files[Path(record["path"])] = generated["tensor"].tobytes()
        record["sha256"] = digest(data=generated["tensor"].tobytes())
    value.evidence["captures"]["networks"]["32768"] = network120
    value.evidence["fixture_sha256"] = {str(path): digest(data=data) for path, data in value.files.items()}
    value.refresh_cases()
    context = dict(root=value.root, original=original, frames=frames, evidence=value.evidence,
                   snapshots=value.records, associations=value.associations)
    return value, context


class OriginalProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = bytes((42, 13, 99, 0)) * (1448 * 1086)
        cls.sha = digest(data=cls.raw)

    def sample(self, **changes):
        args = dict(data=self.raw, source_size=(1448, 1086), source_stride=5792,
                    source_sha256=self.sha, request=list(owned.REQUEST))
        args.update(changes)
        return owned.original_to_algorithm(**args)

    def test_profile_preserves_transparent_unpremultiplied_channels(self):
        self.assertEqual(self.sample(), bytes((42, 13, 99, 0)) * (640 * 480))

    def test_shape_stride_and_byte_ownership_are_strict(self):
        for changes in (dict(source_size=(1086, 1448)), dict(source_size=(1448.0, 1086)),
                        dict(source_size=[1448, 1086]), dict(source_size=(640, 480)),
                        dict(source_stride=5796), dict(source_stride=5792.0), dict(source_stride=True),
                        dict(data=self.raw[:-4]), dict(data=self.raw + b"\0"),
                        dict(data=bytearray(self.raw)), dict(data=memoryview(self.raw))):
            with self.subTest(fields=list(changes)), self.assertRaises(ValueError):
                self.sample(**changes)

    def test_missing_wrong_or_malformed_original_hash_is_rejected(self):
        for sha in (None, "0" * 64, "f" * 63, "F" * 64, True):
            with self.subTest(sha=sha), self.assertRaises(ValueError):
                self.sample(source_sha256=sha)

    def test_algorithm_dimension_format_rotation_and_padding_are_not_inferred(self):
        requests = [None, tuple(owned.REQUEST), [], [0, 640, 480, 2560]]
        for index, values in ((0, [False, 1]), (1, [640.0, 320, 1448]),
                              (2, [480.0, 240]), (3, [2564, 2560.0]), (4, [False, 1])):
            for value in values:
                request = list(owned.REQUEST)
                request[index] = value
                requests.append(request)
        for request in requests:
            with self.subTest(request=request), self.assertRaises(ValueError):
                self.sample(request=request)


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template, cls.context_template = fixture()

    def setUp(self):
        self.context = deepcopy(self.context_template)
        self.files = dict(self.template.files)
        self.locked = MemoryLocked(files=self.files)
        self.addCleanup(patch.stopall)
        patch.object(owned, "regular_path", side_effect=lambda *, path: path).start()
        patch.object(chain.parity, "bounded_bytes", side_effect=lambda *, path, limit: self.files[path]).start()

    def build(self):
        return inputs.build_inputs(context=self.context, locked=self.locked)

    def test_source_pixels_reach_both_real_samplers_without_captured_algorithm_input(self):
        with patch.object(chain, "algorithm_frame", side_effect=AssertionError("native algorithm producer")):
            replacements, seeds, proof = self.build()
        self.assertEqual((len(replacements), len(seeds)), (24, 2))
        self.assertEqual(len(proof["observations"]), 26)
        self.assertTrue(proof["original_rgba_input_used"])
        self.assertFalse(proof["native_algorithm_rgba_input_used"])
        self.assertTrue(proof["native_caller_parameters_required"])
        for tensor in [*replacements.values(), *seeds.values()]:
            self.assertFalse(tensor.flags.writeable)

    def test_algorithm_buffers_cannot_be_made_writeable(self):
        frames, _ = owned.build_frames(context=self.context, locked=self.locked)
        frame = frames.frame(snapshot=self.context["snapshots"][0], descriptor=self.context["evidence"]["algorithm_frames"][0])
        with self.assertRaises(ValueError):
            frame.setflags(write=True)

    def test_generated_algorithm_one_level_error_blocks_both_tensor_builders(self):
        original = owned.original_to_algorithm

        def changed(**kwargs):
            pixels = bytearray(original(**kwargs))
            pixels[0] ^= 1
            return bytes(pixels)

        with patch.object(owned, "original_to_algorithm", side_effect=changed), \
                patch.object(inputs, "build_120") as small, patch.object(inputs, "build_160") as large:
            with self.assertRaises(ValueError):
                self.build()
            small.assert_not_called()
            large.assert_not_called()

    def test_corrupted_original_cannot_fall_back_to_equal_native_algorithm(self):
        path = self.context["frames"][6]["input"]
        raw = self.files[path]
        self.files[path] = b"\xff" + raw[1:]
        with self.assertRaisesRegex(ValueError, "identity"):
            self.build()

    def test_native_algorithm_oracle_corruption_is_rejected(self):
        path = self.context["root"] / "geometry/frame-25.rgba"
        self.files[path] = b"\xff" + self.files[path][1:]
        with self.assertRaisesRegex(ValueError, "identity"):
            self.build()

    def test_reference_hash_relabel_does_not_enable_correction(self):
        index = 24
        path = self.context["root"] / f"geometry/frame-{index}.rgba"
        self.files[path] = b"\xff" + self.files[path][1:]
        self.context["evidence"]["algorithm_frames"][index]["sha256"] = digest(data=self.files[path])
        with self.assertRaisesRegex(ValueError, "owned algorithm"):
            self.build()

    def test_wrong_frame_order_or_original_timestamp_is_rejected(self):
        for field, value in (("input", self.context["frames"][1]["input"]), ("timestamp", .5)):
            before = self.context["frames"][0][field]
            self.context["frames"][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "order"):
                self.build()
            self.context["frames"][0][field] = before

    def test_requested_dimension_is_checked_before_source_production(self):
        self.context["snapshots"][25]["request"][1] = 320
        with patch.object(owned, "original_to_algorithm") as producer, self.assertRaises(ValueError):
            self.build()
        producer.assert_not_called()

    def test_late_original_mutation_is_caught_before_returning_frames(self):
        original = owned.algorithm_frame

        def mutate(**kwargs):
            value = original(**kwargs)
            if kwargs["snapshot"]["index"] == 25:
                path = self.context["frames"][6]["input"]
                self.files[path] = b"\xff" + self.files[path][1:]
            return value

        with patch.object(owned, "algorithm_frame", side_effect=mutate), self.assertRaisesRegex(ValueError, "identity"):
            self.build()

    def test_original_report_dimension_and_warmup_contract_is_pinned(self):
        path = self.context["original"] / "report.json"
        previous = self.files[path]
        for key, value in (("width", 640), ("height", 1086.0), ("seeks_per_request", 1),
                           ("warmup_requests_per_host", 6.0)):
            report = json.loads(previous)
            report[key] = value
            self.files[path] = json.dumps(report).encode()
            self.context["evidence"]["fixture_sha256"][str(path)] = digest(data=self.files[path])
            self.locked = MemoryLocked(files=self.files)
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.build()

    def test_empty_and_partial_context_cannot_pass(self):
        for field in ("frames", "snapshots"):
            original = self.context[field]
            self.context[field] = []
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.build()
            self.context[field] = original

    def test_120_oracle_mismatch_blocks_return_without_correction(self):
        row = self.context["evidence"]["captures"]["networks"]["32768"]["inputs"][0]
        path = Path(row["path"])
        self.files[path] = b"\xff" + self.files[path][1:]
        row["sha256"] = digest(data=self.files[path])
        with self.assertRaisesRegex(RuntimeError, "120 input differs"):
            self.build()

    def test_160_oracle_mismatch_blocks_return_without_correction(self):
        row = self.context["evidence"]["captures"]["networks"]["57344"]["inputs"][1]
        path = Path(row["path"])
        self.files[path] = b"\xff" + self.files[path][1:]
        row["sha256"] = digest(data=self.files[path])
        with self.assertRaisesRegex(RuntimeError, "native fallback forbidden"):
            self.build()

    def test_owned_frame_parameter_does_not_accept_arbitrary_callbacks(self):
        with self.assertRaisesRegex(ValueError, "frame set"):
            chain.build_inputs(root=self.context["root"], evidence=self.context["evidence"],
                               associations=self.context["associations"], locked=self.locked, owned_frames=lambda: None)

    def test_malformed_120_producer_dtype_is_rejected(self):
        with patch.object(inputs, "signed_input", return_value=np.zeros((1, 120, 120, 3), np.uint8)), \
                self.assertRaisesRegex(ValueError, "int16 120"):
            self.build()


class ModelBindingTests(unittest.TestCase):
    def setUp(self):
        self.inputs = {(120, 0): np.zeros((1, 120, 120, 3), np.int16)}
        self.seeds = {(160, 0): np.ones((1, 160, 160, 3), np.int8)}
        self.model = dict(independent_120_sampling_input_used=True, independent_160_sampling_input_used=True,
                          model_outputs={str(size): dict(cases=[dict(inference=0, passed=True,
                            input_source="replacement_inputs", replacement_input_sha256=digest(data=values[(size, 0)].tobytes()))])
                            for size, values in ((120, self.inputs), (160, self.seeds))})

    def test_both_model_input_maps_are_required_and_hash_bound(self):
        probe.model_input_proof(model=self.model, inputs=self.inputs, seeds=self.seeds)
        self.seeds[(160, 0)][0, 0, 0, 0] = 2
        with self.assertRaisesRegex(ValueError, "identity"):
            probe.model_input_proof(model=self.model, inputs=self.inputs, seeds=self.seeds)

    def test_captured_tensor_path_or_partial_coverage_is_rejected(self):
        for field, value in (("input_source", "captured_tensor"), ("passed", 1),
                              ("replacement_input_sha256", None), ("inference", 1),
                              ("inference", False), ("inference", 0.0)):
            model = deepcopy(self.model)
            model["model_outputs"]["160"]["cases"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                probe.model_input_proof(model=model, inputs=self.inputs, seeds=self.seeds)

    def test_empty_and_duplicate_model_coverage_is_rejected(self):
        case = self.model["model_outputs"]["120"]["cases"][0]
        for cases in ([], [case, case]):
            model = deepcopy(self.model)
            model["model_outputs"]["120"]["cases"] = cases
            with self.subTest(count=len(cases)), self.assertRaises(ValueError):
                probe.model_input_proof(model=model, inputs=self.inputs, seeds=self.seeds)

    def test_full_provenance_failure_never_launches_onnx_or_claims_acceptance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with patch.object(probe.capture, "load", side_effect=ValueError("source guard")), \
                    patch.object(probe.parity, "run") as execute, self.assertRaisesRegex(ValueError, "source guard"):
                probe.run(capture_root=root, model_root=root, out=root / "out")
            execute.assert_not_called()
            report = json.loads((root / "out/report.json").read_bytes())
            for name in ("passed", "completed", "full_render_verified", "independent_full_frame_preprocessing"):
                self.assertIs(report[name], False)


if __name__ == "__main__":
    unittest.main()
