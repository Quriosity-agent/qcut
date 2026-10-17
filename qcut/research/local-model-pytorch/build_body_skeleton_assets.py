#!/usr/bin/env python3
"""Extract the body-keypoint networks into the independent engine's private runtime.

The smart-body package's model file (tt_skeletonsquat_v10.0) embeds two fixed-point
networks: the full-frame multi-person net (heatmaps + limb vector maps, 224 on the
long side) and the 192x144 single-person refinement net. Their graph text is stored
XOR-ed with an eight-byte key and passed through a 256-byte symbol table that lives in
libbytenn's data segment. This tool reads both files as plain bytes (nothing is loaded
or executed), decodes the two graphs, checks every hash against the values that were
verified bit-exact on real render inputs and outputs (2026-10-17), and writes
`body-skeleton-v1.npz` into the engine runtime, which is local only and never in Git.

The npz holds uint8 arrays only (no pickles): `<net>_graph`, `<net>_arena` for `coarse`
and `refine`, and `provenance` (JSON bytes).
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import tempfile
import zipfile

import numpy as np

NATIVE_RUNTIME = Path.home() / 'Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current'
DEFAULT_MODEL = NATIVE_RUNTIME / 'Models/tt_skeletonsquat_v10.0_size42_md53af0737f43dac2ebfc39bc4c3567aaeb.model'
DEFAULT_LIBRARY = NATIVE_RUNTIME / 'Frameworks/libbytenn.dylib'
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / 'independent-beauty/runtime/research/body-skeleton-v1.npz'
MODEL_SHA256 = '734f9e41b6fd4b3ffbe5485b4ec592835e5b4cc18cd7dc8f33047fd486e41ff1'
LIBRARY_SHA256 = 'febfce4549cd6337c232c22ed00463a54cda7b255c4961426a33bfc78542b863'
TABLE_ADDRESS = 0x3b0e50
# Embedded BM v3 containers and the arenas that reproduce real render outputs bit for bit.
NETWORKS = {
    'coarse': {'offset': 42631, 'arena_sha256': 'fd860348e7b5de87d487756e0e38338ed48d72b48555a247f7d2a2e2e3270c32'},
    'refine': {'offset': 469608, 'arena_sha256': 'a4fbff21cd05f6e46a68705d2314d3cb8f5c83aa931b358f85a3a032d4f4938e'},
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def symbol_table(*, library):
    """The 256-byte permutation in the arm64 slice's data, read without loading the library."""
    data = library.read_bytes()
    if sha256(data) != LIBRARY_SHA256:
        raise ValueError('unexpected libbytenn build; the symbol table address is pinned to one version')
    if data[:4] == bytes.fromhex('cafebabe'):
        count = struct.unpack_from('>I', data, 4)[0]
        for index in range(count):
            cpu, _, offset, size, _ = struct.unpack_from('>5I', data, 8 + 20 * index)
            if cpu == 0x100000c:
                data = data[offset:offset + size]
                break
    if data[:4] != bytes.fromhex('cffaedfe'):
        raise ValueError('arm64 Mach-O slice required')
    cursor, commands = 32, struct.unpack_from('<I', data, 16)[0]
    for _ in range(commands):
        command, size = struct.unpack_from('<II', data, cursor)
        if command == 25:  # LC_SEGMENT_64
            address, _, offset, length = struct.unpack_from('<4Q', data, cursor + 24)
            if address <= TABLE_ADDRESS and TABLE_ADDRESS + 256 <= address + length:
                table = data[offset + TABLE_ADDRESS - address:offset + TABLE_ADDRESS - address + 256]
                if len(set(table)) != 256:
                    raise ValueError('symbol table is not a permutation')
                return table
        cursor += size
    raise ValueError('symbol table not found')


def networks(*, model, library):
    data = model.read_bytes()
    if sha256(data) != MODEL_SHA256:
        raise ValueError('unexpected skeleton model file')
    table = symbol_table(library=library)
    result = {}
    for name, entry in NETWORKS.items():
        offset = entry['offset']
        if data[offset:offset + 4] != b'BM\x00\x03':
            raise ValueError(f'{name}: embedded container not found')
        size, sections = struct.unpack_from('<II', data, offset + 4)
        container = data[offset:offset + size]
        graph_length, graph_offset, arena_length, arena_offset, key_length, key_offset = struct.unpack_from('<6I', container, 12)
        if sections != 6 or key_length != 8 or max(graph_offset + graph_length, arena_offset + arena_length,
                                                   key_offset + key_length) > len(container):
            raise ValueError(f'{name}: invalid container bounds')
        key = container[key_offset:key_offset + key_length]
        graph = bytes(table[value ^ key[index % 8]] for index, value in
                      enumerate(container[graph_offset:graph_offset + graph_length])).rstrip(b'\0')
        graph.decode('ascii')
        arena = container[arena_offset:arena_offset + arena_length]
        if sha256(arena) != entry['arena_sha256']:
            raise ValueError(f'{name}: arena differs from the verified weights')
        result[name] = {'graph': graph, 'arena': arena, 'containerSha256': sha256(container)}
    return result


def write_npz(*, path, arrays):
    """An npz with fixed member timestamps, so rebuilding gives the same bytes (the file is hash-pinned)."""
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(arrays):
            with archive.open(zipfile.ZipInfo(f'{name}.npy', date_time=(1980, 1, 1, 0, 0, 0)), 'w') as member:
                np.lib.format.write_array(member, np.ascontiguousarray(arrays[name]), allow_pickle=False)


def write_assets(*, model=DEFAULT_MODEL, library=DEFAULT_LIBRARY, output=DEFAULT_OUTPUT):
    decoded = networks(model=Path(model), library=Path(library))
    provenance = {'asset': 'body-skeleton-v1', 'modelSha256': MODEL_SHA256, 'tableSourceSha256': LIBRARY_SHA256,
                  'networks': {name: {'offset': NETWORKS[name]['offset'], 'containerSha256': value['containerSha256'],
                                      'graphSha256': sha256(value['graph']), 'arenaSha256': sha256(value['arena'])}
                               for name, value in decoded.items()}}
    arrays = {'provenance': np.frombuffer(json.dumps(provenance, sort_keys=True).encode(), np.uint8)}
    for name, value in decoded.items():
        arrays[f'{name}_graph'] = np.frombuffer(value['graph'], np.uint8)
        arrays[f'{name}_arena'] = np.frombuffer(value['arena'], np.uint8)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, prefix='.body-skeleton-', suffix='.npz', delete=False) as handle:
        temporary = Path(handle.name)
    try:
        write_npz(path=temporary, arrays=arrays)
        os.chmod(temporary, 0o644)
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    return {'output': str(output), 'sha256': sha256(output.read_bytes()), 'bytes': output.stat().st_size, **provenance}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, default=DEFAULT_MODEL)
    parser.add_argument('--library', type=Path, default=DEFAULT_LIBRARY)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    print(json.dumps(write_assets(model=args.model, library=args.library, output=args.output), indent=2))
