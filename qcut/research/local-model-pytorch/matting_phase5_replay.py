"""Independent-process, guarded replay of the ordered GRU candidate."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

import torch

from matting_cpu_boundary import metrics
from matting_cpu_export import digest, fresh_directory, read_tensor
from matting_torch import INPUT_SHAPES, OUTPUT_SHAPES, load_model


def deny_vendor_access(event: str, args: tuple) -> None:
    if event.startswith("subprocess."):
        raise RuntimeError("native subprocess access forbidden during portable replay")
    if event not in {"open", "ctypes.dlopen"} or not args:
        return
    name = str(args[0])
    if ("PrivateRuntimes" in name or "libbytenn" in name or "libcccreator" in name
            or "loaded-buffer.bin" in name or "graph.private" in name or "arena-" in name):
        raise RuntimeError("source/native access forbidden during portable replay")


def worker(*, manifest: Path, out: Path, threads: int) -> dict[str, object]:
    if threads not in {1, 2, 4}:
        raise ValueError("replay thread count must be 1, 2 or 4")
    data = json.loads(manifest.read_text())
    torch.set_num_threads(threads)
    sys.addaudithook(deny_vendor_access)
    model = load_model(path=data["artifact"], expected_sha256=data["artifact_sha256"], allow_unverified=True)
    cases = []
    with torch.inference_mode():
        for case in data["cases"]:
            directory = Path(case["directory"])
            inputs = {name: read_tensor(path=directory / f"in-{name}.f32", shape=shape) for name, shape in INPUT_SHAPES.items()}
            start = time.monotonic()
            actual = model(inputs)
            seconds = time.monotonic() - start
            frozen = {name: read_tensor(path=directory / f"pytorch-{name}.f32", shape=shape) for name, shape in OUTPUT_SHAPES.items()}
            outputs = {name: metrics(actual=actual[name], expected=frozen[name]) for name in OUTPUT_SHAPES}
            cases.append({"directory": str(directory), "scope": case["scope"], "seconds": seconds,
                          "outputs": outputs, "passed": all(row["bitwise_equal"] for row in outputs.values())})
    report = {"status": "replay-passed" if cases and all(case["passed"] for case in cases) else "replay-failed",
              "artifact_sha256": data["artifact_sha256"], "threads": threads, "cases": cases,
              "source_and_vendor_python_access_denied": True, "python": sys.version,
              "torch_version": torch.__version__, "scope": "frozen portable outputs, no fresh native reference"}
    out.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def replay(*, run: Path, media: list[Path], out: Path) -> dict[str, object]:
    out = fresh_directory(path=out)
    source = json.loads((run / "report.json").read_text())
    if source["status"] != "native-parity-passed":
        raise ValueError("complete same-input native parity required")
    cases = [{"directory": str((run / case["case"]).resolve()), "scope": "single-frame"} for case in source["cases"]]
    for directory in media:
        report = json.loads((directory / "report.json").read_text())
        if report["status"] != "native-parity-passed" or report["artifact_sha256"] != source["artifact_sha256"]:
            raise ValueError("matching complete temporal parity required")
        frames = report["sampled_frames"]
        for index in (0, 1, frames // 2, frames - 1):
            cases.append({"directory": str((directory / report["cases"][index]["case"]).resolve()),
                          "scope": "frozen independent feedback/reset"})
    manifest = out / "manifest.json"
    manifest.write_text(json.dumps({"artifact": source["artifact"], "artifact_sha256": source["artifact_sha256"], "cases": cases}, indent=2) + "\n")
    results = []
    for threads in (1, 2, 4):
        target = out / f"threads-{threads}.json"
        command = [sys.executable, str(Path(__file__).resolve()), "--worker", str(manifest),
                   "--out", str(target), "--threads", str(threads)]
        with (out / f"threads-{threads}.log").open("w") as log:
            process = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=180)
        result = json.loads(target.read_text()) if target.exists() else {"status": "worker-failed", "cases": []}
        result.update(returncode=process.returncode, report=str(target), report_sha256=digest(data=target.read_bytes()) if target.exists() else None)
        results.append(result)
        print(json.dumps({"threads": threads, "status": result["status"], "cases": len(result["cases"])}), flush=True)
    passed = all(row["status"] == "replay-passed" and row["returncode"] == 0 for row in results)
    report = {"status": "replay-passed" if passed else "replay-failed", "artifact_sha256": source["artifact_sha256"],
              "workers": results, "new_verified_networks": 0,
              "scope": "independent Python processes; native/source Python access denied; thread-count replay"}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path)
    parser.add_argument("--media", type=Path, nargs="+", default=[])
    parser.add_argument("--worker", type=Path)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = (worker(manifest=args.worker, out=args.out, threads=args.threads) if args.worker
              else replay(run=args.run, media=args.media, out=args.out))
    return 0 if result["status"] == "replay-passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
