"""Bit-exact fixed-point interpreter for espresso graphs.

Every rule here was measured on the pinned runtime with one-layer probe graphs
(see espresso-fixed-point.zh-CN.md): kernels are stored (co, kh, kw, ci) with ci
innermost, int8 or, under the `B` header, 12-bit packed pairs (value = raw - 2047);
biases follow the kernels as int32 at the accumulator scale; a convolution
requantizes with a half-up arithmetic shift, applies ReLU and saturates to the
blob's storage range (int8: -128..127, type 2: -2047..2047); elementwise add and
concat requantize each input to the output scale the same way; average pooling
rounds half up; x2 bilinear upsampling is the zero-padded half-pixel form floored
after a fixed-point 1/16 blend; dense, softmax and sigmoid layers run in float32
on dequantized inputs.
"""
import numpy as np
import torch
import torch.nn.functional as F

from espresso_graph import analyze

RANGE = {1: (-128, 127), 2: (-2047, 2047)}


def reciprocal_estimate(value):
    """AArch64 FRECPE on positive normal float32 values: an 8-bit table reciprocal, no Newton step."""
    value = np.asarray(value, dtype=np.float32)
    bits = value.view(np.uint32)
    exponent = ((bits >> 23) & 0xFF).astype(np.int64)
    scaled = 256 + ((bits & 0x7FFFFF).astype(np.int64) >> 15)
    estimate = ((1 << 19) // (scaled * 2 + 1) + 1) // 2
    result = (((253 - exponent).astype(np.uint32) & 0xFF) << 23) | (((estimate - 256).astype(np.uint32) & 0xFF) << 15)
    return result.astype(np.uint32).view(np.float32)


def wrap32(value):
    """Reduce an int64 array to the int32 wraparound the runtime's accumulators exhibit (probe W32)."""
    return ((np.asarray(value, dtype=np.int64) + (1 << 31)) % (1 << 32)) - (1 << 31)


def requantize(value, shift):
    """Move a fixed-point integer array down by `shift` bits with half-up rounding (up when negative)."""
    value = np.asarray(value, dtype=np.int64)
    if shift <= 0:
        return value << (-shift)
    return (value + (1 << (shift - 1))) >> shift


def saturate(value, storage_type):
    low, high = RANGE[storage_type]
    return np.clip(value, low, high)


def rescale(blob, storage):
    """Requantize an integer blob to another (type, fraction) descriptor."""
    if blob["type"] == 4:
        raise ValueError("cannot rescale a float blob")
    data = requantize(blob["data"], blob["frac"] - storage["fraction"])
    return {"data": saturate(data, storage["type"]), "type": storage["type"], "frac": storage["fraction"]}


def dequantize(blob):
    if blob["type"] == 4:
        return blob["data"].astype(np.float32)
    return (blob["data"].astype(np.float32) / np.float32(2 ** blob["frac"])).astype(np.float32)


def decode_kernel(arena, offset, count, storage, packed):
    if storage["type"] == 4:
        return np.frombuffer(arena, dtype="<f4", count=count, offset=offset).astype(np.float64), offset + 4 * count
    if storage["type"] == 1:
        return np.frombuffer(arena, dtype="<i1", count=count, offset=offset).astype(np.int64), offset + count
    if not packed:
        return np.frombuffer(arena, dtype="<i2", count=count, offset=offset).astype(np.int64), offset + 2 * count
    triples = np.frombuffer(arena, dtype=np.uint8, count=count * 3 // 2, offset=offset).reshape(-1, 3).astype(np.int64)
    first = (triples[:, 0] << 4) | (triples[:, 1] >> 4)
    second = ((triples[:, 1] & 0xF) << 8) | triples[:, 2]
    # raw 4095 decodes to 2048 (probe D4095); the runtime does not clamp the kernel value.
    values = np.stack([first, second], axis=1).reshape(-1) - 2047
    return values, offset + count * 3 // 2


def decode_bias(arena, offset, count, float_layer):
    if float_layer:
        return np.frombuffer(arena, dtype="<f4", count=count, offset=offset).astype(np.float64)
    return np.frombuffer(arena, dtype="<i4", count=count, offset=offset).astype(np.int64)


def convolution(layer, blob, arena):
    kh, kw = layer["kernel"]
    sh, sw = layer["stride"]
    ph, pw = layer["pad"]
    n, h, w, ci = blob["data"].shape
    co = layer["shape"][3]
    depthwise = layer["op"] == "DepthwiseSeparableConvolution"
    count_ci = 1 if depthwise else ci
    kernel, cursor = decode_kernel(arena, layer["arena_offset"], co * count_ci * kh * kw, layer["weight"], layer["packed"])
    float_layer = layer["weight"]["type"] == 4
    bias = decode_bias(arena, cursor, co, float_layer) if layer["bias"] else None
    # Dense kernels are stored (co, kh, kw, ci), depthwise ones (kh, kw, c); torch wants (co, ci/groups, kh, kw).
    # float64 is exact for the integer magnitudes involved.
    if depthwise:
        weight = torch.from_numpy(kernel.reshape(kh, kw, co).transpose(2, 0, 1)[:, None].astype(np.float64).copy())
    else:
        weight = torch.from_numpy(kernel.reshape(co, kh, kw, ci).transpose(0, 3, 1, 2).astype(np.float64).copy())
    source = torch.from_numpy(blob["data"].transpose(0, 3, 1, 2).astype(np.float64).copy())
    accumulated = F.conv2d(source, weight, None, (sh, sw), (ph, pw), 1, ci if depthwise else 1).numpy().transpose(0, 2, 3, 1)
    if float_layer:
        value = accumulated.astype(np.float32)
        if bias is not None:
            value = value + bias.astype(np.float32)
        if layer["relu"]:
            value = np.maximum(value, 0)
        return {"data": value, "type": 4, "frac": 0}
    accumulated = np.rint(accumulated).astype(np.int64)
    accumulator_frac = layer["weight"]["fraction"] + blob["frac"]
    if bias is not None:
        accumulated = accumulated + requantize(bias, layer["bias_storage"]["fraction"] - accumulator_frac)
    # The runtime accumulates in int32 (sums past 2^31 wrap, probes W1-W3) and then applies a rounding
    # shift whose intermediate does not wrap (an INT32_MIN bias on the heatmap net exposed the difference).
    shift = accumulator_frac - layer["storage"]["fraction"]
    value = (wrap32(accumulated) + (1 << (shift - 1))) >> shift if shift > 0 else wrap32(accumulated) << (-shift)
    if layer["relu"]:
        value = np.maximum(value, 0)
    return {"data": saturate(value, layer["storage"]["type"]), "type": layer["storage"]["type"], "frac": layer["storage"]["fraction"]}


def dense(layer, blob, arena):
    n = blob["data"].shape[0]
    features = dequantize(blob).reshape(n, -1)
    co = layer["shape"][3]
    if layer["weight"]["type"] != 4:
        raise ValueError("only float dense layers are verified")
    kernel, cursor = decode_kernel(arena, layer["arena_offset"], co * features.shape[1], layer["weight"], False)
    weight = kernel.reshape(co, features.shape[1]).astype(np.float32)
    value = features @ weight.T
    if layer["bias"]:
        value = value + decode_bias(arena, cursor, co, True).astype(np.float32)
    if layer["relu"]:
        value = np.maximum(value, 0)
    return {"data": value.reshape(n, 1, 1, co).astype(np.float32), "type": 4, "frac": 0}


def pooling(layer, blob):
    kh, kw = layer["kernel"]
    sh, sw = layer["stride"]
    n, h, w, c = blob["data"].shape
    if layer["is_global"]:
        kh, kw, sh, sw = h, w, h, w
    if layer["pad"] != (0, 0):
        raise ValueError("padded pooling is not verified")
    oh, ow = (h - kh) // sh + 1, (w - kw) // sw + 1
    windows = np.lib.stride_tricks.sliding_window_view(blob["data"], (kh, kw), axis=(1, 2))[:, ::sh, ::sw][:, :oh, :ow]
    if layer["mode"] == "MAX":
        return {"data": windows.max(axis=(-2, -1)), "type": blob["type"], "frac": blob["frac"]}
    if layer["mode"] != "AVE":
        raise ValueError(f"unsupported pooling mode {layer['mode']}")
    total = windows.astype(np.int64).sum(axis=(-2, -1))
    if layer["storage"]["type"] == 4:
        value = (total.astype(np.float32) / np.float32(kh * kw) / np.float32(2 ** blob["frac"])).astype(np.float32)
        return {"data": value, "type": 4, "frac": 0}
    count = kh * kw
    value = (2 * total + count) // (2 * count)
    return rescale({"data": value, "type": blob["type"], "frac": blob["frac"]}, layer["storage"])


def upsample_x2(blob):
    """Half-pixel bilinear x2 with zero padding outside the image: (9a + 3b + 3c + d) >> 4."""
    data = blob["data"].astype(np.int64)
    n, h, w, c = data.shape
    padded = np.zeros((n, h + 2, w + 2, c), dtype=np.int64)
    padded[:, 1:-1, 1:-1] = data
    out = np.zeros((n, 2 * h, 2 * w, c), dtype=np.int64)
    for dy in (0, 1):
        for dx in (0, 1):
            main = padded[:, 1:h + 1, 1:w + 1]
            row = padded[:, dy:h + dy, 1:w + 1] if dy == 0 else padded[:, 2:h + 2, 1:w + 1]
            col = padded[:, 1:h + 1, dx:w + dx] if dx == 0 else padded[:, 1:h + 1, 2:w + 2]
            diag = padded[:, (0 if dy == 0 else 2):(h if dy == 0 else h + 2), (0 if dx == 0 else 2):(w if dx == 0 else w + 2)]
            out[:, dy::2, dx::2] = (9 * main + 3 * row + 3 * col + diag) >> 4
    return {"data": out, "type": blob["type"], "frac": blob["frac"]}


def upsample_linear(blob, factor):
    """`Upsample f linear 0 1`: half-pixel bilinear with edge clamping, exact rational blend floored (probe U4)."""
    data = blob["data"].astype(np.int64)
    n, h, w, c = data.shape
    f = int(factor)
    if f != factor or f < 2:
        raise ValueError("only integer upsample factors are verified")
    den = 2 * f

    def axis(length):
        out = np.arange(length * f)
        numerator = 2 * out + 1 - f  # source position times den
        low = np.floor_divide(numerator, den)
        weight_high = numerator - low * den  # in units of 1/den
        low_index = np.clip(low, 0, length - 1)
        high_index = np.clip(low + 1, 0, length - 1)
        weight_high = np.where(low < 0, 0, np.where(low + 1 > length - 1, 0, weight_high))
        weight_high = np.where(low < 0, 0, weight_high)
        return low_index, high_index, weight_high

    y0, y1, wy = axis(h)
    x0, x1, wx = axis(w)
    wy = wy.reshape(1, -1, 1, 1)
    wx = wx.reshape(1, 1, -1, 1)
    rows_low = data[:, y0]
    rows_high = data[:, y1]
    top = rows_low[:, :, x0] * (den - wx) + rows_low[:, :, x1] * wx
    bottom = rows_high[:, :, x0] * (den - wx) + rows_high[:, :, x1] * wx
    value = np.floor_divide(top * (den - wy) + bottom * wy, den * den)
    return {"data": value, "type": blob["type"], "frac": blob["frac"]}


def shuffle_lanes(data, groups, lanes=4):
    """`Shuffle lanes groups`: blocks of `lanes` channels are interleaved across `groups` halves (probe K)."""
    n, h, w, c = data.shape
    if c % (groups * lanes):
        raise ValueError("shuffle needs channels divisible by groups * lanes")
    return data.reshape(n, h, w, groups, c // (groups * lanes), lanes).transpose(0, 1, 2, 4, 3, 5).reshape(n, h, w, c)


def run(text, arena, inputs, *, capture=None):
    """inputs: {name: (int/float NHWC array, [type, fraction])}. Returns {blob: {"data", "type", "frac"}}."""
    graph = analyze(text)
    blobs = {}
    for layer in graph["layers"]:
        op, name = layer["op"], layer["name"]
        if op == "Input":
            array, raw = inputs[name]
            blobs[name] = {"data": np.asarray(array, dtype=np.float32 if raw[0] == 4 else np.int64), "type": int(raw[0]), "frac": int(raw[1])}
            continue
        source = [blobs[k] for k in layer["inputs"]]
        if op in ("Convolution", "DepthwiseSeparableConvolution"):
            result = {layer["outputs"][0]: convolution(layer, source[0], arena)}
        elif op == "InnerProduct":
            result = {layer["outputs"][0]: dense(layer, source[0], arena)}
        elif op == "Eltwise":
            # Both inputs are aligned to the finer input scale, added, then requantized once (probe EL).
            common = max(b["frac"] for b in source)
            value = sum(b["data"].astype(np.int64) << (common - b["frac"]) for b in source)
            value = requantize(value, common - layer["storage"]["fraction"])
            if layer["relu"]:
                value = np.maximum(value, 0)
            result = {layer["outputs"][0]: {"data": saturate(value, layer["storage"]["type"]), "type": layer["storage"]["type"], "frac": layer["storage"]["fraction"]}}
        elif op == "Concat":
            # Inputs already at the output scale pass through unclamped (probe OOR-CC); others are rescaled.
            parts = [b if b["frac"] == layer["storage"]["fraction"] else rescale(b, layer["storage"]) for b in source]
            result = {layer["outputs"][0]: {"data": np.concatenate([p["data"] for p in parts], axis=3), "type": layer["storage"]["type"], "frac": layer["storage"]["fraction"]}}
        elif op == "Slice":
            split = layer["split"]
            result = {}
            for target, data in zip(layer["outputs"], (source[0]["data"][..., :split], source[0]["data"][..., split:])):
                blob = {"data": data, "type": source[0]["type"], "frac": source[0]["frac"]}
                storage = graph["descriptors"][target]
                # Unscaled halves pass through unclamped (probe OOR-SL); scaled halves saturate (probe SL2).
                result[target] = blob if blob["frac"] == storage["fraction"] else rescale(blob, storage)
        elif op == "ShuffleNet":
            # concat -> four-lane two-group shuffle -> halves; every channel is requantized from its own
            # source scale to the scale of the half it lands in (probe SN).
            merged = np.concatenate([b["data"].astype(np.int64) for b in source], axis=3)
            fracs = np.concatenate([np.full(b["data"].shape[3], b["frac"]) for b in source])
            lanes = layer["groups"]  # the row's first parameter is the lane width (4 in every captured graph)
            shuffled = shuffle_lanes(merged, 2, lanes)
            shuffled_fracs = shuffle_lanes(fracs.reshape(1, 1, 1, -1), 2, lanes).reshape(-1)
            half = shuffled.shape[3] // 2
            result = {}
            for target, channels, channel_fracs in ((layer["outputs"][0], shuffled[..., :half], shuffled_fracs[:half]),
                                                    (layer["outputs"][1], shuffled[..., half:], shuffled_fracs[half:])):
                storage = graph["descriptors"][target]
                data = np.empty_like(channels)
                for frac in np.unique(channel_fracs):
                    mask = channel_fracs == frac
                    data[..., mask] = requantize(channels[..., mask], int(frac) - storage["fraction"])
                low, high = RANGE[storage["type"]]
                if storage["type"] == 2:
                    # The int16 kernel clamps one side only, by lane, whether or not the half was rescaled:
                    # the first lane block of every pair keeps the upper bound, the second the lower bound
                    # (channels 0-3 / 4-7 of every 8 with four-channel lanes; probes SN3/SN16/OOR-SN).
                    upper = np.arange(data.shape[3]) % (2 * lanes) < lanes
                    data[..., upper] = np.minimum(data[..., upper], high)
                    data[..., ~upper] = np.maximum(data[..., ~upper], low)
                else:
                    data = np.clip(data, low, high)
                result[target] = {"data": data, "type": storage["type"], "frac": storage["fraction"]}
        elif op == "Shuffle":
            result = {layer["outputs"][0]: {"data": shuffle_lanes(source[0]["data"], layer["parts"], layer["groups"]), "type": source[0]["type"], "frac": source[0]["frac"]}}
        elif op in ("Pooling", "PoolingDown"):
            result = {layer["outputs"][0]: pooling(layer, source[0])}
        elif op == "UpSampling":
            # LINEAR is the zero-padded x2 kernel; BILINEAR is the edge-clamped floored form (probe UPB).
            if layer["mode"] == "LINEAR":
                result = {layer["outputs"][0]: upsample_x2(source[0])}
            elif layer["mode"] == "BILINEAR":
                result = {layer["outputs"][0]: upsample_linear(source[0], 2.0)}
            else:
                raise ValueError(f"unsupported UpSampling mode {layer['mode']}")
        elif op == "Upsample":
            result = {layer["outputs"][0]: upsample_linear(source[0], layer["factor"])}
        elif op == "Crop":
            oy, ox, oc = layer["offset"]
            _, oh, ow, occ = layer["shape"]
            result = {layer["outputs"][0]: {"data": source[0]["data"][:, oy:oy + oh, ox:ox + ow, oc:oc + occ], "type": source[0]["type"], "frac": source[0]["frac"]}}
        elif op in ("Reshape", "OnnxOp1"):
            # The runtime reshapes in NCHW logical order (probe on Reshape_805): flatten channel-major,
            # then read the target extent back as NHWC.
            n, h, w, c = layer["dims"]
            flat = source[0]["data"].transpose(0, 3, 1, 2).reshape(-1)
            reshaped = {"data": flat.reshape(n, c, h, w).transpose(0, 2, 3, 1), "type": source[0]["type"], "frac": source[0]["frac"]}
            if "storage" in layer and reshaped["type"] != 4:
                reshaped = rescale(reshaped, layer["storage"])
            result = {layer["outputs"][0]: reshaped}
        elif op == "Constant":
            count = 1
            for extent in layer["shape"]:
                count *= extent
            values, _ = decode_kernel(arena, layer["arena_offset"], count, layer["storage"], False)
            if layer["storage"]["type"] != 4:
                raise ValueError("only float constants are verified")
            result = {layer["outputs"][0]: {"data": values.astype(np.float32).reshape(layer["shape"]), "type": 4, "frac": 0}}
        elif op == "Mul":
            if any(b["type"] != 4 for b in source):
                raise ValueError("only float multiply is verified")
            result = {layer["outputs"][0]: {"data": (source[0]["data"] * source[1]["data"]).astype(np.float32), "type": 4, "frac": 0}}
        elif op == "Softmax":
            # A float input: exp(x - max) normalized by true division. A fixed-point input: float32 exp
            # scaled by the hardware reciprocal estimate of the sum (FRECPE, no refinement). With more than
            # two classes the exponent is taken relative to the maximum; the two-class kernel instead takes
            # it relative to channel 0 and writes channel 1 as 1 - p0 (probes micro6/micro12; only exact
            # ties differ, where the runtime's own exp(0) falls just below 1).
            value = dequantize(source[0])
            if source[0]["type"] == 4:
                exp = np.exp(value - value.max(axis=-1, keepdims=True)).astype(np.float32)
                probabilities = exp / exp.sum(axis=-1, keepdims=True, dtype=np.float32)
            elif value.shape[-1] == 2:
                exp = np.exp(value - value[..., :1]).astype(np.float32)
                first = (exp[..., :1] * reciprocal_estimate(exp.sum(axis=-1, keepdims=True, dtype=np.float32))).astype(np.float32)
                probabilities = np.concatenate([first, (np.float32(1) - first).astype(np.float32)], axis=-1)
            else:
                exp = np.exp(value - value.max(axis=-1, keepdims=True)).astype(np.float32)
                probabilities = exp * reciprocal_estimate(exp.sum(axis=-1, keepdims=True, dtype=np.float32))
            result = {layer["outputs"][0]: {"data": probabilities.astype(np.float32), "type": 4, "frac": 0}}
        elif op == "Sigmoid":
            value = dequantize(source[0])
            result = {layer["outputs"][0]: {"data": (1 / (1 + np.exp(-value))).astype(np.float32), "type": 4, "frac": 0}}
        else:
            raise ValueError(f"unsupported operator {op}")
        blobs.update(result)
        if capture is not None:
            capture.append(name)
    return blobs
