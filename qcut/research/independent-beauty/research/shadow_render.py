"""Original opaque photo to independent pink eyeshadow PNG."""
import argparse
from pathlib import Path

from eye_render import geometry
from facefitting_image import decode_image
from makeup_photo import render_photo
from shadow_assets import CARD, card_spec, load_assets


def run(*, rgba, card, strength, runtime, output, report):
    return render_photo(rgba=rgba, card=card, strength=strength, runtime=runtime,
        output=output, report=report, spec=card_spec(card=card),
        scope='original-photo-eyeshadow-independent-PNG', geometry=geometry, asset_loader=load_assets)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--card', choices=(CARD,), required=True)
    parser.add_argument('--strength', type=float, default=.8)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct eyeshadow PNG and receipt paths required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], card=args.card, strength=args.strength,
        runtime=args.runtime, output=args.output, report=args.report)
