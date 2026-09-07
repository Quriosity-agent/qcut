# Independent editor contracts

Original C++20 implementations of five bounded contracts observed in Jianying
11.3.0 `libvideoeditor.dylib` and `libcccreator.dylib` (arm64). The static library uses only the standard
library. It neither loads Jianying nor implements a video renderer.

| Unit | Implemented behavior | Evidence |
| --- | --- | --- |
| `value_state` | Material double assignment and keyframe integer-time assignment, including equality suppression and local mutation bytes | Static leaf functions plus 3,858,432 native comparisons |
| `filter_time` | Sequence endpoints, subtype-dependent trim origin, input-only clamp, modulo-2^64 duration arithmetic | Static instruction trace; complete native insertion was not invoked |
| `keyframe` | Numeric type 2, unchanged time/intensity, case-sensitive metadata property selection, finite number versus JSON null | Transfer is static; metadata helper has 1,650 native comparisons |
| `resample` | Multichannel linear resampling used during keyframe merging, first closed interval, duplicate times and outside zero/hold policy | 1,024 native calls; 88,392 values, zero mismatches |
| `bezier` | Actual VEUtils property-curve evaluator: float time inversion, eight Newton attempts, bisection fallback, explicit fused y arithmetic | Genuine SDK utility singleton; 40,000 values, zero mismatches |

The models describe observed fields with ordinary C++ values; they do not expose
vendor object layouts. State codes remain numeric because their broader event or
undo meanings have not been established. A local `changed == 0` does not establish
that the full vendor model and its children are clean. Default member initializers
are conveniences of this independent API, not recovered vendor constructor defaults.

`KeyframeMetadata` represents the JSON object `{property: {"value": number-or-null}}`.
It preserves finite double bits but does not reproduce the vendor's decimal-text
formatter. Nonfinite intensity remains unchanged in the transferred keyframe even
though its JSON projection is null. Unknown property codes use lowercase
`intensity`; the recognized alternatives are `Intensity` and
`effects_adjust_intensity`.

## Build and test

From the QCut package directory:

```sh
cmake -S research/independent-editor-contract -B /tmp/qcut-editor-contract -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/qcut-editor-contract --parallel
ctest --test-dir /tmp/qcut-editor-contract --output-on-failure

cmake -S research/independent-editor-contract -B /tmp/qcut-editor-contract-sanitized -DEDITOR_CONTRACT_SANITIZERS=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build /tmp/qcut-editor-contract-sanitized --parallel
ctest --test-dir /tmp/qcut-editor-contract-sanitized --output-on-failure
```

All targets compile with warnings as errors. Sanitized builds enable ASan and
UBSan with recovery disabled; unsupported MSVC sanitizer configuration fails at
configure time. Fast-math builds are rejected because NaN and signed-zero
behavior are part of the contract. Tests pin independently observed native
fingerprints and exercise wrap boundaries, failed casts, unknown property codes,
noncanonical state bytes, NaN payloads, and self-aliasing.

The new numeric comparisons require identical bits for non-NaN results, including
signed zero and infinity. NaN results are compared by classification, without a
payload guarantee. `resample_linear` independently rejects empty/mismatched/ragged
series and nonfinite or descending time arrays. Its input/output scalar budget is
2^20 and its worst-case interval-scan budget is 2^24; these are independent safety
limits, not recovered vendor validation. Values and queries may be nonfinite.
Duplicate times remain legal and may yield NaN. A one-keyframe series produces
zeros unless outside hold is enabled. Each query restarts its interval search.

`evaluate_cubic` accepts four float time/value control points and an already
normalized interval fraction. It does not choose neighboring keyframes, convert
editor time units, or clamp values into a UI range. Nonfinite/degenerate arguments
retain the bounded IEEE arithmetic. It is stateless and uses the caller's floating
point environment; verification used default round-to-nearest and gradual
underflow. Floating contraction is disabled globally; only recovered fused y
operations explicitly use `std::fma`.

## Optional private diagnostic

The optional `editor-native-probe` is an isolated macOS arm64 executable. It
verifies the requested and loaded image SHA-256, Mach-O architecture, UUID and an
exported anchor before calling the two leaf setters/getters and the bounded JSON
helper. It uses guarded synthetic storage and never attaches to a running app or
opens a draft. App binaries, disassembly and diagnostic output belong outside the
repository. CTest does not automatically run this diagnostic.

```sh
cmake -S research/independent-editor-contract -B /tmp/qcut-editor-native -DCMAKE_BUILD_TYPE=Release -DEDITOR_CONTRACT_NATIVE_PROBE=ON
cmake --build /tmp/qcut-editor-native --parallel
JY_FRAMEWORKS="/Applications/VideoFusion-macOS.app/Contents/Frameworks"
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-native/editor-native-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" > /tmp/editor-native.json 2> /tmp/editor-native.stderr
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-native/editor-evaluation-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib" > /tmp/editor-evaluation.json 2> /tmp/editor-evaluation.stderr
```

The original diagnostic accepts this `libvideoeditor` identity:

- SHA-256: `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab`
- arm64 UUID: `22337058-B217-3CAF-9979-CFECA7302CF7`

The evaluation diagnostic additionally pins `libcccreator` SHA-256
`b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4` and arm64
UUID `100726E3-FCB0-31BC-98EE-1B196A1714A3`. It calls the genuine `getVEUtils`
singleton and verifies virtual slot `0x168` before evaluating curves. The
resampler uses ordinary libc++ vectors, not synthetic SDK objects. The two
diagnostics intentionally keep private images loaded until their process exits.
Dependency-library identities beyond these two images are not pinned.

The similarly named free `getInterpolationCubicBezier` is a different floating
implementation: 4,047 finite results differ from the actual virtual entrypoint in
the same 40,000-case corpus. It is recorded as a counterexample, not substituted
for the property evaluator. Tests contain 24 numeric samples from the real virtual
entrypoint and reject altered Newton, fused time-Horner, and duplicate handling.

This is not a whole-library reconstruction or a QCut product integration. It does
not implement object construction, dirty-child traversal, request/event routing,
undo, the complete keyframe-selection/seek state machine, sequence insertion into
an editor, preview/export, or time-unit conversion. The portable sources and tests were executed locally
with AppleClang 21 on macOS arm64; Linux/Windows execution remains to be verified.
See the [Chinese evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-cpp-contract-2026-09-07.zh.md).
The [evaluation evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-keyframe-evaluation-2026-09-07.zh.md)
separates the merge resampler from playback property evaluation and documents the
remaining SDK selection/event boundaries.
