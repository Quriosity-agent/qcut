"""Raw-width tensor exchange with the hash-pinned espresso CPU oracle (int8 / int16 / float32 NHWC).

Arrays are NHWC in memory; the runtime describes the same buffer as (n, w, h, c), so the
descriptor order is converted at the boundary and never exposed to callers.
"""
import hashlib
import json
import os
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
LIBRARY = Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current/Frameworks/libbytenn.dylib"
RUNTIME_SHA256 = "1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0"
BINARY = PRIVATE / "bin/espresso-oracle"
DTYPES = {1: np.dtype("<i1"), 2: np.dtype("<i2"), 4: np.dtype("<f4")}


def sha256(*, path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def private_path(*, path):
    path = Path(path).resolve()
    if path == PRIVATE.resolve() or not path.is_relative_to(PRIVATE.resolve()):
        raise ValueError("oracle output must be beneath the private ignored directory")
    return path


def build_oracle(*, binary=BINARY):
    binary = private_path(path=binary)
    binary.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["/Library/Developer/CommandLineTools/usr/bin/clang++", "-std=c++17", "-O2", "-fobjc-arc",
                    "-isysroot", "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk", "-framework", "Foundation",
                    str(Path(__file__).with_suffix(".mm")), "-o", str(binary)], check=True, timeout=120)
    return binary


def raw_array(value, raw):
    """NHWC array in the blob's own width; fixed-point blobs carry integers, not scaled values."""
    array = np.ascontiguousarray(value, dtype=DTYPES[raw[0]])
    if array.ndim != 4:
        raise ValueError("NHWC tensor required")
    return array


def predict(*, graph, arena, inputs, outputs, out, reinfer=None, binary=BINARY, library=LIBRARY, timeout=300):
    """inputs: {name: (nhwc array, [type, fraction])}; outputs: [blob names]. Returns {name: (array, raw)}."""
    out = private_path(path=out)
    if out.exists() and any(out.iterdir()):
        raise ValueError("use a fresh empty oracle case directory")
    if sha256(path=library) != RUNTIME_SHA256:
        raise ValueError("unsupported native runtime")
    out.mkdir(parents=True, exist_ok=True)
    request = {"version": 2, "inputs": [], "outputs": list(outputs)}
    if reinfer is not None:
        request["reinfer"] = [int(reinfer[0]), int(reinfer[1])]
    for index, (name, (value, raw)) in enumerate(inputs.items()):
        array = raw_array(value, raw)
        file = f"input-{index}.raw"
        array.tofile(out / file)
        n, h, w, c = array.shape
        request["inputs"].append({"name": name, "file": file, "dims_nwhc": [n, w, h, c], "raw": [int(raw[0]), int(raw[1])]})
    (out / "request.json").write_text(json.dumps(request, indent=2) + "\n")
    env = dict(os.environ, DYLD_LIBRARY_PATH=str(Path(library).parent))
    with (out / "oracle.log").open("w") as log:
        subprocess.run([str(binary), str(Path(library).resolve()), str(Path(graph).resolve()), str(Path(arena).resolve()),
                        str(out / "request.json")], stdout=log, stderr=subprocess.STDOUT, cwd=out, check=True, timeout=timeout, env=env)
    response = json.loads((out / "response.json").read_text())
    if response.get("version") != 2 or response.get("runtime_sha256") != RUNTIME_SHA256 or response.get("graph_sha256") != sha256(path=graph) \
            or response.get("arena_sha256") != sha256(path=arena):
        raise ValueError("oracle provenance mismatch")
    results = {}
    for item in response["outputs"]:
        raw = tuple(item["raw"])
        n, w, h, c = item["dims_nwhc"]
        array = np.fromfile(out / item["file"], dtype=DTYPES[raw[0]])
        if array.size != n * h * w * c:
            raise ValueError("output byte count mismatch")
        results[item["name"]] = (array.reshape(n, h, w, c), raw)
    return results
