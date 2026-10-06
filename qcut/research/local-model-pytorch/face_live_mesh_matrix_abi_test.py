"""CPU-only pinned-image guard coverage, without private binary fixtures."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import face_live_mesh_matrix_abi as abi


class MatrixAbiTests(unittest.TestCase):
    def test_registered_stops_are_aligned_bounded_and_role_pinned(self):
        self.assertEqual(set(abi.IDENTITIES), {"core", "agfx"})
        self.assertEqual(len(abi.SITES), 13)
        self.assertEqual(len(set(abi.SITES.values())), len(abi.SITES))
        for role, address in abi.SITES.values():
            self.assertIn(role, abi.IDENTITIES)
            self.assertEqual(address % 4, 0)
            self.assertTrue(any(start <= address < start + size for start, size, _ in abi.REGIONS[role]))
        self.assertEqual(abi.SITES["mvp_saved"], ("core", 0xC2D8EC))
        self.assertEqual(abi.SITES["model_saved"], ("core", 0xC2D938))

    def test_every_region_is_read_and_checked_without_disassembly_execution(self):
        data = {0x1000: b"abcdefgh", 0x2000: b"ijklmnop"}
        regions = {"core": tuple((address, len(value), hashlib.sha256(value).hexdigest())
                                   for address, value in data.items())}
        image = mock.Mock()
        image.read.side_effect = lambda **kw: data[kw["address"]][:kw["length"]]
        with mock.patch.object(abi, "REGIONS", regions):
            abi.validate_regions(image=image, role="core")
        self.assertEqual(image.read.call_args_list, [mock.call(address=0x1000, length=8),
                                                    mock.call(address=0x2000, length=8)])
        image.disassemble.assert_not_called()

    def test_short_or_changed_region_rejected(self):
        expected = b"abcdefgh"
        regions = {"core": ((0x1000, 8, hashlib.sha256(expected).hexdigest()),)}
        for value in (expected[:-1], b"abcdxfgh", b"0" * 8):
            with self.subTest(value=value), mock.patch.object(abi, "REGIONS", regions):
                image = mock.Mock()
                image.read.return_value = value
                with self.assertRaisesRegex(ValueError, "region changed"):
                    abi.validate_regions(image=image, role="core")

    def test_unknown_role_is_rejected_before_read(self):
        image = mock.Mock()
        with self.assertRaisesRegex(ValueError, "role"):
            abi.validate_regions(image=image, role="foreign")
        image.read.assert_not_called()

    def test_unpinned_library_cannot_reach_macho_parser(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "foreign.dylib"
            path.write_bytes(b"not the private image")
            with mock.patch.object(abi, "MachO") as parser:
                with self.assertRaisesRegex(ValueError, "hash"):
                    abi.verify_libraries(core=path, agfx=path)
                parser.assert_not_called()

    def test_directory_empty_and_missing_files_rejected_before_parser(self):
        with tempfile.TemporaryDirectory() as temporary:
            empty = Path(temporary) / "empty.dylib"
            empty.touch()
            for path in (Path(temporary), empty, Path(temporary) / "missing"):
                with self.subTest(path=path.name), mock.patch.object(abi, "MachO") as parser:
                    with self.assertRaises((ValueError, FileNotFoundError)):
                        abi.verify_libraries(core=path, agfx=path)
                    parser.assert_not_called()


if __name__ == "__main__":
    unittest.main()
