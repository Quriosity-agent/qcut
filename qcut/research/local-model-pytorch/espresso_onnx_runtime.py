"""Offline CPU sessions for private model parity probes, without Torch imports."""
import onnxruntime

# Opt out of private-probe telemetry; this alone does not fix the 1.30 SDK teardown.
onnxruntime.disable_telemetry_events()


def session(*, path):
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    return onnxruntime.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
