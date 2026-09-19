"""Fresh-process NPZ replay with vendor files, dlopen, and subprocesses denied."""
import argparse
import json
from pathlib import Path
import sys


def deny_vendor_access(event, arguments):
    if event == "subprocess.Popen" or event in {"open", "ctypes.dlopen"} and any(
        "PrivateRuntimes" in str(argument) for argument in arguments
    ):
        raise RuntimeError("portable smoke prohibits vendor runtime/source access")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report_path = args.report.resolve()
    private = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"
    if not report_path.is_relative_to(private.resolve()):
        raise ValueError("portable evidence must remain private")
    sys.addaudithook(deny_vendor_access)
    import numpy as np
    import torch
    from tracking_torch import load_models

    torch.set_num_threads(2)
    report = json.loads(report_path.read_text())
    models = load_models(path=report["artifact"], expected_sha256=report["artifact_sha256"])
    results = []
    for network in report["networks"]:
        model = models[network["name"]]
        for case in network["cases"]:
            with np.load(case["input_fixture"], allow_pickle=False) as fixture:
                inputs = {name: torch.from_numpy(fixture[name].copy()) for name in fixture.files}
            with torch.inference_mode():
                output = model(inputs)
            exact, parity = True, True
            with np.load(case["pytorch_output_fixture"], allow_pickle=False) as expected, np.load(case["native_output_fixture"], allow_pickle=False) as native:
                if set(output) != set(expected.files) or set(output) != set(native.files):
                    raise ValueError("portable fixture output set mismatch")
                for name, value in output.items():
                    actual = value.numpy()
                    exact &= bool(np.array_equal(actual, expected[name]))
                    parity &= bool(np.allclose(actual, native[name], atol=1e-4, rtol=1e-4))
            results.append({"network_id": network["network_id"], "case": case["case"],
                            "forward_roundtrip_exact": exact, "native_parity_passed": parity, "passed": exact and parity})
    result = {"vendor_runtime_source_access_denied": True, "weights_only": True, "artifact_sha256": report["artifact_sha256"],
              "cases": results, "passed": len(results) == 52 and all(item["passed"] for item in results)}
    (report_path.parent / "portable-smoke.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"passed": result["passed"], "cases": len(results), "vendor_runtime_source_access_denied": True}))
    return int(not result["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
