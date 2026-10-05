"""Read-only Extra crop state for the parent's already-stopped Stage2 observer.

Call snapshot at BOTH ExtraTrace boundaries, retaining x1 (source), x2
(InputParameter) and image slide from the call. Attach its result as
event['crop_geometry']; never send it to the candidate. This module creates no
breakpoints, evaluates no target functions and reads no image/model payloads.
The parent must bind the pinned image and keep the target stopped throughout.
"""
from __future__ import annotations

import struct

from face_filter_abi import LENS_SHA256, STATE_ABI
from face_host_geometry_contract import integer, numbers
from face_live_extra_trace import CALL, RETURN, context, floats, matrix, points, require, scalar
from face_preprocess_memory import MAT_HEADER, MAX_ADDRESS, checked_read


SCHEMA = "face-extra-crop-snapshot-v1"
TRANSFORMS = {"extra": 0x1b10, "stage2": 0x7d28}
CONFIG_BYTES = (0, 1, 4, 5, 6, 9, 0xa, 0xb, 0x20, 0x21)
READ_BYTES = 32 * 1024
READ_CALLS = 128


class BoundedReader:
    def __init__(self, *, read):
        self.reader, self.bytes, self.calls = read, 0, 0

    def read(self, *, address, size):
        integer(value=size, minimum=1, maximum=READ_BYTES)
        require(condition=self.bytes + size <= READ_BYTES and self.calls < READ_CALLS,
                message="Extra crop snapshot read budget exceeded")
        self.bytes += size
        self.calls += 1
        return checked_read(read=self.reader, address=address, size=size)


def vector(*, read, address, count, pairs):
    """std::vector histories, not the distinct NewAlign AutoVector layout."""
    integer(value=count, maximum=106)
    require(condition=type(pairs) is bool, message="typed point-vector layout required")
    begin, end, capacity = struct.unpack("<3Q", checked_read(read=read, address=address, size=24))
    stride = 8 if pairs else 4
    require(condition=begin <= end <= capacity and capacity - begin <= 512 * stride and
            (end - begin) % stride == 0 and (capacity - begin) % stride == 0 and
            ((begin == end == capacity == 0) or (begin >= 4096 and begin % 4 == 0)) and
            (end - begin) // stride in (0, count), message="unsupported inner filter vector")
    return [] if end == begin else floats(read=read, address=begin, count=(end - begin) // 4)


def inner_filter(*, read, alignment, width, height):
    address = alignment + 0x310
    count = scalar(read=read, address=address + STATE_ABI["count"], kind="<i")
    require(condition=count in (0, 106), message="only empty or primary106 inner filter supported")
    first = scalar(read=read, address=address + STATE_ABI["first"], kind="<B")
    require(condition=first in (0, 1), message="invalid inner filter first flag")
    value = dict(count=count, first=bool(first))
    for name, kind in (("alpha", "<f"), ("scale", "<f"), ("escale", "<f"),
                       ("width", "<i"), ("height", "<i")):
        value[name] = scalar(read=read, address=address + STATE_ABI[name], kind=kind)
    for name, field, pairs in (("current_xy", "current", True), ("previous_xy", "previous", True),
                               ("delta_x", "delta_x", False), ("delta_y", "delta_y", False)):
        value[name] = vector(read=read, address=address + STATE_ABI[field], count=count, pairs=pairs)
    for name, maximum in (("alpha", 1), ("scale", 2**20), ("escale", 32768)):
        numbers(value=[value[name]], length=1, maximum=maximum)
        require(condition=value[name] >= 0, message="nonnegative inner filter scalar required")
    require(condition=len(value["delta_x"]) == len(value["delta_y"]),
            message="matched filter delta dimensions required")
    if count == 0:
        require(condition=value["width"] == value["height"] == 0,
                message="empty inner filter has unexpected dimensions")
    else:
        require(condition=[value["width"], value["height"]] == [height, width],
                message="native filter dimensions must match swapped algorithm dimensions")
    return value


def auto_vector(*, read, address):
    begin, capacity = struct.unpack("<2Q", checked_read(read=read, address=address, size=16))
    count = scalar(read=read, address=address + 0x430, kind="<Q")
    require(condition=count in (0, 212) and count <= capacity <= 264 and
            ((begin == capacity == count == 0) or
             (begin == address + 16 and capacity in (212, 264))),
            message=f"unsupported inline NewAlign float AutoVector: offset={begin - address}, "
                    f"capacity={capacity}, count={count}")
    return [] if count == 0 else floats(read=read, address=begin, count=count)


def optional_matrix(*, read, address):
    fields = MAT_HEADER.unpack(checked_read(read=read, address=address, size=MAT_HEADER.size))
    if fields[1:5] == (0, 0, 0, 0):
        return None
    return matrix(read=read, address=address, columns=(3,))


def transform(*, read, address):
    ready = scalar(read=read, address=address + 0x930, kind="<B")
    require(condition=ready in (0, 1), message="invalid NewAlign cache flag")
    result = dict(ready=bool(ready), forward=optional_matrix(read=read, address=address),
                  inverse=optional_matrix(read=read, address=address + 0x60),
                  mean_xy=auto_vector(read=read, address=address + 0xc0),
                  cached_xy=auto_vector(read=read, address=address + 0x4f8))
    require(condition=not ready or (result["forward"] is not None and result["inverse"] is not None and
            len(result["mean_xy"]) == len(result["cached_xy"]) == 212),
            message="initialized NewAlign cache is incomplete")
    return result


def source_descriptor(*, read, source):
    fields = MAT_HEADER.unpack(checked_read(read=read, address=source, size=MAT_HEADER.size))
    flags, dims, height, width = fields[:4]
    data, stride, step = fields[4], fields[12], fields[13]
    channels = {16: 3, 24: 4}.get(flags & 0xfff)
    require(condition=dims == 2 and channels is not None and 1 <= width <= 4096 and
            1 <= height <= 4096 and width * channels <= stride <= 16384 and step == channels and
            data >= 4096 and data <= MAX_ADDRESS - ((height - 1) * stride + width * channels - 1),
            message="bounded Extra source descriptor required")
    return dict(address=source, width=width, height=height, channels=channels,
                data=data, stride=stride, step=step)


def snapshot(*, read, scope, event, prediction, thread, base, source, input_parameter):
    require(condition=type(scope) is dict and event in ("before", "after"),
            message="bound Extra call/return scope required")
    integer(value=prediction, maximum=1)
    integer(value=thread, minimum=1)
    integer(value=base, maximum=MAX_ADDRESS - 0x5dd088 - 1920)
    integer(value=input_parameter, minimum=4096, maximum=MAX_ADDRESS - 0x20)
    bounded = BoundedReader(read=read)
    reader = bounded.read
    current = context(read=reader, owner=scope["owner"], registers=dict(x0=scope["alignment"],
        x3=scope["configs"], x4=scope["face_config"], x5=scope["runtime"]))
    require(condition=current == scope, message="Extra crop scope identity changed")
    source_info = source_descriptor(read=reader, source=source)
    width, height = source_info["width"], source_info["height"]
    format_value, orientation = struct.unpack("<2i", checked_read(
        read=reader, address=input_parameter + 0x18, size=8))
    result = dict(schema=SCHEMA, lens_sha256=LENS_SHA256, event=event, prediction=prediction,
        thread=thread, offset=CALL if event == "before" else RETURN, **current,
        source=source_info, input_parameter=dict(address=input_parameter, format=format_value,
                                               orientation=orientation),
        config_bytes={hex(offset): scalar(read=reader, address=scope["configs"] + offset, kind="<B")
                      for offset in CONFIG_BYTES},
        face_modes={hex(offset): scalar(read=reader, address=scope["face_config"] + offset, kind="<i")
                    for offset in (0x3c, 0x68)},
        face_bytes={hex(offset): scalar(read=reader, address=scope["face_config"] + offset, kind="<B")
                    for offset in (0x44, 0x4d, 0x96)},
        reset_byte=scalar(read=reader, address=scope["runtime"] + 0x114, kind="<B"),
        published_xy=points(read=reader, runtime=scope["runtime"]),
        tracked=matrix(read=reader, address=scope["alignment"] + 0xb08, columns=(106, 280)),
        inner_filter=inner_filter(read=reader, alignment=scope["alignment"], width=width, height=height),
        transforms={name: transform(read=reader, address=scope["alignment"] + offset)
                    for name, offset in TRANSFORMS.items()},
        mean=floats(read=reader, address=base + 0x5dd088, count=480),
        diagnostic_only=True, target_memory_written=False, target_functions_evaluated=False,
        native_points_sent_to_worker=False, product_parity_verified=False)
    result["read_budget"] = dict(bytes=bounded.bytes, calls=bounded.calls)
    return result
