"""PNG -> pinned PT/ONNX -> proven CTC mapping; report actual OCR errors."""
import argparse
import json
from pathlib import Path
import platform
import sys
import time

import numpy as np

from ocr_decode_binary import private_directory, sha256
from ocr_decode_contract import SOURCE_SHA256, load_pinned_alphabet, read_json
from ocr_decode_ctc import decode_logits
from ocr_decode_metrics import aggregate_metrics, text_metrics
from ocr_rec_onnx_replay import (BUNDLE_SHA256, INPUTS, OUTPUTS, SOURCE_FORMAT, check_source_report, compare_all)
from onnx_infer import ONNXModel, check_values, read_npz


ONNX_SHA256 = "ddda8bc84346e8474fafca1c4a423a5bc7f60693a31b277cad85d6d59c999812"


def file_digest(*, path):
    return sha256(data=Path(path).read_bytes())


def image_input(*, image_path, input_mode):
    from PIL import Image

    if input_mode not in ("fixture", "byte-float"):
        raise ValueError("explicit input profile required")
    with Image.open(image_path) as image:
        if image.size != (512, 32) or image.mode != "RGB":
            raise ValueError("unaltered 512x32 RGB fixture PNG required")
        pixels = np.asarray(image).astype(np.float32)
    if input_mode == "fixture":
        pixels = pixels / 127.5 - 1
    return pixels.transpose(2, 0, 1)[None].copy()


def make_backends(*, run, contract, backends, threads):
    if (not isinstance(backends, list) or not backends or len(backends) != len(set(backends))
            or not set(backends) <= {"pytorch", "onnx"}):
        raise ValueError("unique supported backends required")
    result, evidence = {}, {}
    if "pytorch" in backends:
        import torch
        from ocr_rec_torch import load_validated_model

        torch.set_num_threads(threads)
        bundle = run / "ocr-recognizer-logits.pt"
        pt = load_validated_model(path=bundle, expected_sha256=BUNDLE_SHA256)

        def pytorch(values):
            with torch.inference_mode():
                return {key: value.numpy() for key, value in pt({"data": torch.from_numpy(values["data"])}).items()}

        result["pytorch"] = pytorch
        evidence["pytorch"] = {"artifact": str(bundle), "sha256": BUNDLE_SHA256, "version": torch.__version__}
    if "onnx" in backends:
        onnx = ONNXModel(contract_path=contract, threads=threads)
        if (onnx.metadata.get("source_format") != SOURCE_FORMAT
                or onnx.metadata.get("source_bundle_sha256") != BUNDLE_SHA256
                or onnx.metadata.get("artifact_sha256") != ONNX_SHA256
                or onnx.inputs != INPUTS or onnx.outputs != OUTPUTS):
            raise ValueError("the certified OCR v4 ONNX contract is required")
        result["onnx"] = onnx
        evidence["onnx"] = {"artifact": str(contract.parent / onnx.metadata["artifact"]), "sha256": ONNX_SHA256,
                            "contract_sha256": file_digest(path=contract), "providers": onnx.session.get_providers(),
                            "version": sys.modules["onnxruntime"].__version__, "graph_optimization": "disabled"}
    return result, evidence


def evaluate_case(*, case, run, out, input_mode, alphabet, engines):
    name = case["case"]
    image_path = run / "rendered-inputs" / f"{name}.png"
    directory = run / f"case-{name}"
    paths = [image_path, directory / "inputs.npz", directory / "pytorch-outputs.npz", directory / "native-outputs.npz"]
    hashes = {str(path): file_digest(path=path) for path in paths}
    frozen = read_npz(path=directory / "inputs.npz")
    check_values(values=frozen, schema=INPUTS)
    fixture_input = image_input(image_path=image_path, input_mode="fixture")
    if not np.array_equal(fixture_input, frozen["data"]):
        raise ValueError("rendered PNG no longer regenerates frozen input")
    nhwc = frozen["data"].transpose(0, 2, 3, 1).astype("<f4").tobytes()
    if sha256(data=nhwc) != case["input_sha256"]:
        raise ValueError("frozen input provenance mismatch")
    values = {"data": image_input(image_path=image_path, input_mode=input_mode)}
    destination = out / name
    destination.mkdir()
    np.savez(destination / "inputs.npz", **values)
    result = {"case": name, "image": str(image_path), "expected": case["fixture"]["text"],
              "input_mode": input_mode, "files_sha256": hashes, "backends": {}, "comparisons": {},
              "input_min": float(values["data"].min()), "input_max": float(values["data"].max())}
    outputs_by_backend = {}
    for backend, engine in engines.items():
        started = time.perf_counter()
        outputs = engine(values)
        seconds = time.perf_counter() - started
        check_values(values=outputs, schema=OUTPUTS)
        outputs_by_backend[backend] = outputs["embedding"]
        artifact = destination / f"{backend}-outputs.npz"
        np.savez(artifact, **outputs)
        decoded = decode_logits(logits=outputs["embedding"], alphabet=alphabet, layout="NCHW")[0]
        result["backends"][backend] = {"decoded": decoded, "inference_seconds": seconds,
                                        "metrics": text_metrics(actual=decoded["text"], expected=result["expected"]),
                                        "output": str(artifact), "output_sha256": file_digest(path=artifact)}
    if input_mode == "fixture":
        for reference in ("native", "pytorch"):
            values = read_npz(path=directory / f"{reference}-outputs.npz")
            check_values(values=values, schema=OUTPUTS)
            frozen_decoded = decode_logits(logits=values["embedding"], alphabet=alphabet, layout="NCHW")[0]
            result[f"frozen_{reference}_text"] = frozen_decoded["text"]
            for backend, actual in outputs_by_backend.items():
                comparison = compare_all(actual=actual, expected=values["embedding"])
                comparison["text_equal"] = result["backends"][backend]["decoded"]["text"] == frozen_decoded["text"]
                result["comparisons"][f"{backend}_vs_frozen_{reference}"] = comparison
    if set(outputs_by_backend) == {"pytorch", "onnx"}:
        result["comparisons"]["onnx_vs_pytorch"] = compare_all(actual=outputs_by_backend["onnx"], expected=outputs_by_backend["pytorch"])
        result["comparisons"]["onnx_vs_pytorch"]["text_equal"] = (result["backends"]["onnx"]["decoded"]["text"]
                                                                    == result["backends"]["pytorch"]["decoded"]["text"])
    if any(file_digest(path=path) != value for path, value in hashes.items()):
        raise ValueError("source evidence changed during case")
    result["technical_passed"] = all(value["passed"] and value.get("text_equal", True) for value in result["comparisons"].values())
    if not result["comparisons"]:
        result["technical_passed"] = False
    (destination / "result.json").write_text(json.dumps(result, ensure_ascii=True, indent=2, allow_nan=False) + "\n")
    return result


def evaluate(*, run, contract, alphabet_path, out, input_mode, backends, threads=2):
    if type(threads) is not int or not 1 <= threads <= 8:
        raise ValueError("bounded integer CPU thread count required")
    out = private_directory(path=out)
    if any(out.iterdir()):
        raise ValueError("fresh evaluation directory required")
    run, contract = Path(run).resolve(), Path(contract).resolve()
    alphabet, metadata, _ = load_pinned_alphabet(path=alphabet_path)
    report, source_report_sha = read_json(path=run / "report.json")
    check_source_report(report=report)
    cases = [case for case in report["cases"] if case.get("fixture") is not None]
    if len(cases) != 11 or not all(isinstance(case["fixture"].get("text"), str) for case in cases):
        raise ValueError("all 11 authored rendered images required")
    result = {"status": "running", "cases": [], "input_mode": input_mode,
              "source_report_sha256": source_report_sha, "source_model_sha256": SOURCE_SHA256,
              "mapping_sha256": metadata["mapping_sha256"], "alphabet_file_sha256": file_digest(path=alphabet_path),
              "platform": platform.platform(), "machine": platform.machine(), "python": platform.python_version(),
              "numpy": np.__version__, "native_rerun": False, "editor_e2e": False,
              "scope": "11 authored PNG strips to text; no detector, crop/orientation or product pipeline claim",
              "preprocessing_certified": False, "cpu_threads": threads}
    report_path = out / "report.json"

    def save():
        report_path.write_text(json.dumps(result, ensure_ascii=True, indent=2, allow_nan=False) + "\n")

    try:
        engines, evidence = make_backends(run=run, contract=contract, backends=backends, threads=threads)
        result["engines"] = evidence
        save()
        for case in cases:
            try:
                entry = evaluate_case(case=case, run=run, out=out, input_mode=input_mode, alphabet=alphabet, engines=engines)
            except Exception as error:
                entry = {"case": case["case"], "technical_passed": False, "error": f"{type(error).__name__}: {error}"}
            result["cases"].append(entry)
            save()
            print(json.dumps({"case": entry["case"], "technical_passed": entry["technical_passed"],
                              "texts": {name: value["decoded"]["text"] for name, value in entry.get("backends", {}).items()},
                              "error": entry.get("error")}, ensure_ascii=True), flush=True)
        result["quality"] = {name: aggregate_metrics(cases=[case["backends"][name]["metrics"] for case in result["cases"]
                                                            if name in case.get("backends", {})]) for name in engines
                             if any(name in case.get("backends", {}) for case in result["cases"])}
        result["technical_passed"] = sum(case["technical_passed"] for case in result["cases"])
        stable = (file_digest(path=run / "report.json") == source_report_sha
                  and file_digest(path=alphabet_path) == result["alphabet_file_sha256"]
                  and all(file_digest(path=item["artifact"]) == item["sha256"] for item in evidence.values()))
        result["evidence_hashes_unchanged"] = stable
        result["status"] = "image-to-text-executed" if result["technical_passed"] == 11 and stable else "verification-failed"
    except Exception as error:
        result.update(status="verification-failed", error=f"{type(error).__name__}: {error}")
    finally:
        save()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--alphabet", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--input-mode", choices=("fixture", "byte-float"), default="fixture")
    parser.add_argument("--backend", choices=("pytorch", "onnx"), action="append")
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    result = evaluate(run=args.run, contract=args.contract, alphabet_path=args.alphabet, out=args.out,
                      input_mode=args.input_mode, backends=args.backend or ["pytorch", "onnx"], threads=args.threads)
    print(json.dumps({key: result.get(key) for key in ("status", "quality", "technical_passed", "error")}))
    return int(result["status"] != "image-to-text-executed")


if __name__ == "__main__":
    raise SystemExit(main())
