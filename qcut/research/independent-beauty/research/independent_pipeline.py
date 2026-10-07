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


ROOT = Path(__file__).resolve().parents[1]
MAX_JSON_BYTES = 1024 * 1024
MAX_RECEIPT_BYTES = 16 * 1024 * 1024
MAX_STAGES = 64
TRANSPORT_FLAGS = {'--image', '--rgba', '--width', '--height', '--runtime', '--output',
                   '--report', '--points', '--assets', '--shape-assets', '--max-edge'}
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


def read_rgba(*, path):
    with Image.open(path) as source:
        if getattr(source, 'n_frames', 1) != 1:
            raise ValueError('a single still image is required')
        if min(source.size) < 1 or max(source.size) > 1280:
            raise ValueError('pipeline requires image dimensions at most 1280; resizing is not performed')
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
    if (not isinstance(adjustments, dict) or set(adjustments) != {'values', 'makeup'}
            or not all(isinstance(adjustments[key], dict) for key in ('values', 'makeup'))):
        raise ValueError('plan requires canonical values and makeup objects')
    values = list(adjustments['values'].values())
    for selection in adjustments['makeup'].values():
        if not isinstance(selection, dict) or set(selection) != {'cardId', 'intensity'} or not isinstance(selection['cardId'], str):
            raise ValueError('invalid plan makeup selection')
        values.append(selection['intensity'])
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


def run(*, image, runtime, output, report, plan=None, request=None):
    started = time.monotonic()
    if (plan is None) == (request is None):
        raise ValueError('provide exactly one plan or request JSON file')
    image, runtime, output, report = (Path(path).absolute() for path in (image, runtime, output, report))
    specification = Path(plan if plan is not None else request).absolute()
    _fresh_paths(image=image, specification=specification, output=output, report=report)
    original_file_hash = sha256(data=image.read_bytes())
    original = read_rgba(path=image)
    supplied = read_json(path=specification)
    catalog_path = ROOT / 'research/independent-pipeline-catalog.json'
    planner_path = ROOT / 'src/independent-pipeline-plan.ts'
    catalog = read_json(path=catalog_path)
    scripts = allowed_scripts(catalog=catalog)
    if plan is not None:
        validate_plan(plan=supplied, scripts=scripts)
    environment = clean_environment(runtime=runtime)
    sources = {str(path.relative_to(ROOT)): sha256(data=path.read_bytes()) for path in (catalog_path, planner_path)}
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
        current = directory / 'original.png'
        Image.fromarray(original).save(current)
        current_rgba = original
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
            subprocess.run(command, cwd=ROOT, env=environment, capture_output=True, timeout=120, check=True)
            rendered = read_rgba(path=destination)
            if rendered.shape != original.shape:
                raise ValueError('stage changed the original image dimensions')
            stage_receipt = read_json(path=stage_report, limit=MAX_RECEIPT_BYTES)
            inventories = verify_isolation(receipt=stage_receipt, runtime=runtime)
            input_hash = sha256(data=current_rgba.tobytes())
            output_hash = sha256(data=rendered.tobytes())
            if (receipt_hash(receipt=stage_receipt, camel='inputRgbaSha256', snake='input_rgba_sha256') != input_hash
                    or receipt_hash(receipt=stage_receipt, camel='outputRgbaSha256', snake='output_rgba_sha256') != output_hash):
                raise ValueError('stage receipt RGBA hash chain mismatch')
            rows.append({**stage, 'command': command, 'inputRgbaSha256': input_hash, 'outputRgbaSha256': output_hash,
                         'inputPngSha256': sha256(data=current.read_bytes()), 'outputPngSha256': sha256(data=destination.read_bytes()),
                         'loadedImageInventories': inventories, 'recomputedGeometryAfterPriorStage': True,
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
                   'runtime': str(runtime), 'output': str(output), 'inputRgbaSha256': sha256(data=original.tobytes()),
                   'outputRgbaSha256': sha256(data=current_rgba.tobytes()),
                   'outputPngSha256': sha256(data=current.read_bytes()), 'independence': isolation,
                   'sourceIdentity': sources, 'plannerCommand': planner_command,
                   'zeroParametersIdentity': not rows, 'recomputedGeometryAfterPriorStage': True,
                   'fixedLandmarks': False, 'nativeGeometryUsed': False, 'nativeInputsUsed': False,
                   'nativeFallbackUsed': False, 'nativeProductParityVerified': False,
                   'videoVerified': False, 'intermediatesRetained': False,
                   'milliseconds': round((time.monotonic() - started) * 1000)}
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
    arguments = parser.parse_args()
    try:
        receipt = run(image=arguments.image, plan=arguments.plan, request=arguments.request,
                      runtime=arguments.runtime, output=arguments.output, report=arguments.report)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        detail = error.stderr.decode(errors='replace')[-4096:] if isinstance(error, subprocess.CalledProcessError) and error.stderr else str(error)
        print(json.dumps({'passed': False, 'error': detail}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({'passed': True, 'output': str(arguments.output), 'report': str(arguments.report),
                      'stages': len(receipt['stages']), 'nativeProductParityVerified': False}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
