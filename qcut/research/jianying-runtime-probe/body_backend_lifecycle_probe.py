"""Capture native manager generations using the existing sequence renderer."""
import argparse
import json
import os
from pathlib import Path
import subprocess

from body_backend_probe import LIBRARY_SHA256, PARTS, SOURCES, sha256
from body_backend_audit import check_schedule


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    baseline = json.loads((args.baseline / "provenance.json").read_text())
    base = json.loads((args.baseline / "default/config.json").read_text())
    if sha256(path=Path(base["library"])) != LIBRARY_SHA256:
        raise ValueError("unsupported native binary")
    sources = list(baseline["inputs"])
    if len(sources) != 5:
        raise ValueError("expected four original frames and one synthetic blank")
    for source, digest in baseline["inputs"].items():
        if sha256(path=Path(source)) != digest:
            raise ValueError("baseline source changed")
    args.output.mkdir(parents=True, exist_ok=False)
    directory = Path(__file__).resolve().parent
    paths = [directory / "body_backend_lifecycle.mm", *(directory / name for name in SOURCES[1:])]
    host = args.output / "lifecycle-host"
    subprocess.run(["xcrun", "clang++", "-std=c++20", "-fobjc-arc", "-Wall", "-Wextra", "-Werror", "-Wno-deprecated-declarations",
                    *map(str, paths), "-framework", "AppKit", "-framework", "CoreVideo", "-framework", "IOSurface", "-framework", "OpenGL", "-o", str(host)], check=True)
    steps = [(0, "none"), (1, "none"), (2, "feature"), (3, "none"),
             (2, "video"), (3, "none"), (0, "manager"), (1, "none"), (2, "manager")]
    manifest = args.output / "manifest.tsv"
    manifest.write_text("".join(sources[index] + "\t1;1\t" + reset + "\n" for index, reset in steps))
    parameters = json.dumps({"body_adjust_" + part: [{"id": -1, "intensity":
                            0.4 if part == "SlimBody" else 0.3 if part == "StretchLeg" else 0}]
                            for part in PARTS}, separators=(",", ":"))
    config = {**base, "host": str(host), "output": str(args.output), "stdin": "/dev/null",
              "stdout": str(args.output / "stdout.log"), "stderr": str(args.output / "stderr.log"),
              "arguments": [*base["arguments"], str(manifest), str(args.output), str(baseline["width"]), str(baseline["height"])],
              "environment": [*base["environment"], "QCUT_BACKEND_PARAMETERS=" + parameters]}
    configuration = args.output / "config.json"
    configuration.write_text(json.dumps(config, indent=2) + "\n")
    probe_paths = [*directory.glob("body_backend*.py"), directory / "body_profile_lldb.py", directory / "run_body_default_profile.py", *paths]
    snapshots = args.output / "probe-sources"
    snapshots.mkdir()
    for path in probe_paths:
        (snapshots / path.name).write_bytes(path.read_bytes())
    provenance = {"librarySha256": LIBRARY_SHA256, "hostSha256": sha256(path=host),
                  "skeletonModels": baseline["skeletonModels"], "inputs": baseline["inputs"],
                  "probeSources": {path.name: sha256(path=path) for path in probe_paths},
                  "manifestSha256": sha256(path=manifest),
                  "scope": "Existing sequence renderer lifecycle diagnostic; its cadence differs from production host request/readback. Feature/video reset may disable graph updates."}
    (args.output / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    invocation = "import sys; sys.path.insert(0, %r); import body_profile_lldb, body_backend_lldb; body_backend_lldb.run(debugger=lldb.debugger, configuration=%r)" % (str(directory), str(configuration))
    clean = {key: value for key, value in os.environ.items() if not key.startswith(("DYLD_", "QCUT_AUDIT_"))}
    with (args.output / "lldb.log").open("w") as log:
        subprocess.run(["xcrun", "lldb", "-b", "-o", "script " + invocation, "-o", "quit"], stdout=log, stderr=subprocess.STDOUT, env=clean, timeout=180, check=True)
    trace = json.loads((args.output / "trace.json").read_text())
    if trace["errors"] or trace["exitCode"] != 0:
        raise RuntimeError("invalid native lifecycle trace")
    events = json.loads((args.output / "backend-events.json").read_text())
    report = {"passed": True, "schedule": check_schedule(events=events),
              "calls": [{"call": row["index"], "iterationBudget": row["iterationBudget"]} for row in trace["calls"]],
              "loadEvents": [row for row in events if row["event"] == "load"],
              "scope": provenance["scope"]}
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": report["passed"], "schedule": report["schedule"], "calls": report["calls"]}, indent=2))


if __name__ == "__main__":
    main()
