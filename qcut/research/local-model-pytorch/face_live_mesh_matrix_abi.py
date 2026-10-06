"""Pinned static matrix route: FaceMeshInfo -> props.setMatrix -> DeviceProperty.

The makeup script reads MVP then model before copying vertices/normals, and sets
uModel then uMVP afterwards. These sites are CPU boundaries, not GPU receipts.
No library is loaded or executed by this inventory.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import struct
import uuid

from face_live_mesh_abi import CORE_SHA256, CORE_UUID, require, validate_image
from ocr_decode_binary import MachO

AGFX_UUID = "57ECC10F-8BB8-319C-BA46-AF286E2EBD43"
AGFX_SHA256 = "1b9493940eebda3b79d72b7308adf8abfbff56c9cfce9d7d73b31cd080453eee"
PROPERTY_VPTR = 0x753E40
SYMBOL_MAT4 = 28
RENDERER_MESH = 0x108
RENDERER_PROPS = 0x118
PROPERTY_STORE = 0x88
PROPERTY_MAP = 0x98
UNIFORMS = {"model_matrix": b"uModel", "mvp": b"uMVP"}
IDENTITIES = {"core": (CORE_UUID, CORE_SHA256), "agfx": (AGFX_UUID, AGFX_SHA256)}

SITES = {
    "mvp_getter": ("core", 0xC2D8DC),
    "mvp_saved": ("core", 0xC2D8EC),
    "model_getter": ("core", 0xC2D928),
    "model_saved": ("core", 0xC2D938),
    "renderer_enter": ("core", 0x54CF94),
    "renderer_return": ("core", 0x54CF98),
    "setter": ("core", 0x5181E8),
    "lookup": ("core", 0x518460),
    "update_before": ("agfx", 0xBF640),
    "update_after": ("agfx", 0xBF644),
    "create_before": ("agfx", 0xBF788),
    "create_after": ("agfx", 0xBF78C),
    "setter_return": ("core", 0x5183DC),
}

# Hashes cover the registration, save thunks, branches and complete copy paths.
REGIONS = {
    "core": (
        (0xC2D588, 0x50, "a37cda51a55dc6743b6af3c17d5a4f1091ca26ac017aa2d81590ec0bf30d6ea1"),
        (0xC2D8B8, 0x98, "8ef530ae3410ba20d1c1561a2b7265424d13e11e0ef9762cf128abef1c425bfd"),
        (0xC23B08, 0x18, "114f28b64803a228ca12ab46373574b561b8350727fc4ef15ad9fe7b0803698a"),
        (0x54CBDC, 0x20, "ee4b04776ea0a74edfa44a3fffd3d5e4e4b7ffb187fc9caaaacedf97725df031"),
        (0x54CF94, 8, "6b4bd3caf59a966f0a9573ab8aed6b5676fa06f09b8bc6d63c85953eb8131f53"),
        (0x897834, 0x20, "4baa6d1a926a1bd6cec61549d869a289cc6aa01152cefbaaa60f3a9f32ffa9ec"),
        (0x517DDC, 0x24, "7b76fbab91576fd56685230f55e9990bdfff6aea08e46fbfbda40625d60e09e8"),
        (0x5181E8, 0x10, "1e1f5a83578f6939cb6ac24bdb4aaca697dbaf89f1c24947f79e141e28ede1a8"),
        (0x519C1C, 8, "49202bacad177957ae572e3656107328476560dbc054537fbd17e94a56c13a4f"),
        (0x518394, 0x358, "b2877f8fa4528117ca72eeeb9ec3dad7687a115f8f118b5e117ea6f3cc8482eb"),
        (0x519AD8, 0x60, "3a1a1bfeb86b2efa12d32b9c71c7abc8be11e0af36b8c2c4ec4c5beb9e0bc9a5"),
        (0x167B12C, 0xA8, "a88cd3ef1abc6987e833b687b45cfd1bc520a5c9e7a91fced38cdd5da26fd66b"),
    ),
    "agfx": (
        (0xBF5FC, 0x88, "1de99a1f60491dc3d59f42f06939df63b270b415df3099b36283010c4dee5a39"),
        (0xBF688, 0x124, "3a2a89a481af075e35149154de9a32ce7c0e32a32f88d63fda709f71e786209c"),
    ),
}


def validate_regions(*, image, role):
    require(condition=role in IDENTITIES, message="unknown matrix image role")
    for address, size, expected in REGIONS[role]:
        data = image.read(address=address, length=size)
        require(condition=len(data) == size and hashlib.sha256(data).hexdigest() == expected,
                message=f"matrix instruction region changed: {role} {address:#x}")


def verify_libraries(*, core, agfx):
    reports = {}
    for role, path in (("core", core), ("agfx", agfx)):
        path = Path(path).resolve(strict=True)
        require(condition=path.is_file() and 0 < path.stat().st_size <= 512 * 1024**2,
                message="bounded regular matrix library required")
        with path.open("rb") as stream:
            data = stream.read(512 * 1024**2 + 1)
        expected_uuid, expected_hash = IDENTITIES[role]
        require(condition=hashlib.sha256(data).hexdigest() == expected_hash,
                message=f"matrix {role} library hash mismatch")
        image = MachO(data=data)
        cursor, identities = 32, []
        for _ in range(struct.unpack_from("<I", image.data, 16)[0]):
            kind, size = struct.unpack_from("<II", image.data, cursor)
            if kind == 0x1B:
                require(condition=size == 24, message="invalid matrix UUID command")
                identities.append(str(uuid.UUID(bytes=image.data[cursor + 8:cursor + 24])).upper())
            cursor += size
        require(condition=identities == [expected_uuid], message=f"matrix {role} UUID mismatch")
        if role == "core":
            validate_image(image=image)
        validate_regions(image=image, role=role)
        reports[role] = dict(uuid=expected_uuid, sha256=expected_hash,
                             regions_verified=len(REGIONS[role]), library=str(path))
    return dict(schema="face-live-mesh-matrix-abi-v1", images=reports,
                static_route_verified=True, matrix_consumer_verified=False,
                qcut_mesh_ownership_verified=False, gpu_consumption_verified=False)
