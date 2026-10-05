"""CPU-only hostile-memory tests for native mesh inventory/copy evidence."""
import dataclasses
import json
import struct
import unittest

import face_live_mesh_capture as capture
from face_live_mesh_abi import MESH_VPTR, VERTICES


class MeshMemory:
    def __init__(self):
        self.memory = bytearray(4 * 1024**2)
        self.calls = []
        self.mesh, self.slide, self.face_id = 0x2000, 0x100000000, 7
        self.vectors = {"vertices": 0x3000, "normals": 0x4000}
        self.begins = {"vertices": 0x10000, "normals": 0x20000}
        self.put(address=self.mesh, data=struct.pack("<QIi", self.slide + MESH_VPTR, 1, self.face_id))
        identity = struct.pack("<16f", *(1 if index % 5 == 0 else 0 for index in range(16)))
        self.put(address=self.mesh + 0x40, data=identity * 2)
        for channel, offset in (("vertices", 0x10), ("normals", 0x28)):
            vector, begin = self.vectors[channel], self.begins[channel]
            self.put(address=self.mesh + offset, data=struct.pack("<Q", vector))
            self.put(address=vector + 0x10,
                     data=struct.pack("<3Q", begin, begin + capture.PAYLOAD_SIZE, begin + capture.PAYLOAD_SIZE))
            payload = struct.pack(f"<{VERTICES * 3}f", *(
                index / 4096 + (1 if channel == "normals" else 0) for index in range(VERTICES * 3)))
            self.put(address=begin, data=payload)

    def put(self, *, address, data):
        self.memory[address:address + len(data)] = data

    def read(self, *, address, size):
        self.calls.append((address, size))
        return bytes(self.memory[address:address + size])

    def reader(self):
        return capture.ReadBudget(read=self.read)

    def snapshot(self):
        return capture.snapshot(reader=self.reader(), mesh=self.mesh, slide=self.slide, face_id=self.face_id)

    def copied(self, *, channel, stride=32):
        value = self.snapshot()
        vector = getattr(value, channel)
        destination, reference, stack = ((0x40000, 0x6000, 0x8000) if channel == "vertices"
                                        else (0xA0000, 0x7000, 0x9000))
        output = bytearray(VERTICES * stride)
        for index in range(VERTICES):
            output[index * stride:index * stride + 12] = vector.data[index * 12:index * 12 + 12]
        self.put(address=destination, data=output)
        self.put(address=reference, data=struct.pack("<Q", vector.vector))
        self.put(address=stack, data=struct.pack("<Qi", destination, stride))
        registers = dict(x8=vector.end, x9=stride, x10=destination + VERTICES * stride,
                         x11=0, x12=int.from_bytes(vector.data[-12:-4], "little"),
                         w13=int.from_bytes(vector.data[-4:], "little"), sp=stack,
                         x19=0x5000, x21=reference, x23=reference, w20=0, w22=0, w25=VERTICES)
        if channel == "normals":
            registers["w22"] = VERTICES
        return value, registers, destination


class MeshCaptureTests(unittest.TestCase):
    def setUp(self):
        self.memory = MeshMemory()

    def test_snapshot_has_native_fingerprints_not_ownership(self):
        report = capture.snapshot_report(value=self.memory.snapshot())
        self.assertEqual(report["face_id"], 7)
        self.assertEqual(report["vertices"], VERTICES)
        self.assertEqual(len(report["matrices"]), 2)
        self.assertNotEqual(report["vectors"]["vertices"]["sha256"], report["vectors"]["normals"]["sha256"])
        self.assertFalse(report["qcut_mesh_ownership_verified"])
        self.assertFalse(report["renderer_consumption"])
        self.assertLess(sum(size for _, size in self.memory.calls), 32 * 1024)

    def test_wrong_mesh_type_or_face_id_fails(self):
        for offset, data in ((0, struct.pack("<Q", self.memory.slide + MESH_VPTR + 8)),
                             (12, struct.pack("<i", 8))):
            with self.subTest(offset=offset):
                memory = MeshMemory()
                memory.put(address=memory.mesh + offset, data=data)
                with self.assertRaises(ValueError):
                    memory.snapshot()

    def test_refcount_change_is_not_a_geometry_change(self):
        before = self.memory.snapshot()
        self.memory.put(address=self.memory.mesh + 8, data=struct.pack("<I", 999))
        self.assertEqual(before, self.memory.snapshot())

    def test_nonfinite_geometry_and_matrices_fail(self):
        for address in (self.memory.begins["vertices"], self.memory.begins["normals"],
                        self.memory.mesh + 0x40, self.memory.mesh + 0x80):
            for value in (float("nan"), float("inf"), -float("inf")):
                with self.subTest(address=address, value=value):
                    memory = MeshMemory()
                    memory.put(address=address, data=struct.pack("<f", value))
                    with self.assertRaisesRegex(ValueError, "nonfinite"):
                        memory.snapshot()

    def test_vector_count_capacity_alignment_and_alias_are_bounded(self):
        begin = self.memory.begins["vertices"]
        for span in ((begin, begin + 1200 * 12, begin + 1200 * 12),
                     (begin + 1, begin + 1 + capture.PAYLOAD_SIZE, begin + 1 + capture.PAYLOAD_SIZE),
                     (begin, begin + capture.PAYLOAD_SIZE, begin),
                     (begin, begin + capture.PAYLOAD_SIZE, 2**60)):
            with self.subTest(span=span):
                memory = MeshMemory()
                memory.put(address=memory.vectors["vertices"] + 0x10, data=struct.pack("<3Q", *span))
                with self.assertRaises(ValueError):
                    memory.snapshot()
        self.memory.put(address=self.memory.mesh + 0x28, data=struct.pack("<Q", self.memory.vectors["vertices"]))
        with self.assertRaisesRegex(ValueError, "alias"):
            self.memory.snapshot()

    def test_short_reads_and_per_callback_budget_fail(self):
        with self.assertRaisesRegex(ValueError, "short"):
            capture.snapshot(reader=capture.ReadBudget(read=lambda **_: b""),
                             mesh=0x2000, slide=self.memory.slide, face_id=7)
        reader = self.memory.reader()
        for _ in range(2):
            reader.read(address=0x10000, size=capture.MAX_READ)
        with self.assertRaisesRegex(ValueError, "budget"):
            reader.read(address=0x10000, size=4)
        with self.assertRaisesRegex(ValueError, "budget"):
            self.memory.reader().read(address=0x10000, size=capture.MAX_READ + 4)

    def test_bad_descriptor_records_exact_values_without_payload_read(self):
        for begin, end, capacity in ((0x10000, 0x10000 + 1200 * 12, 0x10000 + 1200 * 12),
                                    (0x10000, 0x10000 + capture.PAYLOAD_SIZE, 2**64 - 1),
                                    (0x10000, 0xF000, 0x10000), (0, 0, 0)):
            with self.subTest(begin=begin, end=end, capacity=capacity):
                vector = self.memory.vectors["normals"]
                self.memory.put(address=vector + 0x10, data=struct.pack("<3Q", begin, end, capacity))
                self.memory.calls.clear()
                with self.assertRaises(ValueError) as raised:
                    capture.vector_snapshot(reader=self.memory.reader(), vector=vector, channel="normals")
                message = str(raised.exception)
                self.assertLess(len(message), 512)
                self.assertEqual(json.loads(message.split("; descriptor=", 1)[1]), dict(
                    channel="normals", pointer=vector, begin=begin, end=end, capacity=capacity,
                    count_bytes=end - begin, capacity_bytes=capacity - begin,
                    expected_bytes=capture.PAYLOAD_SIZE))
                self.assertEqual(self.memory.calls, [(vector + 0x10, 24)])

    def test_snapshot_failure_identifies_bad_channel(self):
        vector = self.memory.vectors["normals"]
        self.memory.put(address=vector + 0x18, data=struct.pack("<Q", self.memory.begins["normals"]))
        with self.assertRaises(ValueError) as raised:
            self.memory.snapshot()
        descriptor = json.loads(str(raised.exception).split("; descriptor=", 1)[1])
        self.assertEqual(descriptor["channel"], "normals")
        self.assertEqual(descriptor["count_bytes"], 0)

    def test_all_copied_bytes_and_last_loaded_registers_match(self):
        for channel in ("vertices", "normals"):
            for stride in (12, 32, 256):
                with self.subTest(channel=channel, stride=stride):
                    source, registers, _ = self.memory.copied(channel=channel, stride=stride)
                    report = capture.whole_copy(reader=self.memory.reader(), registers=registers,
                                                channel=channel, source=source)
                    self.assertTrue(report["all_destination_bytes_equal"])
                    self.assertTrue(report["final_loaded_registers_equal"])
                    self.assertFalse(report["qcut_mesh_ownership_verified"])
                    self.assertFalse(report["gpu_consumption_verified"])

    def test_single_interior_bad_value_is_not_hidden_by_endpoints(self):
        source, registers, destination = self.memory.copied(channel="vertices")
        self.memory.put(address=destination + 611 * 32, data=b"xxxx")
        with self.assertRaisesRegex(ValueError, "full-copy"):
            capture.whole_copy(reader=self.memory.reader(), registers=registers, channel="vertices", source=source)

    def test_source_mutation_cannot_be_mislabeled_as_owned_output(self):
        source, registers, _ = self.memory.copied(channel="normals")
        self.memory.put(address=source.normals.begin + 128, data=b"xxxx")
        with self.assertRaisesRegex(ValueError, "source changed"):
            capture.whole_copy(reader=self.memory.reader(), registers=registers, channel="normals", source=source)

    def test_wrong_counter_offset_end_registers_or_wrapper_fail(self):
        for name, value in (("x11", 12), ("w25", 0), ("w22", 1), ("x8", 0x10000),
                            ("x9", 12), ("x10", 0x40000), ("x12", 0), ("w13", 0), ("x23", 0x9000)):
            with self.subTest(name=name):
                source, registers, _ = self.memory.copied(channel="vertices")
                registers[name] = value
                with self.assertRaises(ValueError):
                    capture.whole_copy(reader=self.memory.reader(), registers=registers,
                                       channel="vertices", source=source)

    def test_destination_cannot_alias_either_source_channel(self):
        source, registers, _ = self.memory.copied(channel="vertices")
        for destination in (source.vertices.begin, source.normals.begin, source.mesh, source.normals.vector):
            self.memory.put(address=registers["sp"], data=struct.pack("<Qi", destination, 32))
            registers["x10"] = destination + VERTICES * 32
            with self.subTest(destination=destination), self.assertRaisesRegex(ValueError, "aliases"):
                capture.whole_copy(reader=self.memory.reader(), registers=registers,
                                   channel="vertices", source=source)

    def test_snapshot_is_immutable(self):
        with self.assertRaises(dataclasses.FrozenInstanceError):
            self.memory.snapshot().face_id = 8


if __name__ == "__main__":
    unittest.main()
