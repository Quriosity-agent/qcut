#!/usr/bin/env python3
"""Build/run the CGL observer against original fixtures, without vendor libraries."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(arguments, directory, name, environment=None):
    result = subprocess.run(
        [str(value) for value in arguments],
        cwd=directory,
        env=environment,
        capture_output=True,
        timeout=60,
        check=False,
    )
    (directory / f"{name}.stdout").write_bytes(result.stdout)
    (directory / f"{name}.stderr").write_bytes(result.stderr)
    return result


def positive(directory, result, sampler):
    require(result.returncode == 0, f"{directory.name} failed: {result.stderr.decode(errors='replace')}")
    reports = [json.loads(line) for line in result.stdout.splitlines() if line]
    require(reports[-1].get("passed") is True, "Fixture did not finish its own assertions")
    metadata = [json.loads(line) for line in (directory / "draws.ndjson").read_text().splitlines()]
    require([row["kind"] for row in metadata] == ["draw", "draw", "blit"], "Observer hooks missing or duplicated")
    require([row["draw"] for row in metadata] == [0, 1, 2], "Draw sequence changed")
    expected = (directory / "expected.rgba").read_bytes()
    require(len(expected) == 7 * 5 * 4 and len(set(expected)) > 16, "Fixture lacks pixel variation")
    for index, row in enumerate(metadata):
        pixels = (directory / f"{index}.rgba").read_bytes()
        require(pixels == expected, f"Capture {index} bytes/orientation differ from source and render")
        require(row["width"] == 7 and row["height"] == 5 and row["internalFormat"] == 32856,
                "Attachment metadata differs")
        if index == 2:
            require(row["blitCoordinates"] == [0, 0, 7, 5, 0, 0, 7, 5], "Blit rectangle changed")
            require(row["blitMask"] == 16384 and row["blitFilter"] == 9729, "Blit parameters changed")
            continue
        uniforms = {value["name"]: value for value in row["uniforms"]}
        source = uniforms["sourceTex"]
        require(source["unit"] == 2 and source["texture"] > 0, "Source sampler binding differs")
        require((source["sampler"] > 0) == sampler, "Sampler object identity differs")
        expected_parameters = (9729, 9729, 33071, 33648) if sampler else (9728, 9728, 33648, 10497)
        require(tuple(source[field] for field in ["min", "mag", "wrapS", "wrapT"]) == expected_parameters,
                "Observer did not record effective sampling parameters")
        require(uniforms["gain"]["values"] == [1], "Float uniform differs")
    return {
        "passed": True,
        "captures": 3,
        "comparedCaptureBytes": len(expected) * 3,
        "stateComparisons": reports[-1]["stateComparisons"],
        "pboComparisons": reports[-1]["pboComparisons"],
        "renderPixelComparisons": reports[-1]["pixelComparisons"],
        "effectiveSamplerParametersVerified": True,
        "fixtureSha256": hashlib.sha256(expected).hexdigest(),
    }


def run(output):
    require(sys.platform == "darwin", "This optional diagnostic requires macOS CGL")
    import resource

    output.mkdir(parents=True, exist_ok=False)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    source = Path(__file__).resolve().parent
    source_hashes = {}
    for name in ["cgl-pass-capture.cpp", "cgl-pass-capture-test.cpp", "cgl-pass-capture-test.py"]:
        original = source / name
        (output / name).write_bytes(original.read_bytes())
        source_hashes[name] = sha256(original)
    flags = ["clang++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Wpedantic", "-Werror",
             "-Wno-deprecated-declarations", "-framework", "OpenGL"]
    observer = output / "observer.dylib"
    fixture = output / "fixture"
    for name, arguments in [
        ("compile-observer", flags + ["-dynamiclib", output / "cgl-pass-capture.cpp", "-o", observer]),
        ("compile-fixture", flags + [output / "cgl-pass-capture-test.cpp", "-o", fixture]),
    ]:
        result = command(arguments, output, name)
        require(result.returncode == 0, f"{name}: {result.stderr.decode(errors='replace')}")
    environment = os.environ.copy()
    environment.pop("QCUT_CGL_CAPTURE_GATE", None)
    environment.pop("QCUT_CGL_CAPTURE_DIRECTORY", None)
    environment["DYLD_INSERT_LIBRARIES"] = str(observer)
    capabilities = command([fixture, "capabilities"], output, "capabilities", environment)
    require(capabilities.returncode == 0, "Cannot create self-test CGL context")
    capabilities = json.loads(capabilities.stdout)
    result = {"sources": source_hashes, "observerSha256": sha256(observer),
              "fixtureBinarySha256": sha256(fixture), "capabilities": capabilities, "cases": {}}
    for mode in ["positive", "sampler", "mrt", "format"]:
        if mode == "sampler" and not capabilities["samplerSupported"]:
            result["cases"][mode] = {"status": "unavailable", "reason": "Context has no sampler object support"}
            continue
        directory = output / mode
        directory.mkdir()
        child_environment = environment.copy()
        child_environment["QCUT_CGL_CAPTURE_DIRECTORY"] = str(directory)
        child_environment["QCUT_CGL_CAPTURE_GATE"] = str(directory / "enabled")
        child = command([fixture, mode], directory, "child", child_environment)
        if mode in ["positive", "sampler"]:
            result["cases"][mode] = positive(directory, child, mode == "sampler")
            continue
        expected = "single COLOR_ATTACHMENT0 draw target" if mode == "mrt" else "requires RGBA8 targets"
        require(child.returncode == -signal.SIGABRT, f"{mode} did not fail closed with SIGABRT")
        require(expected in child.stderr.decode(errors="replace"), f"{mode} rejected for a different reason")
        require(not list(directory.glob("*.rgba")) and not (directory / "draws.ndjson").exists(),
                f"{mode} published evidence before rejection")
        result["cases"][mode] = {"passed": True, "signal": "SIGABRT", "expectedReason": expected,
                                  "capturedArtifacts": 0}
    result["sourcesUnchangedDuringRun"] = all(sha256(source / name) == digest for name, digest in source_hashes.items())
    require(result["sourcesUnchangedDuringRun"], "Observer or fixture changed while testing; repeat against stable source")
    (output / "verification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path)
    arguments = parser.parse_args()
    path = arguments.output_dir
    if path is None:
        path = Path(tempfile.mkdtemp(prefix="qcut-cgl-observer-parent-")) / "evidence"
    try:
        run(path.expanduser().resolve())
    except (RuntimeError, OSError, subprocess.TimeoutExpired, ValueError) as error:
        print(f"CGL observer self-test failed: {error}", file=sys.stderr)
        sys.exit(1)
