"""Recompute backend dispatch and tensor integrity from saved private observations."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def check_schedule(*, events):
    latched = {}
    reads = {}
    polled = set()
    result = {"polls": 0, "cpuPasses": 0, "coremlPasses": 0, "generations": 0}
    for row in events:
        kind = row["event"]
        if kind == "load":
            detector = row["detector"]
            latched[detector] = False
            reads.pop(detector, None)
            polled.discard(detector)
            result["generations"] += 1
        if kind == "ready-latch":
            if row["observedReady"] not in (0, 1):
                raise ValueError("invalid listener flag")
            reads[row["detector"]] = bool(row["observedReady"])
        if kind == "poll-return":
            state = row["state"]
            detector = row["detector"]
            if row["returnCode"] != 0:
                raise ValueError("readiness poll failure requires separate attribution")
            if detector not in reads or bool(state["latchedReady"]) != reads[detector]:
                raise ValueError("latched flag differs from actual listener read")
            if latched.get(detector) and not state["latchedReady"]:
                raise ValueError("ready detector reverted without a new model generation")
            latched[detector] = bool(state["latchedReady"])
            if latched[detector] and state["cpuEngine"]:
                raise ValueError("CPU engine survived ready activation")
            polled.add(detector)
            result["polls"] += 1
        if kind in ("cpu", "coreml"):
            state = row["state"]
            detector = state["detector"]
            expected = "coreml" if latched.get(detector) else "cpu"
            if detector not in polled or state["configuredBackend"] != 3 or kind != expected:
                raise ValueError("actual inference does not follow latched dynamic choice")
            if kind == "cpu" and not state["cpuEngine"]:
                raise ValueError("CPU inference has no CPU engine")
            result[kind + "Passes"] += 1
    return result


def file_hash(*, path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(*, evidence):
    provenance = json.loads((evidence / "provenance.json").read_text())
    for name, digest in provenance["probeSources"].items():
        if file_hash(path=evidence / "probe-sources" / name) != digest:
            raise ValueError("saved probe source changed: " + name)
    for source, digest in provenance["inputs"].items():
        if file_hash(path=Path(source)) != digest:
            raise ValueError("source input changed: " + source)
    for model, digest in provenance["skeletonModels"].items():
        if file_hash(path=Path(model)) != digest:
            raise ValueError("private model changed")
    profiles = {}
    directories = [evidence] if (evidence / "trace.json").exists() else sorted(evidence.iterdir())
    for directory in directories:
        if not (directory / "trace.json").exists():
            continue
        config = json.loads((directory / "config.json").read_text())
        if file_hash(path=Path(config["host"])) != provenance["hostSha256"] or file_hash(path=Path(config["library"])) != provenance["librarySha256"]:
            raise ValueError("native executable identity changed")
        trace = json.loads((directory / "trace.json").read_text())
        if trace["errors"] or trace["exitCode"] != 0:
            raise ValueError("invalid native trace")
        events = json.loads((directory / "backend-events.json").read_text())
        schedule = check_schedule(events=events)
        calls = []
        tensor_count = 0
        for call in trace["calls"]:
            algorithm = directory / call["algorithmFile"]
            if algorithm.stat().st_size != call["stride"] * call["height"] or file_hash(path=algorithm) != call["algorithmSha256"]:
                raise ValueError("algorithm raster changed")
            routes = [row["event"] for row in events if row["call"] == call["index"] and row["event"] in ("cpu", "coreml")]
            if len(routes) != len(call["passes"]):
                raise ValueError("dispatch and detector pass counts differ")
            for route, inference in zip(routes, call["passes"]):
                for direction in ("inputTensors", "outputTensors"):
                    for tensor in inference[direction]:
                        path = directory / tensor["file"]
                        if path.stat().st_size != math.prod(tensor["shape"]) * tensor["storage"] or file_hash(path=path) != tensor["sha256"]:
                            raise ValueError("captured tensor changed")
                        if direction == "inputTensors" and tensor["storage"] != (2 if route == "cpu" else 4):
                            raise ValueError("input type differs from actual backend")
                        tensor_count += 1
            calls.append({"call": call["index"], "routes": routes, "networks": [item["network"] for item in call["passes"]],
                          "people": len(call["public"]), "iterationBudget": call["iterationBudget"]})
        profiles[directory.name] = {"schedule": schedule, "calls": calls, "tensorFilesVerified": tensor_count,
                                    "listenerEvents": [row for row in events if row["event"] == "listener-event"],
                                    "explicitInterventions": [row for row in events if any(key.startswith("intervention") for key in row) or row["event"] in ("listener-held", "listener-released", "explicit-SK-reset", "detector-waiting", "detector-released")]}
        transparency = directory / "observation-transparency.json"
        if transparency.exists():
            rows = json.loads(transparency.read_text())
            for row in rows:
                observed = file_hash(path=directory / ("frame%d.rgba" % row["frame"]))
                plain = file_hash(path=evidence / (directory.name + "-unobserved") / ("frame%d.rgba" % row["frame"]))
                if observed != row["observed"] or plain != row["unobserved"] or row["exact"] != (observed == plain):
                    raise ValueError("transparency receipt changed")
            profiles[directory.name]["observationTransparency"] = {"exact": sum(row["exact"] for row in rows), "frames": len(rows)}
    return {"passed": True, "scope": "Stored-file schedule and tensor audit only; readiness is wall-time dependent and no native output is used for owned inference.",
            "auditorSha256": file_hash(path=Path(__file__)), "profiles": profiles}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    result = audit(evidence=args.evidence)
    (args.evidence / "backend-audit.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({name: data["schedule"] for name, data in result["profiles"].items()}, indent=2))


if __name__ == "__main__":
    main()
