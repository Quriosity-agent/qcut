"""Export verified fixed-profile frames for Beauty Lab, not a candidate driver.

Private models/runtime stay outside the UI package. Original report bytes and
relative frame names preserve provenance without authorizing absolute UI reads.
"""
import argparse
import json
from pathlib import Path

from face_alignment_replay import LockedFiles
import face_preprocess_chain_audit as audit
import face_preprocess_chain_capture as capture
import face_preprocess_chain_replay as chain
import face_preprocess_probe as probe
from face_render_stability_probe import digest


def copy_bytes(*, source, target, locked, maximum=128 * 1024**2, expected=None):
    data = locked.read(path=source, maximum=maximum, expected=expected)
    with target.open("xb") as stream:
        stream.write(data)
    return digest(data=locked.read(path=target, maximum=maximum, expected=digest(data=data)))


def merge_sources(*, groups):
    result = {}
    for group in groups:
        for name, value in group.items():
            if name in result and result[name] != value:
                raise ValueError("conflicting source hashes in portable package")
            result[name] = value
    return dict(sorted(result.items()))


def run(*, args):
    out, locked = chain.sequence.fresh_output(path=args.out), LockedFiles()
    report = dict(profile="actual-preprocess-owned-chain-ui-export-v1", passed=False, completed=False,
        diagnostic_only=True, arbitrary_frame_backend_connected=False, product_parity_verified=False, failures=[])
    try:
        proof_path = args.audit.resolve(strict=True)
        proof = locked.json(path=proof_path)
        if proof.get("profile") != "actual-preprocess-owned-chain-audit-v1":
            raise ValueError("recomputed fixed-profile chain audit required")
        audit.flags(evidence=proof, positive=("passed", "completed", "geometry_exact", "final_consumer_parity",
            "pixel_parity_verified", "external_replay_verified", "fixed_profile_only"),
            negative=("native_execution_performed", "inference_performed", "product_parity_verified",
                      "arbitrary_frame_backend_connected", "independent_full_frame_preprocessing"))
        audit.fixtures(evidence=proof, locked=locked)
        audit.declared_sources(evidence=proof,
            expected=("local-model-pytorch/face_preprocess_chain_audit.py",), locked=locked)
        for name in ("capture_sha256", "candidate_report_sha256", "render_report_sha256",
                     "model_report_sha256", "replay_sha256"):
            audit.parity.require_sha256(value=proof.get(name))
        audit.same(actual=proof.get("head_comparisons"), expected=135, label="audited head count")
        audit.same(actual=proof.get("normalized_conversions"), expected=24, label="audited conversion count")
        root = args.capture.resolve(strict=True)
        candidate = args.candidate.resolve(strict=True)
        rendered = args.render.resolve(strict=True)
        models = args.root.resolve(strict=True)
        for key, value in (("capture", str(root)), ("candidate", str(candidate)), ("render", str(rendered))):
            audit.same(actual=proof.get(key), expected=value, label="export audit " + key)
        context = capture.load(root=root, locked=locked)
        profile = probe.profile_report_paths(**probe.profile_report_arguments(evidence=context["evidence"]))
        files = dict(capture=root / "report.json", candidate=candidate.with_name("report.json"),
            render=rendered / "report.json", model=candidate.parent / "onnx/report.json",
            summary=models / "summary.json", originalCapture=context["original"] / "report.json",
            originalReplay=profile["sequence_replay"], originalRender=profile["sequence_render"],
            originalAudit=Path(context["evidence"]["audit"]) / "report.json")
        for key, expected in (("capture", "capture_sha256"), ("candidate", "candidate_report_sha256"),
                              ("render", "render_report_sha256"), ("model", "model_report_sha256")):
            audit.chain_render.render.hashed(locked=locked, path=files[key], expected=proof[expected])
        reports = {key: locked.json(path=path) for key, path in files.items()}
        audit.chain_render.render.hashed(locked=locked, path=files["summary"],
            expected=reports["model"].get("export_summary_sha256"), maximum=16 * 1024**2)
        original = reports["originalCapture"]
        manifest = Path(original["manifest"])
        (out / "reports").mkdir()
        (out / "frames").mkdir()
        copied = {}
        for key, source in files.items():
            name = {"originalCapture": "original-capture", "originalReplay": "original-replay",
                    "originalRender": "original-render", "originalAudit": "original-audit"}.get(key, key)
            copied[key] = copy_bytes(source=source, target=out / "reports" / (name + ".json"), locked=locked)
        sources = merge_sources(groups=[reports[key]["source_sha256"] for key in
            ("originalCapture", "originalReplay", "originalRender", "candidate", "render")])
        if len(merge_sources(groups=[reports[key]["source_sha256"] for key in
                ("originalCapture", "originalReplay", "originalRender")])) != 50:
            raise ValueError("original 50-source guard differs")
        extra = chain.sources(names=probe.SOURCE_NAMES, locked=locked)
        sources = merge_sources(groups=[sources, extra, {"local-model-pytorch/" + name: value
            for name, value in reports["model"]["source_sha256"].items()}])
        rows = []
        for index, frame in enumerate(context["frames"]):
            comparison = reports["render"]["comparisons"][index]
            previous = original["frames"][index]
            suffix = f"{index:02d}"
            rows.append(dict(index=index, input_png_sha256=copy_bytes(source=Path(frame["image"]),
                target=out / f"frames/input-{suffix}.png", locked=locked, expected=previous["image_sha256"]),
                input_rgba_sha256=previous["input_rgba_sha256"],
                native_rgba_sha256=copy_bytes(source=root / f"baseline/frame-{suffix}.rgba",
                    target=out / f"frames/native-{suffix}.rgba", locked=locked, expected=comparison["baseline_sha256"]),
                candidate_rgba_sha256=copy_bytes(source=rendered / f"frame-{suffix}.rgba",
                    target=out / f"frames/candidate-{suffix}.rgba", locked=locked, expected=comparison["sha256"])))
        index = dict(format="qcut-beauty-lab-owned-chain-v1", reports=copied, source_sha256=sources, frames=rows,
            manifest_sha256=copy_bytes(source=manifest, target=out / "manifest.json", locked=locked),
            replay_sha256=copy_bytes(source=candidate, target=out / "replay.json", locked=locked,
                                    expected=proof["replay_sha256"]))
        data = json.dumps(index, indent=2, allow_nan=False).encode() + b"\n"
        (out / "index.json").write_bytes(data)
        locked.read(path=out / "index.json", maximum=1024**2, expected=digest(data=data))
        report.update(passed=True, completed=True, audit_sha256=locked.files[str(proof_path)],
                      index_sha256=digest(data=data), source_count=len(sources), frames=7,
                      source_sha256=chain.sources(names=(Path(__file__).name,), locked=locked))
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        chain.finish(out=out, report=report, locked=locked)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "candidate", "render", "root", "audit", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("passed", "source_count", "frames", "index_sha256")}))


if __name__ == "__main__":
    main()
