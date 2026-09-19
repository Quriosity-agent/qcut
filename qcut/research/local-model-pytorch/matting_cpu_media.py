"""Actual-frame independent recurrent CPU/PyTorch feedback and reset/replay."""
import argparse
import json
from pathlib import Path
import subprocess

import numpy as np
import torch

from matting_cpu_export import (FEEDBACK, INPUT_SHAPES, OUTPUT_SHAPES, compile_oracle,
                                digest, fresh_directory, run_oracle,
                                verify_case, write_schema, write_tensor)
from matting_torch import load_model


def validate_video(*, run: Path, out: Path, video: Path, frames: int, fps: int = 4) -> dict[str, object]:
    if not 12 <= frames <= 120:
        raise ValueError("media verification requires 12 to 120 distinct frames")
    if type(fps) is not int or not 1 <= fps <= 30:
        raise ValueError("fps must be an integer from 1 to 30")
    out = fresh_directory(path=out)
    run, video = run.resolve(), video.resolve()
    source_report = json.loads((run / "report.json").read_text())
    if source_report["status"] != "native-parity-passed":
        raise ValueError("synthetic CPU parity must pass before temporal verification")
    artifact = run / "matting-gru.pt"
    if digest(data=artifact.read_bytes()) != source_report["artifact_sha256"]:
        raise ValueError("bundle changed since same-input verification")
    model = load_model(path=artifact, allow_unverified=True)
    raw = out / "decoded.bgr24"
    command = ["/opt/homebrew/bin/ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={fps},scale=256:256:flags=bilinear",
               "-frames:v", str(frames), "-pix_fmt", "bgr24", "-f", "rawvideo", str(raw)]
    subprocess.run(command, check=True, capture_output=True, timeout=120)
    array = np.fromfile(raw, dtype=np.uint8)
    if array.size != frames * 256 * 256 * 3:
        raise ValueError("video provided fewer than the requested frames")
    array = array.reshape(frames, 256, 256, 3)
    frame_hashes = [digest(data=frame.tobytes()) for frame in array]
    write_schema(path=out / "inputs.tsv", shapes=INPUT_SHAPES)
    write_schema(path=out / "outputs.tsv", shapes=OUTPUT_SHAPES)
    actuals = {}
    for index in range(frames * 2):
        frame = index % frames
        reset = frame in {0, frames // 2}
        directory = out / f"case-{index:03d}-{'reset' if reset else 'feedback'}"
        directory.mkdir()
        image = torch.from_numpy(array[frame].transpose(2, 0, 1).copy()).unsqueeze(0).float() / 255
        if reset:
            states = {name: torch.zeros(INPUT_SHAPES[name]) for name in FEEDBACK}
        inputs = {"data": image, **states}
        for name, value in inputs.items():
            write_tensor(path=directory / f"in-{name}.f32", value=value)
        if not reset:
            (directory / "feedback").touch()
        with torch.inference_mode():
            actual = model(inputs)
        actuals[directory] = actual
        for name, value in actual.items():
            write_tensor(path=directory / f"pytorch-{name}.f32", value=value)
        states = {name: actual[target] for name, target in FEEDBACK.items()}
    native = run_oracle(binary=compile_oracle(out=out), graph=run / "graph.private.txt",
                        arena=run / "arena-fp32.private.bin", out=out)
    cases = []
    feedback_exact = True
    torch_replay_exact = True
    native_replay_exact = True
    directories = list(actuals)
    for index, (directory, actual) in enumerate(actuals.items()):
        result = verify_case(path=directory, actual=actual, supplied={})
        result.update(frame=index % frames, replay=index >= frames,
                      reset=index % frames in {0, frames // 2})
        if native["status"] == "completed":
            for name, target in FEEDBACK.items():
                applied = (directory / f"applied-{name}.f32").read_bytes()
                expected = ((directory / f"in-{name}.f32").read_bytes() if result["reset"] else
                            (directories[index - 1] / f"out-{target}.f32").read_bytes())
                feedback_exact = feedback_exact and applied == expected
            if (directory / "applied-data.f32").read_bytes() != (directory / "in-data.f32").read_bytes():
                feedback_exact = False
            if index >= frames:
                original = directories[index - frames]
                native_replay_exact = native_replay_exact and all((directory / f"out-{name}.f32").read_bytes() ==
                                                                   (original / f"out-{name}.f32").read_bytes() for name in OUTPUT_SHAPES)
                torch_replay_exact = torch_replay_exact and all(torch.equal(actual[name], actuals[original][name]) for name in OUTPUT_SHAPES)
        cases.append(result)
    passed = native["status"] == "completed" and bool(cases) and all(case["passed"] for case in cases) and feedback_exact and torch_replay_exact and native_replay_exact
    report = {"status": "native-parity-passed" if passed else "native-parity-failed",
              "source_sha256": source_report["source_sha256"], "artifact": str(artifact),
              "artifact_sha256": source_report["artifact_sha256"], "runtime_sha256": source_report["runtime_sha256"],
              "backend": source_report["backend"], "native": native, "video": str(video),
              "video_sha256": digest(data=video.read_bytes()), "decoded_sha256": digest(data=raw.read_bytes()),
              "distinct_frames": len(set(frame_hashes)), "sampled_frames": frames,
              "frame_sha256": frame_hashes, "fps": fps, "decode_command": command,
              "inferences": len(cases), "cases": cases,
              "native_feedback_exact": feedback_exact, "native_replay_exact": native_replay_exact,
              "torch_replay_exact": torch_replay_exact, "reset_frames": [0, frames // 2],
              "verification_scope": "forced CPU; independent native/PyTorch recurrent feedback, midpoint reset, complete replay; all four outputs",
              "preprocessing": f"ffmpeg fps={fps} bilinear stretch 256x256 BGR/255; research convention, not product-preprocessing parity",
              "product_gpu_parity": False, "tolerances": {"atol": 1e-4, "rtol": 1e-4}}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=24)
    parser.add_argument("--fps", type=int, default=4)
    args = parser.parse_args()
    torch.set_num_threads(2)
    result = validate_video(run=args.run, out=args.out, video=args.video, frames=args.frames, fps=args.fps)
    print(json.dumps({"status": result["status"], "cases_passed": sum(case["passed"] for case in result["cases"]),
                      "case_count": len(result["cases"]), "native_replay_exact": result["native_replay_exact"]}, indent=2))
    return 0 if result["status"] == "native-parity-passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
