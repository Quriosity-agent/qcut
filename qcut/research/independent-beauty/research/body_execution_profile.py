"""Explicit body-video execution selection and checkpoint identity validation."""
import json
import math

WARM_PROFILE = 'bef-cpu-warm-v1'
SWING_PROFILE = 'swing-coreml-v1'
PROFILES = frozenset({WARM_PROFILE, SWING_PROFILE})
MAX_IDENTITY_BYTES = 64 * 1024
MAX_STATE_BYTES = 16 * 1024 * 1024


class BodyExecutionCheckpointError(ValueError):
    """The requested execution cannot resume the checkpoint's recorded history."""


def execution_request(*, execution_profile=None, execution_generation=None):
    profile = WARM_PROFILE if execution_profile is None else execution_profile
    if not isinstance(profile, str) or profile not in PROFILES:
        raise ValueError('unsupported body execution profile')
    if profile == WARM_PROFILE:
        if execution_generation is not None:
            raise ValueError('warm body execution does not take a generation')
        return {'profile': profile}
    generation = execution_generation
    if (not isinstance(generation, str) or not 1 <= len(generation) <= 128
            or any(ord(character) < 33 or ord(character) > 126 for character in generation)):
        raise ValueError('Swing body execution requires a bounded explicit generation')
    return {'profile': profile, 'generation': generation}


def session_execution_request(*, session):
    return execution_request(execution_profile=getattr(session, 'execution_profile', None),
                             execution_generation=getattr(session, 'execution_generation', None))


def _validate_json(*, value):
    if value is None or type(value) in (str, bool, int):
        return
    if type(value) is float and math.isfinite(value):
        return
    if type(value) is list:
        for item in value:
            _validate_json(value=item)
        return
    if type(value) is dict and all(type(key) is str for key in value):
        for item in value.values():
            _validate_json(value=item)
        return
    raise ValueError('body execution metadata requires finite plain JSON values')


def execution_json(*, value, max_bytes=MAX_IDENTITY_BYTES):
    _validate_json(value=value)
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
    if len(encoded) > max_bytes:
        raise ValueError('body execution metadata exceeds its byte budget')
    return encoded


def execution_identity(*, session):
    request = session_execution_request(session=session)
    identity = getattr(session, 'execution_identity', None)
    if not isinstance(identity, dict) or any(identity.get(key) != value for key, value in request.items()):
        raise ValueError('body execution identity does not match its requested profile and generation')
    return json.loads(execution_json(value=identity))
