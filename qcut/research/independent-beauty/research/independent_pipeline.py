"""Execute a canonical, original-derived chain of independent photo renderers."""
import argparse
import ast
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

import numpy as np
from PIL import Image, ImageOps

from render_resolution import RESOLUTION_ENV, resolution_mode
from face_selection_reference import bind_reference, reference_from_receipt, write_reference
from source_face_confirmation import evidence_receipt, validate_stage_confirmation


ROOT = Path(__file__).resolve().parents[1]
MAX_JSON_BYTES = 1024 * 1024
MAX_RECEIPT_BYTES = 16 * 1024 * 1024
MAX_STAGES = 64
TRANSPORT_FLAGS = {'--image', '--rgba', '--width', '--height', '--runtime', '--output',
                   '--report', '--points', '--assets', '--shape-assets', '--max-edge', '--resolution', '--face-reference', '--source-evidence'}
FORBIDDEN_IMAGE_TOKENS = ('libcccreator', 'libbytenn', 'liblens', 'libagfx',
                          '/runtime/frameworks/', '/jianyingpro.app/')
FORBIDDEN_RECEIPT_FLAGS = {'fixedLandmarks', 'fixed_landmarks', 'nativeGeometryUsed',
                          'native_geometry_used', 'nativeInputsUsed', 'native_inputs_used',
                          'nativePixelsUsed', 'native_pixels_used', 'nativeFallbackUsed',
                          'native_fallback_used'}
ASSET_ARGUMENTS = {
    'slimface_mesh_render.py': [('--assets', 'slimface-mesh-v1.npz'),
                               ('--shape-assets', 'face-shape-v1.npz')],
    'lip_render.py': [('--assets', 'lip-v1.npz')],
    'liquefy_render.py': [('--assets', 'liquefy-v1.npz')],
}
ORIGINAL_RENDERERS = frozenset({
    'smooth_render.py', 'whiten_render.py', 'spot_acne_render.py', 'skin_gan_render.py',
    'portrait_features_render.py', 'youtai_render.py', 'jawline_render.py',
    'lip_render.py', 'softpink_render.py', 'brow_render.py', 'makeup248_render.py',
    'eye_render.py', 'lashes_render.py', 'shadow_render.py', 'look_render.py',
    'makeup3d_render.py', 'contacts_render.py', 'dynamic_makeup_render.py',
    'manual_body_render.py',
})


def sha256(*, data):
    return hashlib.sha256(data).hexdigest()


def _unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError(f'duplicate JSON key: {name}')
        result[name] = value
    return result


def _reject_constant(value):
    raise ValueError(f'non-finite JSON number: {value}')


def _finite_float(value):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError('non-finite JSON number')
    return result


def parse_json(*, data, limit=MAX_JSON_BYTES):
    if len(data) > limit:
        raise ValueError('JSON exceeds the bounded pipeline budget')
    return json.loads(data, object_pairs_hook=_unique_object, parse_constant=_reject_constant, parse_float=_finite_float)


def read_json(*, path, limit=MAX_JSON_BYTES):
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError(f'missing or oversized JSON: {path}')
    return parse_json(data=path.read_bytes(), limit=limit)


def read_rgba(*, path, resolution='preview'):
    mode = resolution_mode(mode=resolution)
    limit = 4096 if mode == 'original' else 1280
    with Image.open(path) as source:
        if getattr(source, 'n_frames', 1) != 1:
            raise ValueError('a single still image is required')
        if min(source.size) < 1 or max(source.size) > limit:
            raise ValueError(f'pipeline requires image dimensions at most {limit}; resizing is not performed')
        oriented = ImageOps.exif_transpose(source)
        rgba = np.array(oriented.convert('RGBA'), dtype=np.uint8)
    if np.any(rgba[..., 3] != 255):
        raise ValueError('pipeline requires an opaque photo')
    return rgba


def clean_environment(*, runtime):
    environment = {name: value for name, value in os.environ.items()
                   if not name.startswith('DYLD_') and name not in ('PYTHONPATH', 'PYTHONHOME')}
    environment['BEAUTY_RESEARCH_MODELS'] = str(runtime / 'research')
    environment['PYTHONNOUSERSITE'] = '1'
    return environment


def process_inventory():
    # Reuse the existing inventory without initializing a network or Metal host.
    from whiten_metal import process_images
    return process_images()


def _private_image(*, name, runtime):
    lowered = name.lower()
    framework_root = str(runtime / 'Frameworks').lower().rstrip('/') + '/'
    return any(token in lowered for token in FORBIDDEN_IMAGE_TOKENS) or lowered.startswith(framework_root)


def verify_isolation(*, receipt, runtime):
    if not isinstance(receipt, dict) or not isinstance(receipt.get('independence'), dict):
        raise ValueError('stage receipt lacks CPU loaded-image evidence')
    cpu = receipt['independence']
    if 'private_native_images' not in cpu or not any(key in cpu for key in ('loaded_images', 'images')):
        raise ValueError('stage receipt lacks CPU loaded-image evidence')
    inventories = []

    def visit(value, path):
        if isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f'{path}[{index}]')
        if not isinstance(value, dict):
            return
        for key in FORBIDDEN_RECEIPT_FLAGS & value.keys():
            if value[key] is not False:
                raise ValueError(f'forbidden native or fixed input in receipt: {path}.{key}')
        if 'private_native_images' in value:
            private = value['private_native_images']
            if not isinstance(private, list) or private:
                raise ValueError(f'private native library evidence at {path}')
        for key in ('loaded_images', 'images'):
            if key in value:
                images = value[key]
                if not isinstance(images, list) or not all(isinstance(name, str) for name in images):
                    raise ValueError(f'invalid loaded-image evidence at {path}.{key}')
                if any(_private_image(name=name, runtime=runtime) for name in images):
                    raise ValueError(f'private native library loaded at {path}.{key}')
                inventories.append({'path': f'{path}.{key}', 'loadedImages': images})
        for key, item in value.items():
            visit(item, f'{path}.{key}')

    visit(receipt, 'receipt')
    return inventories


def allowed_scripts(*, catalog):
    if not isinstance(catalog, dict) or type(catalog.get('version')) is not int or catalog['version'] != 1:
        raise ValueError('unsupported pipeline catalog')
    scripts = set()
    for section in ('stages', 'makeup', 'makeupGroups'):
        entries = catalog.get(section, [] if section == 'makeupGroups' else None)
        if not isinstance(entries, list):
            raise ValueError(f'pipeline catalog lacks {section}')
        for entry in entries:
            script = entry.get('script') if isinstance(entry, dict) else None
            if not isinstance(script, str) or re.fullmatch(r'[a-z][a-z0-9_]*\.py', script) is None:
                raise ValueError('catalog scripts must be local Python basenames')
            scripts.add(script)
    return scripts


def validate_plan(*, plan, scripts):
    if (not isinstance(plan, dict) or set(plan) != {'version', 'adjustments', 'stages'}
            or type(plan['version']) is not int or plan['version'] != 1):
        raise ValueError('unsupported pipeline plan')
    adjustments = plan['adjustments']
    if (not isinstance(adjustments, dict) or set(adjustments) - {'manualBody'} != {'values', 'makeup'}
            or not all(isinstance(adjustments[key], dict) for key in adjustments)):
        raise ValueError('plan requires canonical values and makeup objects')
    values = list(adjustments['values'].values())
    for selection in adjustments['makeup'].values():
        if not isinstance(selection, dict) or set(selection) != {'cardId', 'intensity'} or not isinstance(selection['cardId'], str):
            raise ValueError('invalid plan makeup selection')
        values.append(selection['intensity'])
    for tool, settings in adjustments.get('manualBody', {}).items():
        if (tool != 'stretch' or not isinstance(settings, dict) or set(settings) != {'intensity', 'upper', 'bottom'}
                or any(type(settings[key]) not in (int, float) or not 0 <= settings[key] <= 1 for key in ('upper', 'bottom'))):
            raise ValueError('invalid plan manual body tool')
        values.append(settings['intensity'])
    if any(type(value) not in (int, float) or abs(value) > 100 or not math.isfinite(value) for value in values):
        raise ValueError('plan intensities must be finite numbers')
    stages = plan['stages']
    if not isinstance(stages, list) or len(stages) > MAX_STAGES:
        raise ValueError('bounded stage list required')
    identifiers = set()
    for stage in stages:
        if (not isinstance(stage, dict) or set(stage) != {'id', 'script', 'parameters', 'kind', 'controls'}
                or not isinstance(stage['id'], str) or not stage['id'] or stage['id'] in identifiers
                or not isinstance(stage['kind'], str) or not isinstance(stage['controls'], dict)
                or stage['script'] not in scripts):
            raise ValueError('invalid or unlisted pipeline stage')
        identifiers.add(stage['id'])
        parameters = stage['parameters']
        if (not isinstance(parameters, list) or len(parameters) > 128
                or not all(isinstance(value, str) and '\x00' not in value and len(value) <= 65536 for value in parameters)):
            raise ValueError('invalid pipeline stage parameters')
        if any(value.split('=', 1)[0] in TRANSPORT_FLAGS for value in parameters):
            raise ValueError('stage parameters cannot replace transport paths or supply fixed landmarks')
    return plan


def canonical_plan(*, request, directory, environment):
    request_path = directory / 'planner-request.json'
    request_path.write_text(json.dumps(request, ensure_ascii=False, allow_nan=False))
    planner = ROOT / 'src/independent-pipeline-plan.ts'
    bun = shutil.which('bun', path=environment.get('PATH'))
    if bun is None or not planner.is_file():
        raise ValueError('Bun and the pure independent pipeline planner are required')
    command = [bun, str(planner), str(request_path)]
    process = subprocess.run(command, cwd=ROOT, env=environment, capture_output=True, timeout=30, check=True)
    return parse_json(data=process.stdout), command


def renderer_arguments(*, script, runtime):
    source = ROOT / 'research' / script
    if not source.is_file() or source.resolve().parent != (ROOT / 'research').resolve():
        raise ValueError('renderer must be a repository research source')
    tree = ast.parse(source.read_text())
    flags = {argument.value for node in ast.walk(tree) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Attribute) and node.func.attr == 'add_argument'
             for argument in node.args if isinstance(argument, ast.Constant) and isinstance(argument.value, str)}
    if script != 'slimface_mesh_render.py' and '--runtime' not in flags:
        raise ValueError(f'renderer has no explicit runtime binding: {script}')
    arguments = [] if script == 'slimface_mesh_render.py' else ['--runtime', str(runtime)]
    for flag, asset in ASSET_ARGUMENTS.get(script, []):
        if flag not in flags:
            raise ValueError(f'renderer no longer accepts its runtime asset binding: {script}')
        arguments.extend([flag, str(runtime / 'research' / asset)])
    return source, arguments


def receipt_hash(*, receipt, camel, snake):
    hashes = [receipt[key] for key in (camel, snake) if key in receipt]
    if not hashes or any(not isinstance(value, str) or re.fullmatch('[0-9a-f]{64}', value) is None for value in hashes):
        raise ValueError(f'stage receipt lacks a valid {camel}')
    if len(set(hashes)) != 1:
        raise ValueError('stage receipt contains conflicting RGBA hashes')
    return hashes[0]


def _fresh_paths(*, image, specification, output, report):
    paths = [path.resolve() for path in (image, specification, output, report)]
    if len(set(paths)) != len(paths):
        raise ValueError('source, specification, output and report must be distinct')
    if output.suffix.lower() != '.png' or report.suffix.lower() != '.json':
        raise ValueError('pipeline output must be PNG and report must be JSON')
    for destination in (output, report):
        if os.path.lexists(destination) or not destination.parent.is_dir():
            raise ValueError('fresh output/report paths in existing directories are required')


def _same_json(*, left, right):
    return json.dumps(left, sort_keys=True, allow_nan=False) == json.dumps(right, sort_keys=True, allow_nan=False)


def _publish(*, png, receipt, output, report):
    created = []
    try:
        for destination, data in ((output, png.read_bytes()),
                                  (report, (json.dumps(receipt, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode())):
            with destination.open('xb') as target:
                created.append(destination)
                target.write(data)
    except BaseException:
        for destination in created:
            destination.unlink(missing_ok=True)
        raise


def run(*, image, runtime, output, report, plan=None, request=None, resolution='preview',
        stage_runner=None, runtime_receipt=None, source_evidence=None):
    started = time.monotonic()
    if (plan is None) == (request is None):
        raise ValueError('provide exactly one plan or request JSON file')
    image, runtime, output, report = (Path(path).absolute() for path in (image, runtime, output, report))
    specification = Path(plan if plan is not None else request).absolute()
    _fresh_paths(image=image, specification=specification, output=output, report=report)
    original_file_hash = sha256(data=image.read_bytes())
    mode = resolution_mode(mode=resolution)
    original = read_rgba(path=image, resolution=mode)
    source_evidence = Path(source_evidence).absolute() if source_evidence is not None else None
    source_receipt = evidence_receipt(path=source_evidence, rgba=original) if source_evidence is not None else None
    supplied = read_json(path=specification)
    catalog_path = ROOT / 'research/independent-pipeline-catalog.json'
    planner_path = ROOT / 'src/independent-pipeline-plan.ts'
    catalog = read_json(path=catalog_path)
    scripts = allowed_scripts(catalog=catalog)
    if plan is not None:
        validate_plan(plan=supplied, scripts=scripts)
    environment = clean_environment(runtime=runtime)
    environment[RESOLUTION_ENV] = mode
    resolution_path = ROOT / 'research/render_resolution.py'
    sources = {str(path.relative_to(ROOT)): sha256(data=path.read_bytes())
               for path in (catalog_path, planner_path, resolution_path)}
    isolation = process_inventory()
    verify_isolation(receipt={'independence': isolation}, runtime=runtime)
    rows = []
    with tempfile.TemporaryDirectory(prefix='independent-pipeline-', dir=output.parent) as temporary:
        directory = Path(temporary)
        canonical, planner_command = canonical_plan(request=supplied['adjustments'] if plan is not None else supplied,
                                                    directory=directory, environment=environment)
        validate_plan(plan=canonical, scripts=scripts)
        if plan is not None and not _same_json(left=canonical, right=supplied):
            raise ValueError('supplied plan differs from the canonical independent plan')
        if mode == 'original' and any(stage['script'] not in ORIGINAL_RENDERERS for stage in canonical['stages']):
            raise ValueError('an active renderer has no original-resolution contract')
        current = directory / 'original.png'
        Image.fromarray(original).save(current)
        current_rgba = original
        original_rgba_hash = sha256(data=original.tobytes())
        establish_identity = (len(canonical['stages']) > 1
                              and canonical['stages'][0]['script'] == 'portrait_features_render.py'
                              and any(stage['script'] == 'lip_render.py' for stage in canonical['stages'][1:]))
        face_reference = None
        for index, stage in enumerate(canonical['stages']):
            source, runtime_arguments = renderer_arguments(script=stage['script'], runtime=runtime)
            source_key = str(source.relative_to(ROOT))
            source_hash = sha256(data=source.read_bytes())
            if source_key in sources and sources[source_key] != source_hash:
                raise ValueError('executed renderer changed between pipeline stages')
            sources[source_key] = source_hash
            destination, stage_report = directory / f'stage-{index:02d}.png', directory / f'stage-{index:02d}.json'
            command = [sys.executable, str(source), '--image', str(current), *stage['parameters'],
                       *runtime_arguments, '--output', str(destination), '--report', str(stage_report)]
            stage_reference = None
            stage_evidence = source_evidence if index == 0 and stage['script'] == 'portrait_features_render.py' else None
            if stage_evidence is not None:
                command.extend(['--source-evidence', str(stage_evidence)])
            if face_reference is not None and stage['script'] == 'lip_render.py':
                stage_reference = bind_reference(reference=face_reference, rgba=current_rgba,
                                                 source_sha256=original_rgba_hash)
                reference_path = directory / f'face-reference-{index:02d}.json'
                write_reference(reference=stage_reference, path=reference_path)
                command.extend(['--face-reference', str(reference_path)])
            stage_started = time.monotonic()
            if stage_runner is None:
                subprocess.run(command, cwd=ROOT, env=environment, capture_output=True, timeout=120, check=True)
            else:
                stage_runner(stage=stage, source=source, image=current, runtime=runtime,
                             output=destination, report=stage_report,
                             **({'source_evidence': stage_evidence} if stage_evidence is not None else {}),
                             **({'face_reference': stage_reference} if stage_reference is not None else {}))
            rendered = read_rgba(path=destination, resolution=mode)
            if rendered.shape != original.shape:
                raise ValueError('stage changed the original image dimensions')
            stage_receipt = read_json(path=stage_report, limit=MAX_RECEIPT_BYTES)
            inventories = verify_isolation(receipt=stage_receipt, runtime=runtime)
            input_hash = sha256(data=current_rgba.tobytes())
            output_hash = sha256(data=rendered.tobytes())
            if (receipt_hash(receipt=stage_receipt, camel='inputRgbaSha256', snake='input_rgba_sha256') != input_hash
                    or receipt_hash(receipt=stage_receipt, camel='outputRgbaSha256', snake='output_rgba_sha256') != output_hash):
                raise ValueError('stage receipt RGBA hash chain mismatch')
            validate_stage_confirmation(receipt=stage_receipt,
                                        source_receipt=source_receipt if stage_evidence is not None else None,
                                        source_sha256=original_rgba_hash)
            if index == 0 and establish_identity:
                face_reference = reference_from_receipt(receipt=stage_receipt, source_sha256=original_rgba_hash,
                                                        width=original.shape[1], height=original.shape[0],
                                                        source_manifest_sha256=source_receipt['manifestSha256'] if source_receipt else None)
            rows.append({**stage, 'command': command, 'execution': 'resident' if stage_runner else 'subprocess',
                         'milliseconds': round((time.monotonic() - stage_started) * 1000),
                         'inputRgbaSha256': input_hash, 'outputRgbaSha256': output_hash,
                         'inputPngSha256': sha256(data=current.read_bytes()), 'outputPngSha256': sha256(data=destination.read_bytes()),
                         'loadedImageInventories': inventories, 'recomputedGeometryAfterPriorStage': True,
                         'faceIdentityAssociation': ('same-photo-reference' if stage_reference is not None
                                                     else 'original-reference' if index == 0 and face_reference is not None
                                                     else 'not-applied'),
                         'receipt': stage_receipt})
            current, current_rgba = destination, rendered
        if any(sha256(data=(ROOT / name).read_bytes()) != identity for name, identity in sources.items()):
            raise ValueError('pipeline catalog, planner or executed renderer changed during execution')
        if sha256(data=image.read_bytes()) != original_file_hash:
            raise ValueError('original image changed during execution')
        isolation = process_inventory()
        verify_isolation(receipt={'independence': isolation}, runtime=runtime)
        receipt = {'scope': 'original-photo-independent-canonical-stage-chain', 'version': 1, 'passed': True,
                   'plan': canonical, 'adjustments': canonical['adjustments'], 'stages': rows, 'source': str(image),
                   'sourceSha256': original_file_hash, 'width': original.shape[1], 'height': original.shape[0],
                   'resolutionMode': mode, 'originalDimensions': [original.shape[1], original.shape[0]],
                   'analysisDimensions': ([int(original.shape[1]*min(1, 640/max(original.shape[:2]))),
                                           int(original.shape[0]*min(1, 640/max(original.shape[:2])))] if rows else None),
                   'outputDimensions': [current_rgba.shape[1], current_rgba.shape[0]],
                   'noOutputUpscaling': True,
                   'runtime': str(runtime), 'output': str(output), 'inputRgbaSha256': sha256(data=original.tobytes()),
                   'outputRgbaSha256': sha256(data=current_rgba.tobytes()),
                   'outputPngSha256': sha256(data=current.read_bytes()), 'independence': isolation,
                   'sourceIdentity': sources, 'plannerCommand': planner_command,
                   'zeroParametersIdentity': not rows, 'recomputedGeometryAfterPriorStage': True,
                   'samePhotoFaceIdentity': (None if face_reference is None else {
                       'reference': face_reference.as_dict(), 'scope': 'original-portrait-features-to-lip',
                       'appliedStageIds': [row['id'] for row in rows if row['faceIdentityAssociation'] == 'same-photo-reference']}),
                   'fixedLandmarks': False, 'nativeGeometryUsed': False, 'nativeInputsUsed': False,
                   'nativeFallbackUsed': False, 'nativeProductParityVerified': False,
                   'videoVerified': False, 'intermediatesRetained': False,
                   'milliseconds': round((time.monotonic() - started) * 1000)}
        if runtime_receipt is not None:
            receipt['residentRuntime'] = runtime_receipt()
        if source_receipt is not None:
            if evidence_receipt(path=source_evidence, rgba=original) != source_receipt:
                raise ValueError('source evidence manifest changed during pipeline execution')
            receipt['sourceEvidence'] = source_receipt
        _publish(png=current, receipt=receipt, output=output, report=report)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    specification = parser.add_mutually_exclusive_group(required=True)
    specification.add_argument('--plan', type=Path)
    specification.add_argument('--request', type=Path)
    parser.add_argument('--runtime', type=Path, default=ROOT / 'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--resolution', choices=('preview', 'original'), default='preview')
    parser.add_argument('--source-evidence', type=Path)
    arguments = parser.parse_args()
    try:
        receipt = run(image=arguments.image, plan=arguments.plan, request=arguments.request,
                      runtime=arguments.runtime, output=arguments.output, report=arguments.report,
                      resolution=arguments.resolution, source_evidence=arguments.source_evidence)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        detail = error.stderr.decode(errors='replace')[-4096:] if isinstance(error, subprocess.CalledProcessError) and error.stderr else str(error)
        print(json.dumps({'passed': False, 'error': detail}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({'passed': True, 'output': str(arguments.output), 'report': str(arguments.report),
                      'stages': len(receipt['stages']), 'nativeProductParityVerified': False}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
