"""Execution identities distinguish configurations without changing the warm default."""
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_execution_profile import execution_identity, execution_json, execution_request, SWING_PROFILE, WARM_PROFILE


class ExecutionProfileContract(unittest.TestCase):
    def test_omitted_and_explicit_warm_requests_are_identical(self):
        self.assertEqual(execution_request(), {'profile': WARM_PROFILE})
        self.assertEqual(execution_request(execution_profile=WARM_PROFILE), execution_request())

    def test_swing_requires_explicit_generation_and_unknown_profiles_fail(self):
        for generation in (None, '', 'a b', 'a\n', '\x00', 'é', 'x' * 129, 123, True):
            with self.subTest(generation=generation), self.assertRaises(ValueError):
                execution_request(execution_profile=SWING_PROFILE, execution_generation=generation)
        for profile in ('native', 'cpu', '', 1, {}, []):
            with self.subTest(profile=profile), self.assertRaises(ValueError):
                execution_request(execution_profile=profile)
        self.assertEqual(execution_request(execution_profile=SWING_PROFILE, execution_generation='process-123'),
                         {'profile': SWING_PROFILE, 'generation': 'process-123'})

    def test_warm_does_not_accept_a_hidden_generation(self):
        with self.assertRaisesRegex(ValueError, 'does not take a generation'):
            execution_request(execution_generation='another-history')

    def test_identity_is_a_detached_canonical_copy_of_all_backend_fields(self):
        metadata = {'profile': SWING_PROFILE, 'generation': 'one', 'backend': {'model': 'a', 'helper': 'b'},
                    'schedule': 'listener-latched-v1'}
        session = SimpleNamespace(execution_profile=SWING_PROFILE, execution_generation='one', execution_identity=metadata)
        identity = execution_identity(session=session)
        metadata['backend']['model'] = 'changed'
        self.assertEqual(identity['backend']['model'], 'a')
        self.assertNotEqual(execution_json(value=identity), execution_json(value=metadata))
        self.assertEqual(execution_json(value={'b': 2, 'a': 1}), execution_json(value={'a': 1, 'b': 2}))

    def test_identity_cannot_override_the_requested_profile_or_generation(self):
        for identity in ({}, {'profile': WARM_PROFILE, 'generation': 'one'},
                         {'profile': SWING_PROFILE, 'generation': 'other'}):
            session = SimpleNamespace(execution_profile=SWING_PROFILE, execution_generation='one', execution_identity=identity)
            with self.subTest(identity=identity), self.assertRaisesRegex(ValueError, 'does not match'):
                execution_identity(session=session)

    def test_metadata_rejects_handles_nonfinite_values_coerced_keys_and_excess_size(self):
        for value in (object(), float('nan'), float('inf'), {'nested': [float('-inf')]}, {1: 'key'},
                      ('tuple',), {'handle': lambda: None}, 'x' * (64 * 1024)):
            with self.subTest(kind=type(value).__name__), self.assertRaises(ValueError):
                execution_json(value=value)


if __name__ == '__main__':
    unittest.main()
