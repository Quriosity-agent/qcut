"""Compare unmodified Swing with explicitly labelled local skeleton interventions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


SOURCES = ("filter-host-main.mm", "amazer-context-scope.mm", "filter-host-support.mm",
           "filter-face-inspect.mm", "filter-sequence-io.cpp", "graphics-runtime.mm",
           "graphics-probe.mm", "filter-probe.mm")
PARTS = ("SlimBreast", "SlimHip", "SwanNeck", "SlimArm", "WidenShoulderTest",
         "OrthoShoulder", "SlimBody", "SlimWaist", "StretchLeg", "SmallHead")


def sha256(*, path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--height", type=int, default=1920)
    parser.add_argument("--frames", type=int, default=4)
    parser.add_argument("--profiles", nargs="+", default=["default", "cpu", "cpu-no-force", "no-force"])
    options = parser.parse_args()
    if not 1 <= options.frames <= 60 or not set(options.profiles) <= {"default", "cpu", "cpu-no-force", "no-force", "coreml-cpu-input"}:
        parser.error("bounded profiles and 1 to 60 frames required")
    options.output.mkdir(parents=True, exist_ok=False)
    directory = Path(__file__).resolve().parent
    paths = [directory / source for source in SOURCES]
    host = options.output / "production-host"
    subprocess.run(["xcrun", "clang++", "-std=c++20", "-fobjc-arc", "-Wall", "-Wextra", "-Werror",
                    "-Wno-deprecated-declarations", *map(str, paths), "-framework", "AppKit", "-framework",
                    "CoreVideo", "-framework", "IOSurface", "-framework", "OpenGL", "-o", str(host)], check=True)
    runtime = options.runtime.resolve()
    library = runtime / "Frameworks/libcccreator.dylib"
    package = runtime / "Cache/effect/7408076932065152296/9c891b188dd6b523a30efa8bfb63602b"
    parameters = json.dumps({"body_adjust_" + part: [{"id": -1, "intensity":
                            0.4 if part == "SlimBody" else 0.3 if part == "StretchLeg" else 0}]
                            for part in PARTS}, separators=(",", ":"))
    provenance = {"host": {"sha256": sha256(path=host), "sources": {p.name: sha256(path=p) for p in paths}},
                  "library": {"path": str(library), "sha256": sha256(path=library)},
                  "luaSha256": sha256(path=package / "AmazingFeature/lua/slimbody.lua"),
                  "inputs": {}, "profiles": options.profiles,
                  "width": options.width, "height": options.height,
                  "timestamps": [index / 30 for index in range(options.frames)],
                  "hostCadence": "two native updates per render request; controls between updates"}
    for index in range(options.frames):
        source = options.sources.resolve() / ("frame%d.rgba" % index)
        if source.stat().st_size != options.width * options.height * 4:
            raise ValueError("input size mismatch")
        provenance["inputs"][str(source)] = sha256(path=source)
    (options.output / "provenance.json").write_text(json.dumps(provenance, indent=2))
    for profile in ["unobserved", *options.profiles]:
        output = options.output / profile
        output.mkdir()
        commands = []
        for index in range(options.frames):
            source = options.sources.resolve() / ("frame%d.rgba" % index)
            result = output / ("frame%d.rgba" % index)
            commands.append("\t".join(("render", str(index), str(index / 30), str(source), str(result), parameters)))
        (output / "stdin.txt").write_text("\n".join(commands + ["exit", ""]))
        config = {"host": str(host), "library": str(library), "arguments": [str(runtime), str(runtime / "Models"), str(package)],
                  "environment": ["DYLD_LIBRARY_PATH=" + str(runtime / "Frameworks"),
                                  "QCUT_FRAME_WIDTH=" + str(options.width), "QCUT_FRAME_HEIGHT=" + str(options.height)],
                  "output": str(output), "stdin": str(output / "stdin.txt"), "stdout": str(output / "stdout.log"),
                  "stderr": str(output / "stderr.log"), "cpu": profile.startswith("cpu"), "forceZero": "no-force" in profile,
                  "coremlCpuNormalization": profile == "coreml-cpu-input"}
        configuration = output / "config.json"
        configuration.write_text(json.dumps(config, indent=2))
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith(("DYLD_", "QCUT_AUDIT_"))}
        if profile == "unobserved":
            environment.update(dict(item.split("=", 1) for item in config["environment"]))
            with (output / "stdin.txt").open("r") as input_file, (output / "stdout.log").open("w") as stdout, (output / "stderr.log").open("w") as stderr:
                subprocess.run([str(host), *config["arguments"]], stdin=input_file, stdout=stdout,
                               stderr=stderr, env=environment, timeout=300, check=True)
            continue
        invocation = "import sys; sys.path.insert(0, %r); import body_profile_lldb; body_profile_lldb.run(debugger=lldb.debugger, configuration=%r)" % (str(directory), str(configuration))
        with (output / "lldb.log").open("w") as log:
            subprocess.run(["xcrun", "lldb", "-b", "-o", "script " + invocation, "-o", "quit"],
                           stdout=log, stderr=subprocess.STDOUT, env=environment, timeout=300, check=True)
        trace = json.loads((output / "trace.json").read_text())
        print(profile, "calls", len(trace["calls"]), "errors", trace["errors"], "exit", trace["exitCode"], flush=True)
        if trace["errors"] or trace["exitCode"] != 0 or not trace["calls"]:
            raise RuntimeError("native capture failed; inspect trace")
    if "default" in options.profiles:
        identity = []
        for index in range(options.frames):
            name = "frame%d.rgba" % index
            observed = sha256(path=options.output / "default" / name)
            unobserved = sha256(path=options.output / "unobserved" / name)
            identity.append({"frame": index, "observed": observed, "unobserved": unobserved, "exact": observed == unobserved})
        (options.output / "observation-transparency.json").write_text(json.dumps(identity, indent=2))
        if not all(row["exact"] for row in identity):
            raise RuntimeError("observation changed native output; cannot claim transparent capture")


if __name__ == "__main__":
    main()
