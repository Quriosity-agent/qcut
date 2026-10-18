"""QCut-owned manual body tools on an opaque photo: stretch, slim and zoom.

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

`slim` is {intensity -50..50, x, y (centre, y from the bottom), width,
height (shares of the frame), rotation (degrees)}: inside that rectangle the
picture moves along the rectangle's horizontal axis, towards its centre line
for a positive intensity and away from it for a negative one, most at the
quarter lines halfway up and fading to nothing at its sides, top and bottom.
The native field, measured on coordinate-encoded frames, is one shape for
every rectangle size and orientation and exactly linear in intensity; it is
kept as a table (manual_body_slim_field.json) because no short formula
reproduces it within a pixel.

`zoom` is {intensity -50..50, x, y (centre, y from the bottom), radius (a
share of the frame's shorter side)}: a circle magnified (positive) or
shrunk (negative) about its centre, most in the middle and not at all at its
edge. The forward mesh uses the radial weight 1 - t*t*(3 - 2*t),
t = clamp(r**h, 0, 1), h = 1.8 for magnifying and 3 for shrinking. The
intensity multiplier is 0.4 or 0.25 respectively. Its 250-by-250 grid uses
a 1.2 canvas scale with rounded dimensions and pinned viewport boundaries;
this reproduces the native whole-frame subpixel resampling as well.
The public Metal raster requires no original model or effect assets.

Tools apply in the native order: stretch, slim, zoom.
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
from body_mesh_renderer import draw_mesh
from manual_body_zoom_geometry import make_zoom_mesh, radial_weight
from slimface_render import validate_rgba
from whiten_metal import process_images

TOOLS = ('stretch', 'slim', 'zoom')
INTENSITY_LIMIT = 50
MIN_BAND = 0.02
STRETCH_SHARE = 0.05
SHRINK_SHARE = 0.02
GRID_SCALE = 250 / 249
SLIM_FIELD = Path(__file__).resolve().with_name('manual_body_slim_field.json')



def _number(*, value, label, low, high):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real) or not math.isfinite(value) \
            or not low <= value <= high:
        raise ValueError(f'manual body {label} must be a finite number in [{low},{high}]')
    return 0.0 if value == 0 else float(value)


def _stretch(*, stretch):
    if not isinstance(stretch, dict) or set(stretch) != {'intensity', 'upper', 'bottom'}:
        raise ValueError('manual body stretch requires exactly intensity, upper and bottom')
    upper = _number(value=stretch['upper'], label='stretch.upper', low=MIN_BAND, high=1)
    bottom = _number(value=stretch['bottom'], label='stretch.bottom', low=0, high=1 - MIN_BAND)
    if upper - bottom < MIN_BAND - 1e-9:
        raise ValueError('manual body stretch band must be at least 0.02 tall')
    intensity = _number(value=stretch['intensity'], label='stretch.intensity',
                        low=-INTENSITY_LIMIT, high=INTENSITY_LIMIT)
    return {'intensity': intensity, 'upper': upper, 'bottom': bottom}


def _slim(*, slim):
    keys = ('intensity', 'x', 'y', 'width', 'height', 'rotation')
    if not isinstance(slim, dict) or set(slim) != set(keys):
        raise ValueError('manual body slim requires exactly intensity, x, y, width, height and rotation')
    limits = {'intensity': (-INTENSITY_LIMIT, INTENSITY_LIMIT), 'x': (0, 1), 'y': (0, 1),
              'width': (MIN_BAND, 1), 'height': (MIN_BAND, 1), 'rotation': (-180, 180)}
    return {key: _number(value=slim[key], label=f'slim.{key}', low=limits[key][0], high=limits[key][1])
            for key in keys}


def _zoom(*, zoom):
    keys = ('intensity', 'x', 'y', 'radius')
    if not isinstance(zoom, dict) or set(zoom) != set(keys):
        raise ValueError('manual body zoom requires exactly intensity, x, y and radius')
    limits = {'intensity': (-INTENSITY_LIMIT, INTENSITY_LIMIT), 'x': (0, 1), 'y': (0, 1), 'radius': (0.01, 0.5)}
    return {key: _number(value=zoom[key], label=f'zoom.{key}', low=limits[key][0], high=limits[key][1])
            for key in keys}


def validate_manual_body(*, manual_body):
    """The settings this renderer accepts, with every field checked."""
    if not isinstance(manual_body, dict) or not manual_body or not set(manual_body) <= set(TOOLS):
        raise ValueError(f'manual body must set at least one of {", ".join(TOOLS)}')
    settings = {}
    if 'stretch' in manual_body:
        settings['stretch'] = _stretch(stretch=manual_body['stretch'])
    if 'slim' in manual_body:
        settings['slim'] = _slim(slim=manual_body['slim'])
    if 'zoom' in manual_body:
        settings['zoom'] = _zoom(zoom=manual_body['zoom'])
    return settings


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


def load_slim_field(*, path=SLIM_FIELD):
    """The slim table: inward motion in half-widths at full intensity, by |v| row and |u| column."""
    data = json.loads(path.read_text())
    table = np.asarray(data['inward'], np.float64)
    step = float(data['step'])
    if table.ndim != 2 or table.shape[0] != table.shape[1] or not math.isclose((table.shape[0] - 1) * step, 1) \
            or not np.all(np.isfinite(table)) or np.any(table < 0) or np.any(table[:, 0] != 0):
        raise ValueError('invalid manual body slim table')
    return table, step


def slim_inward(*, u, v, table, step):
    """Bilinear inward motion at full intensity for source positions (|u|, |v| <= 1)."""
    last = table.shape[0] - 1
    au = np.clip(np.abs(u), 0, 1) / step
    av = np.clip(np.abs(v), 0, 1) / step
    column = np.minimum(np.floor(au).astype(np.intp), last - 1)
    row = np.minimum(np.floor(av).astype(np.intp), last - 1)
    fu, fv = au - column, av - row
    top = table[row, column] * (1 - fu) + table[row, column + 1] * fu
    below = table[row + 1, column] * (1 - fu) + table[row + 1, column + 1] * fu
    return top * (1 - fv) + below * fv


def slim_source_points(*, width, height, intensity, x, y, rect_width, rect_height, rotation, table, step):
    """Output pixels inside the rectangle and the continuous source point each samples."""
    amount = intensity / 100
    angle = math.radians(rotation)
    # The rectangle's axes in top-down pixels; its height axis' sign does not matter.
    axis_u = np.array([math.cos(angle), math.sin(angle)])
    axis_v = np.array([-math.sin(angle), math.cos(angle)])
    centre = np.array([x * width, (1 - y) * height])
    half_u, half_v = rect_width / 2 * width, rect_height / 2 * height
    corners = np.array([centre + su * half_u * axis_u + sv * half_v * axis_v for su in (-1, 1) for sv in (-1, 1)])
    left, top = np.floor(corners.min(axis=0)).astype(int)
    right, bottom = np.ceil(corners.max(axis=0)).astype(int)
    left, top = max(left, 0), max(top, 0)
    right, bottom = min(right, width), min(bottom, height)
    if right <= left or bottom <= top or amount == 0:
        return np.empty(0, np.intp), np.empty(0, np.intp), np.empty((0, 2))
    rows, columns = np.mgrid[top:bottom, left:right]
    offset = np.stack([columns + 0.5 - centre[0], rows + 0.5 - centre[1]], axis=-1)
    u_out = offset @ axis_u / half_u
    v = offset @ axis_v / half_v
    inside = (np.abs(u_out) < 1) & (np.abs(v) < 1)
    u_out, v = u_out[inside], v[inside]
    # The field moves source points: u_out = u_source - amount * sign * inward. Invert it by
    # fixed-point steps; the motion's slope stays far below one, so they converge.
    u_source = u_out.copy()
    for _ in range(12):
        u_source = u_out + amount * np.sign(u_source) * slim_inward(u=u_source, v=v, table=table, step=step)
    points = centre + np.outer(u_source * half_u, axis_u) + np.outer(v * half_v, axis_v)
    return rows[inside], columns[inside], points


def sample_bilinear(*, rgba, points):
    """RGBA at continuous (x, y) pixel points (pixel centres at +0.5), clamped at the edges."""
    height, width = rgba.shape[:2]
    position_x = np.clip(points[:, 0] - 0.5, 0, width - 1)
    position_y = np.clip(points[:, 1] - 0.5, 0, height - 1)
    x0 = np.floor(position_x).astype(np.intp)
    y0 = np.floor(position_y).astype(np.intp)
    x1, y1 = np.minimum(x0 + 1, width - 1), np.minimum(y0 + 1, height - 1)
    fx, fy = (position_x - x0)[:, None], (position_y - y0)[:, None]
    source = rgba.astype(np.float64)
    top = source[y0, x0] * (1 - fx) + source[y0, x1] * fx
    below = source[y1, x0] * (1 - fx) + source[y1, x1] * fx
    return np.clip(np.rint(top * (1 - fy) + below * fy), 0, 255).astype(np.uint8)


def apply_slim(*, rgba, intensity, x, y, width, height, rotation, table=None, step=None):
    """The slim rectangle's horizontal pull; pixels outside it keep the photo."""
    if table is None:
        table, step = load_slim_field()
    rows, columns, points = slim_source_points(
        width=rgba.shape[1], height=rgba.shape[0], intensity=intensity, x=x, y=y,
        rect_width=width, rect_height=height, rotation=rotation, table=table, step=step)
    result = rgba.copy()
    if len(rows):
        result[rows, columns] = sample_bilinear(rgba=rgba, points=points)
    return result


def zoom_motion(*, radius, amount):
    """Outward radial motion before finite-grid interpolation."""
    clipped = np.clip(np.asarray(radius, np.float32), 0, 1)
    scale = np.float32(amount) * np.float32(.4 if amount > 0 else .25)
    return scale * (clipped * radial_weight(radius=clipped, positive=amount > 0))


def apply_zoom(*, rgba, intensity, x, y, radius, runtime=None):
    if intensity == 0:
        return rgba.copy()
    runtime = Path(__file__).resolve().parents[1] / 'runtime' if runtime is None else runtime
    vertices, triangles = make_zoom_mesh(width=rgba.shape[1], height=rgba.shape[0],
                                         intensity=intensity, x=x, y=y, radius=radius)
    result, _ = draw_mesh(rgba=rgba, vertices=vertices, triangles=triangles, runtime=runtime,
                          precision='float', mesh_profile='manual-zoom')
    # The scene composites uncovered mesh pixels over the unchanged source.
    uncovered = result[..., 3] == 0
    result[uncovered] = rgba[uncovered]
    return result


def run(*, rgba, manual_body, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > source_edge_limit() or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque manual-body photo required')
    settings = validate_manual_body(manual_body=manual_body)
    result = rgba
    if 'stretch' in settings:
        result = apply_stretch(rgba=result, **settings['stretch'])
    if 'slim' in settings:
        result = apply_slim(rgba=result, **settings['slim'])
    if 'zoom' in settings:
        result = apply_zoom(rgba=result, runtime=runtime, **settings['zoom'])
    if result is rgba:
        result = rgba.copy()
    independence = process_images()
    receipt = {'scope': 'original-photo-manual-body-PNG', 'tools': sorted(settings), 'manualBody': settings,
               'width': rgba.shape[1], 'height': rgba.shape[0],
               **({'stretchEdgePixels': stretch_edge_pixels(height=rgba.shape[0], **settings['stretch'])}
                  if 'stretch' in settings else {}),
               'independence': independence, 'privateAssetDependency': False,
               'fixedLandmarks': False, 'nativeGeometryUsed': False, 'nativeProductParityVerified': False,
               **({'zoomGeometry': 'finite-grid-250', 'zoomSampling': 'float'} if 'zoom' in settings else {}),
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
