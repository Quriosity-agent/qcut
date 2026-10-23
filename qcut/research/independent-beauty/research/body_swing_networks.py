"""Per-detector readiness selection and replay of the owned inference history."""

import copy
import hashlib
from pathlib import Path

import numpy as np

from body_skeleton_decode import refine_tensor
from body_skeleton_preprocess import skeleton005_auto

NETWORKS = ('coarse', 'refine')
MAX_ROUTES = 250_000


def validate_routes(*, routes):
    if not isinstance(routes, list) or len(routes) > MAX_ROUTES:
        raise ValueError('bounded body execution routes required')
    active = set()
    for route in routes:
        if (not isinstance(route, dict) or set(route) != {'network', 'backend'}
                or route['network'] not in NETWORKS or route['backend'] not in ('cpu', 'coreml')):
            raise ValueError('body route requires its network and actual backend')
        if route['backend'] == 'coreml':
            active.add(route['network'])
        elif route['network'] in active:
            raise ValueError('native detector cannot return to CPU after activating CoreML')
    return copy.deepcopy(routes)


def coreml_coarse_size(*, width, height):
    if type(width) is not int or type(height) is not int or min(width, height) <= 0:
        raise ValueError('positive integer body dimensions required')
    ratio = np.float32(np.float32(min(width, height)) / np.float32(max(width, height)))
    short = 128 if ratio < np.float32(.68) else 176
    return (224, short) if height >= width else (short, 224)


def coreml_input(*, tensor):
    if tensor.dtype != np.int16 or tensor.ndim != 3 or tensor.shape[-1] != 3:
        raise ValueError('int16 HWC body crop required')
    if np.min(tensor) < -128 or np.max(tensor) > 127:
        raise ValueError('body crop must contain byte-minus-128 values')
    # Letterbox padding is byte 128 too; its normalized float value is positive.
    bgr = (tensor + 128).astype(np.uint8)
    return (bgr.astype(np.float64) * float(np.float32(4 / 255)) - 2).astype(np.float32)


def cpu_identity(*, provenance):
    identity = copy.deepcopy(provenance)
    inference = identity.get('inference', {})
    if inference.get('backend') == 'onnx-fp64-fixed-exact-opt-in':
        # Shape-specific compiled receipts describe the live LRU, not engine identity.
        inference.pop('models', None)
    return identity


class SwingBodyNetworks:
    def __init__(self, *, cpu, coreml):
        if set(coreml) != set(NETWORKS):
            raise ValueError('independent coarse and refine CoreML loaders required')
        self.cpu = cpu
        self.coreml = dict(coreml)
        self.routes = []
        self.replay = []
        self.active = {network: False for network in NETWORKS}
        self.restored_active = set()
        self.cancelled = None
        self.started = False
        self.provenance = {'cpu': cpu_identity(provenance=cpu.provenance),
                           'coreml': {name: copy.deepcopy(host.identity) for name, host in coreml.items()},
                           'routerSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}

    def reset_history(self):
        self.routes = []
        self.active = {network: False for network in NETWORKS}
        self.restored_active = set()

    def apply_replay(self, *, routes, replace_context=False):
        replay = validate_routes(routes=routes)
        if not replace_context and self.routes != replay[:len(self.routes)]:
            raise ValueError('body replay conflicts with already executed inference')
        self.replay = replay

    def validate_state(self, *, state):
        if not isinstance(state, dict) or set(state) != {'routes', 'active'}:
            raise ValueError('body network execution state is incomplete')
        routes = validate_routes(routes=state['routes'])
        if len(routes) > len(self.replay) or routes != self.replay[:len(routes)]:
            raise ValueError('body snapshot is not a prefix of its own execution journal')
        active = {name: any(row == {'network': name, 'backend': 'coreml'} for row in routes)
                  for name in NETWORKS}
        if (not isinstance(state['active'], dict) or state['active'] != active
                or any(type(value) is not bool for value in state['active'].values())):
            raise ValueError('body activation state disagrees with its routes')

    def capture_state(self):
        return {'routes': copy.deepcopy(self.routes), 'active': dict(self.active)}

    def restore_state(self, *, state):
        self.validate_state(state=state)
        self.routes = copy.deepcopy(state['routes'])
        self.active = dict(state['active'])
        self.restored_active = {name for name, active in self.active.items() if active}

    def _backend(self, *, network):
        index = len(self.routes)
        host = self.coreml[network]
        status = host.status
        if status['state'] == 'failed' and status.get('errorKind') != 'initialization':
            raise RuntimeError('body CoreML integrity or runtime failure; CPU substitution is forbidden')
        if status['state'] == 'closed':
            raise RuntimeError('body CoreML detector was closed')
        if index < len(self.replay):
            route = self.replay[index]
            if route['network'] != network:
                raise ValueError('body replay detector order diverged')
            if route['backend'] == 'coreml':
                host.wait_ready(timeout=60, cancelled=self.cancelled)
            return route['backend']
        if self.active[network]:
            if network in self.restored_active:
                host.wait_ready(timeout=60, cancelled=self.cancelled)
                self.restored_active.discard(network)
                return 'coreml'
            if status['state'] != 'ready':
                raise RuntimeError('activated body CoreML detector is no longer available')
            return 'coreml'
        # An initialization failure leaves the native listener unset and retains CPU.
        return 'coreml' if status['ready'] else 'cpu'

    def detect(self, *, network, rgb, box=None):
        if network not in NETWORKS or len(self.routes) >= MAX_ROUTES:
            raise ValueError('bounded body detector invocation required')
        if self.cancelled is not None and self.cancelled():
            raise RuntimeError('body inference cancelled')
        if not self.started:
            for host in self.coreml.values():
                host.start()
            self.started = True
        backend = self._backend(network=network)
        if backend == 'coreml':
            self.active[network] = True
        if network == 'coarse':
            if backend == 'coreml':
                height, width = coreml_coarse_size(width=int(rgb.shape[1]), height=int(rgb.shape[0]))
                tensor = refine_tensor(rgb, [0, 0, rgb.shape[1], rgb.shape[0]], out_h=height, out_w=width)
            else:
                tensor, _ = skeleton005_auto(rgb)
        else:
            tensor = refine_tensor(rgb, box)
        if backend == 'coreml':
            tensor = coreml_input(tensor=tensor)
            outputs = self.coreml[network].infer(tensor=tensor[None], cancelled=self.cancelled)
        else:
            outputs = self.cpu.infer(tensor=tensor[None], network=network)
        self.routes.append({'network': network, 'backend': backend})
        return tensor, outputs

    def close(self):
        for host in self.coreml.values():
            host.close()
