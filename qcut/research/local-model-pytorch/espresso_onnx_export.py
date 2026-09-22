"""Export a float32 espresso network to ONNX and check it against the frozen native outputs.

Only graphs whose blobs are float32 are exportable: the fixed-point networks depend on rounding,
int32 wraparound and one-sided lane clamps that standard ONNX operators cannot express, and a
float approximation of them would not be the network the runtime runs.

Even for a float graph one operator is approximated: on two classes the runtime's softmax takes
the exponent relative to channel 0 and scales by the hardware reciprocal estimate, so the export
uses an ordinary softmax and this script reports the resulting deviation instead of hiding it.
The comparison is against the tensors the pinned runtime produced in a parity run, not against a
second copy of our own arithmetic.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime
import torch

from espresso_torch import load

PRIVATE = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"


def frozen_case(*, parity_dir):
    """Inputs and native outputs the parity run stored for this network."""
    request = json.loads((parity_dir / "request.json").read_text())
    response = json.loads((parity_dir / "response.json").read_text())
    inputs = {}
    for item in request["inputs"]:
        n, w, h, c = item["dims_nwhc"]
        inputs[item["name"]] = np.fromfile(parity_dir / item["file"], dtype="<f4").reshape(n, h, w, c)
    outputs = {}
    for item in response["outputs"]:
        n, w, h, c = item["dims_nwhc"]
        outputs[item["name"]] = np.fromfile(parity_dir / item["file"], dtype="<f4").reshape(n, h, w, c)
    return inputs, outputs


def export(*, network, parity_dir, out):
    out.mkdir(parents=True, exist_ok=True)
    model = load(directory=network)
    inputs, natives = frozen_case(parity_dir=parity_dir)
    ordered = [torch.from_numpy(inputs[name].transpose(0, 3, 1, 2).copy()) for name in model.input_names]
    artifact = out / "model.onnx"
    torch.onnx.export(model, tuple(ordered), str(artifact), opset_version=18, dynamo=False,
                      input_names=list(model.input_names), output_names=[model.output_name])
    with torch.no_grad():
        reference = model(*ordered).numpy().transpose(0, 2, 3, 1)
    session = onnxruntime.InferenceSession(str(artifact), providers=["CPUExecutionProvider"])
    produced = session.run([model.output_name], {name: tensor.numpy() for name, tensor in zip(model.input_names, ordered)})[0]
    produced = produced.transpose(0, 2, 3, 1)
    native = natives.get(model.output_name)
    report = {
        "network": network.name,
        "onnx_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        "output": model.output_name,
        "onnx_vs_torch_max_abs": float(np.abs(produced.astype(np.float64) - reference.astype(np.float64)).max()),
    }
    if native is not None and np.isfinite(native).all():
        report["onnx_vs_native_max_abs"] = float(np.abs(produced.astype(np.float64) - native.astype(np.float64)).max())
    else:
        report["onnx_vs_native_max_abs"] = None
        report["native_comparable"] = False
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", required=True, type=Path, help="collected directory with graph.txt and arena.bin")
    parser.add_argument("--parity", required=True, type=Path, help="parity case directory with request/response tensors")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(PRIVATE.resolve()):
        raise SystemExit("output must stay beneath the private ignored directory")
    print(json.dumps(export(network=args.network, parity_dir=args.parity, out=args.out)))


if __name__ == "__main__":
    main()
