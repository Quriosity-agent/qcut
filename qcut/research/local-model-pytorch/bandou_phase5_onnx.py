"""Bounded bandou-only ONNX probe; no edits to shared registration or adapters."""
import argparse
import io
import json
from pathlib import Path
import time
import warnings

import numpy as np
import onnx
import torch

from bandou_phase5_torch import FORMAT as SOURCE_FORMAT, load_model
from bandou_phase5_probe import read_tensors
from bytenn_oracle import sha256
from onnx_export import TupleGraph, cases, compare, schema
from onnx_infer import FORMAT, ONNXModel
from vision_batch_export import fresh_directory


def compact_broadcasts(*, model):
    records = []
    counter = 0
    pending = [model.graph]
    occupied = set()
    scan = [model.graph]
    while scan:
        graph = scan.pop()
        occupied.update(tensor.name for tensor in graph.initializer)
        occupied.update(value.name for value in graph.input)
        for node in graph.node:
            occupied.update(node.output)
            for attr in node.attribute:
                if attr.type == onnx.AttributeProto.GRAPH:
                    scan.append(attr.g)
                elif attr.type == onnx.AttributeProto.GRAPHS:
                    scan.extend(attr.graphs)

    def replacement(*, tensor, output, graph):
        nonlocal counter
        if tensor.data_type != onnx.TensorProto.FLOAT or len(tensor.dims) < 2 or tensor.dims[-1] < 256:
            return None
        array = onnx.numpy_helper.to_array(tensor)
        if array.nbytes < 1024 * 1024:
            return None
        base = np.ascontiguousarray(array[..., :1])
        if not np.array_equal(array.view(np.uint32), np.broadcast_to(base.view(np.uint32), array.shape)):
            return None
        while True:
            prefix = f"bandou_compact_{counter}"
            counter += 1
            base_name, shape_name = prefix + "_base", prefix + "_shape"
            if base_name not in occupied and shape_name not in occupied:
                occupied.update((base_name, shape_name))
                break
        graph.initializer.extend([onnx.numpy_helper.from_array(base, base_name),
                                  onnx.numpy_helper.from_array(np.asarray(array.shape, np.int64), shape_name)])
        records.append({"tensor": output, "shape": list(array.shape), "original_bytes": array.nbytes,
                        "base_bytes": base.nbytes, "bitwise_broadcast_verified": True})
        return onnx.helper.make_node("Expand", [base_name, shape_name], [output], name=prefix)

    while pending:
        graph = pending.pop()
        nodes, retained, expanded = [], [], []
        for tensor in tuple(graph.initializer):
            if tensor.name in {value.name for value in graph.input}:
                retained.append(tensor)
                continue
            node = replacement(tensor=tensor, output=tensor.name, graph=graph)
            if node is None:
                retained.append(tensor)
            else:
                expanded.append(node)
        new_initializers = list(graph.initializer[len(retained) + len(expanded):])
        graph.ClearField("initializer")
        graph.initializer.extend(retained + new_initializers)
        for node in graph.node:
            for attr in node.attribute:
                if attr.type == onnx.AttributeProto.GRAPH:
                    pending.append(attr.g)
                elif attr.type == onnx.AttributeProto.GRAPHS:
                    pending.extend(attr.graphs)
            tensor_attrs = [attr.t for attr in node.attribute if attr.type == onnx.AttributeProto.TENSOR and attr.name == "value"]
            substitute = (replacement(tensor=tensor_attrs[0], output=node.output[0], graph=graph)
                          if node.op_type == "Constant" and len(node.output) == len(tensor_attrs) == 1 else None)
            nodes.append(substitute if substitute is not None else node)
        graph.ClearField("node")
        graph.node.extend(expanded + nodes)
    return records


def export(*, model_path, input_path, out, expected_sha256):
    out = fresh_directory(path=out)
    report = {"status": "export-failed", "source_format": SOURCE_FORMAT, "source_bundle_sha256": expected_sha256,
              "scope": "bounded macOS CPU ONNX/PyTorch smoke; no new native or target-OS execution", "cases": []}
    try:
        model = load_model(path=model_path, expected_sha256=expected_sha256)
        inputs = read_tensors(path=input_path)
        with torch.inference_mode():
            outputs = model(inputs)
        wrapper = TupleGraph(model=model, inputs=list(inputs), outputs=list(outputs)).eval()
        artifact = out / "model.onnx"
        print("Exporting one fixed-shape bandou graph", flush=True)
        buffer = io.BytesIO()
        with warnings.catch_warnings(record=True) as observed, torch.inference_mode():
            warnings.simplefilter("always")
            torch.onnx.export(wrapper, tuple(inputs.values()), buffer, opset_version=18, dynamo=False,
                              input_names=list(inputs), output_names=list(outputs), external_data=False)
        (out / "warnings.json").write_text(json.dumps(sorted({str(item.message) for item in observed}), indent=2) + "\n")
        graph = onnx.load_model_from_string(buffer.getvalue())
        report["uncompressed_export_bytes"] = buffer.tell()
        buffer.close()
        report["broadcast_compaction"] = compact_broadcasts(model=graph)
        if not 0 < graph.ByteSize() <= 64 * 1024 * 1024:
            raise ValueError("bandou export exceeds 64 MiB bound")
        for value in graph.graph.output:
            value.type.tensor_type.shape.ClearField("dim")
            for extent in outputs[value.name].shape:
                value.type.tensor_type.shape.dim.add().dim_value = int(extent)
        onnx.checker.check_model(graph, full_check=True)
        if graph.functions or any(value.data_location == onnx.TensorProto.EXTERNAL for value in graph.graph.initializer):
            raise ValueError("external data or custom functions not allowed")
        nested = [graph.graph]
        node_count = 0
        while nested:
            current = nested.pop()
            for node in current.node:
                node_count += 1
                if node.domain not in ("", "ai.onnx"):
                    raise ValueError("custom operator domain not allowed")
                for attr in node.attribute:
                    if attr.type == onnx.AttributeProto.GRAPH:
                        nested.append(attr.g)
                    elif attr.type == onnx.AttributeProto.GRAPHS:
                        nested.extend(attr.graphs)
        onnx.save(graph, artifact)
        contract = out / "contract.json"
        metadata = {"format": FORMAT, "status": "candidate-unverified", "local_only": True,
                    "artifact": artifact.name, "artifact_sha256": sha256(path=artifact), "external_data": False,
                    "custom_operators": [], "opset": 18, "source_format": SOURCE_FORMAT, "network": None,
                    "source_bundle_sha256": expected_sha256, "inputs": schema(values=inputs), "outputs": schema(values=outputs),
                    "shape_scope": "fixed original dimensions; not dynamic or arbitrary-size support"}
        contract.write_text(json.dumps(metadata, indent=2) + "\n")
        runtime = ONNXModel(contract_path=contract, allow_unverified=True)
        for name, values in cases(inputs=inputs):
            started = time.monotonic()
            with torch.inference_mode():
                expected = model(values)
            actual = runtime({key: value.numpy() for key, value in values.items()})
            metrics = compare(actual=actual, expected=expected)
            directory = out / name
            directory.mkdir()
            np.savez(directory / "inputs.npz", **{key: value.numpy() for key, value in values.items()})
            np.savez(directory / "pytorch.npz", **{key: value.numpy() for key, value in expected.items()})
            np.savez(directory / "onnx.npz", **actual)
            result = {"case": name, "passed": all(item["passed"] for item in metrics.values()),
                      "outputs": metrics, "seconds": time.monotonic() - started}
            report["cases"].append(result)
            print(json.dumps(result), flush=True)
        passed = len(report["cases"]) == 4 and all(item["passed"] for item in report["cases"])
        metadata["status"] = "onnx-runtime-parity-passed" if passed else "onnx-runtime-parity-failed"
        contract.write_text(json.dumps(metadata, indent=2) + "\n")
        report.update(status=metadata["status"], artifact=str(artifact), artifact_sha256=metadata["artifact_sha256"],
                      artifact_bytes=artifact.stat().st_size, node_count_including_loop_bodies=node_count,
                      providers=runtime.session.get_providers(), contract=str(contract), numeric_adapter_needed=False)
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = export(model_path=args.model, input_path=args.input, out=args.out, expected_sha256=args.sha256)
    print(json.dumps({key: value for key, value in report.items() if key != "cases"}))
    return 0 if report["status"] == "onnx-runtime-parity-passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
