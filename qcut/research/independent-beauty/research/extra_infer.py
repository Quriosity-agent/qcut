"""Hash-bound private Extra model on the CPU; no vendor native library."""
import hashlib

import numpy as np

MODEL_SHA256='eb807d75672d09ce3566ebd6397ae3004d6a7ea5796584cc1352fd5a72a95956'


class ExtraHeads:
    def __init__(self, *, model):
        import onnxruntime as ort
        if ort.__version__!='1.22.1' or model.stat().st_size>32*1024**2:
            raise ValueError('bounded private Extra model and ORT 1.22.1 required')
        self.model=model
        data=model.read_bytes()
        if hashlib.sha256(data).hexdigest()!=MODEL_SHA256:
            raise ValueError('Extra model identity mismatch')
        options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1
        self.runner=ort.InferenceSession(data,sess_options=options,providers=['CPUExecutionProvider'])
        inputs,outputs=self.runner.get_inputs(),self.runner.get_outputs()
        if (len(inputs)!=1 or len(outputs)!=1 or inputs[0].name!='data' or inputs[0].type!='tensor(int64)'
                or inputs[0].shape!=[1,160,160,3] or outputs[0].name!='fc'
                or outputs[0].type!='tensor(float)' or outputs[0].shape!=[240,1,1,2]
                or self.runner.get_providers()!=['CPUExecutionProvider']):
            raise ValueError('locked CPU Extra model metadata required')

    def infer(self, *, tensor):
        if (not isinstance(tensor,np.ndarray) or tensor.dtype not in (np.int16,np.int64)
                or tensor.shape!=(1,160,160,3) or (tensor<-128).any() or (tensor>127).any()):
            raise ValueError('signed BGR NHWC160 Extra input required')
        if hashlib.sha256(self.model.read_bytes()).hexdigest()!=MODEL_SHA256:
            raise ValueError('Extra model changed during inference')
        result=self.runner.run(['fc'],{'data':tensor.astype(np.int64)})[0]
        if result.dtype!=np.float32 or result.shape!=(240,1,1,2) or not np.isfinite(result).all():
            raise ValueError('finite Extra240 raw head required')
        return result.reshape(240,2).copy()
