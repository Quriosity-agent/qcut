"""Prepare bounded portrait regressions with explicit source/transform provenance."""
import argparse
import io
import json
from pathlib import Path

from PIL import Image, ImageOps

from face_alignment_replay import LockedFiles, strict_json
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest

DIMENSIONS = (1448, 1086)
FEATURES = ("face_adjust_eye", "face_adjust_nose")


def normalized_image(*, data):
    with Image.open(io.BytesIO(data)) as source:
        oriented = ImageOps.exif_transpose(source).convert("RGBA")
        scaled = ImageOps.contain(oriented, DIMENSIONS, method=Image.Resampling.LANCZOS)
        offset = tuple((target - actual) // 2 for target, actual in zip(DIMENSIONS, scaled.size, strict=True))
        output = Image.new("RGBA", DIMENSIONS, (96, 96, 96, 255))
        output.alpha_composite(scaled, offset)
        transform = dict(original_size=list(source.size), oriented_size=list(oriented.size),
            scaled_size=list(scaled.size), offset=list(offset), output_size=list(DIMENSIONS),
            resampling="Pillow LANCZOS", exif_transpose=True, background_rgba=[96, 96, 96, 255])
    return output, transform


def build(*, image, out):
    locked = LockedFiles()
    image = image.resolve(strict=True)
    data = locked.read(path=image, maximum=sequence.IMAGE_LIMIT)
    output, transform = normalized_image(data=data)
    directory = sequence.fresh_output(path=out)
    prepared = directory / "normalized.png"
    output.save(prepared)
    manifest = sequence.make_fixture(image=prepared, out=directory / "eye")
    nose = strict_json(data=manifest.read_bytes())
    for frame in nose["frames"]:
        frame["image"] = str((manifest.parent / frame["image"]).resolve(strict=True))
        frame["parameters"] = {FEATURES[1]: frame["parameters"][FEATURES[0]]}
    nose_path = directory / "nose.json"
    nose_path.write_text(json.dumps(nose, indent=2, allow_nan=False) + "\n")
    locked.verify()
    report = dict(source=str(image), source_sha256=digest(data=data), transform=transform,
        normalized_png_sha256=digest(data=prepared.read_bytes()),
        normalized_rgba_sha256=digest(data=output.tobytes()),
        manifests={FEATURES[0]: str(manifest), FEATURES[1]: str(nose_path)},
        synthetic_motion=True, real_video_motion=False, features=list(FEATURES))
    (directory / "provenance.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("image", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build(image=args.image, out=args.out), indent=2))


if __name__ == "__main__":
    main()
