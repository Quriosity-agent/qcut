"""Pipeline boundary and real subprocess chain tests without private models."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import independent_pipeline as pipeline
import render_resolution


FAKE_RENDERER = '''import argparse, hashlib, json, os, sys
from pathlib import Path
import numpy as np
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--image', type=Path, required=True)
parser.add_argument('--runtime', type=Path)
parser.add_argument('--assets')
parser.add_argument('--shape-assets')
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--report', type=Path, required=True)
parser.add_argument('--face-reference', type=Path)
parser.add_argument('--source-evidence', type=Path)
parser.add_argument('--delta', type=int, default=1)
parser.add_argument('--mode', default='good')
arguments = parser.parse_args()
rgba = np.array(Image.open(arguments.image).convert('RGBA'))
result = rgba.copy()
result[0, 0, 0] += arguments.delta
hash_rgba = lambda value: hashlib.sha256(value.tobytes()).hexdigest()
receipt = dict(inputRgbaSha256=hash_rgba(rgba), outputRgbaSha256=hash_rgba(result),
    scope='original-photo-independent-face-and-features-one-mesh', predictionCount=1,
    alignment=dict(points=np.column_stack((np.linspace(1,3,106),np.linspace(1,2,106))).tolist(),
                   prob=[.1], seed_prob=[.1], acceptance_policy='research-seed-and-120-prob0<=0.5'),
    fixedLandmarks=False, nativeGeometryUsed=False, nativeInputsUsed=False,
    independence=dict(private_native_images=[], loaded_images=[sys.executable]),
    gpu=dict(images=['/System/Library/Frameworks/Metal.framework/Metal'], private_native_images=[]),
    runtime=None if arguments.runtime is None else str(arguments.runtime),
    models=os.environ.get('BEAUTY_RESEARCH_MODELS'), assets=arguments.assets,
    shapeAssets=arguments.shape_assets,
    dyld=[name for name in os.environ if name.startswith('DYLD_')])
if arguments.source_evidence:
    receipt['sourceEvidencePath'] = str(arguments.source_evidence)
if arguments.face_reference:
    receipt['faceReference'] = json.loads(arguments.face_reference.read_text())
    assert receipt['faceReference']['inputRgbaSha256'] == hash_rgba(rgba)
mode = arguments.mode
if mode == 'no-effect':
    result = rgba.copy()
    receipt.update(outputRgbaSha256=hash_rgba(result), predictionCount=0, meshPassCount=0, changedPixelCount=0,
                   alignment=None, zeroControlsIdentity=True, decodedSize=[rgba.shape[1],rgba.shape[0]])
if mode == 'input-hash': receipt['inputRgbaSha256'] = '0' * 64
if mode == 'output-hash': receipt['outputRgbaSha256'] = '0' * 64
if mode == 'cpu-private': receipt['independence']['private_native_images'] = ['/private/libcccreator.dylib']
if mode == 'gpu-private': receipt['gpu']['images'].append('/private/libAGFX.dylib')
if mode == 'gpu-private-list': receipt['gpu']['private_native_images'] = ['/private/libbytenn.dylib']
if mode == 'fixed': receipt['fixedLandmarks'] = True
if mode == 'native': receipt['nativeInputsUsed'] = True
if mode == 'missing-cpu': receipt.pop('independence')
if mode == 'resize': result = result[:-1]
if mode == 'alpha': result[0, 0, 3] = 254
if mode == 'snake':
    receipt['input_rgba_sha256'] = receipt.pop('inputRgbaSha256')
    receipt['output_rgba_sha256'] = receipt.pop('outputRgbaSha256')
Image.fromarray(result).save(arguments.output)
arguments.report.write_text(json.dumps(receipt))
if mode == 'exit': raise SystemExit(9)
if mode == 'evidence-change': arguments.source_evidence.write_text(arguments.source_evidence.read_text() + ' ')
if mode == 'source-change': Path(__file__).write_text(Path(__file__).read_text() + '\\n')
'''


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pipeline-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'research').mkdir()
        (self.root / 'src').mkdir()
        self.runtime = self.root / 'different-runtime'
        self.runtime.mkdir()
        self.image, self.output, self.report = (self.root / name for name in ('input.png', 'output.png', 'report.json'))
        self.plan_path = self.root / 'plan.json'
        self.rgba = np.arange(4 * 5 * 4, dtype=np.uint8).reshape(4, 5, 4)
        self.rgba[..., 3] = 255
        Image.fromarray(self.rgba).save(self.image)
        self.catalog = {'version': 1, 'stages': [{'script': 'first_render.py'}, {'script': 'second_render.py'},
                        {'script': 'slimface_mesh_render.py'}], 'makeup': []}
        (self.root / 'research/independent-pipeline-catalog.json').write_text(json.dumps(self.catalog))
        (self.root / 'src/independent-pipeline-plan.ts').write_text('// pure planner fixture\n')
        (self.root / 'research/render_resolution.py').write_bytes(Path(render_resolution.__file__).read_bytes())
        for name in ('first_render.py', 'second_render.py', 'slimface_mesh_render.py'):
            (self.root / 'research' / name).write_text(FAKE_RENDERER)
        self.canonical = {'version': 1, 'adjustments': {'values': {}, 'makeup': {}}, 'stages': []}
        self.addCleanup(patch.stopall)
        patch.object(pipeline, 'ROOT', self.root).start()
        patch.object(pipeline, 'process_inventory', return_value={'loaded_images': [sys.executable], 'private_native_images': []}).start()
        self.planner = patch.object(pipeline, 'canonical_plan', side_effect=self._planner).start()

    def _planner(self, **arguments):
        return copy.deepcopy(self.canonical), ['bun', str(self.root / 'src/independent-pipeline-plan.ts')]

    def add_stage(self, *, mode='good', script='first_render.py', delta=1):
        index = len(self.canonical['stages'])
        self.canonical['stages'].append({'id': f'stage-{index}', 'script': script, 'kind': 'scalar',
            'controls': {'test': delta}, 'parameters': ['--delta', str(delta), '--mode', mode]})

    def execute(self, *, supplied=None, request=False, source_evidence=None):
        self.plan_path.write_text(json.dumps(self.canonical if supplied is None else supplied))
        return pipeline.run(image=self.image, runtime=self.runtime, output=self.output, report=self.report,
                            source_evidence=source_evidence, **{('request' if request else 'plan'): self.plan_path})

    def assert_clean_failure(self, *, supplied=None):
        with self.assertRaises((ValueError, subprocess.CalledProcessError)):
            self.execute(supplied=supplied)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.report.exists())
        self.assertEqual(list(self.root.glob('independent-pipeline-*')), [])

    def test_zero_is_rgba_identity_without_renderer(self):
        with patch.object(pipeline, 'renderer_arguments', side_effect=AssertionError('zero must not execute a stage')):
            receipt = self.execute()
        np.testing.assert_array_equal(pipeline.read_rgba(path=self.output), self.rgba)
        self.assertTrue(receipt['zeroParametersIdentity'])
        self.assertFalse(receipt['nativeProductParityVerified'])
        self.assertEqual(receipt['plan'], self.canonical)
        self.assertEqual(receipt['outputPngSha256'], pipeline.sha256(data=self.output.read_bytes()))
        self.assertEqual(list(self.root.glob('independent-pipeline-*')), [])

    def test_request_is_forwarded_to_canonical_planner(self):
        requested = {'values': {'face_adjust_TotalFace': 0}, 'makeup': {}}
        receipt = self.execute(supplied=requested, request=True)
        self.assertEqual(self.planner.call_args.kwargs['request'], requested)
        self.assertEqual(receipt['plan'], self.canonical)

    def test_two_real_subprocesses_chain_current_png_and_receipts(self):
        self.add_stage(delta=2)
        self.add_stage(script='second_render.py', mode='snake', delta=3)
        receipt = self.execute()
        expected = self.rgba.copy()
        expected[0, 0, 0] += 5
        np.testing.assert_array_equal(pipeline.read_rgba(path=self.output), expected)
        first, second = receipt['stages']
        self.assertEqual(first['outputRgbaSha256'], second['inputRgbaSha256'])
        self.assertEqual(first['outputPngSha256'], second['inputPngSha256'])
        self.assertEqual(second['outputRgbaSha256'], receipt['outputRgbaSha256'])
        for stage in receipt['stages']:
            self.assertEqual(stage['receipt']['runtime'], str(self.runtime))
            self.assertEqual(stage['receipt']['models'], str(self.runtime / 'research'))
            self.assertTrue(stage['recomputedGeometryAfterPriorStage'])
            self.assertEqual(len(stage['loadedImageInventories']), 2)
            self.assertFalse(Path(stage['command'][stage['command'].index('--image') + 1]).exists())

    def test_face_shape_binds_custom_runtime_models_and_both_assets(self):
        self.add_stage(script='slimface_mesh_render.py')
        receipt = self.execute()['stages'][0]['receipt']
        self.assertIsNone(receipt['runtime'])
        self.assertEqual(receipt['models'], str(self.runtime / 'research'))
        self.assertEqual(receipt['assets'], str(self.runtime / 'research/slimface-mesh-v1.npz'))
        self.assertEqual(receipt['shapeAssets'], str(self.runtime / 'research/face-shape-v1.npz'))

    def test_dyld_and_python_injection_environment_removed(self):
        with patch.dict(os.environ, {'DYLD_INSERT_LIBRARIES': '/private/libcccreator.dylib',
                                     'DYLD_FRAMEWORK_PATH': '/private', 'PYTHONPATH': '/output/code', 'PYTHONHOME': '/wrong'}):
            environment = pipeline.clean_environment(runtime=self.runtime)
            self.assertNotIn('PYTHONPATH', environment)
            self.assertNotIn('PYTHONHOME', environment)
            self.add_stage()
            receipt = self.execute()
        self.assertEqual(receipt['stages'][0]['receipt']['dyld'], [])

    def test_plan_parameter_and_control_tampering_rejected_before_child(self):
        self.add_stage()
        for field, value in (('parameters', ['--delta', '99']), ('controls', {'test': True}), ('kind', 'native')):
            with self.subTest(field=field):
                supplied = copy.deepcopy(self.canonical)
                supplied['stages'][0][field] = value
                self.assert_clean_failure(supplied=supplied)

    def test_script_traversal_and_unlisted_script_rejected(self):
        self.add_stage()
        for script in ('../src/beauty.ts', 'beauty.py', '/tmp/first_render.py'):
            with self.subTest(script=script):
                supplied = copy.deepcopy(self.canonical)
                supplied['stages'][0]['script'] = script
                self.assert_clean_failure(supplied=supplied)

    def test_transport_and_fixed_point_flags_rejected_even_in_plan(self):
        self.add_stage()
        for parameter in ('--image', '--output=/tmp/result.png', '--report', '--points', '--runtime', '--assets', '--face-reference', '--source-evidence'):
            with self.subTest(parameter=parameter):
                supplied = copy.deepcopy(self.canonical)
                supplied['stages'][0]['parameters'].append(parameter)
                self.assert_clean_failure(supplied=supplied)

    def add_identity_renderers(self):
        for script in ('portrait_features_render.py', 'lip_render.py'):
            (self.root / 'research' / script).write_text(FAKE_RENDERER)
            self.catalog['stages'].append({'script': script})
        (self.root / 'research/independent-pipeline-catalog.json').write_text(json.dumps(self.catalog))

    def source_sidecar(self):
        path = self.root / 'source-evidence.json'
        path.write_text(json.dumps({'schemaVersion': 1, 'policy': 'single-face-bidirectional-v1',
            'status': 'unavailable', 'reason': 'no neighboring decoded frames', 'width': 5, 'height': 4,
            'targetRgbaSha256': pipeline.sha256(data=self.rgba.tobytes())}))
        return path

    def test_source_manifest_is_bound_to_report_and_only_original_portrait_stage(self):
        self.add_identity_renderers()
        for scripts in ([], ['portrait_features_render.py', 'lip_render.py'],
                        ['first_render.py', 'portrait_features_render.py', 'lip_render.py']):
            self.canonical['stages'] = []
            self.output.unlink(missing_ok=True)
            self.report.unlink(missing_ok=True)
            for script in scripts:
                self.add_stage(script=script)
            path = self.source_sidecar()
            receipt = self.execute(source_evidence=path)
            self.assertEqual(receipt['sourceEvidence'], {'manifestSha256': pipeline.sha256(data=path.read_bytes()),
                'policy': 'single-face-bidirectional-v1', 'status': 'unavailable'})
            forwarded = [row['receipt'].get('sourceEvidencePath') for row in receipt['stages']]
            self.assertEqual(forwarded, [str(path) if index == 0 and script == 'portrait_features_render.py' else None
                                        for index, script in enumerate(scripts)])

    def test_manifest_change_after_render_does_not_publish_any_output(self):
        self.add_identity_renderers()
        self.add_stage(script='portrait_features_render.py', mode='evidence-change')
        with self.assertRaisesRegex(ValueError, 'manifest changed'):
            self.execute(source_evidence=self.source_sidecar())
        self.assertFalse(self.output.exists())
        self.assertFalse(self.report.exists())

    def test_subprocess_chain_transports_original_identity_and_current_input_hash(self):
        self.add_identity_renderers()
        self.add_stage(script='portrait_features_render.py')
        self.add_stage(script='lip_render.py')
        receipt = self.execute()
        first, second = receipt['stages']
        reference = second['receipt']['faceReference']
        self.assertEqual(reference['sourceRgbaSha256'], receipt['inputRgbaSha256'])
        self.assertEqual(reference['inputRgbaSha256'], first['outputRgbaSha256'])
        self.assertEqual(reference['points'], first['receipt']['alignment']['points'])
        self.assertEqual(second['faceIdentityAssociation'], 'same-photo-reference')
        self.assertEqual(receipt['samePhotoFaceIdentity']['appliedStageIds'], ['stage-1'])
        self.assertFalse(Path(second['command'][second['command'].index('--face-reference') + 1]).exists())

    def test_verified_no_effect_portrait_keeps_lip_on_its_original_single_face_path(self):
        self.add_identity_renderers()
        self.add_stage(script='portrait_features_render.py', mode='no-effect')
        self.add_stage(script='lip_render.py', delta=2)
        receipt = self.execute()
        self.assertIsNone(receipt['samePhotoFaceIdentity'])
        self.assertEqual([row['faceIdentityAssociation'] for row in receipt['stages']], ['not-applied', 'not-applied'])
        self.assertNotIn('faceReference', receipt['stages'][1]['receipt'])
        expected = self.rgba.copy()
        expected[0, 0, 0] += 2
        np.testing.assert_array_equal(pipeline.read_rgba(path=self.output), expected)

    def test_resident_chain_cancellation_does_not_retain_reference_in_next_job(self):
        self.add_identity_renderers()
        self.add_stage(script='portrait_features_render.py')
        self.add_stage(script='lip_render.py')
        self.plan_path.write_text(json.dumps(self.canonical))
        observed = []

        def runner(**arguments):
            reference = arguments.get('face_reference')
            observed.append(reference)
            if reference is not None:
                raise InterruptedError('cancelled before lip render')
            command = [sys.executable, str(arguments['source']), '--image', str(arguments['image']),
                       '--output', str(arguments['output']), '--report', str(arguments['report'])]
            subprocess.run(command, capture_output=True, check=True)

        with self.assertRaises(InterruptedError):
            pipeline.run(image=self.image, runtime=self.runtime, output=self.output, report=self.report,
                         plan=self.plan_path, stage_runner=runner)
        self.assertIsNone(observed[0])
        self.assertEqual(observed[1].source_sha256, pipeline.sha256(data=self.rgba.tobytes()))
        self.assertFalse(self.output.exists())
        self.canonical['stages'] = self.canonical['stages'][1:]
        self.plan_path.write_text(json.dumps(self.canonical))
        receipt = pipeline.run(image=self.image, runtime=self.runtime, output=self.output, report=self.report,
                               plan=self.plan_path, stage_runner=runner)
        self.assertIsNone(observed[-1])
        self.assertIsNone(receipt['samePhotoFaceIdentity'])

    def test_single_stage_and_skin_first_chain_do_not_add_original_face_detection(self):
        self.add_identity_renderers()
        for scripts in (['lip_render.py'], ['portrait_features_render.py'], ['first_render.py', 'lip_render.py']):
            self.canonical['stages'] = []
            self.output.unlink(missing_ok=True)
            self.report.unlink(missing_ok=True)
            for script in scripts:
                self.add_stage(script=script)
            with patch.object(pipeline, 'reference_from_receipt', side_effect=AssertionError('no new detection')):
                receipt = self.execute()
            self.assertIsNone(receipt['samePhotoFaceIdentity'])
            self.assertTrue(all(row['faceIdentityAssociation'] == 'not-applied' for row in receipt['stages']))

    def test_stage_integrity_failures_leave_no_outputs_or_temporary_directory(self):
        for mode in ('input-hash', 'output-hash', 'cpu-private', 'gpu-private', 'gpu-private-list',
                     'fixed', 'native', 'missing-cpu', 'resize', 'alpha', 'exit'):
            with self.subTest(mode=mode):
                self.canonical['stages'] = []
                self.add_stage(mode=mode)
                self.assert_clean_failure()

    def test_later_stage_failure_does_not_publish_prior_success(self):
        self.add_stage()
        self.add_stage(script='second_render.py', mode='exit')
        self.assert_clean_failure()

    def test_renderer_source_change_rejected(self):
        self.add_stage(mode='source-change')
        self.assert_clean_failure()

    def test_missing_runtime_argument_and_external_source_symlink_rejected(self):
        source = self.root / 'research/first_render.py'
        source.write_text('import argparse\nparser = argparse.ArgumentParser()\n')
        self.add_stage()
        self.assert_clean_failure()
        source.unlink()
        external = self.root / 'external.py'
        external.write_text(FAKE_RENDERER)
        source.symlink_to(external)
        self.assert_clean_failure()

    def test_oversized_and_transparent_images_rejected_without_resizing(self):
        for rgba in (np.full((1, 1281, 4), 255, dtype=np.uint8), self.rgba.copy()):
            if rgba.shape == self.rgba.shape:
                rgba[0, 0, 3] = 0
            Image.fromarray(rgba).save(self.image)
            self.assert_clean_failure()
        self.planner.assert_not_called()

    def test_existing_destination_and_aliases_preserve_original_files(self):
        self.output.write_bytes(b'keep')
        self.assert_clean_failure_preserving_output()
        self.output.unlink()
        with self.assertRaises(ValueError):
            pipeline.run(image=self.image, runtime=self.runtime, output=self.image, report=self.report, plan=self.plan_path)
        self.assertEqual(pipeline.read_rgba(path=self.image).shape, self.rgba.shape)
        self.output.symlink_to(self.image)
        self.assert_clean_failure_preserving_output()
        self.assertTrue(self.output.is_symlink())

    def assert_clean_failure_preserving_output(self):
        before = self.output.read_bytes()
        with self.assertRaises(ValueError):
            self.execute()
        self.assertEqual(self.output.read_bytes(), before)
        self.assertFalse(self.report.exists())

    def test_report_publish_failure_rolls_back_only_our_png(self):
        original_publish = pipeline._publish

        def race_report(**arguments):
            self.report.write_bytes(b'other writer')
            return original_publish(**arguments)

        with patch.object(pipeline, '_publish', side_effect=race_report), self.assertRaises(FileExistsError):
            self.execute()
        self.assertFalse(self.output.exists())
        self.assertEqual(self.report.read_bytes(), b'other writer')
        self.assertEqual(list(self.root.glob('independent-pipeline-*')), [])


class PipelineJsonTests(unittest.TestCase):
    def test_duplicate_nonfinite_and_oversized_json_rejected(self):
        for data in (b'{"version":1,"version":2}', b'{"value":NaN}', b'{"value":Infinity}', b'{"value":1e999}'):
            with self.subTest(data=data), self.assertRaises(ValueError):
                pipeline.parse_json(data=data)
        with self.assertRaises(ValueError):
            pipeline.parse_json(data=b'{}', limit=1)

    def test_conflicting_receipt_hash_spelling_rejected(self):
        with self.assertRaises(ValueError):
            pipeline.receipt_hash(receipt={'inputRgbaSha256': 'a' * 64, 'input_rgba_sha256': 'b' * 64},
                                  camel='inputRgbaSha256', snake='input_rgba_sha256')

    def test_private_custom_runtime_path_rejected_even_without_claimed_private_images(self):
        runtime = Path('/opt/custom-models')
        with self.assertRaises(ValueError):
            pipeline.verify_isolation(receipt={'independence': {'private_native_images': [],
                'loaded_images': ['/opt/custom-models/Frameworks/unknown.dylib']}}, runtime=runtime)


@unittest.skipUnless(sys.platform == 'darwin' and pipeline.shutil.which('bun'), 'real planner and dyld inventory require macOS/Bun')
class PipelinePlannerIntegrationTests(unittest.TestCase):
    def test_real_cli_zero_request_uses_shared_planner_and_preserves_full_rgba(self):
        with tempfile.TemporaryDirectory(prefix='pipeline-zero-cli-') as temporary:
            directory = Path(temporary)
            image, request, output, report = (directory / name for name in ('input.png', 'request.json', 'output.png', 'report.json'))
            rgba = np.arange(6 * 8 * 4, dtype=np.uint8).reshape(6, 8, 4)
            rgba[..., 3] = 255
            Image.fromarray(rgba).save(image)
            request.write_text(json.dumps({'values': {'face_adjust_TotalFace': 0, 'Whiten': 0},
                'makeup': {'lip': {'cardId': 'lip-coral-nude', 'intensity': 0}}}))
            process = subprocess.run([sys.executable, str(pipeline.ROOT / 'research/independent_pipeline.py'),
                '--image', str(image), '--request', str(request), '--runtime', str(directory / 'missing-runtime'),
                '--output', str(output), '--report', str(report)], capture_output=True, text=True, check=True, timeout=30)
            receipt = json.loads(report.read_text())
            self.assertTrue(json.loads(process.stdout)['passed'])
            self.assertEqual(receipt['stages'], [])
            self.assertEqual(receipt['plan']['adjustments']['values'], {'TotalFace': 0, 'Whiten': 0})
            self.assertEqual(receipt['independence']['private_native_images'], [])
            self.assertFalse(receipt['nativeInputsUsed'])
            np.testing.assert_array_equal(pipeline.read_rgba(path=output), rgba)


if __name__ == '__main__':
    unittest.main()
