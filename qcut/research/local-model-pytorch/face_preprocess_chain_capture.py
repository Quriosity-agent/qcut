"""Validate the neutral preprocessing capture without rewriting its old profile."""
from pathlib import Path

from face_alignment_replay import strict_json, valid_hash
from face_host_geometry_contract import associate_inferences, validate_sequence
import face_host_geometry_probe as geometry
import face_host_geometry_sequence_probe as observed
import face_owned_replay_e2e as owned
import face_preprocess_probe as probe
import face_render_consumer_probe as consumer
import face_render_model_capture as models
import face_render_model_parity as parity
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest, frame_metrics


def load(*, root, locked):
    root = root.resolve(strict=True)
    evidence = locked.json(path=root / "report.json")
    if (evidence.get("passed") is not True or evidence.get("diagnostic_only") is not True or
            evidence.get("observer_pixel_parity_verified") is not True or
            evidence.get("native_analysis_bypassed") is not False or
            type(evidence.get("old_sources_verified")) is not int or evidence["old_sources_verified"] != 50):
        raise ValueError("passed neutral preprocessing capture with locked old sources required")
    fixtures = evidence.get("fixture_sha256")
    if (not isinstance(fixtures, dict) or not 1 <= len(fixtures) <= 4096 or
            any(not isinstance(name, str) or not Path(name).is_absolute() or not valid_hash(value=expected)
                for name, expected in fixtures.items())):
        raise ValueError("bounded absolute preprocessing fixture identities required")
    for name, expected in fixtures.items():
        locked.read(path=Path(name), maximum=128 * 1024**2, expected=expected)
    original = Path(evidence["capture"]).resolve(strict=True)
    audit = Path(evidence["audit"]).resolve(strict=True)
    if any(str(path / "report.json") not in fixtures for path in (original, audit)):
        raise ValueError("original capture and audit must be hash-bound")
    previous, runtime, package, files, frames = probe.lock_profile(capture=original, audit=audit, locked=locked,
        **probe.profile_report_arguments(evidence=evidence))
    if (evidence.get("runtime") != str(runtime) or evidence.get("package") != str(package) or
            evidence.get("host_sha256") != previous["host_sha256"]):
        raise ValueError("preprocessing runtime/package/host differs from locked profile")
    parity.validate_capture(captured=evidence, expected_comparisons=7)
    snapshots = observed.snapshots(directory=root / "geometry", locked=locked)
    validate_sequence(records=snapshots, temporal=True)
    if len(snapshots) != 26 or snapshots != evidence.get("geometry_snapshots"):
        raise ValueError("actual preprocessing predictions changed")
    descriptors = geometry.algorithm_frames(records=snapshots, directory=root / "geometry", locked=locked)
    if descriptors != evidence.get("algorithm_frames"):
        raise ValueError("actual preprocessing algorithm frames changed")
    inventory = models.inventory(capture=root / "capture")
    if inventory != evidence.get("captures"):
        raise ValueError("actual preprocessing neural inventory changed")
    observed.lock_inventory(inventory=inventory, directory=root / "capture", locked=locked)
    associations = associate_inferences(records=snapshots, networks=inventory["networks"], temporal=True,
        metadata=[models.metadata(path=path) for path in (root / "capture").glob("*.json")])
    if associations != evidence.get("prediction_inferences"):
        raise ValueError("actual preprocessing neural associations changed")
    trace = locked.json(path=root / "trace/trace.json")
    if trace != evidence.get("trace") or probe.validate_trace(
            trace=trace, records=snapshots, associations=associations) != evidence.get("cases"):
        raise ValueError("actual preprocessing hardware trace changed")
    for name in ("baseline", "observed"):
        if probe.validate_protocol(directory=root / name, frames=frames, locked=locked) != evidence.get(name):
            raise ValueError("actual preprocessing owned protocol changed")
    for index, comparison in enumerate(evidence["comparisons"]):
        pixels = [locked.read(path=root / name / f"frame-{index:02d}.rgba", maximum=1448 * 1086 * 4)
                  for name in ("baseline", "observed")]
        if (any(len(data) != 1448 * 1086 * 4 for data in pixels) or
                type(comparison.get("index")) is not int or comparison["index"] != index or
                comparison != dict(index=index, **frame_metrics(reference=pixels[0], actual=pixels[1],
                                                                width=1448, height=1086))):
            raise ValueError("actual preprocessing baseline/observed pixels changed")
    records = locked.read(path=root / "observed/records.jsonl", maximum=sequence.LOG_LIMIT,
                          expected=evidence["observed"]["records_sha256"])
    manifest = Path(previous["manifest"])
    native = owned.capture_replay(events=[strict_json(data=line) for line in records.splitlines()],
        width=1448, height=1086, image_hash=digest(data=locked.read(path=manifest, maximum=sequence.MANIFEST_LIMIT)),
        maximum_timestamp_us=consumer.REPLAY_TIME_LIMIT_US)
    if len(native["frames"]) != 24:
        raise ValueError("exact 24 owned conversion references required")
    return dict(root=root, evidence=evidence, original=original, runtime=runtime, package=package,
                host=files["host"], frames=frames, snapshots=snapshots, associations=associations, native=native)
