"""Compare source-derived ready coarse inputs across native shape boundaries."""
import argparse
import json
from pathlib import Path
import sys

import numpy as np

from body_backend_probe import LIBRARY_SHA256, run_profile, sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.engine))
    from body_algorithm_size import body_algorithm_size
    from body_mesh_renderer import algorithm_image
    from body_skeleton_decode import crop_layout_and_roi, refine_tensor
    from body_swing_networks import coreml_coarse_size, coreml_input

    base = json.loads((args.baseline / "default/config.json").read_text())
    baseline = json.loads((args.baseline / "provenance.json").read_text())
    if sha256(path=Path(base["library"])) != LIBRARY_SHA256 or sha256(path=Path(base["host"])) != baseline["hostSha256"]:
        raise ValueError("baseline executable identity changed")
    args.output.mkdir(parents=True, exist_ok=False)
    owned = args.output / "owned"
    owned.mkdir()
    source_paths = [args.engine / name for name in ("body_swing_networks.py", "body_skeleton_decode.py", "body_skeleton_preprocess.py", "body_skeleton_kernels.py", "body_mesh_renderer.py", "body_algorithm_size.py")]
    snapshots = args.output / "candidate-sources"
    snapshots.mkdir()
    for path in source_paths:
        (snapshots / path.name).write_bytes(path.read_bytes())
    probe_sources = [*Path(__file__).parent.glob("body_backend*.py"), Path(__file__).parent / "body_profile_lldb.py", Path(__file__).parent / "run_body_default_profile.py"]
    probe_snapshots = args.output / "probe-sources"
    probe_snapshots.mkdir()
    for path in probe_sources:
        (probe_snapshots / path.name).write_bytes(path.read_bytes())
    provenance = {"librarySha256": LIBRARY_SHA256, "hostSha256": baseline["hostSha256"],
                  "skeletonModels": baseline["skeletonModels"],
                  "sources": {str(path): sha256(path=path) for path in source_paths},
                  "probeSources": {path.name: sha256(path=path) for path in probe_sources}}
    rows = []
    for width, height in ((640, 360), (360, 640), (640, 512), (512, 640), (435, 640), (436, 640)):
        name = "%dx%d" % (width, height)
        yy, xx = np.indices((height, width), dtype=np.uint16)
        rgba = np.stack(((xx * 3 + yy) % 256, (xx + yy * 5) % 256, (xx * 7 + yy * 11) % 256, np.full_like(xx, 255)), axis=-1).astype(np.uint8)
        source = owned / (name + ".rgba")
        rgba.tofile(source)
        size = body_algorithm_size(size=(width, height), source_changed=False)
        algorithm, raster = algorithm_image(rgba=rgba, runtime=owned, output_size=size)
        algorithm_file = owned / (name + "-algorithm.rgba")
        algorithm.tofile(algorithm_file)
        out_h, out_w = coreml_coarse_size(width=algorithm.shape[1], height=algorithm.shape[0])
        box = [0, 0, algorithm.shape[1], algorithm.shape[0]]
        integer = refine_tensor(algorithm[..., :3], box, out_h=out_h, out_w=out_w)
        layout, roi = crop_layout_and_roi(box, (out_w, out_h))
        geometry = {"layoutXYWH": layout, "roi": roi}
        candidate = coreml_input(tensor=integer)[None]
        candidate_file = owned / (name + "-input.npy")
        np.save(candidate_file, candidate, allow_pickle=False)
        rows.append({"name": name, "source": str(source), "sourceSha256": sha256(path=source),
                     "algorithmFile": str(algorithm_file), "algorithmSha256": sha256(path=algorithm_file), "raster": raster,
                     "geometry": geometry, "candidate": str(candidate_file), "candidateSha256": sha256(path=candidate_file),
                     "shape": list(candidate.shape), "sourceSize": [width, height]})
    # All candidate pixels and tensors exist before opening any new native reference.
    (args.output / "candidate-receipt.json").write_text(json.dumps({"provenance": provenance, "rows": rows}, indent=2) + "\n")
    for row in rows:
        width, height = row["sourceSize"]
        environment = [entry for entry in base["environment"] if not entry.startswith(("QCUT_FRAME_WIDTH=", "QCUT_FRAME_HEIGHT="))]
        config = {**base, "environment": [*environment, "QCUT_FRAME_WIDTH=" + str(width), "QCUT_FRAME_HEIGHT=" + str(height)]}
        run_profile(root=args.output, name=row["name"], base=config, inputs=[Path(row["source"])] * 2,
                    delays=[0, 0.5], options={"resetBeforeCalls": [2]}, observed=True)
    for row in rows:
        native_root = args.output / row["name"]
        trace = json.loads((native_root / "trace.json").read_text())
        candidate = np.load(row["candidate"], allow_pickle=False)
        comparisons = []
        for call in trace["calls"]:
            for inference in call["passes"]:
                tensor = inference["inputTensors"][0]
                if inference["network"] != "coarse" or tensor["storage"] != 4:
                    continue
                reference = np.fromfile(native_root / tensor["file"], np.float32).reshape(tensor["shape"])
                equal_shape = reference.shape == candidate.shape
                difference = np.abs(reference.astype(np.float64) - candidate) if equal_shape else None
                comparisons.append({"call": call["index"], "nativeTensor": tensor, "shapeExact": equal_shape,
                                    "exact": equal_shape and candidate.tobytes() == reference.tobytes(),
                                    "unequal": int(np.count_nonzero(difference)) if equal_shape else None,
                                    "maximum": float(difference.max(initial=0)) if equal_shape else None,
                                    "algorithmExact": row["algorithmSha256"] == call["algorithmSha256"]})
        if not comparisons:
            raise ValueError("no ready coarse inference: " + row["name"])
        row["comparisons"] = comparisons
    result = {"scope": "Six synthetic source aspect ratios, all four CoreML coarse shapes. Owned original-pixel inputs are saved before native execution. No native model output is a candidate input.",
              "provenance": provenance, "rows": rows,
              "passed": all(item["exact"] and item["algorithmExact"] for row in rows for item in row["comparisons"])}
    (args.output / "report.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"passed": result["passed"], "cases": len(rows), "calls": sum(len(row["comparisons"]) for row in rows)}, indent=2))


if __name__ == "__main__":
    main()
