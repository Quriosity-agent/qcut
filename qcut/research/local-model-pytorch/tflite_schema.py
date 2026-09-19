"""Read the observed float TFLite subset; TensorFlow is export-only."""

from hashlib import sha256
import math
from pathlib import Path

import numpy as np
import torch

from tflite_metadata import segmentation_metadata


OPTIONS = {
    "CONV_2D": (
        "Conv2DOptions",
        (
            "Padding",
            "StrideH",
            "StrideW",
            "DilationHFactor",
            "DilationWFactor",
            "FusedActivationFunction",
            "QuantizedBiasType",
        ),
    ),
    "DEPTHWISE_CONV_2D": (
        "DepthwiseConv2DOptions",
        (
            "Padding",
            "StrideH",
            "StrideW",
            "DilationHFactor",
            "DilationWFactor",
            "DepthMultiplier",
            "FusedActivationFunction",
        ),
    ),
    "TRANSPOSE_CONV": (
        "TransposeConvOptions",
        (
            "Padding",
            "StrideH",
            "StrideW",
            "FusedActivationFunction",
            "QuantizedBiasType",
        ),
    ),
    "ADD": ("AddOptions", ("FusedActivationFunction", "PotScaleInt16")),
    "MUL": ("MulOptions", ("FusedActivationFunction",)),
    "SOFTMAX": ("SoftmaxOptions", ("Beta",)),
    "SUM": ("ReducerOptions", ("KeepDims",)),
    "RESIZE_BILINEAR": ("ResizeBilinearOptions", ("AlignCorners", "HalfPixelCenters")),
    "RESIZE_NEAREST_NEIGHBOR": (
        "ResizeNearestNeighborOptions",
        ("AlignCorners", "HalfPixelCenters"),
    ),
    "RESHAPE": (None, ()),
    "TRANSPOSE": (None, ()),
}
VERSIONS = {name: {1} for name in OPTIONS}
VERSIONS.update(
    {
        name: {3}
        for name in ("TRANSPOSE_CONV", "RESIZE_BILINEAR", "RESIZE_NEAREST_NEIGHBOR")
    }
)
DTYPES = {0: np.dtype("<f4"), 2: np.dtype("<i4")}


def read_model(*, path: Path) -> dict:
    from tensorflow.lite.python import schema_py_generated as schema

    raw = path.read_bytes()
    if len(raw) < 8 or raw[4:8] != b"TFL3" or len(raw) > 128 * 1024 * 1024:
        raise ValueError("Expected bounded TFL3 FlatBuffer")
    try:
        model = schema.Model.GetRootAsModel(raw, 0)
        if model.Version() != 3 or model.SubgraphsLength() != 1:
            raise ValueError("Only schema 3, single-subgraph models are supported")
        graph = model.Subgraphs(0)
        if not 0 < graph.TensorsLength() <= 4096 or graph.OperatorsLength() > 2048:
            raise ValueError("Graph exceeds supported bounds")
        tensors, constants = [], {}
        for index in range(graph.TensorsLength()):
            tensor = graph.Tensors(index)
            shape = [int(item) for item in tensor.ShapeAsNumpy()]
            count = math.prod(shape)
            quant = tensor.Quantization()
            if tensor.Type() not in DTYPES or tensor.IsVariable() or tensor.Sparsity():
                raise ValueError(f"Unsupported tensor representation: {index}")
            if quant and (
                quant.ScaleLength() or quant.ZeroPointLength() or quant.DetailsType()
            ):
                raise ValueError(
                    "Quantized tensors require a separate verified backend"
                )
            signature = tensor.ShapeSignatureAsNumpy()
            if tensor.ShapeSignatureLength() and list(signature) != shape:
                raise ValueError("Dynamic tensors are not supported")
            if (
                len(shape) > 6
                or any(dim <= 0 for dim in shape)
                or not 0 < count <= 32_000_000
            ):
                raise ValueError(f"Invalid tensor shape: {index}")
            if tensor.Buffer() >= model.BuffersLength():
                raise ValueError("Buffer index out of bounds")
            buffer = model.Buffers(tensor.Buffer())
            if buffer.Offset() or buffer.Size():
                raise ValueError("External buffer storage is unsupported")
            if buffer.DataLength():
                dtype = DTYPES[tensor.Type()]
                if buffer.DataLength() != count * dtype.itemsize:
                    raise ValueError(f"Constant byte size mismatch: {index}")
                array = (
                    np.frombuffer(buffer.DataAsNumpy().tobytes(), dtype=dtype)
                    .copy()
                    .reshape(shape)
                )
                if not np.isfinite(array).all():
                    raise ValueError(f"Non-finite constant: {index}")
                constants[str(index)] = torch.from_numpy(array)
            tensors.append(
                {"shape": shape, "dtype": "float32" if tensor.Type() == 0 else "int32"}
            )
        names = {
            value: key
            for key, value in vars(schema.BuiltinOperator).items()
            if isinstance(value, int)
        }
        operators = []
        for index in range(graph.OperatorsLength()):
            operator = graph.Operators(index)
            if operator.OpcodeIndex() >= model.OperatorCodesLength():
                raise ValueError("Opcode index out of bounds")
            code = model.OperatorCodes(operator.OpcodeIndex())
            name = names.get(max(code.BuiltinCode(), code.DeprecatedBuiltinCode()))
            if (
                name not in OPTIONS
                or code.Version() not in VERSIONS[name]
                or operator.CustomOptionsLength()
            ):
                raise ValueError(
                    f"Unsupported operator/version at {index}: {name}/{code.Version()}"
                )
            option_class, fields = OPTIONS[name]
            options = {}
            if option_class:
                if operator.BuiltinOptionsType() != getattr(
                    schema.BuiltinOptions, option_class
                ):
                    raise ValueError(f"Mismatched option table: {index}")
                table = operator.BuiltinOptions()
                values = getattr(schema, option_class)()
                values.Init(table.Bytes, table.Pos)
                options = {field: getattr(values, field)() for field in fields}
            elif operator.BuiltinOptionsType() != schema.BuiltinOptions.NONE:
                raise ValueError("Only tensor-driven reshape/transpose are supported")
            operators.append(
                {
                    "type": name,
                    "version": code.Version(),
                    "inputs": [int(i) for i in operator.InputsAsNumpy()],
                    "outputs": [int(i) for i in operator.OutputsAsNumpy()],
                    "options": options,
                }
            )
        return {
            "format": "qcut-bounded-tflite-pytorch",
            "version": 1,
            "source_sha256": sha256(raw).hexdigest(),
            "source_bytes": len(raw),
            "tensors": tensors,
            "operators": operators,
            "inputs": [int(i) for i in graph.InputsAsNumpy()],
            "outputs": [int(i) for i in graph.OutputsAsNumpy()],
            "metadata": segmentation_metadata(model=model),
            "constants": constants,
        }
    except (IndexError, TypeError, OverflowError) as error:
        raise ValueError("Malformed TFLite FlatBuffer") from error
