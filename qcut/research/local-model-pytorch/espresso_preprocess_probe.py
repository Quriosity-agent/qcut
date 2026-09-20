"""Fit the product's frame-to-tensor preprocessing from a captured detector input.

Given the RGBA frame the headless host rendered and the int8 tensor the face detector received
for it (recorded by bytenn_model_capture.mm with QCUT_BYTENN_CAPTURE_IO=1), try the plausible
resampling routes from the frame to the tensor's resolution and, for each, the affine map
`q = round(a * p + b)` per channel with the channel order left free. The route and map with the
smallest residual are reported with the fraction of pixels that match exactly, so the claim is
"this formula reproduces the tensor to within N", never "the SDK does X" by assumption.
"""
import argparse
import itertools
import json
from pathlib import Path

import numpy as np
from PIL import Image

PRIVATE = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"
FILTERS = {"nearest": Image.NEAREST, "bilinear": Image.BILINEAR, "bicubic": Image.BICUBIC, "area": Image.BOX, "lanczos": Image.LANCZOS}


def plain_bilinear(pixels, width, height, fixed_point=False):
    """2x2 bilinear sampling at half-pixel centres without antialiasing (OpenCV INTER_LINEAR).

    With fixed_point the weights are quantised to 11 bits and the sum rounded once, which is how
    the 8-bit OpenCV kernel computes it; without it the arithmetic is exact float.
    """
    sh, sw = pixels.shape[:2]
    def axis(size_out, size_in):
        coordinate = (np.arange(size_out) + 0.5) * (size_in / size_out) - 0.5
        low = np.floor(coordinate).astype(int)
        weight = coordinate - low
        low = np.clip(low, 0, size_in - 1)
        high = np.clip(low + 1, 0, size_in - 1)
        weight = np.where(coordinate < 0, 0.0, weight)
        return low, high, weight
    y0, y1, wy = axis(height, sh)
    x0, x1, wx = axis(width, sw)
    if fixed_point:
        fy = np.round(wy * 2048); fx = np.round(wx * 2048)
        cy = np.stack([2048 - fy, fy], axis=1)   # (h, 2)
        cx = np.stack([2048 - fx, fx], axis=1)   # (w, 2)
        rows = pixels[y0][:, x0] * cx[None, :, 0, None] + pixels[y0][:, x1] * cx[None, :, 1, None]
        rows1 = pixels[y1][:, x0] * cx[None, :, 0, None] + pixels[y1][:, x1] * cx[None, :, 1, None]
        total = rows * cy[:, 0, None, None] + rows1 * cy[:, 1, None, None]
        return np.floor((total + (1 << 21)) / (1 << 22))
    top = pixels[y0][:, x0] * (1 - wx)[None, :, None] + pixels[y0][:, x1] * wx[None, :, None]
    bottom = pixels[y1][:, x0] * (1 - wx)[None, :, None] + pixels[y1][:, x1] * wx[None, :, None]
    return top * (1 - wy)[:, None, None] + bottom * wy[:, None, None]


def separable_bilinear_truncating(pixels, width, height, bits=7):
    """Half-pixel bilinear, horizontal pass then vertical, weights on `bits` bits, each pass truncated.

    This is the second stage of the product's face-detector preprocessing as fitted on a captured
    tensor (every pixel matched); it is not a general-purpose resize.
    """
    scale = 1 << bits

    def axis(size_out, size_in):
        coordinate = (np.arange(size_out) + 0.5) * (size_in / size_out) - 0.5
        low = np.floor(coordinate).astype(int)
        weight = np.where(coordinate < 0, 0.0, coordinate - low)
        return np.clip(low, 0, size_in - 1), np.clip(low + 1, 0, size_in - 1), np.round(weight * scale)

    x0, x1, fx = axis(width, pixels.shape[1])
    y0, y1, fy = axis(height, pixels.shape[0])
    rows = np.floor((pixels[:, x0] * (scale - fx)[None, :, None] + pixels[:, x1] * fx[None, :, None]) / scale)
    return np.floor((rows[y0] * (scale - fy)[:, None, None] + rows[y1] * fy[:, None, None]) / scale)


def face_detector_tensor(frame_rgb, width, height, intermediate=(640, 360)):
    """The fitted frame-to-tensor recipe: 2x2 mean rounded half up, truncating bilinear, BGR minus 128.

    `frame_rgb` is an (H, W, 3) uint8 array whose size is exactly twice the intermediate size, which
    is how the SDK's image producer reduced the 1280x720 frame. Returns an int8 (height, width, 3)
    array in the network's channel order; its six fraction bits mean a value v stands for v / 64.
    """
    pixels = np.asarray(frame_rgb, dtype=np.float64)
    ih, iw = intermediate[1], intermediate[0]
    if pixels.shape[0] != 2 * ih or pixels.shape[1] != 2 * iw:
        raise ValueError("the recipe was fitted for a frame exactly twice the intermediate size")
    reduced = np.floor(pixels.reshape(ih, 2, iw, 2, 3).mean(axis=(1, 3)) + 0.5)
    resampled = separable_bilinear_truncating(reduced, width, height)
    return (resampled[..., ::-1] - 128).astype(np.int8)


def routes(frame, width, height, intermediate=None):
    """Candidate images at the tensor's resolution: direct resize, or uniform scale with crop/pad.

    With an intermediate size the frame is first reduced there (the SDK's image producer does this
    on the GPU), and the second stage is tried with both antialiased and plain bilinear sampling.
    """
    fw, fh = frame.size
    if intermediate:
        iw, ih = intermediate
        for first_name, first in (("box", Image.BOX), ("bilinear", Image.BILINEAR)):
            reduced = frame.resize((iw, ih), first)
            for second_name, second in FILTERS.items():
                yield f"{iw}x{ih}-{first_name}>{second_name}", reduced.resize((width, height), second)
            pixels = np.asarray(reduced, dtype=np.float64)
            yield f"{iw}x{ih}-{first_name}>plain-bilinear", plain_bilinear(pixels, width, height)
            yield f"{iw}x{ih}-{first_name}>plain-bilinear-fixed", plain_bilinear(pixels, width, height, fixed_point=True)
        pixels = np.asarray(frame, dtype=np.float64)
        yield "plain-bilinear-direct", plain_bilinear(pixels, width, height)
    for name, method in FILTERS.items():
        yield f"direct-{name}", frame.resize((width, height), method)
        scale = max(width / fw, height / fh)  # uniform scale that covers the target, then centre crop
        sw, sh = round(fw * scale), round(fh * scale)
        covered = frame.resize((sw, sh), method)
        left, top = (sw - width) // 2, (sh - height) // 2
        yield f"cover-crop-{name}", covered.crop((left, top, left + width, top + height))
        scale = min(width / fw, height / fh)  # uniform scale that fits, then pad with black
        sw, sh = round(fw * scale), round(fh * scale)
        fitted = frame.resize((sw, sh), method)
        canvas = Image.new("RGB", (width, height))
        canvas.paste(fitted, ((width - sw) // 2, (height - sh) // 2))
        yield f"fit-pad-{name}", canvas


def fit(candidate, tensor):
    """Least-squares a, b per channel for every channel permutation; returns the best."""
    best = None
    pixels = np.asarray(candidate, dtype=np.float64)
    for order in itertools.permutations(range(3)):
        source = pixels[..., list(order)]
        coefficients = []
        residual = np.zeros_like(tensor, dtype=np.float64)
        for channel in range(3):
            p = source[..., channel].reshape(-1)
            q = tensor[..., channel].reshape(-1).astype(np.float64)
            a, b = np.polyfit(p, q, 1)
            coefficients.append((float(a), float(b)))
            residual[..., channel] = (np.round(a * source[..., channel] + b) - tensor[..., channel])
        score = float(np.abs(residual).mean())
        if best is None or score < best["mean_abs"]:
            best = {"order": order, "coefficients": coefficients, "mean_abs": score,
                    "max_abs": float(np.abs(residual).max()), "exact_fraction": float((residual == 0).mean())}
    return best


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frame", required=True, type=Path, help="raw RGBA8 frame")
    parser.add_argument("--frame-size", default="1280x720")
    parser.add_argument("--tensor", required=True, type=Path, help="captured input .bin")
    parser.add_argument("--dims", required=True, help="n,w,h,c as the capture reports them")
    parser.add_argument("--raw", required=True, help="type,frac as the capture reports them")
    parser.add_argument("--intermediate", help="WxH the SDK's image producer reduces the frame to first")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(PRIVATE.resolve()):
        raise SystemExit("output must stay beneath the private ignored directory")
    args.out.mkdir(parents=True, exist_ok=True)
    fw, fh = (int(v) for v in args.frame_size.split("x"))
    frame = Image.frombytes("RGBA", (fw, fh), args.frame.read_bytes()).convert("RGB")
    n, w, h, c = (int(v) for v in args.dims.split(","))
    kind, frac = (int(v) for v in args.raw.split(","))
    tensor = np.fromfile(args.tensor, dtype={1: "<i1", 2: "<i2", 4: "<f4"}[kind]).reshape(h, w, c).astype(np.float64)
    Image.fromarray(np.clip(tensor * (256.0 / 2 ** frac) / 2 + 128, 0, 255).astype(np.uint8)).save(args.out / "tensor-preview.png")
    frame.resize((w, h)).save(args.out / "frame-resized-preview.png")
    report = []
    intermediate = tuple(int(v) for v in args.intermediate.split("x")) if args.intermediate else None
    for name, candidate in routes(frame, w, h, intermediate):
        best = fit(candidate, tensor)
        report.append({"route": name, **best})
    report.sort(key=lambda item: item["mean_abs"])
    summary = {"frame": str(args.frame), "tensor": str(args.tensor), "dims": [n, w, h, c], "raw": [kind, frac],
               "value_range": [float(tensor.min()), float(tensor.max())], "fits": report[:8]}
    if intermediate and (2 * intermediate[0], 2 * intermediate[1]) == (fw, fh):
        recipe = face_detector_tensor(np.asarray(frame), w, h, intermediate).astype(np.float64)
        residual = tensor - recipe
        summary["recipe"] = {"route": f"{intermediate[0]}x{intermediate[1]}-box-half-up>separable-bilinear-7bit-trunc, BGR - 128",
                             "exact_fraction": float((residual == 0).mean()), "max_abs": float(np.abs(residual).max())}
        print(f"fitted recipe: exact={summary['recipe']['exact_fraction']:.4f} max_abs={summary['recipe']['max_abs']:.0f}")
    (args.out / "report.json").write_text(json.dumps(summary, indent=2) + "\n")
    for item in report[:5]:
        print(f"{item['route']:22s} order={item['order']} a,b={[(round(a, 5), round(b, 3)) for a, b in item['coefficients']]} "
              f"mean_abs={item['mean_abs']:.4f} max_abs={item['max_abs']:.1f} exact={item['exact_fraction']:.3f}")


if __name__ == "__main__":
    main()
