# Independent editor contracts

Original C++20 implementations of thirteen bounded contracts observed in Jianying
11.3.0 `libvideoeditor.dylib` and `libcccreator.dylib` (arm64). The static library uses only the standard
library. It neither loads Jianying nor implements a video renderer.

| Unit | Implemented behavior | Evidence |
| --- | --- | --- |
| `value_state` | Material double assignment and keyframe integer-time assignment, including equality suppression and local mutation bytes | Static leaf functions plus 3,858,432 native comparisons |
| `filter_time` | Sequence endpoints, subtype-dependent trim origin, input-only clamp, modulo-2^64 duration arithmetic | Static instruction trace; complete native insertion was not invoked |
| `keyframe` | Numeric type 2, unchanged time/intensity, case-sensitive metadata property selection, finite number versus JSON null | Transfer is static; metadata helper has 1,650 native comparisons |
| `resample` | Multichannel linear resampling used during keyframe merging, first closed interval, duplicate times and outside zero/hold policy | 1,024 native calls; 88,392 values, zero mismatches |
| `bezier` | Actual VEUtils property-curve evaluator: float time inversion, eight Newton attempts, bisection fallback, explicit fused y arithmetic | Genuine SDK utility singleton; 40,000 values, zero mismatches |
| `window` | Wrapped midpoint/distance, first local minimum, closed-window hit, original neighbor indices | Genuine SDK models; 100,832 finder calls, zero mismatches |
| `time_adapter` | Already-resolved record/control coordinates and separate interval bounds to float cubic/progress | Static float adaptation; constant-speed upstream timing covered separately below |
| `segment_time` | Video source/timeline conversion, strict 1000-unit endpoint snap, relative offset, separately clamped control records | Genuine detached SegmentVideo tree; 6,336 three-helper queries and 6,336 record transforms, zero mismatches |
| `linear_property` | Two preselected, graph-free, curve-zero Video keyframes; mapped-time progress and separate double arithmetic | 1,153 native property calls; 8,353 values, zero mismatches |
| `nonlinear_property` | Graph-free mixed/nonzero curve sides, record selection, constant-speed controls, float cubic evaluation and double-copy fallbacks | 117,515 actual property calls; 784,545 values, zero mismatches |
| `graph` | Right-frame anchor/control expansion, quadratic elevation, per-channel controls and bounded constant-speed Video property | 1,673 native configurations; 43,880 property calls and 9,886 record comparisons, zero mismatches |
| `variable_time` | Positive continuous speed normalization, three-piece integration and quadratic inverse, Video endpoint/fallback timing, control records and preselected graph-free nonlinear property | 384 genuine native configurations; 628,308 map calls, 46,080 records and 7,872 property calls, zero mismatches |
| `variable_graph` | Nonempty graph expansion followed by curve-speed record mapping, raw channel controls versus mapped scalar controls, closed-record selection and actual multichannel property | 1,330 genuine native configurations; 95,372 property calls and 10,764 record comparisons, zero mismatches |

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

`select_keyframe_window` accepts a present list of nonnull keyframe times and
returns indices before removal. Empty, duplicate, unsorted and extreme int64
inputs are allowed; more than 2^20 entries are independently rejected. The scan
stops at its first distance tie or increase. It is not a global nearest search:
`[0, 0, 10]` queried at `[10, 10]` stops at the first zero. Midpoint addition and
absolute-distance subtraction/negation wrap at 64 bits; `abs(INT64_MIN)` therefore
remains negative. The value API does not represent the separate native null-group
branch, which preserves preexisting neighbor outputs, or execute removal events.

`prepare_cubic_interval` takes already-resolved record endpoints/control offsets
and a separate `IntervalProgress` describing the selected time bounds and query.
It preserves int64-to-double-to-float conversion, double control addition before
float narrowing, wrapped deltas, and zero-duration NaN/infinity. It does not apply
Segment trim, constant/curve speed, endpoint snapping, graph expansion, or UI
range clamping. The two time inputs are explicit because those earlier branches
must establish their relationship; the adapter does not assume it.

`ConstantSpeedSegment` accepts nonnegative source/target durations, arbitrary int64
starts/queries/offset, and a positive finite speed. The 96 native configurations
cross 12 speeds with eight source durations. Arithmetic wraps at int64 boundaries;
floating-to-integer conversion explicitly reproduces ARM64 saturation. A strict
distance below 1000 snaps to an endpoint. Timeline conversion otherwise extrapolates,
while record preparation clamps outside the source interval and keeps the truncated
time's fractional remainder in the control offsets. These functions operate on raw
editor time units. They do not convert seconds or choose a frame rate. Native Video
timeline mapping ignores the Segment offset; the relative-sequence helper subtracts
it. Source and target endpoint durations are authoritative even if they do not match
the speed ratio. Validation limits are this independent API's domain, not recovered
SDK input rejection.

`evaluate_linear_property_interval` requires a strictly interior raw query, a
preselected interval whose mapped times increase, both curve types zero, and no
graph. The value arrays must have the same nonempty shape, at most 2^20 scalars;
values may be nonfinite. It uses mapped, wrapped integer deltas to form a double
progress fraction. Subtraction, multiplication and addition remain separate double
operations. A native `.1 → .9` fixture at progress `4/17` distinguishes this from
FMA by one bit. Exact hits, full list selection, caption rotation rules, graph-backed
and curved property branches, and nonconstant speed are outside this API.

`evaluate_nonlinear_property_interval` covers the corresponding two-frame branch
with at least one nonzero int32 curve code. A zero-curve side clears its controls
before record time conversion. The cubic uses the selected left record's outgoing
control and right record's incoming control. The raw query argument is the window
midpoint already resolved by the caller, strictly between the preselected raw
endpoints; selecting the window and handling exact hits remain separate. Both
mapped endpoint times and resolved record times must be nondecreasing. The same
2^20 scalar budget and positive finite constant-speed domain apply.

Mapped range checks, record selection and cubic progress have different clocks.
After mapping the query, the normal two-record path uses resolved record times as
its progress bounds. At/before the first record, it selects that same record at
both ends while retaining the original mapped left progress bound. Past the last
record it copies the original right values. Cubic paths narrow to float and widen
the result to double; copy paths retain double bits, including NaN payloads and
signed zero. This distinction remains observable even near a snapped endpoint.
The API represents no graph, per-channel graph control arrays, nonconstant speed,
Caption rules or complete property dispatch. Numeric curve codes have not been
mapped to UI curve names.

`expand_graph` adds the nonempty right-frame graph branch. Graph type zero denotes
an anchor; all nonzero int32 types denote controls. Endpoint anchors reuse the
input records, including their raw double values; interior anchors receive mapped
times/values and numeric curve code 3. One intervening control is elevated from
quadratic to cubic with separately rounded 1/3 and 2/3 products. With two or more
controls, only the first two are used. The per-channel value offsets and integer
time offsets are kept separate from ordinary scalar controls.

`evaluate_graph_property` connects those records to the existing cubic evaluator.
The native constant-speed resolver transforms record time and scalar controls but
leaves graph integer time offsets unchanged; scaling those offsets would change
the result. The graph must start/end with anchors and fit a 2^20 point×channel
budget. Expansion itself preserves wrapped int64 arithmetic and does not sort;
property evaluation rejects descending resolved records. Duplicate times remain
valid. The two input keyframes are already selected, one curve must be nonzero,
and the raw query is strictly interior. Exact hits, leading/trailing controls,
curve-speed, Caption rules and full dispatch remain outside this API.

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
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-native/editor-window-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" > /tmp/editor-window.json 2> /tmp/editor-window.stderr
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-native/editor-segment_time-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" > /tmp/editor-segment-time.json 2> /tmp/editor-segment-time.stderr
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-native/editor-nonlinear_property-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib" > /tmp/editor-nonlinear-property.json 2> /tmp/editor-nonlinear-property.stderr
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-native/editor-graph-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib" > /tmp/editor-graph.json 2> /tmp/editor-graph.stderr
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-native/editor-variable_time-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib" > /tmp/editor-variable-time.json 2> /tmp/editor-variable-time.stderr
DYLD_LIBRARY_PATH="$JY_FRAMEWORKS" /tmp/qcut-editor-native/editor-variable_graph-probe "$JY_FRAMEWORKS/libvideoeditor.dylib" "$JY_FRAMEWORKS/libcccreator.dylib" > /tmp/editor-variable-graph.json 2> /tmp/editor-variable-graph.stderr
```

The original diagnostic accepts this `libvideoeditor` identity:

- SHA-256: `ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab`
- arm64 UUID: `22337058-B217-3CAF-9979-CFECA7302CF7`

The evaluation diagnostic additionally pins `libcccreator` SHA-256
`b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4` and arm64
UUID `100726E3-FCB0-31BC-98EE-1B196A1714A3`. It calls the genuine `getVEUtils`
singleton and verifies virtual slot `0x168` before evaluating curves. The
resampler uses ordinary libc++ vectors, not synthetic SDK objects. The eight
diagnostics intentionally keep private images loaded until their process exits.
Dependency-library identities beyond these two images are not pinned.

The window diagnostic constructs actual `CommonKeyframe` and `CommonKeyframes`
objects through verified native factories. Its only mirrored aggregate contains
two real libc++ strings; model storage, vtables, shared control blocks and
destruction belong to the SDK. The nonempty material key and null Segment take a
verified path that returns a detached group. The 1,905-object corpus verifies
18,544 removals by remaining object identity, requested neighbor outputs with
canaries, and 18,544 property exact-hit copies preserving stored double bits.
Null Segment time conversion returns -1 in 24 checks; it does not provide an
identity timing oracle. No project is opened or running app attached.

The Segment diagnostic uses `CombinationUtils::makeCombination` with a null Draft
handle. That native branch builds its own detached Draft/SegmentVideo/material tree;
the constructor supplies a real MaterialSpeed. TimeRange and packed control records
also come from native factories. Public setters configure their values, and native
shared control blocks own destruction. It does not fabricate SDK object storage or
open a saved project. The native dependencies themselves are not sanitizer-instrumented;
the optional sanitized executable checks the independent code and diagnostic layer.
Library handles intentionally remain loaded until process exit. Leak detection was
disabled only for that native sanitizer run, not the standalone CTest suite.

The nonlinear diagnostic also obtains the genuine shared VEUtils handle through
the exact factory used by the property call, verifying its creator image, vtable
and cubic slot before proceeding. Its matrix crosses 48 nonzero/mixed curve-code
pairs, nine speeds and eight time/range configurations. It checks 6,912 source
frame snapshots after evaluation, including values, controls, graph presence and
local mutation bytes. This is evidence of read-only frame behavior in this corpus,
not a guarantee about all SDK globals or the playback seek state machine. Eleven
native goldens and the full numeric fingerprint are pinned in standalone tests.

The graph diagnostic invokes the real Graph/GraphPoint/CommonPoint factory using
its bounded read-only value-argument layout with genuine libc++ strings/vectors.
The aggregate sits on a read-only page ending at a guard page. SDK model storage,
vtables and shared control blocks are created by that factory. Before any setter
correction, direct output must match the requested type, coordinates and resource
strings; only numerically equal signed zeros may differ. It then uses real
keyframe attachment, record packing, expansion, time resolution and property
entrypoints. The native source graphs and frame snapshots remain unchanged in
3,346 checks. Weak-pointer checks cover release of attached graphs and points.
This does not establish global SDK purity or full playback state behavior.

The similarly named free `getInterpolationCubicBezier` is a different floating
implementation: 4,047 finite results differ from the actual virtual entrypoint in
the same 40,000-case corpus. It is recorded as a counterexample, not substituted
for the property evaluator. Tests contain 24 numeric samples from the real virtual
entrypoint and reject altered Newton, fused time-Horner, and duplicate handling.

This is not a whole-library reconstruction or a QCut product integration. It does
not implement portable SDK object construction, dirty-child traversal, request/event routing,
undo, the complete keyframe-selection/seek state machine, sequence insertion into
an editor, preview/export, arbitrary/reverse curve-speed mapping or seconds/frame-rate conversion. The portable sources and tests were executed locally
with AppleClang 21 on macOS arm64; Linux/Windows execution remains to be verified.
See the [Chinese evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-cpp-contract-2026-09-07.zh.md).
The [evaluation evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-keyframe-evaluation-2026-09-07.zh.md)
separates the merge resampler from playback property evaluation and documents the
remaining SDK selection/event boundaries.
The [window evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-window-selection-2026-09-07.zh.md)
adds genuine factory/native selection verification and keeps record timing,
property dispatch and full seek boundaries explicit.
The [Segment timing evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-segment-time-2026-09-07.zh.md)
closes constant-speed Video timing and the bounded non-hit linear property branch,
including native factories, negative controls and remaining dispatch boundaries.
The [nonlinear property evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-nonlinear-property-2026-09-07.zh.md)
connects real record preparation to the cubic runtime and distinguishes nonlinear
computation from endpoint copies without extending the claim to full dispatch.
The [graph evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-graph-contract-2026-09-08.zh.md)
adds genuine nonempty graph construction, expansion and the bounded per-channel
property chain, with arithmetic-order goldens and native negative controls.

The [variable-speed evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-variable-time-2026-09-08.zh.md)
closes positive continuous curve normalization, numerical integration/inversion,
genuine Video range/control mapping and a graph-free nonlinear property subdomain.
`VariableSpeedCurve` owns float-normalized points; it requires 2–4,096 finite positive
points, distinct float source coordinates and endpoints 0/1. These are independent
safety/domain limits, not a claim about native rejection behavior. The duration is
a positive integer in the caller's existing time unit. Negative raw Segment deltas
use `negative_time_speed`; bare curve queries clamp negatives to zero.
The native three-piece speed shape uses float-derived constants and explicit
fused arithmetic. Even the low-64-bit integer square before conversion is preserved
for extreme query values. Whole-curve averaging and an unbounded real-number
quadratic are different algorithms. The portable suite pins a native map corpus
fingerprint, while the optional diagnostic additionally compares real records and
actual property calls. Nonempty graph plus variable speed is covered separately by the bounded `variable_graph` unit below.

`prepare_variable_graph` combines existing graph expansion and positive curve-speed
record conversion. It preserves graph channel offsets in their original integer
time units while mapping scalar control times through the curve. The function
requires valid source/target durations; the unused fallback speed/offset fields do
not affect record preparation. `evaluate_variable_graph_property` additionally
validates the full VariableSpeedSegment and the same preselected nonzero-curve,
interior-query domain as nonlinear evaluation. It uses per-channel graph controls
when present and scalar controls otherwise, preserving first closed-record
selection, float cubic evaluation and untouched double-copy fallbacks.
Both constant and variable graph paths share `resolved_graph.cpp`; the old native
graph fingerprint remains unchanged after extraction. The native diagnostic
constructs real speed/graph/Video/keyframe models and compares expanded and
resolved records before calling the actual property entrypoint. Four captured
goldens and a 46,464-call native fingerprint run without proprietary dependencies
in standalone tests. See the [variable graph evidence record](../../docs/task/jianying-filter-runtime-research/videoeditor-variable-graph-2026-09-08.zh.md)
for per-channel/scalar boundaries, negative controls and remaining dispatch work.
