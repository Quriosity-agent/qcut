import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_coreml_capability as capability


class CapabilityTests(unittest.TestCase):
    def setUp(self):
        self.execution = MagicMock()
        self.execution.identity = {'profile': 'swing-coreml-v1', 'generation': 'capability-inspection',
            'networks': {'coreml': {name: {'sources': {'body_coreml_host.mm': 'a' * 64}}
                                   for name in ('coarse', 'refine')}}}
        self.patches = [patch.object(capability.platform, 'system', return_value='Darwin'),
                       patch.object(capability, 'SwingExecution', return_value=self.execution),
                       patch.object(capability, 'prepare_host', return_value={
                           'sourceSha256': 'a' * 64, 'binarySha256': 'b' * 64}),
                       patch.object(capability.subprocess, 'run', return_value=MagicMock(stdout='Mac15,7\n'))]
        self.system, self.constructor, self.prepare, self.run = [item.start() for item in self.patches]
        for item in self.patches:
            self.addCleanup(item.stop)

    def test_validates_without_starting_inference_and_excludes_generation(self):
        original = copy.deepcopy(self.execution.identity)
        result = capability.inspect_capability(runtime=Path('/external/runtime'))
        self.assertNotIn('generation', result['identity']['execution'])
        self.assertEqual(result['identity']['hardwareModel'], 'Mac15,7')
        self.assertEqual(result['identity']['helper']['binarySha256'], 'b' * 64)
        self.assertEqual(original, self.execution.identity)
        self.execution.create_skeleton.assert_not_called()
        self.execution.networks.detect.assert_not_called()
        self.execution.close.assert_called_once()

    def test_changed_helper_source_is_rejected_and_closed(self):
        self.prepare.return_value['sourceSha256'] = 'c' * 64
        with self.assertRaisesRegex(ValueError, 'source changed'):
            capability.inspect_capability(runtime=Path('/external/runtime'))
        self.execution.close.assert_called_once()
        self.run.assert_not_called()

    def test_build_failure_is_not_reported_as_available(self):
        self.prepare.side_effect = RuntimeError('compiler missing')
        with self.assertRaisesRegex(RuntimeError, 'compiler missing'):
            capability.inspect_capability(runtime=Path('/external/runtime'))
        self.execution.close.assert_called_once()

    def test_other_hosts_never_open_models(self):
        self.system.return_value = 'Linux'
        with self.assertRaisesRegex(RuntimeError, 'macOS'):
            capability.inspect_capability(runtime=Path('/external/runtime'))
        self.constructor.assert_not_called()

    def test_model_integrity_failure_surfaces(self):
        self.constructor.side_effect = ValueError('compiled payload mismatch')
        with self.assertRaisesRegex(ValueError, 'payload mismatch'):
            capability.inspect_capability(runtime=Path('/external/runtime'))
        self.prepare.assert_not_called()

    def test_hardware_identity_is_required(self):
        self.run.return_value.stdout = ''
        with self.assertRaisesRegex(ValueError, 'hardware identity'):
            capability.inspect_capability(runtime=Path('/external/runtime'))
        self.execution.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
