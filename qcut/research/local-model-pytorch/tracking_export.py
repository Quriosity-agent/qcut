"""Export all four modules and retain per-subnetwork native comparison evidence."""
import argparse
import csv
import json
from pathlib import Path
import subprocess

import numpy as np
import torch

from tracking_probe import SOURCE, compile_oracle, digest, make_cases, private_directory, recover, run_oracle
from tracking_torch import FORMAT, NETWORKS, RUNTIME_SHA256, SOURCE_SHA256, TrackingGraph, load_models


def read_native(*, directory, schemas):
    rows = list(csv.reader((directory / "native-tensors.tsv").read_text().splitlines(), delimiter="\t"))
    if any(len(row) != 8 for row in rows) or len(rows) != len(schemas) or {row[0] for row in rows} != set(schemas):
        raise ValueError("incomplete, duplicate, or extra native tensors")
    values = {}
    for row in rows:
        name = row[0]
        n, c, h, w = schemas[name]["shape"]
        fixed = schemas[name]["dtype"] == "int16"
        itemsize, dtype = (2, "<i2") if fixed else (4, "<f4")
        expected = [n, w, h, c, itemsize, schemas[name]["shift"], n * c * h * w * itemsize]
        if list(map(int, row[1:])) != expected:
            raise ValueError(f"wrong native shape, dtype, shift, or byte count: {name}")
        path = directory / f"native-{name}.bin"
        if path.stat().st_size != expected[-1]:
            raise ValueError("wrong native tensor file size")
        value = np.fromfile(path, dtype=dtype).reshape(n, h, w, c).transpose(0, 3, 1, 2).copy()
        if not np.isfinite(value).all():
            raise ValueError("nonfinite native tensor")
        values[name] = value
    return values


def compare_case(*, directory, model, restored, array, native_available):
    input_name = next(iter(model.input_schema))
    tensor = torch.from_numpy(array.transpose(0, 3, 1, 2).copy())
    with torch.inference_mode():
        actual = model({input_name: tensor})
        clone = restored({input_name: tensor})
    result = {"case": directory.name.removeprefix("case-"), "passed": False,
              "role": "holdout" if "holdout" in directory.name else "calibration",
              "input_sha256": digest(data=array.tobytes()), "input_echo_exact": False,
              "roundtrip_exact": all(torch.equal(actual[name], clone[name]) for name in actual),
              "finite": all(bool(torch.isfinite(value).all()) for value in actual.values()), "outputs": {}}
    np.savez(directory / "pytorch-outputs.npz", **{name: value.numpy() for name, value in actual.items()})
    result["input_fixture"] = str(directory / "inputs.npz")
    result["pytorch_output_fixture"] = str(directory / "pytorch-outputs.npz")
    for name, value in actual.items():
        value.numpy().transpose(0, 2, 3, 1).copy().tofile(directory / f"pytorch-{name}.bin")
    if not native_available:
        result["reason"] = "native execution unavailable"
        return result
    try:
        native = read_native(directory=directory, schemas={**model.input_schema, **model.output_schema})
        np.savez(directory / "native-outputs.npz", **{name: native[name] for name in model.output_schema})
        result["native_output_fixture"] = str(directory / "native-outputs.npz")
        result["input_echo_exact"] = (directory / f"native-{input_name}.bin").read_bytes() == array.tobytes()
        for name, value in actual.items():
            reference = native[name].astype(np.float64)
            candidate = value.numpy().astype(np.float64)
            error = np.abs(reference - candidate)
            exact = bool(np.array_equal(reference, candidate))
            close = bool(np.allclose(reference, candidate, atol=1e-4, rtol=1e-4))
            passed = exact if model.graph["fixed"] else close
            result["outputs"][name] = {"schema": model.output_schema[name], "max_abs": float(error.max()),
                                       "mae": float(error.mean()), "exact": exact, "passed": passed,
                                       "native_sha256": digest(data=(directory / f"native-{name}.bin").read_bytes()),
                                       "pytorch_sha256": digest(data=(directory / f"pytorch-{name}.bin").read_bytes())}
        result["passed"] = (result["input_echo_exact"] and result["roundtrip_exact"] and result["finite"]
                            and bool(result["outputs"]) and all(output["passed"] for output in result["outputs"].values()))
    except (OSError, ValueError, TypeError) as error:
        result["reason"] = str(error)
    return result


def verified_network(*, record):
    cases = record.get("cases", [])
    return (bool(record.get("output_schema")) and record.get("parameter_roundtrip_exact") is True and record.get("native", {}).get("forced_cpu") is True
            and record["native"].get("forward_type") == 0 and record["native"].get("status") == "completed"
            and bool(cases) and any(case.get("role") == "holdout" for case in cases)
            and all(case.get("passed") is True and case.get("finite") is True and case.get("roundtrip_exact") is True
                    and case.get("input_echo_exact") is True and set(case.get("outputs", {})) == set(record["output_schema"])
                    and all(output.get("passed") is True for output in case["outputs"].values()) for case in cases))


def export(*, out, oracle):
    out = private_directory(out=out)
    models, bundle_networks, metadata = {}, {}, {}
    for name in NETWORKS:
        directory = out / name
        directory.mkdir()
        text, arena, info = recover(name=name, out=directory)
        model = TrackingGraph(text=text, arena=arena).eval()
        models[name], metadata[name] = model, info
        bundle_networks[name] = {"graph": text, "network_id": info["network_id"], "state_dict": model.state_dict()}
    artifact = out / "tracking.pt"
    torch.save({"format": FORMAT, "source_sha256": SOURCE_SHA256, "runtime_sha256": RUNTIME_SHA256,
                "local_only": True, "networks": bundle_networks}, artifact)
    artifact_sha = digest(data=artifact.read_bytes())
    restored = load_models(path=artifact, expected_sha256=artifact_sha)
    binary = compile_oracle(out=out) if oracle else None
    networks = []
    for name, model in models.items():
        directory = out / name
        spec = next(iter(model.input_schema.values()))
        n, c, h, w = spec["shape"]
        arrays = make_cases(shape=(n, h, w, c), fixed=model.graph["fixed"], extended=True)
        (directory / "requests.txt").write_text("\n".join([*model.input_schema, *model.output_schema]) + "\n")
        for case_name, array in arrays.items():
            case_dir = directory / f"case-{case_name}"
            case_dir.mkdir()
            array.tofile(case_dir / "input.bin")
            np.savez(case_dir / "inputs.npz", **{next(iter(model.input_schema)): array.transpose(0, 3, 1, 2).copy()})
        native = {"status": "not-run", "backend": "ByteNN ARM64 forced CPU", "forced_cpu": False}
        if oracle:
            try:
                code = run_oracle(out=directory, binary=binary)
                native.update(returncode=code, status="completed" if code == 0 else "failed")
                evidence = json.loads((directory / "native-runtime.json").read_text())
                if evidence != {"forced_cpu": True, "forward_type": 0}:
                    raise ValueError("CPU runtime evidence mismatch")
                native.update(evidence)
            except (OSError, ValueError, TypeError, subprocess.SubprocessError) as error:
                native.update(status="failed", reason=str(error))
        record = {**metadata[name], "artifact": str(artifact), "artifact_sha256": artifact_sha,
                  "artifact_bytes": artifact.stat().st_size, "format": FORMAT, "status": "native-unverified",
                  "backend": "pytorch-cpu-vs-bytenn-arm64-cpu", "scope": "original-standalone-subnetwork-all-terminal-outputs",
                  "input_schema": model.input_schema, "output_schema": model.output_schema,
                  "native_dimension_order": "NWHC", "native_memory_order": "NHWC", "native": native,
                  "arena_bytes_consumed": model.graph["arena_bytes_consumed"], "arena_identity_bytes": 4,
                  "parameter_roundtrip_exact": all(torch.equal(value, restored[name].state_dict()[key]) for key, value in model.state_dict().items()),
                  "tolerance": {"atol": 1e-4, "rtol": 1e-4}, "quantized_outputs_require_exact_equality": model.graph["fixed"],
                  "model_loader": f"tracking_torch.load_model(path=..., name={name!r})", "cases": [],
                  "product_tracking_e2e_verified": False}
        for case_name, array in arrays.items():
            record["cases"].append(compare_case(directory=directory / f"case-{case_name}", model=model,
                                                restored=restored[name], array=array, native_available=native["status"] == "completed"))
        passed = verified_network(record=record)
        record.update(status="native-parity-passed" if passed else "native-parity-failed" if oracle else "native-unverified",
                      all_declared_outputs_verified=passed)
        (directory / "report.json").write_text(json.dumps(record, indent=2, allow_nan=False) + "\n")
        networks.append(record)
        print(json.dumps({"network_id": record["network_id"], "name": name, "status": record["status"],
                          "passed_cases": sum(case["passed"] for case in record["cases"]), "cases": len(record["cases"])}), flush=True)
    fully_verified = len(networks) == 4 and all(verified_network(record=network) for network in networks)
    report = {"format": FORMAT, "source_path": str(SOURCE), "source_sha256": SOURCE_SHA256, "runtime_sha256": RUNTIME_SHA256,
              "artifact": str(artifact), "artifact_sha256": artifact_sha, "networks": networks,
              "status": "native-parity-passed" if fully_verified else "partial-or-unverified",
              "verified_source_assets": int(fully_verified), "verified_networks": sum(verified_network(record=n) for n in networks),
              "product_tracking_e2e_verified": False, "scope": "four-independent-subnetworks-not-tracking-pipeline"}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--oracle", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = export(out=args.out, oracle=args.oracle)
    print(json.dumps({key: value for key, value in report.items() if key != "networks"}, indent=2))
    return int(args.oracle and report["verified_networks"] != 4)


if __name__ == "__main__":
    raise SystemExit(main())
