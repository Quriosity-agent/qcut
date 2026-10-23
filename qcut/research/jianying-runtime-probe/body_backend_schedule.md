# Body backend readiness and ready-coarse input evidence

This is QCut-authored research for one pinned arm64 runtime. It does not change
production defaults. Proprietary binaries, model archives, disassembly, tensors,
source images and rendered frames remain in private local evidence directories.

## Pinned boundary

- `libcccreator.dylib`: SHA-256
  `0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`.
- Skeleton source model: SHA-256
  `734f9e41b6fd4b3ffbe5485b4ec592835e5b4cc18cd7dc8f33047fd486e41ff1`.
- The observer rejects a different library hash or a non-arm64 host before
  installing address breakpoints. It never patches a model or binary on disk.
- `body_backend_lldb.py` extends the existing tensor observer without modifying
  `body_profile_lldb.py`. Each capture saves observer source snapshots and hashes.

## State machine established by native code and bounded probes

The coarse and refine detectors own independent CPU engines, CoreML engines,
listeners, and readiness latches. CPU initialization is synchronous; CoreML
initialization registers an asynchronous listener. A successful listener event
sets its ready byte. An error event does not set it.

Each `detectSkeleton` / `detectSkeletonOpt` invocation polls its own listener
before preprocessing and the crop loop. The flag is copied to the detector latch.
First activation releases that detector's CPU engine and changes its input
configuration to float CoreML. Dynamic inference uses the latch, not a frame
number or a fresh readiness read. The latch is established before prediction:
a CoreML prediction error does not restore the released CPU engine or retry CPU.

Readiness can therefore change between coarse and refine in the **same** public
`SK_DoSkeletonTracking` call. A probe that paused only the detection thread after
the first coarse poll, while real loader callbacks ran, measured coarse CPU then
refine CoreML in call 0. Pausing before that poll measured both networks CoreML.
Neither experiment fabricates a ready flag.

Initialization error and prediction error are distinct. The callback failure
probe replaces a successful callback status with -1 before the native listener
handles it; both CPU engines remain usable. Static control flow also retains CPU
on immediate asynchronous-init failure, but that immediate-return path was not
independently fault-injected. The prediction probe injects -5 after the first
CoreML prediction returns; subsequent inference remains CoreML.

A tracker reset clears tracking history and IDs, while preserving the detector
instances and readiness. Reset/loss/reacquisition continued CoreML after activation.
Manager destruction and recreation creates new detector/listener generations and
rearms the first-call iteration budget. Memory addresses may be reused, so pointer
identity alone is not a generation identifier.

Native load entry backtraces place both model starts inside the first graph render:
`FilterHostSession::render` → `SwingManager::seekFrame` → `SK_InitModelFromBuf` →
`loadModelFromBuf` → coarse/refine model load. This happens before the first public
tracking call, not before face/GPU/session initialization. Debugger timings are
observational overhead, not production latency measurements.

| Pinned file address | Observed responsibility |
| --- | --- |
| `0x12e6638` | Listener event; success writes listener +8 |
| `0x12e7398` | CPU load followed by CoreML asynchronous initialization |
| `0x12e94dc` | Readiness polling and first-ready transition |
| `0x12e9514` | Store the actual listener read into detector +0x58 |
| `0x12e9bf4`, `0x12eb380` | Poll sites in the two detector entry paths |
| `0x12ec73c` | Dynamic CPU/CoreML selection from the latch |
| `0x12ec404`, `0x12f0668` | CPU and CoreML inference entry |
| `0x12fa830`, `0x12f3f14` | Tracker reset and ID/history reset |
| `0x12e9648` | CoreML coarse shape selection |
| `0x12f03c0`–`0x12f043c`, `0x12f2218` | Floating crop endpoints and separate truncation |

## Ready coarse preprocessing

The long dimension is 224. The short dimension is 128 when the float32
short/long ratio is strictly less than float32(0.68), otherwise 176. Orientation
produces exactly four `(height, width)` shapes: `(224,128)`, `(224,176)`,
`(128,224)`, `(176,224)`.

The image is fitted using float32 center/extent arithmetic, fused origin
calculation, and **separate truncation of both raster endpoints**. Integer-centered
letterboxing is incorrect for some ratios: for 640×512, the native content starts
at x=1 and ends at x=222, rather than starting at x=2. For 435×640 it begins at y=17,
not y=18. Existing `crop_layout_and_roi` and `refine_tensor` already implement the
required rule. The new router reuses `refine_tensor(rgb, [0,0,W,H], out_h, out_w)`;
there is no duplicate coarse crop implementation in this probe.

Padding is byte 128 before BGR normalization. It becomes float32
`0.007843255996704102`, not floating zero. The existing `coreml_input` preserves
the native fused-normalization rounding; byte 255 becomes `2.000000238418579`.

`coarse-shapes-r2` generates six original RGBA gradient images, independently
rasterizes their algorithm images, and saves every owned input before launching
native executions. Dimensions are 640×360, 360×640, 640×512, 512×640, 435×640,
and 436×640. All six raster comparisons and all 16 observed ready coarse input
tensors are byte-exact. This establishes input preparation, not all coarse output
or final-render behavior for those synthetic images.

## Measured runs

Private evidence root on the research machine:
`.local/body-backend-schedule-20261023` in the primary checkout.

| Evidence | Tracking calls | CPU / CoreML inference passes | Qualification |
| --- | ---: | ---: | --- |
| `final-r4/default` | 8 | 2 / 7 | Unmodified scheduling, 4 source frames / 3 unique images |
| `final-r4/delayed` | 8 | 2 / 7 | Between-request delays 0, .25, .75, .1 seconds |
| `final-r4/held` | 8 | 5 / 4 | Success callbacks held until public call 4 |
| `final-r4/failure` | 8 | 9 / 0 | Successful listener events replaced with error -1 |
| `final-r4/prediction-failure` | 8 | 2 / 7 | First CoreML prediction return replaced with -5 |
| `final-r4/reset-loss` | 18 | 2 / 17 | Explicit tracker reset, blank inputs, reacquisition |
| `wait-ready-r1/wait-ready` | 8 | 0 / 9 | First detector waits for both real successful loaders |
| `wait-ready-r1/wait-after-coarse` | 8 | 1 / 8 | Wait after first coarse latch, before CPU inference |
| `lifecycle-r2` | 10 | 8 / 5 | Three manager generations / six detector loads |

Default and delayed observed versus unobserved full RGBA outputs each match 4/4.
The interventions have no unmodified-schedule equivalence claim. Lifecycle uses
the existing sequence renderer; feature/video reset temporarily suppresses graph
updates in this fixture, and its cadence differs from the production request loop.
Its decisive evidence is new model loads and cold iteration budgets at calls 0,
4 and 8, including reused addresses.

The saved-file auditor checks actual listener reads against latches, inference
against those latches, CPU release, new generations, executable/model identity,
source hashes, tensor sizes/hashes, and observation-transparency receipts. It
imports no inference implementation. Focused tests reject frame-index switching,
stale generations, fallback after activation, and inconsistent read/latch values.

## Conditional full-render result

The independently authored renderer's `body-default-profile-20261023/swing-render-r2`
outputs match `wait-ready-r1/wait-ready` **4/4 complete 1080×1920 RGBA frames**:
zero differing bytes, MAE 0, maximum 0. Controls are SlimBody 40 and StretchLeg 30;
there are two graph updates per source frame and nine all-CoreML inference passes.
`all-coreml-render-independent-audit.json` independently recomputes source hashes,
control/cadence receipts, routes, output hashes, and pixel differences from saved
files without importing a model or renderer.

A second independently audited result compares `swing-render-r3` with
`final-r4/held`: all four full RGBA outputs also match byte-for-byte under the
matching five-CPU/four-CoreML route. Its receipt is
`held-coreml-render-independent-audit.json`. This includes the CPU-to-CoreML state
handoff rather than only all-float inference.

Both results are conditional on matching schedules. The native side explicitly
waits for or holds real loader callbacks; neither proves unmodified asynchronous
timing matches the owned implementation. Four frames contain three unique original images.
The owned path uses system CoreML and private proprietary model weights. This is
not portable PyTorch parity, all body-control acceptance, or broad product parity.

## Reproduction

Run from this checkout, with local paths supplied explicitly. Each output directory
must be new. The baseline has the four original RGBA inputs and their hashes.

```sh
python3 research/jianying-runtime-probe/body_backend_probe.py \
  --runtime "$BODY_PRIVATE_RUNTIME" --source-evidence "$BODY_BASELINE" \
  --output "$BODY_BACKEND_OUTPUT"
python3 research/jianying-runtime-probe/body_backend_probe.py \
  --runtime "$BODY_PRIVATE_RUNTIME" --source-evidence "$BODY_BASELINE" \
  --output "$BODY_READY_OUTPUT" --profiles wait-ready wait-after-coarse
python3 research/jianying-runtime-probe/body_backend_coarse_probe.py \
  --baseline "$BODY_BACKEND_OUTPUT" \
  --engine research/independent-beauty/research --output "$BODY_COARSE_OUTPUT"
python3 research/jianying-runtime-probe/body_backend_lifecycle_probe.py \
  --baseline "$BODY_BACKEND_OUTPUT" --output "$BODY_LIFECYCLE_OUTPUT"
python3 research/jianying-runtime-probe/body_backend_audit.py \
  --evidence "$BODY_BACKEND_OUTPUT"
python3 -m unittest discover -s research/jianying-runtime-probe \
  -p 'test_body_backend*.py' -v
```

The observer needs macOS arm64 and local LLDB process control. Timing-sensitive
route counts can change across runs; validate actual events instead of requiring
a particular frame number to switch. All candidate and native arrays remain local.

## Reusable original-pixel acceptance probe

`research/independent-beauty/probes/body_swing_render_probe.py` lives outside the
engine source-identity closure. It accepts 1–32 ordered opaque RGBA source files,
checks their dimensions and SHA-256 before inference, and checks each file again
when rendering. Timestamps must be finite and nonnegative; source-time jumps
remain valid because frame history is still processed contiguously. Input paths
may be absolute or relative to the manifest. The manifest uses the existing
source-provenance format; additional provenance fields are ignored:

```json
{
  "width": 1080,
  "height": 1920,
  "inputs": {"frame0.rgba": "<64-character SHA-256>"},
  "timestamps": [0.0]
}
```

The test controls are explicitly recorded as SlimBody 40 and StretchLeg 30.
`--cpu-backend` is required: `numpy` selects the reference fixed-point execution;
`onnx-exact` selects the existing exact ONNX CPU policy. Use a Python environment
with NumPy and Pillow, plus the selected backend's dependencies (`onnx` and
`onnxruntime` for `onnx-exact`), and the verified external runtime/model payloads.

```sh
"$BODY_PYTHON" research/independent-beauty/probes/body_swing_render_probe.py \
  --runtime "$BODY_OWNED_RUNTIME" --model-root "$BODY_COREML_MODELS" \
  --source-manifest "$BODY_SOURCE_MANIFEST" --output "$BODY_RENDER_OUTPUT" \
  --cpu-backend onnx-exact --native-reference "$BODY_DIAGNOSTIC_REFERENCE"
python3 -m unittest discover -s research/independent-beauty/probes \
  -p 'test_body_swing_render_probe.py' -v
```

Omit `--native-reference` for owned-only verification. It always saves original
execution, fresh-session full replay, and checkpoint-recovered output bytes and
receipts; a single-frame manifest has no recovery tail. The checkpoint and route
journal come only from the completed owned execution. An `owned-report.json` is
saved before any optional native directory, metadata or pixels are opened. Native
metrics are labeled as an explicitly selected diagnostic reference. Actual
`trace.json` / `backend-events.json` / `frames.json` can establish whether routes
and source hashes match; missing route evidence remains unknown, never inferred
from equal output or a frame-index heuristic. Full product parity remains false.

Nine synthetic contract tests cover source hashes/sizes/opacity, frame limits,
dimensions/timestamps, environment restoration and the reference-read boundary.
The real `reusable-swing-probe-r2` run saved four 1080×1920 outputs, four exact own
replays and two exact checkpoint recoveries. Its actual route was one CPU then
eight CoreML passes; after all owned outputs were saved, the selected
`wait-after-coarse` native reference matched every source hash, route and output
byte. Current `swing-render-r4` was independently checked against that same
reference in `first-cpu-render-independent-audit.json` and is also 4/4 exact.
The private gallery at `body-default-profile-20261023/swing-render-r4/gallery/index.html`
shows all three matched schedules and keeps the separate, differing unmodified
native-default comparison visible.
