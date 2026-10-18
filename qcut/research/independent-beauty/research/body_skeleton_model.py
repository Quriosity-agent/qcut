"""The body-keypoint networks, read from the engine's private runtime asset.

`body-skeleton-v1.npz` (built locally from the installed smart-body model and never
committed) holds the graph text and weight arena of two fixed-point networks: `coarse`,
the full-frame multi-person net (18 joint heatmaps plus background, 38 limb vector
channels), and `refine`, the 192x144 single-person net. NumPy remains the reference
and default; QCUT_BODY_SKELETON_BACKEND=onnx-exact opts into bounded standard ONNX
sessions using the same verified graphs and arenas. No vendor installation is read.
"""
import hashlib
import json
import os
from pathlib import Path

import numpy as np

from body_espresso_fixed import run

ASSET = 'body-skeleton-v1.npz'
GRAPH_SHA256 = {
    'coarse': '20bbeb4158b0b3e2ba2ea9482761c1a99e99f859258b797807900ca8d33de40f',
    'refine': '9f13528b770202f78f36b0c3ff1471cc6cf5b3a6c69e9c7c1f1427d29aa3915a',
}
ARENA_SHA256 = {
    'coarse': 'fd860348e7b5de87d487756e0e38338ed48d72b48555a247f7d2a2e2e3270c32',
    'refine': 'a4fbff21cd05f6e46a68705d2314d3cb8f5c83aa931b358f85a3a032d4f4938e',
}
OUTPUTS = {'coarse': ('heatmap_output_0', 'vectormap_output_0'), 'refine': ('output_0',)}
_LOADED = {}
BACKEND_ENV = 'QCUT_BODY_SKELETON_BACKEND'


def selected_backend(*, backend=None):
    value = os.environ.get(BACKEND_ENV, 'numpy') if backend is None else backend
    if value not in ('numpy', 'onnx-exact'):
        raise ValueError('body skeleton backend must be numpy or onnx-exact')
    return value


class SkeletonNetworks:
    def __init__(self, *, path, backend=None):
        self.backend = selected_backend(backend=backend)
        path = Path(path)
        with np.load(path, allow_pickle=False) as data:
            arrays = {name: data[name] for name in data.files}
        if set(arrays) != {'provenance', 'coarse_graph', 'coarse_arena', 'refine_graph', 'refine_arena'}:
            raise ValueError('body skeleton asset has unexpected members')
        self.networks = {}
        for name in ('coarse', 'refine'):
            graph, arena = arrays[f'{name}_graph'].tobytes(), arrays[f'{name}_arena'].tobytes()
            if hashlib.sha256(graph).hexdigest() != GRAPH_SHA256[name] or hashlib.sha256(arena).hexdigest() != ARENA_SHA256[name]:
                raise ValueError(f'body skeleton {name} network differs from the verified weights')
            self.networks[name] = (graph.decode('ascii'), arena)
        self.provenance = {'asset': path.name, 'assetSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                           'graphs': dict(GRAPH_SHA256), 'arenas': dict(ARENA_SHA256),
                           'source': json.loads(arrays['provenance'].tobytes())}
        self.accelerator = None
        self.provenance['inference'] = {'backend': 'numpy-fixed-reference',
            'weights': 'original private vendor graph and arena; no replacement or independently trained model',
            'runtimeReadsVendorInstallation': False, 'nativeRuntimeLoaded': False}
        if self.backend == 'onnx-exact':
            from body_skeleton_onnx import ExactOnnxNetworks
            self.accelerator = ExactOnnxNetworks(networks=self.networks, outputs=OUTPUTS)
            self.provenance['inference'] = self.accelerator.provenance

    def infer(self, *, tensor, network='coarse'):
        """int16 NHWC (n=1) input whose integers mean value/64; returns the int16 outputs."""
        x = np.asarray(tensor)
        if x.dtype != np.int16 or x.ndim != 4 or x.shape[0] != 1 or x.shape[-1] != 3:
            raise ValueError('int16 NHWC input with one image required')
        if network not in OUTPUTS:
            raise ValueError('unknown body skeleton network')
        if self.accelerator is not None:
            return self.accelerator.infer(tensor=x, network=network)
        text, arena = self.networks[network]
        # The graph input carries six fraction bits; the tensor's integers are passed unchanged.
        blobs = run(text, arena, {'data': (x.astype(np.int64), [2, 6])})
        return {name: blobs[name]['data'].astype(np.int16) for name in OUTPUTS[network]}


def load_networks(*, runtime, backend=None):
    """Networks from `<runtime>/research/body-skeleton-v1.npz`, cached per file state."""
    path = Path(runtime) / 'research' / ASSET
    if not path.is_file():
        raise ValueError('body skeleton asset is not installed in the private runtime')
    stat = path.stat()
    backend = selected_backend(backend=backend)
    key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns, backend)
    if key not in _LOADED:
        _LOADED.clear()
        _LOADED[key] = SkeletonNetworks(path=path, backend=backend)
    return _LOADED[key]
