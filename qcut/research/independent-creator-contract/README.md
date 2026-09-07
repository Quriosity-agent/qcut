# Independent creator contract

Original C++20 reconstruction of a bounded filter-inspector contract in Jianying
11.3.0 `libVECreator.dylib`. The library has no Qt, editor, renderer, or vendor
runtime dependency. It builds request descriptions and transforms original,
in-memory state models. It does not send requests, change live drafts, or render pixels.

| Unit | Recovered contract |
| --- | --- |
| `selection` | Filter-only selection, first successful duplicate, sorted IDs; empty/single/mixed values; exact rounded/fuzzy comparison, including nonfinite branches |
| `requests` | Update, click/shortcut accept, reset request subset; dispatch metadata; raw double independent of telemetry integer |
| `model_gate` | Batch-selection keyframe-removal flag and deferred acceptance |
| `dialog_callbacks` | Two callbacks in argument order; preview dismissal call, cache update, notification count |

`ResolvedCandidate` is an explicit boundary: the caller supplies segment-type
resolution and the value returned by the timeline evaluator at the current
cursor. A missing timeline value maps to the wrapper's zero fallback. The
contract does not substitute `MaterialEffect::value` for timeline evaluation.

`Combo` is an original partial request model, not a binary ABI layout or complete
serialization format. `observed_flag_0x128`, `dispatch_flag`, and `observed_policy`
retain verified fields without assigning unverified business names. Reset has
only the selected ID; no reset intensity or undo behavior is invented.

The independent accept builder rejects nonfinite or out-of-int32 telemetry before
producing output. This is a QCut policy for the unresolved `QVariant::toInt`
boundary. Update copies every binary64 input, including nonfinite values, as
observed. No input is clamped to `[0,1]`. Empty selection still produces an empty
combo; it does not evaluate telemetry. Unsupported enum values reject without
changing output. The mathematical contract assumes IEEE binary64 and the usual
round-to-nearest floating-point environment, with fast math disabled.

Build and test outside the repository:

```sh
cmake -S research/independent-creator-contract -B /tmp/creator-contract -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/creator-contract -j 4
ctest --test-dir /tmp/creator-contract --output-on-failure

cmake -S research/independent-creator-contract -B /tmp/creator-contract-asan -DCREATOR_CONTRACT_SANITIZERS=ON
cmake --build /tmp/creator-contract-asan -j 4
ASAN_OPTIONS=detect_leaks=0 UBSAN_OPTIONS=halt_on_error=1 ctest --test-dir /tmp/creator-contract-asan --output-on-failure
```

Both configurations use warnings as errors. Sanitizers use
`-fno-sanitize-recover=all`. The recorded macOS toolchain does not support
LeakSanitizer; the ASan/UBSan pass is not a leak check.

The optional `CREATOR_CONTRACT_NATIVE_PROBE=ON` target is only for macOS arm64.
`creator-native-constants` verifies the exact universal SHA-256, loaded arm64
UUID and executable function range before calling two argument-free constant
getters. The default build does not load vendor libraries. Run the diagnostic in
a disposable process with the installed app's dependency search paths:

```sh
DYLD_LIBRARY_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks \
DYLD_FRAMEWORK_PATH=/Applications/VideoFusion-macOS.app/Contents/Frameworks \
/tmp/creator-contract/creator-native-constants \
/Applications/VideoFusion-macOS.app/Contents/Frameworks/libVECreator.dylib
```

Loading the library runs its initializers and can print vendor startup messages;
the final line is the probe result. No wrapper/model object, callback, draft, or
application process is passed to this diagnostic. Within the initial four units,
only the two constants have native-call validation. The request and state units are validated against
bounded static evidence and explicit golden fixtures.

See [the Chinese evidence and contract](../../docs/task/jianying-filter-runtime-research/vecreator-cpp-contract-2026-09-07.zh.md).

## Actual editor state transitions (2026-09-07 follow-up)

`common_keyframes.*` and `editor_events.*` now implement the verified downstream
material write, existing-ID keyframe graph/value updates, and reset's literal 1.0
plus removal of every common-keyframe group into its retained list. They reuse the
original editor contract's material setter. Six test groups contain 957 assertions.

The host supplies a resolved filter and the result of the native filter-group
lookup. `capture_lookup_required` means the material write has happened but time
lookup/new-keyframe creation remains outside this contract. Retained groups are
not presented as a reconstructed undo stack. Null reset groups and a resolved
non-filter property are rejected by an explicit QCut boundary policy.

The optional macOS arm64 `creator-native-events` diagnostic checks the isolated
raw-value vector method with SHA/UUID guards and read-only input pages. It does
not call a handler or mutate an SDK object. Run it with the absolute installed
`libvideoeditor.dylib` path and the app Frameworks directory in
`DYLD_LIBRARY_PATH`. The native option also retains the previous VECreator
constant probe. Detailed evidence and boundaries:
[creator-editor-events-2026-09-07.zh.md](../../docs/task/jianying-filter-runtime-research/creator-editor-events-2026-09-07.zh.md).

## Keyframe insertion and neighboring controls

`keyframe_insertion.*` continues the missing-ID path after the host resolves the
playhead to keyframe time. It constructs the observed `fields=5` time/value payload,
ensures a property/material group, reuses a frame within the wrapped ±1000 window,
or creates a curve-zero frame and inserts it before the first strictly later
time. The editor contract's `window.*` implementation is reused without a second
finder. Existing value dimensions truncate or repeat the first requested value;
new frames retain the complete numeric shape. Graph cleanup uses the first ID
match, including duplicate IDs.

`keyframe_controls.*` repairs the two adjacent pairs. For each nonzero-curve
endpoint, a zero x handle becomes 40% of the signed, wrapped time difference and
y becomes zero; nonzero handles clamp only the observed side. NaN and infinities
follow the recovered floating comparisons. No interpolation or pixel claim is
attached to these model updates.

Eight portable test groups now contain 1082 assertions. Release and fail-fast
ASan/UBSan pass. The optional `creator-native-insertion` uses genuine native
keyframe/group factories and public setters on diagnostic-owned objects;
1,200 insertion cases plus 3,000 control cases compare 82,752 values/state fields
with zero mismatches. Relative paths and unknown library hashes fail closed.
This probe loads only the verified installed `libvideoeditor.dylib`; it does not
inject into the app or fabricate model/control-block memory.

Only `fields=5` with a nonempty numeric payload is implemented. Other masks,
string values, capture-time evaluation, segment/FPS mapping, UUID generation,
full handler dispatch and transaction commit/rollback remain outside this API.
Insertion/neighborhood APIs reject null list entries as a QCut boundary policy.
Container tracking codes and clock-write counts are observable bookkeeping,
not a reconstructed undo stack. Detailed evidence:
[creator-keyframe-insertion-2026-09-07.zh.md](../../docs/task/jianying-filter-runtime-research/creator-keyframe-insertion-2026-09-07.zh.md).

## Dirty propagation and retained-reference cleanup

`dirty_tree.*` now closes a concrete lifecycle after insertion/removal: dirty
queries visit the active frame/control/group tree, reset recursively clears
active dirty state, and the two array levels release their retained references.
Removed-only objects are not reset. An object shared by active and retained is
reset through its active occurrence and remains alive while active owns it.
Neither operation restores earlier values or reinserts removed objects.

Node reset clears `changed` and clears `state_code` only when `tracking != 0`.
Dirty queries ignore the state code and retained nodes. Both indexed removal
APIs preserve identity/order, append to retained, apply the observed code-three
gate, dirty the array, and report one clock-write event. Array configuration and
active storage capacity survive reset.

The verified traversal domain has no graph and has two nonnull controls per
active frame. Null active nodes and noncanonical dirty booleans are rejected
before mutation, including when a dirty ancestor could otherwise short-circuit.
This preflight is an explicit QCut boundary policy. Retained-only objects are
not traversed or inspected.

Nine portable groups contain 1143 assertions and pass Release and fail-fast
ASan/UBSan. `creator-native-dirty` uses real keyframe/group factories plus a
complete detached SegmentVideo tree created by the SDK. Its 2,000 frame-list
cases, 240 group-array cases and 4 weak-pointer lifetime cases compare 407,020
values/state observations with zero mismatches. The native diagnostic also
passes ASan/UBSan for the probe/original code; the vendor dylib is not
instrumented. Four intentional implementation mutants and two identity guards
fail as expected. Full transaction commit/rollback and application undo remain
outside this contract. See
[creator-record-contract-2026-09-07.zh.md](../../docs/task/jianying-filter-runtime-research/creator-record-contract-2026-09-07.zh.md).
