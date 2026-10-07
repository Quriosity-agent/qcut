"""Hash-bound private integer iris48 model with float32 20-point output."""
import hashlib

import numpy as np

MODEL_SHA256 = '665d7d9beb664594ced038cc68d04f03b7687aa58aa782715176724d62a80b3c'


class IrisHeads:
    def __init__(self, *, model):
        import onnxruntime as ort
        if ort.__version__ != '1.22.1' or model.stat().st_size > 32*1024**2:
            raise ValueError('bounded iris model and locked ORT 1.22.1 required')
        self.model = model
        data = model.read_bytes()
        if hashlib.sha256(data).hexdigest() != MODEL_SHA256:
            raise ValueError('private iris model identity mismatch')
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        self.runner = ort.InferenceSession(data, sess_options=options, providers=['CPUExecutionProvider'])
        inputs, outputs = self.runner.get_inputs(), self.runner.get_outputs()
        if (len(inputs) != 1 or len(outputs) != 1 or inputs[0].name != 'data'
                or inputs[0].type != 'tensor(int64)' or inputs[0].shape != [1, 48, 48, 3]
                or outputs[0].name != 'pred_landmark' or outputs[0].type != 'tensor(float)'
                or outputs[0].shape != [1, 1, 1, 40] or self.runner.get_providers() != ['CPUExecutionProvider']):
            raise ValueError('locked CPU iris48 metadata required')

    def infer(self, *, bgr):
        if not isinstance(bgr, np.ndarray) or bgr.dtype != np.uint8 or bgr.shape != (48, 48, 3):
            raise ValueError('48 by 48 byte BGR iris input required')
        if hashlib.sha256(self.model.read_bytes()).hexdigest() != MODEL_SHA256:
            raise ValueError('iris model changed during inference')
        tensor = bgr.astype(np.int64)-128
        result = self.runner.run(['pred_landmark'], {'data': tensor[None]})[0]
        if result.dtype != np.float32 or result.shape != (1, 1, 1, 40) or not np.isfinite(result).all():
            raise ValueError('finite iris20 head required')
        return result.reshape(20, 2).copy()
