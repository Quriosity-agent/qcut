#!/usr/bin/env python3
"""Run a private PyTorch bundle using named NPZ tensors, without vendor runtimes."""
import argparse
import json
import pathlib
import statistics
import time
import zipfile

import numpy as np
import torch

from espresso_archive import sha256
from espresso_torch import FORMAT as ESPRESSO_FORMAT, load_model

MAX_INPUT_BYTES = 256 * 1024 * 1024


def load_inputs(*, path):
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len({info.filename for info in members}) != len(members):
            raise ValueError("duplicate input archive member")
        if sum(info.file_size for info in members) > MAX_INPUT_BYTES:
            raise ValueError("input archive exceeds 256 MiB")
    with np.load(path, allow_pickle=False) as archive:
        arrays = {name: archive[name] for name in archive.files}
    if not arrays:
        raise ValueError("empty input archive")
    for name, value in arrays.items():
        if value.dtype not in (np.float32, np.int16) or not np.isfinite(value).all():
            raise ValueError(f"{name}: expected finite float32 or int16 tensor")
    return {name: torch.from_numpy(value.copy()) for name, value in arrays.items()}


def load_predictor(*, path, network=None):
    from shot_export import FORMAT as SHOT_FORMAT, load_shots
    metadata = torch.load(path, weights_only=True, map_location="cpu")
    if not isinstance(metadata, dict):
        raise ValueError("bundle metadata must be a dictionary")
    kind = metadata.get("format")
    if kind == "qcut-private-tracking-pytorch-v1":
        from tracking_torch import load_model as load_tracking
        if not isinstance(network, str) or not network:
            raise ValueError("tracking bundle requires an explicit --network")
        return load_tracking(path=path, name=network), kind
    if network is not None:
        raise ValueError("network selection is supported only for tracking bundles")
    if kind == ESPRESSO_FORMAT:
        model = load_model(path=path)
        return model, kind
    if kind == SHOT_FORMAT:
        backbone, head = load_shots(path=path)
        return shot_predictor(backbone=backbone, head=head, shape=(7, 3, 96, 96)), kind
    if kind == "qcut-private-legacy-shot-pytorch":
        from legacy_shot_export import load_legacy
        backbone, head = load_legacy(path=path)
        return shot_predictor(backbone=backbone, head=head, shape=(11, 3, 128, 128)), kind
    if kind == "qcut-bounded-tflite-pytorch":
        from tflite_torch import load_model as load_tflite
        model = load_tflite(path=path)

        def predict(inputs):
            if set(inputs) != {"image"}:
                raise ValueError("TFLite bundle requires the named NHWC input 'image'")
            return {"logits": model(inputs["image"])}

        return predict, kind
    if kind == "qcut-private-denoise-pytorch-v1":
        from denoise_torch import load_model as load_denoise
        return load_denoise(path=path), kind
    if kind == "qcut-private-facefitting3d-pytorch-v1":
        from facefitting_torch import load_model as load_facefitting
        return load_facefitting(path=path), kind
    if kind == "qcut-private-classifier-pytorch-v1":
        from classifier_torch import load_model as load_classifier
        return load_classifier(path=path), kind
    if kind == "qcut-private-ocr-detector-pytorch-v1":
        from ocr_torch import load_model as load_ocr
        return load_ocr(path=path), kind
    if kind == "qcut-private-vision-batch-pytorch-v1":
        from vision_batch_torch import load_model as load_vision
        return load_vision(path=path), kind
    if kind == "qcut-private-ocr-recognizer-logits-pytorch-v4":
        from ocr_rec_torch import load_validated_model
        return load_validated_model(path=path), kind
    if kind == "qcut-private-matting-gru-cpu-v3":
        from matting_validated import load_model as load_matting
        return load_matting(path=path), kind
    raise ValueError(f"unsupported bundle format: {kind}")


def shot_predictor(*, backbone, head, shape):
    def predict(inputs):
        if set(inputs) != {"frames"} or tuple(inputs["frames"].shape) != shape:
            raise ValueError(f"shot input must be frames{shape}")
        features = backbone(inputs["frames"])
        return {"features": features, "probability": head(features)}

    return predict


def run_inference(*, model_path, input_path, output_path, repeats=1, warmup=0, network=None):
    if repeats < 1 or warmup < 0:
        raise ValueError("repeats must be positive and warmup nonnegative")
    source_paths = {model_path.resolve(), input_path.resolve()}
    destination_paths = {output_path.resolve(), output_path.with_suffix(".json").resolve()}
    if output_path.suffix != ".npz" or source_paths & destination_paths:
        raise ValueError("output must be a separate .npz file")
    inputs = load_inputs(path=input_path)
    predictor, kind = load_predictor(path=model_path, network=network)
    if kind != "qcut-private-tracking-pytorch-v1" and any(value.dtype != torch.float32 for value in inputs.values()):
        raise ValueError("float32 inputs required for this bundle format")
    times = []
    with torch.inference_mode():
        for index in range(warmup + repeats):
            start = time.perf_counter()
            outputs = predictor(inputs)
            elapsed = (time.perf_counter() - start) * 1000
            if not isinstance(outputs, dict) or not outputs or any(
                not isinstance(value, torch.Tensor) or value.numel() == 0 or not torch.isfinite(value).all()
                for value in outputs.values()
            ):
                raise ValueError("expected nonempty finite tensor outputs")
            if index >= warmup:
                times.append(elapsed)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(output_path, **{name: value.cpu().numpy() for name, value in outputs.items()})
    report = {"format": kind, "network": network, "model_sha256": sha256(path=model_path), "input_sha256": sha256(path=input_path),
              "input_dtypes": {name: str(value.dtype) for name, value in inputs.items()},
              "output_dtypes": {name: str(value.dtype) for name, value in outputs.items()},
              "outputs": {name: list(value.shape) for name, value in outputs.items()}, "device": "cpu",
              "median_ms": statistics.median(times), "min_ms": min(times), "max_ms": max(times),
              "repeats": repeats, "warmup": warmup, "vendor_runtime_loaded": False}
    output_path.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=pathlib.Path, required=True)
    parser.add_argument("--input", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--network", help="explicit subnetwork name for a tracking bundle")
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--warmup", type=int, default=0)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.out.suffix != ".npz" or args.threads < 1:
        parser.error("output must end in .npz and threads must be positive")
    torch.set_num_threads(args.threads)
    report = run_inference(model_path=args.model, input_path=args.input, output_path=args.out,
                           repeats=args.repeats, warmup=args.warmup, network=args.network)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
