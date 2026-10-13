"""Bounded bidirectional source evidence for ambiguous single-target face selection."""
import hashlib
import math
from pathlib import Path
import re

import numpy as np

from face_selection_reference import (FaceSelectionReference, MAX_NORMALIZED_MEDIAN_DISPLACEMENT,
                                      candidate_association, original_face_receipts, rgba_hash)


POLICY = 'single-face-bidirectional-v1'
MAX_MANIFEST_BYTES = 64 * 1024
MAX_FRAME_BYTES = 64 * 1024 * 1024
MAX_TIME_DISTANCE = .5


def valid_sha256(*, value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def finite_time(*, value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def read_source_evidence(*, path, rgba):
    from independent_pipeline import parse_json
    path = Path(path)
    if path.name != 'source-evidence.json' or path.is_symlink() or not path.is_file():
        raise ValueError('regular source-evidence.json sidecar required')
    if path.stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError('source evidence manifest exceeds its byte budget')
    data = path.read_bytes()
    manifest = parse_json(data=data, limit=MAX_MANIFEST_BYTES)
    common = {'schemaVersion', 'policy', 'status', 'targetRgbaSha256', 'width', 'height'}
    if (not isinstance(manifest, dict) or type(manifest.get('schemaVersion')) is not int
            or manifest['schemaVersion'] != 1 or manifest.get('policy') != POLICY
            or manifest.get('status') not in ('available', 'unavailable')):
        raise ValueError('unsupported source evidence contract')
    available = manifest['status'] == 'available'
    if set(manifest) != common | ({'targetTimestampSeconds', 'frames'} if available else {'reason'}):
        raise ValueError('unexpected source evidence fields')
    width, height = manifest['width'], manifest['height']
    if (any(type(value) is not int or not 1 <= value <= 4096 for value in (width, height))
            or rgba.shape != (height, width, 4) or rgba.dtype != np.uint8 or np.any(rgba[:, :, 3] != 255)
            or not valid_sha256(value=manifest['targetRgbaSha256'])
            or manifest['targetRgbaSha256'] != rgba_hash(rgba=rgba)):
        raise ValueError('source evidence does not match target RGBA')
    if not available:
        if not isinstance(manifest['reason'], str) or not 1 <= len(manifest['reason']) <= 2048:
            raise ValueError('bounded source evidence unavailable reason required')
        return manifest, hashlib.sha256(data).hexdigest()
    target, frames = manifest['targetTimestampSeconds'], manifest['frames']
    if (not finite_time(value=target) or not isinstance(frames, list) or len(frames) != 4
            or width * height * 4 * 4 > MAX_FRAME_BYTES):
        raise ValueError('four bounded source frames and target timestamp required')
    for index, frame in enumerate(frames):
        if (not isinstance(frame, dict) or set(frame) != {'timestampSeconds', 'rgbaSha256', 'path'}
                or not finite_time(value=frame['timestampSeconds'])
                or abs(frame['timestampSeconds'] - target) > MAX_TIME_DISTANCE
                or not valid_sha256(value=frame['rgbaSha256'])
                or frame['path'] != f'source-evidence-{index}.rgba'):
            raise ValueError('bounded source frame timestamp, hash and owned filename required')
    times = [frame['timestampSeconds'] for frame in frames]
    if not (times[0] < times[1] < target < times[2] < times[3]):
        raise ValueError('two distinct preceding and following source timestamps required')
    return manifest, hashlib.sha256(data).hexdigest()


def evidence_receipt(*, path, rgba):
    manifest, identity = read_source_evidence(path=path, rgba=rgba)
    return {'manifestSha256': identity, 'policy': manifest['policy'], 'status': manifest['status']}


def read_source_frame(*, directory, frame, width, height):
    path = directory / frame['path']
    expected = width * height * 4
    if path.is_symlink() or not path.is_file() or path.stat().st_size != expected:
        raise ValueError('source evidence requires regular, exact-size RGBA files')
    data = path.read_bytes()
    if len(data) != expected or hashlib.sha256(data).hexdigest() != frame['rgbaSha256']:
        raise ValueError('source evidence RGBA hash mismatch')
    rgba = np.frombuffer(data, np.uint8).reshape(height, width, 4)
    if np.any(rgba[:, :, 3] != 255):
        raise ValueError('source evidence requires opaque RGBA frames')
    return rgba


def confirm_candidates(*, predictions, rgba, path):
    from slimface_detection import single_face_prediction
    manifest, identity = read_source_evidence(path=path, rgba=rgba)
    if manifest['status'] != 'available':
        raise ValueError(f'ambiguous face requires bidirectional source evidence: {manifest["reason"]}')
    directory = Path(path).parent
    rows, selected = [], []
    for index, frame in enumerate(manifest['frames']):
        neighbor = read_source_frame(directory=directory, frame=frame, width=manifest['width'], height=manifest['height'])
        # Neighbor selection has no history or reference; zero/multiple accepted faces remain fatal.
        prediction = single_face_prediction(rgba=neighbor)
        anchor = FaceSelectionReference(source_sha256=frame['rgbaSha256'], input_sha256=manifest['targetRgbaSha256'],
            width=manifest['width'], height=manifest['height'], points=prediction['points'])
        associations = [candidate_association(reference=anchor, prediction=current) for current in predictions]
        matches = [candidate for candidate, association in enumerate(associations) if association['matches']]
        if len(matches) != 1:
            raise ValueError(f'source evidence neighbor {index} requires one matching current face; found {len(matches)}')
        selected.append(matches[0])
        rows.append({'timestampSeconds': frame['timestampSeconds'], 'rgbaSha256': frame['rgbaSha256'],
                     'acceptedCandidateCount': 1, 'matchedCurrentCandidateIndex': matches[0], 'candidates': associations})
    if len(set(selected)) != 1:
        raise ValueError('bidirectional source neighbors disagree on the current face')
    if hashlib.sha256(Path(path).read_bytes()).hexdigest() != identity:
        raise ValueError('source evidence manifest changed during confirmation')
    receipt = {'policy': POLICY, 'status': 'confirmed', 'manifestSha256': identity,
               'targetRgbaSha256': manifest['targetRgbaSha256'], 'targetTimestampSeconds': manifest['targetTimestampSeconds'],
               'acceptedCurrentCandidateCount': len(predictions), 'selectedCurrentCandidateIndex': selected[0],
               'neighborCount': 4, 'neighbors': rows, 'referenceCoordinatesUsedForRendering': False,
               'transientSecondPersonVerified': False}
    return {**predictions[selected[0]], 'source_confirmation': receipt}


def confirmed_source_selection(*, alignment, source_sha256):
    confirmation = alignment.get('source_confirmation')
    if not isinstance(confirmation, dict):
        return False
    count, selected = confirmation.get('acceptedCurrentCandidateCount'), confirmation.get('selectedCurrentCandidateIndex')
    neighbors, target = confirmation.get('neighbors'), confirmation.get('targetTimestampSeconds')
    if (confirmation.get('policy') != POLICY or confirmation.get('status') != 'confirmed'
            or confirmation.get('targetRgbaSha256') != source_sha256
            or not valid_sha256(value=confirmation.get('manifestSha256'))
            or type(count) is not int or count <= 1 or type(selected) is not int or not 0 <= selected < count
            or type(confirmation.get('neighborCount')) is not int or confirmation['neighborCount'] != 4
            or not isinstance(neighbors, list) or len(neighbors) != 4 or not finite_time(value=target)
            or confirmation.get('referenceCoordinatesUsedForRendering') is not False
            or confirmation.get('transientSecondPersonVerified') is not False):
        return False
    times = []
    for row in neighbors:
        if (not isinstance(row, dict) or type(row.get('acceptedCandidateCount')) is not int
                or row['acceptedCandidateCount'] != 1 or type(row.get('matchedCurrentCandidateIndex')) is not int
                or row['matchedCurrentCandidateIndex'] != selected or not valid_sha256(value=row.get('rgbaSha256'))
                or not finite_time(value=row.get('timestampSeconds'))
                or abs(row['timestampSeconds'] - target) > MAX_TIME_DISTANCE):
            return False
        candidates = row.get('candidates')
        if not isinstance(candidates, list) or len(candidates) != count:
            return False
        for index, candidate in enumerate(candidates):
            if (not isinstance(candidate, dict) or type(candidate.get('matches')) is not bool
                    or candidate['matches'] is not (index == selected)
                    or type(candidate.get('mutualEnvelopeCenters')) is not bool
                    or not finite_time(value=candidate.get('normalizedMedianDisplacement'))):
                return False
            if candidate['matches'] and (not candidate['mutualEnvelopeCenters']
                    or candidate['normalizedMedianDisplacement'] > MAX_NORMALIZED_MEDIAN_DISPLACEMENT):
                return False
        times.append(row['timestampSeconds'])
    return times[0] < times[1] < target < times[2] < times[3]


def validate_stage_confirmation(*, receipt, source_receipt, source_sha256):
    for original in original_face_receipts(receipt=receipt):
        alignment = original.get('alignment') if isinstance(original, dict) else None
        if not isinstance(alignment, dict) or (alignment.get('acceptance_policy') != POLICY
                                               and 'source_confirmation' not in alignment):
            continue
        if (source_receipt is None or source_receipt['status'] != 'available'
                or original.get('inputRgbaSha256') != source_sha256
                or alignment.get('acceptance_policy') != POLICY
                or not confirmed_source_selection(alignment=alignment, source_sha256=source_sha256)
                or alignment['source_confirmation']['manifestSha256'] != source_receipt['manifestSha256']):
            raise ValueError('stage source confirmation does not match this request evidence')
