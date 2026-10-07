"""Original opaque photo to independently inferred makeup PNG."""
import argparse
from functools import partial
from pathlib import Path

from facefitting_image import decode_image
from makeup_photo import render_photo
from eye_assets import CARDS, card_spec, load_assets
from eye_support import eye_mesh
from eye_metal_layers import render_layers as render_metal


def geometry(*, points, runtime):
    return eye_mesh(points=points)


def run(*, rgba, card, strength, runtime, output, report):
    spec = card_spec(card=card)
    renderer = partial(render_metal, runtime=runtime,
        pass_name='Eyeline' if card.startswith('eyeliner-') else 'Eyemazing')
    return render_photo(rgba=rgba, card=card, strength=strength, runtime=runtime,
        output=output, report=report, spec=spec,
        scope='original-photo-eye174-independent-PNG', geometry=geometry, asset_loader=load_assets,
        layer_renderer=renderer)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--card', choices=tuple(CARDS), required=True)
    parser.add_argument('--strength', type=float, default=.8)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct eye PNG and receipt paths required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], card=args.card, strength=args.strength,
        runtime=args.runtime, output=args.output, report=args.report)
