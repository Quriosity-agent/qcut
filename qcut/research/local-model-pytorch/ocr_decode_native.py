"""New CPU oracle comparisons for the eleven byte-range OCR image inputs."""
import argparse
import json
from pathlib import Path
import re

import numpy as np

from ocr_decode_binary import private_directory, sha256
from ocr_decode_contract import SOURCE_SHA256, load_pinned_alphabet, read_json
from ocr_decode_ctc import decode_logits
from ocr_decode_evaluate import file_digest
from ocr_decode_metrics import aggregate_metrics, text_metrics
from ocr_export import LIBRARY, read_native, run_oracle
from ocr_rec_onnx_replay import INPUTS, OUTPUTS, compare_all
from ocr_torch import RUNTIME_SHA256
from onnx_infer import check_values, read_npz


SOURCES = {"graph.private.txt": "b31162ff9592552f1084aa1f4522bd889d5184dbfe912f3cbc06e4a31675c11d",
           "weights.private.bin": "f088e3a675711688c3d8c33727960d314cee1ec137e6cfe7795da8b5a0a7ac7c"}


def verify(*, source_run, evaluation_run, alphabet_path, out):
    source_run, evaluation_run = Path(source_run).resolve(), Path(evaluation_run).resolve()
    out = private_directory(path=out)
    if any(out.iterdir()):
        raise ValueError("fresh native verification directory required")
    alphabet, _, _ = load_pinned_alphabet(path=alphabet_path)
    report, report_sha = read_json(path=evaluation_run / "report.json")
    if (report.get("status") != "image-to-text-executed" or report.get("input_mode") != "byte-float"
            or report.get("source_model_sha256") != SOURCE_SHA256 or len(report.get("cases", [])) != 11):
        raise ValueError("completed eleven-image byte-range evaluation required")
    if file_digest(path=LIBRARY) != RUNTIME_SHA256:
        raise ValueError("native library changed")
    for name, expected in SOURCES.items():
        data = (source_run / name).read_bytes()
        if sha256(data=data) != expected:
            raise ValueError("native graph or arena differs from pinned v4 source")
        (out / name).write_bytes(data)
    (out / "outputs.txt").write_text("embedding\n")
    (out / "keep-original-shape").write_text("Original 32x512 input, no graph or shape modifications.\n")
    names, input_hashes = [], {}
    for case in report["cases"]:
        name = case.get("case")
        if not isinstance(name, str) or not re.fullmatch("original-holdout-rendered-[a-z-]+", name) or name in names:
            raise ValueError("unique rendered case names required")
        names.append(name)
        values = read_npz(path=evaluation_run / name / "inputs.npz")
        check_values(values=values, schema=INPUTS)
        if np.any(values["data"] < 0) or np.any(values["data"] > 255):
            raise ValueError("byte-range fixture required")
        directory = out / f"case-{name}"
        directory.mkdir()
        data = values["data"].transpose(0, 2, 3, 1).astype("<f4").tobytes()
        (directory / "input.f32").write_bytes(data)
        (directory / "shape.txt").write_text("32 512\n")
        input_hashes[name] = sha256(data=data)
    result = {"status": "running", "runtime_sha256": RUNTIME_SHA256, "evaluation_report_sha256": report_sha,
              "source_model_sha256": SOURCE_SHA256, "native_rerun": True, "cpu_only": True,
              "original_graph_shape": [1, 3, 32, 512], "cases": [], "tolerance": {"atol": 1e-4, "rtol": 1e-4}}
    try:
        result["oracle"] = run_oracle(out=out)
        if result["oracle"]["status"] != "completed":
            raise ValueError("native oracle did not complete")
        for source_case in report["cases"]:
            name = source_case["case"]
            entry = {"case": name, "passed": False}
            try:
                directory = out / f"case-{name}"
                expected, descriptors = read_native(directory=directory, names=["embedding"])
                native = expected["embedding"].numpy()
                check_values(values={"embedding": native}, schema=OUTPUTS)
                np.savez(directory / "native-outputs.npz", embedding=native)
                decoded = decode_logits(logits=native, alphabet=alphabet, layout="NCHW")[0]
                entry.update(descriptors=descriptors, decoded=decoded,
                             input_echo_exact=sha256(data=(directory / "native-input.f32").read_bytes()) == input_hashes[name],
                             metrics=text_metrics(actual=decoded["text"], expected=source_case["expected"]), comparisons={})
                for backend in ("pytorch", "onnx"):
                    values = read_npz(path=evaluation_run / name / f"{backend}-outputs.npz")
                    check_values(values=values, schema=OUTPUTS)
                    comparison = compare_all(actual=values["embedding"], expected=native)
                    comparison["text_equal"] = decoded["text"] == source_case["backends"][backend]["decoded"]["text"]
                    entry["comparisons"][backend] = comparison
                entry["passed"] = entry["input_echo_exact"] and all(item["passed"] and item["text_equal"]
                                                                       for item in entry["comparisons"].values())
            except Exception as error:
                entry["error"] = f"{type(error).__name__}: {error}"
            result["cases"].append(entry)
        result["evidence_hashes_unchanged"] = (file_digest(path=LIBRARY) == RUNTIME_SHA256
                                                  and file_digest(path=evaluation_run / "report.json") == report_sha)
        result["passed_cases"] = sum(case["passed"] for case in result["cases"])
        result["quality"] = aggregate_metrics(cases=[case["metrics"] for case in result["cases"] if "metrics" in case])
        result["status"] = ("native-byte-range-parity-passed" if result["passed_cases"] == 11
                            and result["evidence_hashes_unchanged"] else "verification-failed")
    except Exception as error:
        result.update(status="verification-failed", error=f"{type(error).__name__}: {error}")
    (out / "report.json").write_text(json.dumps(result, ensure_ascii=True, indent=2, allow_nan=False) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-run", type=Path, required=True)
    parser.add_argument("--evaluation-run", type=Path, required=True)
    parser.add_argument("--alphabet", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    report = verify(source_run=args.source_run, evaluation_run=args.evaluation_run,
                    alphabet_path=args.alphabet, out=args.out)
    print(json.dumps({key: report.get(key) for key in ("status", "passed_cases", "quality", "oracle", "error")}))
    return int(report["status"] != "native-byte-range-parity-passed")


if __name__ == "__main__":
    raise SystemExit(main())
