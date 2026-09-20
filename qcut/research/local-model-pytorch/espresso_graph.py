"""Parse espresso / ByteNN text graphs and account the arena bytes each layer consumes.

Covers the header variants seen in the captured face networks (a leading `D`/`B` letter,
a `<inputs> <layers> <stamp>` line with `DataV2` inputs, or the legacy `<inputs> <layers>`
line with a bare `data` input row) and the operators they use. Shapes are tracked as
NHWC extents; storage descriptors are the (type, fraction-bits) pairs the graph carries,
where type 1 is int8, 2 is int16 and 4 is float32.

Nothing here executes a network; it is the structural ground for byte-exact arena
checks and for a later fixed-point re-implementation.
"""
import json
import sys
from pathlib import Path

ELEMENT_BYTES = {1: 1, 2: 2, 4: 4}


def storage(tokens):
    kind, fraction = int(tokens[0]), int(tokens[1])
    if kind not in ELEMENT_BYTES or not 0 <= fraction <= 31:
        raise ValueError(f"unsupported storage {tokens}")
    return {"type": kind, "fraction": fraction}


def parse(text):
    rows = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()]
    letter = ""
    if rows and len(rows[0]) == 1 and rows[0][0].isalpha():
        letter = rows.pop(0)[0]
    counts = rows.pop(0)
    if len(counts) not in (2, 3) or not all(v.isdecimal() for v in counts):
        raise ValueError(f"unsupported header {counts}")
    input_count, layer_count = int(counts[0]), int(counts[1])
    stamp = int(counts[2]) if len(counts) == 3 else None
    if len(rows) != input_count + layer_count:
        raise ValueError(f"row count {len(rows)} differs from header {counts}")
    return {"letter": letter, "stamp": stamp, "input_count": input_count, "rows": rows}


def weight_bytes(*, count, weight, packed):
    """Arena bytes for `count` kernel elements of the given storage type.

    Under the `B` header, type-2 kernels are 12-bit values packed three bytes per
    pair (value = raw - 2047, big-endian nibbles); the byte-exact arenas confirm
    it. Everywhere else a type-2 kernel is a plain int16, type 1 int8, type 4
    float32.
    """
    if weight["type"] == 2 and packed:
        if count % 2:
            raise ValueError("odd packed-kernel element count")
        return count * 3 // 2
    return count * ELEMENT_BYTES[weight["type"]]


def conv_bytes(*, co, ci, kh, kw, bias, weight, bias_storage, packed):
    return (weight_bytes(count=co * ci * kh * kw, weight=weight, packed=packed)
            + (co * ELEMENT_BYTES[bias_storage["type"]] if bias else 0))


def analyze(text):
    graph = parse(text)
    packed = graph["letter"] == "B"
    shapes, descriptors, layers = {}, {}, []
    cursor = 0

    def shape(name):
        if name not in shapes:
            raise ValueError(f"unknown blob {name}")
        return shapes[name]

    def emit(row, op, name, inputs, outputs, weight_bytes=0, **extra):
        nonlocal cursor
        layers.append({"op": op, "name": name, "inputs": inputs, "outputs": outputs, "arena_offset": cursor,
                       "arena_bytes": weight_bytes, **extra})
        cursor += weight_bytes

    for row in graph["rows"][:graph["input_count"]]:
        if row[0] == "DataV2":
            name, n, h, w, c = row[1], *map(int, row[2:6])
            desc = storage(row[6:8])
        else:
            name, n, h, w, c = row[0], *map(int, row[1:5])
            desc = storage(row[5:7])
        shapes[name], descriptors[name] = (n, h, w, c), desc
        emit(row, "Input", name, [], [name], shape=(n, h, w, c), storage=desc)
    for row in graph["rows"][graph["input_count"]:]:
        op, name = row[0], row[1]
        if op in ("Convolution", "DepthwiseSeparableConvolution"):
            co, kh, kw, sh, sw, ph, pw, bias, relu = map(int, row[2:11])
            weight, bias_storage, output = storage(row[11:13]), storage(row[13:15]), storage(row[15:17])
            source, target = row[17], row[18]
            n, h, w, ci = shape(source)
            depthwise = op == "DepthwiseSeparableConvolution"
            if depthwise and co != ci:
                raise ValueError(f"{name}: depthwise multiplier {co}/{ci}")
            count_ci = 1 if depthwise else ci
            oh, ow = (h + 2 * ph - kh) // sh + 1, (w + 2 * pw - kw) // sw + 1
            shapes[target], descriptors[target] = (n, oh, ow, co), output
            emit(row, op, name, [source], [target],
                 conv_bytes(co=co, ci=count_ci, kh=kh, kw=kw, bias=bias, weight=weight, bias_storage=bias_storage,
                            packed=packed),
                 kernel=(kh, kw), stride=(sh, sw), pad=(ph, pw), bias=bool(bias), relu=bool(relu), weight=weight,
                 bias_storage=bias_storage, storage=output, shape=(n, oh, ow, co), packed=packed and weight["type"] == 2)
        elif op == "DilationSeparableConvolution":
            # co kh kw dh dw sh sw ph pw bias relu, storage, in out (probe micro-dil: dilation 2 keeps the extent).
            co, kh, kw, dh, dw, sh, sw, ph, pw, bias, relu = map(int, row[2:13])
            weight, bias_storage, output = storage(row[13:15]), storage(row[15:17]), storage(row[17:19])
            source, target = row[19], row[20]
            n, h, w, ci = shape(source)
            if co != ci:
                raise ValueError(f"{name}: dilated depthwise multiplier {co}/{ci}")
            oh = (h + 2 * ph - dh * (kh - 1) - 1) // sh + 1
            ow = (w + 2 * pw - dw * (kw - 1) - 1) // sw + 1
            shapes[target], descriptors[target] = (n, oh, ow, co), output
            emit(row, op, name, [source], [target],
                 conv_bytes(co=co, ci=1, kh=kh, kw=kw, bias=bias, weight=weight, bias_storage=bias_storage, packed=packed),
                 kernel=(kh, kw), stride=(sh, sw), pad=(ph, pw), dilation=(dh, dw), bias=bool(bias), relu=bool(relu),
                 weight=weight, bias_storage=bias_storage, storage=output, shape=(n, oh, ow, co), packed=packed and weight["type"] == 2)
        elif op == "InnerProduct":
            co, bias, relu = map(int, row[2:5])
            weight, bias_storage, output = storage(row[5:7]), storage(row[7:9]), storage(row[9:11])
            source, target = row[11], row[12]
            n, h, w, c = shape(source)
            shapes[target], descriptors[target] = (n, 1, 1, co), output
            emit(row, op, name, [source], [target],
                 conv_bytes(co=co, ci=h * w * c, kh=1, kw=1, bias=bias, weight=weight, bias_storage=bias_storage,
                            packed=packed),
                 bias=bool(bias), relu=bool(relu), weight=weight, bias_storage=bias_storage, storage=output,
                 shape=(n, 1, 1, co), packed=packed and weight["type"] == 2)
        elif op == "Eltwise":
            a, b, target = row[2:5]
            output = storage(row[5:7])
            if shape(a) != shape(b):
                raise ValueError(f"{name}: eltwise shapes differ")
            shapes[target], descriptors[target] = shape(a), output
            emit(row, op, name, [a, b], [target], relu=row[7] == "1", storage=output, shape=shape(a))
        elif op == "Concat":
            count = int(row[2])
            sources, target = row[3:3 + count], row[3 + count]
            output = storage(row[4 + count:6 + count])
            first = shape(sources[0])
            if any(shape(s)[:3] != first[:3] for s in sources):
                raise ValueError(f"{name}: concat extents differ")
            shapes[target] = (*first[:3], sum(shape(s)[3] for s in sources))
            descriptors[target] = output
            emit(row, op, name, sources, [target], storage=output, shape=shapes[target])
        elif op == "Slice":
            source, split = row[2], int(row[5])
            first, first_storage, second, second_storage = row[7], int(row[8]), row[9], int(row[10])
            n, h, w, c = shape(source)
            if not 0 < split < c:
                raise ValueError(f"{name}: slice point {split} outside {c} channels")
            shapes[first], shapes[second] = (n, h, w, split), (n, h, w, c - split)
            descriptors[first] = {"type": descriptors[source]["type"], "fraction": first_storage}
            descriptors[second] = {"type": descriptors[source]["type"], "fraction": second_storage}
            emit(row, op, name, [source], [first, second], split=split, shape=shapes[first])
        elif op == "ShuffleNet":
            count = int(row[2])
            sources = row[3:3 + count]
            groups, parts = int(row[3 + count]), int(row[4 + count])
            first, first_storage, second, second_storage = row[5 + count], int(row[6 + count]), row[7 + count], int(row[8 + count])
            n, h, w, _ = shape(sources[0])
            total = sum(shape(s)[3] for s in sources)
            if parts != 2 or total % 2:
                raise ValueError(f"{name}: unsupported shuffle split {parts} of {total}")
            shapes[first] = shapes[second] = (n, h, w, total // 2)
            descriptors[first] = {"type": descriptors[sources[0]]["type"], "fraction": first_storage}
            descriptors[second] = {"type": descriptors[sources[0]]["type"], "fraction": second_storage}
            emit(row, op, name, sources, [first, second], groups=groups, shape=shapes[first])
        elif op == "Shuffle":
            groups, parts, source, target = int(row[2]), int(row[3]), row[4], row[5]
            shapes[target], descriptors[target] = shape(source), descriptors[source]
            emit(row, op, name, [source], [target], groups=groups, parts=parts, shape=shape(source))
        elif op in ("Softmax", "Sigmoid", "Tanh", "Relu"):
            source, target = row[2], row[3]
            output = storage(row[4:6]) if len(row) >= 6 else descriptors[source]
            shapes[target], descriptors[target] = shape(source), output
            emit(row, op, name, [source], [target], storage=output, shape=shape(source))
        elif op in ("Pooling", "PoolingDown"):
            kh, kw, sh, sw, ph, pw = map(int, row[2:8])
            output, mode, source, target = storage(row[8:10]), row[10], row[11], row[12]
            is_global = len(row) > 13 and row[13] == "GLOBAL"
            n, h, w, c = shape(source)
            oh, ow = (1, 1) if is_global else ((h + 2 * ph - kh) // sh + 1, (w + 2 * pw - kw) // sw + 1)
            shapes[target], descriptors[target] = (n, oh, ow, c), output
            emit(row, op, name, [source], [target], mode=mode, kernel=(kh, kw), stride=(sh, sw), pad=(ph, pw),
                 is_global=is_global, storage=output, shape=(n, oh, ow, c))
        elif op == "UpSampling":
            source, target, mode = row[2], row[3], row[4]
            n, h, w, c = shape(source)
            shapes[target], descriptors[target] = (n, h * 2, w * 2, c), descriptors[source]
            emit(row, op, name, [source], [target], mode=mode, shape=shapes[target])
        elif op == "Upsample":
            # factor mode p q, then in, out (the mode fields are recorded, not interpreted here).
            factor, mode, source, target = float(row[2]), row[3], row[6], row[7]
            n, h, w, c = shape(source)
            shapes[target] = (n, int(h * factor + 0.5), int(w * factor + 0.5), c)
            descriptors[target] = descriptors[source]
            emit(row, op, name, [source], [target], factor=factor, mode=mode, params=row[4:6], shape=shapes[target])
        elif op == "OnnxOp1" and row[2] == "Reshape":
            source, target = row[3], row[4]
            output = storage(row[5:7])
            dims = tuple(int(v) for v in row[7:11])
            n, h, w, c = shape(source)
            if dims[0] * dims[1] * dims[2] * dims[3] != n * h * w * c:
                raise ValueError(f"{name}: reshape {dims} does not preserve {n * h * w * c} elements")
            shapes[target], descriptors[target] = dims, output
            emit(row, op, name, [source], [target], dims=dims, params=row[11:], storage=output, shape=dims)
        elif op == "Reshape":
            dims = tuple(int(v) for v in row[2:6])
            source, target = row[6], row[7]
            n, h, w, c = shape(source)
            if dims[0] * dims[1] * dims[2] * dims[3] != n * h * w * c:
                raise ValueError(f"{name}: reshape {dims} does not preserve {n * h * w * c} elements")
            shapes[target], descriptors[target] = dims, descriptors[source]
            emit(row, op, name, [source], [target], dims=dims, shape=dims)
        elif op == "Constant":
            # name <empty input> flag n h w c out type frac: a tensor read from the arena.
            dims = tuple(int(v) for v in row[3:7])
            target, output = row[7], storage(row[8:10])
            count = dims[0] * dims[1] * dims[2] * dims[3]
            shapes[target], descriptors[target] = dims, output
            emit(row, op, name, [], [target], weight_bytes(count=count, weight=output, packed=False), storage=output, shape=dims)
        elif op == "OnnxOp2" and row[2] == "Mul":
            a, b, target = row[3], row[4], row[5]
            output = storage(row[6:8])
            left, right = shape(a), shape(b)
            if left != right and right != (1, 1, 1, 1) and left != (1, 1, 1, 1):
                raise ValueError(f"{name}: only same-shape or scalar broadcast multiply supported")
            shapes[target], descriptors[target] = (left if left != (1, 1, 1, 1) else right), output
            emit(row, "Mul", name, [a, b], [target], storage=output, shape=shapes[target])
        elif op == "Crop":
            # Verified with the runtime: offset_y offset_x offset_c out_h out_w out_c, then in, out.
            oy, ox, oc, oh, ow, occ = map(int, row[2:8])
            source, target = row[8], row[9]
            n, h, w, c = shape(source)
            if oy + oh > h or ox + ow > w or oc + occ > c:
                raise ValueError(f"{name}: crop window outside the input")
            shapes[target], descriptors[target] = (n, oh, ow, occ), descriptors[source]
            emit(row, op, name, [source], [target], offset=(oy, ox, oc), shape=(n, oh, ow, occ))
        else:
            raise ValueError(f"unsupported operator {op}: {row}")
    return {"letter": graph["letter"], "stamp": graph["stamp"], "layers": layers, "shapes": shapes,
            "descriptors": descriptors, "arena_bytes": cursor + (4 if graph["stamp"] is not None else 0)}


def main():
    for graph_dir in map(Path, sys.argv[1:]):
        text = (graph_dir / "graph.txt").read_text()
        actual = (graph_dir / "arena.bin").stat().st_size if (graph_dir / "arena.bin").exists() else None
        try:
            result = analyze(text)
            layers = sum(1 for layer in result["layers"] if layer["op"] != "Input")
            print(json.dumps({"dir": graph_dir.name, "letter": result["letter"], "layers": layers,
                              "predicted_arena": result["arena_bytes"], "actual_arena": actual,
                              "match": actual == result["arena_bytes"]}))
        except ValueError as error:
            print(json.dumps({"dir": graph_dir.name, "error": str(error)[:200]}))


if __name__ == "__main__":
    main()
