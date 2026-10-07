"""Extract pinned local 248-point blush and contour templates without publishing assets."""
import argparse
import hashlib
from pathlib import Path
import re
import struct

import numpy as np

from lip_assets import float_property
from liquefy_assets import content_digest

CARDS={
    'blush-baby-pink':{
        'package':'7406180986888654120/9591fdbc8cdd0806e91ffd334bdd5f7b',
        'prefabSha256':'37ac27f799ab49aa5f9677fb43267c15998d7149b2af9b677753600b52b3518f',
        'mesh':'mesh/blusher_faceu_mesh.mesh','meshSha256':'c4a9032cee7ef536aedc0aee7c10ff3020b47c53f867a018e7b38c0211690d2d',
        'material':'material/Blusher_MATERIAL.material','materialSha256':'5ffa96b9f59f9b3661817a3d10bdbe629e1a418de8b916fa415a576924827ce4',
        'defines':(b'AMAZING_USE_REFLECT',b'AMAZING_USE_BLENDMODE_NORMAL_FORREFLECT',b'AMAZING_USE_SUCAI',b'AMAZING_USE_BLENDMODE_MUTIPLAY'),
        'layers':({'path':'image/blusher/blusher.png','mode':'multiply','sha256':'fd8a1559f951d5347e89ad8b401164f67c7585eb7b9a60f893ddccbde7034ca6'},
                  {'path':'image/blusher/highlight.png','mode':'normal','sha256':'1cb846c3b8d24fd6e7f2d6b2d63fb96cbc21aa41cf68403a140c124ce3eb75dd'}),
        'contentSha256':'cb7a950700226494cbf7a1dccc5aeedbb068cf1193af6eb82771a50bccb94c06',
    },
    'contour-mixed':{
        'package':'7406181489412427060/6fe23753b9c46a79b6f617c054a3608e',
        'prefabSha256':'28de7130ac8b2159af2661864a757489eff76468dd001977d0c6445815f44c42',
        'mesh':'mesh/stereo_faceu_mesh.mesh','meshSha256':'e0788d6136216a8bb86ab8c429873fc7e071a636c1db14e1a58395930acf0aa8',
        'material':'material/Stereo_MATERIAL.material','materialSha256':'4562c281136130121b1471b3822fb76568f876ed330905efb90858ea43695910',
        'defines':(b'AMAZING_USE_SUCAI',b'AMAZING_USE_BLENDMODE_SOFTLIGHT'),
        'layers':({'path':'image/stereo/stereo.png','mode':'soft-light','sha256':'0840dd3b3a98f19a6adea11ed1e2f00727b9c4450cea9356b923d54c177439ff'},),
        'contentSha256':'cb7a950700226494cbf7a1dccc5aeedbb068cf1193af6eb82771a50bccb94c06',
    },
}


def card_spec(*, card):
    if card not in CARDS:
        raise ValueError('pinned 248-point makeup card required')
    return CARDS[card]


def validate_assets(*, card, values):
    spec=card_spec(card=card)
    if set(values)!={'uv','triangles','texture_transform','position_scale'} or content_digest(values=values)!=spec['contentSha256']:
        raise ValueError('private makeup template identity mismatch')
    for value in values.values():
        value.setflags(write=False)
    return values


def extract(*, runtime, card):
    spec=card_spec(card=card)
    root=runtime/'Cache/effect'/spec['package']
    files=((spec['mesh'],spec['meshSha256']),(spec['material'],spec['materialSha256']),('makeup.prefab',spec['prefabSha256']),
           *((layer['path'],layer['sha256']) for layer in spec['layers']))
    for relative,expected in files:
        if hashlib.sha256((root/relative).read_bytes()).hexdigest()!=expected:
            raise ValueError('pinned local makeup resource required')
    mesh=(root/spec['mesh']).read_bytes()
    tag=bytes.fromhex('6e587acf18000000')+struct.pack('<I',9920)
    if mesh.count(tag)!=1:
        raise ValueError('unique four-component face template required')
    vertices=np.frombuffer(mesh,'<f4',count=9920,offset=mesh.index(tag)+12).reshape(2480,4)
    tag=bytes.fromhex('5f2c286b16000000')+struct.pack('<I',1113)
    arrays=[np.frombuffer(mesh,'<u2',count=1113,offset=match.start()+12).copy() for match in re.finditer(re.escape(tag),mesh)]
    if len(arrays)!=10 or any(not np.array_equal(arrays[i],arrays[0]+i*248) for i in range(10)):
        raise ValueError('ten equivalent face submeshes required')
    if any(not np.array_equal(vertices[:248,2:],vertices[i*248:(i+1)*248,2:]) for i in range(10)):
        raise ValueError('makeup UV differs between face slots')
    material=(root/spec['material']).read_bytes()
    if tuple(re.findall(rb'AMAZING_USE_[A-Z_]+|USE_SEG',material))!=spec['defines']:
        raise ValueError('unverified makeup material variant')
    values={'uv':vertices[:248,2:].copy(),'triangles':arrays[0].reshape(371,3),
        'texture_transform':float_property(data=material,name='uSTMatrix',count=16).reshape(4,4).T.copy(),
        'position_scale':np.ones(2,np.float32)}
    return validate_assets(card=card,values=values)


def load_assets(*, path, card):
    if path.stat().st_size>8192:
        raise ValueError('bounded private makeup template required')
    with np.load(path,allow_pickle=False) as archive:
        return validate_assets(card=card,values={key:archive[key].copy() for key in archive.files})


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime',type=Path,default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--card',choices=tuple(CARDS),required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists() or args.output.suffix!='.npz' or not args.output.resolve().is_relative_to(args.runtime.resolve()):
        parser.error('fresh private .npz under runtime/ required')
    np.savez(args.output,**extract(runtime=args.runtime,card=args.card))
