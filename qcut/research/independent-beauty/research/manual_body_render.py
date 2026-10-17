"""QCut-owned manual body tools on an opaque photo: stretch one horizontal band.

The editor's manual-body `stretch` is {intensity -50..50, upper, bottom}: the
band between two handles, as shares of the height measured from the bottom
edge (upper above bottom). A positive intensity lengthens the band and moves
the picture above and below it outwards, off the frame; a negative one
shortens it and moves the picture in, uncovering a strip at the top and the
bottom where the unchanged photo shows. Only rows move.

The amounts follow the native tool, measured on coordinate-encoded frames at
seven sizes: at full intensity each band edge moves 5 % of the frame height
outwards (2 % inwards, at most half the band), the pixel count truncated as
the native computes it in single precision, scaled linearly by intensity;
the band in between scales evenly and the rest of the picture shifts as a
whole; the resulting source rows are then spread by the native grid's
250/249 about the frame centre. The native's sub-pixel horizontal offset is
not reproduced: columns stay where they are.
"""
from render_resolution import source_edge_limit
import argparse
import hashlib
import json
import math
from numbers import Real
from pathlib import Path
import time

import numpy as np
from PIL import Image

from facefitting_image import decode_image
from slimface_render import validate_rgba
from whiten_metal import process_images

TOOLS = ('stretch',)
INTENSITY_LIMIT = 50
MIN_BAND = 0.02
STRETCH_SHARE = 0.05
SHRINK_SHARE = 0.02
GRID_SCALE = 250 / 249


def _number(*, value, label, low, high):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real) or not math.isfinite(value) \
            or not low <= value <= high:
        raise ValueError(f'manual body {label} must be a finite number in [{low},{high}]')
    return 0.0 if value == 0 else float(value)


def validate_manual_body(*, manual_body):
    """The settings this renderer accepts, with every field checked; only active tools."""
    if not isinstance(manual_body, dict) or not manual_body or not set(manual_body) <= set(TOOLS):
        raise ValueError(f'manual body must set at least one of {", ".join(TOOLS)}')
    stretch = manual_body['stretch']
    if not isinstance(stretch, dict) or set(stretch) != {'intensity', 'upper', 'bottom'}:
        raise ValueError('manual body stretch requires exactly intensity, upper and bottom')
    upper = _number(value=stretch['upper'], label='stretch.upper', low=MIN_BAND, high=1)
    bottom = _number(value=stretch['bottom'], label='stretch.bottom', low=0, high=1 - MIN_BAND)
    if upper - bottom < MIN_BAND - 1e-9:
        raise ValueError('manual body stretch band must be at least 0.02 tall')
    intensity = _number(value=stretch['intensity'], label='stretch.intensity',
                        low=-INTENSITY_LIMIT, high=INTENSITY_LIMIT)
    return {'stretch': {'intensity': intensity, 'upper': upper, 'bottom': bottom}}


def stretch_edge_pixels(*, height, intensity, upper, bottom):
    """How far each band edge moves at full scale, in whole pixels, the native way."""
    band = upper - bottom
    share = STRETCH_SHARE / band if intensity > 0 else min(0.5, SHRINK_SHARE / band)
    f32 = np.float32
    return int(f32(f32(share) * (f32(upper) - f32(bottom))) * f32(height))


def stretch_source_rows(*, height, intensity, upper, bottom):
    """Continuous source row (row r spans [r, r+1]) each output row samples; NaN where the photo shows."""
    centres = np.arange(height, dtype=np.float64) + 0.5
    if intensity == 0:
        return centres
    amount = intensity / 100
    move = stretch_edge_pixels(height=height, intensity=intensity, upper=upper, bottom=bottom) * amount
    top, end = (1 - upper) * height, (1 - bottom) * height
    band = end - top
    # At most a quarter of the band leaves from each edge, so it never vanishes.
    shown = band + 2 * move
    grid = np.where(centres < top - move, centres + move,
                    np.where(centres > end + move, centres - move, top + (centres - top + move) * band / shown))
    # The grid decides what is covered; its texture lookup is spread by
    # GRID_SCALE and clamps at the edge rows.
    source = height / 2 + GRID_SCALE * (grid - height / 2)
    return np.where((grid >= 0) & (grid < height), source, np.nan)


def apply_stretch(*, rgba, intensity, upper, bottom):
    """Resample rows bilinearly (clamped at the edges); uncovered rows keep the photo."""
    height = rgba.shape[0]
    rows = stretch_source_rows(height=height, intensity=intensity, upper=upper, bottom=bottom)
    covered = np.flatnonzero(~np.isnan(rows))
    position = np.clip(rows[covered] - 0.5, 0, height - 1)
    lower = np.floor(position).astype(np.intp)
    upper_row = np.minimum(lower + 1, height - 1)
    weight = (position - lower)[:, None, None]
    source = rgba.astype(np.float64)
    result = rgba.copy()
    blended = source[lower] * (1 - weight) + source[upper_row] * weight
    result[covered] = np.clip(np.rint(blended), 0, 255).astype(np.uint8)
    return result


def run(*, rgba, manual_body, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > source_edge_limit() or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque manual-body photo required')
    settings = validate_manual_body(manual_body=manual_body)
    stretch = settings['stretch']
    result = apply_stretch(rgba=rgba, **stretch)
    independence = process_images()
    receipt = {'scope': 'original-photo-manual-body-PNG', 'tools': sorted(settings), 'manualBody': settings,
               'width': rgba.shape[1], 'height': rgba.shape[0],
               'stretchEdgePixels': stretch_edge_pixels(height=rgba.shape[0], **stretch),
               'independence': independence, 'privateAssetDependency': False,
               'fixedLandmarks': False, 'nativeGeometryUsed': False, 'nativeProductParityVerified': False,
               'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
               'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
               'changedPixels': int(np.count_nonzero(np.any(result != rgba, axis=-1))),
               'milliseconds': round((time.monotonic() - started) * 1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--manual-body', required=True, help='JSON object, e.g. {"stretch": {...}}')
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1] / 'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct PNG and report paths required')
    from independent_pipeline import parse_json
    run(rgba=decode_image(image=args.image, max_edge=source_edge_limit())['rgba'],
        manual_body=parse_json(data=args.manual_body.encode()),
        runtime=args.runtime, output=args.output, report=args.report)
