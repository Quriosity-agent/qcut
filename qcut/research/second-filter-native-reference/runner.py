#!/usr/bin/env python3
"""Run an unchanged local filter through an isolated, identity-gated Swing host."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess


CORE_SHA256 = "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9"
CORE_UUID = "D6342ECD-5432-33F0-A2AD-0C28F5699994"
SOURCE_UNITS = (
    "filter-host-main.mm", "amazer-context-scope.mm", "filter-host-support.mm",
    "filter-face-inspect.mm", "filter-sequence-io.cpp", "graphics-runtime.mm",
    "graphics-probe.mm", "filter-probe.mm",
)
STRENGTHS = (0.0, 0.37, 0.5, 1.0)
TIMES = (0.0, 1.0 / 30.0, 0.125, 1.0, 2.0, 0.125, 0.0)
FIXTURES = (("chart", 320, 180), ("offaxis", 257, 145), ("threshold", 321, 181))


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def package_identity(directory):
    directory = Path(directory)
    if not directory.is_dir():
        raise ValueError("Package directory is missing")
    files = []
    for path in sorted(directory.rglob("*")):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise ValueError("Package contains a symlink or unsupported entry")
        if path.is_file():
            files.append(path)
    if not files:
        raise ValueError("Package is empty")
    value = hashlib.sha256()
    for path in files:
        value.update(path.relative_to(directory).as_posix().encode())
        value.update(b"\0")
        value.update(path.read_bytes())
        value.update(b"\0")
    return {"sha256": value.hexdigest(), "files": {
        path.relative_to(directory).as_posix(): digest(path) for path in files}}


def protocol_field(value):
    text = str(value)
    if not text or any(character in text for character in "\t\r\n\0"):
        raise ValueError("Protocol field contains an unsupported character")
    return text


def render_command(request_id, timestamp, source, destination, intensity):
    if not math.isfinite(timestamp) or timestamp < 0 or timestamp >= 9e12:
        raise ValueError("Timestamp is outside the bounded host range")
    if not math.isfinite(intensity) or not 0 <= intensity <= 1:
        raise ValueError("Intensity must be finite and within [0,1]")
    fields = ("render", request_id, format(timestamp, ".17g"), source,
              destination, json.dumps({"intensity": intensity}, separators=(",", ":")))
    return "\t".join(protocol_field(value) for value in fields) + "\n"


def verify_protocol(stdout, stderr, request_ids):
    if "QCUT\tREADY\t1" not in stdout.splitlines():
        raise RuntimeError("Native host did not report READY")
    results = [line.split("\t") for line in stdout.splitlines()
               if line.startswith("QCUT\tRESULT\t")]
    expected = [["QCUT", "RESULT", str(request_id), "0"] for request_id in request_ids]
    if results != expected:
        raise RuntimeError("Native host result sequence contains a failure or is incomplete")
    combined = stdout + "\n" + stderr
    if re.search(r"attempt to |error:on(?:Event|Start|Update)", combined):
        raise RuntimeError("Native Lua event or lifecycle failed")
    if "post-frame feature params result = 0" not in stdout:
        raise RuntimeError("No successful FeatureSegment parameter submission was observed")


def fixture_bytes(kind, width, height):
    if kind not in {row[0] for row in FIXTURES} or not (2 <= width <= 4096 and 2 <= height <= 4096):
        raise ValueError("Unknown fixture or invalid dimensions")
    if width * height > 1_048_576:
        raise ValueError("Fixture exceeds the diagnostic pixel budget")
    output = bytearray(width * height * 4)
    levels = (0, 1, 126, 127, 128, 129, 254, 255)
    for y in range(height):
        for x in range(width):
            red, green = x * 255 // (width - 1), y * 255 // (height - 1)
            if kind == "chart":
                blue = 240 if ((x // 17) + (y // 11)) % 2 else 15
                if width // 3 <= x < width // 2 and height // 4 <= y < height // 2:
                    red, green, blue = 255, 255, 255
            elif kind == "offaxis":
                blue = (x * 13 + y * 7) % 256
                if (x - width // 3) ** 2 + (y - height // 4) ** 2 < (height // 5) ** 2:
                    red, green, blue = 254, 180, 30
                if x < 2 or y == height - 1:
                    red, green, blue = 1, 250, 127
            else:
                level = levels[(x * len(levels) // width + y // 7) % len(levels)]
                red = green = blue = level
                if y >= height // 2:
                    green, blue = 255 - level, (x * 19 + y * 23) % 256
            offset = (y * width + x) * 4
            output[offset:offset + 4] = bytes((red, green, blue, 255))
    return bytes(output)


def read_frame(path, width, height):
    data = Path(path).read_bytes()
    if len(data) != width * height * 4:
        raise RuntimeError("Native raw RGBA output has the wrong byte count")
    return data


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def verify_fixed_references(fixed, source_sha256):
    if set(fixed) != set(STRENGTHS) or fixed[0.0] != source_sha256:
        raise RuntimeError("Fixed-strength matrix is incomplete or zero intensity is not identity")
    if len(set(fixed.values())) != len(STRENGTHS):
        raise RuntimeError("Each diagnostic strength must produce a distinct native image")


def build_host(repository, destination):
    source = repository / "research/jianying-runtime-probe"
    command = ["xcrun", "clang++", "-std=c++20", "-fobjc-arc", "-Wall", "-Wextra",
               "-Werror", "-Wno-deprecated-declarations"]
    command += [str(source / name) for name in SOURCE_UNITS]
    for framework in ("AppKit", "CoreVideo", "IOSurface", "OpenGL"):
        command += ["-framework", framework]
    command += ["-o", str(destination)]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)
    destination.with_suffix(".build.log").write_text(completed.stdout + completed.stderr)
    if completed.returncode != 0:
        raise RuntimeError("Native host compilation failed")
    return {"argv": command, "sha256": digest(destination), "source_sha256": {
        str(path.relative_to(repository)): digest(path) for path in sorted(source.iterdir())
        if path.suffix in {".h", ".mm", ".cpp"}}}


def render_session(host, runtime, package, source, width, height, sequence, directory):
    directory.mkdir()
    argv = [str(host), str(runtime), str(runtime / "Models"), str(package)]
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(("DYLD_", "JY_", "QCUT_"))}
    explicit_environment = {"DYLD_LIBRARY_PATH": str(runtime / "Frameworks"),
                            "QCUT_FRAME_WIDTH": str(width), "QCUT_FRAME_HEIGHT": str(height)}
    environment.update(explicit_environment)
    requests = [{"id": str(index), "timestamp_seconds": timestamp, "intensity": intensity,
                 "path": str(directory / f"frame-{index:03}.rgba")}
                for index, (timestamp, intensity) in enumerate(sequence)]
    commands = "".join(render_command(row["id"], row["timestamp_seconds"], source,
                                      row["path"], row["intensity"]) for row in requests) + "exit\n"
    (directory / "commands.tsv").write_text(commands)
    write_json(directory / "invocation.json", {
        "argv": argv, "environment": explicit_environment, "input_sha256": digest(source),
        "commands": commands, "host_sha256": digest(host)})
    with (directory / "stdout.log").open("w") as stdout, (directory / "stderr.log").open("w") as stderr:
        result = subprocess.run(argv, input=commands, text=True, stdout=stdout, stderr=stderr,
                                env=environment, timeout=45, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Native child failed with exit {result.returncode}: {directory}")
    verify_protocol((directory / "stdout.log").read_text(), (directory / "stderr.log").read_text(),
                    [row["id"] for row in requests])
    for row in requests:
        data = read_frame(row["path"], width, height)
        row["sha256"] = hashlib.sha256(data).hexdigest()
        row["alpha_opaque"] = all(alpha == 255 for alpha in data[3::4])
    record = {"directory": str(directory), "exit_code": result.returncode, "frames": requests}
    write_json(directory / "result.json", record)
    return record


def run_matrix(repository, runtime, package, expected_package_sha256, output):
    checkout = next((parent for parent in (repository, *repository.parents)
                     if (parent / ".git").exists()), repository)
    if output == checkout or checkout in output.parents:
        raise ValueError("Raw native evidence must be outside the repository")
    core = runtime / "Frameworks/libcccreator.dylib"
    if digest(core) != CORE_SHA256:
        raise ValueError("Unknown core SHA256; native loading refused")
    uuid_output = subprocess.check_output(["dwarfdump", "--uuid", str(core)], text=True)
    if f"{CORE_UUID} (arm64)" not in uuid_output:
        raise ValueError("Unknown core arm64 UUID; native loading refused")
    identity = package_identity(package)
    if identity["sha256"] != expected_package_sha256:
        raise ValueError("Package SHA256 differs; native loading refused")
    output.mkdir(parents=True, exist_ok=False)
    (output / "inputs").mkdir()
    host = output / "swing-filter-host"
    report = {"schema_version": 1, "runtime": str(runtime), "core_sha256": CORE_SHA256,
              "core_uuid": CORE_UUID, "package": str(package), "package_identity": identity,
              "host": build_host(repository, host), "fixtures": [], "sessions": []}
    for kind, width, height in FIXTURES:
        source = output / "inputs" / f"{kind}-{width}x{height}.rgba"
        source.write_bytes(fixture_bytes(kind, width, height))
        fixed = {}
        fixture = {"name": kind, "width": width, "height": height, "input": str(source),
                   "input_sha256": digest(source), "references": []}
        report["fixtures"].append(fixture)
        for intensity in STRENGTHS:
            hashes = []
            for repeat in range(2):
                times = TIMES if repeat == 0 else tuple(reversed(TIMES))
                directory = output / f"{kind}-{intensity}-{repeat}"
                session = render_session(host, runtime, package, source, width, height,
                                         [(timestamp, intensity) for timestamp in times], directory)
                report["sessions"].append(session)
                hashes += [row["sha256"] for row in session["frames"]]
            if len(set(hashes)) != 1:
                raise RuntimeError(f"Fixed-strength output depends on time/order/process: {kind}/{intensity}")
            if intensity == 0 and hashes[0] != digest(source):
                raise RuntimeError("Zero-intensity output is not the exact original input")
            fixed[intensity] = hashes[0]
            fixture["references"].append({"intensity": intensity, "sha256": hashes[0],
                                           "path": report["sessions"][-1]["frames"][0]["path"]})
            write_json(output / "manifest.partial.json", report)
        verify_fixed_references(fixed, digest(source))
        for repeat in range(2):
            changes = (0.0, 0.37, 1.0, 0.5, 0.37, 0.0, 1.0)
            sequence = list(zip(TIMES, changes))
            if repeat:
                sequence.reverse()
            session = render_session(host, runtime, package, source, width, height, sequence,
                                     output / f"{kind}-changes-{repeat}")
            report["sessions"].append(session)
            for row in session["frames"]:
                if row["sha256"] != fixed[row["intensity"]]:
                    raise RuntimeError("Changing strength differs from a fresh fixed-strength child")
        print(f"{kind}: fixed/reverse/changing sequences passed", flush=True)
    if package_identity(package) != identity or digest(core) != CORE_SHA256:
        raise RuntimeError("Reference inputs changed during native execution")
    report["results"] = {"sessions": len(report["sessions"]),
                         "frames": sum(len(row["frames"]) for row in report["sessions"]),
                         "all_fixed_time_order_process_equal": True,
                         "all_changing_strength_matches_fresh_child": True,
                         "all_fixed_strengths_distinct": True,
                         "zero_intensity_identity": True,
                         "all_alpha_opaque": all(frame["alpha_opaque"] for row in report["sessions"]
                                                  for frame in row["frames"])}
    report["boundary"] = ["D634 Swing host; original package, no script edits or interposition.",
                          "Each request executes two seeks; parameters are submitted after the first successful seek.",
                          "Times round to integer microseconds in the existing host; they are not frame numbers.",
                          "Only the three opaque generated RGBA8 fixtures are tested; no UI/export or temporal-model claim.",
                          "Strength is an actual FeatureSegment JSON event, not a final-image blend."]
    report["execution_runner_sha256"] = digest(Path(__file__))
    report["validation_runner_sha256"] = report["execution_runner_sha256"]
    write_json(output / "manifest.json", report)
    return report


def revalidate_manifest(path):
    path = Path(path)
    report = json.loads(path.read_text())
    seen_directories = set()
    frame_count = 0
    for fixture in report["fixtures"]:
        source = Path(fixture["input"])
        source_sha256 = digest(source)
        if source_sha256 != fixture["input_sha256"]:
            raise RuntimeError("Recorded input changed")
        read_frame(source, fixture["width"], fixture["height"])
        fixed = {}
        for reference in fixture["references"]:
            data = read_frame(reference["path"], fixture["width"], fixture["height"])
            actual = hashlib.sha256(data).hexdigest()
            if actual != reference["sha256"] or reference["intensity"] in fixed:
                raise RuntimeError("Recorded reference changed or strength is duplicated")
            fixed[reference["intensity"]] = actual
        verify_fixed_references(fixed, source_sha256)
        sessions = [row for row in report["sessions"]
                    if Path(row["directory"]).name.startswith(fixture["name"] + "-")]
        if len(sessions) != 10:
            raise RuntimeError("Recorded fixture does not contain its ten child sessions")
        for session in sessions:
            directory = Path(session["directory"])
            if directory in seen_directories or session["exit_code"] != 0 or len(session["frames"]) != len(TIMES):
                raise RuntimeError("Duplicate, failed or incomplete recorded session")
            seen_directories.add(directory)
            verify_protocol((directory / "stdout.log").read_text(), (directory / "stderr.log").read_text(),
                            [row["id"] for row in session["frames"]])
            for row in session["frames"]:
                data = read_frame(row["path"], fixture["width"], fixture["height"])
                actual = hashlib.sha256(data).hexdigest()
                if actual != row["sha256"] or actual != fixed[row["intensity"]]:
                    raise RuntimeError("Recorded frame differs from its fixed-strength reference")
                if any(alpha != 255 for alpha in data[3::4]):
                    raise RuntimeError("Recorded opaque profile contains nonopaque output")
                frame_count += 1
    if len(seen_directories) != len(report["sessions"]) or frame_count != report["results"]["frames"]:
        raise RuntimeError("Recorded session/frame inventory is inconsistent")
    report["execution_runner_sha256"] = report.get("execution_runner_sha256", report.pop("runner_sha256", None))
    if not report["execution_runner_sha256"]:
        raise RuntimeError("Original execution runner hash is missing")
    report["validation_runner_sha256"] = digest(Path(__file__))
    report["results"]["all_fixed_strengths_distinct"] = True
    report["revalidation"] = {"frames_read_and_hashed": frame_count,
                              "all_protocol_and_reference_checks_passed": True,
                              "rendered_again": False}
    write_json(path, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--package-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[2])
    options = parser.parse_args()
    report = run_matrix(options.repository.resolve(), options.runtime.resolve(), options.package.resolve(),
                        options.package_sha256, options.output.resolve())
    print(json.dumps(report["results"], indent=2))


if __name__ == "__main__":
    main()
