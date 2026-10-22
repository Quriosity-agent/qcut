# Independent body photo sources

Curated from `donghaozhang/qcut-beauty-standalone` commit
`0c790e219f857baaa19ea77e8cc6be4a8db6ab97` (PRs 17–21). This directory contains
owned photo algorithms, HTTP UI, tests, source and model identity manifests, and
the PP-HumanSeg license. It contains no model weights, fixture photographs,
native Jianying libraries, installers, or portable ZIP payloads.

`stageBodyPhotoSources` assembles a complete source tree: 105 files reuse QCut's
existing independent research sources by exact frozen hashes, and two files use
the pinned `engine-overrides` versions. The current video engine is untouched.
The upstream 107-file engine manifest remains byte-for-byte unchanged.

QCut hosts the full upstream web UI in its own window. The service uses the
portable CPU path on macOS, Windows and Linux. This photo route does not claim
native geometry equivalence or video temporal validation.

Set `QCUT_BODY_PHOTO_RUNTIME_ROOT` to an external private runtime directory
containing `body/research` and `body-portable`. The latter contains the 26 ONNX
skeleton networks and `models/human_segmentation_pphumanseg_2023mar.onnx`.
The former contains the three face networks and alignment constants. All 31
model/constant files are hash-verified; none are copied by source staging.

Use a Python environment with the exact pins in `body/requirements.txt`:

```sh
python -B /absolute/staged/body/qcut_host.py --verify
python -B /absolute/staged/body/qcut_host.py --state /absolute/owned/state --instance 0123456789abcdef0123456789abcdef --parent-pid 12345
```

The host prints one JSON readiness record with an ephemeral loopback port and
instance identifier. SIGTERM closes active renderer process trees; a parent
watch also stops the host when Electron exits. Each isolated render watches its
host so abrupt host termination does not leave render groups behind. Windows
additionally retains the upstream kill-on-close job ownership.

The source manifest records every imported file's original hash and all plumbing
adaptations. Geometry, pose, masks, skin, crop safety, control ranges and web UI
retain upstream bytes. Adaptations resolve an external runtime root, select CPU
for this managed photo route, and attach process ownership. The source stager
pins the manifest hash and rejects tampering, extra files, models and symlinks.
