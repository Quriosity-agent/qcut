"""Strict single-file ONNX inference; requires NumPy/ORT, not torch or vendor code."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import time
import zipfile

import numpy as np
import onnxruntime as ort

ort.disable_telemetry_events()

FORMAT = "qcut-private-onnx-contract-v1"
MAX_BYTES = 256 * 1024 * 1024
DTYPES = {"float32": np.dtype("float32"), "int16": np.dtype("int16")}
ORT_TYPES = {"float32": "tensor(float)", "int16": "tensor(int16)"}


def digest(*, path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_npz(*, path):
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) > 64 or len({item.filename for item in members}) != len(members):
            raise ValueError("invalid NPZ member count or duplicate names")
        if sum(item.file_size for item in members) > MAX_BYTES:
            raise ValueError("NPZ exceeds tensor byte limit")
    with np.load(path, allow_pickle=False) as archive:
        values = {name: archive[name].copy() for name in archive.files}
    if not values or any(value.dtype not in DTYPES.values() or not np.isfinite(value).all() for value in values.values()):
        raise ValueError("expected nonempty finite float32/int16 NPZ")
    return values


def validate_schema(*, schema):
    if not isinstance(schema, dict) or not 1 <= len(schema) <= 64:
        raise ValueError("nonempty bounded tensor schema required")
    total = 0
    for name, item in schema.items():
        if not isinstance(name, str) or not name or not isinstance(item, dict) or item.get("dtype") not in DTYPES:
            raise ValueError("invalid tensor name or dtype")
        shape = item.get("shape")
        if not isinstance(shape, list) or len(shape) > 8 or any(type(d) is not int or not 1 <= d <= 16384 for d in shape):
            raise ValueError("invalid fixed tensor dimensions")
        limits = item.get("range")
        if limits is not None and (not isinstance(limits, list) or len(limits) != 2
                                   or any(type(v) not in (int, float) or not np.isfinite(v) for v in limits)
                                   or limits[0] > limits[1]):
            raise ValueError("invalid tensor range")
        count = 1
        for dimension in shape:
            count *= dimension
        total += count * DTYPES[item["dtype"]].itemsize
        if total > MAX_BYTES:
            raise ValueError("tensor schema exceeds byte limit")


def check_values(*, values, schema):
    if not isinstance(values, dict) or set(values) != set(schema):
        raise ValueError("exact declared tensor names required")
    for name, spec in schema.items():
        value = values[name]
        if (not isinstance(value, np.ndarray) or value.dtype != DTYPES[spec["dtype"]]
                or list(value.shape) != spec["shape"] or not np.isfinite(value).all()):
            raise ValueError(f"invalid tensor shape, dtype or finite values: {name}")
        if "range" in spec and (np.any(value < spec["range"][0]) or np.any(value > spec["range"][1])):
            raise ValueError(f"tensor outside declared range: {name}")


class ONNXModel:
    def __init__(self, *, contract_path, threads=2, allow_unverified=False):
        contract_path = Path(contract_path).resolve()
        if contract_path.stat().st_size > 1024 * 1024 or type(threads) is not int or not 1 <= threads <= 64 or type(allow_unverified) is not bool:
            raise ValueError("invalid contract size or thread count")
        metadata = json.loads(contract_path.read_text())
        if (not isinstance(metadata, dict) or metadata.get("format") != FORMAT or metadata.get("local_only") is not True
                or metadata.get("external_data") is not False or metadata.get("custom_operators") != []):
            raise ValueError("unsupported ONNX contract")
        if metadata.get("status") != "onnx-runtime-parity-passed" and allow_unverified is not True:
            raise ValueError("ONNX candidate has not passed runtime parity")
        self.inputs, self.outputs = metadata["inputs"], metadata["outputs"]
        validate_schema(schema=self.inputs)
        validate_schema(schema=self.outputs)
        name = metadata["artifact"]
        if not isinstance(name, str) or Path(name).name != name or not name.endswith(".onnx"):
            raise ValueError("ONNX artifact must be adjacent to its contract")
        path = contract_path.parent / name
        if path.is_symlink() or path.resolve().parent != contract_path.parent or not 0 < path.stat().st_size <= MAX_BYTES:
            raise ValueError("invalid ONNX artifact boundary or size")
        if digest(path=path) != metadata["artifact_sha256"]:
            raise ValueError("ONNX artifact digest mismatch")
        options = ort.SessionOptions()
        options.intra_op_num_threads, options.inter_op_num_threads = threads, 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        # Serialized bytes avoid resolving external tensor paths from a model directory.
        self.session = ort.InferenceSession(path.read_bytes(), sess_options=options, providers=["CPUExecutionProvider"])
        if self.session.get_providers() != ["CPUExecutionProvider"]:
            raise ValueError("unexpected execution provider")
        for descriptors, schema in ((self.session.get_inputs(), self.inputs), (self.session.get_outputs(), self.outputs)):
            if {item.name for item in descriptors} != set(schema):
                raise ValueError("ONNX tensor names differ from contract")
            for item in descriptors:
                spec = schema[item.name]
                if item.type != ORT_TYPES[spec["dtype"]] or item.shape != spec["shape"]:
                    raise ValueError("ONNX tensor schema differs from contract")
        self.metadata = metadata

    def __call__(self, inputs):
        check_values(values=inputs, schema=self.inputs)
        arrays = self.session.run(list(self.outputs), {name: np.ascontiguousarray(value).reshape(value.shape) for name, value in inputs.items()})
        results = dict(zip(self.outputs, arrays, strict=True))
        check_values(values=results, schema=self.outputs)
        return results


def run(*, contract, inputs, out, threads=2):
    out = Path(out).resolve()
    contract, inputs = Path(contract).resolve(), Path(inputs).resolve()
    if out.suffix != ".npz" or out in {inputs, contract} or out.with_suffix(".json") in {inputs, contract}:
        raise ValueError("separate NPZ output required")
    if out.exists() or out.with_suffix(".json").exists():
        raise ValueError("refusing to overwrite inference output")
    model = ONNXModel(contract_path=contract, threads=threads)
    values = read_npz(path=inputs)
    start = time.perf_counter()
    outputs = model(values)
    elapsed = time.perf_counter() - start
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out, **outputs)
    report = {"passed": True, "platform": platform.platform(), "machine": platform.machine(),
              "onnxruntime": ort.__version__, "providers": model.session.get_providers(),
              "optimization": "disabled", "inference_ms": elapsed * 1000,
              "contract_sha256": digest(path=contract), "input_sha256": digest(path=inputs),
              "artifact_sha256": model.metadata["artifact_sha256"], "output_sha256": digest(path=out),
              "outputs": model.outputs}
    out.with_suffix(".json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    print(json.dumps(run(contract=args.contract, inputs=args.input, out=args.out, threads=args.threads), indent=2))


if __name__ == "__main__":
    main()
