"""Bounded mesh snapshots and whole-copy receipts, not candidate ownership."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
import struct

from face_live_mesh_abi import FIELDS, MESH_VPTR, VERTICES, require

MAX_READ = 512 * 1024
MAX_BUDGET = 1024 * 1024
MAX_STRIDE = 256
PAYLOAD_SIZE = VERTICES * 12


def pointer(*, value, alignment=8):
    require(condition=type(value) is int and 4096 <= value < 2**53 and value % alignment == 0,
            message="invalid mesh pointer")
    return value


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


class ReadBudget:
    def __init__(self, *, read):
        self.reader, self.total = read, 0

    def read(self, *, address, size):
        pointer(value=address, alignment=4)
        require(condition=type(size) is int and 0 < size <= MAX_READ and
                address + size < 2**53 and self.total + size <= MAX_BUDGET,
                message="mesh read budget exceeded")
        self.total += size
        data = self.reader(address=address, size=size)
        require(condition=isinstance(data, bytes) and len(data) == size, message="short mesh read")
        return data


@dataclass(frozen=True, kw_only=True)
class VectorSnapshot:
    vector: int
    begin: int
    end: int
    capacity: int
    data: bytes


@dataclass(frozen=True, kw_only=True)
class MeshSnapshot:
    mesh: int
    face_id: int
    header: bytes
    vertices: VectorSnapshot
    normals: VectorSnapshot


def finite_payload(*, data):
    values = struct.unpack(f"<{len(data) // 4}f", data)
    require(condition=all(math.isfinite(value) for value in values), message="nonfinite mesh payload")


def vector_snapshot(*, reader, vector):
    pointer(value=vector)
    header = reader.read(address=vector + 0x10, size=24)
    begin, end, capacity = struct.unpack("<3Q", header)
    pointer(value=begin, alignment=4)
    require(condition=end - begin == PAYLOAD_SIZE and end <= capacity < 2**53 and
            capacity - begin <= 4096 * 12 and (capacity - begin) % 12 == 0,
            message="mesh vector is not bounded 1256x3 float32")
    data = reader.read(address=begin, size=PAYLOAD_SIZE)
    finite_payload(data=data)
    require(condition=reader.read(address=vector + 0x10, size=24) == header,
            message="mesh vector changed during snapshot")
    return VectorSnapshot(vector=vector, begin=begin, end=end, capacity=capacity, data=data)


def snapshot(*, reader, mesh, slide, face_id):
    pointer(value=mesh)
    require(condition=type(face_id) is int and 0 <= face_id < 2**31,
            message="invalid expected mesh face ID")
    # Lua retains the same object between getter and setters; refcount is not geometry.
    def geometry_header():
        value = reader.read(address=mesh, size=0xC0)
        return value[:8] + bytes(4) + value[12:]

    header = geometry_header()
    require(condition=struct.unpack_from("<Q", header)[0] == slide + MESH_VPTR,
            message="not a pinned FaceMeshInfo")
    require(condition=struct.unpack_from("<i", header, FIELDS["face_id"])[0] == face_id,
            message="mesh face identity mismatch")
    arrays = {name: vector_snapshot(reader=reader, vector=struct.unpack_from("<Q", header, FIELDS[name])[0])
              for name in ("vertices", "normals")}
    require(condition=arrays["vertices"].end <= arrays["normals"].begin or
            arrays["normals"].end <= arrays["vertices"].begin, message="mesh channels alias")
    finite_payload(data=header[0x40:0xC0])
    require(condition=geometry_header() == header, message="mesh header changed")
    return MeshSnapshot(mesh=mesh, face_id=face_id, header=header, **arrays)


def snapshot_report(*, value):
    return dict(mesh=value.mesh, face_id=value.face_id, vertices=VERTICES,
        vectors={name: dict(object=getattr(value, name).vector, begin=getattr(value, name).begin,
                  end=getattr(value, name).end, sha256=digest(data=getattr(value, name).data))
                 for name in ("vertices", "normals")},
        matrices={name: digest(data=value.header[offset:offset + 64])
                  for name, offset in (("mvp", 0x40), ("model_matrix", 0x80))},
        qcut_mesh_ownership_verified=False, renderer_consumption=False)


def whole_copy(*, reader, registers, channel, source):
    require(condition=channel in ("vertices", "normals"), message="invalid mesh copy channel")
    vector = getattr(source, channel)
    reference_name, count_name, offset_name = (("x23", "w25", "w22") if channel == "vertices"
                                               else ("x21", "w22", "w20"))
    reference = pointer(value=registers[reference_name])
    require(condition=struct.unpack("<Q", reader.read(address=reference, size=8))[0] == vector.vector,
            message="mesh copy source wrapper differs from getter")
    require(condition=registers[count_name] == VERTICES and registers[offset_name] == 0 and
            registers["x11"] == 0 and registers["x8"] == vector.end,
            message="incomplete mesh copy or unsupported subrange")
    stack = pointer(value=registers["sp"])
    destination, stride = struct.unpack("<Qi", reader.read(address=stack, size=12))
    pointer(value=destination, alignment=4)
    require(condition=12 <= stride <= MAX_STRIDE and stride % 4 == 0 and
            registers["x9"] == stride and registers["x10"] == destination + VERTICES * stride,
            message="mesh destination stride/end mismatch")
    end = destination + (VERTICES - 1) * stride + 12
    protected = [(source.mesh, source.mesh + len(source.header))]
    for item in (source.vertices, source.normals):
        protected.extend(((item.begin, item.end), (item.vector, item.vector + 0x28)))
    require(condition=all(end <= begin or other_end <= destination for begin, other_end in protected),
            message="mesh destination aliases source")
    output = reader.read(address=destination, size=end - destination)
    packed = b"".join(output[index * stride:index * stride + 12] for index in range(VERTICES))
    require(condition=packed == vector.data and
            reader.read(address=vector.begin, size=PAYLOAD_SIZE) == vector.data,
            message="mesh full-copy bytes differ or source changed")
    require(condition=registers["x12"] == int.from_bytes(vector.data[-12:-4], "little") and
            registers["w13"] == int.from_bytes(vector.data[-4:], "little"),
            message="mesh last loaded registers differ")
    return dict(channel=channel, vertices=VERTICES, source_begin=vector.begin,
                destination_begin=destination, stride=stride, sha256=digest(data=packed),
                all_destination_bytes_equal=True, final_loaded_registers_equal=True,
                cpu_mesh_copy_observed=True, renderer_consumption=False,
                qcut_mesh_ownership_verified=False, gpu_consumption_verified=False)
