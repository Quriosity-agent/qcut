"""Read-only CPU audit of the fixed captured preprocessing/ONNX/render chain.

No inference or native renderer is run. Detector geometry, algorithm RGBA,
routing, tables and effect rendering remain native dependencies of this profile.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from espresso_graph import analyze
from face_alignment_heads_parity import comparisons
from face_alignment_replay import LockedFiles, valid_hash
import face_preprocess_chain_capture as capture
import face_preprocess_chain_render as chain_render
import face_preprocess_chain_replay as chain
import face_render_model_parity as parity
from face_render_stability_probe import digest, frame_metrics

MODEL_SOURCES = ("face_render_model_parity.py", "face_render_model_capture.py",
                 "face_alignment_heads_parity.py", "face_alignment_replay.py",
                 "espresso_onnx_runtime.py", "espresso_graph.py", "espresso_oracle.py",
                 "face_render_sequence_probe.py", "face_render_consumer_probe.py",
                 "face_render_stability_probe.py")


def same(*, actual, expected, label):
    # Python equality treats True as 1; evidence must preserve JSON types.
    if json.dumps(actual, sort_keys=True, allow_nan=False) != json.dumps(expected, sort_keys=True, allow_nan=False):
        raise ValueError(f"{label} differs from independently recomputed evidence")


def flags(*, evidence, positive=(), negative=()):
    if (any(evidence.get(key) is not True for key in positive) or
            any(evidence.get(key) is not False for key in negative) or evidence.get("failures") != []):
        raise ValueError("exact boolean acceptance/dependency flags and no failures required")


def fixtures(*, evidence, locked):
    values = evidence.get("fixture_sha256")
    if not isinstance(values, dict) or not 1 <= len(values) <= 4096:
        raise ValueError("bounded nonempty fixture hashes required")
    for name, expected in values.items():
        if (not isinstance(name, str) or not Path(name).is_absolute() or "\0" in name or
                ".." in Path(name).parts or not valid_hash(value=expected)):
            raise ValueError("absolute bounded fixture paths and SHA-256 required")
        chain_render.render.hashed(locked=locked, path=Path(name), expected=expected)


def declared_sources(*, evidence, expected, locked):
    values = evidence.get("source_sha256")
    if not isinstance(values, dict) or set(values) != set(expected):
        raise ValueError("complete fixed-profile source inventory required")
    chain_render.render.sources(locked=locked, evidence=evidence)


def model_heads(*, directory, model_root, context, evidence, inputs, locked):
    path = directory / "onnx/report.json"
    parity.require_sha256(value=evidence.get("model_report_sha256"))
    report = locked.json(path=path, expected=evidence.get("model_report_sha256"))
    flags(evidence=report, positive=("passed", "independent_120_sampling_input_used", "independent_160_sampling_input_used"),
          negative=("native_inference_called", "native_analysis_bypassed", "full_frame_geometry_independent"))
    same(actual=report.get("expected_comparisons"), expected=7, label="model frame count")
    same(actual=report.get("capture_sha256"), expected=evidence["capture_sha256"], label="model capture linkage")
    sources = report.get("source_sha256")
    if not isinstance(sources, dict) or set(sources) != set(MODEL_SOURCES):
        raise ValueError("complete model source inventory required")
    chain_render.render.sources(locked=locked, evidence=dict(source_sha256={
        "local-model-pytorch/" + name: expected for name, expected in sources.items()}))
    parity.require_sha256(value=report.get("export_summary_sha256"))
    exported = locked.json(path=model_root / "summary.json", expected=report["export_summary_sha256"])
    parity.validate_export(exported=exported)
    outputs = report.get("model_outputs")
    if not isinstance(outputs, dict) or set(outputs) != {"120", "160"}:
        raise ValueError("both complete model output profiles required")
    count = 0
    for size, expected_count in ((120, 25), (160, 2)):
        output, model = outputs[str(size)], exported["networks"][str(size)]
        same(actual=output.get("graph_sha256"), expected=model["graph_sha256"], label="graph linkage")
        artifact = f"align-{size}/artifacts/model.onnx"
        same(actual=output.get("onnx_sha256"), expected=exported["artifacts"][artifact], label="ONNX linkage")
        chain_render.render.hashed(locked=locked, path=model_root / artifact, expected=output["onnx_sha256"])
        networks = [item for item in context["evidence"]["captures"]["networks"].values()
                    if item["graph_sha256"] == model["graph_sha256"]]
        if len(networks) != 1:
            raise ValueError("one captured native network per profile required")
        network = networks[0]
        graph_data = chain_render.render.hashed(locked=locked, path=Path(network["graph_path"]),
                                                expected=model["graph_sha256"], maximum=1024**2)
        graph, names = analyze(graph_data.decode("utf-8")), model["terminal_names"]
        parity.validate_graph(graph=graph, size=size, names=names, network=network)
        checkers = comparisons(graph=graph)
        cases = output.get("cases")
        if not isinstance(cases, list) or len(cases) != expected_count:
            raise ValueError("exact 25/2 inference profiles required")
        same(actual=output.get("successful_inferences"), expected=expected_count, label="inference count")
        same(actual=[item.get("inference") for item in cases], expected=network["successful_inferences"], label="inference order")
        for case in cases:
            flags(evidence=dict(case, failures=[]), positive=("passed",))
            inference = case["inference"]
            native_input = parity.stage1_input(network=network, size=size, inference=inference)
            values = inputs[(size, inference)]
            same(actual=case.get("actual_input_sha256"), expected=native_input["sha256"], label="captured input linkage")
            same(actual=case.get("replacement_input_sha256"), expected=digest(data=values.tobytes()), label="owned input linkage")
            same(actual=case.get("input_source"), expected="replacement_inputs", label="input producer")
            heads = parity.select_heads(outputs=network["outputs"], inference=inference, names=names)
            checks = {}
            for name in names:
                original = parity.load_tensor(item=heads[name])
                head_path = directory / "onnx" / f"size-{size}-infer-{inference:03d}-{name}.npy"
                data = locked.read(path=head_path, maximum=1024**2)
                actual = locked.array(path=head_path, shape=graph["shapes"][name], dtype="float32", expected=digest(data=data))
                checks[name] = checkers[name](actual=actual, expected=original,
                    descriptor=graph["descriptors"][name], raw=heads[name]["raw"])
                if checks[name].get("passed") is not True:
                    raise ValueError("original numerical head gate failed")
            same(actual=case.get("checks"), expected=checks, label="original head gates")
            count += len(checks)
    same(actual=count, expected=135, label="recomputed head count")
    same(actual=report.get("head_comparisons"), expected=count, label="model head count")
    same(actual=evidence.get("head_comparisons"), expected=count, label="chain head count")
    return report


def render_pixels(*, directory, context, value, payload, path, locked):
    evidence = locked.json(path=directory / "report.json")
    if evidence.get("profile") != "actual-preprocess-owned-chain-render-v1":
        raise ValueError("fixed-profile actual render report required")
    flags(evidence=evidence, positive=("passed", "completed", "external_replay_verified", "pixel_parity_verified"),
          negative=("native_analysis_bypassed", "independent_inference_verified", "product_parity_verified", "arbitrary_frame_backend_connected"))
    fixtures(evidence=evidence, locked=locked)
    declared_sources(evidence=evidence, expected=["local-model-pytorch/" + name for name in
        (*chain.SOURCE_NAMES, "face_preprocess_chain_render.py")], locked=locked)
    for key, expected in (("capture", str(context["root"])), ("candidate", str(path)),
                          ("capture_sha256", locked.files[str(context["root"] / "report.json")]),
                          ("replay_sha256", locked.files[str(path)]), ("runtime", str(context["runtime"])),
                          ("package", str(context["package"])), ("host_sha256", locked.files[str(context["host"])]),
                          ("width", 1448), ("height", 1086), ("warmup_requests_per_host", 6), ("seeks_per_request", 2)):
        same(actual=evidence.get(key), expected=expected, label=f"render {key}")
    expected_frames = [{key: item for key, item in frame.items() if key != "input"} for frame in context["frames"]]
    same(actual=evidence.get("frames"), expected=expected_frames, label="render manifest")
    if locked.read(path=directory / "replay.bin", maximum=chain.owned.REPLAY_LIMIT) != payload:
        raise ValueError("render binary differs from validated normalized replay")
    runs = evidence.get("runs")
    if not isinstance(runs, list) or len(runs) != 1 or runs[0].get("name") != "candidate":
        raise ValueError("one actual candidate render run required")
    entry = runs[0]
    for key in ("owned_face_conversions", "owned_face_restorations"):
        same(actual=entry.get(key), expected=24, label=key)
    trace = chain_render.render.hashed(locked=locked, path=directory / "records.jsonl",
                                      expected=entry.get("records_sha256"), maximum=chain.sequence.LOG_LIMIT)
    events = chain_render.render.rows(data=trace)
    if chain.owned.validate_external_events(events=events, replay=value, shift=0) != 24:
        raise ValueError("24 exact normalized render conversions required")
    protocol = chain_render.render.protocol(frames=context["frames"])
    same(actual=entry.get("protocol_rows"), expected=protocol, label="actual render protocol")
    if entry.get("reader_error") is not None or "close_error" in entry:
        raise ValueError("render log/close error present")
    log = chain_render.render.hashed(locked=locked, path=directory / "host.log", expected=entry.get("host_log_sha256"),
                                    maximum=chain.sequence.LOG_LIMIT)
    if ([line for line in log.splitlines() if line.startswith(b"QCUT\t")] != [row.encode("ascii") for row in protocol] or
            any(marker in log for marker in (b"[research-error]", b"[error]"))):
        raise ValueError("actual host log differs from successful protocol")
    requests = entry.get("requests")
    if not isinstance(requests, list) or len(requests) != 13:
        raise ValueError("13 ordered render requests required")
    cursor, end = 0, 0
    for index, request in enumerate(requests):
        frame_index = 0 if index < 6 else index - 6
        same(actual=request.get("request_id"), expected=f"warmup-{index}" if index < 6 else f"frame-{frame_index:02d}", label="request order")
        same(actual=request.get("timestamp"), expected=context["frames"][frame_index]["timestamp"], label="request timestamp")
        if request.get("passed") is not True:
            raise ValueError("render request must have exact true acceptance")
        count = 0 if index == 0 else 2
        same(actual=request.get("owned_face_conversions"), expected=count, label="request conversions")
        span = request.get("owned_record_span")
        if (not isinstance(span, list) or len(span) != 2 or any(type(item) is not int for item in span) or
                not end == span[0] <= span[1] <= len(trace)):
            raise ValueError("contiguous bounded per-request record spans required")
        part = chain_render.render.rows(data=trace[span[0]:span[1]])
        subset = dict(value, frames=value["frames"][cursor:cursor + count])
        if chain.owned.validate_external_events(events=part, replay=subset, shift=0) != count:
            raise ValueError("actual per-request conversion count differs")
        cursor, end = cursor + count, span[1]
    if cursor != 24 or end != len(trace):
        raise ValueError("late or missing actual conversion records")
    metrics = []
    for index, frame in enumerate(context["frames"]):
        actual = locked.read(path=directory / f"frame-{index:02d}.rgba", maximum=1448 * 1086 * 4)
        baseline = locked.read(path=context["root"] / "baseline" / f"frame-{index:02d}.rgba", maximum=len(actual))
        source = locked.read(path=frame["input"], maximum=len(actual))
        delta = frame_metrics(actual=actual, reference=baseline, width=1448, height=1086)
        effect = frame_metrics(actual=actual, reference=source, width=1448, height=1086)
        if delta["equal"] is not True or delta["changed_pixels"] != 0 or delta["max_delta"] != 0 or delta["bbox"] is not None:
            raise ValueError("final pixel parity requires exact zero delta")
        if type(frame["expect_change"]) is not bool or effect["equal"] is frame["expect_change"]:
            raise ValueError("nonzero effect/no-face/zero-effect control is not satisfied")
        metrics.append(dict(index=index, baseline_sha256=digest(data=baseline), versus_input=effect, **delta))
        same(actual=requests[index + 6].get("sha256"), expected=delta["sha256"], label="request pixel linkage")
    same(actual=evidence.get("comparisons"), expected=metrics, label="final pixel metrics")
    return metrics


def run(*, args):
    out, locked = chain.sequence.fresh_output(path=args.out), LockedFiles()
    report = dict(profile="actual-preprocess-owned-chain-audit-v1", passed=False, completed=False,
                  geometry_exact=False, final_consumer_parity=False, pixel_parity_verified=False,
                  external_replay_verified=False, product_parity_verified=False,
                  arbitrary_frame_backend_connected=False, independent_full_frame_preprocessing=False,
                  native_execution_performed=False, inference_performed=False, fixed_profile_only=True,
                  native_dependencies=["algorithm-rgba", "detector", "caller-geometry", "tables", "routing", "effect-renderer"],
                  failures=[])
    try:
        report["source_sha256"] = chain.sources(names=(Path(__file__).name,), locked=locked)
        root, path, render_root, model_root = (item.resolve(strict=True) for item in
            (args.capture, args.candidate, args.render, args.root))
        context = capture.load(root=root, locked=locked)
        value, payload = chain_render.load_candidate(path=path, context=context, locked=locked)
        evidence = locked.json(path=path.with_name("report.json"))
        fixtures(evidence=evidence, locked=locked)
        flags(evidence=evidence, positive=("native_algorithm_rgba_required", "native_caller_parameters_required", "native_smoothing_initialization_required"),
              negative=("native_inference_called", "native_160_sampling_input_required", "independent_full_frame_preprocessing", "diagnostic_only"))
        declared_sources(evidence=evidence, expected=["local-model-pytorch/" + name for name in chain.SOURCE_NAMES], locked=locked)
        same(actual=evidence.get("capture"), expected=str(root), label="producer capture path")
        same(actual=evidence.get("manifest_frames"), expected=7, label="manifest count")
        same(actual=evidence.get("owned_smoothing_seed_predictions"), expected=[0, 20], label="owned seed lifecycle")
        same(actual=evidence.get("native_smoothing_seed_predictions"), expected=[], label="native seed prohibition")
        inputs, sampling = chain.build_120(root=root, evidence=context["evidence"], associations=context["associations"], locked=locked, temporal=True)
        seeds, initialization = chain.build_160(root=root, evidence=context["evidence"], associations=context["associations"], locked=locked)
        same(actual=evidence.get("sampling_cases"), expected=sampling, label="120 sampling")
        same(actual=evidence.get("initialization_sampling_cases"), expected=initialization, label="160 sampling")
        model = model_heads(directory=path.parent, model_root=model_root, context=context, evidence=evidence, inputs={**inputs, **seeds}, locked=locked)
        produced, cases = chain.produce(context=context, model=model, directory=path.parent / "onnx", locked=locked)
        same(actual=value, expected=produced, label="owned normalized replay")
        same(actual=evidence.get("cases"), expected=cases, label="owned geometry/smoothing")
        metrics = render_pixels(directory=render_root, context=context, value=value, payload=payload, path=path, locked=locked)
        report.update(passed=True, completed=True, geometry_exact=True, final_consumer_parity=True,
                      pixel_parity_verified=True, external_replay_verified=True, head_comparisons=135,
                      normalized_conversions=24, comparisons=metrics, capture=str(root), candidate=str(path), render=str(render_root),
                      capture_sha256=locked.files[str(root / "report.json")], replay_sha256=locked.files[str(path)],
                      candidate_report_sha256=locked.files[str(path.with_name("report.json"))],
                      render_report_sha256=locked.files[str(render_root / "report.json")],
                      model_report_sha256=locked.files[str(path.parent / "onnx/report.json")])
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        chain.finish(out=out, report=report, locked=locked)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "candidate", "render", "root", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("passed", "head_comparisons", "normalized_conversions", "pixel_parity_verified")}))


if __name__ == "__main__":
    main()
