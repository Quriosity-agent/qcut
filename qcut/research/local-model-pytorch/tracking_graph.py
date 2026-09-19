"""Strict parser and bounded weight reader for the audited tracking operators."""
import math
import re
import struct

import numpy as np
import torch


def parse_rows(*, text):
    if not isinstance(text, str) or len(text) > 65536:
        raise ValueError("invalid tracking graph size")
    rows = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()]
    if len(rows) < 3 or rows[0] not in (["B"], ["D"]):
        raise ValueError("unsupported tracking graph prefix")
    header = rows[1]
    if len(header) != 3 or not all(value.isdecimal() for value in header):
        raise ValueError("invalid tracking graph header")
    if int(header[0]) != 1 or not 1 <= int(header[1]) <= 128 or len(rows) != int(header[1]) + 3:
        raise ValueError("tracking graph count mismatch")
    if rows[2][0] != "DataV2" or any(row[0] == "DataV2" for row in rows[3:]):
        raise ValueError("tracking requires exactly one leading input")
    if int(header[2]) > 2 ** 32 - 1:
        raise ValueError("invalid arena identity")
    return rows[0][0], rows[2:], int(header[2])


def unpack12(*, data):
    if len(data) % 3:
        raise ValueError("packed weights must contain complete pairs")
    triplets = np.frombuffer(data, dtype=np.uint8).astype(np.int32).reshape(-1, 3)
    pairs = np.stack(((triplets[:, 0] << 4) | (triplets[:, 1] >> 4),
                      ((triplets[:, 1] & 15) << 8) | triplets[:, 2]), axis=1)
    return (pairs.reshape(-1) - 2047).astype(np.int16)


class Arena:
    def __init__(self, *, data, fixed):
        self.data, self.fixed, self.cursor = data, fixed, 0
        if data is not None and (not isinstance(data, bytes) or len(data) > 4 * 1024 * 1024):
            raise ValueError("invalid tracking arena")

    def take(self, *, count, kind):
        if not 0 < count <= 1024 * 1024:
            raise ValueError("invalid weight count")
        packed = self.fixed and kind == "weight"
        if packed and count % 2:
            raise ValueError("odd packed weight count is unsupported")
        size = count * 3 // 2 if packed else count * 4
        dtype = torch.int16 if packed else torch.int32 if self.fixed else torch.float32
        start, self.cursor = self.cursor, self.cursor + size
        if self.data is None:
            return torch.zeros(count, dtype=dtype)
        if self.cursor > len(self.data):
            raise ValueError("truncated weight arena")
        raw = self.data[start:self.cursor]
        values = unpack12(data=raw) if packed else np.frombuffer(raw, dtype="<i4" if self.fixed else "<f4").copy()
        if not np.isfinite(values).all():
            raise ValueError("nonfinite model weights")
        return torch.from_numpy(values)

    def finish(self):
        if self.data is not None and len(self.data) != self.cursor + 4:
            raise ValueError(f"unconsumed weight bytes: used {self.cursor}, arena {len(self.data)}")


def tensor_spec(*, shape, fixed, shift):
    if len(shape) != 4 or any(type(value) is not int or not 1 <= value <= 4096 for value in shape):
        raise ValueError("invalid tensor shape")
    if math.prod(shape) > 2 ** 24 or not 0 <= shift <= 24 or not fixed and shift != 0:
        raise ValueError("unsupported tensor size or fixed-point shift")
    return {"shape": list(shape), "dtype": "int16" if fixed else "float32", "shift": shift, "layout": "NCHW",
            **({"raw_range": [-2047, 2047], "real_scale": 2.0 ** -shift} if fixed else {})}


def validate_name(*, name):
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,180}", name) or name in {".", ".."}:
        raise ValueError("invalid tensor name")


def compile_graph(*, text, arena=None):
    prefix, rows, identity = parse_rows(text=text)
    fixed = prefix == "B"
    reader = Arena(data=arena, fixed=fixed)
    specs, used, nodes, state = {}, set(), [], {}
    for index, row in enumerate(rows):
        if len(row) < 2:
            raise ValueError("short graph row")
        op, name = row[:2]
        validate_name(name=name)
        node = {"op": op, "name": name, "key": str(index)}
        sources, destinations = [], []
        if op == "DataV2":
            if len(row) != 9 or row[6] != ("2" if fixed else "4") or row[8] != "0":
                raise ValueError("unsupported input encoding")
            n, w, h, c, _, shift, _ = map(int, row[2:])
            destinations = [(name, tensor_spec(shape=(n, c, h, w), fixed=fixed, shift=shift))]
            node["output"] = name
        elif op in {"Convolution", "DepthwiseSeparableConvolution"}:
            if len(row) != 19:
                raise ValueError("unsupported convolution row")
            co, kw, kh, sw, sh, pw, ph, bias, relu, wt, ws, bt, bs, ot, os = map(int, row[2:17])
            source, dest = row[17:]
            src = specs[source]
            n, ci, h, w = src["shape"]
            depthwise = op == "DepthwiseSeparableConvolution"
            if (not 1 <= co <= 256 or kw != kh or kw not in (1, 3) or sw != sh or sw not in (1, 2)
                    or pw != ph or pw not in (0, 1) or bias != 1 or relu not in (0, 1)
                    or wt != (2 if fixed else 4) or bt != 4 or ot != wt
                    or depthwise and co != ci or not 0 <= ws <= 24
                    or fixed and bs != src["shift"] + ws or not fixed and (ws or bs or os)):
                raise ValueError("unsupported convolution semantics")
            count = co * kw * kh * (1 if depthwise else ci)
            weight = reader.take(count=count, kind="weight")
            weight = (weight.reshape(kh, kw, co).permute(2, 0, 1).unsqueeze(1) if depthwise else
                      weight.reshape(co, kh, kw, ci).permute(0, 3, 1, 2))
            state[f"tensors.w{index}"] = weight.contiguous()
            state[f"tensors.b{index}"] = reader.take(count=co, kind="bias")
            outshape = (n, co, (h + 2 * ph - kh) // sh + 1, (w + 2 * pw - kw) // sw + 1)
            node.update(source=source, output=dest, stride=sw, pad=pw, groups=ci if depthwise else 1,
                        relu=bool(relu), shift=bs - os)
            if fixed and not 0 <= node["shift"] <= 30:
                raise ValueError("unsupported convolution requantization")
            sources, destinations = [source], [(dest, tensor_spec(shape=outshape, fixed=fixed, shift=os))]
        elif op == "Crop":
            if len(row) != 11:
                raise ValueError("unsupported crop row")
            x, y, c, w, h, co = map(int, row[2:8])
            source, dest, shift = row[8:]
            n, ci, hi, wi = specs[source]["shape"]
            if min(x, y, c) < 0 or x + w > wi or y + h > hi or c + co > ci or int(shift) != specs[source]["shift"]:
                raise ValueError("unsupported crop bounds or requantization")
            node.update(source=source, output=dest, crop=[x, y, c, w, h, co])
            sources, destinations = [source], [(dest, tensor_spec(shape=(n, co, h, w), fixed=fixed, shift=int(shift)))]
        elif op == "Concat":
            count = int(row[2])
            if count != 2 or len(row) != count + 6 or row[-2] != ("2" if fixed else "4"):
                raise ValueError("unsupported concat encoding")
            sources, dest, shift = row[3:3 + count], row[-3], int(row[-1])
            shapes = [specs[key]["shape"] for key in sources]
            if any([shape[0], *shape[2:]] != [shapes[0][0], *shapes[0][2:]] for shape in shapes):
                raise ValueError("incompatible concat shapes")
            node.update(sources=sources, output=dest, shifts=[specs[key]["shift"] - shift for key in sources])
            destinations = [(dest, tensor_spec(shape=(shapes[0][0], sum(s[1] for s in shapes), *shapes[0][2:]), fixed=fixed, shift=shift))]
        elif op == "Eltwise":
            if len(row) != 8 or row[5] != ("2" if fixed else "4") or row[-1] != "0":
                raise ValueError("unsupported elementwise operation")
            sources, dest, shift = row[2:4], row[4], int(row[6])
            if specs[sources[0]]["shape"] != specs[sources[1]]["shape"]:
                raise ValueError("incompatible elementwise shapes")
            node.update(sources=sources, output=dest, shifts=[specs[key]["shift"] - shift for key in sources])
            destinations = [(dest, tensor_spec(shape=specs[sources[0]]["shape"], fixed=fixed, shift=shift))]
        elif op == "Slice" and not fixed:
            count = int(row[4])
            cuts = list(map(int, row[5:5 + count]))
            outputs = int(row[5 + count])
            source = row[2]
            shape = specs[source]["shape"]
            if (row[3] != "1" or outputs != count + 1 or len(row) != 6 + count + outputs * 2
                    or cuts != sorted(set(cuts)) or not cuts or cuts[0] <= 0 or cuts[-1] >= shape[1]):
                raise ValueError("unsupported channel slice")
            dests = row[6 + count::2]
            if any(value != "0" for value in row[7 + count::2]):
                raise ValueError("unsupported slice output shift")
            sizes = [b - a for a, b in zip([0, *cuts], [*cuts, shape[1]])]
            node.update(source=source, outputs=dests, sizes=sizes)
            sources = [source]
            destinations = [(dest, tensor_spec(shape=(shape[0], size, *shape[2:]), fixed=False, shift=0)) for dest, size in zip(dests, sizes)]
        elif op == "Constant" and not fixed:
            if len(row) != 10 or row[2:7] != ["0", "1", "1", "1", "1"] or row[8:] != ["4", "0"]:
                raise ValueError("unsupported constant")
            dest = row[7]
            state[f"tensors.c{index}"] = reader.take(count=1, kind="constant").reshape(1, 1, 1, 1)
            node["output"] = dest
            destinations = [(dest, tensor_spec(shape=(1, 1, 1, 1), fixed=False, shift=0))]
        elif op == "OnnxOp2" and not fixed:
            if len(row) != 8 or row[2] not in {"Sum", "Div"} or row[-2:] != ["4", "0"]:
                raise ValueError("unsupported binary operation")
            sources, dest = row[3:5], row[5]
            if specs[sources[1]]["shape"] != [1, 1, 1, 1]:
                raise ValueError("only scalar right operands supported")
            node.update(sources=sources, output=dest, mode=row[2])
            destinations = [(dest, dict(specs[sources[0]]))]
        elif op == "OnnxOp1" and not fixed:
            if len(row) != 12 or row[2] != "Reshape" or row[5:7] != ["4", "0"] or row[-1] not in {"2", "4"}:
                raise ValueError("unsupported reshape")
            source, dest = row[3:5]
            n, w, h, c = map(int, row[7:11])
            shape = (n, c, h, w)
            if math.prod(shape) != math.prod(specs[source]["shape"]):
                raise ValueError("reshape changes element count")
            node.update(source=source, output=dest, target=list(shape))
            destinations = [(dest, tensor_spec(shape=shape, fixed=False, shift=0))]
            sources = [source]
        elif op == "Transpose" and not fixed:
            if len(row) != 8 or row[2:6] != ["1", "3", "0", "2"]:
                raise ValueError("unsupported transpose axes")
            source, dest = row[6:]
            # Serialized axes refer to NHWC storage, not the public NCHW interface.
            n, c, h, w = specs[source]["shape"]
            node.update(source=source, output=dest)
            sources, destinations = [source], [(dest, tensor_spec(shape=(h, w, c, n), fixed=False, shift=0))]
        elif op == "Softmax" and not fixed:
            if len(row) != 4:
                raise ValueError("unsupported softmax")
            source, dest = row[2:]
            if specs[source]["shape"][1:] != [2, 1, 1]:
                raise ValueError("unsupported softmax shape")
            node.update(source=source, output=dest)
            sources, destinations = [source], [(dest, dict(specs[source]))]
        else:
            raise ValueError(f"unsupported tracking operation: {op}")
        for source in sources:
            if source not in specs:
                raise ValueError("missing graph input")
        used.update(sources)
        for dest, spec in destinations:
            validate_name(name=dest)
            if dest in specs:
                raise ValueError("duplicate graph tensor")
            specs[dest] = spec
        nodes.append(node)
    reader.finish()
    if arena is not None and arena[-4:] != struct.pack("<I", identity):
        raise ValueError("weight arena identity differs from graph header")
    outputs = {name: spec for name, spec in specs.items() if name not in used}
    if not outputs or rows[0][1] in outputs:
        raise ValueError("graph has no computed output")
    return {"nodes": nodes, "input_schema": {rows[0][1]: specs[rows[0][1]]}, "output_schema": outputs,
            "tensor_schema": specs, "fixed": fixed, "arena_bytes_consumed": reader.cursor}, state
