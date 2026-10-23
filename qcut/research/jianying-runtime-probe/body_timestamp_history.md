# Same-source timestamps in the original Swing host

This experiment isolates the effect clock from QCut's source-window adapter.
The unmodified resident Swing host receives the same independently sourced
1080×1920 RGBA image six times, with SlimBody 40 and StretchLeg 30. Each request
still executes both graph updates, including the control application between
them. No source-frame or pixel deduplication is introduced.

The four experiments share timestamps `0, 1/30, 2/30`. Their final three are:

| Case | Remaining timestamps, seconds |
| --- | --- |
| same | `2/30, 2/30, 2/30` |
| forward | `3/30, 4/30, 5/30` |
| backward | `1/30, 0, 1/30` |
| jump | `1, 1, 1+1/30` |

All later requests have the same explicit 250 ms wall-clock delay. This delay
is distinct from the effect timestamp. The host rounds the supplied seconds to
integer microseconds before seeking Swing. The original package reads its
`curTime` property and compares the absolute difference with its previous time:
above 0.1 seconds selects the reset/image mode, above 0.01 selects video mode,
and otherwise selects no-change mode. The observations below test representative
values in those regions, not every floating-point threshold boundary.

## Measured native rule

`native-r2` contains four fresh natural-start sessions and four unobserved
counterparts. All 24 final RGBA outputs match their unobserved counterparts
byte for byte. The common first three outputs, public skeleton results, mesh
positions and backend routes also match across all four observed sessions.

Each session executes 12 public skeleton calls and 12 mesh updates. Actual
backend selection is two CPU passes followed by 11 CoreML passes. For the
last three requests:

- `same` selects part modes `[2, 2]`, preserving mesh and final RGBA exactly.
  Skeleton inference still runs and public coordinates can change. This is not
  permission to omit repeated-PTS inference or to reuse its tracking state.
- `forward` and `backward` both select `[0, 2]`. Their corresponding six output
  frames and all 12 meshes match, confirming absolute elapsed time rather than
  the sign of the seek or the request index controls this branch.
- `jump` selects `[1, 2]` at the one-second jump, `[2, 2]` at the repeated
  one-second request, then `[0, 2]`. Its mesh changes on the reset.

Corresponding public skeleton results and inference routes match between the
four cases, including where final pixels diverge. In `same` versus `forward`,
the last-frame RGB MAE is 0.050326 and maximum channel difference is 10. In
`forward` versus `jump`, the jump frame MAE is 0.950050 and maximum is 55.
The earliest observed difference is the component mode and resulting geometry,
not a different image, skeleton result or model backend.

## Independent implementation and conditional pixel proof

`owned-r1` independently renders all four cases from the original RGBA. It
does not open native captures, routes or outputs. Its source closure is saved
in full: 333 files, SHA-256
`3c478978bd411e00811e510889f157fec77a9607b05400ea490636a794b90d8d`.
All 48 graph-update input modes match the native observations. The self-derived
forward/backward outputs match; repeated timestamps preserve the own mesh and
output. The existing production implementation therefore already implements
this component-clock rule.

Automatic owned startup chooses one CPU pass followed by 12 CoreML passes.
The natural native run chose two CPU passes, so their complete route histories
do not match even when their later individual frames use CoreML. The natural
comparison has mean RGB absolute error **0.899246 across all 24 frames**
(channel values in 0–255 units). Each case has six equally sized frames:

| Case | Mean frame RGB absolute error |
| --- | ---: |
| same | 1.016577 |
| forward | 1.014397 |
| backward | 1.014397 |
| jump | 0.551611 |

None of these 24 natural outputs is byte-exact. The approximately 1.01 values
apply to the first three cases, not the four-case aggregate. This natural
comparison must not be reported as native pixel equality.

`native-matched-r1` is an additional explicitly controlled diagnostic. After
the first coarse detector has latched CPU, the detection thread waits until
both real CoreML loading callbacks have succeeded. It then continues normally.
No readiness flag, model, captured tensor or reference route is written into
either implementation. This gives the same actual one-CPU/twelve-CoreML
history as the already completed automatic owned runs.

Under that condition, all **24 final RGBA frames, 48 graph-update meshes and
52 inference-route entries are exact**, across repeated, forward, backward
and jumping timestamps. Route comparison checks the whole prefix from the
first inference, not only the current frame. These conditional runs have no
unobserved counterpart; the separate natural runs provide the observation
transparency check, not a claim that the readiness wait is transparent.

## Reproduction

Supply the pinned private runtime and a provenance JSON with `width`, `height`
and ordered `inputs` mapping original RGBA paths to SHA-256. The first original
image is reused. Both runners refuse a changed source or non-opaque image.
Only the native runner loads the original library; its SHA-256 and arm64
architecture are checked before installing any address hook.

```sh
python3 body_timestamp_probe.py --runtime "$NATIVE_RUNTIME" \
  --source-provenance "$ORIGINAL_PROVENANCE" --output "$NATIVE_OUTPUT"

"$OWNED_PYTHON" body_timestamp_owned.py --runtime "$OWNED_RUNTIME" \
  --model-root "$COREML_MODELS" --source-provenance "$ORIGINAL_PROVENANCE" \
  --output "$OWNED_OUTPUT"

python3 body_timestamp_probe.py --runtime "$NATIVE_RUNTIME" \
  --source-provenance "$ORIGINAL_PROVENANCE" --output "$MATCHED_OUTPUT" \
  --schedule wait-after-first-coarse

"$OWNED_PYTHON" body_timestamp_report.py --native "$MATCHED_OUTPUT" \
  --owned "$OWNED_OUTPUT" --output "$COMPARISON_JSON"

"$OWNED_PYTHON" -m unittest -v \
  test_body_timestamp_contract.py test_body_timestamp_report.py
```

The six tests cover timestamp rounding and validity, common prefixes, original
source hash/length/opacity, saved-array integrity, frame dimensions and pixel
metric semantics. Postprocessing rechecks saved native rasters, model tensors,
meshes and pixels; the report records the postprocessor's own source hash.

Private evidence is under
`/Volumes/QCutBeauty/body-timestamp-history-20261024/`, linked from
`.local/body-timestamp-history-20261024/`. The unsuccessful first probe is
preserved: an LLDB callback import failure stopped before its first skeleton
call and supplies no algorithm evidence. Binary disassembly, models, original
images, states, tensors and outputs remain outside Git.

This is one repeated source image and four short clock sequences. It does not
prove which clock Jianying's full desktop editor supplies, establish natural
startup timing equality, remove the private model dependency, or close the
existing 180-frame editor comparison. Source PTS versus timeline time must be
decided from each caller's actual decoded input contract; copying the reference
adapter's bounded history or deduplicating equal pixels is not this result.
