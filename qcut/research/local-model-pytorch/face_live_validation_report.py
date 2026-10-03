"""Summarize fresh campaign evidence without changing any acceptance report."""
import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from face_alignment_replay import LockedFiles
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest, frame_metrics
from face_temporal_capture_audit import source_hashes


def difference(*, actual, reference, width, height):
    if len(actual) != width * height * 4 or len(reference) != len(actual):
        raise ValueError("exact RGBA dimensions required")
    left = np.frombuffer(actual, np.uint8).reshape(height, width, 4).astype(np.int16)
    right = np.frombuffer(reference, np.uint8).reshape(height, width, 4).astype(np.int16)
    delta = np.abs(left - right)
    gray = np.minimum(255, delta[:, :, :3].max(axis=2) * 8).astype(np.uint8)
    metrics = dict(rgb_mae=float(delta[:, :, :3].mean()), rgb_max=int(delta[:, :, :3].max()),
        alpha_max=int(delta[:, :, 3].max()), changed_pixels=int(np.any(delta != 0, axis=2).sum()))
    return metrics, Image.fromarray(gray)


def accepted_frames(*, root, directory, locked):
    reports = {key: locked.json(path=root / key / "report.json") for key in ("probe", "replay", "render", "audit")}
    if not all(row.get("passed") is True for row in reports.values()):
        raise ValueError("accepted campaign contains a failed report")
    hashes = source_hashes(reports=[reports[key] for key in ("probe", "replay", "render")])
    source_root = Path(__file__).resolve().parents[1]
    for name, expected in hashes.items():
        locked.read(path=source_root / name, expected=expected)
    for key, stage in (("capture", "probe"), ("sequence_replay", "replay"), ("sequence_render", "render")):
        locked.read(path=root / stage / "report.json", expected=reports["audit"]["report_sha256"][key])
    width, height = reports["probe"]["width"], reports["probe"]["height"]
    directory.mkdir()
    rows = []
    preview = Image.new("RGB", (1440, 7 * 202), "white")
    draw = ImageDraw.Draw(preview)
    for index, comparison in enumerate(reports["render"]["comparisons"]):
        frame = reports["probe"]["frames"][index]
        pixels = {
            "input": locked.read(path=root / "probe" / f"input-{index:02d}.rgba", expected=frame["input_rgba_sha256"]),
            "native": locked.read(path=root / "probe/baseline" / f"frame-{index:02d}.rgba", expected=comparison["baseline_sha256"]),
            "candidate": locked.read(path=root / "render" / f"frame-{index:02d}.rgba", expected=comparison["sha256"])}
        original_metrics = frame_metrics(actual=pixels["candidate"], reference=pixels["native"], width=width, height=height)
        if any(original_metrics[key] != comparison[key] for key in original_metrics):
            raise ValueError("rendered pixels disagree with report metrics")
        images = [Image.frombytes("RGBA", (width, height), pixels[key]) for key in ("input", "native", "candidate")]
        metrics = {}
        labels = ["input", "native", "candidate"]
        for name, reference, actual in (("input-native", "input", "native"),
                ("input-candidate", "input", "candidate"), ("native-candidate", "native", "candidate")):
            values, gray = difference(actual=pixels[actual], reference=pixels[reference], width=width, height=height)
            filename = f"frame-{index:02d}-{name}-gain8.png"
            gray.save(directory / filename)
            metrics[name] = dict(**values, grayscale=filename)
            images.append(gray)
            labels.append(name + " x8")
        for column, (image, label) in enumerate(zip(images, labels, strict=True)):
            preview.paste(ImageOps.contain(image.convert("RGB"), (240, 180)), (column * 240, index * 202 + 22))
            draw.text((column * 240 + 3, index * 202 + 3), f"{index:02d} {label}", fill="black")
        rows.append(dict(index=index, parameters=frame["parameters"], metrics=metrics))
    preview.save(directory / "three-way-comparison.png")
    return dict(frames=rows, source_sha256=hashes, source_count=len(hashes),
        source_set_sha256=digest(data=json.dumps(hashes, sort_keys=True).encode()),
        head_comparisons=reports["audit"]["head_comparisons"], predictions=reports["audit"]["predictions"],
        conversions=reports["audit"]["conversions"], current_declared_sources_verified=True,
        native_160_sampling_input_required=reports["audit"]["native_160_sampling_input_required"],
        report_sha256=reports["audit"]["report_sha256"])


def run(*, campaigns, out):
    out, locked = sequence.fresh_output(path=out), LockedFiles()
    summary = dict(report_verification_completed=False, native_execution_performed=False,
        inference_performed=False, product_parity_verified=False, campaigns=[], failures=[],
        grayscale="min(255, 8 * max(abs(delta RGB))); no normalization; alpha reported separately")
    counts = Counter()
    try:
        summary["git_head_at_summary"] = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        for campaign_index, path in enumerate(campaigns):
            path = path.resolve(strict=True)
            campaign = locked.json(path=path / "report.json")
            counts["campaign_commands"] += 1
            for entry in campaign["campaigns"]:
                directory = path / f"campaign-{entry['index']:02d}"
                row = dict(root=str(directory), manifest=entry["manifest"], accepted=entry["passed"],
                    aggregate_campaign_passed=campaign["passed"], stages=entry["stages"],
                    aggregate_failures=campaign["failures"])
                for stage in entry["stages"]:
                    counts["stage_status_" + stage["status"]] += 1
                    if type(stage.get("returncode")) is int:
                        counts["stage_commands_executed"] += 1
                    if stage["name"] == "replay" and (directory / "replay/report.json").exists():
                        row["replay_failures"] = locked.json(path=directory / "replay/report.json")["failures"]
                if entry["passed"] is True:
                    row.update(accepted_frames(root=directory, directory=out / f"case-{campaign_index}-{entry['index']}", locked=locked))
                    counts["accepted_sequences"] += 1
                    counts["accepted_frames"] += len(row["frames"])
                    counts["head_comparisons"] += row["head_comparisons"]
                summary["campaigns"].append(row)
        locked.verify()
        summary["report_verification_completed"] = True
    except Exception as error:
        summary["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        summary.update(counts=dict(counts), fixture_sha256=dict(locked.files))
        (out / "report.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign", type=Path, action="append", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = run(campaigns=args.campaign, out=args.out)
    print(json.dumps(dict(completed=result["report_verification_completed"], counts=result["counts"])))


if __name__ == "__main__":
    main()
