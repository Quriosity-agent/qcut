"""Read the observed compiled CoreML/Espresso containers without vendor libraries."""
import hashlib
import json
import pathlib
import struct
import zipfile

import numpy as np
import torch

MAX_ARCHIVE_BYTES = 256 * 1024 * 1024


class UnsupportedModel(ValueError):
    pass


def parse_blobs(*, data):
    if len(data) < 8:
        raise ValueError("truncated blob header")
    count = struct.unpack_from("<Q", data)[0]
    offset = 8 + count * 16
    if count > 100000 or offset > len(data):
        raise ValueError("invalid blob table size")
    result = {}
    for index in range(count):
        key, size = struct.unpack_from("<QQ", data, 8 + index * 16)
        if key in result or size > len(data) - offset:
            raise ValueError("duplicate or truncated blob")
        result[key] = data[offset:offset + size]
        offset += size
    if offset != len(data):
        raise ValueError("unaccounted weight bytes")
    return result


def tensor_blob(*, blobs, key, dtype="<f4"):
    data = blobs[key]
    if len(data) % np.dtype(dtype).itemsize:
        raise ValueError("misaligned weight blob")
    array = np.frombuffer(data, dtype=dtype).astype(np.float32, copy=True)
    if not np.isfinite(array).all():
        raise ValueError("non-finite weights")
    return torch.from_numpy(array)


def conv_weight(*, layer, blobs):
    shape = (layer["C"], layer["K"] // layer["n_groups"], layer["Ny"], layer["Nx"])
    sources = [key for key in ("blob_weights", "blob_weights_f16") if key in layer]
    quant = layer.get("weights", {})
    if len(sources) == 1 and not quant:
        dtype = "<f2" if sources[0].endswith("f16") else "<f4"
        return tensor_blob(blobs=blobs, key=layer[sources[0]], dtype=dtype).reshape(shape)
    if not sources and set(quant) == {"W_U8", "per_ch_qscale", "per_ch_qbias"}:
        value = tensor_blob(blobs=blobs, key=quant["W_U8"], dtype="u1").reshape(shape)
        scale = tensor_blob(blobs=blobs, key=quant["per_ch_qscale"]).reshape(layer["C"], 1, 1, 1)
        bias = tensor_blob(blobs=blobs, key=quant["per_ch_qbias"]).reshape(layer["C"], 1, 1, 1)
        # Observed Espresso CPU profile: fused affine dequantization, then FP16 weights.
        return (value.double() * scale.double() + bias.double()).float().half().float()
    raise UnsupportedModel(f"unknown convolution weight layout: {layer['name']}")


def read_archive(*, path):
    if not zipfile.is_zipfile(path):
        raise UnsupportedModel("no readable embedded CoreML ZIP graph")
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if len(set(names)) != len(names) or sum(i.file_size for i in infos) > MAX_ARCHIVE_BYTES:
            raise ValueError("duplicate members or archive too large")
        for info in infos:
            member = pathlib.PurePosixPath(info.filename)
            if member.is_absolute() or ".." in member.parts or "\\" in info.filename:
                raise ValueError("unsafe archive member")
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("archive symlink is not allowed")
        nets = [n for n in names if n.endswith("/model.espresso.net")]
        if len(nets) != 1:
            raise UnsupportedModel("expected one Espresso network")
        prefix = nets[0].removesuffix("model.espresso.net")
        graph = json.loads(archive.read(nets[0]))
        if graph.get("format_version") != 200:
            raise UnsupportedModel("unsupported Espresso version")
        shapes = json.loads(archive.read(prefix + "model.espresso.shape"))["layer_shapes"]
        metadata = json.loads(archive.read(prefix + "metadata.json"))[0]
        inputs = {}
        for entry in metadata["inputSchema"]:
            if entry["type"] != "MultiArray" or entry["dataType"] != "Float32":
                raise UnsupportedModel("only Float32 MultiArray inputs are supported")
            inputs[entry["name"]] = {
                "shape": json.loads(entry["shape"]),
                "allowed_shapes": json.loads(entry.get("enumeratedShapes", "[]")),
            }
        spec = {"layers": graph["layers"], "shapes": shapes, "inputs": inputs,
                "quantization_profile": "espresso-u8-fma-f32-to-f16",
                "outputs": [entry["name"] for entry in metadata["outputSchema"]]}
        blobs = parse_blobs(data=archive.read(prefix + "model.espresso.weights"))
        return spec, blobs, prefix


def extract_coreml(*, path, destination):
    _, _, prefix = read_archive(path=path)
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if not info.filename.startswith(prefix) or info.is_dir():
                continue
            target = destination / info.filename[len(prefix):]
            if not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError("extraction target escapes destination")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(info))
    return destination


def sha256(*, path):
    with pathlib.Path(path).open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()
