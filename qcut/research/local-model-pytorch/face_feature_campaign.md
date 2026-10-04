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

### Explicit Read-Only Effect Cache

The optional CPU-plan argument `--effect-cache-root` names an existing absolute
`Cache/effect` directory supplied by the trusted caller. There is no automatic
home-directory search. Resolution first checks the private runtime's exact
resource/version; only when absent does it check the same resource/version
under the explicit root. No alternate version, download, or asset copying is
performed. An unsafe private path fails instead of falling back silently.

For the six-feature availability preflight, omit feature filters and add:

```sh
--effect-cache-root '/Users/peter/Movies/JianyingPro/User Data/Cache/effect'
```

Use a fresh output leaf, for example `face-feature-campaign-six-cache-plan-r1`.
Missing pinned assets fail planning honestly. A successful CPU plan proves
availability and immutable identity only, not native execution or parity.

New plans use format `face-feature-campaign-plan-v2` and record explicit package
bindings, selected root directory identities, and every selected package file's
hash/identity using the unchanged bounded TreeGuard. Roots and package paths
cannot resolve through symlinks; package file escapes and directory symlinks
remain forbidden. Before each stage the selection policy, root identities and
package contents are rechecked. Unrelated cache packages are neither scanned
nor authorized. Dynamic makeup keeps separately guarded host/card packages.
Current provider, tracking-scope-pool and package-resolver sources are also
hash-bound alongside the catalog sources; parent changes invalidate the plan.
Old plans are retained unchanged; regenerate after the shared source freeze.

Planning cannot grant GPU access or macOS desktop/debugger authorization. A TCC
blocked LLDB launch remains a native-runtime blocker; this cache option neither
changes that permission nor bypasses the preprocessing timeout/gates.

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
