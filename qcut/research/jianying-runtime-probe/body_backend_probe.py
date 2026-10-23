"""Run bounded private Swing backend timing, listener and tracker-reset probes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

from run_body_default_profile import PARTS, SOURCES


LIBRARY_SHA256 = "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9"


def sha256(*, path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wait_log(*, process, path, text, deadline):
    while time.monotonic() < deadline:
        if path.exists() and text in path.read_text(errors="replace"):
            return
        if process.poll() is not None:
            raise RuntimeError("host exited before " + text)
        time.sleep(0.05)
    raise TimeoutError("host did not report " + text)


def run_profile(*, root, name, base, inputs, delays, options, observed):
    output = root / name
    output.mkdir()
    pipe = output / "input.fifo"
    os.mkfifo(pipe)
    descriptor = os.open(pipe, os.O_RDWR)
    config = {**base, **options, "output": str(output), "stdin": str(pipe),
              "stdout": str(output / "stdout.log"), "stderr": str(output / "stderr.log")}
    configuration = output / "config.json"
    configuration.write_text(json.dumps(config, indent=2) + "\n")
    clean = {key: value for key, value in os.environ.items() if not key.startswith(("DYLD_", "QCUT_AUDIT_"))}
    parameters = json.dumps({"body_adjust_" + part: [{"id": -1, "intensity":
                            0.4 if part == "SlimBody" else 0.3 if part == "StretchLeg" else 0}]
                            for part in PARTS}, separators=(",", ":"))
    commands = []
    receipts = []
    try:
        with (output / "lldb.log").open("w") as log, (output / "stdout.log").open("w") as stdout, (output / "stderr.log").open("w") as stderr:
            if observed:
                script = "import sys; sys.path.insert(0, %r); import body_profile_lldb, body_backend_lldb; body_backend_lldb.run(debugger=lldb.debugger, configuration=%r)" % (str(Path(__file__).resolve().parent), str(configuration))
                process = subprocess.Popen(["xcrun", "lldb", "-b", "-o", "script " + script, "-o", "quit"], stdout=log, stderr=subprocess.STDOUT, env=clean)
            else:
                clean.update(dict(row.split("=", 1) for row in config["environment"]))
                process = subprocess.Popen([config["host"], *config["arguments"]], stdin=descriptor, stdout=stdout, stderr=stderr, env=clean)
            try:
                deadline = time.monotonic() + 180
                wait_log(process=process, path=output / "stdout.log", text="QCUT\tREADY\t1", deadline=deadline)
                for index, source in enumerate(inputs):
                    delay = delays[index]
                    time.sleep(delay)
                    result = output / ("frame%d.rgba" % index)
                    command = "\t".join(("render", str(index), str(index / 30), str(source), str(result), parameters))
                    commands.append(command)
                    started = time.monotonic_ns()
                    os.write(descriptor, (command + "\n").encode())
                    wait_log(process=process, path=output / "stdout.log", text="QCUT\tRESULT\t%d\t0" % index, deadline=deadline)
                    receipts.append({"frame": index, "source": str(source), "sourceSha256": sha256(path=source),
                                     "resultSha256": sha256(path=result), "delayBeforeSeconds": delay,
                                     "durationNs": time.monotonic_ns() - started})
                os.write(descriptor, b"exit\n")
                process.wait(timeout=30)
                if process.returncode:
                    raise RuntimeError("native process failed")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
    finally:
        os.close(descriptor)
    (output / "commands.txt").write_text("\n".join(commands + ["exit", ""]))
    (output / "frames.json").write_text(json.dumps(receipts, indent=2) + "\n")
    if observed:
        trace = json.loads((output / "trace.json").read_text())
        if trace["errors"] or trace["exitCode"] != 0 or len(trace["calls"]) != len(inputs) * 2:
            raise RuntimeError("invalid capture: " + json.dumps(trace.get("errors")))
    print(name, "complete", len(inputs), "frames", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--source-evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--profiles", nargs="+", default=["default", "delayed", "held", "failure", "prediction-failure", "reset-loss"])
    args = parser.parse_args()
    allowed = {"default", "delayed", "held", "failure", "prediction-failure", "reset-loss", "wait-ready", "wait-after-coarse"}
    if not set(args.profiles) <= allowed:
        parser.error("unknown bounded profile")
    runtime = args.runtime.resolve()
    library = runtime / "Frameworks/libcccreator.dylib"
    if sha256(path=library) != LIBRARY_SHA256:
        raise ValueError("unsupported library")
    source_provenance = json.loads((args.source_evidence / "provenance.json").read_text())
    sources = [Path(p) for p in source_provenance["inputs"]]
    if len(sources) != 4:
        raise ValueError("expected the four independently sourced baseline frames")
    for source in sources:
        if sha256(path=source) != source_provenance["inputs"][str(source)]:
            raise ValueError("source changed")
    width, height = source_provenance["width"], source_provenance["height"]
    args.output.mkdir(parents=True, exist_ok=False)
    blank = args.output / "blank.rgba"
    blank.write_bytes(bytes((0, 0, 0, 255)) * width * height)
    directory = Path(__file__).resolve().parent
    paths = [directory / p for p in SOURCES]
    host = args.output / "production-host"
    subprocess.run(["xcrun", "clang++", "-std=c++20", "-fobjc-arc", "-Wall", "-Wextra", "-Werror", "-Wno-deprecated-declarations",
                    *map(str, paths), "-framework", "AppKit", "-framework", "CoreVideo", "-framework", "IOSurface", "-framework", "OpenGL", "-o", str(host)], check=True)
    package = runtime / "Cache/effect/7408076932065152296/9c891b188dd6b523a30efa8bfb63602b"
    base = {"host": str(host), "library": str(library), "arguments": [str(runtime), str(runtime / "Models"), str(package)],
            "environment": ["DYLD_LIBRARY_PATH=" + str(runtime / "Frameworks"), "QCUT_FRAME_WIDTH=" + str(width), "QCUT_FRAME_HEIGHT=" + str(height)]}
    probe_paths = [*directory.glob("body_backend*.py"), directory / "body_profile_lldb.py", directory / "run_body_default_profile.py"]
    snapshot = args.output / "probe-sources"
    snapshot.mkdir()
    for path in probe_paths:
        (snapshot / path.name).write_bytes(path.read_bytes())
    identity = {"librarySha256": LIBRARY_SHA256, "hostSha256": sha256(path=host), "sources": {str(p): sha256(path=p) for p in paths},
                "probeSources": {p.name: sha256(path=p) for p in probe_paths},
                "skeletonModels": {str(p): sha256(path=p) for p in (runtime / "Models").glob("*skeleton*.model")},
                "inputs": {str(p): sha256(path=p) for p in [*sources, blank]}, "width": width, "height": height,
                "sourceEvidence": str(args.source_evidence), "provenanceSha256": sha256(path=args.source_evidence / "provenance.json")}
    (args.output / "provenance.json").write_text(json.dumps(identity, indent=2) + "\n")
    for name in args.profiles:
        inputs = sources if name != "reset-loss" else [sources[0], sources[1], sources[2], blank, blank, blank, blank, sources[2], sources[3]]
        delays = [0.0] * len(inputs)
        if name == "delayed":
            delays = [0.0, 0.25, 0.75, 0.1]
        options = {"holdSuccessUntilCall": 4} if name == "held" else {"failSuccessEvents": True} if name == "failure" else {"failFirstCoremlReturn": True} if name == "prediction-failure" else {"resetBeforeCalls": [4]} if name == "reset-loss" else {}
        if name == "wait-ready":
            options = {"waitBeforeFirstPoll": True}
        if name == "wait-after-coarse":
            options = {"waitAfterFirstPoll": True}
        if name in ("default", "delayed"):
            run_profile(root=args.output, name=name + "-unobserved", base=base, inputs=inputs, delays=delays, options={}, observed=False)
        run_profile(root=args.output, name=name, base=base, inputs=inputs, delays=delays, options=options, observed=True)
        if name in ("default", "delayed"):
            observed = json.loads((args.output / name / "frames.json").read_text())
            unobserved = json.loads((args.output / (name + "-unobserved") / "frames.json").read_text())
            transparency = [{"frame": i, "observed": a["resultSha256"], "unobserved": b["resultSha256"], "exact": a["resultSha256"] == b["resultSha256"]} for i, (a, b) in enumerate(zip(observed, unobserved))]
            (args.output / name / "observation-transparency.json").write_text(json.dumps(transparency, indent=2) + "\n")


if __name__ == "__main__":
    main()
