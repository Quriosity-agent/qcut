"""Original opaque photo to independently inferred makeup PNG."""
import argparse
from functools import partial
from pathlib import Path

from facefitting_image import decode_image
from makeup_photo import render_photo
from lip_assets import load_assets as load_geometry
from makeup248_assets import CARDS, card_spec, load_assets
from makeup248_layers import render_layers
from makeup_geometry import working_mesh


def geometry(*, points, runtime):
    return working_mesh(points=points, assets=load_geometry(path=runtime/'research/lip-v1.npz'))


def run(*, rgba, card, strength, runtime, output, report):
    return render_photo(rgba=rgba, card=card, strength=strength, runtime=runtime,
        output=output, report=report, spec=card_spec(card=card),
        scope='original-photo-248-mesh-makeup-PNG', geometry=geometry, asset_loader=load_assets,
        layer_renderer=partial(render_layers, runtime=runtime,
            pass_name='Blusher' if card == 'blush-baby-pink' else 'Stereo'))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',type=Path,required=True)
    parser.add_argument('--card',choices=tuple(CARDS),required=True)
    parser.add_argument('--strength',type=float,default=.8)
    parser.add_argument('--runtime',type=Path,default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve()==args.report.resolve():
        parser.error('fresh distinct PNG and receipt paths required')
    run(rgba=decode_image(image=args.image,max_edge=1280)['rgba'],card=args.card,strength=args.strength,
        runtime=args.runtime,output=args.output,report=args.report)
