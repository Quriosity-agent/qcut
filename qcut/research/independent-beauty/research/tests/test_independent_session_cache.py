"""Session reuse must preserve options, bounded memory, and failure behavior."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import independent_session_cache as sessions


class SessionCacheTests(unittest.TestCase):
    def test_opt_in_content_identity_and_optimizer_identity(self):
        cache = sessions.SessionCache()
        with patch.object(sessions, '_create', side_effect=lambda **kwargs: object()) as create:
            first = sessions.cpu_session(data=b'weights')
            self.assertIsNot(first, sessions.cpu_session(data=b'weights'))
            with sessions.reuse_sessions(cache=cache):
                first = sessions.cpu_session(data=b'weights')
                self.assertIs(first, sessions.cpu_session(data=b'weights'))
                self.assertIsNot(first, sessions.cpu_session(data=b'changed weights'))
                self.assertIsNot(first, sessions.cpu_session(data=b'weights', optimize=True))
            self.assertIsNot(first, sessions.cpu_session(data=b'weights'))
        self.assertEqual(create.call_count, 6)
        self.assertEqual(cache.snapshot()['hits'], 1)
        self.assertIsNone(sessions.ACTIVE_CACHE.get())

    def test_lru_evicts_by_count_and_model_bytes(self):
        cache = sessions.SessionCache(max_entries=2, max_bytes=6)
        with patch.object(sessions, '_create', side_effect=lambda **kwargs: object()):
            with sessions.reuse_sessions(cache=cache):
                first = sessions.cpu_session(data=b'aa')
                second = sessions.cpu_session(data=b'bb')
                self.assertIs(first, sessions.cpu_session(data=b'aa'))
                sessions.cpu_session(data=b'ccc')
                self.assertEqual(cache.snapshot()['modelBytes'], 5)
                self.assertIsNot(second, sessions.cpu_session(data=b'bb'))
                sessions.cpu_session(data=b'1234567')
        self.assertEqual(cache.snapshot()['entries'], 2)
        self.assertLessEqual(cache.snapshot()['modelBytes'], 6)

    def test_failed_creation_is_not_cached_and_context_restores_after_error(self):
        cache = sessions.SessionCache()
        expected = object()
        with patch.object(sessions, '_create', side_effect=[ValueError('invalid graph'), expected]) as create:
            with self.assertRaises(ValueError), sessions.reuse_sessions(cache=cache):
                sessions.cpu_session(data=b'weights')
            self.assertIsNone(sessions.ACTIVE_CACHE.get())
            with sessions.reuse_sessions(cache=cache):
                self.assertIs(expected, sessions.cpu_session(data=b'weights'))
                self.assertIs(expected, sessions.cpu_session(data=b'weights'))
        self.assertEqual(create.call_count, 2)

    def test_factory_keeps_original_cpu_options(self):
        import onnxruntime as ort
        with patch.object(ort, 'InferenceSession') as create:
            sessions.cpu_session(data=b'model', optimize=False)
            options = create.call_args.kwargs['sess_options']
            self.assertEqual(options.intra_op_num_threads, 1)
            self.assertEqual(options.inter_op_num_threads, 1)
            self.assertEqual(options.graph_optimization_level, ort.GraphOptimizationLevel.ORT_DISABLE_ALL)
            self.assertEqual(create.call_args.kwargs['providers'], ['CPUExecutionProvider'])
            sessions.cpu_session(data=b'model', optimize=True)
            self.assertEqual(create.call_args.kwargs['sess_options'].graph_optimization_level,
                             ort.SessionOptions().graph_optimization_level)

    def test_budget_and_input_types_are_bounded(self):
        for arguments in ({'max_entries': 0}, {'max_entries': True}, {'max_entries': 33}, {'max_bytes': 0}):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                sessions.SessionCache(**arguments)
        for arguments in ({'data': b''}, {'data': 'weights'}, {'data': b'weights', 'optimize': 1}):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                sessions.cpu_session(**arguments)


if __name__ == '__main__':
    unittest.main()
