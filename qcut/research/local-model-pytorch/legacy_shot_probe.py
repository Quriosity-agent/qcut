#!/usr/bin/env python3
"""Collect private evidence for the two hash-pinned legacy shot models."""
import argparse
import hashlib
import json
import pathlib
import struct
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
RUNTIME = pathlib.Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current"
SOURCES = {
    "backbone": ("jy_compressShotDetectBackbone_v1.0_size0.bytenn", "5545e8444be107d2fb791261356ef0da37c6e7c9e67740c87edd8bec5758a2f8"),
    "predhead": ("jy_compressShotDetectPredHead_v1.0_size0.bytenn", "b2f0c4dc76767280f77a0a0745ef2a87697f353bf9a704146bb1f3014bfe4106"),
}
LIBRARIES = {
    "libbytenn.dylib": "1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0",
    "libcccreator.dylib": "b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4",
}


def digest(*, path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def header(*, raw):
    if len(raw) < 68:
        raise ValueError("truncated ByteNN header")
    fields = struct.unpack_from("<17I", raw)
    if fields[0] != 67128642 or fields[1] != len(raw) or fields[2] != 7:
        raise ValueError("unsupported ByteNN container")
    size, offset = fields[5:7]
    if size % 4 or offset < 68 or offset + size > len(raw):
        raise ValueError("invalid weight arena bounds")
    return {"arena_offset": offset, "arena_bytes": size, "arena_floats": size // 4}


def private_output(*, path):
    result = path.resolve()
    if not result.is_relative_to(PRIVATE.resolve()) or result == PRIVATE.resolve():
        raise ValueError("generated vendor evidence must stay below .local/jianying-model-pytorch")
    result.mkdir(parents=True, exist_ok=True)
    return result


def stage(*, runtime, output, feature_dims):
    output = private_output(path=output)
    if feature_dims != 256:
        raise ValueError("legacy graph requires 256 features")
    for name, expected in LIBRARIES.items():
        if digest(path=runtime / "Frameworks" / name) != expected:
            raise ValueError(f"unsupported native ABI library hash: {name}")
    models = {}
    for role, (name, expected) in SOURCES.items():
        path = runtime / "Resources/models" / name
        actual = digest(path=path)
        if actual != expected:
            raise ValueError(f"{role}: unsupported model hash")
        models[role] = {"path": str(path), "sha256": actual, **header(raw=path.read_bytes())}
    staged = output / "runtime"
    graph_dir = staged / "Resources/SceneEditDetection"
    graph_dir.mkdir(parents=True, exist_ok=True)
    for link, source in ((staged / "Frameworks", runtime / "Frameworks"),
                         (staged / "Resources/models", runtime / "Resources/models")):
        if link.is_symlink() and link.resolve() == source.resolve():
            continue
        if link.exists() or link.is_symlink():
            raise ValueError(f"refusing to replace existing path: {link}")
        link.symlink_to(source.resolve(), target_is_directory=True)
    graph = json.loads((runtime / "Resources/SceneEditDetection/config.json").read_text())
    nodes = [node for node in graph["nodes"] if node["type"] == "compress_shot_detect"]
    if len(nodes) != 1:
        raise ValueError("expected one shot detector graph node")
    params = nodes[0]["config"]["keymaps"]
    params["stringParam"]["compress_shot_detect_backbone_model_name"] = "jy_compressShotDetectBackbone"
    params["stringParam"]["compress_shot_detect_predhead_model_name"] = "jy_compressShotDetectPredHead"
    params["intParam"]["compress_shot_detect_img_feat_dims"] = feature_dims
    params["intParam"]["compress_shot_detect_sliding_window_size"] = 11
    for node in graph["nodes"]:
        if node["type"] == "blit":
            node["config"]["size"] = {"width": 128, "height": 128}
    (graph_dir / "config.json").write_text(json.dumps(graph, indent=2) + "\n")
    report = {"local_only": True, "models": models, "feature_dims": feature_dims, "library_sha256": LIBRARIES,
              "status": "staged-not-converted", "native_runtime": str(runtime.resolve())}
    (output / "probe-report.json").write_text(json.dumps(report, indent=2) + "\n")
    return staged


def compile_probe(*, name, output):
    binary = output / "bin" / name
    binary.parent.mkdir(parents=True, exist_ok=True)
    source = ROOT / "research/jianying-shot-split-probe" / f"{name}.mm"
    if name == "legacy_shot_trace":
        source = pathlib.Path(__file__).with_name(f"{name}.mm")
    subprocess.run([
        "/Library/Developer/CommandLineTools/usr/bin/clang++", "-std=c++17", "-O2",
        "-isysroot", "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
        f"-Wl,-rpath,{output / 'runtime/Frameworks'}",
        "-framework", "Foundation", str(source),
        "-o", str(binary),
    ], check=True, timeout=120)
    return binary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=pathlib.Path, default=RUNTIME)
    parser.add_argument("--out", type=pathlib.Path, default=PRIVATE / "legacy-shots")
    parser.add_argument("--feature-dims", type=int, default=256)
    parser.add_argument("--dump", action="store_true")
    parser.add_argument("--trace", action="store_true")
    parser.add_argument("--seed", type=int, default=19)
    parser.add_argument("--direct-loader", action="store_true")
    args = parser.parse_args()
    if args.feature_dims != 256:
        parser.error("legacy models require 256 feature dimensions")
    output = private_output(path=args.out)
    runtime = stage(runtime=args.runtime, output=output, feature_dims=args.feature_dims)
    if args.dump:
        binary = compile_probe(name="weight-dump", output=output)
        with (output / "native-dump.log").open("w") as log:
            result = subprocess.run([str(binary), str(runtime), str(runtime / "Resources/SceneEditDetection/config.json"),
                                     str(output / "params")], stdout=log, stderr=subprocess.STDOUT, timeout=120, cwd=output)
        if result.returncode:
            raise RuntimeError(f"native dump failed: {result.returncode}; see native-dump.log")
    if args.trace:
        import numpy as np
        binary = compile_probe(name="legacy_shot_trace", output=output)
        frames = np.random.default_rng(args.seed).integers(0, 256, (24, 128, 128, 4), dtype=np.uint8)
        frames[:, :, :, 3] = 255
        raw = output / f"random-128-seed{args.seed}.rgba"
        frames.tofile(raw)
        for role, layers in (("backbone", 118), ("predhead", 39)):
            with (output / f"trace-{role}-seed{args.seed}.log").open("w") as log:
                result = subprocess.run([str(binary), str(runtime), str(raw), "128", "128",
                                         str(output / f"trace-{role}-seed{args.seed}"), "24", str(layers)],
                                        stdout=log, stderr=subprocess.STDOUT, timeout=120, cwd=output)
            if result.returncode:
                raise RuntimeError(f"native trace {role} failed: {result.returncode}")
    if args.direct_loader:
        binary = compile_probe(name="bytenn-probe", output=output)
        with (output / "direct-loader.log").open("w") as log:
            subprocess.run([str(binary), str(args.runtime), str(args.runtime / "Resources/models" / SOURCES["backbone"][0])],
                           stdout=log, stderr=subprocess.STDOUT, timeout=30, check=True, cwd=output)
    print(json.dumps({"runtime": str(runtime), "evidence": str(output)}, indent=2))


if __name__ == "__main__":
    main()
