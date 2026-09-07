# Independent editor contracts

Original C++20 implementations of three bounded contracts observed in Jianying
11.3.0 `libvideoeditor.dylib` (arm64). The static library uses only the standard
library. It neither loads Jianying nor implements a video renderer.

| Unit | Implemented behavior | Evidence |
| --- | --- | --- |
| `value_state` | Material double assignment and keyframe integer-time assignment, including equality suppression and local mutation bytes | Static leaf functions plus 3,858,432 native comparisons |
| `filter_time` | Sequence endpoints, subtype-dependent trim origin, input-only clamp, modulo-2^64 duration arithmetic | Static instruction trace; complete native insertion was not invoked |
| `keyframe` | Numeric type 2, unchanged time/intensity, case-sensitive metadata property selection, finite number versus JSON null | Transfer is static; metadata helper has 1,650 native comparisons |

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
```

Only this source identity is accepted:

- SHA-256: `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab`
- arm64 UUID: `22337058-B217-3CAF-9979-CFECA7302CF7`

This is not a whole-library reconstruction or a QCut product integration. It does
not implement object construction, dirty-child traversal, request/event routing,
undo, keyframe interpolation, sequence insertion into an editor, preview/export,
or time-unit conversion. The portable sources and tests were executed locally
with AppleClang 21 on macOS arm64; Linux/Windows execution remains to be verified.
See the [Chinese evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-cpp-contract-2026-09-07.zh.md).
