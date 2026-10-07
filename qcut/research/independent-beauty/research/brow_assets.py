"""Pinned private six-card brow textures and shared 248-point template."""
import argparse
import hashlib
from pathlib import Path
import re
import struct

import numpy as np

from lip_assets import float_property
from liquefy_assets import content_digest

CONTENT_SHA256 = 'da030a3d789318ccf665e18b51eaec382c69d8c617fcb6778e19973deaa5310e'
MESH_SHA256 = 'd6eb1c5a2a70ccf4dca85458ba58229725f8de4dcc76ed49eab64732bd6b9fc4'
MATERIAL_SHA256 = '9ee15b28be2d6822f33dea3c1b3a6774d7e9db3aebf32a8653c8484d1aaa1931'
CARDS = {
    'brows-standard': ('7406180431730707727/1826bb4815f127fb3168b67ed4e0fc71', '6a9e2edc706d73e1cf970065725f9456d7b456442d191794d13f55165eebb58a'),
    'brows-fluffy': ('7406174643247123746/a983387e6a01d830b4c4f9cbc6607628', '043734fcbf992b1f3801f19a04a3d986f6779e52c0690e910ef6fc26699d9ae3'),
    'brows-wild': ('7406181254669929763/2041638b555e988c0b6f13839b112659', '9d5513b484ef9626a396823535dd5773b0655ab27a5a427409c2d7ef2cb29628'),
    'brows-warrior': ('7406174539454909730/8feebde948245fa77c49ead859794fb1', 'd9e2602cb599227bfe501d4b80247833a1b9a0b4d1ecd8b79ee74dd7258dc92d'),
    'brows-classical': ('7406175039264951592/212083cfb14f276308e23a3ee39a9034', '320996123d6a724b66a4fe23cf31eb02b6aded26eb6ae3e88e5051be6c0e4d20'),
    'brows-soft': ('7406174445548719394/ed8ca9399d3ef88ea59931f6f57885a1', '723ded2a0f605f3386d785460f05bc1fb55b3b5a3010383531a719ef8a165298'),
}


def validate_assets(*, values):
    if set(values) != {'uv','triangles','texture_transform'} or content_digest(values=values) != CONTENT_SHA256:
        raise ValueError('private brow geometry identity mismatch')
    for value in values.values():
        value.setflags(write=False)
    return values


def load_assets(*, path):
    if path.stat().st_size > 8192:
        raise ValueError('bounded private brow geometry required')
    with np.load(path,allow_pickle=False) as archive:
        return validate_assets(values={key:archive[key].copy() for key in archive.files})


def extract(*, runtime):
    for package,texture_sha in CARDS.values():
        root=runtime/'Cache/effect'/package
        for relative,expected in (('mesh/brow_faceu_mesh.mesh',MESH_SHA256),('material/Brow.material',MATERIAL_SHA256),
                                  ('image/eyebrow/eyebrow.png',texture_sha)):
            if hashlib.sha256((root/relative).read_bytes()).hexdigest() != expected:
                raise ValueError('six-card shared brow asset identity mismatch')
    root=runtime/'Cache/effect'/CARDS['brows-standard'][0]
    mesh=(root/'mesh/brow_faceu_mesh.mesh').read_bytes()
    vertex_tag=bytes.fromhex('6e587acf18000000')+struct.pack('<I',14880)
    if mesh.count(vertex_tag) != 1:
        raise ValueError('unique six-component brow vertex template required')
    vertices=np.frombuffer(mesh,'<f4',count=14880,offset=mesh.index(vertex_tag)+12).reshape(2480,6)
    index_tag=bytes.fromhex('5f2c286b16000000')+struct.pack('<I',1113)
    arrays=[np.frombuffer(mesh,'<u2',count=1113,offset=match.start()+12).copy()
            for match in re.finditer(re.escape(index_tag),mesh)]
    if len(arrays)!=10 or any(not np.array_equal(arrays[i],arrays[0]+i*248) for i in range(10)):
        raise ValueError('ten equivalent brow face submeshes required')
    if any(not np.array_equal(vertices[:248,4:6],vertices[i*248:(i+1)*248,4:6]) for i in range(10)):
        raise ValueError('brow UV differs between face slots')
    material=(root/'material/Brow.material').read_bytes()
    if re.findall(rb'AMAZING_USE_BLENDMODE_[A-Z]+',material) != [b'AMAZING_USE_BLENDMODE_MULTIPLY']:
        raise ValueError('pinned single multiply brow material required')
    for key,expected in (('thinIntensity',0),('intensity',1),('opacity',1)):
        start=material.index(key.encode())+len(key)+8
        if struct.unpack_from('<d',material,start)[0] != expected:
            raise ValueError('unverified brow material variant')
    return validate_assets(values={'uv':vertices[:248,4:6].copy(),'triangles':arrays[0].reshape(371,3),
        'texture_transform':float_property(data=material,name='uSTMatrix',count=16).reshape(4,4).T.copy()})


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime',type=Path,default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists() or args.output.suffix!='.npz' or not args.output.resolve().is_relative_to(args.runtime.resolve()):
        parser.error('fresh private .npz under runtime/ required')
    np.savez(args.output,**extract(runtime=args.runtime))
