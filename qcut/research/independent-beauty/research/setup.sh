#!/bin/sh
# 建 research 链路的 Python 环境。版本与研究验证时的 face-heads-runtime122 一致（无 torch）。
set -eu
cd "$(dirname "$0")"
uv venv .venv --python 3.12 -q
uv pip install --python .venv/bin/python -q onnxruntime==1.22.1 onnx==1.19.0 numpy==2.5.3 pillow==12.2.0
# Keep the validated NumPy/ORT versions while installing the optical-flow wheel.
uv pip install --python .venv/bin/python --no-deps -q opencv-python-headless==4.12.0.88
.venv/bin/python -c "import onnxruntime, onnx, numpy, PIL, cv2; print('research env ok:', onnxruntime.__version__, onnx.__version__, numpy.__version__, PIL.__version__, cv2.__version__)"
