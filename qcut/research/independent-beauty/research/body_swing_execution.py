"""Private resources and immutable identity for an explicit Swing execution."""

import copy
import os
from pathlib import Path
import tempfile

from body_control_events import resolve_control_events
from body_coreml_process import BodyCoreMLNetwork
from body_execution_sources import execution_sources
from body_skeleton_model import load_networks
from body_swing_networks import SwingBodyNetworks
from body_swing_skeleton import SwingBodySkeleton

MODEL_ROOT_ENV = 'QCUT_BODY_COREML_MODEL_ROOT'


class SwingExecution:
    def __init__(self, *, runtime, generation):
        root = os.environ.get(MODEL_ROOT_ENV)
        if not root:
            raise ValueError(f'{MODEL_ROOT_ENV} must select external pinned coarse/refine models')
        sources = execution_sources()
        cache = Path(tempfile.gettempdir()) / f'qcut-body-coreml-{os.getuid()}'
        models = {network: BodyCoreMLNetwork(network=network,
                  model_directory=Path(root) / (network + '.mlmodelc'), cache_directory=cache)
                  for network in ('coarse', 'refine')}
        try:
            self.networks = SwingBodyNetworks(cpu=load_networks(runtime=runtime), coreml=models)
        except BaseException:
            for model in models.values():
                model.close()
            raise
        self.identity = {'profile': 'swing-coreml-v1', 'generation': generation,
                         'networks': copy.deepcopy(self.networks.provenance),
                          'sources': sources,
                         'schedule': 'per-detector-readiness-own-route-journal-v1'}
        self.previous_controls = {}

    def create_skeleton(self):
        return SwingBodySkeleton(networks=self.networks)

    def reset(self):
        self.previous_controls = {}
        self.networks.reset_history()

    def capture(self):
        return {**self.networks.capture_state(), 'previousControls': dict(self.previous_controls)}

    def validate(self, *, state):
        if not isinstance(state, dict) or set(state) != {'routes', 'active', 'previousControls'}:
            raise ValueError('complete Swing execution state required')
        self.networks.validate_state(state={key: state[key] for key in ('routes', 'active')})
        resolve_control_events(controls=state['previousControls'])

    def restore(self, *, state):
        self.validate(state=state)
        self.networks.restore_state(state={key: state[key] for key in ('routes', 'active')})
        self.previous_controls = dict(state['previousControls'])

    def apply_replay(self, *, routes, replace_context=False):
        self.networks.apply_replay(routes=routes, replace_context=replace_context)

    def close(self):
        self.networks.close()
