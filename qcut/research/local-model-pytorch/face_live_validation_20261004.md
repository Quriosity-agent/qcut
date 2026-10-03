# Fresh Native/ONNX Evidence, 2026-10-04

Workspace: `/Users/peter/Desktop/code/qcut/qcut`, branch `codex/beauty-live-hybrid-v7`.
Initial HEAD: `48ef89e546ee3964c9101f773cbb3dce3cb5832f`. Other workers changed HEAD
during this task; per-file source hashes, not the initial commit, identify these runs.
No commits or pushes were performed by this validation task.

All evidence below is local and ignored under `.local/jianying-model-pytorch/`.
Original reports were never rewritten. Existing numerical, source, and tree guards
were retained. CPU reporting is not counted as a new inference or native render.

## Ready UI Roots

```sh
QCUT_BEAUTY_LAB_RESEARCH_RUN=face-live-validation-temporal-20261004-r1
QCUT_BEAUTY_LAB_OWNED_RUN=face-live-validation-owned-ui-20261004-r1
```

Owned UI: seven frames, 62 current source identities, nine original report files.
Index SHA-256: `bb865486018174734f170b0a1a496e1842927cc525ceff3d06a8abb4bf33ce93`.
Audit SHA-256: `880bc2b44436c22a98f3799550b59638c8871cb882cbbdfd8964706d2d8edc61`.
The parent owns Electron/frontend E2E results; this report does not claim those tests.

## Actual Runs

| Fresh output leaf | Actual outcome |
| --- | --- |
| `face-live-validation-20261004-r1/base` | Fresh compiled native host; 67 successful inferences, 10 networks; four neutral observer frames exact |
| `face-live-validation-temporal-20261004-r1` | Two complete probe/replay/render/audit campaigns; 14 exact frames, 270 head comparisons |
| `face-live-validation-expanded-20261004-r1` | Front-smile native probe passed; owned replay rejected multiple actual 160 initialization inferences; candidate render/audit and three later cases skipped |
| `face-live-validation-mature-eye-20261004-r1` | Four stages passed; seven exact frames, 135 head comparisons |
| `face-live-validation-nose-20261004-r1` | Mature-nose probe passed; next stage blocked before launch by source-tree change; no candidate accepted |
| `face-live-validation-nose-20261004-r2` | Mature-nose four stages passed: seven exact frames, 135 heads; front-smile nose then rejected by the same strict initialization gate; aggregate campaign remains failed |
| `face-live-validation-owned-capture-20261004-r1` | New hardware-observed capture: 26 predictions, seven neutral frames, two exact 160 inputs, at most four active hardware breakpoints |
| `face-live-validation-owned-replay-20261004-r1` | Owned 120/160 inputs actually consumed by ONNX; 135 head comparisons; exact geometry, owned initialization/smoothing and final consumer points |
| `face-live-validation-owned-render-20261004-r1` | Actual native renderer consumed/restored 24 candidate conversions; seven exact RGBA frames |
| `face-live-validation-owned-audit-20261004-r1` | CPU revalidation of 1,615 bound fixtures, 135 heads and 24 normalized conversions; passed |
| `face-live-validation-owned-ui-20261004-r1` | Original report bytes and frame assets exported; passed |

Five campaign invocations executed 21 subprocess stages: 19 passed and two replay
commands exited with failure. Another stage failed its tree guard before launch;
22 stages were skipped. Base capture and the five owned-chain commands separately
passed, giving 27 executed core stage commands total. This count excludes campaign
wrapper invocations, fixture preparation, tests, and CPU summary generation.

Accepted evidence totals **35 rendered frame comparisons and 675 ONNX head
comparisons**: four temporal sequences plus a separate seven-frame owned-preprocess
run. These are not 35 distinct portraits or independent source images. All accepted
native-to-candidate frames have zero changed RGBA pixels and maximum delta zero.

Front-smile's actual 160 inference counts are two at prediction 0, two at prediction
20, and one at prediction 24. The owned initializer requires one uniquely associated
initialization inference. No captured final points or alternate seed were substituted.

## Assets And Dependencies

Native runtime:
`$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/D6342ECD-5432-33F0-A2AD-0C28F5699994-c092f19c71af1397`.
Effect package relative to runtime:
`Cache/effect/7408077472211668276/f662ff9c955ee319f1ae03b2aa27df76`.

ONNX root: `face-heads-20261003-stable-r2`; ORT 1.22.1, NumPy 2.5.3.

| Asset | SHA-256 |
| --- | --- |
| 120 ONNX | `26b5c79a46478896bb91d9693dd114c2374d7b64b0e0b64245f77cf6289d5364` |
| 160 ONNX | `45e3499295914247ab3a74fc080cf82c9cdecc82592224580a775838a5410174` |
| Front-smile original, 640 square | `80b6d2c570b249571767409d7e9792c2d83a6ae02fa01dde7a16fa3ff7fd8138` |
| Mature original, 512 square | `2b28aec9ea1ae73943131b73eaba26ff2b1d24c7aa1953948c43053779353ba9` |

The standard fixtures remain `face-sequence-fixture-20261003-r1/manifest.json` and
`face-temporal-video-qcut-export-eye100-20261003-r1/manifest.json`. Reusing original
input assets is not reusing inference/render reports.

New portrait fixtures are under `face-live-validation-20261004-r1/fixtures/`.
Each records its original hash, EXIF treatment, LANCZOS resize, 181-pixel horizontal
padding, and normalized PNG/RGBA hashes. They preserve aspect ratio at 1448x1086.
The mature source is the existing `skin-gan/fixtures/mature-original.png`, not Koch.
Motion/mirror/no-face/recovery frames are synthetic transformations, not real video motion.

## Source Identity And Changes

The accepted temporal reports share this SHA of the sorted 50-source hash map:
`54ac40bbe7661244453e9945521a17aaf0c23741d2f6c4107e54faaf2f97d849`.
Every source entry was compared with current disk bytes by the CPU report generator.
The full map is in each report; runtime, native model and package identities are
also retained by the original campaign guards.

User-authorized plumbing only:

- `face_preprocess_probe.py`: paired explicit report paths; valid audit SHA links;
  exact typed 50-source count retained; capture stores hash-bound `profile_reports`.
- `face_preprocess_chain_capture.py`: passes those bound paths to `lock_profile`.
- `face_preprocess_chain_export.py`: exports those actual reports, not hardcoded old ones.
- `face_full_frame_stack_probe.py`: propagates the same evidence for a second profile check.
- Tests reject mismatched/swapped/missing hashes, partial paths, source drift and late mutation.

Current preprocessing probe SHA:
`784faff4961b12b6613e0be622f50e6764dae25477fe5814d5ee7124a2c42bb4`.
Current chain loader SHA:
`46f55a9eb72c0e313e5651ebef12e52084a1bad2fef503fb927ade6580ed4c76`.
New fixture/report helpers and their tests use the `face_live_validation*` prefix.
No Electron/frontend files or existing numerical implementations were edited by this task.

## Reproduction

From the workspace directory, choose an unused `TAG`. Native/GPU steps must be serial.
Campaign TreeGuard freezes all non-test source files in both research directories,
including new files; do not narrow it to bypass concurrent changes.

```sh
L="$PWD/.local/jianying-model-pytorch"
S="$PWD/research/local-model-pytorch"
TAG=face-live-validation-reproduce-unique
R="$HOME/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/D6342ECD-5432-33F0-A2AD-0C28F5699994-c092f19c71af1397"
P="$R/Cache/effect/7408077472211668276/f662ff9c955ee319f1ae03b2aa27df76"
W="$L/face-warp-runtime-20261003/bin/python"
T="$L/face-heads-runtime122/bin/python"
M="$L/face-heads-20261003-stable-r2"

"$W" -B "$S/face_render_model_capture.py" --runtime "$R" --package "$P" \
  --image "$L/face-sequence-fixture-20261003-r1/face.png" \
  --parameters '{"face_adjust_eye":[{"id":-1,"intensity":1}]}' --out "$L/$TAG-base"
"$W" -B "$S/face_temporal_campaign.py" --base-capture "$L/$TAG-base" \
  --models-root "$M" --runtime "$R" --package "$P" --warp-python "$W" --ort-python "$T" \
  --manifest "$L/face-sequence-fixture-20261003-r1/manifest.json" \
  --manifest "$L/face-temporal-video-qcut-export-eye100-20261003-r1/manifest.json" \
  --owned-initialization --stage-timeout 600 --deadline 1800 --out "$L/$TAG-temporal"
C="$L/$TAG-temporal/campaign-00"
"$T" -B "$S/face_preprocess_probe.py" --capture "$C/probe" --audit "$C/audit" \
  --sequence-replay "$C/replay/report.json" --sequence-render "$C/render/report.json" \
  --out "$L/$TAG-owned-capture"
"$T" -B "$S/face_preprocess_chain_replay.py" --capture "$L/$TAG-owned-capture" \
  --root "$M" --out "$L/$TAG-owned-replay"
"$T" -B "$S/face_preprocess_chain_render.py" --capture "$L/$TAG-owned-capture" \
  --candidate "$L/$TAG-owned-replay/replay.json" --out "$L/$TAG-owned-render"
"$T" -B "$S/face_preprocess_chain_audit.py" --capture "$L/$TAG-owned-capture" \
  --candidate "$L/$TAG-owned-replay/replay.json" --render "$L/$TAG-owned-render" \
  --root "$M" --out "$L/$TAG-owned-audit"
"$T" -B "$S/face_preprocess_chain_export.py" --capture "$L/$TAG-owned-capture" \
  --candidate "$L/$TAG-owned-replay/replay.json" --render "$L/$TAG-owned-render" \
  --root "$M" --audit "$L/$TAG-owned-audit/report.json" --out "$L/$TAG-owned-ui"
```

Expansion uses the same unmodified campaign command with explicit generated
`fixtures/{front-smile,mature}/{eye/manifest.json,nose.json}` manifests. Every campaign
report records exact child argv, return code, elapsed time, report SHA and skipped stages.

## Verification And Boundaries

Final combined regression: **377 tests passed**, 13.404 seconds, no skips.
Earlier overlapping runs are not added to this count. `git diff --check` passed.
Uniform CPU comparison report: `face-live-validation-report-20261004-r2/report.json`.
Its full-size three-way grayscale images use `min(255,8*max(abs(delta RGB)))`,
with no per-frame normalization; alpha maximum is reported separately.
Original render sheets and gain-8 diffs were inspected, including mature eye,
mature nose and owned chain. The summary preserves failed aggregate campaign status
even when an earlier sequence in that campaign has its own passing four-stage audit.

Owned 160 sampling is verified only for the fixed K-pop seven-frame profile, not the
expanded portraits. Expanded accepted temporal campaigns still use native 160 tensors.
Native detector/identity/geometry/reset signals, algorithm RGBA, models/effect assets
and the final renderer remain dependencies. No arbitrary-frame backend, long-video,
multi-face, cross-platform or product acceptance is claimed here. Another worker's
full-frame quantization results are separate evidence, not substituted into this chain.
