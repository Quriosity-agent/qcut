"""Pinned, read-only 1256 mesh ABI inventory; never loads a native library."""
from __future__ import annotations

import hashlib
from pathlib import Path
import struct
import uuid

from ocr_decode_binary import MachO
from face_render_requirement_trace import adrp_add_address

CORE_UUID = "D6342ECD-5432-33F0-A2AD-0C28F5699994"
CORE_SHA256 = "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9"
MESH_VPTR = 0x360EF18
FITTING_VPTR = 0x360EF70
BUFFER_TYPE = 16
VERTICES = 1256
SITES = {"getter": 0xC16980, "vertices": 0x88CCCC, "normals": 0x88CDF0}
COPY_RETURNS = {"vertices": 0x88CCC8, "normals": 0x88CDEC}
GETTER_CALLERS = {0xC1F6C8, 0xC29680}
FIELDS = {"face_id": 0xC, "vertices": 0x10, "normals": 0x28,
          "mvp": 0x40, "model_matrix": 0x80}


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def validate_image(*, image):
    cursor, identities = 32, []
    for _ in range(struct.unpack_from("<I", image.data, 16)[0]):
        kind, size = struct.unpack_from("<II", image.data, cursor)
        if kind == 0x1B:
            require(condition=size == 24, message="invalid mesh image UUID command")
            identities.append(str(uuid.UUID(bytes=image.data[cursor + 8:cursor + 24])).upper())
        cursor += size
    require(condition=identities == [CORE_UUID], message="mesh image UUID mismatch")
    require(condition=struct.unpack("<I", image.read(address=0x2CF88B8, length=4))[0] == BUFFER_TYPE,
            message="mesh fitting lookup is not type 16")
    constructors = ((0xCDF11C, MESH_VPTR - 16), (0xCE0E34, FITTING_VPTR))
    for address, expected in constructors:
        require(condition=adrp_add_address(data=image.read(address=address, length=8),
                    address=address, register=8) == expected, message="mesh type identity changed")
    bindings = ((0xC1CCC0, "getFaceFittingCount1256"),
                (0xC1CCF4, "getFaceMeshInfo1256"),
                (0x88BD6C, "setVertexArray"), (0x88BDEC, "setNormalArray"))
    for address, name in bindings:
        register = 1 if name.startswith("get") else 0
        target = adrp_add_address(data=image.read(address=address, length=8),
                                  address=address, register=register)
        require(condition=image.read(address=target, length=len(name) + 1) == name.encode() + b"\0",
                message="mesh Lua method binding changed")
    return dict(schema="face-live-mesh-abi-v1", uuid=CORE_UUID, sha256=CORE_SHA256,
                buffer_type=BUFFER_TYPE, mesh_vptr=MESH_VPTR, fitting_vptr=FITTING_VPTR,
                fields=dict(FIELDS), sites=dict(SITES), abi_family=VERTICES,
                evidence="pinned-binary-static-layout", runtime_consumption_verified=False,
                qcut_mesh_ownership_verified=False)


def verify_library(*, library):
    path = Path(library).resolve(strict=True)
    require(condition=path.is_file() and 0 < path.stat().st_size <= 512 * 1024**2,
            message="bounded regular mesh library required")
    with path.open("rb") as stream:
        data = stream.read(512 * 1024**2 + 1)
    require(condition=hashlib.sha256(data).hexdigest() == CORE_SHA256,
            message="mesh library hash mismatch")
    report = validate_image(image=MachO(data=data))
    report["library"] = str(path)
    return report
