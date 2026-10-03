"""Bounded, read-only decoding of the locked detection-preprocessor layout.

The reader is called only as read(address=..., size=...). Caller normalization
and PAC handling belong to the runner; this module never rewrites pointers.
"""

import math
import struct


MIN_ADDRESS = 4096
MAX_ADDRESS = (1 << 64) - 1
MAX_BLOB_BYTES = 16 * 1024 * 1024
MAT_HEADER = struct.Struct("<iiii10Q")
REGISTER_NAMES = ("x0", "x1", "x2", "x29", "lr", "w3", "w4", "w5", "w6", "w7", "s0_bits")


def _integer(*, value, minimum, maximum, name):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"invalid bounded integer: {name}")
    return value


def _range(*, address, size):
    _integer(value=address, minimum=MIN_ADDRESS, maximum=MAX_ADDRESS, name="address")
    _integer(value=size, minimum=1, maximum=MAX_BLOB_BYTES, name="read size")
    if address > MAX_ADDRESS - (size - 1):
        raise ValueError("remote memory range exceeds uint64")


def checked_read(*, read, address, size) -> bytes:
    """Reject invalid requests, reader errors, non-byte results and partial reads."""
    _range(address=address, size=size)
    if not callable(read):
        raise ValueError("remote memory reader must be callable")
    try:
        data = read(address=address, size=size)
    except Exception as error:
        raise ValueError(f"remote memory read failed at {address:#x} ({size} bytes)") from error
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise ValueError("remote memory reader returned non-byte data")
    actual_size = data.nbytes if isinstance(data, memoryview) else len(data)
    if actual_size != size:
        raise ValueError(f"remote memory read length mismatch: expected {size}, got {actual_size}")
    return bytes(data)


def unpack_mat(*, read, address) -> tuple[dict, bytes]:
    """Return header metadata and owned, packed CV_8UC3 pixels without padding."""
    header = checked_read(read=read, address=address, size=MAT_HEADER.size)
    fields = MAT_HEADER.unpack(header)
    flags, dims, rows, cols = fields[:4]
    data, row_stride, pixel_stride = fields[4], fields[12], fields[13]
    if dims != 2 or (flags & 0xfff) != 16:
        raise ValueError("Mat must be 2D CV_8UC3")
    if not 1 <= rows <= 4096 or not 1 <= cols <= 4096:
        raise ValueError("Mat dimensions exceed bounds")
    row_bytes = cols * 3
    if pixel_stride != 3 or not row_bytes <= row_stride <= MAX_BLOB_BYTES:
        raise ValueError("Mat strides exceed bounds")
    packed_size = rows * row_bytes
    extent = (rows - 1) * row_stride + row_bytes
    if packed_size > MAX_BLOB_BYTES or extent > MAX_BLOB_BYTES:
        raise ValueError("Mat packed bytes or strided extent exceeds blob limit")
    _range(address=data, size=extent)
    if row_stride == row_bytes:
        pixels = checked_read(read=read, address=data, size=packed_size)
    else:
        # Padding can be unmapped; only the actual pixel span of each row is read.
        pixels = b"".join(checked_read(read=read, address=data + row * row_stride, size=row_bytes)
                          for row in range(rows))
    return dict(address=address, flags=flags, dims=dims, rows=rows, cols=cols, data=data,
                row_stride=row_stride, pixel_stride=pixel_stride, packed_bytes=packed_size,
                raw_hex=header.hex()), pixels


def unpack_rect(*, read, address) -> dict:
    raw = checked_read(read=read, address=address, size=16)
    values = list(struct.unpack("<4f", raw))
    if (not all(math.isfinite(value) and abs(value) <= 32768 for value in values)
            or values[2] <= 0 or values[3] <= 0):
        raise ValueError("Rect must have finite bounded values and positive width/height")
    return dict(values=values, raw_hex=raw.hex())


def _registers(*, registers):
    if not isinstance(registers, dict) or any(name not in registers for name in REGISTER_NAMES):
        raise ValueError("missing detection-call registers")
    values = {name: registers[name] for name in REGISTER_NAMES}
    for name, value in values.items():
        is_pointer = name.startswith("x") or name == "lr"
        _integer(value=value, minimum=MIN_ADDRESS if is_pointer else 0,
                 maximum=MAX_ADDRESS if is_pointer else (1 << 32) - 1, name=name)
    if any(values[name] not in (0, 1) for name in ("w5", "w6", "w7")):
        raise ValueError("actual w5/w6/w7 flags must be 0 or 1")
    return values


def _branch(*, runtime_byte, config_byte, face_byte, legacy_byte, flags, expansion_bits):
    if flags[2] != (config_byte & 1):
        raise ValueError("w7 disagrees with RunningConfigs+0xb bit 0")
    if runtime_byte & 1:
        name, expected_flags, expected_bits = "runtime_1_5", [1, 0], 0x3fc00000
    elif legacy_byte & 1:
        name, expected_flags, expected_bits = "face_config_1_4", [face_byte & 1, 1], 0x3fb33333
    else:
        name, expected_flags, expected_bits = "ScaleEnlarge", [face_byte & 1, 0], None
    if flags[:2] != expected_flags:
        raise ValueError(f"actual flags disagree with {name} branch")
    if expected_bits is not None and expansion_bits != expected_bits:
        raise ValueError(f"expansion bits disagree with {name} branch")
    expansion = struct.unpack("<f", struct.pack("<I", expansion_bits))[0]
    if not math.isfinite(expansion) or not 0 < expansion <= 4:
        raise ValueError("expansion must be finite, positive and at most 4")
    return name, expansion


def unpack_detection_call(*, read, registers) -> dict:
    """Validate the caller and return evidence plus source_bytes (packed pixels).

    source_mat is metadata, flags are [w5,w6,w7], and raw maps each selected
    caller/config field to its address and raw_hex. lr is retained unmodified;
    acceptance of a normalized module-relative caller is the runner's job.
    """
    values = _registers(registers=registers)
    slots_address = values["x29"] - 0x48
    slots = checked_read(read=read, address=slots_address, size=48)
    runtime_info, face_config, configs, input_parameter, source, alignment = struct.unpack("<6Q", slots)
    for name, pointer in (("alignment", alignment), ("source", source), ("input_parameter", input_parameter),
                          ("configs", configs), ("face_config", face_config), ("runtime_info", runtime_info)):
        _integer(value=pointer, minimum=MIN_ADDRESS, maximum=MAX_ADDRESS, name=name)
    preprocessor = alignment + 0x7800
    rect_address = runtime_info + 0x18
    _range(address=preprocessor, size=1)
    _range(address=rect_address, size=16)
    if values["x0"] != preprocessor or values["x1"] != source or values["x2"] != rect_address:
        raise ValueError("detection-call pointers disagree with caller slots")

    selected_addresses = dict(target=(alignment + 0x95c, 8),
                              format_orientation=(input_parameter + 0x18, 8),
                              configs_0x0b=(configs + 0xb, 1),
                              face_config_0x24=(face_config + 0x24, 1),
                              face_config_0x39=(face_config + 0x39, 1),
                              runtime_info_0x110=(runtime_info + 0x110, 1))
    for address, size in selected_addresses.values():
        _range(address=address, size=size)
    selected = {name: checked_read(read=read, address=address, size=size)
                for name, (address, size) in selected_addresses.items()}
    target = list(struct.unpack("<2i", selected["target"]))
    if target != [160, 160] or [values["w3"], values["w4"]] != target:
        raise ValueError("actual target fields and w3/w4 must both be 160x160")
    flags = [values[name] for name in ("w5", "w6", "w7")]
    branch, expansion = _branch(runtime_byte=selected["runtime_info_0x110"][0],
                                config_byte=selected["configs_0x0b"][0],
                                face_byte=selected["face_config_0x24"][0],
                                legacy_byte=selected["face_config_0x39"][0],
                                flags=flags, expansion_bits=values["s0_bits"])
    format_value, orientation = struct.unpack("<2i", selected["format_orientation"])
    rect = unpack_rect(read=read, address=rect_address)
    source_mat, source_bytes = unpack_mat(read=read, address=source)
    raw = {name: dict(address=selected_addresses[name][0], raw_hex=data.hex())
           for name, data in selected.items()}
    raw["caller_slots"] = dict(address=slots_address, raw_hex=slots.hex())
    return dict(alignment=alignment, source_mat=source_mat, source_bytes=source_bytes, rect=rect,
                preprocessor=preprocessor, input_parameter=input_parameter, configs=configs,
                face_config=face_config, runtime_info=runtime_info, target=target, flags=flags,
                expansion=expansion, expansion_bits=values["s0_bits"], branch=branch,
                format=format_value, orientation=orientation, lr=values["lr"], raw=raw)
