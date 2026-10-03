"""Bounded local seven-frame campaigns; no network, installs or diagnostic fallback.

Each of 1-4 explicit manifests runs capture -> owned replay -> render -> audit.
Native detection/rendering remain required. Only the audited profile is claimed.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time

from face_alignment_replay import LockedFiles, strict_json, valid_hash
from face_geometry_native import MODEL, MODEL_SHA256
from face_host_geometry_contract import validate_sequence
import face_host_geometry_sequence_probe as probe
import face_host_geometry_sequence_replay as replay
import face_render_consumer_probe as consumer
from face_render_injection_inventory import LIBRARY_SHA256 as CORE_SHA256
import face_render_model_parity as parity
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest
import face_temporal_capture_audit as audit

SOURCE_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_ROOT = Path(__file__).resolve().parent
SCRIPTS = {
    "probe": "face_host_geometry_sequence_probe.py", "replay": "face_host_geometry_sequence_replay.py",
    "render": "face_host_geometry_sequence_render.py", "audit": "face_temporal_capture_audit.py",
}
RUNTIME_HASHES = {"libcccreator.dylib": CORE_SHA256, "libAGFX.dylib": consumer.GRAPHICS_SHA256,
                  "liblens.dylib": probe.geometry.LIBRARY_SHA256, "libbytenn.dylib": probe.geometry.BYTENN_SHA256}
DIMENSIONS = (1448, 1086)
FILE_LIMIT, TREE_LIMIT, TREE_FILES = 256 * 1024**2, 384 * 1024**2, 2048
LOG_LIMIT, REPORT_LIMIT = 4 * 1024**2, 32 * 1024**2


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def bounded_integer(*, value, minimum, maximum):
    require(condition=type(value) is int and minimum <= value <= maximum, message="bounded typed campaign integer required")
    return value


def local_path(*, path, directory=False):
    path = consumer.protocol_path(path=Path(path).absolute())
    require(condition=path.is_dir() if directory else path.is_file(), message=f"existing local {'directory' if directory else 'file'} required: {path}")
    return path.resolve(strict=True) if directory else path


def file_fingerprint(*, path):
    resolved, before = path.resolve(strict=True), path.stat()
    require(condition=resolved.is_file() and 0 <= before.st_size <= FILE_LIMIT, message="bounded guard file required")
    value, count = hashlib.sha256(), 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024**2):
            count += len(chunk)
            require(condition=count <= FILE_LIMIT, message="guard file grew beyond limit")
            value.update(chunk)
    marker = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    after = path.stat()
    require(condition=path.resolve(strict=True) == resolved and count == before.st_size
            and marker == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), message="guard file changed during hashing")
    return dict(sha256=value.hexdigest(), identity=[str(resolved), *marker])


class TreeGuard:
    def __init__(self, *, root, source=False):
        self.root, self.source = root.resolve(strict=True), source
        self.files = self.snapshot()

    def snapshot(self):
        files, total = {}, 0
        for directory, folders, names in os.walk(self.root, followlinks=False):
            require(condition=len(files) + len(folders) + len(names) <= TREE_FILES, message="guard tree file count exceeded")
            for folder in folders:
                require(condition=not (Path(directory) / folder).is_symlink(), message="symlink directory in guard tree")
            for name in sorted(names):
                path = Path(directory) / name
                if self.source and (path.suffix not in (".py", ".mm", ".cpp", ".h") or name.endswith("_test.py")):
                    continue
                require(condition=path.resolve(strict=True).is_relative_to(self.root), message="guard file escapes tree")
                total += path.stat().st_size
                require(condition=total <= TREE_LIMIT, message="guard tree byte limit exceeded")
                files[str(path)] = file_fingerprint(path=path)
        require(condition=0 < len(files) <= TREE_FILES, message="nonempty bounded guard tree required")
        return files

    def verify(self):
        require(condition=self.snapshot() == self.files, message="source/runtime/model/package tree changed")


def read_report(*, path, locked):
    value = strict_json(data=locked.read(path=path, maximum=REPORT_LIMIT))
    require(condition=isinstance(value, dict), message="stage report object required")
    require(condition=audit.flag(row=value, key="passed") and value.get("failures") == [], message="stage report failed or partial")
    return value


def verify_sources(*, report, locked):
    sources = audit.source_hashes(reports=(report,))
    root = SOURCE_ROOT.resolve(strict=True)
    for name, expected in sources.items():
        path = root / name
        require(condition=path.resolve(strict=True).is_relative_to(root), message="report source escapes current root")
        locked.read(path=path, maximum=sequence.LOG_LIMIT, expected=expected)


def prepare(*, args, locked):
    from PIL import Image

    require(condition=isinstance(args.manifest, list) and 1 <= len(args.manifest) <= 4,
            message="1-4 explicit seven-frame manifests required; 24-frame campaigns unsupported")
    require(condition=type(args.owned_initialization) is bool, message="typed owned-initialization switch required")
    independent = getattr(args, "independent_160_sampling", False)
    require(condition=type(independent) is bool and (not independent or args.owned_initialization),
            message="typed independent-160-sampling requires owned-initialization")
    require(condition=not independent, message="independent-160-sampling is unsupported by the campaign audit profile")
    bounded_integer(value=args.stage_timeout, minimum=1, maximum=3600)
    bounded_integer(value=args.deadline, minimum=1, maximum=14400)
    paths = {name: local_path(path=getattr(args, name), directory=True) for name in ("base_capture", "models_root", "runtime", "package")}
    for name in ("warp_python", "ort_python"):
        paths[name] = local_path(path=getattr(args, name))
        require(condition=os.access(paths[name], os.X_OK), message="explicit executable Python path required")
        locked.read(path=paths[name], maximum=128 * 1024**2)
        config = paths[name].parent.parent / "pyvenv.cfg"
        if config.exists():
            locked.read(path=config, maximum=65536)
    baseline = read_report(path=paths["base_capture"] / "report.json", locked=locked)
    require(condition=baseline.get("native_analysis_bypassed") is False, message="active native baseline required")
    host, _, _ = probe.lock_baseline(capture=paths["base_capture"], locked=locked)
    require(condition=os.access(host, os.X_OK), message="compiled passed baseline host must be executable")
    models = locked.json(path=paths["models_root"] / "summary.json")
    parity.validate_export(exported=models)
    for side in (120, 160):
        name = f"align-{side}/artifacts/model.onnx"
        locked.read(path=paths["models_root"] / name, maximum=128 * 1024**2, expected=models["artifacts"][name])
    guards = [TreeGuard(root=SCRIPT_ROOT, source=True), TreeGuard(root=SOURCE_ROOT / "jianying-runtime-probe", source=True),
              TreeGuard(root=paths["runtime"] / "Models"), TreeGuard(root=paths["package"])]
    library_guards = {}
    for name, expected in RUNTIME_HASHES.items():
        path = paths["runtime"] / "Frameworks" / name
        library_guards[str(path)] = file_fingerprint(path=path)
        require(condition=library_guards[str(path)]["sha256"] == expected, message=f"unverified native library: {name}")
    native_model = paths["runtime"] / "Models" / MODEL.name
    require(condition=file_fingerprint(path=native_model)["sha256"] == MODEL_SHA256, message="unverified native face model")
    for name in SCRIPTS.values():
        path = SCRIPT_ROOT / name
        require(condition=not path.is_symlink() and path.resolve(strict=True).is_relative_to(SCRIPT_ROOT),
                message="whitelisted script escapes local source root")
        locked.read(path=path, maximum=sequence.LOG_LIMIT)
    manifests, identities = [], set()
    for path in args.manifest:
        path = local_path(path=path)
        identity = path.resolve(strict=True)
        require(condition=identity not in identities, message="duplicate campaign manifest")
        identities.add(identity)
        data = locked.read(path=path, maximum=sequence.MANIFEST_LIMIT)
        frames = sequence.validate_manifest(value=strict_json(data=data), base=path.parent)
        require(condition=len(frames) == 7, message="each campaign requires exactly seven manifest frames")
        for frame in frames:
            image = locked.read(path=local_path(path=frame["image"]), maximum=sequence.IMAGE_LIMIT)
            with Image.open(io.BytesIO(image)) as source:
                sequence.validate_dimensions(width=source.width, height=source.height, expected=DIMENSIONS)
                frame.update(image_sha256=digest(data=image), input_rgba_sha256=digest(data=source.convert("RGBA").tobytes()))
        require(condition=[frame["timestamp"] for frame in frames] == sorted(frame["timestamp"] for frame in frames), message="monotonic manifest timing required")
        manifests.append(dict(path=path, sha256=digest(data=data), frames=frames))
    return paths, guards, library_guards, manifests


def verify_guards(*, locked, guards, libraries):
    locked.verify()
    for guard in guards:
        guard.verify()
    for name, expected in libraries.items():
        require(condition=file_fingerprint(path=Path(name)) == expected, message="native runtime library changed")


def commands(*, paths, manifest, directory, owned_initialization, independent_160_sampling=False):
    outputs = {name: directory / name for name in SCRIPTS}
    argv = {
        "probe": ["--capture", paths["base_capture"], "--manifest", manifest["path"], "--runtime", paths["runtime"], "--package", paths["package"]],
        "replay": ["--capture", outputs["probe"], "--root", paths["models_root"], "--owned-smoothing"],
        "render": ["--capture", outputs["probe"], "--candidate", outputs["replay"] / "replay.json", "--runtime", paths["runtime"], "--package", paths["package"]],
        "audit": ["--capture", outputs["probe"], "--sequence-replay", outputs["replay"], "--sequence-render", outputs["render"], "--current-source-root", SOURCE_ROOT],
    }
    if owned_initialization:
        argv["replay"].append("--owned-initialization")
    if independent_160_sampling:
        argv["replay"].append("--independent-160-sampling")
    return {name: [str(paths["warp_python" if name in ("probe", "render") else "ort_python"]), "-B", "-u",
                   str(SCRIPT_ROOT / script), *(str(item) for item in argv[name]), "--out", str(outputs[name])]
            for name, script in SCRIPTS.items()}


def stop_process(*, process):
    for signum in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, signum)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=2)
            if signum == signal.SIGKILL:
                return
        except subprocess.TimeoutExpired:
            continue


def execute(*, command, log, deadline, timeout):
    environment = {key: value for key, value in os.environ.items() if key in ("HOME", "PATH", "LANG", "LC_ALL", "TMPDIR", "USER")}
    environment.update(PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1", PYTHONUNBUFFERED="1")
    end = min(deadline, time.monotonic() + timeout)
    if time.monotonic() >= end:
        raise TimeoutError("campaign deadline expired before stage")
    process = subprocess.Popen(command, shell=False, cwd=SCRIPT_ROOT, env=environment, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    code = None
    try:
        require(condition=process.stdout is not None, message="stage output pipe missing")
        with selectors.DefaultSelector() as selector, log.open("xb") as output:
            selector.register(process.stdout, selectors.EVENT_READ)
            total = 0
            while selector.get_map():
                remaining = end - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("stage or campaign deadline exceeded")
                for key, _ in selector.select(timeout=min(remaining, 0.1)):
                    data = os.read(key.fileobj.fileno(), 65536)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    require(condition=total + len(data) <= LOG_LIMIT, message="stage log exceeds byte limit")
                    total += len(data)
                    output.write(data)
            remaining = end - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("stage deadline exceeded before exit")
            try:
                code = process.wait(timeout=remaining)
                return code
            except subprocess.TimeoutExpired as error:
                raise TimeoutError("stage or campaign deadline exceeded") from error
    finally:
        if code != 0 or process.poll() is None:
            stop_process(process=process)
        if process.stdout is not None:
            process.stdout.close()


def validate_policy(*, value, owned_initialization, independent_160_sampling):
    actual_owned = audit.flag(row=value, key="owned_initialization_used") if "owned_initialization_used" in value else False
    actual_independent = (audit.flag(row=value, key="independent_160_sampling_input_used")
                          if "independent_160_sampling_input_used" in value else False)
    require(condition=actual_owned == owned_initialization and actual_independent == independent_160_sampling,
            message="actual initialization/sampling route differs from requested policy")
    if actual_owned:
        require(condition=not audit.flag(row=value, key="native_smoothing_seed_required")
                and value.get("native_smoothing_seed_predictions") == [], message="owned route still uses native point seeds")
        seeds = value.get("owned_smoothing_seed_predictions")
        require(condition=isinstance(seeds, list) and 1 <= len(seeds) <= 26
                and all(type(index) is int and 0 <= index < 26 for index in seeds)
                and seeds == sorted(set(seeds)), message="bounded ordered owned seed summary required")
    if actual_independent:
        require(condition=not audit.flag(row=value, key="native_160_sampling_input_required"),
                message="independent route still uses native 160 inputs")


def validate_stage(*, name, value, paths, manifest, directory, previous, locked, owned_initialization, independent_160_sampling):
    output = directory / name
    if name in ("replay", "audit"):
        validate_policy(value=value, owned_initialization=owned_initialization, independent_160_sampling=independent_160_sampling)
    if name != "audit":
        verify_sources(report=value, locked=locked)
        require(condition=value.get("native_analysis_bypassed") is False, message="native analysis bypass is not this profile")
    if name == "probe":
        require(condition=replay.validate_dynamic(evidence=value) == 7 and value.get("frames") == manifest["frames"], message="seven-frame capture profile differs")
        require(condition=value.get("manifest") == str(manifest["path"]) and value.get("capture") == str(paths["base_capture"])
                and value.get("runtime") == str(paths["runtime"]) and value.get("package") == str(paths["package"]), message="capture input path links differ")
        audit.count(row=value, key="predictions", expected=26)
        sequence.validate_dimensions(width=value.get("width"), height=value.get("height"), expected=DIMENSIONS)
        require(condition=len(validate_sequence(records=value.get("geometry_snapshots"), temporal=True)) == 26,
                message="partial geometry capture")
        if "completed" in value:
            require(condition=audit.flag(row=value, key="completed"), message="partial capture completion")
    else:
        require(condition=audit.flag(row=value, key="completed"), message="stage not completed")
    if name == "replay":
        for key in ("geometry_exact", "independent_120_sampling_input_used", "owned_temporal_smoothing_used"):
            require(condition=audit.flag(row=value, key=key), message=f"required producer flag failed: {key}")
        require(condition=audit.flag(row=value, key="diagnostic_only") is False and value.get("capture_sha256") == previous["probe"]["sha256"], message="producer diagnostic/capture link rejected")
        audit.count(row=value, key="manifest_frames", expected=7)
        cases = audit.rows(value=value.get("cases"), length=26)
        for index, case in enumerate(cases):
            audit.count(row=case, key="prediction", expected=index)
            active = audit.count(row=case, key="active_faces", maximum=1)
            audit.count(row=case, key="published_faces", expected=active)
            audit.flag(row=case, key="idle")
            checks = case.get("checks")
            keys = {"stage1", "tracked", *(["normalized"] if index >= 2 else [])} if active else set()
            require(condition=isinstance(checks, dict) and set(checks) == keys, message="partial producer geometry checks")
            for check in checks.values():
                require(condition=audit.metric(value=check)[0], message="producer geometry metric failed")
        payload_data = locked.read(path=output / "replay.json", maximum=1024**2, expected=audit.hash_value(value=value.get("replay_sha256")))
        payload = strict_json(data=payload_data)
        consumer.validate_replay(value=payload, width=DIMENSIONS[0], height=DIMENSIONS[1], image_hash=manifest["sha256"], maximum_timestamp_us=consumer.REPLAY_TIME_LIMIT_US)
        require(condition=len(payload["frames"]) == 24, message="producer requires 24 conversions")
    if name == "render":
        require(condition=audit.flag(row=value, key="external_replay_verified") and audit.flag(row=value, key="pixel_parity_verified")
                and audit.flag(row=value, key="diagnostic_only") is False, message="renderer parity or diagnostic failed")
        require(condition=value.get("capture_sha256") == previous["probe"]["sha256"]
                and value.get("replay_sha256") == previous["replay"]["value"]["replay_sha256"]
                and value.get("manifest_sha256") == manifest["sha256"] and value.get("frames") == manifest["frames"]
                and value.get("capture") == str(directory / "probe") and value.get("candidate") == str(directory / "replay/replay.json"), message="renderer report links differ")
        for index, comparison in enumerate(audit.rows(value=value.get("comparisons"), length=7)):
            audit.count(row=comparison, key="index", expected=index)
            require(condition=audit.pixels(row=comparison, width=DIMENSIONS[0], height=DIMENSIONS[1])[0], message="renderer pixel metrics failed")
    if name == "audit":
        require(condition=audit.flag(row=value, key="pipeline_parity") and audit.flag(row=value, key="source_hashes_verified"), message="completed audit is not pipeline parity")
        require(condition=value.get("report_sha256") == {key: previous[stage]["sha256"] for key, stage in
                (("capture", "probe"), ("sequence_replay", "replay"), ("sequence_render", "render"))}, message="audit report SHA links differ")
        for key, expected in (("predictions", 26), ("conversions", 24), ("manifest_frames", 7)):
            audit.count(row=value, key=key, expected=expected)
        require(condition=isinstance(value.get("stages"), dict) and set(audit.STAGES).issubset(value["stages"]), message="partial audit stage metrics")
        for name in ("sampling", "stage1", "tracked", "returned_to_consumer", "normalized", "final_pixels"):
            summary = value["stages"][name]
            require(condition=isinstance(summary, dict) and audit.count(row=summary, key="compared") > 0
                    and audit.flag(row=summary, key="exact") and summary.get("required_failed_indices") == [], message="partial or failed audit summary")


def run(*, args):
    out = sequence.fresh_output(path=args.out)
    start, locked = time.monotonic(), LockedFiles()
    report = dict(passed=False, completed=False, pipeline_parity=False, failures=[], campaigns=[],
                  profile=dict(manifest_frames=7, predictions=26, conversions=24, max_campaigns=4),
                  native_analysis_required=True, product_parity_verified=False, full_frame_geometry_independent=False,
                  owned_smoothing_requested=True, owned_initialization_requested=args.owned_initialization,
                  independent_160_sampling_requested=getattr(args, "independent_160_sampling", False))
    guards, libraries = [], {}
    try:
        paths, guards, libraries, manifests = prepare(args=args, locked=locked)
        deadline = start + args.deadline
        report.update(stage_timeout_seconds=args.stage_timeout, deadline_seconds=args.deadline,
                      python_paths={name: str(paths[name]) for name in ("warp_python", "ort_python")},
                      guard_sha256={str(guard.root): digest(data=json.dumps(guard.files, sort_keys=True).encode()) for guard in guards},
                      runtime_sha256={name: value["sha256"] for name, value in libraries.items()})
        for index, manifest in enumerate(manifests):
            directory = out / f"campaign-{index:02d}"
            directory.mkdir(mode=0o700)
            entry = dict(index=index, manifest=str(manifest["path"]), manifest_sha256=manifest["sha256"], completed=False, passed=False,
                         stages=[dict(name=name, status="pending", completed=False, passed=False) for name in SCRIPTS])
            report["campaigns"].append(entry)
        for entry, manifest in zip(report["campaigns"], manifests, strict=True):
            directory, previous = out / f"campaign-{entry['index']:02d}", {}
            argv = commands(paths=paths, manifest=manifest, directory=directory, owned_initialization=args.owned_initialization,
                            independent_160_sampling=getattr(args, "independent_160_sampling", False))
            for stage in entry["stages"]:
                stage_start, name = time.monotonic(), stage["name"]
                stage.update(status="running", command=argv[name])
                try:
                    verify_guards(locked=locked, guards=guards, libraries=libraries)
                    code = execute(command=argv[name], log=directory / f"{name}.log", deadline=deadline, timeout=args.stage_timeout)
                    stage["returncode"] = code
                    require(condition=type(code) is int and code == 0, message=f"{name} exited unsuccessfully: {code}")
                    value = read_report(path=directory / name / "report.json", locked=locked)
                    validate_stage(name=name, value=value, paths=paths, manifest=manifest, directory=directory, previous=previous, locked=locked,
                                   owned_initialization=args.owned_initialization,
                                   independent_160_sampling=getattr(args, "independent_160_sampling", False))
                    verify_guards(locked=locked, guards=guards, libraries=libraries)
                    if time.monotonic() >= deadline:
                        raise TimeoutError("campaign deadline expired during validation")
                    sha = locked.files[str(directory / name / "report.json")]
                    previous[name] = dict(value=value, sha256=sha)
                    stage.update(status="passed", completed=True, passed=True, report_sha256=sha)
                except Exception as error:
                    stage.update(status="timeout" if isinstance(error, TimeoutError) else "failed", error=f"{type(error).__name__}: {error}")
                    raise
                finally:
                    stage["elapsed_seconds"] = max(0, time.monotonic() - stage_start)
            entry.update(completed=True, passed=True)
        verify_guards(locked=locked, guards=guards, libraries=libraries)
        report.update(completed=True, passed=True, pipeline_parity=True)
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
    finally:
        for entry in report["campaigns"]:
            for stage in entry["stages"]:
                if stage["status"] == "pending":
                    stage["status"] = "skipped"
        report.update(elapsed_seconds=max(0, time.monotonic() - start), fixture_sha256=dict(locked.files))
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base-capture", "models-root", "runtime", "package", "warp-python", "ort-python", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--manifest", required=True, action="append", type=Path)
    parser.add_argument("--stage-timeout", type=int, default=900)
    parser.add_argument("--deadline", type=int, default=7200)
    parser.add_argument("--owned-initialization", action="store_true")
    parser.add_argument("--independent-160-sampling", action="store_true",
                        help="currently rejected: the campaign audit profile does not verify this route")
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("completed", "passed", "pipeline_parity", "failures")}, allow_nan=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
