"""Hash-pinned private extraction and CPU oracle execution for tracking graphs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np

from container_scan import RUNTIME_SHA256, decode_graph, runtime_graph_table
from model_containers import bytenn_sections
from tracking_torch import NETWORKS, SOURCE_SHA256

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
RUNTIMES = Path.home() / "Library/Application Support/QCut/PrivateRuntimes"
SOURCE = RUNTIMES / "JianyingTracking/current/Resources/models/single_object_tracking_v1.0.model"
LIBRARY = RUNTIMES / "JianyingShotSplit/current/Frameworks/libbytenn.dylib"


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def private_directory(*, out):
    out = out.resolve()
    if not out.is_relative_to(PRIVATE.resolve()) or out == PRIVATE.resolve():
        raise ValueError("outputs must stay below the private ignored directory")
    if out.exists() and any(out.iterdir()):
        raise ValueError("use a new empty run directory")
    out.mkdir(parents=True, exist_ok=True)
    return out


def recover(*, name, out):
    source = SOURCE.read_bytes()
    if digest(data=source) != SOURCE_SHA256:
        raise ValueError("unknown tracking source")
    info = NETWORKS[name]
    text, details = decode_graph(data=source, offset=info["offset"], table=runtime_graph_table(path=LIBRARY))
    if details["sha256"] != info["graph_sha256"] or details["layer_count"] != info["layers"]:
        raise ValueError("unexpected tracking graph")
    sections = bytenn_sections(data=source, offset=info["offset"])
    section = sections["sections"][1]
    arena = source[section["offset"]:section["offset"] + section["bytes"]]
    (out / "graph.private.txt").write_text(text)
    (out / "weights.private.bin").write_bytes(arena)
    bm = source[info["offset"]:info["offset"] + sections["bytes"]]
    (out / "original.private.bm").write_bytes(bm)
    metadata = {**info, "network_id": f"bm-offset-{info['offset']:08x}", "name": name,
                "source": str(SOURCE), "source_sha256": SOURCE_SHA256,
                "runtime_sha256": RUNTIME_SHA256, "bm_sha256": digest(data=bm),
                "arena_sha256": digest(data=arena), "graph_recovery": details}
    (out / "source.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return text, arena, metadata


def make_cases(*, shape, fixed, extended=False):
    dtype = np.dtype("<i2" if fixed else "<f4")
    unit = 256 if fixed else 1
    count = int(np.prod(shape))
    cases = {"zeros": np.zeros(shape, dtype=dtype), "ones": np.full(shape, unit, dtype=dtype),
             "negative": np.full(shape, -unit, dtype=dtype),
             "ramp": np.linspace(-unit, unit, count).astype(dtype).reshape(shape)}
    for seed in (17, 83, 303, 509):
        label = "holdout" if seed >= 300 else "random"
        cases[f"{label}-{seed}"] = np.random.default_rng(seed).uniform(-unit, unit, shape).astype(dtype)
    pulse = np.zeros(shape, dtype=dtype)
    pulse.flat[0], pulse.flat[-1] = unit, -unit
    cases["holdout-edge-pulse"] = pulse
    if extended:
        rng = np.random.default_rng(2026091907)
        if fixed:
            cases["holdout-new-full-range"] = rng.integers(-2047, 2048, size=shape, dtype=np.int16)
            cases["holdout-new-positive-limit"] = np.full(shape, 2047, dtype=dtype)
            cases["holdout-new-negative-limit"] = np.full(shape, -2047, dtype=dtype)
        else:
            cases["holdout-new-wide-normal"] = rng.normal(0, 8, shape).astype(dtype)
            cases["holdout-new-positive-features"] = rng.uniform(0, 16, shape).astype(dtype)
            cases["holdout-new-wide-ramp"] = np.linspace(-8, 8, count, dtype=dtype).reshape(shape)
        cases["holdout-new-asymmetric"] = rng.uniform(-unit * 0.75, unit * 1.25, shape).astype(dtype)
    return cases


def compile_oracle(*, out):
    if digest(data=LIBRARY.read_bytes()) != RUNTIME_SHA256:
        raise ValueError("unknown native runtime")
    binary = out / "tracking-oracle"
    command = ["/Library/Developer/CommandLineTools/usr/bin/clang++", "-std=c++17", "-O2",
               "-isysroot", "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
               f"-Wl,-rpath,{LIBRARY.parent}", str(Path(__file__).with_name("tracking_oracle.mm")),
               "-o", str(binary)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=90)
    (out / "compile.log").write_text(result.stdout + result.stderr)
    result.check_returncode()
    return binary


def run_oracle(*, out, binary):
    if digest(data=LIBRARY.read_bytes()) != RUNTIME_SHA256:
        raise ValueError("runtime changed before inference")
    invocation = {"runtime_sha256": RUNTIME_SHA256, "graph_sha256": digest(data=(out / "graph.private.txt").read_bytes()),
                  "arena_sha256": digest(data=(out / "weights.private.bin").read_bytes()),
                  "oracle_sha256": digest(data=binary.read_bytes()), "scope": "standalone-subnetwork-cpu"}
    with (out / "oracle.log").open("w") as log:
        result = subprocess.run([str(binary), str(LIBRARY), str(out / "graph.private.txt"),
                                 str(out / "weights.private.bin"), str(out)],
                                cwd=out, stdout=log, stderr=subprocess.STDOUT, timeout=120)
    invocation["returncode"] = result.returncode
    (out / "invocation.json").write_text(json.dumps(invocation, indent=2) + "\n")
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--name", choices=NETWORKS, required=True)
    args = parser.parse_args()
    out = private_directory(out=args.out)
    text, _, _ = recover(name=args.name, out=out)
    rows = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()][2:]
    data = rows[0]
    n, w, h, c = map(int, data[2:6])
    names = [row[-1] for row in rows if row[0] in {"Convolution", "DepthwiseSeparableConvolution"}]
    names += {"kernel": ["cat5"], "search": ["cat5"], "head": ["Slice_41", "Reshape_46", "Reshape_36", "Transpose_37", "Reshape_39"],
              "backbone": ["concat2"]}[args.name]
    (out / "requests.txt").write_text("\n".join([data[1], *names]) + "\n")
    for name, values in make_cases(shape=(n, h, w, c), fixed=data[6] == "2").items():
        directory = out / f"case-{name}"
        directory.mkdir()
        values.tofile(directory / "input.bin")
    binary = compile_oracle(out=out)
    code = run_oracle(out=out, binary=binary)
    print(json.dumps({"name": args.name, "returncode": code, "out": str(out)}))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
