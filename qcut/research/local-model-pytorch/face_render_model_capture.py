"""Capture actual beauty-host model inputs; prove observing does not change pixels."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

import face_owned_replay_e2e as replay
import face_owned_result_probe as owned
import face_render_consumer_probe as consumer
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest, frame_metrics


def metadata(*, path: Path) -> dict:
    value = json.loads(sequence.bounded_bytes(path=path, limit=65536))
    if (not isinstance(value, dict) or type(value.get("index")) is not int or value["index"] < 0 or
            not isinstance(value.get("kind"), str) or not isinstance(value.get("detail"), str) or
            type(value.get("bytes")) is not int or not 0 <= value["bytes"] <= 256 * 1024**2):
        raise ValueError("invalid model capture metadata")
    pairs = [item.split("=", 1) for item in value["detail"].split() if "=" in item]
    fields = dict(pairs)
    if len(fields) != len(pairs):
        raise ValueError("duplicate model capture metadata field")
    return dict(**value, fields=fields, path=str(path))


def inventory(*, capture: Path) -> dict:
    paths = sorted(capture.glob("*.json"))
    if not 1 <= len(paths) <= 4096:
        raise ValueError("bounded nonempty model capture required")
    records = [metadata(path=path) for path in paths]
    indices = [item["index"] for item in records]
    if len(set(indices)) != len(indices):
        raise ValueError("duplicate model capture index")
    networks = {}
    for item in records:
        if item["kind"] != "espresso":
            continue
        identity = item["fields"].get("self")
        if not isinstance(identity, str) or not identity.isdecimal() or int(identity) < 1 or identity in networks:
            raise ValueError("invalid or reused captured network object")
        path = Path(item["path"]).with_suffix(".graph.txt")
        graph = sequence.bounded_bytes(path=path, limit=1024**2)
        networks[identity] = dict(graph_path=str(path), graph_sha256=digest(data=graph),
                                  declared_outputs=item["fields"].get("outputs", "").split(";"),
                                  successful_inferences=[], inputs=[], outputs=[])
    for item in records:
        if item["kind"] not in {"espresso-input", "espresso-output", "espresso-inference"}:
            continue
        identity = item["fields"].get("self")
        if identity not in networks:
            raise ValueError("tensor capture has no matching network graph")
        fields = item["fields"]
        inference = fields.get("inference", "")
        if not inference.lstrip("-").isdecimal() or not -1 <= int(inference) <= 128:
            raise ValueError("invalid model capture inference index")
        network = networks[identity]
        if item["kind"] == "espresso-inference":
            if fields.get("rc") != "0" or int(inference) in network["successful_inferences"] or int(inference) < 0:
                raise ValueError("failed or duplicate captured inference")
            network["successful_inferences"].append(int(inference))
            continue
        if "skipped" in item["detail"] or "requested=" in item["detail"]:
            raise ValueError("incomplete captured model tensor")
        dims = fields.get("dims", "").split(",")
        raw = fields.get("raw", "").split(",")
        if (len(dims) != 4 or any(not value.isdecimal() or not 1 <= int(value) <= 4096 for value in dims) or
                len(raw) != 2 or raw[0] not in {"1", "2", "4"} or not raw[1].lstrip("-").isdecimal() or
                not -16 <= int(raw[1]) <= 24 or not fields.get("name")):
            raise ValueError("invalid model capture tensor descriptor")
        size = {"1": 1, "2": 2, "4": 4}[raw[0]]
        for dimension in dims:
            size *= int(dimension)
        if size > 16 * 1024**2 or item["bytes"] != size:
            raise ValueError("model capture tensor size mismatch")
        path = Path(item["path"]).with_suffix(".bin")
        data = sequence.bounded_bytes(path=path, limit=size)
        if len(data) != size:
            raise ValueError("truncated model capture tensor")
        key = "inputs" if item["kind"] == "espresso-input" else "outputs"
        network[key].append(dict(name=fields["name"], inference=int(inference), dims_nwhc=list(map(int, dims)),
                                 raw=list(map(int, raw)), path=str(path), sha256=digest(data=data)))
    completed = 0
    for network in networks.values():
        successes = network["successful_inferences"]
        if successes != list(range(len(successes))):
            raise ValueError("captured inference sequence has gaps")
        inputs = network["inputs"]
        for index in successes:
            selected = [item for item in inputs if item["inference"] == index]
            if not selected or len({item["name"] for item in selected}) != len(selected):
                raise ValueError("completed inference has missing or duplicate inputs")
        for item in (*inputs, *network["outputs"]):
            if item["inference"] >= 0 and item["inference"] not in successes:
                raise ValueError("model tensor lacks a successful inference")
        completed += len(successes)
    if completed == 0:
        raise ValueError("no actual successful model inference captured")
    return dict(networks=networks, metadata_records=len(records), successful_inferences=completed)


def run(*, args: argparse.Namespace) -> dict:
    out = sequence.fresh_output(path=args.out)
    report = dict(passed=False, native_analysis_bypassed=False, captures={}, comparisons=[], failures=[])
    try:
        runtime, package = args.runtime.resolve(strict=True), args.package.resolve(strict=True)
        from face_alignment_warp_native import BYTENN_SHA256

        bytenn = runtime / "Frameworks/libbytenn.dylib"
        if digest(data=bytenn.read_bytes()) != BYTENN_SHA256:
            raise ValueError("unverified capture ByteNN runtime")
        sources = {**owned.probe_sources(), **{
            f"local-model-pytorch/{name}": digest(data=Path(__file__).with_name(name).read_bytes())
            for name in (Path(__file__).name, "bytenn_model_capture.mm", "face_owned_replay_e2e.py",
                         "face_render_sequence_probe.py")}}
        report["source_sha256"] = sources
        control = owned.run(args=argparse.Namespace(
            runtime=runtime, package=package, image=args.image, out=out / "control",
            parameters=args.parameters, frames=4, warmup=6, require_face=True, expect_change=True, binding=True))
        report.update(width=control["width"], height=control["height"], image_sha256=control["image_sha256"],
                      bytenn_sha256=BYTENN_SHA256)
        directory = out / "observed"
        directory.mkdir()
        capture = out / "capture"
        capture.mkdir()
        observer = out / "observer.dylib"
        subprocess.run([
            "xcrun", "clang++", "-std=c++17", "-O1", "-dynamiclib", "-fobjc-arc",
            "-framework", "Foundation", f"-L{runtime / 'Frameworks'}", "-lbytenn",
            f"-Wl,-rpath,{runtime / 'Frameworks'}", str(Path(__file__).with_name("bytenn_model_capture.mm")),
            "-o", str(observer)], check=True, timeout=180)
        environment = replay.environment(runtime=runtime, directory=directory,
                                         width=control["width"], height=control["height"])
        environment.pop("QCUT_FACE_BIND_REPLAY")
        environment.update(DYLD_INSERT_LIBRARIES=str(observer), QCUT_BYTENN_CAPTURE_IO="1",
                           QCUT_BYTENN_CAPTURE_DIR=str(capture))
        host = sequence.BoundedHost(command=[str(out / "control/clone-audit/host"), str(runtime),
                                             str(runtime / "Models"), str(package)],
                                    environment=environment, log=directory / "host.log", max_rows=11)
        try:
            host.receive(request_id=None)
            for index in range(6):
                host.render(request_id=f"warmup-{index}", timestamp=0, input_path=out / "control/input.rgba",
                            output_path=directory / "warmup.rgba", parameters=args.parameters)
            for index in range(4):
                output = directory / f"frame-{index}.rgba"
                host.render(request_id=f"frame-{index}", timestamp=index / 30, input_path=out / "control/input.rgba",
                            output_path=output, parameters=args.parameters)
                metrics = frame_metrics(actual=sequence.bounded_bytes(path=output, limit=control["width"] * control["height"] * 4),
                                        reference=(out / f"control/original/frame-{index}.rgba").read_bytes(),
                                        width=control["width"], height=control["height"])
                report["comparisons"].append(metrics)
                if not metrics["equal"]:
                    raise RuntimeError("model input observer changed beauty output pixels")
            host.finish()
        finally:
            host.close()
        expected = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{index}\t0" for index in range(6)),
                    *(f"QCUT\tRESULT\tframe-{index}\t0" for index in range(4))]
        if host.protocol_rows != expected or host.reader_error is not None:
            raise RuntimeError("capture host protocol or bounded log failed")
        events = sequence.bounded_bytes(path=directory / "records.jsonl", limit=sequence.LOG_LIMIT)
        report.update(sequence.validate_owned_events(data=events, minimum=18))
        captured = inventory(capture=capture)
        report["captures"] = captured
        networks = report["captures"]["networks"]
        if not any(item["dims_nwhc"] in ([1, 120, 120, 3], [1, 160, 160, 3])
                   for network in networks.values() for item in network["inputs"]):
            raise RuntimeError("actual beauty host did not expose a supported alignment input")
        consumer.verify_library(runtime=runtime)
        for key, expected in sources.items():
            path = Path(__file__).resolve().parents[1] / key
            if digest(data=path.read_bytes()) != expected:
                raise RuntimeError("capture sources changed during execution")
        if digest(data=bytenn.read_bytes()) != BYTENN_SHA256 or digest(data=args.image.read_bytes()) != control["image_sha256"]:
            raise RuntimeError("capture runtime or source image changed during execution")
        report.update(passed=True, observer_sha256=digest(data=observer.read_bytes()),
                      host_sha256=digest(data=(out / "control/clone-audit/host").read_bytes()))
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "package", "image", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--parameters", required=True)
    result = run(args=parser.parse_args())
    print(json.dumps(dict(passed=result["passed"], successful_inferences=result["captures"]["successful_inferences"],
                          networks=len(result["captures"]["networks"])), indent=2))


if __name__ == "__main__":
    main()
