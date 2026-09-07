#!/usr/bin/env python3
"""Replay each D634 Soft Glow stage from captured native upstream RGBA8 targets."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess


NAMES = (
    "gaussian.downsample", "gaussian.x", "gaussian.y", "gaussian.output",
    "02-soft-light", "glow.mask", "glow.horizontal_rg", "glow.vertical_rg",
    "glow.horizontal_ba", "glow.vertical_ba", "03-glow", "04-lut", "05-normal", "06-output",
)
PACKED = frozenset(NAMES[6:10])
VERTICAL_FLIPS = frozenset((3, 12, 13))
IDENTITIES = {
    "creator": "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9",
    "agfx": "1b9493940eebda3b79d72b7308adf8abfbff56c9cfce9d7d73b31cd080453eee",
    "resource": "819180c07dfbf979de6ec584af19e99ae0829ce6e8d8b9a8c6e51e56db0e9822",
}
LUT_SHA256 = "f9f142849b99e77d5b9174b054c7634d0945f6fd731c4133def07900d0bd9239"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def raw(path, width, height):
    data = path.read_bytes()
    require(len(data) == width * height * 4, f"Wrong RGBA byte count: {path}")
    return data


def flip_rows(data, width, height):
    stride = width * 4
    require(len(data) == stride * height, "Cannot flip malformed RGBA")
    return b"".join(data[y * stride:(y + 1) * stride] for y in range(height - 1, -1, -1))


def metrics(actual, expected, packed=False):
    require(len(actual) == len(expected) and len(actual) > 0 and len(actual) % 4 == 0, "Invalid metric inputs")
    errors = [abs(a - b) for a, b in zip(actual, expected)]
    result = {"rgba_mae": sum(errors) / len(errors), "rgba_max": max(errors),
              "different_bytes": sum(value != 0 for value in errors), "bytes": len(errors)}
    if packed:
        # A byte carry can make raw-channel MAE large while decoded intensity barely changes.
        decoded = [abs((actual[i] - expected[i]) + (actual[i + 1] - expected[i + 1]) / 255)
                   for i in range(0, len(actual), 2)]
        result["decoded_pair_mae_8bit_units"] = sum(decoded) / len(decoded)
        result["decoded_pair_max_8bit_units"] = max(decoded)
    return result


def uniform(row, name, expected):
    matches = [item for item in row["uniforms"] if item["name"] == name]
    require(len(matches) == 1, f"Missing/ambiguous profile uniform {name}")
    values = matches[0].get("values", [])
    require(len(values) == len(expected) and all(
        math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-7) for a, b in zip(values, expected)
    ), f"Changed profile uniform {name}")


def validate_profile(rows, width, height):
    require(len(rows) == 42, "Expected three frames of 12 draws and two blits")
    gw, gh = max(1, width // 2), max(1, height // 2)
    # The default quality is binary32 0.2, promoted to double before resolution planning.
    glow_width = min(width, 0.20000000298023224 * 1200)
    lw, lh = math.floor(glow_width), math.floor(height * glow_width / width)
    sizes = [(gw, gh)] * 3 + [(width, height)] * 2 + [(lw, lh)] * 5 + [(width, height)] * 4
    require(lh > 0, "Empty native Glow target")
    for sequence, row in enumerate(rows):
        stage = sequence % 14
        require(row["draw"] == sequence and row["internalFormat"] == 0x8058, "Sequence/target format changed")
        require((row["width"], row["height"]) == sizes[stage], "Stage dimensions changed")
        require(row["kind"] == ("blit" if stage in (0, 3) else "draw"), "Draw/blit topology changed")
        if stage in (0, 3):
            expected = [0, height, width, 0, 0, 0, gw, gh] if stage == 0 else [0, gh, gw, 0, 0, 0, width, height]
            require(row["blitCoordinates"] == expected, "Blit orientation changed")
            require(row["blitMask"] == 0x4000 and row["blitFilter"] == 0x2601, "Blit must copy color with GL_LINEAR")
        for item in row["uniforms"]:
            if item["type"] == 0x8B5E:
                require(type(item["sampler"]) is int and item["sampler"] >= 0, "Missing sampler identity")
                if item["texture"] == 0:
                    require((stage in (4, 12) and item["name"] == "u_maskTexture") or
                            (stage == 10 and item["name"] == "bgTexture"), "Required texture is unbound")
                    continue
                require(item["min"] == 0x2601 and item["mag"] == 0x2601, "Sampler filter changed")
                mirrored = stage in (6, 7, 8, 9) or (stage == 10 and item["name"] in ("blurTexture1", "blurTexture2"))
                border = 0x8370 if mirrored else 0x812F
                require(item["wrapS"] == border and item["wrapT"] == border, "Sampler border changed")
        if stage in (1, 2):
            uniform(row, "u_Is_Y_up", [1])
            uniform(row, "u_gamma", [2.2])
            uniform(row, "u_spaceDither", [0])
        if stage == 4:
            uniform(row, "u_is_texture_0_flip_", [0, 1, 1, 0])
            uniform(row, "u_blendMode", [7])
            uniform(row, "u_alpha", [0.7])
        if stage == 5:
            uniform(row, "threshold", [0.84])
        if stage in (6, 7, 8, 9):
            uniform(row, "dither", [1])
            uniform(row, "edgeMode", [1])
        if stage == 10:
            uniform(row, "brightness", [2.4])
        if stage == 11:
            uniform(row, "uniAlpha", [0.8])
        if stage == 12:
            uniform(row, "u_Is_Y_up", [-1])
            uniform(row, "u_layerOpacity", [0.64])
    return sizes


def load_capture(root):
    manifest = json.loads((root / "capture.json").read_text())
    require(manifest["profile"] == "d634-soft-glow-cgl-rgba8-v1" and manifest["observerEnabled"] is True, "Wrong capture profile")
    require(all(manifest[key] == value for key, value in IDENTITIES.items()), "Runtime/resource identity changed")
    width, height = manifest["width"], manifest["height"]
    require(type(width) is int and type(height) is int and 1 <= width <= 2048 and 1 <= height <= 2048, "Invalid dimensions")
    source = raw(Path(manifest["inputPath"]), width, height)
    require(sha(source) == manifest["inputSha256"], "Input hash changed")
    rows = [json.loads(line) for line in (root / "draws.ndjson").read_text().split("\n") if line]
    sizes = validate_profile(rows, width, height)
    canonical = {}
    for frame in range(3):
        for index, name in enumerate(NAMES):
            w, h = sizes[index]
            data = raw(root / f"{frame * 14 + index}.rgba", w, h)
            # Derived from both reversed blit rectangles and the native layer/copy orientation.
            if index in VERTICAL_FLIPS:
                data = flip_rows(data, w, h)
            if frame == 0:
                canonical[name] = data
            else:
                require(data == canonical[name], f"Native intermediate changed between frames: {name}")
        final = raw(root / f"output-{frame}.rgba", width, height)
        require(sha(final) == manifest["hashes"][frame], "Native output hash changed")
        require(final == canonical["06-output"], "Final capture/provider orientation or topology differs")
    canonical["00-input"] = source
    return manifest, canonical


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--replay-cli", type=Path, required=True)
    parser.add_argument("--pipeline-cli", type=Path, required=True)
    parser.add_argument("--lut", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    repository = Path(__file__).resolve().parents[3]
    require(not output.is_relative_to(repository), "Native evidence must be outside the repository")
    require(not output.exists(), "Analysis output must be a new directory")
    require(sha(args.lut.read_bytes()) == LUT_SHA256, "LUT identity differs from the capture profile")
    manifest, native = load_capture(args.capture.resolve())
    normalized = output / "native"
    normalized.mkdir(parents=True)
    for name, data in native.items():
        (normalized / f"{name}.rgba").write_bytes(data)
    replayed, traced = output / "isolated", output / "pipeline"
    subprocess.run([str(args.replay_cli.resolve()), str(normalized), str(manifest["width"]),
                    str(manifest["height"]), str(args.lut.resolve()), str(replayed)], check=True)
    subprocess.run([str(args.pipeline_cli.resolve()), "--input", str(normalized / "00-input.rgba"),
                    "--width", str(manifest["width"]), "--height", str(manifest["height"]),
                    "--lut", str(args.lut.resolve()), "--output", str(output / "pipeline.rgba"),
                    "--trace", str(traced)], check=True)
    stages = []
    for name in NAMES:
        result = {"stage": name, "native_sha256": sha(native[name]),
                  "pipeline": metrics((traced / f"{name}.rgba").read_bytes(), native[name], name in PACKED)}
        if name != "06-output":
            result["isolated"] = metrics((replayed / f"{name}.rgba").read_bytes(), native[name], name in PACKED)
        stages.append(result)
    report = {"profile": manifest["profile"], "dimensions": [manifest["width"], manifest["height"]],
              "three_native_frames_stable": True, "final_readback_equals_provider": True,
              "bit_exact_claim": False, "stages": stages,
              "lut_sha256": sha(args.lut.read_bytes()), "capture": str(args.capture.resolve()),
              "replay_cli_sha256": sha(args.replay_cli.read_bytes()),
              "pipeline_cli_sha256": sha(args.pipeline_cli.read_bytes())}
    (output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(output), "stages": len(stages), "bit_exact_claim": False}))


if __name__ == "__main__":
    main()
