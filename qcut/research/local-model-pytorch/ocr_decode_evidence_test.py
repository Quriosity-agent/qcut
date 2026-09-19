"""Synthetic binary/PNG fixtures and fail-closed provenance regressions."""
import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from ocr_decode_binary import MachO, private_directory
from ocr_decode_contract import check_proof_ranges, load_pinned_alphabet, mapping_digest
from ocr_decode_evaluate import image_input, make_backends
from ocr_decode_test import fixture_metadata


def synthetic_macho(*, cpu=0x100000C):
    code = struct.pack("<3I", 0xB0000000, 0x91004000, 0xD65F03C0)
    text = b"authored-ocr-test\0nothing\0"
    command_size = 72 + 2 * 80
    offset = 32 + command_size
    header = struct.pack("<8I", 0xFEEDFACF, cpu, 0, 6, 1, command_size, 0, 0)
    segment = struct.pack("<II16sQQQQIIII", 0x19, command_size, b"__TEXT", 0x1000, 0x2000, 0,
                          offset + len(code) + len(text), 7, 5, 2, 0)
    first = struct.pack("<16s16sQQIIIIIIII", b"__text", b"__TEXT", 0x1000, len(code), offset, 2, 0, 0, 0, 0, 0, 0)
    second = struct.pack("<16s16sQQIIIIIIII", b"__cstring", b"__TEXT", 0x2010, len(text),
                         offset + len(code), 0, 0, 0, 2, 0, 0, 0)
    return header + segment + first + second + code + text


class BinaryTests(unittest.TestCase):
    def test_thin_sections_and_address_mapping(self):
        binary = MachO(data=synthetic_macho())
        self.assertEqual(binary.read(address=0x2010, length=8), b"authored")
        self.assertEqual(binary.file_offset(address=0x1000), 264)

    def test_fat_slice_selection(self):
        thin = synthetic_macho()
        header = b"\xca\xfe\xba\xbe" + struct.pack(">I", 1) + struct.pack(">5I", 0x100000C, 0, 32, len(thin), 0)
        binary = MachO(data=header + b"\0" * 4 + thin)
        self.assertEqual(binary.slice_offset, 32)
        self.assertEqual(binary.data, thin)

    def test_ascii_string_offsets(self):
        binary = MachO(data=synthetic_macho())
        self.assertEqual(binary.strings(pattern="ocr"), [{"address": 0x2010, "text": "authored-ocr-test"}])

    def test_xrefs_on_authored_instructions(self):
        binary = MachO(data=synthetic_macho())
        self.assertEqual(binary.xrefs(target=0x2010), [{"adrp": 0x1000, "add": 0x1004}])
        self.assertEqual(binary.xrefs(target=0x2011), [])

    def test_bounded_reads_cannot_cross_sections(self):
        binary = MachO(data=synthetic_macho())
        for address, length in ((0x1000, 0), (0x1000, -1), (0x1008, 8), (0x9999, 1), (0x1000, 5 * 1024**2)):
            with self.subTest(address=address, length=length), self.assertRaises(ValueError):
                binary.read(address=address, length=length)

    def test_invalid_header_architecture_and_truncation(self):
        for data in (b"x" * 32, synthetic_macho(cpu=0x1000007), synthetic_macho()[:31], synthetic_macho()[:200]):
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                MachO(data=data)

    def test_zero_command_size_is_not_an_infinite_loop(self):
        data = bytearray(synthetic_macho())
        struct.pack_into("<I", data, 36, 0)
        with self.assertRaises(ValueError):
            MachO(data=bytes(data))

    def test_fat_slice_outside_file(self):
        data = b"\xca\xfe\xba\xbe" + struct.pack(">I", 1) + struct.pack(">5I", 0x100000C, 0, 32, 999999, 0) + b"\0" * 4
        with self.assertRaises(ValueError):
            MachO(data=data)

    def test_output_refuses_nonprivate_destination(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            private_directory(path=Path(directory) / "outside")


class ImageInputTests(unittest.TestCase):
    def setUp(self):
        from PIL import Image

        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "authored.png"
        self.pixels = np.full((32, 512, 3), 255, np.uint8)
        self.pixels[2, 3] = [0, 127, 64]
        Image.fromarray(self.pixels).save(self.path)

    def test_byte_input_is_rgb_nchw_without_scaling(self):
        values = image_input(image_path=self.path, input_mode="byte-float")
        self.assertEqual(values.shape, (1, 3, 32, 512))
        self.assertEqual(values.dtype, np.float32)
        np.testing.assert_array_equal(values[0, :, 2, 3], [0, 127, 64])

    def test_fixture_input_keeps_previous_contract(self):
        values = image_input(image_path=self.path, input_mode="fixture")
        expected = (self.pixels.astype(np.float32) / 127.5 - 1).transpose(2, 0, 1)[None]
        np.testing.assert_array_equal(values, expected)

    def test_mode_must_be_explicit(self):
        with self.assertRaises(ValueError):
            image_input(image_path=self.path, input_mode="guess")

    def test_does_not_silently_resize(self):
        from PIL import Image

        Image.new("RGB", (512, 31)).save(self.path)
        with self.assertRaises(ValueError):
            image_input(image_path=self.path, input_mode="byte-float")

    def test_does_not_silently_convert_grayscale_or_rgba(self):
        from PIL import Image

        for mode in ("L", "RGBA"):
            Image.new(mode, (512, 32)).save(self.path)
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                image_input(image_path=self.path, input_mode="byte-float")

    def test_duplicate_unknown_backend_rejected_before_load(self):
        for values in ([], ["auto"], ["onnx", "onnx"]):
            with self.subTest(backends=values), self.assertRaises(ValueError):
                make_backends(run=Path("absent"), contract=Path("absent"), backends=values, threads=2)


class PinnedEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.proofs = [("authored", 16, 4, "a" * 64)]
        self.valid = [{"name": "authored", "address": 16, "bytes": 4, "sha256": "a" * 64,
                       "instructions": ["0x10: ret"]}]

    def test_proof_range_validation_without_vendor_instructions(self):
        with patch("ocr_decode_contract.PROOF_RANGES", self.proofs):
            check_proof_ranges(proofs=self.valid)

    def test_missing_duplicate_or_changed_proof_rejected(self):
        invalid = [[], self.valid * 2, None]
        for key, value in (("address", True), ("bytes", 4.0), ("sha256", "b" * 64), ("name", "other"),
                            ("instructions", []), ("instructions", [123])):
            candidate = copy.deepcopy(self.valid)
            candidate[0][key] = value
            invalid.append(candidate)
        with patch("ocr_decode_contract.PROOF_RANGES", self.proofs):
            for candidate in invalid:
                with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                    check_proof_ranges(proofs=candidate)

    def test_forged_true_flag_cannot_replace_adjacent_evidence(self):
        metadata = fixture_metadata()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "alphabet.json"
            path.write_text(json.dumps(metadata))
            with patch("ocr_decode_contract.SOURCE_SHA256", metadata["source_model_sha256"]), \
                    patch("ocr_decode_contract.MAPPING_SHA256", mapping_digest(tokens=metadata["tokens"])):
                with self.assertRaises(ValueError):
                    load_pinned_alphabet(path=path)
                path.with_name("evidence.json").write_text('{"verified": true}')
                with self.assertRaises(ValueError):
                    load_pinned_alphabet(path=path)


if __name__ == "__main__":
    unittest.main()
