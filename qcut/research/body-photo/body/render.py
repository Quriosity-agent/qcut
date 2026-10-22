"""Render public smart-body controls with the pinned standalone macOS photo engine."""
import argparse
from contextlib import contextmanager, nullcontext
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time

sys.dont_write_bytecode = True

from import_engine import BODY_ROOT, verify_bundle
from runtime_paths import RUNTIME_ENV, runtime_root
from cli_console import configure_console
from control_contract import LEG_CONTROLS, PUBLIC_CONTROLS, to_engine_controls
from local_shape import validate_edits
from platform_backend import select_backend, backend_label
from photo_controls import EXTRA_RANGES, control_parts, validate_photo_controls


MAX_EDGE = 4096
MAX_PIXELS = 8_294_400


def sha256(*, data):
    return hashlib.sha256(data).hexdigest()


def parse_object(*, text):
    def pairs(items):
        result = {}
        for name, value in items:
            if name in result:
                raise ValueError('duplicate controls key: ' + name)
            result[name] = value
        return result

    def reject_constant(value):
        raise ValueError('non-finite controls value: ' + value)

    return json.loads(text, object_pairs_hook=pairs, parse_constant=reject_constant)


def parse_controls(*, text):
    return validate_photo_controls(controls=parse_object(text=text), extended=True)


def verify_installation(*, body_root=BODY_ROOT, backend="auto"):
    selected = select_backend(backend=backend)
    if selected == "cpu":
        from portable_engine import verify_portable
        verification = verify_portable(body_root=body_root)
    else:
        verification = verify_bundle(body_root=body_root)
    return {**verification, 'platform': sys.platform,
            'platformSupported': True, 'backend': backend_label(backend=selected),
            'publicControls': list(PUBLIC_CONTROLS) + (list(EXTRA_RANGES) if selected == "cpu" else []),
            'maxEdge': MAX_EDGE, 'maxPixels': MAX_PIXELS,
            'modelWeightsOrigin': 'extracted-original-private-assets', 'inferencePerformed': False}


def validate_paths(*, image, output, report, body_root=BODY_ROOT):
    paths = [Path(image), Path(output), Path(report)]
    if any(not path.is_absolute() for path in paths):
        raise ValueError('image, output and report paths must be absolute')
    if any(path.is_symlink() for path in paths):
        raise ValueError('image, output and report cannot be symlinks')
    source, destination, receipt = [path.resolve() for path in paths]
    if len({source, destination, receipt}) != 3:
        raise ValueError('source, output and report must be distinct')
    if not source.is_file() or source.stat().st_size > 64 * 1024**2:
        raise ValueError('bounded regular source PNG required')
    if destination.exists() or receipt.exists():
        raise ValueError('fresh output and report paths required')
    protected = (body_root.resolve(), runtime_root(body_root=body_root).resolve())
    if any(path.is_relative_to(root) for path in (destination, receipt) for root in protected):
        raise ValueError('output cannot overwrite application sources or runtime data')
    return source, destination, receipt


def read_source(*, image):
    import numpy as np
    from PIL import Image

    with Image.open(image) as source:
        if source.format != 'PNG' or getattr(source, 'n_frames', 1) != 1:
            raise ValueError('single-frame PNG source required')
        width, height = source.size
        if min(width, height) < 32 or max(width, height) > MAX_EDGE or width * height > MAX_PIXELS:
            raise ValueError('photo must be 32..4096 per axis and at most 8294400 pixels')
        if source.getexif().get(274, 1) not in (None, 1):
            raise ValueError('source PNG must already be upright; normalize orientation before rendering')
        rgba = np.array(source.convert('RGBA'), dtype=np.uint8, copy=True)
    if np.any(rgba[..., 3] != 255):
        raise ValueError('opaque PNG source required')
    return rgba


@contextmanager
def engine_environment(*, body_root, backend="metal"):
    saved = dict(os.environ)
    previous_path = list(sys.path)
    for name in list(os.environ):
        if name != RUNTIME_ENV and (name.startswith(('DYLD_', 'QCUT_', 'BEAUTY_')) or name in ('PYTHONPATH', 'PYTHONHOME')):
            os.environ.pop(name)
    os.environ['BEAUTY_RENDER_RESOLUTION'] = 'original'
    os.environ['BEAUTY_RENDER_BACKEND'] = 'metal' if backend == "metal" else "portable"
    os.environ['BEAUTY_RESEARCH_MODELS'] = str(runtime_root(body_root=body_root) / 'body' / 'research')
    os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
    os.environ['PYTHONNOUSERSITE'] = '1'
    sys.path.insert(0, str(body_root / 'engine' / 'research'))
    try:
        yield
    finally:
        sys.path[:] = previous_path
        os.environ.clear()
        os.environ.update(saved)


def publish(*, output, png, report, receipt):
    created = []
    try:
        for path, data in [(output, png), (report, json.dumps(receipt, ensure_ascii=False,
                                                            allow_nan=False, indent=2).encode() + b'\n')]:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as stream:
                stat = os.fstat(stream.fileno())
                created.append((path, stat.st_dev, stat.st_ino))
                stream.write(data)
    except BaseException:
        for path, device, inode in created:
            if path.is_file():
                stat = path.stat()
                if (stat.st_dev, stat.st_ino) == (device, inode):
                    path.unlink()
        raise


def render_image(*, image, controls, output, report, body_root=BODY_ROOT, edits=None, backend="auto"):
    started = time.monotonic()
    selected_backend = select_backend(backend=backend)
    values = validate_photo_controls(controls=controls, extended=selected_backend == "cpu")
    edits_supplied = edits is not None
    edits = validate_edits(edits=edits)
    if ("buttocks" in edits or "autoButtocks" in edits) and selected_backend != "cpu":
        raise ValueError("臀部轮廓定位仅支持 CPU 图片版。")
    edited = edits["backgroundProtection"] or bool(edits["strokes"]) or "buttocks" in edits or edits.get("autoButtocks", False)
    source, destination, receipt_path = validate_paths(image=image, output=output, report=report,
                                                        body_root=body_root)
    before = verify_installation(body_root=body_root, backend=selected_backend)
    source_bytes = source.read_bytes()
    input_png_sha = sha256(data=source_bytes)
    rgba = read_source(image=source)
    input_rgba_sha = sha256(data=rgba.tobytes())
    if selected_backend == "cpu":
        from portable_math import portable_math
        math_context = portable_math()
    else:
        math_context = nullcontext()
    with engine_environment(body_root=body_root, backend=selected_backend), math_context:
        import body_smart_render
        from PIL import Image
        import numpy as np

        expected_entry = (body_root / 'engine' / 'research' / 'body_smart_render.py').resolve()
        if Path(body_smart_render.__file__).resolve() != expected_entry:
            raise ValueError('another body engine is already loaded')
        with tempfile.TemporaryDirectory(prefix='independent-body-render-') as temporary:
            work = Path(temporary)
            arguments = {'rgba': rgba, 'runtime': runtime_root(body_root=body_root) / 'body',
                         'output': work / 'output.png', 'report': work / 'receipt.json'}
            if selected_backend == "cpu":
                from portable_engine import PortableEngine
                engine = PortableEngine(engine=body_smart_render, body_root=body_root)
                engine.run(controls=values, edits=edits if edited else None, **arguments)
            elif edited:
                import edit_render
                edit_render.run(engine=body_smart_render, controls=values, edits=edits, **arguments)
            elif any(values[name] for name in LEG_CONTROLS):
                import leg_render
                leg_render.run(engine=body_smart_render, controls=values, **arguments)
            else:
                body_smart_render.run(controls=to_engine_controls(controls=values), **arguments)
            # The canonical return retains NumPy diagnostics; its saved receipt is JSON-normalized.
            engine_report = json.loads((work / 'receipt.json').read_bytes())
            png = (work / 'output.png').read_bytes()
            with Image.open(work / 'output.png') as result:
                output_rgba = np.array(result.convert('RGBA'), np.uint8, copy=True)
    after = verify_installation(body_root=body_root, backend=selected_backend)
    if before != after or source.read_bytes() != source_bytes:
        raise ValueError('source image, engine or model assets changed during rendering')
    output_rgba_sha = sha256(data=output_rgba.tobytes())
    independence = engine_report.get('independence', {})
    if (output_rgba.shape != rgba.shape or np.any(output_rgba[..., 3] != 255)
            or engine_report.get('inputRgbaSha256') != input_rgba_sha
            or engine_report.get('outputRgbaSha256') != output_rgba_sha
            or independence.get('private_native_images') != []
            or engine_report.get('nativeGeometryUsed') is not False
            or engine_report.get('fixedLandmarks') is not False):
        raise ValueError('independent body engine output or provenance did not verify')
    changed = int(np.count_nonzero(np.any(output_rgba != rgba, axis=-1)))
    if engine_report.get('changedPixels') != changed:
        raise ValueError('engine changed-pixel receipt did not match its PNG')
    selected = any(values.values()) or bool(edits["strokes"])
    status = 'applied' if changed else 'unavailable' if selected else 'identity'
    if not selected and output_rgba_sha != input_rgba_sha:
        raise ValueError('zero-strength body request was not pixel-identical')
    parts = {name: engine_report.get('parts', {}).get(part, {'intensity': 0.0, 'moved': False})
             for name, part in control_parts(values=values).items()}
    receipt = {'schemaVersion': 1, 'provider': 'standalone-body-static-v1',
               'backend': backend_label(backend=selected_backend),
               'actualEffectStatus': status, 'reason': engine_report.get('reason'), 'controls': values,
               'parts': parts, 'changedPixels': changed, 'width': rgba.shape[1], 'height': rgba.shape[0],
               'inputPngSha256': input_png_sha, 'inputRgbaSha256': input_rgba_sha,
               'outputPngSha256': sha256(data=png), 'outputRgbaSha256': output_rgba_sha,
               'verification': before, 'sourceAndAssetsUnchanged': True,
               'nativeGeometryUsed': False, 'fixedLandmarks': False, 'nativeProductParityVerified': False,
               'execution': engine_report, 'milliseconds': round((time.monotonic() - started) * 1000)}
    if edits_supplied:
        receipt.update(edits=edits, photoEdits=engine_report.get("photoEdits", {}))
    publish(output=destination, png=png, report=receipt_path, receipt=receipt)
    return receipt


def main():
    configure_console()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--backend', choices=("auto", "metal", "cpu"),
                        default=os.environ.get("BODY_RENDER_BACKEND", "auto"))
    parser.add_argument('--image', type=Path)
    parser.add_argument('--controls')
    parser.add_argument('--edits')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    supplied = (args.image, args.controls, args.output, args.report)
    if args.verify:
        if any(value is not None for value in supplied) or args.edits is not None:
            parser.error('--verify cannot be combined with a render request')
        print(json.dumps(verify_installation(backend=args.backend), ensure_ascii=False))
        return
    if any(value is None for value in supplied):
        parser.error('rendering requires --image, --controls, --output and --report')
    result = render_image(image=args.image, controls=parse_controls(text=args.controls),
                          output=args.output, report=args.report,
                          backend=args.backend,
                          edits=validate_edits(edits=parse_object(text=args.edits)) if args.edits is not None else None)
    print(json.dumps({'actualEffectStatus': result['actualEffectStatus'], 'changedPixels': result['changedPixels'],
                      'outputPngSha256': result['outputPngSha256'], 'report': str(args.report)}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, RuntimeError, json.JSONDecodeError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
