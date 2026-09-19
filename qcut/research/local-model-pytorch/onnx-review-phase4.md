# ONNX Phase4 Independent Review

Date: 2026-09-19. Status: **three reproduced findings fixed by the parent; all 12 review tests pass**.

## Scope

Reviewed `onnx_infer.py`, `onnx_export.py`, `onnx_batch.py`, `onnx_replay.py`, and the
`ONNXTrackingFixed` adapter in `onnx_tracking.py`. The reviewer only added
`onnx_review_test.py` and this document. Shared implementation fixes belong to the
parent task. No vendor graph, weights, or native-runtime execution was needed.

## Fixed Findings

### Incomplete batch could retain a successful checkpoint

Original location: `onnx_batch.py:47` (pre-fix snapshot).
Minimal reproduction: a two-job manifest whose first job is a valid authored
ReLU bundle and whose second job lacks `model`. The first job actually exported
and passed ORT; the second raised `KeyError` before per-job error handling.
The durable checkpoint contained one of two jobs with `passed: true`.

Fix: validate the full manifest before running jobs, and require completion of
the full planned set before the checkpoint can pass. Parent also added bounded
timeout/type checks. Regression: `test_incomplete_batch_never_leaves_passed_checkpoint`.
The exact missing-field reproduction is now rejected before any successful
partial checkpoint exists. The separate completed-batch test still verifies
that a failed child export makes the aggregate fail.

### Missing source bypassed the export failure report

Original location: `onnx_export.py:105` (pre-fix snapshot).
Minimal reproduction: call `export` with a missing `.pt`, valid synthetic NPZ,
and fresh private output directory. Source hashing raised outside the `try`,
leaving an output directory but no `report.json`.

Fix: source/input hashing moved inside the report-producing `try`.
Regression: `test_missing_source_retains_export_failure_report` now passes.

### Malformed contract aborted replay without a failure report

Original location: `onnx_replay.py:25` (pre-fix snapshot).
Minimal reproduction: a valid identity model with one frozen case, followed by
another model directory whose contract contains `{truncated`. The valid model
actually ran; the JSON parse then escaped per-model handling and prevented the
final replay report.

Fix: contract parsing is inside the per-model `try`. The malformed model now
appears as failed and the aggregate report is false.
Regression: `test_malformed_contract_retains_replay_failure_report` now passes.

## Additional Executed Checks

- A genuinely data-dependent authored PyTorch model traces incorrectly for
  holdouts: export marks its contract failed and the default loader rejects it.
- Nonfinite ORT output cannot write a success report or output NPZ.
- Empty replay and a missing frozen reference cannot pass.
- A one-LSB INT16 difference fails replay, even near the 12-bit limit.
- Fixed adapter and actual ORT export match every output for INT32 convolution
  overflow/wrap before requantization, non-square padded/strided depthwise with
  negative rounding cases, and mixed-shift concat/residual branches.

No additional reproducible correctness defect was found in this bounded review.
These are authored synthetic tests on macOS CPU, not new vendor parity or
Windows/Linux/editor E2E evidence. No general security claim is made.

## Verification

Private venv: `.local/jianying-model-pytorch/tflite/venv/bin/python`.
Python 3.12.12, PyTorch 2.10.0, ONNX 1.23.0, ONNX Runtime 1.30.0, NumPy 2.5.3.

```sh
.local/jianying-model-pytorch/tflite/venv/bin/python -m unittest discover \
  -s research/local-model-pytorch -p onnx_review_test.py -v
```

Before fixes: 12 tests, 9 passing and 3 explicitly expected failures.
After fixes: **12 passing, zero failures/errors/expected failures**.
All three `expectedFailure` decorators have been removed.

Private evidence under `.local/jianying-model-pytorch/`:

- Before: `onnx-independent-review-phase4-20260919-r1/{report.json,unittest.log}`.
- After: `onnx-independent-review-phase4-20260919-fixed-r1/{report.json,unittest.log}`.

Reports include reviewed source SHA-256 values, environment versions, and test
results. The original failing snapshot evidence remains unchanged. No commit,
push, new agent, or further exploration was performed for this closeout.
