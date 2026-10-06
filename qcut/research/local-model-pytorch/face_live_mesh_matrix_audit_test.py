"""Synthetic hostile-memory tests; no runtime, model, renderer or GPU required."""
from dataclasses import replace
import struct
import unittest

from face_live_mesh_abi import CORE_UUID
from face_live_mesh_capture import digest
from face_live_mesh_capture_test import MeshMemory
from face_live_mesh_matrix_abi import IDENTITIES, PROPERTY_VPTR, SITES
from face_live_mesh_matrix_audit import MatrixAudit
from face_live_mesh_matrix_capture import MatrixReader, MatrixScope, lookup_property


class MatrixMemory(MeshMemory):
    def __init__(self, *, branch="update"):
        super().__init__(count=1463)
        self.branch = branch
        self.scope = MatrixScope(prediction=1, timestamp_us=0, thread=42, face_id=self.face_id,
                                 core_slide=self.slide, agfx_slide=0x200000000)
        # Non-symmetric matrices catch row/column swaps and zero/identity substitutions.
        self.put(address=self.mesh + 0x40, data=struct.pack("<32f", *(index / 4 for index in range(32))))
        self.source = self.snapshot()
        self.clones = {"mvp": 0x100000, "model_matrix": 0x100100}
        self.temporaries = {"mvp": 0x120000, "model_matrix": 0x121000}
        self.variant_wrappers = {"mvp": 0x122000, "model_matrix": 0x123000}
        self.variant_objects = {"mvp": 0x124000, "model_matrix": 0x125000}
        self.getter_stacks = {"mvp": 0x126000, "model_matrix": 0x127000}
        self.renderer, self.block, self.destination_mesh = 0x101000, 0x102000, 0x5000
        self.put(address=self.renderer + 0x108, data=struct.pack("<Q", self.destination_mesh))
        self.put(address=self.renderer + 0x118, data=struct.pack("<Q", self.block))
        self.setter_sp, self.renderer_lr = 0x200000, self.slide + 0x123400
        self.uniforms = {}
        for index, (channel, name, offset) in enumerate((("model_matrix", b"uModel", 0x80),
                                                       ("mvp", b"uMVP", 0x40))):
            base = 0x110000 + index * 0x1000
            row = dict(name=name, key=101 + index, wrapper=base, name_object=base + 0x100,
                       property=base + 0x200, destination=base + 0x300,
                       name_pointer=base + 0x400, node=base + 0x500)
            self.uniforms[channel] = row
            payload = self.source.header[offset:offset + 64]
            self.put(address=self.clones[channel], data=payload)
            self.put(address=self.temporaries[channel], data=payload)
            wrapper = bytearray(40)
            struct.pack_into("<I", wrapper, 0, 1)
            struct.pack_into("<Q", wrapper, 16, self.variant_objects[channel])
            wrapper[32] = 1
            self.put(address=self.variant_wrappers[channel], data=bytes(wrapper))
            self.put(address=self.variant_objects[channel], data=struct.pack("<Q", self.clones[channel]))
            self.put(address=self.variant_objects[channel] + 0x80, data=struct.pack("<I", 8))
            self.put(address=self.getter_stacks[channel] + 8, data=struct.pack("<Q", self.temporaries[channel]))
            self.put(address=self.getter_stacks[channel] + 0x88, data=struct.pack("<I", 8))
            self.put(address=row["wrapper"], data=struct.pack("<Q", row["name_object"]))
            header = bytearray(36)
            header[8:8 + len(name)] = name
            header[31] = len(name)
            struct.pack_into("<i", header, 32, row["key"])
            self.put(address=row["name_object"], data=bytes(header))
            self.put(address=row["name_pointer"], data=name + b"\0")
            prop = bytearray(64)
            struct.pack_into("<Q", prop, 0, self.scope.agfx_slide + PROPERTY_VPTR)
            struct.pack_into("<I", prop, 12, 28)
            struct.pack_into("<Q", prop, 16, row["name_pointer"])
            struct.pack_into("<I", prop, 24, 1)
            struct.pack_into("<Q", prop, 32, row["destination"])
            struct.pack_into("<iI", prop, 48, -1, 64)
            prop[58] = 1
            self.put(address=row["property"], data=bytes(prop))
        model, mvp = self.uniforms["model_matrix"], self.uniforms["mvp"]
        for current, following in ((model, mvp["node"]), (mvp, 0)):
            self.put(address=current["node"], data=struct.pack("<QQi4xQ", following,
                     current["key"], current["key"], current["property"]))
        self.put(address=self.block + 0x98, data=struct.pack("<4Q", 0x300000, 2, model["node"], 2))
        self.audit = MatrixAudit(source=self.source, scope=self.scope, read=self.read)

    def receipt(self, *, channel):
        vector = getattr(self.source, channel)
        return dict(event="native_mesh_copy", channel=channel, prediction=1, timestamp_us=0,
                    thread=42, face_id=self.face_id, vertices=1463, source_begin=vector.begin,
                    sha256=digest(data=vector.data), stride=32, destination_mesh=self.destination_mesh,
                    destination_begin=0x40000 + (20 if channel == "normals" else 0),
                    all_destination_bytes_equal=True, final_loaded_registers_equal=True,
                    cpu_mesh_copy_observed=True)

    def registers(self):
        audit, mode = self.audit, self.audit.mode
        channel = audit.channel
        row = self.uniforms[channel]
        if mode in ("mvp_getter", "model_getter"):
            channel = "mvp" if mode == "mvp_getter" else "model_matrix"
            data = audit.data(channel=channel)
            return dict(x0=self.temporaries[channel], x19=self.mesh, q0=data[32:48], q1=data[48:],
                        x20=self.variant_wrappers[channel], sp=self.getter_stacks[channel],
                        x30=self.slide + (0xC2D8CC if channel == "mvp" else 0xC2D918))
        if mode in ("mvp_saved", "model_saved"):
            channel = "mvp" if mode == "mvp_saved" else "model_matrix"
            return dict(x0=self.variant_wrappers[channel], x19=self.mesh, x20=self.variant_wrappers[channel],
                        sp=self.getter_stacks[channel], x30=self.slide + SITES[mode][1])
        if mode == "renderer_enter":
            return dict(x0=self.renderer, x30=self.renderer_lr)
        if mode == "renderer_return":
            return dict(x0=self.block, x30=self.renderer_lr)
        if mode == "setter":
            return dict(x0=self.block, x1=row["wrapper"], x2=self.clones[channel], sp=self.setter_sp)
        if mode == "lookup":
            self.put(address=self.setter_sp - 0x14, data=struct.pack("<i", row["key"]))
            return dict(x19=self.block + 0x88, x20=row["node"] if self.branch == "update" else 0,
                        x22=self.clones[channel], x23=1, x24=0xFFFFFFFF, x25=28,
                        x26=self.setter_sp - 0x14, x27=4, x28=4, sp=self.setter_sp - 0xB0)
        if mode.endswith("_before"):
            return dict(x0=row["destination"], x1=self.clones[channel], x2=64,
                        x19=row["property"], x20=self.clones[channel])
        if mode.endswith("_after"):
            self.put(address=row["destination"], data=audit.data(channel=channel))
            return dict(x0=row["destination"], x19=row["property"], x20=self.clones[channel],
                        x30=self.scope.agfx_slide + SITES[mode][1])
        return dict(sp=self.setter_sp - 0x20)

    def advance(self, **overrides):
        if self.audit.mode == "mesh_copies":
            self.audit.bind_mesh_copies(vertices=self.receipt(channel="vertices"),
                                       normals=self.receipt(channel="normals"))
            return
        site = self.audit.expected_site()
        registers = overrides["registers"] if "registers" in overrides else self.registers()
        values = dict(module_uuid=site["uuid"], file_pc=site["file_pc"], scope=self.scope,
                      registers=registers, callers=[(CORE_UUID, 0x5183DC if self.branch == "update" else 0x5184E0)])
        values.update(overrides)
        return self.audit.observe(**values)

    def until(self, *, mode):
        for _ in range(20):
            if self.audit.mode == mode:
                return
            self.advance()
        raise AssertionError("synthetic matrix sequence did not reach requested mode")


class MatrixAuditTests(unittest.TestCase):
    def test_both_native_copy_branches_complete_but_never_claim_owned_or_gpu(self):
        for branch in ("update", "create"):
            with self.subTest(branch=branch):
                memory = MatrixMemory(branch=branch)
                memory.until(mode="complete")
                result = memory.audit.report()
                self.assertTrue(result["complete"])
                self.assertTrue(result["matrix_cpu_consumer_verified"])
                self.assertEqual(len(result["events"]), 18)
                self.assertLess(result["read_bytes"], 16000)
                for name in ("qcut_mesh_ownership_verified", "gpu_consumption_verified",
                             "matrix_consumer_verified", "renderer_consumption", "product_backend_enabled",
                             "target_memory_written"):
                    self.assertFalse(result[name])

    def test_partial_missing_and_reordered_stops_fail_closed(self):
        for mode in ("mvp_getter", "mvp_saved", "model_getter", "model_saved", "renderer_enter", "setter", "update_after", "setter_return"):
            with self.subTest(mode=mode):
                memory = MatrixMemory()
                memory.until(mode=mode)
                self.assertFalse(memory.audit.report()["complete"])
                with self.assertRaisesRegex(ValueError, "unexpected"):
                    memory.advance(file_pc=SITES[mode][1] + 4)
                self.assertTrue(memory.audit.report()["failed"])
                with self.assertRaises(ValueError):
                    memory.audit.observe(module_uuid="bad", file_pc=0, scope=memory.scope, registers={})

    def test_prediction_time_face_thread_and_slides_are_immutable(self):
        for field in ("prediction", "timestamp_us", "face_id", "thread", "core_slide", "agfx_slide"):
            memory = MatrixMemory()
            scope = replace(memory.scope, **{field: getattr(memory.scope, field) + (4096 if "slide" in field else 1)})
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "scope"):
                memory.advance(scope=scope)

    def test_wrong_module_and_short_read_are_rejected(self):
        memory = MatrixMemory()
        with self.assertRaises(ValueError):
            memory.advance(module_uuid=IDENTITIES["agfx"][0])
        with self.assertRaisesRegex(ValueError, "short"):
            MatrixAudit(source=memory.source, scope=memory.scope, read=lambda **_: b"")

    def test_getter_registers_pointer_identity_and_all_64_bytes_required(self):
        for change in ("source", "clone", "register", "return", "interior"):
            memory = MatrixMemory()
            registers = memory.registers()
            if change == "source":
                registers["x19"] += 8
            elif change == "clone":
                registers["x0"] = memory.mesh + 0x40
            elif change == "register":
                registers["q0"] = bytes(16)
            elif change == "return":
                registers["x30"] += 4
            else:
                memory.put(address=registers["x0"] + 16, data=bytes(4))
            with self.subTest(change=change), self.assertRaises(ValueError):
                memory.advance(registers=registers)

    def test_matrix_clone_or_source_mutation_is_not_ownership(self):
        for address_kind in ("source", "clone"):
            memory = MatrixMemory()
            memory.until(mode="setter")
            address = memory.mesh + 0x80 if address_kind == "source" else memory.clones["mvp"]
            memory.put(address=address, data=b"xxxx")
            with self.subTest(address_kind=address_kind), self.assertRaisesRegex(ValueError, "changed"):
                memory.advance()

    def test_temporary_can_be_freed_after_save_but_retained_pointer_is_used(self):
        memory = MatrixMemory()
        memory.until(mode="model_getter")
        self.assertEqual(memory.audit.clones, {"mvp": memory.clones["mvp"]})
        memory.put(address=memory.temporaries["mvp"], data=b"freed---" * 8)
        memory.until(mode="mesh_copies")
        memory.put(address=memory.temporaries["model_matrix"], data=b"reused--" * 8)
        memory.until(mode="complete")
        self.assertTrue(memory.audit.report()["complete"])
        setters = [row for row in memory.audit.events if row["mode"] == "setter"]
        self.assertEqual([row["clone"] for row in setters],
                         [memory.clones["model_matrix"], memory.clones["mvp"]])

    def test_saved_copy_rejects_wrong_variant_type_ownership_alias_or_bytes(self):
        for change in ("stack_pointer", "stack_type", "wrapper_type", "unowned", "object_type",
                       "alias_temporary", "alias_source", "temporary_bytes", "retained_bytes", "scope"):
            memory = MatrixMemory()
            memory.until(mode="mvp_saved")
            registers = memory.registers()
            address, data = {
                "stack_pointer": (memory.getter_stacks["mvp"] + 8, struct.pack("<Q", memory.temporaries["model_matrix"])),
                "stack_type": (memory.getter_stacks["mvp"] + 0x88, struct.pack("<I", 7)),
                "wrapper_type": (memory.variant_wrappers["mvp"], struct.pack("<I", 2)),
                "unowned": (memory.variant_wrappers["mvp"] + 32, b"\0"),
                "object_type": (memory.variant_objects["mvp"] + 0x80, struct.pack("<I", 7)),
                "alias_temporary": (memory.variant_objects["mvp"], struct.pack("<Q", memory.temporaries["mvp"])),
                "alias_source": (memory.variant_objects["mvp"], struct.pack("<Q", memory.mesh + 0x40)),
                "temporary_bytes": (memory.temporaries["mvp"] + 20, b"xxxx"),
                "retained_bytes": (memory.clones["mvp"] + 20, b"xxxx"),
                "scope": (memory.getter_stacks["mvp"], b"\0"),
            }[change]
            memory.put(address=address, data=data)
            if change == "scope":
                registers["x30"] += 4
            with self.subTest(change=change), self.assertRaises(ValueError):
                memory.advance(registers=registers)

    def test_getter_alone_cannot_supply_retained_lua_pointer(self):
        memory = MatrixMemory()
        memory.advance()
        self.assertEqual(memory.audit.mode, "mvp_saved")
        self.assertEqual(memory.audit.clones, {})
        with self.assertRaisesRegex(ValueError, "waiting"):
            memory.audit.bind_mesh_copies(vertices=memory.receipt(channel="vertices"),
                                         normals=memory.receipt(channel="normals"))

    def test_variant_snapshot_is_not_proof_of_persistent_lua_userdata(self):
        memory = MatrixMemory()
        memory.until(mode="model_getter")
        persistent_lua = 0x128000
        memory.put(address=persistent_lua, data=memory.audit.data(channel="mvp"))
        memory.put(address=memory.clones["mvp"], data=b"freed---" * 8)
        with self.assertRaisesRegex(ValueError, "Lua clone changed"):
            memory.advance()
        self.assertTrue(memory.audit.failed)
        self.assertFalse(memory.audit.report()["matrix_cpu_consumer_verified"])
        self.assertNotEqual(memory.temporaries["mvp"], memory.clones["mvp"])
        self.assertNotEqual(memory.clones["mvp"], persistent_lua)

    def test_identical_third_copy_cannot_silently_replace_observed_variant_pointer(self):
        memory = MatrixMemory()
        memory.until(mode="setter")
        persistent_lua = 0x128000
        memory.put(address=persistent_lua, data=memory.audit.data(channel="model_matrix"))
        registers = memory.registers()
        registers["x2"] = persistent_lua
        with self.assertRaisesRegex(ValueError, "Lua matrix pointer differs"):
            memory.advance(registers=registers)
        self.assertFalse(memory.audit.report()["complete"])

    def test_mesh_receipts_must_match_prediction_scope_and_exact_mesh(self):
        for field, value in (("prediction", 2), ("thread", 99), ("face_id", 8), ("vertices", 1256),
                             ("sha256", "bad"), ("cpu_mesh_copy_observed", False),
                             ("destination_mesh", 0x9000), ("destination_begin", 0x80000)):
            memory = MatrixMemory()
            memory.until(mode="mesh_copies")
            normals = memory.receipt(channel="normals")
            normals[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                memory.audit.bind_mesh_copies(vertices=memory.receipt(channel="vertices"), normals=normals)
            self.assertTrue(memory.audit.failed)

    def test_renderer_props_must_refer_to_the_mesh_that_received_vertices(self):
        for offset in (0x108, 0x118):
            memory = MatrixMemory()
            memory.until(mode="setter")
            memory.put(address=memory.renderer + offset, data=struct.pack("<Q", 0x6000))
            with self.subTest(offset=offset), self.assertRaisesRegex(ValueError, "renderer"):
                memory.advance()

    def test_uniform_name_key_pointer_and_dimensions_not_guessed(self):
        for change in ("name", "long", "clone", "dimensions", "key", "stack"):
            memory = MatrixMemory()
            memory.until(mode="setter" if change in ("name", "long", "clone") else "lookup")
            row = memory.uniforms["model_matrix"]
            registers = memory.registers()
            if change == "name":
                memory.put(address=row["name_object"] + 8, data=b"uMVP\0\0")
            elif change == "long":
                memory.put(address=row["name_object"] + 31, data=b"\x80")
            elif change == "clone":
                registers["x2"] += 4
            elif change == "dimensions":
                registers["x28"] = 3
            elif change == "key":
                memory.put(address=registers["x26"], data=struct.pack("<i", -1))
            else:
                registers["sp"] += 16
            with self.subTest(change=change), self.assertRaises(ValueError):
                memory.advance(registers=registers)

    def test_memcpy_context_type_size_alias_and_full_interior_bytes(self):
        for change in ("caller", "size", "vptr", "symbol", "count", "ownership", "alias", "interior", "return"):
            memory = MatrixMemory()
            memory.until(mode="update_after" if change in ("interior", "return") else "update_before")
            row = memory.uniforms["model_matrix"]
            registers = memory.registers()
            overrides = {}
            if change == "caller":
                overrides["callers"] = [(CORE_UUID, 0x5184E0)]
            elif change == "size":
                registers["x2"] = 60
            elif change in ("vptr", "symbol", "count", "ownership"):
                offset = {"vptr": 0, "symbol": 12, "count": 24, "ownership": 58}[change]
                memory.put(address=row["property"] + offset, data=b"\0")
            elif change == "alias":
                memory.put(address=row["property"] + 32, data=struct.pack("<Q", memory.clones["mvp"]))
            elif change == "interior":
                memory.put(address=row["destination"] + 20, data=b"xxxx")
            else:
                registers["x30"] += 4
            # Do not synthesize memcpy again after corrupting its destination.
            site = memory.audit.expected_site()
            with self.subTest(change=change), self.assertRaises(ValueError):
                memory.audit.observe(module_uuid=site["uuid"], file_pc=site["file_pc"], scope=memory.scope,
                    registers=registers, callers=overrides.get("callers", [(CORE_UUID, 0x5183DC)]))

    def test_setter_return_requires_property_retained_by_same_block(self):
        memory = MatrixMemory()
        memory.until(mode="setter_return")
        memory.put(address=memory.uniforms["model_matrix"]["node"] + 24, data=struct.pack("<Q", 0x6000))
        with self.assertRaisesRegex(ValueError, "retained"):
            memory.advance()

    def test_bounded_map_rejects_cycle_count_duplicate_and_missing_key(self):
        for change in ("cycle", "count", "duplicate", "missing"):
            memory = MatrixMemory()
            model, mvp = memory.uniforms["model_matrix"], memory.uniforms["mvp"]
            if change == "cycle":
                memory.put(address=model["node"], data=struct.pack("<Q", model["node"]))
            elif change == "count":
                memory.put(address=memory.block + 0xB0, data=struct.pack("<Q", 65))
            elif change == "duplicate":
                memory.put(address=mvp["node"] + 16, data=struct.pack("<i", model["key"]))
            else:
                memory.put(address=model["node"] + 16, data=struct.pack("<i", -1))
            with self.subTest(change=change), self.assertRaises(ValueError):
                lookup_property(reader=MatrixReader(read=memory.read), block=memory.block, name_id=model["key"])

    def test_reader_budgets_alignment_overflow_and_short_reads(self):
        reader = MatrixReader(read=lambda **kw: bytes(kw["size"]))
        for address, size in ((0, 8), (True, 8), (2**53 - 4, 8), (0x1000, 513), (0x1000, -1)):
            with self.subTest(address=address, size=size), self.assertRaises(ValueError):
                reader.read(address=address, size=size)
        for _ in range(16):
            reader.read(address=0x1000, size=512)
        with self.assertRaisesRegex(ValueError, "budget"):
            reader.read(address=0x1000, size=1)
        for _ in range(7):
            reader.begin_callback()
            for _ in range(16):
                reader.read(address=0x1000, size=512)
        reader.begin_callback()
        with self.assertRaisesRegex(ValueError, "budget"):
            reader.read(address=0x1000, size=1)


if __name__ == "__main__":
    unittest.main()
