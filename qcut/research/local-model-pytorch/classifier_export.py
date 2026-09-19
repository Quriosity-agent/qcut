"""Export private classifier bundles and verify original-shape native CPU parity."""
import argparse
import json
from pathlib import Path
import subprocess

import numpy as np
import torch

from classifier_torch import ClassifierGraph, EXECUTION_PROFILE, FORMAT, PROFILES, RUNTIME_SHA256, digest, load_model, parse_spec, state_digest
from container_scan import decode_graph, runtime_graph_table
from model_containers import bytenn_sections, inspect_container

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
RUNTIMES = Path.home() / "Library/Application Support/QCut/PrivateRuntimes"
LIBRARY = RUNTIMES / "JianyingShotSplit/current/Frameworks/libbytenn.dylib"


def safe_directory(*, out):
    target = out.resolve()
    if target == PRIVATE.resolve() or not target.is_relative_to(PRIVATE.resolve()):
        raise ValueError("classifier outputs must stay in private ignored directory")
    if target.exists() and any(target.iterdir()):
        raise ValueError("fresh empty output directory required")
    target.mkdir(parents=True, exist_ok=True)
    return target


def build_cases():
    shape = (1, 3, 224, 224)
    cases = {"zeros": np.zeros(shape, dtype=np.float32), "ones": np.ones(shape, dtype=np.float32),
             "negative-ones": -np.ones(shape, dtype=np.float32),
             "ramp": np.linspace(-2, 2, np.prod(shape), dtype=np.float32).reshape(shape)}
    y, x = np.indices((224, 224), dtype=np.float32)
    cases["asymmetric-channels"] = np.stack((x / 112 - 1, y / 112 - 1, (x - 2 * y) / 224))[None]
    for seed in (17, 41, 83, 101):
        cases[f"random-{seed}"] = np.random.default_rng(seed).uniform(-2.026667, 255 * 0.017429 - 2.026667, shape).astype(np.float32)
    for seed in (303, 509):
        cases[f"holdout-normal-{seed}"] = np.random.default_rng(seed).normal(0, 0.7, shape).astype(np.float32)
    edge = np.zeros(shape, dtype=np.float32)
    edge[0, 0, 0, -1], edge[0, 1, -1, 0], edge[0, 2, 112, 37] = 2, -2, 1.5
    cases["holdout-edge-pulse"] = edge
    cases["holdout-checkerboard"] = np.broadcast_to((((x + y) % 2) * 4 - 2)[None, None], shape).copy()
    for seed in (20260919, 20260920):
        cases[f"holdout-postfix-{seed}"] = np.random.default_rng(seed).uniform(-2.1, 2.5, shape).astype(np.float32)
    return cases


def compare_outputs(*, expected, actual):
    if not expected or set(expected) != set(actual):
        return {"passed": False, "reason": "empty or mismatched output names", "outputs": {}}
    results = {}
    for name, native in expected.items():
        candidate = actual[name]
        valid = (native.dtype == torch.float32 and candidate.dtype == torch.float32
                 and tuple(native.shape) == tuple(candidate.shape)
                 and bool(torch.isfinite(native).all()) and bool(torch.isfinite(candidate).all()))
        record = {"shape": list(candidate.shape), "finite_and_shape_valid": valid, "passed": False}
        if valid:
            delta = (native.double() - candidate.double()).abs()
            tolerance = 1e-4 + 1e-4 * native.double().abs()
            record.update(max_abs=delta.max().item(), mae=delta.mean().item(),
                          failing_elements=int((delta > tolerance).sum()),
                          compared_elements=native.numel(), native_min=native.min().item(), native_max=native.max().item(),
                          passed=bool(torch.all(delta <= tolerance)))
        results[name] = record
    return {"passed": all(item["passed"] for item in results.values()), "outputs": results}


def recover(*, profile, out):
    expected = PROFILES[profile]
    source_path = RUNTIMES / "JianyingFilter/current/Models" / expected["source_filename"]
    source = source_path.read_bytes()
    if digest(data=source) != expected["source_sha256"]:
        raise ValueError("unrecognized classifier source hash")
    candidates = [item for item in inspect_container(data=source)["findings"] if item["kind"] == "bytenn-bm"]
    if len(candidates) != 1:
        raise ValueError("expected exactly one bounded embedded classifier")
    candidate = candidates[0]
    bm = source[candidate["offset"]:candidate["offset"] + candidate["bytes"]]
    if digest(data=bm) != expected["bm_sha256"]:
        raise ValueError("unrecognized embedded classifier hash")
    text, recovery = decode_graph(data=bm, offset=0, table=runtime_graph_table(path=LIBRARY))
    nodes = parse_spec(text=text, profile=profile)
    section = bytenn_sections(data=bm, offset=0)["sections"][1]
    arena = bm[section["offset"]:section["offset"] + section["bytes"]]
    (out / "original-subnetwork.private.bm").write_bytes(bm)
    (out / "graph.private.txt").write_text(text)
    (out / "weights.private.bin").write_bytes(arena)
    if len(arena) % 4 or len(arena) < 8:
        raise ValueError("unsupported weight trailer")
    weights = np.frombuffer(arena[:-4], dtype="<f4").copy()
    return source_path, text, nodes, weights, recovery, digest(data=arena)


def probe_prefixes(*, out, model, text, values):
    from bytenn_oracle import predict
    with torch.inference_mode():
        captured = model({"data": torch.from_numpy(values)}, capture=True)
    rows = text.splitlines()
    results = []
    for index in (1, 2, 3, 4, 6, 7, 8, 9, 16, 17, 111, 112, 113, 114, 115, 116, 117, 118):
        selected = model.nodes[index]
        output_name = model.routes[index][1]
        graph = out / f"probe-prefix-{index}.private.txt"
        graph.write_text(rows[0] + "\n" + f"1 {index} 0\\n\n" + "\n".join(rows[2:index + 3]) + "\n")
        record = {"node_index": index, "op": selected[0], "output": output_name,
                  "scope": "derived-prefix-terminal-output", "passed": False}
        try:
            native = predict(graph=graph, arena=out / "weights.private.bin", inputs={"data": values},
                             output_shapes={output_name: model.shapes[output_name]}, out=out / f"probe-{index}")
            record.update(compare_outputs(expected=native, actual={output_name: captured[output_name]}))
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
            record["reason"] = str(error)
        results.append(record)
    (out / "prefix-report.json").write_text(json.dumps(results, indent=2, allow_nan=False) + "\n")
    return results


def export(*, profile, out, oracle, probes=False):
    out = safe_directory(out=out)
    source_path, text, nodes, weights, recovery, arena_sha = recover(profile=profile, out=out)
    model = ClassifierGraph(nodes=nodes, weights=weights).eval()
    expected = PROFILES[profile]
    if model.output_names != [expected["output_name"]]:
        raise ValueError("unexpected classifier output set")
    bundle = {"format": FORMAT, "profile": profile, "local_only": True, "graph_text": text,
              "execution_profile": EXECUTION_PROFILE,
              "runtime_sha256": RUNTIME_SHA256, "state_dict": model.state_dict(),
              **{key: expected[key] for key in ("source_sha256", "bm_sha256", "graph_sha256")}}
    artifact = out / f"{profile}.pt"
    torch.save(bundle, artifact)
    artifact_sha = digest(data=artifact.read_bytes())
    restored = load_model(path=artifact, expected_sha256=artifact_sha)
    state_equal = all(torch.equal(value, restored.state_dict()[name]) for name, value in model.state_dict().items())
    output_shapes = {name: model.shapes[name] for name in model.output_names}
    cases = []
    for name, values in build_cases().items():
        with torch.inference_mode():
            actual = model({"data": torch.from_numpy(values)})
            cloned = restored({"data": torch.from_numpy(values)})
        directory = out / f"case-{name}"
        directory.mkdir()
        np.save(directory / "input-nchw.npy", values, allow_pickle=False)
        for output_name, tensor in actual.items():
            np.save(directory / f"pytorch-{output_name}.npy", tensor.numpy(), allow_pickle=False)
        record = {"case": name, "holdout": name.startswith("holdout-"), "passed": False,
                  "input_sha256": digest(data=values.tobytes()), "input_shape": list(values.shape),
                  "roundtrip_exact": all(torch.equal(actual[key], cloned[key]) for key in actual),
                  "finite": all(bool(torch.isfinite(value).all()) for value in actual.values()),
                  "native": {"status": "not-run"}}
        if oracle:
            try:
                from bytenn_oracle import predict
                native = predict(graph=out / "graph.private.txt", arena=out / "weights.private.bin",
                                 inputs={"data": values}, output_shapes=output_shapes, out=directory / "native")
                comparison = compare_outputs(expected=native, actual=actual)
                record.update(comparison)
                record["native"] = {"status": "native-executed", "forced_cpu": True, "forward_type": 0,
                                    "input_echo_exact": True, "all_declared_outputs_verified": comparison["passed"]}
            except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
                record["native"] = {"status": "native-failed", "reason": str(error)}
        record["passed"] = record["passed"] and record["roundtrip_exact"] and record["finite"]
        cases.append(record)
    parity = state_equal and bool(cases) and all(case["passed"] for case in cases)
    report = {"format": FORMAT, "profile": profile, "status": "native-parity-passed" if parity else "verification-failed" if oracle else "recovered-native-unverified",
              "source": str(source_path), "source_path": str(source_path),
              **{key: expected[key] for key in ("source_sha256", "bm_sha256", "graph_sha256")},
              "artifact": str(artifact), "artifact_sha256": artifact_sha, "artifact_bytes": artifact.stat().st_size,
              "arena_sha256": arena_sha, "runtime_sha256": RUNTIME_SHA256, "parameter_count": model.parameter_count,
              "unused_arena_trailer_bytes": 4,
              "execution_profile": EXECUTION_PROFILE, "state_sha256": state_digest(state=model.state_dict()),
              "shared_prefix": {"nodes_including_input": 117,
                                "topology_sha256": digest(data=json.dumps(nodes[:117], separators=(",", ":")).encode()),
                                "state_sha256": state_digest(state={key: value for key, value in model.state_dict().items() if not key.startswith("layers.117.")})},
              "authored_code_sha256": {name: digest(data=Path(__file__).with_name(name).read_bytes())
                                       for name in ("classifier_torch.py", "classifier_export.py", "bytenn_oracle.py", "bytenn_oracle.mm")},
              "state_roundtrip_exact": state_equal, "graph_recovery": recovery,
              "backend": "ByteNN enforced CPU / PyTorch CPU float32", "scope": "original-fixed-shape-neural-output-only",
              "schema": {"inputs": {"data": {"shape": [1, 3, 224, 224], "layout": "NCHW", "dtype": "float32"}},
                         "outputs": {key: {"shape": list(value), "layout": "NCHW", "dtype": "float32"} for key, value in output_shapes.items()}},
              "native_dims": "NWHC", "native_memory": "NHWC", "original_graph_unchanged": True,
              "weight_layout": {"convolution": "OHWI", "depthwise": "HWC", "dense": "OI"},
              "all_declared_outputs_verified": parity, "script_semantics_verified": False,
              "source_asset_count": 1, "embedded_subnetwork_count": 1,
              "tolerance": {"atol": 1e-4, "rtol": 1e-4}, "cases": cases}
    if probes:
        report["derived_prefix_probes"] = probe_prefixes(out=out, model=model, text=text, values=build_cases()["random-17"])
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=tuple(PROFILES), required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--oracle", action="store_true")
    parser.add_argument("--probes", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = export(profile=args.profile, out=args.out, oracle=args.oracle, probes=args.probes)
    print(json.dumps({key: report[key] for key in ("profile", "status", "artifact", "artifact_sha256", "parameter_count")}, indent=2))
    return int(report["status"] == "verification-failed")


if __name__ == "__main__":
    raise SystemExit(main())
