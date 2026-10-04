"""Source-original RGBA production for the exact-gated seven-frame research chain.

Only the captured 1448x1086 packed format-0 -> 640x480 orientation-0 profile
is admitted. Native algorithm bytes are equality oracles, never sampler inputs.
"""
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from face_alignment_replay import valid_hash
from face_full_frame_quantization import resize_rgba
from face_full_frame_quantization_probe import prediction_frame, regular_path
from face_host_sampling_inputs import algorithm_frame
from face_render_stability_probe import digest

SOURCE_SIZE = (1448, 1086)
SOURCE_STRIDE = 5792
REQUEST = (0, 640, 480, 2560, 0)


def validate_request(*, request):
    if (type(request) is not list or len(request) != len(REQUEST) or
            any(type(value) is not int for value in request) or tuple(request) != REQUEST):
        raise ValueError("only packed format-0 640x480 orientation-0 algorithm request is verified")


def original_to_algorithm(*, data, source_size, source_stride, source_sha256, request):
    validate_request(request=request)
    if (type(source_size) is not tuple or len(source_size) != 2 or
            any(type(value) is not int for value in source_size) or source_size != SOURCE_SIZE or
            type(source_stride) is not int or source_stride != SOURCE_STRIDE or
            type(data) is not bytes or len(data) != SOURCE_STRIDE * SOURCE_SIZE[1] or
            not valid_hash(value=source_sha256) or digest(data=data) != source_sha256):
        raise ValueError("hash-pinned original packed 1448x1086 RGBA required; broader profiles unsupported")
    source = np.frombuffer(data, np.uint8).reshape(SOURCE_SIZE[1], SOURCE_SIZE[0], 4)
    pixels = resize_rgba(frame=source, size=REQUEST[1:3])
    return pixels.tobytes()


@dataclass(frozen=True, kw_only=True)
class OwnedAlgorithmFrames:
    pixels: tuple[bytes, ...]
    source_sha256: tuple[str, ...]

    def frame(self, *, snapshot, descriptor):
        validate_request(request=snapshot.get("request"))
        index = snapshot.get("index")
        source_index = prediction_frame(index=index)
        if (type(self.pixels) is not tuple or type(self.source_sha256) is not tuple or
                len(self.pixels) != 7 or len(self.source_sha256) != 7 or
                not valid_hash(value=self.source_sha256[source_index])):
            raise ValueError("complete immutable owned algorithm frame set required")
        data = self.pixels[source_index]
        if (type(data) is not bytes or len(data) != REQUEST[3] * REQUEST[2] or
                not isinstance(descriptor, dict) or type(descriptor.get("prediction")) is not int or
                descriptor["prediction"] != index or descriptor.get("file") != f"frame-{index}.rgba" or
                type(descriptor.get("bytes")) is not int or descriptor["bytes"] != len(data) or
                descriptor.get("sha256") != digest(data=data)):
            raise ValueError("owned algorithm bytes no longer match the exact-gated observation")
        return np.frombuffer(data, np.uint8).reshape(REQUEST[2], REQUEST[1], 4)


def build_frames(*, context, locked):
    root, evidence = context["root"], context["evidence"]
    original, frames, snapshots = context["original"], context["frames"], context["snapshots"]
    descriptors = evidence.get("algorithm_frames")
    if (len(frames) != 7 or len(snapshots) != 26 or not isinstance(descriptors, list) or
            len(descriptors) != 26 or snapshots != evidence.get("geometry_snapshots")):
        raise ValueError("complete seven-source 26-observation preprocessing context required")
    fixtures = evidence.get("fixture_sha256")
    report_path = regular_path(path=original / "report.json")
    if not isinstance(fixtures, dict) or not valid_hash(value=fixtures.get(str(report_path))):
        raise ValueError("original source capture report must be hash-bound")
    previous = locked.json(path=report_path, expected=fixtures[str(report_path)])
    for key, value in (("width", 1448), ("height", 1086), ("warmup_requests_per_host", 6),
                       ("seeks_per_request", 2)):
        if type(previous.get(key)) is not int or previous[key] != value:
            raise ValueError(f"original capture profile unverified: {key}")
    source_rows = previous.get("frames")
    if not isinstance(source_rows, list) or len(source_rows) != 7:
        raise ValueError("seven recorded original identities required")
    for index, snapshot in enumerate(snapshots):
        if type(snapshot.get("index")) is not int or snapshot["index"] != index:
            raise ValueError("prediction ordering changed")
        validate_request(request=snapshot.get("request"))
    pixels, identities, sources = [], [], []
    for index, (frame, row) in enumerate(zip(frames, source_rows, strict=True)):
        path = regular_path(path=original / f"input-{index:02d}.rgba")
        expected = row.get("input_rgba_sha256")
        if (not valid_hash(value=expected) or fixtures.get(str(path)) != expected or
                Path(frame["input"]).absolute() != path or
                type(frame["timestamp"]) not in (int, float) or
                type(row["timestamp"]) not in (int, float) or
                not np.isfinite(frame["timestamp"]) or not np.isfinite(row["timestamp"]) or
                frame["timestamp"] != row["timestamp"]):
            raise ValueError("original identity/order differs from recorded source frame")
        raw = locked.read(path=path, maximum=SOURCE_STRIDE * SOURCE_SIZE[1], expected=expected)
        data = original_to_algorithm(data=raw, source_size=SOURCE_SIZE, source_stride=SOURCE_STRIDE,
                                     source_sha256=expected, request=list(REQUEST))
        pixels.append(data)
        identities.append(expected)
        sources.append(dict(index=index, path=str(path), original_rgba_sha256=expected,
                            generated_algorithm_sha256=digest(data=data)))
    owned = OwnedAlgorithmFrames(pixels=tuple(pixels), source_sha256=tuple(identities))
    checks = []
    for snapshot, descriptor in zip(snapshots, descriptors, strict=True):
        reference = algorithm_frame(root=root, snapshot=snapshot, descriptor=descriptor, locked=locked)
        candidate = owned.frame(snapshot=snapshot, descriptor=descriptor)
        if not np.array_equal(candidate, reference):
            raise RuntimeError("original-pixel algorithm differs; native fallback/correction forbidden")
        index = snapshot["index"]
        checks.append(dict(prediction=index, frame_index=prediction_frame(index=index),
                           request=snapshot["request"], algorithm_exact=True,
                           original_rgba_sha256=identities[prediction_frame(index=index)],
                           generated_algorithm_sha256=digest(data=candidate.tobytes()),
                           oracle_sha256=descriptor["sha256"]))
    locked.verify()
    return owned, dict(source_frames=sources, observations=checks, algorithm="staged-q11",
                       source_size=list(SOURCE_SIZE), source_stride=SOURCE_STRIDE, request=list(REQUEST),
                       independent_full_frame_preprocessing=True, native_algorithm_rgba_input_used=False,
                       native_algorithm_rgba_oracle_required=True, native_caller_parameters_required=True,
                       arbitrary_frame_backend_connected=False, product_parity_verified=False)
