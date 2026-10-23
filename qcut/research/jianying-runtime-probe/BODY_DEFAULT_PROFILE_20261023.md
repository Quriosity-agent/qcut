# Product-default body skeleton: cold start and the first float divergence

This probe keeps the production Swing host, original body package, two updates
per render request, parameter timing and product backend selection unchanged in
its `default` profile. Other profiles are labelled process-local interventions.
No production renderer, frozen photo source or model was changed.

## Measured scope

Local evidence: the primary checkout's
`.local/body-default-profile-20261023/final-r4/`.

- Four 1080 × 1920 source frames at `i / 30`, containing three distinct source
  hashes. These cause eight skeleton calls and nine detector passes.
- SlimBody 40 and StretchLeg 30; all other smart-body controls zero.
- Library SHA-256:
  `0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9`.
- Original Lua SHA-256 and all host/source/input identities are in
  `provenance.json`. The probe refuses another library hash or a non-arm64 host.
- Four observed default RGBA outputs match four unobserved host outputs by
  SHA-256. See `observation-transparency.json`.

The owned computation independently reads the original source frames, creates
the algorithm raster, and runs its private extracted model weights. Captured
native pixels, coordinates and tensors are comparison data only.
`owned-comparison.json` records all 433 Python engine source hashes, probe and
candidate hashes, model provenance, saved owned raster files/receipts, actual
point arrays and complete owned inference tensors. All these artifacts remain
local. The private CPU asset SHA is
`92ee99023a1d900f1a4810d21dd49aee3ad98baa2cbe62680a88635b669cdee5`.

## Cold initialization is independently reproduced

On the first native skeleton call, the observed iteration budget is one. The
tracker runs coarse detection followed by one refinement and publishes the
refined body within that call. Later calls have a zero extra-iteration budget.
The existing owned sequence publishes no body on its initial coarse-only call.

`ColdStartSkeletonCandidate` is an opt-in research class that consumes the same
owned coarse and refine implementations. It advances one external frame for
the first coarse/refine pair. A blank first frame consumes the first-call gate;
loss or resize does not rearm it. It does not claim complete external force-event
semantics, checkpoint compatibility or production readiness.

| Comparison | Result |
| --- | --- |
| Owned source raster vs default Swing algorithm raster | 8/8 calls byte-exact |
| Owned cold candidate vs Swing with CPU-only intervention | 8/8 public arrays exact, including coordinates, confidence and validity |
| Existing owned warm candidate vs Swing with CPU and force-zero interventions | 8/8 exact; first is empty/empty, remaining seven publish a body |
| Owned cold candidate vs unchanged default backend | 1/8 public arrays exact; residual remains after the first call |

Configured backend value 3 is **not proof that a given inference used CoreML**.
The first native call's coarse and refine tensors are int16 and match the CPU
profile exactly. The next refine call uses float32 tensors. This measured
readiness transition must remain explicit; it is not a guarantee about every
startup, machine or load condition.

## The first remaining divergence occurs before pose decoding

At skeleton call 1 (zero based), the CPU and default profiles have the same
crop pixels. The CPU stores `pixel - 128` as int16; its fixed-point physical
input is `(pixel - 128) / 64`. The float path computes one fused binary32 result:

```text
float32(pixel * float32(4 / 255) - 2)
```

`body_coreml_normalization.py` independently reconstructs all 82,944 float
input values exactly from the owned source-derived crop. Inverting those
values recovers the CPU crop bytes exactly. Its binary64 multiply/add followed
by a binary32 cast reproduces this fused operation because the source values
are bytes. The value for pixel 128 is slightly positive, not zero.

The raw refine output has shape 1 × 24 × 18 × 34, before pose decoding.
The CPU raw output matches the owned fixed-point implementation exactly.
Default float vs CPU has 14,640 differing values out of 14,688, mean absolute
error 0.00464179469089882 and maximum 0.415771484375.

The `coreml-cpu-input` intervention supplies the float network with exactly the
CPU physical input values. It is diagnostic and is never the default:

| Raw output comparison at the first float call | Mean absolute error | Maximum |
| --- | ---: | ---: |
| Default float vs CPU | 0.00464179469089882 | 0.415771484375 |
| Float with CPU-normalized input vs CPU | 0.004641424856414463 | 0.416259765625 |
| Default float vs float with CPU-normalized input | 0.00006825523958226954 | 0.005126953125 |

Changing normalization alone barely changes the dominant residual. It is in
the float network computation/weights before pose decoding; this experiment
does not distinguish the weight representation from each backend's internal
arithmetic. Later calls can also inherit different tracker crops, so the
causal comparison above deliberately uses the first divergent inference.
`tensor-comparison.json` contains reconstructable per-stage measurements.

## Genuine floating-point graph

The pinned body model embeds a distinct CoreML graph with 153 layers and
977,858 parameters: 45 float32 convolutions and 46 per-channel quantized
convolutions. The CPU integer refine graph has 225 layers and 132 convolutions.
Converting the integer graph to floats cannot reproduce this second network.

`body_float_refine_model.py` adapts the repository's owned compiled-JSON
executor and implements the five operators present in this graph. It does not
load the native runtime. `body_float_refine_probe.py` verifies the original
RGBA, owned raster and crop, all 433 producer sources and seven probe sources,
then reconstructs the float input independently. Native reference tensors are
opened only after both candidate results have been written.

For the first float pass, all 82,944 input values match exactly. The private
`float-refine-r2/report.json` records the following raw-output measurements:

| Candidate vs native default | Mean absolute error | Maximum |
| --- | ---: | ---: |
| Existing integer graph | 0.00464179469089882 | 0.415771484375 |
| Genuine graph, float32 computation | 0.0001175581 | 0.01265493 |
| Genuine graph, float16 computation | 0.00009363538 | 0.0068359375 |

The float16 candidate reduces mean error by 49.57 times for this one crop.
It still differs in 14,564 of 14,688 values and fails `atol=rtol=1e-4`.
Native fusion, accumulation order and intermediate rounding remain unresolved.
Two runs produced identical candidate output hashes. All 153 layer shapes were
checked, and 13 focused tests cover operators, graph dependencies, quantized
weights, shape rejection and input/provenance mutation. Extracted weights,
compiled model files and tensor evidence remain private and are not committed.
These results do not establish later-frame state or rendered-pixel parity.

`body_float_refine_decode.py` then reconstructs the crop from the owned previous
body, verifies the crop pixels, and applies the existing decoder without
changing its native-derived thresholds or smoothing. As an oracle-only decoder
check, native raw output reproduces all 72 native detector values and all 72
public values exactly. Candidate inference and previous state remain independent
of native captures.

| Candidate at this first float call | Exact joint coordinates | Exact validity | Confidence MAE / maximum |
| --- | ---: | ---: | ---: |
| Float32 | 18/18 joints (36/36 coordinates) | 18/18 | 0.0014042556 / 0.0085281134 |
| Float16 | 17/18 joints (35/36 coordinates) | 18/18 | 0.0007747047 / 0.0025993586 |

Float16 shifts the right ankle five algorithm pixels, equivalent to 15 pixels
in the 1080 × 1920 source. Lower average tensor error therefore does not imply
better joint locations. Float32 has exact locations here but different
confidence values; later thresholding or tracking can still diverge.
Private `float-decode-r1/` contains the report, per-joint CSV, saved poses and an
original/native/float32/float16/difference overlay. Seven additional tests cover
native-derived decoding, coordinate/validity/confidence metrics and malformed
input rejection. This remains one-call geometry evidence, not video acceptance.

## Reproduction

Use a Python environment with NumPy and the existing owned engine dependencies.
The float graph and overlay tools additionally need PyTorch and Pillow; this
run used Python 3.12.12, PyTorch 2.10.0 and NumPy 2.5.3.
Only the native capture needs macOS arm64 and Xcode/LLDB. Inputs are raw RGBA
files named `frame0.rgba` onward; the output directory must not exist.

```sh
python research/jianying-runtime-probe/run_body_default_profile.py \
  --runtime /absolute/private-runtime \
  --sources /absolute/original-rgba-frames \
  --output /absolute/new-evidence-directory --frames 4 \
  --profiles default cpu cpu-no-force no-force coreml-cpu-input

BEAUTY_RENDER_RESOLUTION=original python \
  research/jianying-runtime-probe/compare_body_default_profile.py \
  --evidence /absolute/new-evidence-directory \
  --engine /absolute/qcut/research/independent-beauty/research \
  --runtime /absolute/owned-private-runtime

python research/jianying-runtime-probe/summarize_body_profile_tensors.py \
  --evidence /absolute/new-evidence-directory

python research/jianying-runtime-probe/body_float_refine_probe.py \
  --evidence /absolute/.local/body-default-profile-20261023/final-r4 \
  --model /absolute/private-pinned-body-model \
  --engine /absolute/qcut/research/independent-beauty/research \
  --label float-refine-new

python research/jianying-runtime-probe/body_float_refine_decode.py \
  --evidence /absolute/.local/body-default-profile-20261023/final-r4 \
  --candidates /absolute/.local/body-default-profile-20261023/float-refine-new \
  --label float-decode-new

python -m unittest discover -s research/jianying-runtime-probe \
  -p 'test_body_*.py' -v
```

The cold-start and normalization suite has nine focused tests: first-call publication, exactly one external advance,
blank-first consumption, failed refinement, resize, invalid input, unchanged
production behavior, fused rounding, all-byte round-trip and input ownership.
This is a bounded research result. It does not establish default-product pixel
parity, complete Swing lifecycle parity, video editor acceptance or independent
ownership of model weights. PHOTO21 custom controls are outside this probe.
