"""Owned NH algorithm image sampling in an isolated Metal process."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from algorithm_frame import validate_frame
from makeup_metal import build_host

SOURCE = Path(__file__).with_suffix('.swift')


def resize(*, frame, size, runtime):
    validate_frame(frame=frame, size=size)
    if max(frame.shape[:2]) > 1280 or not 16 <= min(size) <= max(size) <= 640:
        raise ValueError('bounded original photo and NH algorithm image required')
    host, environment, identity = build_host(runtime=runtime, source=SOURCE, prefix='flowgan-frame-metal')
    host_identity = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='flowgan-frame-') as temporary:
        directory = Path(temporary)
        frame.tofile(directory/'input.rgba')
        request = {'width': frame.shape[1], 'height': frame.shape[0],
            'targetWidth': size[0], 'targetHeight': size[1]}
        (directory/'request.json').write_text(json.dumps(request, allow_nan=False))
        subprocess.run([str(host), str(directory/'request.json')], env=environment,
            capture_output=True, text=True, check=True, timeout=30)
        output = directory/'output.rgba'
        if output.stat().st_size != size[0]*size[1]*4:
            raise ValueError('NH algorithm byte count mismatch')
        result = np.fromfile(output, np.uint8).reshape(size[1], size[0], 4)
        receipt = json.loads((directory/'output.rgba.json').read_text())
    if (receipt['private_native_images'] or hashlib.sha256(host.read_bytes()).hexdigest() != host_identity
            or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != identity):
        raise ValueError('independent NH image host integrity failed')
    return result, receipt | {'sourceSha256': identity, 'hostSha256': host_identity,
        'inputRgbaSha256': hashlib.sha256(frame.tobytes()).hexdigest(),
        'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest()}
