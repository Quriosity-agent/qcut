"""Render an explicit ordered PNG sequence without dropping undetected body frames."""
import argparse
import json
import os
from pathlib import Path

from PIL import Image

from body_composition.controls import validate_controls
from body_smart_sequence import BodySmartSequence
from facefitting_image import decode_image
from independent_pipeline import parse_json


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
        if not isinstance(row, dict) or set(row) != {'image', 'timestampSeconds', 'controls'}:
            raise ValueError('each frame requires image, timestampSeconds and controls')
        if not isinstance(row['image'], str) or not Path(row['image']).is_absolute():
            raise ValueError('absolute input image paths required')
        validate_controls(controls=row['controls'])
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    sequence = BodySmartSequence(runtime=runtime)
    receipts = []
    for index, row in enumerate(rows):
        rgba = decode_image(image=Path(row['image']), max_edge=4096)['rgba']
        result, receipt = sequence.process(rgba=rgba, controls=row['controls'], stream=data['stream'],
                                           frame=index, timestamp=row['timestampSeconds'])
        name = f'frame-{index:06d}.png'
        Image.fromarray(result).save(output / name)
        receipt.update(output=name, source=row['image'])
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
