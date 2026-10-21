"""Lossless body-input transport optimization, without loading models."""
import copy
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import independent_pipeline as pipeline
from pipeline_source_png import normalized_rgba_png
import render_resolution


def chunk(*, kind, payload):
    return (len(payload).to_bytes(4, 'big') + kind + payload
            + zlib.crc32(kind + payload).to_bytes(4, 'big'))


def png(*, image, **options):
    target = BytesIO()
    image.save(target, format='PNG', **options)
    return target.getvalue()


def add_chunk(*, data, kind, payload, late=False):
    offset = len(data) - 12 if late else 33
    return data[:offset] + chunk(kind=kind, payload=payload) + data[offset:]


class NormalizedPngTests(unittest.TestCase):
    def setUp(self):
        self.data = png(image=Image.new('RGBA', (5, 4), (23, 45, 67, 255)))

    def test_accepts_standard_rgba_and_optional_srgb(self):
        self.assertTrue(normalized_rgba_png(data=self.data))
        for intent in range(4):
            self.assertTrue(normalized_rgba_png(
                data=add_chunk(data=self.data, kind=b'sRGB', payload=bytes([intent]))))
        node_png = add_chunk(data=self.data, kind=b'sRGB', payload=b'\0')
        node_png = add_chunk(data=node_png, kind=b'sBIT', payload=b'\x08\x08\x08\x08')
        self.assertTrue(normalized_rgba_png(data=node_png))

    def test_rejects_metadata_that_canonical_encoding_would_strip(self):
        for kind, payload in (
                (b'eXIf', b'orientation'), (b'iCCP', b'profile'), (b'gAMA', b'\0\0\xb1\x8f'),
                (b'cHRM', b'chromaticity'), (b'tEXt', b'name\0value'), (b'iTXt', b'xmp'),
                (b'acTL', b'\0\0\0\2\0\0\0\0'), (b'pHYs', b'\0' * 9)):
            for late in (False, True):
                with self.subTest(kind=kind, late=late):
                    self.assertFalse(normalized_rgba_png(
                        data=add_chunk(data=self.data, kind=kind, payload=payload, late=late)))

    def test_rejects_other_modes_depth_interlace_and_malformed_containers(self):
        for mode in ('RGB', 'L', 'P'):
            self.assertFalse(normalized_rgba_png(data=png(image=Image.new(mode, (5, 4)))))
        header = self.data[16:29]
        for format_bytes in (b'\x10\x06\0\0\0', b'\x08\x06\0\0\1'):
            data = self.data[:8] + chunk(kind=b'IHDR', payload=header[:8] + format_bytes) + self.data[33:]
            self.assertFalse(normalized_rgba_png(data=data))
        corrupted = bytearray(self.data)
        corrupted[29] ^= 1
        for data in (self.data[:-1], self.data + b'trailer', bytes(corrupted),
                     self.data[:33] + self.data[-12:], b'not a PNG'):
            self.assertFalse(normalized_rgba_png(data=data))

    def test_rejects_duplicate_late_or_invalid_srgb(self):
        srgb = add_chunk(data=self.data, kind=b'sRGB', payload=b'\0')
        for data in (add_chunk(data=srgb, kind=b'sRGB', payload=b'\0'),
                     add_chunk(data=self.data, kind=b'sRGB', payload=b'\0', late=True),
                     add_chunk(data=self.data, kind=b'sRGB', payload=b'\4'),
                     add_chunk(data=self.data, kind=b'sRGB', payload=b'')):
            self.assertFalse(normalized_rgba_png(data=data))

    def test_accepts_only_unchanged_eight_bit_significance(self):
        sbit = add_chunk(data=self.data, kind=b'sBIT', payload=b'\x08\x08\x08\x08')
        for data in (add_chunk(data=sbit, kind=b'sBIT', payload=b'\x08\x08\x08\x08'),
                     add_chunk(data=self.data, kind=b'sBIT', payload=b'\x08\x08\x08\x08', late=True),
                     add_chunk(data=self.data, kind=b'sBIT', payload=b'\x07\x08\x08\x08'),
                     add_chunk(data=self.data, kind=b'sBIT', payload=b'\x08\x08\x08')):
            self.assertFalse(normalized_rgba_png(data=data))


class PipelineSourceTransportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.runtime = self.root / 'runtime'
        for directory in (self.runtime, self.root / 'research', self.root / 'src'):
            directory.mkdir()
        scripts = ('body_smart_render.py', 'manual_body_render.py')
        catalog = {'version': 1, 'stages': [{'script': name} for name in scripts], 'makeup': []}
        (self.root / 'research/independent-pipeline-catalog.json').write_text(json.dumps(catalog))
        (self.root / 'src/independent-pipeline-plan.ts').write_text('// planner fixture')
        (self.root / 'research/render_resolution.py').write_bytes(Path(render_resolution.__file__).read_bytes())
        for script in scripts:
            (self.root / 'research' / script).write_text("parser.add_argument('--runtime')\n")
        self.plan = {'version': 1, 'adjustments': {'values': {}, 'makeup': {}}, 'stages': [
            {'id': 'body', 'script': 'body_smart_render.py', 'kind': 'scalar',
             'controls': {}, 'parameters': []}]}
        self.image = self.root / 'input.png'
        self.rgba = np.arange(80, dtype=np.uint8).reshape(4, 5, 4)
        self.rgba[..., 3] = 255
        source = png(image=Image.fromarray(self.rgba), compress_level=0)
        source = add_chunk(data=source, kind=b'sRGB', payload=b'\0')
        self.image.write_bytes(add_chunk(data=source, kind=b'sBIT', payload=b'\x08\x08\x08\x08'))
        self.inputs = []
        self.runs = 0
        self.addCleanup(patch.stopall)
        patch.object(pipeline, 'ROOT', self.root).start()
        patch.object(pipeline, 'canonical_plan', side_effect=lambda **_: (copy.deepcopy(self.plan), [])).start()
        patch.object(pipeline, 'process_inventory', return_value={
            'loaded_images': [sys.executable], 'private_native_images': []}).start()

    def stage(self, *, image, output, report, **_):
        self.inputs.append((image, image.read_bytes()))
        rgba = pipeline.read_rgba(path=image)
        result = rgba.copy()
        result[0, 0, 0] += 1
        Image.fromarray(result).save(output)
        report.write_text(json.dumps({
            'inputRgbaSha256': pipeline.sha256(data=rgba.tobytes()),
            'outputRgbaSha256': pipeline.sha256(data=result.tobytes()),
            'independence': {'loaded_images': [sys.executable], 'private_native_images': []}}))

    def execute(self, *, runner=None):
        self.runs += 1
        specification = self.root / 'plan.json'
        specification.write_text(json.dumps(self.plan))
        output = self.root / f'output-{self.runs}.png'
        receipt = pipeline.run(image=self.image, runtime=self.runtime, output=output,
                               report=self.root / f'report-{self.runs}.json',
                               plan=specification, stage_runner=runner or self.stage)
        return output.read_bytes(), receipt

    def test_smart_body_copy_preserves_final_png_bytes_rgba_and_stage_order(self):
        self.plan['stages'].append({
            'id': 'manual', 'script': 'manual_body_render.py', 'kind': 'manual',
            'controls': {}, 'parameters': []})
        original = self.image.read_bytes()
        output, receipt = self.execute()
        self.assertEqual(self.inputs[0][1], original)
        self.assertNotEqual(self.inputs[0][0], self.image)
        self.assertFalse(self.inputs[0][0].exists())
        self.assertEqual(receipt['sourceNormalization'], 'copied-normalized-rgba-png')
        self.assertEqual(receipt['stages'][0]['inputPngSha256'], pipeline.sha256(data=original))
        self.assertEqual(receipt['stages'][0]['outputPngSha256'], receipt['stages'][1]['inputPngSha256'])
        with patch.object(pipeline, 'normalized_rgba_png', return_value=False):
            baseline, baseline_receipt = self.execute()
        self.assertEqual(output, baseline)
        self.assertEqual(receipt['outputRgbaSha256'], baseline_receipt['outputRgbaSha256'])
        self.assertEqual(receipt['outputPngSha256'], baseline_receipt['outputPngSha256'])
        self.assertEqual(self.image.read_bytes(), original)

    def test_zero_stages_and_non_body_first_stage_keep_canonical_png_encoding(self):
        for stages in ([], [{
                'id': 'manual', 'script': 'manual_body_render.py', 'kind': 'manual',
                'controls': {}, 'parameters': []}]):
            with self.subTest(stages=stages):
                self.plan['stages'] = stages
                output, receipt = self.execute()
                self.assertEqual(receipt['sourceNormalization'], 'canonical-rgba-encode')
                if not stages:
                    self.assertEqual(output, png(image=Image.fromarray(self.rgba)))
                    self.assertNotEqual(output, self.image.read_bytes())
                else:
                    self.assertEqual(self.inputs[-1][1], png(image=Image.fromarray(self.rgba)))

    def test_exif_rgb_and_gamma_inputs_follow_the_original_normalization(self):
        orientation = Image.Exif()
        orientation[274] = 6
        inputs = [
            png(image=Image.fromarray(self.rgba).convert('RGB')),
            png(image=Image.fromarray(self.rgba), exif=orientation),
            add_chunk(data=self.image.read_bytes(), kind=b'gAMA', payload=b'\0\0\xb1\x8f'),
        ]
        for data in inputs:
            self.image.write_bytes(data)
            output, receipt = self.execute()
            self.assertEqual(receipt['sourceNormalization'], 'canonical-rgba-encode')
            with patch.object(pipeline, 'normalized_rgba_png', return_value=False):
                baseline, baseline_receipt = self.execute()
            self.assertEqual(output, baseline)
            self.assertEqual(receipt['outputRgbaSha256'], baseline_receipt['outputRgbaSha256'])

    def test_transparency_animation_and_input_mutation_still_fail_without_publishing(self):
        transparent = self.rgba.copy()
        transparent[0, 0, 3] = 254
        self.image.write_bytes(png(image=Image.fromarray(transparent)))
        with self.assertRaisesRegex(ValueError, 'opaque'):
            self.execute()
        self.image.write_bytes(png(
            image=Image.fromarray(self.rgba), save_all=True,
            append_images=[Image.fromarray(self.rgba ^ np.array([1, 0, 0, 0], dtype=np.uint8))]))
        with self.assertRaisesRegex(ValueError, 'single still'):
            self.execute()
        self.image.write_bytes(png(image=Image.fromarray(self.rgba)))

        def mutate_source(**arguments):
            self.stage(**arguments)
            self.image.write_bytes(b'changed source')

        with self.assertRaisesRegex(ValueError, 'original image changed'):
            self.execute(runner=mutate_source)
        self.assertEqual(list(self.root.glob('output-*.png')), [])
        self.assertEqual(list(self.root.glob('report-*.json')), [])
        self.assertEqual(list(self.root.glob('independent-pipeline-*')), [])


if __name__ == '__main__':
    unittest.main()
