"""Private tensor exchange with a hash-pinned, explicitly selected ByteNN CPU oracle."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
LIBRARY = Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current/Frameworks/libbytenn.dylib"
RUNTIME_SHA256 = "1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0"
BINARY = PRIVATE / "bin/bytenn-oracle"
MAX_BYTES = 256 * 1024 * 1024


def sha256(*, path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def private_path(*, path):
    path = Path(path).resolve()
    if path == PRIVATE.resolve() or not path.is_relative_to(PRIVATE.resolve()):
        raise ValueError("oracle output must be beneath private ignored directory")
    return path


def native_shape(*, nchw):
    if len(nchw) != 4 or any(type(value) is not int or not 1 <= value <= 16384 for value in nchw):
        raise ValueError("expected four bounded integer NCHW dimensions")
    size = 4
    for value in nchw:
        size *= value
    if size > MAX_BYTES:
        raise ValueError("tensor exceeds private oracle byte limit")
    n, c, h, w = nchw
    return [n, w, h, c]


def build_oracle(*, binary=BINARY):
    binary = private_path(path=binary)
    binary.parent.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).with_suffix(".mm")
    subprocess.run(["/Library/Developer/CommandLineTools/usr/bin/clang++", "-std=c++17", "-O2", "-fobjc-arc",
                    "-isysroot", "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk", "-framework", "Foundation",
                    f"-Wl,-rpath,{LIBRARY.parent}", str(source), "-o", str(binary)], check=True, timeout=120)
    subprocess.run([str(binary), "--self-test"], check=True, timeout=10)
    return binary


def read_outputs(*, out, response, inputs, output_shapes, graph_sha, arena_sha):
    if (not isinstance(response, dict) or response.get("version") != 1 or response.get("forced_cpu") is not True or response.get("forward_type") != 0
            or response.get("runtime_sha256") != RUNTIME_SHA256 or response.get("graph_sha256") != graph_sha
            or response.get("arena_sha256") != arena_sha):
        raise ValueError("native oracle provenance or backend mismatch")
    results = {}
    for key, expected in (("inputs", {name: value.shape for name, value in inputs.items()}), ("outputs", output_shapes)):
        descriptors = response.get(key, [])
        if not isinstance(descriptors, list) or any(not isinstance(item, dict) for item in descriptors):
            raise ValueError("invalid native tensor descriptors")
        names = [item["name"] for item in descriptors]
        if len(set(names)) != len(names) or set(names) != set(expected):
            raise ValueError(f"incomplete or duplicate native {key}")
        for item in descriptors:
            name = item["name"]
            shape = tuple(expected[name])
            if item["shape_nwhc"] != native_shape(nchw=shape):
                raise ValueError("native output dimensions differ")
            file = out / item["file"]
            if Path(item["file"]).name != item["file"] or file.is_symlink() or file.resolve().parent != out.resolve():
                raise ValueError("native tensor escaped case directory")
            count = int(np.prod(shape, dtype=np.int64))
            if file.stat().st_size != count * 4:
                raise ValueError("native tensor byte count mismatch")
            n, c, h, w = shape
            value = np.fromfile(file, dtype="<f4").reshape(n, h, w, c).transpose(0, 3, 1, 2).copy()
            if not np.isfinite(value).all():
                raise ValueError("nonfinite native tensor")
            if key == "inputs" and value.tobytes() != inputs[name].tobytes():
                raise ValueError("native input echo differs")
            if key == "outputs":
                results[name] = torch.from_numpy(value)
    return results


def predict(*, graph, arena, inputs, output_shapes, out, binary=BINARY, library=LIBRARY, timeout=120):
    out = private_path(path=out)
    if out.exists() and any(out.iterdir()):
        raise ValueError("use a fresh empty oracle case directory")
    if not inputs or not output_shapes or len(inputs) > 64 or len(output_shapes) > 64:
        raise ValueError("nonempty bounded input and output maps required")
    arrays = {}
    for name, value in inputs.items():
        if not isinstance(name, str) or not name or len(name) > 256 or "\0" in name:
            raise ValueError("invalid input name")
        array = value.detach().cpu().numpy() if isinstance(value, torch.Tensor) else np.asarray(value)
        native_shape(nchw=array.shape)
        if array.dtype != np.float32 or not np.isfinite(array).all():
            raise ValueError("oracle expects finite float32 inputs")
        arrays[name] = array
    for name, shape in output_shapes.items():
        if not isinstance(name, str) or not name or len(name) > 256 or "\0" in name:
            raise ValueError("invalid output name")
        native_shape(nchw=shape)
    input_bytes = sum(array.nbytes for array in arrays.values())
    output_bytes = sum(int(np.prod(shape, dtype=np.int64)) * 4 for shape in output_shapes.values())
    if input_bytes + output_bytes > MAX_BYTES:
        raise ValueError("aggregate tensor exchange exceeds byte limit")
    if sha256(path=library) != RUNTIME_SHA256:
        raise ValueError("unsupported native runtime")
    graph, arena, binary = Path(graph).resolve(), Path(arena).resolve(), Path(binary).resolve()
    if any(not file.is_file() or not 0 < file.stat().st_size <= MAX_BYTES for file in (graph, arena, binary)):
        raise ValueError("missing or oversized oracle file")
    out.mkdir(parents=True, exist_ok=True)
    request = {"version": 1, "inputs": [], "outputs": []}
    for index, (name, value) in enumerate(arrays.items()):
        file = f"input-{index}.f32"
        value.transpose(0, 2, 3, 1).astype("<f4").tofile(out / file)
        request["inputs"].append({"name": name, "file": file, "shape_nwhc": native_shape(nchw=value.shape)})
    for name, shape in output_shapes.items():
        request["outputs"].append({"name": name, "shape_nwhc": native_shape(nchw=shape)})
    path = out / "request.json"
    path.write_text(json.dumps(request, indent=2) + "\n")
    invocation = {"runtime_sha256": RUNTIME_SHA256, "graph_sha256": sha256(path=graph), "arena_sha256": sha256(path=arena),
                  "oracle_sha256": sha256(path=binary), "status": "running"}
    report_path = out / "invocation.json"
    try:
        with (out / "oracle.log").open("w") as log:
            subprocess.run([str(binary), str(Path(library).resolve()), str(graph), str(arena), str(path)],
                           stdout=log, stderr=subprocess.STDOUT, cwd=out, check=True, timeout=timeout)
        response = json.loads((out / "response.json").read_text())
        values = read_outputs(out=out, response=response, inputs=arrays, output_shapes=output_shapes,
                              graph_sha=invocation["graph_sha256"], arena_sha=invocation["arena_sha256"])
        invocation.update(status="native-executed", forced_cpu=True, forward_type=0)
        return values
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        invocation.update(status="native-failed", reason=str(error))
        raise
    finally:
        report_path.write_text(json.dumps(invocation, indent=2, allow_nan=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", required=True)
    args = parser.parse_args()
    if args.build:
        print(build_oracle())


if __name__ == "__main__":
    main()
