"""One local package prediction, ordered packed coordinate passes and one photo sample."""
import hashlib
from pathlib import Path

import numpy as np

from facefitting_infer import native_images
from liquefy_assets import load_assets
from liquefy_mesh import generate_support
from liquefy_metal import render_passes
from liquefy_render import MASKS, active_controls, build_control_pass, validate_controls
from slimface_detection import single_face_prediction
from slimface_render import validate_rgba

PASS_ORDER = ('cheekbone', 'mid_atrium', 'lower_atrium', 'pointy_chin', 'underjaw', 'upper_atrium')


def render_rgba(*, rgba, controls, runtime):
    controls = validate_controls(values=controls)
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque local package photo required')
    runtime = Path(runtime).resolve()
    active = set(active_controls(controls=controls))
    order = [name for name in PASS_ORDER if name in active]
    prediction, gpu = None, None
    result = rgba.copy()
    if order:
        from worker import MODELS
        if MODELS.resolve() != (runtime / 'research').resolve():
            raise ValueError('local package runtime must match the configured face model directory')
        prediction = single_face_prediction(rgba=rgba)
        points = np.asarray(prediction['normalized_points'], np.float32)
        yaw = np.float32(-np.float32(prediction['yaw']) * np.float32(np.pi / 180))
        assets = load_assets(path=runtime / 'research/liquefy-v1.npz')
        support = generate_support(points=points, yaw_radians=yaw, assets=assets)
        mean_uv = generate_support(points=assets['mean_points'], yaw_radians=0, assets=assets)['uv'] if active & set(MASKS) else None
        passes = [build_control_pass(rgba=rgba, control=name, value=controls[name], points=points,
            yaw_radians=yaw, assets=assets, runtime=runtime, support=support, mean_uv=mean_uv) for name in order]
        result, gpu = render_passes(rgba=rgba, passes=passes, runtime=runtime)
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent local package renderer loaded private effect libraries')
    receipt = {'scope': 'original-photo-independent-shared-local-package', 'controls': controls,
        'decodedSize': [rgba.shape[1], rgba.shape[0]], 'alignment': prediction, 'gpu': gpu,
        'independence': independence, 'privateAssetDependency': bool(order),
        'nativePixelsUsed': False, 'nativeGeometryUsed': False, 'nativeFallbackUsed': False, 'fixedLandmarks': False,
        'nativeProductParityVerified': False, 'predictionCount': int(bool(order)),
        'sharedLocalPredictionCount': int(bool(order)), 'meshPassCount': len(order), 'passOrder': order,
        'photoSamplePassCount': int(bool(order)),
        'rendererSourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
        'zeroControlsIdentity': bool(not order and np.array_equal(result, rgba)),
        'changedPixelCount': int(np.count_nonzero(np.any(result != rgba, axis=-1)))}
    return result, receipt
