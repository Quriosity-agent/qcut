# Independent creator contract

Original C++20 reconstruction of a bounded filter-inspector contract in Jianying
11.3.0 `libVECreator.dylib`. The library has no Qt, editor, renderer, or vendor
runtime dependency. It builds request descriptions and state-transition plans;
it does not send requests, change drafts, remove keyframes, or render pixels.

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
application process is passed to this diagnostic. Only the two constants have
native-call validation. The request and state units are validated against
bounded static evidence and explicit golden fixtures.

See [the Chinese evidence and contract](../../docs/task/jianying-filter-runtime-research/vecreator-cpp-contract-2026-09-07.zh.md).
