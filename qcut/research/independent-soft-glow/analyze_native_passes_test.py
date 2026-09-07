#!/usr/bin/env python3
"""Synthetic contract tests; no SDK, native captures, or external pixels required."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "analyze_native_passes", Path(__file__).with_name("analyze_native_passes.py")
)
ANALYZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ANALYZER)


class SyntheticCapture:
    """An eight-by-six profile with independently generated row orientation."""

    def __init__(self, root):
        self.root = root
        self.width, self.height = 8, 6
        self.sizes = [(4, 3)] * 3 + [(8, 6)] * 11
        self.expected = {}
        self.rows = []
        required = {
            1: {"u_Is_Y_up": [1], "u_gamma": [2.2], "u_spaceDither": [0]},
            2: {"u_Is_Y_up": [1], "u_gamma": [2.2], "u_spaceDither": [0]},
            4: {"u_is_texture_0_flip_": [0, 1, 1, 0], "u_blendMode": [7], "u_alpha": [0.7]},
            5: {"threshold": [0.84]},
            6: {"dither": [1], "edgeMode": [1]},
            7: {"dither": [1], "edgeMode": [1]},
            8: {"dither": [1], "edgeMode": [1]},
            9: {"dither": [1], "edgeMode": [1]},
            10: {"brightness": [2.4]},
            11: {"uniAlpha": [0.8]},
            12: {"u_Is_Y_up": [-1], "u_layerOpacity": [0.64]},
        }
        for frame in range(3):
            for index, name in enumerate(ANALYZER.NAMES):
                width, height = self.sizes[index]
                scanlines = [bytes((index * 13 + y * 23 + x * 5 + c * 3) % 256
                                  for x in range(width) for c in range(4))
                             for y in range(height)]
                self.expected[name] = b"".join(scanlines)
                # The capture origin differs at precisely these native targets.
                stored = b"".join(scanlines[::-1] if index in (3, 12, 13) else scanlines)
                (root / f"{frame * 14 + index}.rgba").write_bytes(stored)
                uniforms = [{"name": name, "type": 0x1406, "values": values}
                            for name, values in required.get(index, {}).items()]
                uniforms.append({"name": "syntheticTexture", "type": 0x8B5E,
                                 "sampler": 0, "texture": index + 1,
                                 "min": 0x2601, "mag": 0x2601,
                                 "wrapS": 0x8370 if index in (6, 7, 8, 9) else 0x812F,
                                 "wrapT": 0x8370 if index in (6, 7, 8, 9) else 0x812F})
                if index == 10:
                    for name in ("blurTexture1", "blurTexture2"):
                        uniforms.append({"name": name, "type": 0x8B5E, "sampler": 1,
                                         "texture": 100, "min": 0x2601, "mag": 0x2601,
                                         "wrapS": 0x8370, "wrapT": 0x8370})
                if index in (4, 10, 12):
                    uniforms.append({"name": "bgTexture" if index == 10 else "u_maskTexture",
                                     "type": 0x8B5E, "texture": 0, "sampler": 0})
                row = {"draw": frame * 14 + index, "internalFormat": 0x8058,
                       "width": width, "height": height, "uniforms": uniforms,
                       "kind": "blit" if index in (0, 3) else "draw"}
                if index in (0, 3):
                    row.update({"blitCoordinates": [0, 6, 8, 0, 0, 0, 4, 3] if index == 0
                                else [0, 3, 4, 0, 0, 0, 8, 6],
                                "blitMask": 0x4000, "blitFilter": 0x2601})
                self.rows.append(row)
            (root / f"output-{frame}.rgba").write_bytes(self.expected["06-output"])
        source = bytes(range(192))
        self.expected["00-input"] = source
        (root / "input.rgba").write_bytes(source)
        self.manifest = {"profile": "d634-soft-glow-cgl-rgba8-v1", "observerEnabled": True,
                         "width": 8, "height": 6, "inputPath": str(root / "input.rgba"),
                         "inputSha256": hashlib.sha256(source).hexdigest(),
                         "hashes": [hashlib.sha256(self.expected["06-output"]).hexdigest()] * 3,
                         **ANALYZER.IDENTITIES}
        self.save()

    def save(self):
        (self.root / "capture.json").write_text(json.dumps(self.manifest))
        (self.root / "draws.ndjson").write_text(
            "\n".join(json.dumps(row) for row in self.rows) + "\n"
        )


class NumericTests(unittest.TestCase):
    def test_flip_rgba_rows_and_preserve_channels(self):
        first, second, third = bytes(range(8)), bytes(range(8, 16)), bytes(range(16, 24))
        source = first + second + third
        self.assertEqual(ANALYZER.flip_rows(source, 2, 3), third + second + first)
        self.assertEqual(ANALYZER.flip_rows(ANALYZER.flip_rows(source, 2, 3), 2, 3), source)
        self.assertEqual(ANALYZER.flip_rows(first, 2, 1), first)

    def test_packed_carry_is_not_a_large_intensity_error(self):
        result = ANALYZER.metrics(bytes([0, 255, 10, 0]), bytes([1, 0, 9, 255]), packed=True)
        self.assertEqual(result["rgba_mae"], 128)
        self.assertEqual(result["rgba_max"], 255)
        self.assertEqual(result["different_bytes"], 4)
        self.assertEqual(result["decoded_pair_mae_8bit_units"], 0)
        self.assertEqual(result["decoded_pair_max_8bit_units"], 0)
        fractional = ANALYZER.metrics(bytes([0, 254, 0, 0]), bytes([1, 0, 0, 0]), packed=True)
        self.assertAlmostEqual(fractional["decoded_pair_max_8bit_units"], 1 / 255)
        self.assertAlmostEqual(fractional["decoded_pair_mae_8bit_units"], 1 / 510)
        self.assertNotIn("decoded_pair_mae_8bit_units", ANALYZER.metrics(bytes(4), bytes(4)))

    def test_malformed_metric_and_flip_lengths_are_rejected(self):
        for actual, expected in [(b"", b""), (b"abc", b"abc"), (bytes(4), bytes(8))]:
            with self.subTest(actual=len(actual), expected=len(expected)):
                with self.assertRaisesRegex(ValueError, "Invalid metric inputs"):
                    ANALYZER.metrics(actual, expected, packed=True)
        for data in (bytes(23), bytes(25)):
            with self.assertRaisesRegex(ValueError, "malformed RGBA"):
                ANALYZER.flip_rows(data, 2, 3)


class CaptureTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="qcut-native-pass-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.capture = SyntheticCapture(self.root)

    def reject(self, expected):
        self.capture.save()
        with self.assertRaisesRegex(ValueError, expected):
            ANALYZER.load_capture(self.root)

    def test_canonicalizes_all_targets_and_stable_frames(self):
        manifest, canonical = ANALYZER.load_capture(self.root)
        self.assertEqual(manifest, self.capture.manifest)
        self.assertEqual(canonical, self.capture.expected)

    def test_each_pinned_runtime_or_resource_identity_is_required(self):
        original = copy.deepcopy(self.capture.manifest)
        for key in ("creator", "agfx", "resource"):
            with self.subTest(identity=key):
                self.capture.manifest = copy.deepcopy(original)
                self.capture.manifest[key] = "0" * 64
                self.reject("identity changed")

    def test_profile_and_boolean_observer_are_required(self):
        self.capture.manifest["profile"] = "different-profile"
        self.reject("Wrong capture profile")
        self.capture.manifest["profile"] = "d634-soft-glow-cgl-rgba8-v1"
        for enabled in (False, 0, None, "false", 1):
            with self.subTest(observer=enabled):
                self.capture.manifest["observerEnabled"] = enabled
                self.reject("Wrong capture profile")

    def test_dimensions_reject_boolean_noninteger_and_out_of_range(self):
        for width, height in ((0, 6), (-1, 6), (2049, 6), (8, 0), (8, 2049),
                              (True, 6), (8, False), (8.0, 6), (8, "6")):
            with self.subTest(width=width, height=height):
                self.capture.manifest.update(width=width, height=height)
                self.reject("Invalid dimensions")

    def test_changed_format_topology_dimensions_and_blit_are_rejected(self):
        original = copy.deepcopy(self.capture.rows)
        changes = [(1, "internalFormat", 0x881A, "format changed"),
                   (1, "kind", "blit", "topology changed"),
                   (0, "width", 8, "dimensions changed"),
                   (0, "blitCoordinates", [0, 0, 8, 6, 0, 0, 4, 3], "orientation changed"),
                   (3, "blitMask", 0x100, "copy color"),
                   (3, "blitFilter", 0x2600, "GL_LINEAR")]
        for row, field, value, error in changes:
            with self.subTest(stage=row, field=field):
                self.capture.rows = copy.deepcopy(original)
                self.capture.rows[row][field] = value
                self.reject(error)

    def test_duplicate_missing_extra_or_reordered_draw_is_rejected(self):
        original = copy.deepcopy(self.capture.rows)
        for mutation in ("duplicate-frame-index", "missing", "extra", "reorder"):
            with self.subTest(mutation=mutation):
                self.capture.rows = copy.deepcopy(original)
                if mutation == "duplicate-frame-index":
                    self.capture.rows[14]["draw"] = 0
                elif mutation == "missing":
                    self.capture.rows.pop()
                elif mutation == "extra":
                    self.capture.rows.append(copy.deepcopy(self.capture.rows[-1]))
                else:
                    self.capture.rows[1], self.capture.rows[2] = self.capture.rows[2], self.capture.rows[1]
                self.reject("Sequence/target format changed|Expected three frames")

    def test_missing_duplicate_changed_or_nonfinite_uniform_is_rejected(self):
        original = copy.deepcopy(self.capture.rows[1]["uniforms"])
        for mutation in ("missing", "duplicate", "different-value", "nan", "infinity", "wrong-arity"):
            with self.subTest(mutation=mutation):
                uniforms = copy.deepcopy(original)
                gamma = next(item for item in uniforms if item["name"] == "u_gamma")
                if mutation == "missing":
                    uniforms.remove(gamma)
                elif mutation == "duplicate":
                    uniforms.append(copy.deepcopy(gamma))
                else:
                    gamma["values"] = {"different-value": [1], "nan": [float("nan")],
                                       "infinity": [float("inf")], "wrong-arity": [2.2, 2.2]}[mutation]
                self.capture.rows[1]["uniforms"] = uniforms
                self.reject("profile uniform u_gamma")

    def test_invalid_sampler_identity_filter_or_unsupported_border_is_rejected(self):
        original = copy.deepcopy(self.capture.rows[1]["uniforms"][-1])
        for field, value in (("sampler", -1), ("sampler", True), ("min", 0x2703), ("mag", 0x2600),
                             ("wrapS", 0x2901), ("wrapT", 0x2901)):
            with self.subTest(field=field):
                sampler = copy.deepcopy(original)
                sampler[field] = value
                self.capture.rows[1]["uniforms"][-1] = sampler
                self.reject("sampler identity|Sampler filter|Sampler border")

    def test_profile_border_switch_and_unbound_required_texture_are_rejected(self):
        original = copy.deepcopy(self.capture.rows)
        for stage, name, replacement in ((1, "syntheticTexture", 0x8370),
                                          (6, "syntheticTexture", 0x812F),
                                          (10, "blurTexture1", 0x812F),
                                          (10, "syntheticTexture", 0x8370)):
            with self.subTest(stage=stage, uniform=name):
                self.capture.rows = copy.deepcopy(original)
                sampler = next(item for item in self.capture.rows[stage]["uniforms"] if item["name"] == name)
                sampler["wrapS"] = replacement
                self.reject("Sampler border changed")
        for stage, name in ((1, "syntheticTexture"), (10, "blurTexture2")):
            with self.subTest(unbound_stage=stage, uniform=name):
                self.capture.rows = copy.deepcopy(original)
                sampler = next(item for item in self.capture.rows[stage]["uniforms"] if item["name"] == name)
                sampler["texture"] = 0
                self.reject("Required texture is unbound")

    def test_lut_identity_rejected_before_creating_output_or_running_tools(self):
        lut = self.root / "synthetic-lut.rgba"
        lut.write_bytes(bytes(16))
        output = self.root / "analysis-output"
        arguments = ["analyze_native_passes.py", "--capture", str(self.root),
                     "--lut", str(lut), "--output", str(output),
                     "--replay-cli", str(self.root / "unused-replay"),
                     "--pipeline-cli", str(self.root / "unused-pipeline")]
        with mock.patch("sys.argv", arguments), mock.patch.object(ANALYZER.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "LUT identity differs"):
                ANALYZER.main()
            run.assert_not_called()
        self.assertFalse(output.exists())

    def test_truncated_or_oversized_rgba_is_rejected_at_every_input_role(self):
        for name in ("input.rgba", "0.rgba", "output-0.rgba"):
            target = self.root / name
            original = target.read_bytes()
            for data in (original[:-1], original + b"\x00"):
                with self.subTest(file=name, size=len(data)):
                    target.write_bytes(data)
                    with self.assertRaisesRegex(ValueError, "Wrong RGBA byte count"):
                        ANALYZER.load_capture(self.root)
            target.write_bytes(original)

    def test_input_and_provider_output_hashes_are_required(self):
        self.capture.manifest["inputSha256"] = "0" * 64
        self.reject("Input hash changed")
        self.capture.manifest["inputSha256"] = hashlib.sha256(self.capture.expected["00-input"]).hexdigest()
        self.capture.manifest["hashes"][1] = "0" * 64
        self.reject("Native output hash changed")

    def test_second_frame_intermediate_change_is_rejected(self):
        target = self.root / "18.rgba"
        data = bytearray(target.read_bytes())
        data[0] ^= 1
        target.write_bytes(data)
        with self.assertRaisesRegex(ValueError, "intermediate changed between frames: 02-soft-light"):
            ANALYZER.load_capture(self.root)

    def test_provider_orientation_mismatch_is_rejected_even_with_valid_hash(self):
        final = self.capture.expected["06-output"]
        wrong = b"".join(final[row * 32:(row + 1) * 32] for row in range(5, -1, -1))
        (self.root / "output-0.rgba").write_bytes(wrong)
        self.capture.manifest["hashes"][0] = hashlib.sha256(wrong).hexdigest()
        self.reject("Final capture/provider orientation or topology differs")


if __name__ == "__main__":
    unittest.main()
