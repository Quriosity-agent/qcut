"""Decode local mesh data without loading the native runtime; never redistribute it."""
import argparse
import hashlib
from pathlib import Path
import struct

import numpy as np

CORE_SHA256 = "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9"
SCENE_SHA256 = "be36c59eb69e49fa04a2d2317deac8d667871f9d90a40e0a601d01c83e8c5e03"
ASSET_CONTENT_SHA256 = "f736091ce16d42c8c640784f1a1e1e25a172d6f9914aca2d0991b185b55bdfc6"
PACKAGE = "7408077448513998114/aa4932200616e291a252039a3aac7232"
TABLES = {"opening_indices": (0x2ccdae8, 43), "small_face_indices": (0x2cce138, 58),
          "left_eye_midpoints": (0x2cce4a4, 9), "right_eye_midpoints": (0x2cce4c8, 9),
          "left_eye_spacing": (0x2cce964, 34), "right_eye_spacing": (0x2cce9ec, 34)}


def arm64_image(*, data):
    if data[:4] != bytes.fromhex("cafebabe"):
        raise ValueError("expected the pinned universal Mach-O")
    count = struct.unpack_from(">I", data, 4)[0]
    for index in range(count):
        cpu, _, offset, size, _ = struct.unpack_from(">5I", data, 8 + index * 20)
        if cpu == 0x100000c:
            return data[offset:offset + size]
    raise ValueError("arm64 slice is missing")


def address_bytes(*, image, address, size):
    if image[:4] != bytes.fromhex("cffaedfe"):
        raise ValueError("invalid arm64 Mach-O")
    offset = 32
    for _ in range(struct.unpack_from("<I", image, 16)[0]):
        command, length = struct.unpack_from("<2I", image, offset)
        if command == 0x19:
            vm, _, file_offset, file_size = struct.unpack_from("<4Q", image, offset + 24)
            if vm <= address and address + size <= vm + file_size:
                start = file_offset + address - vm
                return image[start:start + size]
        offset += length
    raise ValueError("mesh table is outside file-backed segments")


def decode_scene_arrays(*, data):
    # Serialized vector tags differ for float and uint16 arrays.
    weight_tag = bytes.fromhex("6e587acf18000000ba000000")
    index_tag = bytes.fromhex("5f2c286b16000000f9060000")
    arrays = []
    for tag, count, dtype, columns in ((weight_tag, 186, "<f4", 3),
                                       (index_tag, 1785, "<u2", 3)):
        start, matches = 0, []
        while True:
            position = data.find(tag, start)
            if position < 0:
                break
            position += len(tag)
            matches.append(np.frombuffer(data, dtype=dtype, count=count, offset=position).copy())
            start = position + count * np.dtype(dtype).itemsize
        if len(matches) != 10 or any(not np.array_equal(matches[0], value) for value in matches):
            raise ValueError("expected ten identical face mesh components")
        arrays.append(matches[0].reshape(-1, columns))
    weights, triangles = arrays
    if np.any(weights[:, 0] != weights[:, 0].astype(int)) or not np.isfinite(weights).all():
        raise ValueError("invalid face coefficients")
    if np.any(weights[:, 0] < 0) or np.any(weights[:, 0] >= 106) or triangles.max() != 310:
        raise ValueError("invalid mesh indices")
    return {"weights": weights, "triangles": triangles}


def extract(*, runtime):
    core = (runtime / "Frameworks/libcccreator.dylib").read_bytes()
    if hashlib.sha256(core).hexdigest() != CORE_SHA256:
        raise ValueError("unsupported library identity")
    image = arm64_image(data=core)
    scene = (runtime / "Cache/effect" / PACKAGE / "AmazingFeature/main.scene").read_bytes()
    if hashlib.sha256(scene).hexdigest() != SCENE_SHA256:
        raise ValueError("unsupported scene identity")
    values = decode_scene_arrays(data=scene)
    for name, (address, count) in TABLES.items():
        values[name] = np.frombuffer(address_bytes(image=image, address=address, size=count * 4), "<i4").copy()
    values["core_sha256"] = np.asarray(CORE_SHA256)
    values["scene_sha256"] = np.asarray(hashlib.sha256(scene).hexdigest())
    return values


def load_assets(*, path):
    with np.load(path, allow_pickle=False) as archive:
        values = {key: archive[key].copy() for key in archive.files}
    expected_keys = set(TABLES) | {"weights", "triangles", "core_sha256", "scene_sha256"}
    if set(values) != expected_keys:
        raise ValueError("unexpected mesh asset fields")
    if str(values.get("core_sha256", "")) != CORE_SHA256 or str(values.get("scene_sha256", "")) != SCENE_SHA256:
        raise ValueError("unsupported mesh asset provenance")
    for name, (_, count) in TABLES.items():
        indices = values[name]
        maximum = 106 if name in ("opening_indices", "small_face_indices") else 78
        if indices.shape != (count,) or indices.dtype.kind not in "iu" or np.any(indices < 0) or np.any(indices >= maximum):
            raise ValueError(f"invalid {name}")
    weights, triangles = values["weights"], values["triangles"]
    if weights.shape != (62, 3) or triangles.shape != (595, 3):
        raise ValueError("invalid mesh asset dimensions")
    if weights.dtype != np.dtype("float32") or not np.isfinite(weights).all():
        raise ValueError("invalid mesh coefficients")
    if np.any(weights[:, 0] != weights[:, 0].astype(int)) or np.any(weights[:, 0] < 0) or np.any(weights[:, 0] >= 106):
        raise ValueError("invalid coefficient landmark index")
    if triangles.dtype != np.dtype("uint16") or triangles.max() != 310:
        raise ValueError("invalid mesh topology")
    digest = hashlib.sha256()
    for name in sorted(values):
        value = values[name]
        digest.update(name.encode())
        digest.update(value.dtype.str.encode())
        digest.update(str(value.shape).encode())
        digest.update(value.tobytes())
    if digest.hexdigest() != ASSET_CONTENT_SHA256:
        raise ValueError("mesh asset content changed")
    for value in values.values():
        value.setflags(write=False)
    return values


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=Path(__file__).resolve().parents[1] / "runtime")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.suffix != ".npz" or args.output.exists() or not args.output.resolve().is_relative_to(args.runtime.resolve()):
        parser.error("use a fresh local .npz asset path under runtime/")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez(args.output, **extract(runtime=args.runtime))
    print(str(args.output))
