"""Identity-bound initialized iris mean; private capture stays under runtime/."""
import hashlib

import numpy as np

CONTENT_SHA256 = 'c14b52866bf50155a50d22f78b076837b9feb7149a60ab00bbbdf33549a00368'


def load_mean(*, path):
    if path.stat().st_size > 1024:
        raise ValueError('bounded private iris mean required')
    mean = np.load(path, allow_pickle=False)
    if (mean.dtype != np.float32 or mean.shape != (20, 2)
            or not np.isfinite(mean).all()
            or hashlib.sha256(mean.tobytes()).hexdigest() != CONTENT_SHA256):
        raise ValueError('initialized iris mean identity mismatch')
    mean.setflags(write=False)
    return mean


def extract(*, trace_path):
    import json
    from alignment_assets import LENS_SHA256
    trace = json.loads(trace_path.read_text())
    if (trace.get('passed') is not True or any(trace.get(key) is not False for key in
            ('software_breakpoints_used', 'target_memory_written', 'target_functions_evaluated'))
            or any(trace.get('checks', {}).get(key) is not True for key in
                ('observationPreservedPixels', 'sourceUnchanged', 'librariesUnchanged'))
            or trace.get('librarySha256', {}).get('liblens.dylib') != LENS_SHA256):
        raise ValueError('pinned read-only iris observation with pixel integrity required')
    records = trace.get('records', [])
    if len(records) != 4 or any(record.get('iris_order') != list(range(240, 260))
            or record.get('iris_size') != [48, 48] or record.get('canonical_width') != 160
            or record.get('iris_mean') != records[0].get('iris_mean') for record in records):
        raise ValueError('four invariant initialized iris means required')
    mean = np.asarray(records[0]['iris_mean'], np.float32).reshape(20, 2)
    if hashlib.sha256(mean.tobytes()).hexdigest() != CONTENT_SHA256:
        raise ValueError('captured iris mean identity mismatch')
    return mean


if __name__ == '__main__':
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trace', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    runtime = Path(__file__).resolve().parents[1]/'runtime'
    if args.output.exists() or args.output.suffix != '.npy' or not args.output.resolve().is_relative_to(runtime.resolve()):
        parser.error('fresh private .npy under runtime/ required')
    np.save(args.output, extract(trace_path=args.trace), allow_pickle=False)
