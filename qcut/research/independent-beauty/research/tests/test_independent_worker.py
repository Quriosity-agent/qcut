"""JSONL recovery, pixel identity, and explicit resident dispatch boundaries."""
from contextlib import redirect_stderr
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import independent_pipeline as pipeline
from independent_sequence_sessions import SequenceGap
import independent_stage_runner as stages
import independent_worker as worker


RUNTIME = Path(__file__).resolve().parents[2] / 'runtime'
VIDEO_ASSETS = ('body-skeleton-v1.npz', 'body-face-video-policy-v1.json', 'face-detector-dynamic.onnx',
                'face-align-120.onnx', 'face-align-160.onnx', 'alignment-assets-v1.npz')
HAS_VIDEO_RUNTIME = all((RUNTIME / 'research' / name).is_file() for name in VIDEO_ASSETS)
FRAMES = Path(os.environ.get('QCUT_BODY_VIDEO_FRAMES', '/nonexistent'))


class FakeSessions:
    """The session table's worker-facing surface: prepare, a stage runner and a snapshot."""

    def __init__(self, *, runtime, gap_at=None):
        self.runtime, self.gap_at, self.prepared = runtime, gap_at, []
        self.engine = SimpleNamespace(next_frame=0)

    def prepare(self, *, session, frame, checkpoints):
        self.prepared.append((session, frame, checkpoints))
        if frame == self.gap_at:
            raise SequenceGap(restart_from=frame - 2)
        self.engine.next_frame = frame
        return 'restarted' if frame == 0 else 'continued'

    def stage_runner(self, *, sequence, resumed, fallback):
        def run(**arguments):
            run.rendered = True
            self.engine.next_frame = sequence['frame'] + 1

        run.rendered = False
        return run

    def snapshot(self):
        return {'active': True}


class WorkerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='resident-worker-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.image = self.root / 'input.png'
        Image.fromarray(np.full((8, 6, 4), 255, np.uint8)).save(self.image)
        self.request = {'id': 'one', 'image': str(self.image), 'request': str(self.root / 'request.json'),
                        'output': str(self.root / 'output.png'), 'report': str(self.root / 'report.json')}

    def serve(self, *, rows, render, sessions=None):
        output = io.StringIO()
        with patch.dict(os.environ), redirect_stderr(io.StringIO()):
            worker.serve(runtime=self.root,
                         input_stream=io.BytesIO(b''.join(json.dumps(row).encode() + b'\n' for row in rows)),
                         output_stream=output, render=render,
                         **({} if sessions is None else {'sessions': sessions}))
        return [json.loads(line) for line in output.getvalue().splitlines()]

    def test_failure_then_success_and_no_stage_stdout_on_protocol(self):
        calls = []

        def render(**arguments):
            print('legacy renderer diagnostic')
            calls.append(arguments['runtime_receipt']())
            if len(calls) == 1:
                raise ValueError('invalid frame')

        responses = self.serve(rows=[self.request, self.request | {'id': 'two'}], render=render)
        self.assertFalse(responses[0]['ok'])
        self.assertEqual(responses[1], {'id': 'two', 'ok': True})
        self.assertEqual([call['completedJobsBefore'] for call in calls], [0, 0])
        self.assertEqual(calls[0]['pid'], calls[1]['pid'])

    def test_runtime_binding_and_clean_environment_preserve_path(self):
        observed = []
        with patch.dict(os.environ, {'DYLD_INSERT_LIBRARIES': '/private/libx', 'PYTHONPATH': '/private/python'}):
            expected_path = os.environ.get('PATH')
            self.serve(rows=[self.request], render=lambda **kwargs: observed.append(dict(os.environ)))
        self.assertEqual(observed[0].get('PATH'), expected_path)
        self.assertEqual(observed[0]['BEAUTY_RESEARCH_MODELS'], str(self.root.resolve() / 'research'))
        self.assertNotIn('DYLD_INSERT_LIBRARIES', observed[0])
        self.assertNotIn('PYTHONPATH', observed[0])

    def test_bad_request_does_not_execute_and_next_request_recovers(self):
        render = Mock()
        responses = self.serve(rows=[self.request | {'image': '../input.png'}, self.request], render=render)
        self.assertEqual([item['ok'] for item in responses], [False, True])
        render.assert_called_once()

    def test_oversize_line_terminates_without_parsing_trailing_fragments(self):
        render = Mock()
        output = io.StringIO()
        with patch.dict(os.environ):
            worker.serve(runtime=self.root, input_stream=io.BytesIO(b'x' * (worker.MAX_REQUEST_BYTES + 2)),
                         output_stream=output, render=render)
        render.assert_not_called()
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertFalse(json.loads(output.getvalue())['ok'])

    def test_high_definition_automatically_selects_original_resolution(self):
        Image.new('RGB', (1080, 1920)).save(self.image)
        render = Mock()
        self.serve(rows=[self.request, self.request | {'resolution': 'preview'}], render=render)
        self.assertEqual([call.kwargs['resolution'] for call in render.call_args_list], ['original', 'preview'])

    def test_source_evidence_is_optional_bounded_and_does_not_leak_after_failure(self):
        path = self.root / 'source-evidence.json'
        render = Mock(side_effect=[InterruptedError('cancelled'), None])
        responses = self.serve(rows=[self.request | {'source_evidence': str(path)}, self.request], render=render)
        self.assertEqual([row['ok'] for row in responses], [False, True])
        self.assertEqual(render.call_args_list[0].kwargs['source_evidence'], path)
        self.assertNotIn('source_evidence', render.call_args_list[1].kwargs)
        for value in (None, '../source-evidence.json', '/tmp/' + 'x' * 8192):
            with self.assertRaises(ValueError):
                worker.validate_request(request=self.request | {'source_evidence': value})

    def test_dispatch_source_evidence_only_to_portrait_stage(self):
        path = self.root / 'source-evidence.json'
        for script in ('portrait_features_render.py', 'whiten_render.py'):
            module = Mock(__file__=str(self.root / script))
            arguments = {'stage': {'script': script, 'parameters': []}, 'source': self.root / script,
                         'image': self.image, 'runtime': self.root, 'output': self.root / 'out.png',
                         'report': self.root / 'out.json'}
            with patch.object(stages.importlib, 'import_module', return_value=module):
                if script == 'portrait_features_render.py':
                    stages.run_stage(**arguments, source_evidence=path)
                    stages.run_stage(**arguments)
                    self.assertEqual(module.run.call_args_list[0].kwargs['source_evidence'], path)
                    self.assertNotIn('source_evidence', module.run.call_args_list[1].kwargs)
                else:
                    with self.assertRaisesRegex(ValueError, 'source evidence contract'):
                        stages.run_stage(**arguments, source_evidence=path)
                    module.run.assert_not_called()

    def test_catalog_renderers_have_explicit_resident_contracts(self):
        catalog = pipeline.read_json(path=pipeline.ROOT / 'research/independent-pipeline-catalog.json')
        self.assertEqual(pipeline.allowed_scripts(catalog=catalog),
                         set(stages.IMAGE_PARAMETERS) | set(stages.RGBA_PARAMETERS))

    def test_dispatch_rejects_transport_overrides_and_unknown_renderers(self):
        for script, parameters in [('whiten_render.py', ['--runtime', '/wrong']),
                                   ('unknown_render.py', []),
                                   ('whiten_render.py', ['--strength']),
                                   ('whiten_render.py', ['--strength', '0.1', '--strength', '0.5'])]:
            with self.subTest(script=script, parameters=parameters), self.assertRaises(ValueError):
                stages.stage_parameters(script=script, parameters=parameters)

    def test_dispatch_forwards_only_explicit_lip_identity_and_does_not_retain_it(self):
        module = Mock(__file__=str(self.root / 'lip_render.py'))
        reference = object()
        arguments = {'stage': {'script': 'lip_render.py', 'parameters': ['--strength', '0.35', '--texture-state', 'Auto']},
                     'source': self.root / 'lip_render.py', 'image': self.image, 'runtime': self.root,
                     'output': self.root / 'out.png', 'report': self.root / 'out.json'}
        with patch.object(stages.importlib, 'import_module', return_value=module):
            stages.run_stage(**arguments, face_reference=reference)
            stages.run_stage(**arguments)
        self.assertIs(module.run.call_args_list[0].kwargs['face_reference'], reference)
        self.assertNotIn('face_reference', module.run.call_args_list[1].kwargs)
        np.testing.assert_array_equal(module.run.call_args_list[0].kwargs['rgba'], np.array(Image.open(self.image)))

    def test_dispatch_rejects_reference_for_renderers_without_an_identity_contract(self):
        module = Mock(__file__=str(self.root / 'whiten_render.py'))
        with patch.object(stages.importlib, 'import_module', return_value=module), self.assertRaisesRegex(ValueError, 'identity contract'):
            stages.run_stage(stage={'script': 'whiten_render.py', 'parameters': ['--strength', '0.2']},
                             source=self.root / 'whiten_render.py', image=self.image, runtime=self.root,
                             output=self.root / 'out.png', report=self.root / 'out.json', face_reference=object())
        module.run.assert_not_called()

    def sequence_request(self, *, frame, identifier='seq'):
        return self.request | {'id': identifier, 'sequence': {'session': 'c' * 64, 'frame': frame,
                                                              'timestamp': frame / 24, 'checkpoints': str(self.root / 'ck')}}

    @staticmethod
    def render_body_stage(**arguments):
        """A pipeline whose plan has the smart-body stage; photo requests keep the photo runner."""
        if arguments['stage_runner'] is not stages.run_stage:
            arguments['stage_runner'](stage={'script': 'body_smart_render.py', 'parameters': []})
        arguments['runtime_receipt']()

    def test_sequence_requests_render_through_the_session_and_report_the_next_frame(self):
        table = FakeSessions(runtime=self.root)
        responses = self.serve(rows=[self.sequence_request(frame=0), self.sequence_request(frame=1, identifier='two'),
                                     self.request], render=self.render_body_stage, sessions=lambda **_: table)
        self.assertEqual(responses[0], {'id': 'seq', 'ok': True, 'sequence': {'nextFrame': 1, 'resumed': 'restarted'}})
        self.assertEqual(responses[1], {'id': 'two', 'ok': True, 'sequence': {'nextFrame': 2, 'resumed': 'continued'}})
        self.assertEqual(responses[2], {'id': 'one', 'ok': True})
        self.assertEqual([frame for _, frame, _ in table.prepared], [0, 1])
        self.assertEqual(table.prepared[0][2], str(self.root / 'ck'))

    def test_a_history_gap_is_a_recoverable_reply_not_a_failure(self):
        table = FakeSessions(runtime=self.root, gap_at=7)
        render = Mock(side_effect=self.render_body_stage)
        responses = self.serve(rows=[self.sequence_request(frame=7), self.sequence_request(frame=5, identifier='two')],
                               render=render, sessions=lambda **_: table)
        self.assertEqual(responses[0], {'id': 'seq', 'ok': False, 'error': 'SequenceGap: body video history resumes at frame 5',
                                        'gap': {'restartFrom': 5}})
        self.assertEqual(responses[1], {'id': 'two', 'ok': True, 'sequence': {'nextFrame': 6, 'resumed': 'continued'}})
        self.assertEqual(render.call_count, 1)

    def test_a_sequence_request_whose_plan_has_no_body_stage_fails(self):
        table = FakeSessions(runtime=self.root)
        responses = self.serve(rows=[self.sequence_request(frame=0)], render=Mock(), sessions=lambda **_: table)
        self.assertFalse(responses[0]['ok'])
        self.assertIn('smart-body stage', responses[0]['error'])
        self.assertNotIn('gap', responses[0])

    def test_photo_requests_keep_the_photo_stage_runner(self):
        render = Mock()
        self.serve(rows=[self.request], render=render, sessions=lambda **_: FakeSessions(runtime=self.root))
        self.assertIs(render.call_args.kwargs['stage_runner'], stages.run_stage)

    def test_sequence_requests_are_validated_before_execution(self):
        for sequence in ({'session': 'C' * 64, 'frame': 0, 'timestamp': 0, 'checkpoints': str(self.root)},
                         {'session': 'c' * 64, 'frame': 0, 'timestamp': 0}, 'frames'):
            with self.subTest(sequence=sequence), self.assertRaises(ValueError):
                worker.validate_request(request=self.request | {'sequence': sequence})

    def test_explicit_execution_profile_and_generation_reach_prepare_unchanged(self):
        table = FakeSessions(runtime=self.root)
        original = table.prepare

        def prepare(**arguments):
            self.assertEqual(arguments.pop('execution_profile'), 'swing-coreml-v1')
            self.assertEqual(arguments.pop('execution_generation'), 'owned-generation')
            return original(**arguments)

        table.prepare = Mock(side_effect=prepare)
        request = self.sequence_request(frame=0)
        request['sequence'].update(executionProfile='swing-coreml-v1', executionGeneration='owned-generation')
        responses = self.serve(rows=[request], render=self.render_body_stage, sessions=lambda **_: table)
        self.assertTrue(responses[0]['ok'])
        table.prepare.assert_called_once()

    def test_execution_checkpoint_error_is_not_a_replay_gap(self):
        from body_execution_profile import BodyExecutionCheckpointError

        table = FakeSessions(runtime=self.root)
        table.prepare = Mock(side_effect=BodyExecutionCheckpointError('recorded readiness cannot be replayed'))
        render = Mock()
        responses = self.serve(rows=[self.sequence_request(frame=3)], render=render, sessions=lambda **_: table)
        self.assertFalse(responses[0]['ok'])
        self.assertIn('BodyExecutionCheckpointError', responses[0]['error'])
        self.assertNotIn('gap', responses[0])
        render.assert_not_called()

    def test_worker_eof_closes_session_helpers_after_success_or_render_failure(self):
        for failure in (None, RuntimeError('failed frame')):
            table = FakeSessions(runtime=self.root)
            table.close = Mock()
            with self.subTest(failure=failure):
                self.serve(rows=[self.request], render=Mock(side_effect=failure), sessions=lambda **_: table)
                table.close.assert_called_once()

    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('bun') and HAS_VIDEO_RUNTIME
                         and len(list(FRAMES.glob('frame-*.png'))) >= 8,
                         'real body video needs macOS/Bun, the private runtime and QCUT_BODY_VIDEO_FRAMES (8+ frames)')
    def test_real_worker_resumes_a_body_session_from_its_disk_checkpoint(self):
        frames = sorted(FRAMES.glob('frame-*.png'))
        request = self.root / 'body.json'
        request.write_text(json.dumps({'values': {'SlimBody': 40, 'StretchLeg': 30}, 'makeup': {}}))
        session, checkpoints = 'f' * 64, self.root / 'checkpoints'

        def job(frame, identifier):
            # The clip loops past its last frame; the session only needs ordered frames.
            return {'id': identifier, 'image': str(frames[frame % len(frames)]), 'request': str(request),
                    'output': str(self.root / f'{identifier}.png'), 'report': str(self.root / f'{identifier}.json'),
                    'sequence': {'session': session, 'frame': frame, 'timestamp': frame / 24,
                                 'checkpoints': str(checkpoints)}}

        def serve(jobs):
            process = subprocess.run([sys.executable, '-B', str(pipeline.ROOT / 'research/independent_worker.py'),
                                      '--runtime', str(RUNTIME)], input=''.join(json.dumps(row) + '\n' for row in jobs),
                                     capture_output=True, text=True, check=True, timeout=300,
                                     env={**os.environ, 'PATH': '/opt/homebrew/bin:' + os.environ.get('PATH', '')})
            return [json.loads(line) for line in process.stdout.splitlines()]

        first = serve([job(frame, f'a{frame}') for frame in range(14)])
        self.assertTrue(all(reply['ok'] for reply in first), first)
        self.assertEqual(sorted(path.name for path in checkpoints.iterdir()), ['0000000012.snapshot'])
        # A new process holds no history: frame 13 resumes from the checkpoint, not from the clip's start.
        second = serve([job(13, 'gap'), job(12, 'b12'), job(13, 'b13')])
        self.assertEqual(second[0], {'id': 'gap', 'ok': False, 'error': 'SequenceGap: body video history resumes at frame 12',
                                     'gap': {'restartFrom': 12}})
        self.assertEqual([reply.get('sequence') for reply in second[1:]],
                         [{'nextFrame': 13, 'resumed': 'restored'}, {'nextFrame': 14, 'resumed': 'continued'}])
        for frame in (12, 13):
            self.assertEqual((self.root / f'b{frame}.png').read_bytes(), (self.root / f'a{frame}.png').read_bytes())

    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('bun'), 'real planner requires macOS/Bun')
    def test_real_worker_two_jobs_match_one_shot_pixels_and_recover_after_invalid_plan(self):
        request = Path(self.request['request'])
        request.write_text(json.dumps({'values': {'TotalFace': 0}, 'makeup': {}}))
        baseline_output, baseline_report = self.root / 'baseline.png', self.root / 'baseline.json'
        subprocess.run([sys.executable, str(pipeline.ROOT / 'research/independent_pipeline.py'),
                        '--image', str(self.image), '--request', str(request), '--runtime', str(self.root),
                        '--output', str(baseline_output), '--report', str(baseline_report)],
                       capture_output=True, check=True, timeout=30)
        bad_request = self.root / 'bad.json'
        bad_request.write_text('{"values":{"not-a-control":100},"makeup":{}}')
        jobs = [self.request, self.request | {'id': 'bad', 'request': str(bad_request),
                'output': str(self.root / 'bad.png'), 'report': str(self.root / 'bad-report.json')},
                self.request | {'id': 'two', 'output': str(self.root / 'two.png'), 'report': str(self.root / 'two.json')}]
        process = subprocess.run([sys.executable, '-B', str(pipeline.ROOT / 'research/independent_worker.py'),
                                  '--runtime', str(self.root)],
                                 input=''.join(json.dumps(job) + '\n' for job in jobs),
                                 capture_output=True, text=True, check=True, timeout=30)
        responses = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual([response['ok'] for response in responses], [True, False, True])
        for job in (jobs[0], jobs[2]):
            self.assertEqual(Path(job['output']).read_bytes(), baseline_output.read_bytes())
        reports = [json.loads(Path(job['report']).read_text()) for job in (jobs[0], jobs[2])]
        self.assertEqual(reports[0]['residentRuntime']['pid'], reports[1]['residentRuntime']['pid'])
        self.assertEqual([receipt['residentRuntime']['completedJobsBefore'] for receipt in reports], [0, 1])
        self.assertFalse((self.root / 'bad.png').exists())
        self.assertFalse((self.root / 'bad-report.json').exists())


if __name__ == '__main__':
    unittest.main()
