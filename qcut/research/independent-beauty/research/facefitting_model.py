"""Independent NumPy execution of the pinned 212-to-442 fitting network."""
import numpy as np

from facefitting_input import load_model_bytes


ARENA_OFFSET = 2426
ARENA_BYTES = 2_393_840
LAYER_SHAPES = ((212, 512), (512, 512), (512, 442))


def decode_layers(*, arena):
    if len(arena) != ARENA_BYTES:
        raise ValueError("unsupported fitting weight arena size")
    # The trailing four bytes are a container stamp, not a network parameter.
    values = np.frombuffer(arena[:-4], dtype="<f4")
    if not np.isfinite(values).all() or values[-1] != np.float32(256):
        raise ValueError("invalid fitting weights or output scale")
    layers, offset = [], 0
    for inputs, outputs in LAYER_SHAPES:
        count = inputs * outputs
        weights = values[offset:offset + count].reshape(outputs, inputs)
        offset += count
        biases = values[offset:offset + outputs]
        offset += outputs
        layers.append((weights, biases))
    if offset + 1 != values.size:
        raise ValueError("unexpected fitting parameter count")
    return tuple(layers)


def sigmoid(*, values):
    exponential = np.exp(-np.abs(values))
    denominator = np.float32(1) + exponential
    return np.where(values >= 0, np.float32(1) / denominator, exponential / denominator)


class FittingNetwork:
    def __init__(self, *, model):
        data = load_model_bytes(model=model)
        self.layers = decode_layers(arena=data[ARENA_OFFSET:ARENA_OFFSET + ARENA_BYTES])

    def infer(self, *, values):
        if not isinstance(values, np.ndarray) or values.dtype != np.float32:
            raise ValueError("expected a float32 NumPy input")
        if values.shape != (1, 212) or not np.isfinite(values).all():
            raise ValueError("expected 212 finite input floats with shape (1, 212)")
        hidden = values
        try:
            with np.errstate(over="raise", invalid="raise", under="ignore"):
                for index, (weights, biases) in enumerate(self.layers):
                    hidden = hidden @ weights.T + biases
                    if not np.isfinite(hidden).all():
                        raise ValueError("fitting activations exceeded float32 bounds")
                    if index < 2:
                        hidden = np.maximum(hidden, np.float32(0))
                output = sigmoid(values=hidden) * np.float32(256)
        except FloatingPointError as error:
            raise ValueError("fitting activations exceeded float32 bounds") from error
        if output.shape != (1, 442) or not np.isfinite(output).all():
            raise ValueError("invalid fitting network output")
        return output
