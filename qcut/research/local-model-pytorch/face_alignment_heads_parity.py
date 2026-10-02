"""Fixed stage-specific numerical gates for the independent alignment networks."""
from functools import partial

import numpy as np


FLOAT_LIMITS = {
    "PoolingDown": (0.0, 0.0, None),
    "OnnxOp1": (0.0, 0.0, None),
    "InnerProduct": (0.0001, 0.00001, None),
    "Sigmoid": (0.000001, 0.00001, 0.001),
    "Softmax": (0.000001, 0.00001, 0.001),
}


def compare_float(*, actual, expected, descriptor, raw, atol, rtol, relative_limit):
    if descriptor != {"type": 4, "fraction": 0} or tuple(raw) != (4, 0):
        return {"passed": False, "reason": "float storage descriptor mismatch"}
    if actual.shape != expected.shape or actual.size == 0 or actual.ndim != 4:
        return {"passed": False, "reason": "nonempty matching NHWC float outputs required"}
    if (actual.dtype != np.float32 or expected.dtype != np.float32
            or not np.isfinite(actual).all() or not np.isfinite(expected).all()):
        return {"passed": False, "reason": "finite float32 outputs required"}
    error = np.abs(actual.astype(np.float64) - expected.astype(np.float64))
    limits = atol + rtol * np.abs(expected.astype(np.float64))
    maximum = float(error.max())
    relative = float((error / np.maximum(np.abs(expected.astype(np.float64)), 1e-30)).max())
    passed = bool((error <= limits).all()) and (relative_limit is None or relative <= relative_limit)
    return {"passed": passed, "elements": int(actual.size), "mismatches": int(np.count_nonzero(error)),
            "exact": maximum == 0, "max_abs": maximum, "max_relative": relative,
            "atol": atol, "rtol": rtol, "relative_limit": relative_limit}


def comparisons(*, graph):
    result = {}
    for layer in graph["layers"]:
        for name in layer["outputs"]:
            if graph["descriptors"][name]["type"] != 4:
                continue
            if layer["op"] not in FLOAT_LIMITS:
                raise ValueError("unverified floating alignment comparator")
            atol, rtol, relative = FLOAT_LIMITS[layer["op"]]
            result[name] = partial(compare_float, atol=atol, rtol=rtol, relative_limit=relative)
    return result


def case_passed(*, report, graph, terminals):
    if not isinstance(report, dict) or not isinstance(report.get("blobs"), dict) or report.get("passed") is not True:
        return False
    names = [name for layer in graph["layers"] if layer["op"] != "Input" for name in layer["outputs"]]
    operators = {name: layer["op"] for layer in graph["layers"] for name in layer["outputs"]}
    consumed = {name for layer in graph["layers"] for name in layer["inputs"]}
    expected_terminals = set(names) - consumed
    if (not names or len(set(names)) != len(names) or set(report["blobs"]) != set(names)
            or not terminals or len(set(terminals)) != len(terminals) or set(terminals) != expected_terminals):
        return False
    for name in names:
        checks = report["blobs"][name]
        keys = {"pytorch", "onnx", "pytorch_reloaded", "onnx_terminal"} if name in terminals else {"pytorch", "onnx"}
        if not isinstance(checks, dict) or set(checks) != keys:
            return False
        for check in checks.values():
            if (not isinstance(check, dict) or check.get("passed") is not True
                    or type(check.get("elements")) is not int
                    or check["elements"] != int(np.prod(graph["shapes"][name])) or check["elements"] < 1
                    or type(check.get("mismatches")) is not int or not 0 <= check["mismatches"] <= check["elements"]):
                return False
            if graph["descriptors"][name]["type"] != 4:
                if type(check.get("max_abs")) is not int or check["max_abs"] != 0 or check["mismatches"] != 0:
                    return False
                continue
            if operators[name] not in FLOAT_LIMITS:
                return False
            if set(check) != {"passed", "elements", "mismatches", "exact", "max_abs", "max_relative",
                              "atol", "rtol", "relative_limit"}:
                return False
            atol, rtol, relative = FLOAT_LIMITS[operators[name]]
            if (type(check.get("atol")) is not float or check["atol"] != atol
                    or type(check.get("rtol")) is not float or check["rtol"] != rtol
                    or check.get("relative_limit") != relative
                    or (relative is not None and type(check.get("relative_limit")) is not float)
                    or type(check.get("max_abs")) is not float or not np.isfinite(check["max_abs"]) or check["max_abs"] < 0
                    or type(check.get("max_relative")) is not float or not np.isfinite(check["max_relative"]) or check["max_relative"] < 0
                    or check.get("exact") is not (check["mismatches"] == 0)
                    or (atol == 0 and rtol == 0 and check["max_abs"] != 0)
                    or (relative is not None and check["max_relative"] > relative)):
                return False
    return True
