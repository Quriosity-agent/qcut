"""Read-only single-face matrix state machine, independent of LLDB integration.

Parent verifies both libraries, starts after the mesh getter, and lends one HW
slot to expected_site(). After two matrix getters, borrow it back for existing
vertex/normal copies, then resume with bind_mesh_copies(). Unknown stops must
stop the target. Each audit is fresh for one prediction/thread/face, never reused.

The pinned live route currently rejects at model_getter: the saved BachVariant
is temporary too. EngineVariant/Lua copies still need their own identity-bound
stops; synthetic full-route coverage does not qualify that native lifetime.
"""
from __future__ import annotations

from dataclasses import asdict
import struct

from face_live_mesh_abi import FIELDS, require
from face_live_mesh_capture import digest, pointer
from face_live_mesh_matrix_abi import CORE_UUID, IDENTITIES, PROPERTY_STORE, SITES
from face_live_mesh_matrix_capture import (
    MatrixReader, MatrixScope, copied_property, getter_copy, lookup_property,
    renderer_binding, saved_copy, unchanged_source, uniform_name, word,
)

MAX_STOPS = 18


class MatrixAudit:
    def __init__(self, *, source, scope, read):
        require(condition=type(scope) is MatrixScope, message="immutable matrix scope required")
        self.source, self.scope = source, scope
        self.reader = MatrixReader(read=read)
        self.mode, self.failed = "mvp_getter", False
        self.events, self.clones, self.copies = [], {}, []
        self.temporary = None
        self.destination_mesh = None
        self.renderer, self.block, self.property = None, None, None
        self.name_id, self.node, self.destination = None, None, None
        self.setter_sp, self.name_wrapper, self.renderer_lr = None, None, None
        self.channel, self.branch = "model_matrix", None
        unchanged_source(reader=self.reader, source=source, scope=scope)

    def expected_site(self):
        if self.failed or self.mode not in SITES:
            return None
        role, pc = SITES[self.mode]
        return dict(mode=self.mode, module=role, uuid=IDENTITIES[role][0], file_pc=pc)

    def bind_mesh_copies(self, *, vertices, normals):
        try:
            require(condition=not self.failed and self.mode == "mesh_copies",
                    message="matrix audit is not waiting for mesh copies")
            for channel, row in (("vertices", vertices), ("normals", normals)):
                vector = getattr(self.source, channel)
                expected = dict(event="native_mesh_copy", channel=channel,
                    prediction=self.scope.prediction, timestamp_us=self.scope.timestamp_us,
                    thread=self.scope.thread, face_id=self.scope.face_id, vertices=vector.count,
                    source_begin=vector.begin, sha256=digest(data=vector.data), stride=32)
                require(condition=all(type(row.get(key)) is type(value) and row[key] == value
                                      for key, value in expected.items()) and
                        all(row.get(key) is True for key in ("all_destination_bytes_equal",
                            "final_loaded_registers_equal", "cpu_mesh_copy_observed")),
                        message="unmatched native mesh copy receipt")
            destination = pointer(value=vertices["destination_mesh"])
            require(condition=normals["destination_mesh"] == destination and
                    normals["destination_begin"] == vertices["destination_begin"] + 20,
                    message="matrix renderer mesh copy layout differs")
            self.destination_mesh = destination
            self.mode = "renderer_enter"
        except Exception:
            self.failed = True
            raise

    def observe(self, *, module_uuid, file_pc, scope, registers, callers=()):
        try:
            site = self.expected_site()
            require(condition=site is not None and len(self.events) < MAX_STOPS and
                    type(file_pc) is int and module_uuid == site["uuid"] and file_pc == site["file_pc"],
                    message="unexpected matrix consumer stop")
            require(condition=type(scope) is MatrixScope and scope == self.scope,
                    message="matrix consumer left prediction/thread/face scope")
            self.reader.begin_callback()
            unchanged_source(reader=self.reader, source=self.source, scope=scope)
            for channel, clone in self.clones.items():
                require(condition=self.reader.read(address=clone, size=64) == self.data(channel=channel),
                        message="matrix Lua clone changed")
            mode = self.mode
            row = self._observe(registers=registers, callers=callers)
            event = dict(mode=mode, module_uuid=module_uuid, file_pc=file_pc,
                         scope=asdict(scope), **row)
            self.events.append(event)
            return event
        except Exception:
            self.failed = True
            raise

    def data(self, *, channel):
        offset = FIELDS[channel]
        return self.source.header[offset:offset + 64]

    def require_renderer(self):
        require(condition=renderer_binding(reader=self.reader, renderer=self.renderer,
                    destination_mesh=self.destination_mesh) == self.block,
                message="matrix renderer property block changed")

    def _observe(self, *, registers, callers):
        if self.mode in ("mvp_getter", "model_getter"):
            channel = "mvp" if self.mode == "mvp_getter" else "model_matrix"
            row = getter_copy(reader=self.reader, registers=registers, channel=channel,
                             source=self.source, scope=self.scope, other_clones=self.clones.values())
            self.temporary = row
            self.mode = "mvp_saved" if channel == "mvp" else "model_saved"
            return row
        if self.mode in ("mvp_saved", "model_saved"):
            channel = "mvp" if self.mode == "mvp_saved" else "model_matrix"
            require(condition=self.temporary is not None and self.temporary["channel"] == channel,
                    message="missing temporary matrix identity")
            row = saved_copy(reader=self.reader, registers=registers, pending=self.temporary,
                             source=self.source, scope=self.scope, other_clones=self.clones.values())
            self.clones[channel] = row["pointer"]
            self.temporary = None
            self.mode = "model_getter" if channel == "mvp" else "mesh_copies"
            return row
        if self.mode == "renderer_enter":
            renderer = pointer(value=registers["x0"])
            block = renderer_binding(reader=self.reader, renderer=renderer, destination_mesh=self.destination_mesh)
            require(condition=self.renderer in (None, renderer) and self.block in (None, block),
                    message="matrix pair changed renderer/block")
            self.renderer, self.block = renderer, block
            self.renderer_lr = pointer(value=registers["x30"], alignment=4)
            self.mode = "renderer_return"
            return dict(renderer=renderer, block=block, channel=self.channel)
        self.require_renderer()
        if self.mode == "renderer_return":
            require(condition=registers["x0"] == self.block and registers["x30"] == self.renderer_lr,
                    message="renderer props actual load differs")
            self.mode = "setter"
            return dict(block=self.block, actual_props_load_verified=True)
        if self.mode == "setter":
            require(condition=registers["x0"] == self.block and
                    registers["x2"] == self.clones[self.channel],
                    message="setMatrix block or Lua matrix pointer differs")
            self.setter_sp = pointer(value=registers["sp"])
            self.name_wrapper = pointer(value=registers["x1"])
            self.name_id = uniform_name(reader=self.reader, wrapper=self.name_wrapper, channel=self.channel)
            require(condition=not self.copies or self.name_id != self.copies[0]["name_id"],
                    message="model/MVP uniform identity collision")
            self.mode = "lookup"
            return dict(block=self.block, name_id=self.name_id, channel=self.channel,
                        clone=self.clones[self.channel])
        if self.mode == "lookup":
            require(condition=registers["x19"] == self.block + PROPERTY_STORE and
                    registers["x22"] == self.clones[self.channel] and registers["x23"] == 1 and
                    registers["x24"] == 0xFFFFFFFF and registers["x25"] == 28 and
                    registers["x27"] == 4 and registers["x28"] == 4 and
                    registers["sp"] == self.setter_sp - 0xB0 and
                    struct.unpack("<i", self.reader.read(address=registers["x26"], size=4))[0] == self.name_id,
                    message="setMatrix shape/store/lookup scope differs")
            self.node = registers["x20"]
            require(condition=type(self.node) is int and self.node >= 0,
                    message="invalid matrix lookup node")
            self.branch = "update" if self.node else "create"
            if self.node:
                pointer(value=self.node)
                self.property = pointer(value=word(reader=self.reader, address=self.node + 24))
            self.mode = self.branch + "_before"
            return dict(branch=self.branch, node=self.node)
        if self.mode.endswith("_before"):
            caller = 0x5183DC if self.branch == "update" else 0x5184E0
            require(condition=(CORE_UUID, caller) in callers and
                    registers["x20"] == self.clones[self.channel] and
                    registers["x1"] == self.clones[self.channel] and registers["x2"] == 64,
                    message="unmatched DeviceProperty memcpy source/extent/caller")
            prop = pointer(value=registers["x19"])
            require(condition=self.branch == "create" or prop == self.property,
                    message="DeviceProperty differs from looked-up property")
            self.property = prop
            self.destination = self.check_property(after=False)
            require(condition=registers["x0"] == self.destination,
                    message="DeviceProperty memcpy destination differs")
            require(condition=not self.copies or (self.property != self.copies[0]["property"] and
                    self.destination != self.copies[0]["destination"]),
                    message="model/MVP property storage reused")
            self.mode = self.branch + "_after"
            return dict(property=prop, destination=self.destination, channel=self.channel)
        if self.mode.endswith("_after"):
            pc = SITES[self.mode][1]
            require(condition=registers["x19"] == self.property and
                    registers["x20"] == self.clones[self.channel] and
                    registers["x30"] == self.scope.agfx_slide + pc and
                    registers["x0"] == self.destination,
                    message="DeviceProperty memcpy return mismatch")
            require(condition=self.check_property(after=True) == self.destination,
                    message="DeviceProperty destination changed")
            self.mode = "setter_return"
            return dict(channel=self.channel, property=self.property,
                        all_64_bytes_equal=True, native_cpu_copy_observed=True)
        require(condition=self.mode == "setter_return" and registers["sp"] == self.setter_sp - 0x20,
                message="setMatrix return stack differs")
        require(condition=uniform_name(reader=self.reader, wrapper=self.name_wrapper, channel=self.channel)
                    == self.name_id and self.check_property(after=True) == self.destination and
                lookup_property(reader=self.reader, block=self.block, name_id=self.name_id) == self.property,
                message="matrix property not retained by bound renderer block")
        receipt = dict(channel=self.channel, name_id=self.name_id, property=self.property,
                       destination=self.destination, sha256=digest(data=self.data(channel=self.channel)),
                       native_cpu_property_copy_verified=True)
        self.copies.append(receipt)
        self.channel = "mvp"
        self.mode = "complete" if len(self.copies) == 2 else "renderer_enter"
        return receipt

    def check_property(self, *, after):
        return copied_property(reader=self.reader, address=self.property, channel=self.channel,
            scope=self.scope, expected=self.data(channel=self.channel), source=self.source,
            clones=self.clones.values(), after=after)

    def report(self):
        complete = not self.failed and self.mode == "complete" and len(self.events) == MAX_STOPS
        return dict(schema="face-live-mesh-matrix-cpu-audit-v1", complete=complete,
            failed=self.failed, mode=self.mode, events=list(self.events), read_bytes=self.reader.total,
            matrix_cpu_consumer_verified=complete, matrix_consumer_verified=False,
            renderer_consumption=False, qcut_mesh_ownership_verified=False,
            gpu_consumption_verified=False, product_backend_enabled=False,
            target_memory_written=False)
