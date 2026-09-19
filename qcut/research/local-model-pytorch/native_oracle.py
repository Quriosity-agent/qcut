"""Exchange bounded tensor files with the CPU-only CoreML reference executable."""
import json
import pathlib
import subprocess

import numpy as np


def predict_native(*, oracle, native_model, inputs, directory):
    directory.mkdir(parents=True, exist_ok=True)
    request = {}
    for index, (name, value) in enumerate(inputs.items()):
        path = directory / f"input-{index}.f32"
        array = value.detach().cpu().numpy() if hasattr(value, "detach") else value
        np.asarray(array, dtype="<f4").tofile(path)
        request[name] = {"path": str(path.resolve()), "shape": list(array.shape)}
    request_path = directory / "request.json"
    request_path.write_text(json.dumps(request))
    subprocess.run([str(oracle), str(native_model), str(request_path), str(directory)],
                   check=True, capture_output=True, text=True, timeout=120)
    outputs = json.loads((directory / "outputs.json").read_text())
    result = {}
    for name, info in outputs.items():
        path = pathlib.Path(info["path"])
        if not path.resolve().is_relative_to(directory.resolve()):
            raise ValueError("native output path escapes case directory")
        result[name] = np.fromfile(path, dtype="<f4").reshape(info["shape"])
    return result


def align_batch_axis(*, actual, expected):
    if expected.ndim == actual.ndim - 1 and actual.shape[0] == 1:
        return expected[None]
    return expected
