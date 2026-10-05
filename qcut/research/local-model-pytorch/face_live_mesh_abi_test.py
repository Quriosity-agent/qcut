"""CPU static identity guard tests without private binary fixtures."""
import struct
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import uuid

import face_live_mesh_abi as abi


def pair(*, address, target, register):
    delta = ((target & ~4095) - (address & ~4095)) >> 12
    page = 0x90000000 | (delta & 3) << 29 | (delta >> 2 & 0x7FFFF) << 5 | register
    add = 0x91000000 | (target & 4095) << 10 | register << 5 | register
    return struct.pack("<2I", page, add)


class SyntheticImage:
    def __init__(self):
        self.data = struct.pack("<8I", 0, 0, 0, 0, 1, 24, 0, 0)
        self.data += struct.pack("<2I", 0x1B, 24) + uuid.UUID(abi.CORE_UUID).bytes
        self.memory = {0x2CF88B8: struct.pack("<I", 16)}
        for address, target in ((0xCDF11C, abi.MESH_VPTR - 16), (0xCE0E34, abi.FITTING_VPTR)):
            self.memory[address] = pair(address=address, target=target, register=8)
        for index, (address, name) in enumerate(((0xC1CCC0, "getFaceFittingCount1256"),
            (0xC1CCF4, "getFaceMeshInfo1256"), (0x88BD6C, "setVertexArray"), (0x88BDEC, "setNormalArray"))):
            target = 0x2000000 + index * 128
            self.memory[address] = pair(address=address, target=target, register=1 if index < 2 else 0)
            self.memory[target] = name.encode() + b"\0"

    def read(self, *, address, length):
        return self.memory[address][:length]


class MeshAbiTests(unittest.TestCase):
    def test_static_inventory_explicitly_denies_runtime_proof(self):
        report = abi.validate_image(image=SyntheticImage())
        self.assertFalse(report["runtime_consumption_verified"])
        self.assertFalse(report["qcut_mesh_ownership_verified"])
        self.assertEqual(report["buffer_type"], 16)
        self.assertEqual(report["abi_family"], 1256)
        self.assertNotIn("vertices", report)

    def test_wrong_uuid_rejected(self):
        image = SyntheticImage()
        image.data = image.data[:-16] + bytes(16)
        with self.assertRaisesRegex(ValueError, "UUID"):
            abi.validate_image(image=image)

    def test_type_constructor_and_bindings_guarded(self):
        for address in (0x2CF88B8, 0xCDF11C, 0xCE0E34, 0xC1CCC0, 0xC1CCF4, 0x88BD6C, 0x88BDEC):
            with self.subTest(address=address):
                image = SyntheticImage()
                image.memory[address] = bytes(len(image.memory[address]))
                with self.assertRaises(ValueError):
                    abi.validate_image(image=image)

    def test_no_unpinned_binary_reaches_layout_parser(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "foreign.dylib"
            path.write_bytes(b"not pinned")
            with mock.patch.object(abi, "MachO") as parser:
                with self.assertRaisesRegex(ValueError, "hash"):
                    abi.verify_library(library=path)
                parser.assert_not_called()
            with self.assertRaisesRegex(ValueError, "regular"):
                abi.verify_library(library=Path(temporary))


if __name__ == "__main__":
    unittest.main()
