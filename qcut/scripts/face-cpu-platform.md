# Owned Face CPU Contract Matrix

`../.github/workflows/face-cpu-platform.yml` runs on hosted Windows 2025 x64,
Ubuntu 24.04 x64 and macOS 15 ARM64. It does not modify the product CI workflow.
Each job verifies its actual OS/architecture and uses Python 3.12 with pinned
public dependencies. ORT 1.22.1 matches the current research live inference pin;
the separate general ONNX portability workflow uses its own runtime pin.

## Reproduce

From the `qcut` package directory, create a clean virtual environment and run:

```sh
python -m venv .local/face-cpu-platform/venv
# POSIX: .local/face-cpu-platform/venv/bin/python
# Windows: .local/face-cpu-platform/venv/Scripts/python.exe
<venv-python> -m pip install --only-binary=:all: -r scripts/requirements-face-cpu-platform.txt
<venv-python> -B scripts/check_face_cpu_platform.py --out .local/face-cpu-platform/fresh-run --expected-system Windows --expected-machine x86_64
```

Use `Linux/x86_64` or `Darwin/arm64` for the other matrix targets. The output
directory must not exist. A private-model environment variable, installed
PyTorch, dependency mismatch, wrong platform, empty test selection, skipped or
expected-failure test, or changed source set/content fails qualification. No
old report is rewritten. Per-group logs remain local; CI uploads only the
explicit `report.json` file for seven days, never a directory or model file.

## Coverage

- Existing synthetic tests exercise the owned q11 full-frame sampler,
  original-source guards, 120 affine sampler and 160 crop/resize signed input.
- Existing contracts cover head validation, decode/mapping/normalization,
  ordinary uncached state, reset/no-face/reacquisition, causal 160/120 selection,
  malformed inputs, rollback and session poisoning.
- Two tiny ONNX graphs are authored in memory from public ONNX operators. Both
  120/160 profiles and all five heads run through the production `OnnxHeads.infer`
  method and validation, with only `CPUExecutionProvider`. Ten numeric cases
  use independent scalar arithmetic, exact constant outputs and declared
  tolerances for seeded random inputs. No converted model or private export
  manifest is fabricated or consumed; the private loader is not tested here.
- A bounded child process retains the same two ORT sessions for 32 predictions,
  165 heads and 32 distinct fresh 120 tensors. It uses production binary framing
  and `LiveWorker.dispatch`, with fragmented synthetic pixels over a test-only
  loopback TCP carrier. Seed selection excludes the later 160 event. Separate
  cases exercise no-face recovery, reset, bad token/poison, truncated pixels and
  malformed JSON. Shutdown/startup/read deadlines bound all child activity.
- Production Unix-socket service tests and optimized host-libm smoothing tests
  run additionally on Linux/macOS. Windows qualifies the ordinary state route
  and wire/dispatch contracts, **not** production AF_UNIX permissions/startup or
  the current `CDLL(None).expf` route. These are explicit coverage exclusions,
  not skipped tests disguised as a complete backend pass.

The report records the Git HEAD, before/after hashes for research Python sources
and this harness, versions, selected test classes, counts, graph hashes and
per-prediction tensor/normalized-point fingerprints. A dirty checkout is bound
by actual file hashes rather than represented as a clean commit. Point
references use the same platform's scalar math: passing these contracts does
not establish cross-platform bit identity of private-model results.

## Acceptance Boundaries

Synthetic contract success is separate from private converted-model parity,
native renderer capability and end-to-end product acceptance. All native/private
parity flags remain false, including on macOS. No GPU, LLDB, native vendor
process, cached effect package, private model, portrait or captured output is
used. Graph bytes and pixels exist only in memory or test-owned temporary paths.
No production TCP service or renderer backend is introduced.

Read-only repository runner discovery on 2026-10-04 returned one online macOS
ARM64 self-hosted runner and **no Windows self-hosted runner**. That is a snapshot,
not a permanent claim. Hosted Windows/Linux contract jobs do not authorize
uploading private converted models or imply those platforms can load the pinned
macOS native renderer. Real private-model/native comparisons remain separate
local-only campaigns with their existing provenance gates.
