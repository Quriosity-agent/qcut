"""Bounded CPU matrix observations; called only at the pinned stopped PCs.

The parent validates hardware breakpoints, live module UUIDs and file addresses.
This module only reads memory and register values supplied by that parent.
"""
from __future__ import annotations

from dataclasses import dataclass
import struct

from face_live_mesh_abi import FIELDS, MESH_VPTR, require
from face_live_mesh_capture import digest, finite_payload, pointer
from face_live_mesh_matrix_abi import (
    PROPERTY_MAP, PROPERTY_VPTR, RENDERER_MESH, RENDERER_PROPS,
    SYMBOL_MAT4, UNIFORMS,
)

MAX_CALLBACK_BYTES = 8192
MAX_SESSION_BYTES = 64 * 1024
MAX_MAP_NODES = 64


class MatrixReader:
    def __init__(self, *, read):
        self.reader, self.total, self.callback_bytes = read, 0, 0

    def begin_callback(self):
        self.callback_bytes = 0

    def read(self, *, address, size):
        pointer(value=address, alignment=1)
        require(condition=type(size) is int and 0 < size <= 512 and address + size < 2**53 and
                self.callback_bytes + size <= MAX_CALLBACK_BYTES and
                self.total + size <= MAX_SESSION_BYTES, message="matrix read budget exceeded")
        self.total += size
        self.callback_bytes += size
        data = self.reader(address=address, size=size)
        require(condition=type(data) is bytes and len(data) == size, message="short matrix read")
        return data


@dataclass(frozen=True, kw_only=True)
class MatrixScope:
    prediction: int
    timestamp_us: int
    thread: int
    face_id: int
    core_slide: int
    agfx_slide: int

    def __post_init__(self):
        for value, upper in ((self.prediction, 4096), (self.timestamp_us, 2**53),
                             (self.face_id, 2**31)):
            require(condition=type(value) is int and 0 <= value < upper,
                    message="invalid matrix observation identity")
        require(condition=type(self.thread) is int and 0 < self.thread < 2**64,
                message="invalid matrix thread")
        for slide in (self.core_slide, self.agfx_slide):
            require(condition=type(slide) is int and 0 <= slide < 2**53 and slide % 4096 == 0,
                    message="invalid matrix image slide")


def word(*, reader, address):
    return struct.unpack("<Q", reader.read(address=address, size=8))[0]


def disjoint(*, address, size, ranges):
    pointer(value=address, alignment=4)
    require(condition=address + size < 2**53 and
            all(address + size <= begin or end <= address for begin, end in ranges),
            message="matrix storage aliases protected source")


def source_ranges(*, source):
    return [(source.mesh, source.mesh + len(source.header)),
            (source.vertices.begin, source.vertices.end), (source.normals.begin, source.normals.end),
            (source.vertices.vector, source.vertices.vector + 0x28),
            (source.normals.vector, source.normals.vector + 0x28)]


def unchanged_source(*, reader, source, scope):
    require(condition=source.face_id == scope.face_id and len(source.header) == 0xC0,
            message="matrix source face/header mismatch")
    current = reader.read(address=source.mesh, size=0xC0)
    normalized = current[:8] + bytes(4) + current[12:]
    require(condition=normalized == source.header and
            struct.unpack_from("<Q", current)[0] == scope.core_slide + MESH_VPTR,
            message="matrix source changed since mesh getter")
    finite_payload(data=current[0x40:0xC0])


def getter_copy(*, reader, registers, channel, source, scope, other_clones):
    require(condition=registers["x19"] == source.mesh, message="matrix getter mesh differs")
    allocation_return = 0xC2D8CC if channel == "mvp" else 0xC2D918
    require(condition=registers["x30"] == scope.core_slide + allocation_return,
            message="matrix getter allocation return differs")
    offset = FIELDS[channel]
    data = source.header[offset:offset + 64]
    destination = pointer(value=registers["x0"], alignment=4)
    disjoint(address=destination, size=64, ranges=source_ranges(source=source) +
             [(value, value + 64) for value in other_clones])
    require(condition=reader.read(address=destination, size=64) == data and
            type(registers["q0"]) is bytes and type(registers["q1"]) is bytes and
            registers["q0"] == data[32:48] and registers["q1"] == data[48:],
            message="matrix getter destination/register bytes differ")
    return dict(channel=channel, pointer=destination, sha256=digest(data=data),
                wrapper=pointer(value=registers["x20"]), stack=pointer(value=registers["sp"]))


def saved_copy(*, reader, registers, pending, source, scope, other_clones):
    channel, temporary = pending["channel"], pending["pointer"]
    expected_pc = 0xC2D8EC if channel == "mvp" else 0xC2D938
    require(condition=registers["x19"] == source.mesh and registers["x0"] == registers["x20"] ==
            pending["wrapper"] and registers["sp"] == pending["stack"] and
            registers["x30"] == scope.core_slide + expected_pc,
            message="matrix variant copy left getter scope")
    stack = pending["stack"]
    require(condition=word(reader=reader, address=stack + 8) == temporary and
            struct.unpack("<I", reader.read(address=stack + 0x88, size=4))[0] == 8,
            message="temporary matrix variant changed")
    wrapper = reader.read(address=pending["wrapper"], size=40)
    require(condition=struct.unpack_from("<I", wrapper)[0] == 1 and wrapper[32] == 1,
            message="matrix variant is not owned")
    obj = pointer(value=struct.unpack_from("<Q", wrapper, 16)[0])
    require(condition=struct.unpack("<I", reader.read(address=obj + 0x80, size=4))[0] == 8,
            message="matrix variant type differs")
    destination = pointer(value=word(reader=reader, address=obj), alignment=4)
    disjoint(address=destination, size=64, ranges=source_ranges(source=source) +
             [(value, value + 64) for value in (*other_clones, temporary)])
    offset = FIELDS[channel]
    expected = source.header[offset:offset + 64]
    require(condition=reader.read(address=temporary, size=64) == expected ==
            reader.read(address=destination, size=64), message="matrix variant copied bytes differ")
    return dict(channel=channel, pointer=destination, temporary=temporary,
                wrapper=pending["wrapper"], object=obj, sha256=digest(data=expected))


def renderer_binding(*, reader, renderer, destination_mesh):
    pointer(value=renderer)
    require(condition=word(reader=reader, address=renderer + RENDERER_MESH) == destination_mesh,
            message="matrix renderer mesh differs from native mesh copy")
    return pointer(value=word(reader=reader, address=renderer + RENDERER_PROPS))


def uniform_name(*, reader, wrapper, channel):
    pointer(value=wrapper)
    name_object = pointer(value=word(reader=reader, address=wrapper))
    header = reader.read(address=name_object, size=36)
    name = UNIFORMS[channel]
    # Both uniform names fit the pinned alternate-layout libc++ short string.
    require(condition=header[31] == len(name) and header[8:9 + len(name)] == name + b"\0",
            message="matrix uniform name/short-string layout mismatch")
    require(condition=word(reader=reader, address=wrapper) == name_object and
            reader.read(address=name_object, size=36) == header,
            message="matrix uniform identity changed")
    return struct.unpack_from("<i", header, 32)[0]


def property_header(*, reader, address, channel, scope):
    pointer(value=address)
    header = reader.read(address=address, size=64)
    require(condition=struct.unpack_from("<Q", header)[0] == scope.agfx_slide + PROPERTY_VPTR and
            struct.unpack_from("<I", header, 12)[0] == SYMBOL_MAT4 and
            struct.unpack_from("<I", header, 24)[0] == 1 and
            struct.unpack_from("<i", header, 48)[0] == -1 and
            struct.unpack_from("<I", header, 52)[0] == 64 and header[58] == 1,
            message="not a pinned owned 64-byte mat4 DeviceProperty")
    name_pointer = pointer(value=struct.unpack_from("<Q", header, 16)[0], alignment=1)
    name = UNIFORMS[channel]
    require(condition=reader.read(address=name_pointer, size=len(name) + 1) == name + b"\0",
            message="DeviceProperty uniform differs")
    return header


def copied_property(*, reader, address, channel, scope, expected, source, clones, after=False):
    header = property_header(reader=reader, address=address, channel=channel, scope=scope)
    destination = pointer(value=struct.unpack_from("<Q", header, 32)[0], alignment=4)
    disjoint(address=destination, size=64, ranges=source_ranges(source=source) +
             [(value, value + 64) for value in clones] + [(address, address + 64)])
    if after:
        require(condition=reader.read(address=destination, size=64) == expected,
                message="DeviceProperty complete matrix copy differs")
    require(condition=reader.read(address=address, size=64) == header,
            message="DeviceProperty changed during snapshot")
    return destination


def lookup_property(*, reader, block, name_id):
    # libc++ unordered_map list: next/hash/key/value; no target-side find() call.
    header = reader.read(address=block + PROPERTY_MAP, size=32)
    _, bucket_count, node, count = struct.unpack("<4Q", header)
    require(condition=1 <= count <= MAX_MAP_NODES and 1 <= bucket_count <= 4096,
            message="matrix property map extent unsupported")
    seen, matches = set(), []
    for _ in range(count):
        pointer(value=node)
        require(condition=node not in seen, message="cyclic matrix property map")
        seen.add(node)
        data = reader.read(address=node, size=32)
        following, _, key, value = struct.unpack("<QQi4xQ", data)
        if key == name_id:
            matches.append(pointer(value=value))
        node = following
    require(condition=node == 0 and len(matches) == 1 and
            reader.read(address=block + PROPERTY_MAP, size=32) == header,
            message="matrix property map identity/count changed")
    return matches[0]
