"""Explicit source-frame budgets shared by independent render subprocesses."""
import os


RESOLUTION_ENV = 'BEAUTY_RENDER_RESOLUTION'
_ENVIRONMENT_MODE = object()


def resolution_mode(*, mode=_ENVIRONMENT_MODE):
    value = os.environ.get(RESOLUTION_ENV, 'preview') if mode is _ENVIRONMENT_MODE else mode
    if type(value) is not str or value not in ('preview', 'original'):
        raise ValueError('resolution must be preview or original')
    return value


def source_edge_limit():
    return 4096 if resolution_mode() == 'original' else 1280


def frame_byte_limit():
    return 64 * 1024**2 if resolution_mode() == 'original' else 16 * 1024**2


def gpu_request_fields():
    return {'resolutionMode': 'original'} if resolution_mode() == 'original' else {}


def verify_gpu_resolution(*, receipt, rgba):
    if resolution_mode() != 'original':
        return
    expected = {'resolutionMode': 'original', 'sourceFrameSize': [rgba.shape[1], rgba.shape[0]],
                'sourceRgbaBytes': rgba.nbytes, 'maxSourceEdge': 4096}
    if any(receipt.get(name) != value for name, value in expected.items()):
        raise ValueError('GPU original-resolution receipt does not match the submitted source frame')
