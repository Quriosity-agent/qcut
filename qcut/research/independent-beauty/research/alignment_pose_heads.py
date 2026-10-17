"""Float32 pose terminals from the shared alignment network's pooled features."""
from functools import lru_cache
import ctypes
import numpy as np
F = np.float32
POSE_HEADS = ('fc_yaw', 'fc_pitch')

@lru_cache(maxsize=1)
def fused_multiply_add():
    function = ctypes.CDLL(None).fmaf
    function.argtypes = [ctypes.c_float] * 3
    function.restype = ctypes.c_float
    return function

def pose_dot(*, features, weights, bias):
    if any((not isinstance(value, np.ndarray) or value.dtype != F or value.shape != (128,) or (not np.isfinite(value).all()) or (np.abs(value).max() > 32768) for value in (features, weights))):
        raise ValueError('bounded 128-element float32 pose vectors required')
    if not isinstance(bias, F) or not np.isfinite(bias) or abs(bias) > 32768:
        raise ValueError('bounded float32 pose bias required')
    accumulators = np.zeros(4, F)
    fma = fused_multiply_add()
    for index in range(128):
        lane = index % 4
        accumulators[lane] = fma(float(features[index]), float(weights[index]), float(accumulators[lane]))
    pairs = (F(accumulators[0] + accumulators[1]), F(accumulators[2] + accumulators[3]))
    return F(F(pairs[0] + pairs[1]) + bias)

def prepare_pose_heads(*, data):
    import onnx
    model = onnx.load_model_from_string(data)
    nodes = {name: node for node in model.graph.node for name in node.output}
    initializers = {value.name: value for value in model.graph.initializer}
    parameters, feature_names = ({}, set())
    for head in POSE_HEADS:
        reshape = nodes.get(head)
        add = nodes.get(reshape.input[0]) if reshape is not None and reshape.op_type == 'Reshape' and (len(reshape.input) == 2) else None
        multiply = nodes.get(add.input[0]) if add is not None and add.op_type == 'Add' and (len(add.input) == 2) else None
        if reshape is None or add is None or multiply is None or (multiply.op_type != 'MatMul') or (len(multiply.input) != 2) or (len(add.input) != 2) or (multiply.input[1] not in initializers) or (add.input[1] not in initializers):
            raise ValueError('pinned shared-feature pose terminal graph required')
        weights = onnx.numpy_helper.to_array(initializers[multiply.input[1]])
        bias = onnx.numpy_helper.to_array(initializers[add.input[1]])
        if weights.dtype != F or weights.shape != (128, 1) or bias.dtype != F or (bias.shape != (1,)) or (not np.isfinite(weights).all()) or (not np.isfinite(bias).all()) or (np.abs(weights).max() > 32768) or (abs(bias[0]) > 32768):
            raise ValueError('pinned finite float32 pose parameters required')
        weights = weights[:, 0].copy()
        weights.setflags(write=False)
        parameters[head] = (weights, F(bias[0]))
        feature_names.add(multiply.input[0])
    if len(feature_names) != 1:
        raise ValueError('pose heads must share one alignment feature vector')
    feature_name = next(iter(feature_names))
    if feature_name in {value.name for value in model.graph.output}:
        raise ValueError('pose features must be a private internal output')
    model.graph.output.append(onnx.helper.make_tensor_value_info(feature_name, onnx.TensorProto.FLOAT, [1, 128]))
    return (model.SerializeToString(), feature_name, parameters)

def compute_pose_heads(*, features, parameters):
    if not isinstance(features, np.ndarray) or features.dtype != F or features.shape != (1, 128) or (set(parameters) != set(POSE_HEADS)):
        raise ValueError('one shared alignment feature vector and both pose heads required')
    return {head: np.array([pose_dot(features=features[0], weights=parameters[head][0], bias=parameters[head][1])], F).reshape(1, 1, 1, 1) for head in POSE_HEADS}
