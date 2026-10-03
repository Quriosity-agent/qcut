"""Read-only report audit for the seven-frame temporal research profile.

This validates recorded evidence links, not raw neural tensors or fresh native
execution. A completed diagnostic remains failed; no coordinates are corrected.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from face_alignment_replay import LockedFiles, object_field, strict_json, valid_hash
from face_host_geometry_contract import integer, validate_sequence
import face_render_consumer_probe as consumer
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest

FRAME_COUNT, WARMUPS, SEEKS, PREDICTIONS, CONVERSIONS = 7, 6, 2, 26, 24
REPORT_LIMIT, REPLAY_LIMIT = 32 * 1024**2, 1024**2
STAGES = ("sampling", "stage1", "tracked", "tracked_to_returned", "returned_to_consumer", "normalized", "final_pixels")
PUBLISHED_STAGES = ("tracked_to_published", "published_to_returned")
SMOOTHING_STAGE = "owned_smoothing"


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def flag(*, row, key):
    value = row.get(key)
    require(condition=type(value) is bool, message=f"typed flag required: {key}")
    return value


def count(*, row, key, expected=None, maximum=4096):
    value = integer(value=row.get(key), maximum=maximum)
    require(condition=expected is None or value == expected, message=f"count mismatch: {key}")
    return value


def number(*, value, maximum=65536):
    require(condition=type(value) in (int, float) and 0 <= value <= maximum and math.isfinite(value),
            message="bounded finite nonnegative number required")
    return value


def hash_value(*, value):
    require(condition=valid_hash(value=value), message="lowercase SHA256 required")
    return value


def rows(*, value, length):
    require(condition=isinstance(value, list) and len(value) == length and all(isinstance(row, dict) for row in value),
            message="bounded ordered report objects required")
    return value


def metric(*, value):
    require(condition=isinstance(value, dict), message="point stage metric required")
    exact, within = (flag(row=value, key=key) for key in ("exact", "within"))
    errors = [number(value=value.get(key)) for key in ("max_abs", "mean_l2", "max_l2")]
    count(row=value, key="worst_point_index", maximum=105)
    require(condition=number(value=value.get("tolerance")) == 0 and within == exact
            and exact == all(error == 0 for error in errors), message="strict zero-tolerance metric required")
    return exact, errors[0]


def pixels(*, row, width, height):
    equal = flag(row=row, key="equal")
    changed = count(row=row, key="changed_pixels", maximum=width * height)
    delta = count(row=row, key="max_delta", maximum=255)
    hash_value(value=row.get("sha256"))
    bbox = row.get("bbox")
    if equal:
        require(condition=changed == delta == 0 and bbox is None, message="exact pixel metrics disagree")
    else:
        require(condition=changed > 0 and delta > 0 and isinstance(bbox, list) and len(bbox) == 4
                and all(type(value) is int for value in bbox)
                and 0 <= bbox[0] < bbox[2] <= width and 0 <= bbox[1] < bbox[3] <= height,
                message="changed pixel metrics disagree")
    return equal, delta


def request_profile(*, frames):
    requests = [(f"warmup-{index}", frames[0]["timestamp"]) for index in range(WARMUPS)]
    return requests + [(f"frame-{index:02d}", frame["timestamp"]) for index, frame in enumerate(frames)]


def validate_run(*, run, frames, restored_requests):
    profile = request_profile(frames=frames)
    expected = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\t{name}\t0" for name, _ in profile)]
    require(condition=run.get("protocol_rows") == expected and "reader_error" in run
            and run["reader_error"] is None and "close_error" not in run, message="host protocol failed")
    for key in ("owned_face_conversions", "owned_face_restorations"):
        count(row=run, key=key, expected=CONVERSIONS)
    hash_value(value=run.get("records_sha256"))
    for index, (request, (name, timestamp)) in enumerate(zip(rows(value=run.get("requests"), length=len(profile)), profile, strict=True)):
        require(condition=request.get("request_id") == name and flag(row=request, key="passed")
                and number(value=request.get("timestamp"), maximum=60) == timestamp, message="request timing/order failed")
        count(row=request, key="owned_face_conversions", expected=0 if index == 0 else SEEKS)
        if restored_requests:
            count(row=request, key="owned_face_restorations", expected=0 if index == 0 else SEEKS)


def source_hashes(*, reports):
    result = {}
    for report in reports:
        values = report.get("source_sha256")
        require(condition=isinstance(values, dict) and 0 < len(values) <= 128, message="nonempty source hashes required")
        for name, expected in values.items():
            require(condition=isinstance(name, str) and 0 < len(name) <= 4096 and ":" not in name and "\\" not in name
                    and not Path(name).is_absolute() and ".." not in Path(name).parts, message="invalid source path")
            hash_value(value=expected)
            require(condition=name not in result or result[name] == expected, message="cross-report source hash mismatch")
            result[name] = expected
    return result


def add_stage(*, stages, name, index, exact, error=0, participating=True):
    stages[name].append(dict(index=index, exact=exact, max_abs=error, participating=participating))


def summarize(*, checks):
    failed = [row["index"] for row in checks if not row["exact"]]
    required_failed = [row["index"] for row in checks if row["participating"] and not row["exact"]]
    return dict(compared=len(checks), exact=bool(checks) and not failed, failed_indices=failed,
                required_failed_indices=required_failed, max_abs=max((row["max_abs"] for row in checks), default=0))


def published_layers(*, snapshot, layer, stages, index):
    keys = {*PUBLISHED_STAGES, "published_observed", "published_to_returned_exact"}
    if not keys.intersection(layer):
        return False
    require(condition=keys.issubset(layer), message="partial published output layer")
    observed = bool(snapshot["faces"]) and all("published" in face for face in snapshot["faces"])
    require(condition=flag(row=layer, key="published_observed") == observed, message="published observation differs from snapshot")
    published = [face for face in snapshot["faces"] if face["active"] and "published" in face]
    results = {}
    for name in PUBLISHED_STAGES:
        results[name] = [metric(value=check) for check in rows(value=layer[name], length=len(published))]
        for exact, error in results[name]:
            add_stage(stages=stages, name=name, index=index, exact=exact, error=error, participating=index >= 2)
    expected = all(exact for exact, _ in results["published_to_returned"]) if observed else None
    require(condition=layer["published_to_returned_exact"] is expected, message="published-to-returned aggregate disagrees")
    return observed


def smoothing_case(*, snapshot, case, prior_identity, stages):
    value = case.get("temporal_smoothing")
    require(condition=isinstance(value, dict) and flag(row=value, key="passed"), message="passed owned smoothing evidence required")
    seed = flag(row=value, key="native_seed_used")
    active = [face for face in snapshot["faces"] if face["active"]]
    checks = value.get("checks")
    require(condition=isinstance(checks, dict), message="owned smoothing state metrics required")
    if not active:
        require(condition=value.get("mode") == "no-face" and not seed and not checks, message="no-face smoothing must clear history")
        return None, False
    face = active[0]
    identity = (face["slot"], face["alignment"], face["id"])
    states = face.get("smoothing")
    require(condition=isinstance(states, list) and len(states) == 2, message="captured smoothing partitions required")
    initialized = all(state["first"] for state in states)
    require(condition=initialized == any(state["first"] for state in states), message="partial smoothing initialization rejected")
    mode = "owned-input-initialization" if initialized else (
        "owned-history-update" if identity == prior_identity else "native-initialization-seed")
    require(condition=value.get("mode") == mode and seed == (mode == "native-initialization-seed")
            and flag(row=value, key="native_initialization_signal_required"), message="owned smoothing transition/seed provenance differs")
    routing = snapshot.get("runtime_state", {})
    require(condition=routing.get("base_output_mode_bit") is False and routing.get("optimized_output_bit") is False
            and type(routing.get("config_cache_mode")) is int and routing["config_cache_mode"] <= 0,
            message="owned smoothing route differs")
    require(condition=set(checks) == ({"current"} if initialized else {"current", "previous", "delta"}),
            message="missing owned smoothing state checks")
    results = [metric(value=check) for check in checks.values()]
    exact = all(row[0] for row in results)
    require(condition=value["passed"] == exact, message="owned smoothing aggregate differs")
    add_stage(stages=stages, name=SMOOTHING_STAGE, index=snapshot["index"], exact=exact,
              error=max(row[1] for row in results))
    return identity, seed


def sampling_window(*, capture, snapshot, association, sampling, used):
    index = snapshot["index"]
    count(row=association, key="prediction", expected=index)
    count(row=sampling, key="prediction", expected=index)
    window = association.get("neural_window")
    require(condition=isinstance(window, list) and len(window) == 2, message="neural window required")
    lower, upper = [integer(value=value, maximum=4096) for value in window]
    require(condition=lower <= upper == snapshot["bytenn_sequence"], message="neural window upper marker differs")
    inferences = association.get("inferences")
    require(condition=isinstance(inferences, list) and len(inferences) <= 2, message="single-face neural window required")
    selected = []
    for item in inferences:
        require(condition=isinstance(item, dict), message="typed inference descriptor required")
        size = count(row=item, key="size", maximum=160)
        require(condition=size in (120, 160), message="unsupported inference size")
        inference = count(row=item, key="inference", maximum=128)
        marker = count(row=item, key="record_index", maximum=4095)
        identity = str(snapshot["predictors"][0 if size == 120 else 1]["network"])
        require(condition=item.get("network") == identity and lower <= marker < upper, message="inference owner/window differs")
        key = (size, identity, inference)
        require(condition=key not in used, message="inference reused across predictions")
        used.add(key)
        if size == 120:
            selected.append(item)
    require(condition=len(selected) <= 1, message="multiple 120 inferences unresolved")
    if not selected:
        require(condition=flag(row=sampling, key="idle") and sampling == dict(prediction=index, idle=True)
                and not any(face["active"] for face in snapshot["faces"]), message="explicit idle no-face sampling required")
        return None, len(inferences)
    require(condition="idle" not in sampling and count(row=sampling, key="inference", expected=selected[0]["inference"]) >= 0,
            message="sampling inference mismatch")
    slot = count(row=sampling, key="slot", maximum=9)
    faces = [face for face in snapshot["faces"] if face["slot"] == slot]
    require(condition=len(faces) == 1 and flag(row=sampling, key="active") == faces[0]["active"], message="sampling slot/active state differs")
    descriptors = capture["algorithm_frames"]
    require(condition=sampling.get("algorithm_frame_sha256") == descriptors[index]["sha256"], message="sampling algorithm frame hash differs")
    networks = object_field(value=object_field(value=capture, name="captures"), name="networks")
    network = object_field(value=networks, name=selected[0]["network"])
    inputs = network.get("inputs", [])
    require(condition=isinstance(inputs, list) and len(inputs) <= 4096, message="bounded input metadata required")
    matching = [item for item in inputs if isinstance(item, dict) and item.get("name") == "data"
                and type(item.get("inference")) is int and item["inference"] == selected[0]["inference"]]
    require(condition=len(matching) == 1 and hash_value(value=sampling.get("input_sha256")) == matching[0].get("sha256"),
            message="sampling input metadata hash differs")
    return flag(row=sampling, key="sampling_exact"), len(inferences)


def audit_reports(*, capture, sequence_replay, sequence_render, capture_sha256, replay_sha256, manifest_sha256, replay_payload):
    reports = (capture, sequence_replay, sequence_render)
    require(condition=all(isinstance(report, dict) for report in reports), message="three report objects required")
    for report in reports:
        for key in ("passed", "native_analysis_bypassed"):
            flag(row=report, key=key)
        require(condition=isinstance(report.get("failures"), list) and len(report["failures"]) <= 64,
                message="bounded report failures required")
    sources = source_hashes(reports=reports)
    owned_smoothing = (flag(row=sequence_replay, key="owned_temporal_smoothing_used")
                       if "owned_temporal_smoothing_used" in sequence_replay else False)
    if owned_smoothing:
        require(condition=flag(row=sequence_replay, key="native_smoothing_initialization_required"),
                message="native smoothing initialization dependency must remain explicit")
    for expected in (capture_sha256, replay_sha256, manifest_sha256):
        hash_value(value=expected)
    require(condition=sequence_replay.get("capture_sha256") == sequence_render.get("capture_sha256") == capture_sha256,
            message="capture SHA link differs")
    require(condition=sequence_replay.get("replay_sha256") == sequence_render.get("replay_sha256") == replay_sha256,
            message="replay SHA link differs")
    require(condition=sequence_render.get("manifest_sha256") == manifest_sha256, message="manifest SHA link differs")
    cap_flags = [flag(row=capture, key=key) for key in ("geometry_observer_only", "observer_pixel_parity_verified", "per_prediction_inference_association_verified")]
    replay_flags = {key: flag(row=sequence_replay, key=key) for key in (
        "completed", "geometry_exact", "diagnostic_only", "independent_120_sampling_input_used", "returned_result_observed",
        "returned_to_consumer_exact", "per_active_face_id_association_verified")}
    render_flags = {key: flag(row=sequence_render, key=key) for key in ("completed", "diagnostic_only", "external_replay_verified", "pixel_parity_verified")}
    width, height = (count(row=capture, key=key, maximum=4096) for key in ("width", "height"))
    require(condition=width > 0 and height > 0, message="nonzero dimensions required")
    for key, value in (("width", width), ("height", height), ("warmup_requests_per_host", WARMUPS), ("seeks_per_request", SEEKS)):
        for report in (capture, sequence_render):
            count(row=report, key=key, expected=value)
    count(row=capture, key="predictions", expected=PREDICTIONS)
    count(row=sequence_replay, key="manifest_frames", expected=FRAME_COUNT)
    frames = rows(value=capture.get("frames"), length=FRAME_COUNT)
    require(condition=sequence_render.get("frames") == frames, message="render manifest frames differ")
    for frame in [*frames, *sequence_render["frames"]]:
        number(value=frame.get("timestamp"), maximum=60)
        flag(row=frame, key="expect_change")
        for key in ("image_sha256", "input_rgba_sha256"):
            hash_value(value=frame.get(key))
    profile_times = [stamp for _, stamp in request_profile(frames=frames) for _ in range(SEEKS)]
    timing = [math.floor(stamp * 1_000_000 + 0.5) for stamp in profile_times[2:]]
    require(condition=timing == sorted(timing), message="monotonic conversion timing required")
    for report, names in ((capture, ("baseline", "observed")), (sequence_render, ("candidate",))):
        runs = rows(value=report.get("runs"), length=len(names))
        require(condition=[run.get("name") for run in runs] == list(names), message="fresh host run names differ")
        for run in runs:
            validate_run(run=run, frames=frames, restored_requests=report is capture)
    snapshots = validate_sequence(records=capture.get("geometry_snapshots"), temporal=True)
    require(condition=len(snapshots) == PREDICTIONS, message="26 geometry predictions required")
    associations = rows(value=capture.get("prediction_inferences"), length=PREDICTIONS)
    sampling = rows(value=sequence_replay.get("sampling_cases"), length=PREDICTIONS)
    cases = rows(value=sequence_replay.get("cases"), length=PREDICTIONS)
    descriptors = rows(value=capture.get("algorithm_frames"), length=PREDICTIONS)
    consumer.validate_replay(value=replay_payload, width=width, height=height, image_hash=manifest_sha256,
                             maximum_timestamp_us=consumer.REPLAY_TIME_LIMIT_US)
    payload_frames = rows(value=replay_payload["frames"], length=CONVERSIONS)
    require(condition=[frame["timestamp_us"] for frame in payload_frames] == timing, message="replay timing differs from manifest")
    stages, used, neural_count, gaps, no_face = {name: [] for name in (*STAGES, *PUBLISHED_STAGES, SMOOTHING_STAGE)}, set(), 0, [], []
    published_predictions = []
    prior_identity, seed_predictions = None, []
    lower = 0
    for index, (snapshot, association, sample, case, descriptor) in enumerate(zip(snapshots, associations, sampling, cases, descriptors, strict=True)):
        count(row=descriptor, key="prediction", expected=index)
        count(row=descriptor, key="bytes", expected=snapshot["request"][1] * snapshot["request"][2] * 4, maximum=64 * 1024**2)
        require(condition=descriptor.get("file") == f"frame-{index}.rgba", message="algorithm frame filename differs")
        hash_value(value=descriptor.get("sha256"))
        sampled, inferred = sampling_window(capture=capture, snapshot=snapshot, association=association, sampling=sample, used=used)
        require(condition=association["neural_window"][0] == lower, message="neural window gap")
        lower, neural_count = snapshot["bytenn_sequence"], neural_count + inferred
        if sampled is not None:
            add_stage(stages=stages, name="sampling", index=index, exact=sampled)
        active = [face for face in snapshot["faces"] if face["active"]]
        require(condition=len(active) <= 1, message="multi-face association remains unresolved")
        count(row=case, key="prediction", expected=index)
        for key in ("active_faces", "published_faces"):
            count(row=case, key=key, expected=len(active), maximum=10)
        require(condition=flag(row=case, key="idle") == (sampled is None), message="idle inference association differs")
        checks = case.get("checks")
        keys = {"stage1", "tracked", *(["normalized"] if index >= 2 else [])} if active else set()
        require(condition=isinstance(checks, dict) and set(checks) == keys, message="missing or unexpected geometry stage")
        for name, check in checks.items():
            exact, error = metric(value=check)
            add_stage(stages=stages, name=name, index=index, exact=exact, error=error)
        if index >= 2:
            count(row=case, key="timestamp_us", expected=timing[index - 2], maximum=consumer.REPLAY_TIME_LIMIT_US)
            require(condition=[face["id"] for face in payload_frames[index - 2]["faces"]] == [face["id"] for face in active],
                    message="replay face counts/IDs differ from actual prediction")
            if not active:
                no_face.append(index)
        else:
            require(condition=case.get("timestamp_us") is None, message="cold prediction must not have conversion timing")
        layer = case.get("native_output_layers")
        require(condition=isinstance(layer, dict) and isinstance(snapshot.get("returned_result"), dict), message="missing returned output layer")
        count(row=layer, key="returned_faces", expected=len(active), maximum=10)
        count(row=snapshot["returned_result"], key="count", expected=len(active), maximum=10)
        require(condition=flag(row=layer, key="consumer_observed") == (index >= 2), message="consumer observation count differs")
        post = rows(value=layer.get("tracked_to_returned"), length=len(active))
        returned = rows(value=layer.get("returned_to_consumer"), length=len(active) if index >= 2 else 0)
        post_results = [metric(value=check) for check in post]
        returned_results = [metric(value=check) for check in returned]
        changed = any(not exact for exact, _ in post_results)
        require(condition=flag(row=layer, key="post_tracking_changed") == changed, message="post-tracking flag disagrees")
        if changed:
            gaps.append(index)
        returned_exact = all(exact for exact, _ in returned_results) if index >= 2 else None
        require(condition=layer.get("returned_to_consumer_exact") is returned_exact, message="returned-to-consumer flag disagrees")
        for name, results in (("tracked_to_returned", post_results), ("returned_to_consumer", returned_results)):
            for exact, error in results:
                add_stage(stages=stages, name=name, index=index, exact=exact, error=error, participating=index >= 2)
        if published_layers(snapshot=snapshot, layer=layer, stages=stages, index=index):
            published_predictions.append(index)
        if owned_smoothing:
            prior_identity, seeded = smoothing_case(snapshot=snapshot, case=case, prior_identity=prior_identity, stages=stages)
            if seeded:
                seed_predictions.append(index)
        else:
            require(condition="temporal_smoothing" not in case, message="undeclared owned smoothing evidence rejected")
    if owned_smoothing:
        declared_seeds = sequence_replay.get("native_smoothing_seed_predictions")
        require(condition=isinstance(declared_seeds, list) and len(declared_seeds) <= PREDICTIONS
                and all(type(index) is int for index in declared_seeds)
                and declared_seeds == seed_predictions
                and len(published_predictions) == PREDICTIONS, message="owned smoothing seed/publication summary differs")
    count(row=sequence_replay, key="head_comparisons", expected=neural_count * 5)
    require(condition=sequence_replay.get("post_tracking_gap_predictions") == gaps, message="post-tracking prediction summary disagrees")
    for index, (baseline, comparison) in enumerate(zip(rows(value=capture.get("comparisons"), length=FRAME_COUNT),
                                                     rows(value=sequence_render.get("comparisons"), length=FRAME_COUNT), strict=True)):
        for row in (baseline, comparison):
            count(row=row, key="index", expected=index)
        require(condition=pixels(row=baseline, width=width, height=height)[0]
                and baseline.get("baseline_sha256") == baseline["sha256"] == comparison.get("baseline_sha256"),
                message="neutral baseline pixel/hash link differs")
        exact, error = pixels(row=comparison, width=width, height=height)
        require(condition=exact == (comparison["sha256"] == comparison["baseline_sha256"]), message="pixel equality/hash link disagrees")
        for report, expected in ((capture, baseline["sha256"]), (sequence_render, comparison["sha256"])):
            require(condition=all(run["requests"][WARMUPS + index].get("sha256") == expected for run in report["runs"]),
                    message="render request/comparison hash differs")
        effect = comparison.get("versus_input")
        require(condition=isinstance(effect, dict), message="effect control metrics required")
        input_equal, _ = pixels(row=effect, width=width, height=height)
        require(condition=effect["sha256"] == comparison["sha256"]
                and input_equal == (effect["sha256"] == frames[index]["input_rgba_sha256"])
                and (not frames[index]["expect_change"] or not input_equal),
                message="effect control is missing or unchanged")
        add_stage(stages=stages, name="final_pixels", index=index, exact=exact, error=error)
    summaries = {name: summarize(checks=checks) for name, checks in stages.items()}
    geometry_exact = all(row["exact"] for name in ("stage1", "tracked", "normalized") for row in stages[name])
    require(condition=replay_flags["geometry_exact"] == geometry_exact
            and render_flags["pixel_parity_verified"] == summaries["final_pixels"]["exact"], message="aggregate parity flags disagree")
    require(condition=replay_flags["returned_to_consumer_exact"] == all(row["exact"] for row in stages["returned_to_consumer"]),
            message="returned-to-consumer aggregate disagrees")
    completed = capture["passed"] and all(cap_flags) and replay_flags["completed"] and render_flags["completed"]
    parity_flags = completed and all(report["passed"] and not report["failures"] and not report["native_analysis_bypassed"] for report in reports)
    pipeline = parity_flags and all(replay_flags[key] for key in ("independent_120_sampling_input_used", "returned_result_observed", "per_active_face_id_association_verified"))
    pipeline = pipeline and render_flags["external_replay_verified"] and not replay_flags["diagnostic_only"]
    # Raw tracked points intentionally differ after smoothing; gate the owned filtered output instead.
    required_stages = [name for name in STAGES if not owned_smoothing or name != "tracked_to_returned"]
    if owned_smoothing:
        required_stages.extend((SMOOTHING_STAGE, "published_to_returned"))
    pipeline = pipeline and all(summaries[name]["compared"] > 0 and not summaries[name]["required_failed_indices"] for name in required_stages)
    return dict(completed=completed, pipeline_parity=bool(pipeline), passed=bool(pipeline),
                audit_scope="recorded report links and metrics; no raw tensor or fresh native revalidation",
                raw_evidence_revalidated=False, product_parity_verified=False, full_frame_geometry_independent=False,
                source_hashes_verified=False, source_count=len(sources), predictions=PREDICTIONS,
                owned_temporal_smoothing_used=owned_smoothing, native_smoothing_initialization_required=owned_smoothing,
                native_smoothing_seed_predictions=seed_predictions,
                conversions=CONVERSIONS, manifest_frames=FRAME_COUNT, head_comparisons=neural_count * 5,
                no_face_predictions=no_face, published_observed_predictions=published_predictions, stages=summaries,
                report_flags={name: {key: report.get(key) for key in ("passed", "completed", "diagnostic_only")}
                              for name, report in zip(("capture", "sequence_replay", "sequence_render"), reports, strict=True)})


def load_report(*, path, locked):
    path = path.resolve(strict=True)
    path = path / "report.json" if path.is_dir() else path
    value = strict_json(data=locked.read(path=path, maximum=REPORT_LIMIT))
    require(condition=isinstance(value, dict), message="report JSON object required")
    return path, value


def run(*, args):
    out = sequence.fresh_output(path=args.out)
    locked, result = LockedFiles(), dict(completed=False, pipeline_parity=False, passed=False, failures=[])
    try:
        cap_path, capture = load_report(path=args.capture, locked=locked)
        replay_path, replay = load_report(path=args.sequence_replay, locked=locked)
        render_path, render = load_report(path=args.sequence_render, locked=locked)
        candidate = Path(render.get("candidate", ""))
        require(condition=candidate.is_absolute() and candidate.parent.resolve(strict=True) == replay_path.parent
                and Path(render.get("capture", "")).resolve(strict=True) == cap_path.parent,
                message="render candidate/capture path link differs")
        payload = strict_json(data=locked.read(path=candidate, maximum=REPLAY_LIMIT, expected=hash_value(value=replay.get("replay_sha256"))))
        manifest = Path(capture.get("manifest", ""))
        require(condition=manifest.is_absolute(), message="absolute captured manifest required")
        expected = hash_value(value=capture.get("fixture_sha256", {}).get(str(manifest)))
        manifest_data = locked.read(path=manifest, maximum=sequence.MANIFEST_LIMIT, expected=expected)
        frames = sequence.validate_manifest(value=strict_json(data=manifest_data), base=manifest.parent)
        require(condition=len(frames) == FRAME_COUNT and all(all(frame.get(key) == value for key, value in original.items())
                for frame, original in zip(capture["frames"], frames, strict=True)), message="actual manifest differs from report")
        result.update(audit_reports(capture=capture, sequence_replay=replay, sequence_render=render,
            capture_sha256=locked.files[str(cap_path)], replay_sha256=locked.files[str(candidate)],
            manifest_sha256=digest(data=manifest_data), replay_payload=payload))
        source_root = getattr(args, "current_source_root", None)
        if source_root is not None:
            source_root = source_root.resolve(strict=True)
            for name, expected in source_hashes(reports=(capture, replay, render)).items():
                path = source_root / name
                require(condition=path.resolve(strict=True).is_relative_to(source_root), message="source escapes current-source root")
                locked.read(path=path, maximum=sequence.LOG_LIMIT, expected=expected)
            result["source_hashes_verified"] = True
        locked.verify()
        result["report_sha256"] = {name: locked.files[str(path)] for name, path in
            (("capture", cap_path), ("sequence_replay", replay_path), ("sequence_render", render_path))}
    except Exception as error:
        result.update(completed=False, pipeline_parity=False, passed=False)
        result["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        (out / "report.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "sequence-replay", "sequence-render", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--current-source-root", type=Path)
    result = run(args=parser.parse_args())
    print(json.dumps({key: result[key] for key in ("completed", "pipeline_parity", "source_hashes_verified")}, allow_nan=False))
    return 0 if result["pipeline_parity"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
