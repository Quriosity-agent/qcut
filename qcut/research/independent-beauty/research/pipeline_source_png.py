"""Recognize RGBA PNG transports requiring no normalization before body rendering."""
import zlib


PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


def normalized_rgba_png(*, data):
    """Only the standard 8-bit, non-interlaced RGBA transport can skip rewriting."""
    if not data.startswith(PNG_SIGNATURE):
        return False
    offset, idat, srgb, sbit = 8, False, False, False
    while offset + 12 <= len(data):
        length = int.from_bytes(data[offset:offset + 4], 'big')
        end = offset + 12 + length
        if end > len(data):
            return False
        kind = data[offset + 4:offset + 8]
        payload = memoryview(data)[offset + 8:end - 4]
        checksum = zlib.crc32(payload, zlib.crc32(kind))
        if checksum != int.from_bytes(data[end - 4:end], 'big'):
            return False
        if offset == 8:
            if kind != b'IHDR' or length != 13 or payload[8:].tobytes() != b'\x08\x06\x00\x00\x00':
                return False
            if not int.from_bytes(payload[:4], 'big') or not int.from_bytes(payload[4:8], 'big'):
                return False
        elif kind == b'sRGB':
            if srgb or idat or length != 1 or payload[0] > 3:
                return False
            srgb = True
        elif kind == b'sBIT':
            if sbit or idat or payload.tobytes() != b'\x08\x08\x08\x08':
                return False
            sbit = True
        elif kind == b'IDAT':
            idat = True
        elif kind == b'IEND':
            return length == 0 and idat and end == len(data)
        else:
            return False
        offset = end
    return False
