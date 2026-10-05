"""Bind owned Extra receipts to this run; hashes alone never prove native parity."""
import math

from face_alignment_replay import valid_hash
from face_live_candidate_contract import fields


def audit(*, worker, expected_version):
    if (type(expected_version) is not str or not expected_version.startswith("extra-heads-v1:") or
            not valid_hash(value=expected_version.split(":", 1)[1]) or
            type(worker) is not list or len(worker) != 2):
        raise ValueError("two cold Extra receipts and pinned model version required")
    times = []
    for index, row in enumerate(worker):
        if type(row) is not dict or type(row.get("result")) is not dict:
            raise ValueError("Extra worker row and result must be objects")
        result = row.get("result", {})
        dependencies = result.get("native_dependencies")
        if type(dependencies) is not list or any(type(value) is not str for value in dependencies):
            raise ValueError("Extra native dependencies must be a string list")
        if (row.get("ok") is not True or type(row.get("prediction")) is not int or row["prediction"] != index or
                type(row.get("timestamp_us")) is not int or row["timestamp_us"] != 0):
            raise ValueError("Extra receipt outside cold worker scope")
        receipt = result.get("extra_refinement")
        fields(value=receipt, names=("schema", "backend_version", "geometry_sha256", "algorithm_rgba_sha256",
            "input_tensor_sha256", "head_sha256", "primary_sha256", "head_shape", "sampling", "geometry",
            "captured_tensor_input_used", "native_final_point_input_used", "product_parity_verified", "elapsed_ms"))
        if (receipt["schema"] != "face-live-extra-refinement-v1" or receipt["backend_version"] != expected_version or
                receipt["head_shape"] != [240, 2] or any(type(value) is not int for value in receipt["head_shape"]) or
                receipt["sampling"] != "owned-from-algorithm-rgba" or
                receipt["geometry"] != "native-live-extra-transforms-and-mean" or
                receipt["algorithm_rgba_sha256"] != result.get("algorithm_rgba_sha256") or
                "extra-inner-filter-crop-transforms-and-mean" not in dependencies):
            raise ValueError("Extra receipt provenance mismatch")
        for key in ("geometry_sha256", "algorithm_rgba_sha256", "input_tensor_sha256", "head_sha256", "primary_sha256"):
            if not valid_hash(value=receipt[key]):
                raise ValueError("Extra receipt hash missing")
        for key in ("captured_tensor_input_used", "native_final_point_input_used", "product_parity_verified"):
            if receipt[key] is not False:
                raise ValueError("Extra receipt overstates ownership/parity")
        elapsed = receipt["elapsed_ms"]
        if type(elapsed) not in (int, float) or not 0 <= elapsed <= 120000 or not math.isfinite(elapsed):
            raise ValueError("bounded Extra runtime required")
        times.append(elapsed)
    return dict(schema="face-live-extra-receipt-audit-v1", passed=True, predictions=2,
                backend_version=expected_version, elapsed_ms=times,
                receipts_are_hashes_not_native_comparisons=True, product_parity_verified=False)
