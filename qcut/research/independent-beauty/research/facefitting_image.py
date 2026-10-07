"""Decode a bounded research frame and retain its original coordinate dimensions."""
import numpy as np
from PIL import Image, ImageOps


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
        normalized.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        rgba = np.asarray(normalized.convert("RGBA"))
    if rgba.nbytes > 16 * 1024**2:
        raise ValueError("analysis exceeds the 16 MiB frame limit; reduce max-edge")
    return {"rgba": rgba, "source_size": list(original_size), "oriented_source_size": list(oriented_size),
            "decoded_size": [rgba.shape[1], rgba.shape[0]], "exif_orientation": orientation}
