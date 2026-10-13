"""Immutable same-photo identity association; current landmarks are always recomputed."""
from dataclasses import dataclass, replace
import hashlib
import json
from pathlib import Path
import re

import numpy as np


POLICY = 'same-photo-original-106-envelope-v1'
ACCEPTANCE_POLICY = 'research-seed-and-120-prob0<=0.5'
MAX_NORMALIZED_MEDIAN_DISPLACEMENT = .25
MAX_REFERENCE_BYTES = 32 * 1024
ORIGINAL_SCOPES = {'original-photo-independent-face-and-features-one-mesh',
                   'original-photo-independent-shared-local-package'}


def rgba_hash(*, rgba):
    return hashlib.sha256(rgba.tobytes()).hexdigest()


def validated_points(*, value, width, height):
    points = np.asarray(value)
    if (points.shape != (106, 2) or points.dtype.kind not in 'fi'
            or not np.all(np.isfinite(points)) or np.any(points < 0)
            or np.any(points > np.array([width, height]))):
        raise ValueError('finite in-frame 106 identity points required')
    points = points.astype(np.float64)
    if np.any(np.ptp(points, axis=0) <= 0):
        raise ValueError('non-degenerate identity point envelope required')
    return points


@dataclass(frozen=True)
class FaceSelectionReference:
    source_sha256: str
    input_sha256: str
    width: int
    height: int
    points: tuple

    def __post_init__(self):
        if any(not isinstance(value, str) or re.fullmatch('[0-9a-f]{64}', value) is None
               for value in (self.source_sha256, self.input_sha256)):
            raise ValueError('source and stage RGBA SHA256 identity required')
        if any(type(value) is not int or not 1 <= value <= 4096 for value in (self.width, self.height)):
            raise ValueError('bounded identity reference dimensions required')
        points = validated_points(value=self.points, width=self.width, height=self.height)
        object.__setattr__(self, 'points', tuple(tuple(float(value) for value in row) for row in points))

    def as_dict(self):
        return {'version': 1, 'policy': POLICY, 'sourceRgbaSha256': self.source_sha256,
                'inputRgbaSha256': self.input_sha256, 'width': self.width, 'height': self.height,
                'points': self.points}


def original_face_receipts(*, receipt):
    if not isinstance(receipt, dict):
        raise ValueError('original face alignment receipt required')
    if receipt.get('scope') != 'original-photo-independent-face-then-local-packages':
        return [receipt]
    packages = receipt.get('packageReceipts')
    if not isinstance(packages, dict) or not any(key in packages for key in ('face', 'features')):
        raise ValueError('original face package receipts required')
    return [packages[key] for key in ('face', 'features') if key in packages]


def verified_no_effect_receipt(*, receipt, source_sha256, width, height):
    counts = ('predictionCount', 'meshPassCount', 'changedPixelCount')
    size = receipt.get('decodedSize')
    return (receipt.get('zeroControlsIdentity') is True
            and all(type(receipt.get(key)) is int and receipt[key] == 0 for key in counts)
            and 'alignment' in receipt and receipt['alignment'] is None
            and isinstance(size, list) and size == [width, height] and all(type(value) is int for value in size)
            and receipt.get('outputRgbaSha256') == source_sha256)


def reference_from_receipt(*, receipt, source_sha256, width, height, source_manifest_sha256=None):
    # Only a verified no-effect package can yield to another original-input prediction.
    for original in original_face_receipts(receipt=receipt):
        if not isinstance(original, dict):
            raise ValueError('original face alignment receipt required')
        if original.get('inputRgbaSha256') != source_sha256:
            raise ValueError('face identity must originate from the unprocessed input')
        if original.get('scope') not in ORIGINAL_SCOPES or original.get('fixedLandmarks') is not False:
            raise ValueError('original strict single-face alignment receipt required')
        if verified_no_effect_receipt(receipt=original, source_sha256=source_sha256, width=width, height=height):
            continue
        alignment = original.get('alignment')
        from source_face_confirmation import POLICY as SOURCE_POLICY, confirmed_source_selection
        accepted_policy = (isinstance(alignment, dict) and (alignment.get('acceptance_policy') == ACCEPTANCE_POLICY
            or (alignment.get('acceptance_policy') == SOURCE_POLICY
                and source_manifest_sha256 is not None
                and confirmed_source_selection(alignment=alignment, source_sha256=source_sha256)
                and alignment['source_confirmation']['manifestSha256'] == source_manifest_sha256)))
        if (type(original.get('predictionCount')) is not int or original['predictionCount'] != 1
                or not accepted_policy):
            raise ValueError('original strict single-face alignment receipt required')
        for name in ('seed_prob', 'prob'):
            probability = alignment.get(name)
            if (not isinstance(probability, list) or not probability or type(probability[0]) not in (int, float)
                    or not np.isfinite(probability[0]) or not 0 <= probability[0] <= .5):
                raise ValueError('accepted original face classification probabilities required')
        return FaceSelectionReference(source_sha256=source_sha256, input_sha256=source_sha256,
                                      width=width, height=height, points=alignment.get('points'))
    return None


def bind_reference(*, reference, rgba, source_sha256):
    if not isinstance(reference, FaceSelectionReference) or reference.source_sha256 != source_sha256:
        raise ValueError('face identity reference belongs to a different source')
    if rgba.shape != (reference.height, reference.width, 4):
        raise ValueError('face identity reference dimensions do not match the stage')
    return replace(reference, input_sha256=rgba_hash(rgba=rgba))


def validate_reference_input(*, reference, rgba):
    if (not isinstance(reference, FaceSelectionReference)
            or rgba.shape != (reference.height, reference.width, 4)
            or rgba_hash(rgba=rgba) != reference.input_sha256):
        raise ValueError('face identity reference does not match the stage RGBA')


def read_reference(*, path):
    path = Path(path)
    if not path.is_file() or path.stat().st_size > MAX_REFERENCE_BYTES:
        raise ValueError('bounded face identity reference JSON required')
    from independent_pipeline import read_json
    value = read_json(path=path, limit=MAX_REFERENCE_BYTES)
    if (not isinstance(value, dict)
            or set(value) != {'version', 'policy', 'sourceRgbaSha256', 'inputRgbaSha256', 'width', 'height', 'points'}
            or type(value['version']) is not int or value['version'] != 1 or value['policy'] != POLICY):
        raise ValueError('unsupported face identity reference')
    return FaceSelectionReference(source_sha256=value['sourceRgbaSha256'], input_sha256=value['inputRgbaSha256'],
                                  width=value['width'], height=value['height'], points=value['points'])


def write_reference(*, reference, path):
    Path(path).write_text(json.dumps(reference.as_dict(), allow_nan=False) + '\n')


def candidate_association(*, reference, prediction):
    anchor = np.asarray(reference.points)
    current = validated_points(value=prediction.get('points'), width=reference.width, height=reference.height)
    anchor_min, anchor_max = anchor.min(axis=0), anchor.max(axis=0)
    current_min, current_max = current.min(axis=0), current.max(axis=0)
    anchor_center, current_center = (anchor_min + anchor_max) / 2, (current_min + current_max) / 2
    mutual_centers = bool(np.all((anchor_center >= current_min) & (anchor_center <= current_max))
                          and np.all((current_center >= anchor_min) & (current_center <= anchor_max)))
    # A quarter-envelope bound is deliberately conservative: large/ambiguous warps fail closed.
    scale = np.minimum(anchor_max - anchor_min, current_max - current_min)
    displacement = float(np.median(np.linalg.norm((current - anchor) / scale, axis=1)))
    return {'matches': mutual_centers and displacement <= MAX_NORMALIZED_MEDIAN_DISPLACEMENT,
            'mutualEnvelopeCenters': mutual_centers, 'normalizedMedianDisplacement': displacement,
            'envelope': [current_min.tolist(), current_max.tolist()]}


def associate_predictions(*, reference, predictions):
    diagnostics = [candidate_association(reference=reference, prediction=prediction) for prediction in predictions]
    matches = [index for index, row in enumerate(diagnostics) if row['matches']]
    receipt = {'policy': POLICY, 'sourceRgbaSha256': reference.source_sha256,
               'inputRgbaSha256': reference.input_sha256, 'acceptedCandidateCount': len(predictions),
               'matchedCandidateCount': len(matches), 'unmatchedCandidateCount': len(predictions) - len(matches),
               'maxNormalizedMedianDisplacement': MAX_NORMALIZED_MEDIAN_DISPLACEMENT,
               'candidates': diagnostics, 'referenceCoordinatesUsedForRendering': False}
    if len(matches) != 1:
        raise ValueError(f'same-photo identity requires exactly one matching face; found {len(matches)}; '
                         f'association={json.dumps(receipt, allow_nan=False)}')
    return {**predictions[matches[0]], 'face_selection': receipt}
