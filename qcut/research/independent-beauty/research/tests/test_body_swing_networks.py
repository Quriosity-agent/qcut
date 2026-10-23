"""Readiness is observed per detector, and saved decisions remain authoritative."""

from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_swing_networks import SwingBodyNetworks, coreml_input, cpu_identity, validate_routes


class FakeCoreML:
    def __init__(self):
        self.state = 'starting'
        self.identity = {'model': 'test'}
        self.waits = 0
        self.inputs = []
        self.fail_infer = False
        self.error_kind = 'initialization'
        self.starts = 0

    @property
    def status(self):
        return {'state': self.state, 'ready': self.state == 'ready', 'errorKind': self.error_kind}

    def start(self):
        self.starts += 1
        return self.status

    def wait_ready(self, *, timeout, cancelled=None):
        self.waits += 1
        if self.state in ('failed', 'closed'):
            raise RuntimeError('test model unavailable')
        self.state = 'ready'

    def infer(self, *, tensor, cancelled=None):
        if self.fail_infer:
            self.state = 'failed'
            raise RuntimeError('test prediction failure')
        self.inputs.append(tensor.copy())
        return {'output_0': np.zeros((1, 24, 18, 34), np.float32)}

    def close(self):
        self.state = 'closed'


class SwingNetworkTests(unittest.TestCase):
    def setUp(self):
        self.cpu = Mock()
        self.cpu.provenance = {'model': 'cpu-test'}
        self.cpu.infer.return_value = {'output_0': np.zeros((1, 24, 18, 34), np.int16)}
        self.hosts = {name: FakeCoreML() for name in ('coarse', 'refine')}
        self.networks = SwingBodyNetworks(cpu=self.cpu, coreml=self.hosts)
        self.rgb = np.full((224, 128, 3), 128, np.uint8)
        self.box = [0, 0, 128, 224]

    def detect_refine(self):
        return self.networks.detect(network='refine', rgb=self.rgb, box=self.box)

    def test_each_detector_polls_its_own_completion_before_preprocessing(self):
        self.cpu.infer.side_effect = lambda **_: self._complete_refine()
        self.networks.detect(network='coarse', rgb=self.rgb)
        self.detect_refine()
        self.assertEqual(self.networks.routes, [{'network': 'coarse', 'backend': 'cpu'},
                                               {'network': 'refine', 'backend': 'coreml'}])
        self.assertEqual(len(self.hosts['refine'].inputs), 1)

    def test_loaders_start_lazily_once_in_first_graph_processing(self):
        self.assertTrue(all(host.starts == 0 for host in self.hosts.values()))
        self.detect_refine()
        self.detect_refine()
        self.networks.reset_history()
        self.detect_refine()
        self.assertTrue(all(host.starts == 1 for host in self.hosts.values()))

    def test_lazy_onnx_cache_receipts_cannot_change_restart_identity(self):
        provenance = {'graphs': {'coarse': 'verified'}, 'inference': {
            'backend': 'onnx-fp64-fixed-exact-opt-in', 'provider': 'CPUExecutionProvider',
            'onnxruntime': '1.22.1', 'models': []}}
        before = cpu_identity(provenance=provenance)
        provenance['inference']['models'].append({'network': 'coarse', 'sha256': 'compiled'})
        self.assertEqual(cpu_identity(provenance=provenance), before)
        self.assertEqual(len(provenance['inference']['models']), 1)
        provenance['graphs']['coarse'] = 'changed'
        self.assertNotEqual(cpu_identity(provenance=provenance), before)

    def _complete_refine(self):
        self.hosts['refine'].state = 'ready'
        return {}

    def test_initialization_failure_preserves_cpu_but_prediction_failure_does_not(self):
        self.hosts['refine'].state = 'failed'
        self.detect_refine()
        self.assertEqual(self.networks.routes[-1]['backend'], 'cpu')
        self.hosts['refine'].state = 'ready'
        self.hosts['refine'].fail_infer = True
        with self.assertRaisesRegex(RuntimeError, 'prediction'):
            self.detect_refine()
        self.assertTrue(self.networks.active['refine'])
        with self.assertRaisesRegex(RuntimeError, 'no longer available'):
            self.detect_refine()
        self.assertEqual(self.cpu.infer.call_count, 1)

    def test_recorded_cpu_choice_is_preserved_even_if_loader_is_already_ready(self):
        self.hosts['refine'].state = 'ready'
        self.networks.apply_replay(routes=[{'network': 'refine', 'backend': 'cpu'}])
        self.detect_refine()
        self.assertFalse(self.networks.active['refine'])
        self.assertEqual(self.cpu.infer.call_count, 1)
        self.detect_refine()
        self.assertEqual(self.networks.routes[-1]['backend'], 'coreml')

    def test_invalid_assets_and_failed_runtime_never_select_cpu(self):
        self.hosts['refine'].state = 'failed'
        for kind in ('integrity', 'runtime', None):
            self.hosts['refine'].error_kind = kind
            with self.subTest(kind=kind), self.assertRaisesRegex(RuntimeError, 'substitution is forbidden'):
                self.detect_refine()
        self.cpu.infer.assert_not_called()
        self.assertEqual(self.networks.routes, [])

    def test_recorded_coreml_waits_instead_of_reverting_to_cpu(self):
        self.networks.apply_replay(routes=[{'network': 'refine', 'backend': 'coreml'}])
        self.detect_refine()
        self.assertEqual(self.hosts['refine'].waits, 1)
        self.cpu.infer.assert_not_called()

    def test_restore_requires_owned_prefix_and_rehydrates_activated_backend(self):
        route = {'network': 'refine', 'backend': 'coreml'}
        state = {'routes': [route], 'active': {'coarse': False, 'refine': True}}
        with self.assertRaisesRegex(ValueError, 'own execution journal'):
            self.networks.restore_state(state=state)
        self.networks.apply_replay(routes=[route])
        self.networks.restore_state(state=state)
        self.detect_refine()
        self.assertEqual(self.hosts['refine'].waits, 1)
        self.assertEqual(self.networks.routes, [route, route])

    def test_conflicting_or_nonmonotonic_history_is_rejected(self):
        self.networks.apply_replay(routes=[{'network': 'coarse', 'backend': 'cpu'}])
        with self.assertRaisesRegex(ValueError, 'order diverged'):
            self.detect_refine()
        self.assertEqual(self.networks.routes, [])
        with self.assertRaisesRegex(ValueError, 'return to CPU'):
            validate_routes(routes=[{'network': 'refine', 'backend': 'coreml'},
                                    {'network': 'refine', 'backend': 'cpu'}])

    def test_context_handoff_preserves_executed_state_until_new_checkpoint_validates(self):
        self.detect_refine()
        old_state = self.networks.capture_state()
        new_route = {'network': 'refine', 'backend': 'coreml'}
        new_state = {'routes': [new_route], 'active': {'coarse': False, 'refine': True}}
        for conflicting in ([], [new_route]):
            with self.subTest(routes=conflicting), self.assertRaisesRegex(ValueError, 'conflicts'):
                self.networks.apply_replay(routes=conflicting)
        self.networks.apply_replay(routes=[new_route], replace_context=True)
        self.assertEqual(self.networks.capture_state(), old_state)
        with self.assertRaisesRegex(ValueError, 'own execution journal'):
            self.networks.validate_state(state=old_state)
        self.assertEqual(self.networks.capture_state(), old_state)
        self.networks.validate_state(state=new_state)
        self.networks.restore_state(state=new_state)
        self.detect_refine()
        self.assertEqual(self.hosts['refine'].waits, 1)
        self.assertEqual(self.networks.routes, [new_route, new_route])

    def test_float_padding_and_values_keep_native_fused_rounding(self):
        crop = np.array([[[-128, 0, 127]]], np.int16)
        expected = np.array([[[-2., .007843255996704102, 2.000000238418579]]], np.float32)
        np.testing.assert_array_equal(coreml_input(tensor=crop), expected)

    def test_ready_coarse_uses_fixed_coreml_shape(self):
        self.hosts['coarse'].state = 'ready'
        tensor, _ = self.networks.detect(network='coarse', rgb=np.zeros((224, 150, 3), np.uint8))
        self.assertEqual(tensor.shape, (224, 128, 3))
        self.assertEqual(tensor.dtype, np.float32)

    def test_ready_coarse_preserves_native_asymmetric_endpoints(self):
        self.hosts['coarse'].state = 'ready'
        for width, height, box in ((640, 512, (1, 0, 222, 176)),
                                    (512, 640, (0, 1, 176, 222)),
                                    (435, 640, (0, 17, 128, 206))):
            with self.subTest(width=width, height=height):
                tensor, _ = self.networks.detect(network='coarse', rgb=np.zeros((height, width, 3), np.uint8))
                ys, xs = np.where(np.all(tensor == -2, axis=-1))
                self.assertEqual((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1), box)

    def test_close_releases_both_owned_hosts(self):
        self.networks.close()
        self.assertTrue(all(host.state == 'closed' for host in self.hosts.values()))
        with self.assertRaisesRegex(RuntimeError, 'closed'):
            self.detect_refine()


if __name__ == '__main__':
    unittest.main()
