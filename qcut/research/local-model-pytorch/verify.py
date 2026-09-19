"""Deterministic, same-tensor CoreML comparisons; no image preprocessing claims."""
import numpy as np
import torch

from espresso_archive import extract_coreml
from native_oracle import align_batch_axis, predict_native

ATOL = 0.0001
RTOL = 0.0001


def input_cases(*, spec):
    generator = torch.Generator().manual_seed(20260919)
    defaults = {name: schema["shape"] for name, schema in spec["inputs"].items()}
    cases = []
    for mode in ("zeros", "ones", "random"):
        values = {}
        for name, shape in defaults.items():
            values[name] = torch.rand(shape, generator=generator) if mode == "random" else torch.full(shape, float(mode == "ones"))
        cases.append((mode, values))
    for seed in (17, 41, 83):
        holdout = torch.Generator().manual_seed(seed)
        cases.append((f"holdout-{seed}", {name: torch.rand(shape, generator=holdout) * 2 - 1 for name, shape in defaults.items()}))
    for name, schema in spec["inputs"].items():
        for shape in schema["allowed_shapes"]:
            if shape == defaults[name]:
                continue
            values = {key: torch.rand(shape if key == name else value, generator=generator) for key, value in defaults.items()}
            cases.append(("shape-" + "x".join(map(str, shape)), values))
    if "prev_mask" in defaults:
        values = {name: value.clone() for name, value in cases[2][1].items()}
        values["prev_img"].zero_()
        values["prev_mask"].zero_()
        cases.append(("temporal-reset", values))
    return cases


def compare(*, actual, expected):
    if actual.shape != expected.shape:
        return {"passed": False, "reason": "shape mismatch", "actual": list(actual.shape), "expected": list(expected.shape)}
    finite = bool(np.isfinite(actual).all() and np.isfinite(expected).all())
    error = np.abs(actual - expected)
    agreement = (actual > 0.5) == (expected > 0.5)
    return {"passed": finite and bool(np.allclose(actual, expected, atol=ATOL, rtol=RTOL)),
            "finite": finite, "shape": list(actual.shape), "max_abs": float(error.max()) if finite else None,
            "mean_abs": float(error.mean()) if finite else None,
            "threshold_0_5_agreement": float(agreement.mean()) if finite else None,
            "atol": ATOL, "rtol": RTOL}


def verify_model(*, model, restored, source, directory, oracle=None):
    native_model = extract_coreml(path=source, destination=directory / "oracle.mlmodelc") if oracle else None
    result = []
    for index, (label, inputs) in enumerate(input_cases(spec=model.spec)):
        with torch.inference_mode():
            original = model(inputs)
            roundtrip = restored(inputs)
        if any(not torch.equal(original[name], roundtrip[name]) for name in original):
            raise ValueError("PyTorch serialization roundtrip changed output")
        if any(not torch.isfinite(value).all() for value in original.values()):
            raise ValueError("non-finite PyTorch output")
        entry = {"case": label, "roundtrip": True, "outputs": {key: list(value.shape) for key, value in original.items()}}
        if oracle:
            case_dir = directory / f"case-{index}"
            outputs = predict_native(oracle=oracle, native_model=native_model, inputs=inputs, directory=case_dir)
            if set(outputs) != set(original):
                raise ValueError("native output names mismatch")
            entry["native"] = {}
            for name, expected in outputs.items():
                actual = original[name].numpy()
                expected = align_batch_axis(actual=actual, expected=expected)
                entry["native"][name] = compare(actual=actual, expected=expected)
        result.append(entry)
    return result
