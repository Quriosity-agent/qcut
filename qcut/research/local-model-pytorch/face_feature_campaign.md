# Bounded Per-Feature Validation Sidecar

Only new `face_feature_campaign*` files are owned here. Existing native hosts,
samplers, replay producers, render consumers and audit gates are not modified.
No native invocation is authorized by planning or unit tests.

## Scope

One to three explicit seven-frame portrait manifests, up to six selected features:

| Feature | Product control | Product level | Host package |
| --- | --- | --- | --- |
| Eye | face_adjust_eye | 40 | features |
| Nose | face_adjust_nose | 40 | features |
| Jaw | face_adjust_XiaHeXian | 80 | jawline |
| Mouth | face_adjust_mouse | 40 | features |
| Skin | face_adjust_Smooth | 50 | smooth |
| Makeup | lip-soft-pink | 80 | makeup base + dynamic card |

The TypeScript adapter imports the actual product catalog and builders, including
scalar smooth parameters and the separate dynamic makeup card path. It does not
duplicate normalization or add feature mappings to existing drivers.

Fixtures are explicitly still-derived synthetic control sequences, not real
video. Each retains face/motion/mirror/no-face/recovery/zero/half controls. Zero
and half values are emitted by the same product builders as the active value.
Real minute-scale validation needs a separately sourced real clip, provenance,
decoder/frame hashes, timestamps and a supported longer lifecycle audit. It is
not covered by repeating or interpolating these seven frames.

## Commands

Run from the QCut workspace root. The following preparation is CPU-only:

```sh
P="$PWD/.local/jianying-model-pytorch"
R='/Users/peter/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/D6342ECD-5432-33F0-A2AD-0C28F5699994-c092f19c71af1397'
T="$P/face-heads-runtime122/bin/python"
W="$P/face-warp-runtime-20261003/bin/python"
env PYTHONPATH=research/local-model-pytorch "$T" -B -m unittest \
  face_feature_campaign_test face_feature_campaign_plan_test \
  face_feature_campaign_evidence_test

"$T" -B research/local-model-pytorch/face_feature_campaign.py plan \
  --runtime "$R" --models-root "$P/face-heads-20261003-stable-r2" \
  --warp-python "$W" --ort-python "$T" --bun /Users/peter/.bun/bin/bun \
  --manifest "$P/face-live-validation-20261004-r1/fixtures/front-smile/eye/manifest.json" \
  --feature eye --feature nose \
  --out "$P/face-feature-campaign-smile-plan-20261004-r1"
```

Omit `--feature` to plan all six. Repeat `--manifest` for additional portraits.
Output directories must be fresh and under the ignored private root. A plan
locks both research source trees, the product catalog files, runtime libraries,
runtime model tree, both ONNX graphs, package trees, interpreters and input files.
Any source/asset identity change invalidates the plan. Regenerate to a new leaf
after a coordinated freeze; never update old recorded hashes.

Only after the parent explicitly grants GPU access AND confirms all source
workers frozen, substitute the emitted SHA256 and run:

```sh
"$T" -B research/local-model-pytorch/face_feature_campaign.py run \
  --plan "$P/face-feature-campaign-smile-plan-20261004-r1/plan.json" \
  --plan-sha256 EMITTED_SHA256 --gpu-granted --source-frozen \
  --stage-timeout 900 --deadline 7200 \
  --out "$P/face-feature-campaign-smile-20261004-r1"
```

## Gates And Outputs

Each case runs a fresh native baseline, the existing four-stage temporal
campaign, actual preprocessing observation, independently sampled 120/160 ONNX
replay, real native candidate render, CPU audit, and strict owned UI export.
Explicit fresh replay/render report paths propagate into preprocessing; no old
report hash is rewritten. Commands, return codes, stage timing, report hashes,
source epoch and skipped/failed stages remain in the new report.

`candidate_parity` requires the complete owned120+owned160 chain. Native-only
results never qualify. The temporal intermediate may prove exact owned120/
ONNX/seed/smoothing/point consumption/rendering while still requiring native160
tensors; it is recorded separately as `native160_conditioned_exact_frames`,
never included in the independent candidate totals. Unsupported package/profile
combinations or multi160 preprocessing associations fail without fallback.

Full-size RGBA PNGs preserve original/native/candidate bytes. Three grayscale
diff PNGs use `min(255, 8 * max(abs(delta RGB)))` uniformly across all frames,
without normalization. RGB MAE/max, alpha max and RGBA changed-pixel counts are
reported, so alpha-only differences cannot be hidden by a black RGB diff.
The final owned export is under each case's `owned-export`; its temporal-only
intermediate is not an interchangeable owned UI package.

Native detector/caller geometry/routing/effect rendering remain dependencies.
This is bounded replay consumption, not a live bridge or independent full
beauty backend. No product, arbitrary-frame or real-video parity is asserted.
