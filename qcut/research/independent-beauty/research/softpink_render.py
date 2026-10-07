"""Original opaque photo to an independently placed soft-pink lip PNG."""
import argparse
from pathlib import Path

from facefitting_image import decode_image
from lip_assets import load_assets as load_geometry
from makeup_geometry import working_mesh
from makeup_photo import render_photo
from softpink_assets import CARD, card_spec, load_assets
from mouth_state import mouth_texture


def resolve_spec(*, positions, spec):
    selection = mouth_texture(positions=positions)
    state = selection['textureState']
    texture = spec['mouthTextures'][state]
    layer = {**spec['layers'][0], **texture}
    return {**spec, 'layers': (layer,)}, selection


def geometry(*, points, runtime):
    return working_mesh(points=points, assets=load_geometry(path=runtime/'research/lip-v1.npz'))


def run(*, rgba, card, strength, runtime, output, report):
    return render_photo(rgba=rgba, card=card, strength=strength, runtime=runtime,
        output=output, report=report, spec=card_spec(card=card), scope='original-photo-soft-pink-mouth64-independent-PNG',
        geometry=geometry, asset_loader=load_assets, spec_resolver=resolve_spec)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--card', choices=(CARD,), default=CARD)
    parser.add_argument('--strength', type=float, default=.8)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct soft-pink PNG and receipt paths required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], card=args.card, strength=args.strength,
        runtime=args.runtime, output=args.output, report=args.report)
