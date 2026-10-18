"""Pinned private model policy and owned type-2 video face acceptance math."""
import hashlib
import json
from pathlib import Path

import numpy as np

POLICY_FILENAME = 'body-face-video-policy-v1.json'
POLICY_SHA256 = 'b5b9905399fac944db0ac036260fe6916b84a314f6eb69eec5555c2358b0a91b'


class RejectedVideoFace(ValueError):
    """The video classifier rejected a face; its points cannot be consumed."""

    def __init__(self, message, *, details=None):
        super().__init__(message)
        self.details = details or {}


def step_accepts(*, score, visible_count, thresholds, minimum_visible):
    for index, (threshold, minimum) in enumerate(zip(thresholds, minimum_visible, strict=True)):
        in_band = score > threshold and (index == 0 or score < thresholds[index - 1])
        if in_band and visible_count < minimum:
            return False
    return True


def validate_model_policy(*, policy):
    if not isinstance(policy, dict) or set(policy) != {'threshold', 'tables'}:
        raise ValueError('explicit video threshold and tables required')
    threshold = policy['threshold']
    if type(threshold) not in (int, float) or not np.isfinite(threshold) or not 0 < threshold < 1:
        raise ValueError('bounded video visibility threshold required')
    tables = policy['tables']
    if not isinstance(tables, list) or len(tables) != 4:
        raise ValueError('four classifier table pairs required')
    for pair in tables:
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError('probability and visibility table pair required')
        thresholds, minimum = pair
        if (not isinstance(thresholds, list) or not isinstance(minimum, list)
                or not 1 <= len(thresholds) == len(minimum) <= 16
                or any(type(v) not in (int, float) or not np.isfinite(v) or not 0 <= v <= 1
                       for v in thresholds)
                or any(type(v) not in (int, float) or not np.isfinite(v) or not 0 <= v <= 106
                       for v in minimum)
                or any(a <= b for a, b in zip(thresholds, thresholds[1:]))):
            raise ValueError('bounded descending probability bands required')
    return policy


def evaluate_video_face(*, heads, policy, relaxed=False):
    validate_model_policy(policy=policy)
    if type(relaxed) is not bool:
        raise ValueError('explicit video visibility relaxation required')
    probabilities = np.asarray(heads['prob'], np.float32).reshape(-1)
    visible = np.asarray(heads['fc_visible'], np.float32).reshape(-1)
    if (probabilities.shape not in ((3,), (5,)) or visible.shape != (106,)
            or not np.isfinite(probabilities).all() or not np.isfinite(visible).all()
            or (probabilities < 0).any() or (probabilities > 1).any()
            or (visible < 0).any() or (visible > 1).any()):
        raise ValueError('finite classification probabilities and 106 visibility values required')
    threshold = np.float32(policy['threshold'])
    if relaxed:
        threshold = np.float32(float(threshold) * .8)
    count = int(np.count_nonzero(visible > threshold))
    combined = probabilities[0]
    for extra in probabilities[3:]:
        combined = np.float32(combined + extra)
    scores = (combined, probabilities[1], probabilities[2])
    tables = [(np.asarray(pair[0], np.float32), np.asarray(pair[1], np.float32))
              for pair in policy['tables']]
    steps = all(step_accepts(score=score, visible_count=count, thresholds=table[0],
                             minimum_visible=table[1]) for score, table in zip(scores, tables[:3], strict=True))
    below_all_bands = all(score < table[0][-1] for score, table in zip(scores, tables[:3], strict=True))
    accepted = steps and not (below_all_bands and count < tables[3][1][0])
    return {'accepted': bool(accepted), 'visibleCount': count, 'visibilityThreshold': float(threshold),
            'scores': [float(value) for value in scores], 'relaxed': relaxed}


class VideoFacePolicy:
    def __init__(self, *, runtime):
        path = Path(runtime) / 'research' / POLICY_FILENAME
        if not path.is_file():
            raise ValueError(f'explicit body video requires private policy asset: {POLICY_FILENAME}')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != POLICY_SHA256:
            raise ValueError('unsupported private body video face policy identity')
        value = json.loads(raw)
        if (set(value) != {'schemaVersion', 'profile', 'models', 'provenance'}
                or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1
                or value['profile'] != 'single-person-body-video-type2'
                or set(value['models']) != {'120', '160'}):
            raise ValueError('supported body video face policy schema required')
        self.models = {int(size): validate_model_policy(policy=policy) for size, policy in value['models'].items()}

    def validate(self, *, heads, size, relaxed=False):
        if type(size) is not int or size not in self.models:
            raise ValueError('typed 120/160 video policy profile required')
        result = evaluate_video_face(heads=heads, policy=self.models[size], relaxed=relaxed)
        if not result['accepted']:
            raise RejectedVideoFace(f'video candidate rejected: {result}', details=result)
        return result
