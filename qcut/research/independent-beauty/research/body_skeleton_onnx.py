"""Bounded opt-in CPU sessions compiled from the already pinned body arenas."""
from collections import OrderedDict
import hashlib

import numpy as np

from body_espresso_onnx import build_model

VERIFIED_ORT_VERSION = '1.22.1'
MAX_SESSIONS = 4
MAX_MODEL_BYTES = 64 * 1024 * 1024


class ExactOnnxNetworks:
    def __init__(self, *, networks, outputs):
        import onnxruntime as ort
        if ort.__version__ != VERIFIED_ORT_VERSION:
            raise ValueError(f'exact body ONNX requires verified onnxruntime {VERIFIED_ORT_VERSION}; use numpy for other versions')
        self.networks, self.outputs = networks, outputs
        self.sessions = OrderedDict()
        self.provenance = {'backend': 'onnx-fp64-fixed-exact-opt-in', 'onnxruntime': ort.__version__,
                           'provider': 'CPUExecutionProvider', 'optimization': 'disabled',
                           'models': [], 'maxSessions': MAX_SESSIONS,
                           'weights': 'original private vendor graph and arena; no replacement or independently trained model',
                           'runtimeReadsVendorInstallation': False, 'nativeRuntimeLoaded': False}

    def infer(self, *, tensor, network):
        import onnxruntime as ort
        key = (network, tuple(tensor.shape))
        if key not in self.sessions:
            text, arena = self.networks[network]
            model = build_model(text=text, arena=arena, shape=tuple(tensor.shape), outputs=self.outputs[network])
            data = model.SerializeToString()
            if len(data) > MAX_MODEL_BYTES:
                raise ValueError('fixed body ONNX model exceeds its byte budget')
            options = ort.SessionOptions()
            options.intra_op_num_threads = options.inter_op_num_threads = 1
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
            session = ort.InferenceSession(data, sess_options=options, providers=['CPUExecutionProvider'])
            if session.get_providers() != ['CPUExecutionProvider']:
                raise ValueError('fixed body ONNX must run on the CPU provider only')
            while len(self.sessions) >= MAX_SESSIONS:
                self.sessions.popitem(last=False)
            receipt = {'network': network, 'inputShape': list(tensor.shape), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
            self.sessions[key] = (session, receipt)
        self.sessions.move_to_end(key)
        self.provenance['models'] = [receipt for _, receipt in self.sessions.values()]
        session, _ = self.sessions[key]
        names = self.outputs[network]
        values = session.run(list(names), {'input': np.ascontiguousarray(tensor)})
        return dict(zip(names, values))
