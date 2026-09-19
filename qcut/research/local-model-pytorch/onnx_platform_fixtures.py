"""Small, authored ONNX graphs and independent NumPy expectations for portability CI."""
import json
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

from onnx_infer import FORMAT, digest

SCOPE = "authored-synthetic-only"
FLOAT = TensorProto.FLOAT


def tensor(*, name, value):
    return numpy_helper.from_array(np.asarray(value), name=name)


def descriptor(*, name, shape, dtype=FLOAT):
    return helper.make_tensor_value_info(name, dtype, shape)


def graph_model(*, name, nodes, inputs, outputs, weights=()):
    graph = helper.make_graph(nodes, name, inputs, outputs, list(weights))
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)], ir_version=10)
    model.producer_name = "qcut-authored-platform-fixture"
    onnx.checker.check_model(model, full_check=True)
    return model


def schema(*, values):
    return {name: {"dtype": str(value.dtype), "shape": list(value.shape)} for name, value in values.items()}


def conv_reference(*, image, weights, bias, strides=(1, 1), dilation=(1, 1), pads=(0, 0, 0, 0), groups=1):
    padded = np.pad(image, ((0, 0), (0, 0), (pads[0], pads[2]), (pads[1], pads[3])))
    batch, channels, height, width = padded.shape
    output_channels, group_channels, kernel_h, kernel_w = weights.shape
    out_h = (height - dilation[0] * (kernel_h - 1) - 1) // strides[0] + 1
    out_w = (width - dilation[1] * (kernel_w - 1) - 1) // strides[1] + 1
    result = np.empty((batch, output_channels, out_h, out_w), dtype=np.float32)
    for n in range(batch):
        for output_channel in range(output_channels):
            group = output_channel // (output_channels // groups)
            for row in range(out_h):
                for column in range(out_w):
                    total = float(bias[output_channel])
                    for channel in range(group_channels):
                        for ky in range(kernel_h):
                            for kx in range(kernel_w):
                                source = padded[n, group * (channels // groups) + channel,
                                                row * strides[0] + ky * dilation[0],
                                                column * strides[1] + kx * dilation[1]]
                                total += float(source) * float(weights[output_channel, channel, ky, kx])
                    result[n, output_channel, row, column] = total
    return result


def linear_resize_reference(*, image, height, width):
    result = np.empty((*image.shape[:2], height, width), dtype=np.float32)
    for row in range(height):
        y = max(0., (row + 0.5) * image.shape[2] / height - 0.5)
        y0, y1 = int(y), min(int(y) + 1, image.shape[2] - 1)
        for column in range(width):
            x = max(0., (column + 0.5) * image.shape[3] / width - 0.5)
            x0, x1 = int(x), min(int(x) + 1, image.shape[3] - 1)
            top = image[:, :, y0, x0] * (1 - (x - x0)) + image[:, :, y0, x1] * (x - x0)
            bottom = image[:, :, y1, x0] * (1 - (x - x0)) + image[:, :, y1, x1] * (x - x0)
            result[:, :, row, column] = top * (1 - (y - y0)) + bottom * (y - y0)
    return result


def convolution_fixture(*, grouped=False):
    name = "grouped-dilated-linear" if grouped else "conv-relu-nearest"
    shape = (1, 2, 7, 9) if grouped else (1, 2, 5, 7)
    weight_shape = (2, 1, 2, 3) if grouped else (3, 2, 3, 3)
    weights = ((np.arange(np.prod(weight_shape), dtype=np.float32) % 11 - 5) / 16).reshape(weight_shape)
    bias = np.arange(weight_shape[0], dtype=np.float32) / 8 - 0.125
    strides, dilation, pads, groups = ((1, 1), (2, 2), (0, 0, 0, 0), 2) if grouped else ((2, 1), (1, 1), (1, 0, 1, 0), 1)
    output_shape = (1, 2, 3, 8) if grouped else (1, 3, 6, 10)
    nodes = [helper.make_node("Conv", ["image", "weight", "bias"], ["conv"],
                              strides=strides, dilations=dilation, pads=pads, group=groups),
             helper.make_node("Relu", ["conv"], ["positive"])]
    resize = {"mode": "linear", "coordinate_transformation_mode": "half_pixel"} if grouped else {
        "mode": "nearest", "coordinate_transformation_mode": "asymmetric", "nearest_mode": "floor"}
    nodes.append(helper.make_node("Resize", ["positive", "", "", "sizes"], ["resized"], **resize))
    model = graph_model(name=name, nodes=nodes, inputs=[descriptor(name="image", shape=shape)],
                        outputs=[descriptor(name="resized", shape=output_shape)],
                        weights=[tensor(name="weight", value=weights), tensor(name="bias", value=bias),
                                 tensor(name="sizes", value=np.array(output_shape, dtype=np.int64))])
    cases = []
    for seed in (3, 71, 901):
        image = np.random.default_rng(seed).uniform(-2, 2, shape).astype(np.float32)
        convolved = np.maximum(conv_reference(image=image, weights=weights, bias=bias, strides=strides,
                                             dilation=dilation, pads=pads, groups=groups), 0)
        expected = linear_resize_reference(image=convolved, height=3, width=8) if grouped else np.repeat(np.repeat(convolved, 2, axis=2), 2, axis=3)
        cases.append({"name": f"seed-{seed}", "inputs": {"image": image}, "expected": {"resized": expected}})
    return {"name": name, "model": model, "cases": cases, "feedback": {}}


def recurrent_fixture():
    weight = (np.arange(12, dtype=np.float32).reshape(3, 4) - 5) / 16
    recurrent = np.eye(4, dtype=np.float32) * 0.25
    projection = np.array([[0.5, -0.25], [0.25, 0.5], [-0.5, 0.125], [0.125, -0.25]], dtype=np.float32)
    nodes = [helper.make_node("MatMul", ["frame", "weight"], ["input_term"]),
             helper.make_node("MatMul", ["hidden", "recurrent"], ["state_term"]),
             helper.make_node("Add", ["input_term", "state_term"], ["sum"]),
             helper.make_node("Tanh", ["sum"], ["next_hidden"]),
             helper.make_node("Mul", ["memory", "decay"], ["old_memory"]),
             helper.make_node("Mul", ["next_hidden", "update"], ["new_memory"]),
             helper.make_node("Add", ["old_memory", "new_memory"], ["next_memory"]),
             helper.make_node("MatMul", ["next_memory", "projection"], ["features"])]
    model = graph_model(name="explicit-two-state", nodes=nodes,
                        inputs=[descriptor(name="frame", shape=[1, 3]), descriptor(name="hidden", shape=[1, 4]),
                                descriptor(name="memory", shape=[1, 4])],
                        outputs=[descriptor(name="next_hidden", shape=[1, 4]), descriptor(name="next_memory", shape=[1, 4]),
                                 descriptor(name="features", shape=[1, 2])],
                        weights=[tensor(name="weight", value=weight), tensor(name="recurrent", value=recurrent),
                                 tensor(name="projection", value=projection), tensor(name="decay", value=np.float32(0.625)),
                                 tensor(name="update", value=np.float32(0.375))])
    hidden, memory = np.zeros((1, 4), dtype=np.float32), np.zeros((1, 4), dtype=np.float32)
    cases = []
    for index in range(24):
        frame = np.array([[np.sin(index / 3), np.cos(index / 5), (index % 7 - 3) / 4]], dtype=np.float32)
        next_hidden = np.tanh(frame @ weight + hidden @ recurrent)
        next_memory = memory * np.float32(0.625) + next_hidden * np.float32(0.375)
        expected = {"next_hidden": next_hidden, "next_memory": next_memory, "features": next_memory @ projection}
        cases.append({"name": f"frame-{index:02d}", "inputs": {"frame": frame, "hidden": hidden, "memory": memory}, "expected": expected})
        hidden, memory = next_hidden, next_memory
    return {"name": "explicit-two-state", "model": model, "cases": cases,
            "feedback": {"hidden": "next_hidden", "memory": "next_memory"}}


def integer_fixture():
    weights = np.array([[5., -3., 1.], [-4., 2., -1.], [1., 7., -6.], [-2., 1., 4.]], dtype=np.float64)
    nodes = [helper.make_node("Cast", ["samples"], ["wide"], to=TensorProto.DOUBLE),
             helper.make_node("MatMul", ["wide", "weight"], ["product"]),
             helper.make_node("Div", ["product", "divisor"], ["scaled"]),
             helper.make_node("Floor", ["scaled"], ["rounded"]),
             helper.make_node("Clip", ["rounded", "minimum", "maximum"], ["clipped"]),
             helper.make_node("Cast", ["clipped"], ["quantized"], to=TensorProto.INT16)]
    model = graph_model(name="int16-floor-saturation", nodes=nodes,
                        inputs=[descriptor(name="samples", shape=[2, 4], dtype=TensorProto.INT16)],
                        outputs=[descriptor(name="quantized", shape=[2, 3], dtype=TensorProto.INT16)],
                        weights=[tensor(name="weight", value=weights), tensor(name="divisor", value=np.float64(4)),
                                 tensor(name="minimum", value=np.float64(-32768)), tensor(name="maximum", value=np.float64(32767))])
    cases = []
    arrays = [np.array([[-32768, 32767, -1, 1], [32767, -32768, 32767, -32768]], dtype=np.int16),
              np.array([[0, 1, 2, 3], [-1, -2, -3, -4]], dtype=np.int16),
              np.random.default_rng(31).integers(-32768, 32768, (2, 4), dtype=np.int16)]
    for index, samples in enumerate(arrays):
        expected = np.clip(np.floor(samples.astype(np.int64) @ weights.astype(np.int64) / 4), -32768, 32767).astype(np.int16)
        cases.append({"name": f"integer-{index}", "inputs": {"samples": samples}, "expected": {"quantized": expected}})
    return {"name": "int16-floor-saturation", "model": model, "cases": cases, "feedback": {}}


def scalar_fixture():
    model = graph_model(name="scalar-identity", nodes=[helper.make_node("Identity", ["value"], ["result"])],
                        inputs=[descriptor(name="value", shape=[])], outputs=[descriptor(name="result", shape=[])])
    cases = [{"name": f"scalar-{index}", "inputs": {"value": np.array(value, dtype=np.float32)},
              "expected": {"result": np.array(value, dtype=np.float32)}} for index, value in enumerate((0., -0., -3.5))]
    return {"name": "scalar-identity", "model": model, "cases": cases, "feedback": {}}


def fixtures():
    return [convolution_fixture(), convolution_fixture(grouped=True), recurrent_fixture(), integer_fixture(), scalar_fixture()]


def write_fixture(*, fixture, root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=False)
    artifact = root / "model.onnx"
    onnx.save_model(fixture["model"], artifact, save_as_external_data=False)
    first = fixture["cases"][0]
    contract = {"format": FORMAT, "status": "onnx-runtime-parity-candidate", "local_only": True,
                "external_data": False, "custom_operators": [], "artifact": artifact.name,
                "artifact_sha256": digest(path=artifact), "inputs": schema(values=first["inputs"]),
                "outputs": schema(values=first["expected"]), "evidence_scope": SCOPE,
                "source": "authored arithmetic fixtures; no recovered assets or native outputs"}
    path = root / "contract.json"
    path.write_text(json.dumps(contract, indent=2) + "\n", encoding="utf-8")
    return path
