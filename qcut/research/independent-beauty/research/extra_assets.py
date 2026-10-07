"""Immutable private initialized means for ordinary Extra160 inference."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from alignment_assets import LENS_SHA256

CONTENT_SHA256='68540ee135920e8182fd744c993e9b6e689a7c1ba9672d11492dbd67d15d82f1'


def load_assets(*, path):
    if path.stat().st_size>8192:
        raise ValueError('bounded private Extra means required')
    with np.load(path,allow_pickle=False) as archive:
        if set(archive.files)!={'extra','part'}:
            raise ValueError('complete private Extra and Part means required')
        values={key:archive[key].copy() for key in archive.files}
    return validate_assets(values=values)


def validate_assets(*, values):
    if set(values) != {'extra', 'part'}:
        raise ValueError('complete private Extra and Part means required')
    for key,count in (('extra',240),('part',106)):
        value=values[key]
        if value.dtype!=np.float32 or value.shape!=(count,2) or not np.isfinite(value).all() or (value<0).any() or (value>256).any():
            raise ValueError('private Extra means outside pinned profile')
        value.setflags(write=False)
    if hashlib.sha256(values['extra'].tobytes()+values['part'].tobytes()).hexdigest()!=CONTENT_SHA256:
        raise ValueError('private Extra mean content mismatch')
    return values


def extract(*, trace_path):
    trace=json.loads(trace_path.read_text())
    if (trace.get('passed') is not True or trace.get('software_breakpoints_used') is not False
            or trace.get('target_memory_written') is not False or trace.get('target_functions_evaluated') is not False
            or any(trace.get('checks',{}).get(key) is not True for key in
                   ('observationPreservedPixels','sourceUnchanged','librariesUnchanged'))
            or trace.get('librarySha256',{}).get('liblens.dylib') != LENS_SHA256):
        raise ValueError('pinned read-only Extra observation with pixel integrity required')
    records=trace.get('records',[])
    if len(records)!=2 or any(records[0][key]!=records[1][key] for key in ('extra_mean','part_mean')):
        raise ValueError('two invariant initialized Extra means required')
    return validate_assets(values={key:np.asarray(records[0][f'{key}_mean'],np.float32).reshape(count,2)
                                  for key,count in (('extra',240),('part',106))})


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trace',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    runtime=Path(__file__).resolve().parents[1]/'runtime'
    if args.output.exists() or args.output.suffix!='.npz' or not args.output.resolve().is_relative_to(runtime.resolve()):
        parser.error('fresh private .npz under runtime/ required')
    np.savez(args.output,**extract(trace_path=args.trace))
