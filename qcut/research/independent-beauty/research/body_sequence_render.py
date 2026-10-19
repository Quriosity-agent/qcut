"""Render ordered PNG frames with explicit percentage baselines and native events.

Each frame's controls is its own baseline; reset_params does not implicitly
clear later frames. Optional control_events apply in order within that frame,
and set_control values use the same public percentages as controls.
Optional segmentation_mask is an absolute path to a single-channel 8-bit PNG.
Omitted/null masks retain the last mask, including across native warm resets.
"""
import argparse
import json
import math
import os
from pathlib import Path

from PIL import Image
import numpy as np

from body_composition.segmentation_mask import validate_mask_size, validate_segmentation_mask
from body_control_events import resolve_control_events
from body_smart_sequence import BodySmartSequence
from facefitting_image import decode_image
from independent_pipeline import parse_json


def validate_frame(*, row):
    required = {'image', 'timestampSeconds', 'controls'}
    if (not isinstance(row, dict) or not required <= set(row)
            or set(row) - required - {'control_events', 'segmentation_mask'}):
        raise ValueError('each frame requires image, timestampSeconds and controls; optional control_events and segmentation_mask')
    if not isinstance(row['image'], str) or not Path(row['image']).is_absolute():
        raise ValueError('absolute input image paths required')
    timestamp = row['timestampSeconds']
    if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp) or timestamp < 0:
        raise ValueError('finite nonnegative frame timestamp required')
    resolve_control_events(controls=row['controls'], control_events=row.get('control_events', ()))
    validate_mask_path(path=row.get('segmentation_mask'))


def read_mask_file(*, path, decode):
    if path is None:
        return
    if not isinstance(path, str) or not Path(path).is_absolute():
        raise ValueError('segmentation_mask requires an absolute PNG path or null')
    try:
        with Image.open(path) as mask:
            if mask.format != 'PNG' or mask.mode != 'L' or getattr(mask, 'n_frames', 1) != 1:
                raise ValueError('segmentation_mask must be a single-frame 8-bit grayscale L PNG')
            validate_mask_size(width=mask.width, height=mask.height)
            if decode:
                return validate_segmentation_mask(mask=np.asarray(mask))
    except (OSError, Image.DecompressionBombError) as error:
        raise ValueError('segmentation_mask PNG could not be opened') from error


def validate_mask_path(*, path):
    read_mask_file(path=path, decode=False)


def load_segmentation_mask(*, path):
    return read_mask_file(path=path, decode=True)


def render_sequence(*, manifest, runtime, output):
    data = parse_json(data=Path(manifest).read_bytes())
    if not isinstance(data, dict) or set(data) != {'stream', 'frames'}:
        raise ValueError('sequence manifest requires stream and frames')
    if not isinstance(data['stream'], str) or not 1 <= len(data['stream']) <= 256:
        raise ValueError('bounded stream identity required')
    rows = data['frames']
    if not isinstance(rows, list) or not 1 <= len(rows) <= 300:
        raise ValueError('one to 300 explicit sequence frames required')
    for row in rows:
        validate_frame(row=row)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    sequence = BodySmartSequence(runtime=runtime)
    receipts = []
    for index, row in enumerate(rows):
        rgba = decode_image(image=Path(row['image']), max_edge=4096)['rgba']
        segmentation_mask = load_segmentation_mask(path=row.get('segmentation_mask'))
        result, receipt = sequence.process(rgba=rgba, controls=row['controls'], stream=data['stream'],
                                           frame=index, timestamp=row['timestampSeconds'],
                                           control_events=row.get('control_events', ()),
                                           segmentation_mask=segmentation_mask)
        name = f'frame-{index:06d}.png'
        Image.fromarray(result).save(output / name)
        receipt.update(output=name, source=row['image'])
        if 'segmentation_mask' in row:
            receipt['segmentationMaskSource'] = row['segmentation_mask']
        (output / f'frame-{index:06d}.json').write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
        receipts.append(receipt)
    report = {'scope': 'explicit-offline-single-person-body-sequence',
              'inputFrames': len(rows), 'outputFrames': len(receipts),
              'frameDropCount': 0, 'nativeProductParityVerified': False,
              'editorTimelineIntegrated': False, 'frames': receipts}
    (output / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.environ['BEAUTY_RENDER_RESOLUTION'] = 'original'
    report = render_sequence(manifest=args.manifest, runtime=args.runtime, output=args.output)
    print(json.dumps({'output': str(args.output.resolve()), 'inputFrames': report['inputFrames'],
                      'outputFrames': report['outputFrames'], 'nativeProductParityVerified': False}))


if __name__ == '__main__':
    main()
