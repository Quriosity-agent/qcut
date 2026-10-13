"""Decode a bounded research frame and retain its original coordinate dimensions."""
import numpy as np
from PIL import Image, ImageOps

from render_resolution import frame_byte_limit, resolution_mode, source_edge_limit


MAX_SOURCE_PIXELS = 160_000_000


def decode_image(*, image, max_edge):
    if type(max_edge) is not int or not 160 <= max_edge <= 4096:
        raise ValueError("max-edge must be between 160 and 4096")
    Image.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS
    with Image.open(image) as source:
        original_size = source.size
        if source.width * source.height > MAX_SOURCE_PIXELS or max(original_size) > 100000:
            raise ValueError("source image exceeds the pixel or dimension limit")
        orientation = source.getexif().get(274, 1)
        oriented_size = original_size[::-1] if orientation in (5, 6, 7, 8) else original_size
        normalized = ImageOps.exif_transpose(source)
        if resolution_mode() == 'original':
            if getattr(source, 'n_frames', 1) != 1 or max(oriented_size) > source_edge_limit():
                raise ValueError('original mode requires a still image at most 4096; resizing is not performed')
        else:
            normalized.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        rgba = np.asarray(normalized.convert("RGBA"))
    if rgba.nbytes > frame_byte_limit():
        budget = frame_byte_limit() // 1024**2
        raise ValueError(f'image exceeds the {budget} MiB frame limit')
    return {"rgba": rgba, "source_size": list(original_size), "oriented_source_size": list(oriented_size),
            "decoded_size": [rgba.shape[1], rgba.shape[0]], "exif_orientation": orientation}
