"""Alignment classifier terminals using the native CPU float32 operation order."""
import ctypes
from functools import lru_cache

import numpy as np

from alignment_pose_heads import pose_dot

F = np.float32


@lru_cache(maxsize=1)
def scalar_exp():
    function = ctypes.CDLL(None).expf
    function.argtypes = [ctypes.c_float]
    function.restype = ctypes.c_float
    return function


def classification_probabilities(*, features, parameters):
    weights, bias = parameters
    if (not isinstance(features, np.ndarray) or features.dtype != F or features.shape != (1, 128)
            or not isinstance(weights, np.ndarray) or weights.dtype != F or weights.ndim != 2
            or weights.shape[0] != 128 or weights.shape[1] not in (3, 5)
            or not isinstance(bias, np.ndarray) or bias.dtype != F or bias.shape != (weights.shape[1],)
            or not np.isfinite(bias).all()):
        raise ValueError('shared 128-feature classification head with three or five classes required')
    logits = np.array([pose_dot(features=features[0], weights=weights[:, index], bias=bias[index])
                       for index in range(len(bias))], F)
    shifted = F(logits - np.max(logits))
    exponent = scalar_exp()
    values = np.array([exponent(float(value)) for value in shifted], F)
    total = F(0)
    for value in values:
        total = F(total + value)
    return F(values / total).reshape(1, 1, 1, len(bias))


def prepare_probability_head(*, data):
    import onnx
    model = onnx.load_model_from_string(data)
    nodes = {name: node for node in model.graph.node for name in node.output}
    initializers = {value.name: value for value in model.graph.initializer}

    def predecessor(*, name, operation, inputs):
        node = nodes.get(name)
        if node is None or node.op_type != operation or len(node.input) != inputs:
            raise ValueError('pinned float32 alignment classifier graph required')
        return node

    divide = predecessor(name='prob', operation='Div', inputs=2)
    exponent = predecessor(name=divide.input[0], operation='Exp', inputs=1)
    subtract = predecessor(name=exponent.input[0], operation='Sub', inputs=2)
    maximum = predecessor(name=subtract.input[1], operation='ReduceMax', inputs=2)
    total = predecessor(name=divide.input[1], operation='ReduceSum', inputs=2)
    if maximum.input[0] != subtract.input[0] or total.input[0] != exponent.output[0]:
        raise ValueError('classifier max-shift and sum must use the same logits')
    reshape = predecessor(name=subtract.input[0], operation='Reshape', inputs=2)
    add = predecessor(name=reshape.input[0], operation='Add', inputs=2)
    multiply = predecessor(name=add.input[0], operation='MatMul', inputs=2)
    if multiply.input[1] not in initializers or add.input[1] not in initializers:
        raise ValueError('classifier parameters must be model initializers')
    weights = onnx.numpy_helper.to_array(initializers[multiply.input[1]])
    bias = onnx.numpy_helper.to_array(initializers[add.input[1]])
    if (weights.dtype != F or weights.ndim != 2 or weights.shape[0] != 128
            or weights.shape[1] not in (3, 5) or bias.dtype != F or bias.shape != (weights.shape[1],)
            or not np.isfinite(weights).all() or not np.isfinite(bias).all()
            or np.abs(weights).max() > 32768 or np.abs(bias).max() > 32768):
        raise ValueError('bounded float32 alignment classifier parameters required')
    weights, bias = weights.copy(), bias.copy()
    weights.setflags(write=False)
    bias.setflags(write=False)
    feature_name = multiply.input[0]
    if feature_name not in {value.name for value in model.graph.output}:
        model.graph.output.append(onnx.helper.make_tensor_value_info(feature_name, onnx.TensorProto.FLOAT, [1, 128]))
    return model.SerializeToString(), feature_name, (weights, bias)
