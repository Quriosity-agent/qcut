"""Private Extra sampling evidence, never candidate inference inputs."""
import hashlib

from face_preprocess_memory import MAT_HEADER, checked_read, unpack_mat
from face_live_extra_trace import floats, matrix, require


def source_pixels(*, read, address):
    fields = MAT_HEADER.unpack(checked_read(read=read, address=address, size=MAT_HEADER.size))
    flags, dims, rows, cols = fields[:4]
    data, stride, step = fields[4], fields[12], fields[13]
    kind = flags & 0xfff
    channels = {16: 3, 24: 4}.get(kind)
    require(condition=dims == 2 and channels is not None and 1 <= rows <= 4096 and
            1 <= cols <= 4096 and rows * cols * 4 <= 16 * 1024**2 and
            cols * channels <= stride <= 16384 and step == channels, message="bounded Extra source pixels required")
    pixels = b"".join(checked_read(read=read, address=data + row * stride, size=cols * channels)
                      for row in range(rows))
    return dict(width=cols, height=rows, channels=channels, layout="bgr8" if channels == 3 else "rgba8",
                sha256=hashlib.sha256(pixels).hexdigest(), hex=pixels.hex())


def snapshot(*, read, alignment, base, source, directory, prediction):
    metadata, pixels = unpack_mat(read=read, address=alignment + 0x7ae8)
    require(condition=(metadata["rows"], metadata["cols"]) == (160, 160),
            message="only 160x160 Extra BGR supported")
    original = source_pixels(read=read, address=source)
    path = directory / f"source-{prediction}.pixels"
    with path.open("xb") as stream:
        stream.write(bytes.fromhex(original.pop("hex")))
    original["path"] = str(path)
    return dict(source=original,
        crop=dict(width=160, height=160, sha256=hashlib.sha256(pixels).hexdigest(), hex=pixels.hex()),
        forward=matrix(read=read, address=alignment + 0x1b10, columns=(3,)),
        inverse=matrix(read=read, address=alignment + 0x1b70, columns=(3,)),
        stage2_forward=matrix(read=read, address=alignment + 0x7d28, columns=(3,)),
        stage2_inverse=matrix(read=read, address=alignment + 0x7d88, columns=(3,)),
        mean=floats(read=read, address=base + 0x5dd088, count=480),
        native_points_sent_to_worker=False, diagnostic_only=True)
