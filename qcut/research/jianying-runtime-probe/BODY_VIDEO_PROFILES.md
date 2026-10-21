# Native body video comparison profiles

Date: 2026-10-20. Scope: a controlled 60-frame, 1080 × 1920 body-video
comparison, plus short native call traces. This is separate from full editor
preview/export and recovery acceptance.

The current independent sequence matches the original graph's **Bef, modern
skeleton CPU, warm-reset** reference on all 60 measured frames. It does **not**
match the product's default **Swing, CoreML, cold-start** output. The difference
must stay visible in comparison reports; the reference configuration must not
silently replace the product default.

## Configurations and results

All inputs use the same 60 decoded RGBA frames. Controls are SlimBody 40 and
StretchLeg 30 for frames 0–19, SlimBody 70 and StretchLeg 0 for frames 20–39,
then the initial controls for frames 40–59. Other body controls are zero.
Measurements compare full-resolution, uncompressed RGBA. RGB MAE is the mean
absolute channel difference on the 0–255 scale.

| Native comparison against independent output | Initialization and update | Exact RGBA frames | Maximum RGBA error | Mean RGB error |
| --- | --- | ---: | ---: | ---: |
| Product Swing / CoreML | Cold session; two updates per request; parameters applied between updates | 0 / 60 | 192 | 3.6695444503 |
| Local Swing / CoreML prototype | Cold session; one update per request; parameters applied before update | 0 / 60 | 192 | 3.6526864283 |
| Original Bef graph / modern skeleton CPU reference | Two discarded time-zero initialization passes; original tracker reset before the first measured frame; one update per measured frame | 60 / 60 | 0 | 0 |

The prototype is a local investigation, not a production change. It does not
establish that removing the second update is correct for every native package.
No production renderer or model was modified for this audit.

The independent candidate consumes source pixels and controls only. It does not
read captured native landmarks, meshes, outputs, or checkpoint state. It still
uses private extracted original model weights; algorithm implementation
independence is not model independence.

## Why cold Swing and the warm-reset reference differ

`filter-probe.mm` currently invokes `renderAndWriteFilterFrame` twice per ordinary
host render command. `FilterHostSession::render` applies changed parameters
after the first update. A one-update prototype that retains that ordering
misses the initial controls and delays a parameter change until the next frame.
Applying parameters before that single update removes this timing error, but
does not remove the profile differences shown above.

The Swing manager update-mode value `1` is not the body Lua `Ns.INPUT_TYPE.IMAGE`
value `1`. They are different APIs. Observed body Lua inputs progress from IMAGE
to VIDEO, with the product's second same-time update taking NOCHANGE. The
60-frame product run therefore produces 120 graph updates; the single-update
prototype produces 60.

Original-library tracing also shows an initialization distinction inside one
skeleton tracking call:

- Cold Swing sets `SK_SetParamF(handle, 3, 1.0)` on its first call. The original
  iterative tracker can run coarse detection followed by one refinement in that
  same call when coarse detection produced an internal target.
- Its next observed call sets parameter 3 to zero.
- The Bef reference sets parameter 3 to zero. After the original tracker reset,
  the first measured coarse seed does not publish an external body. The current
  independent sequence reproduces this behavior.

The extra refinement is a native tracker rule. It is not evidence for adding
arbitrary geometry warm-up iterations, refining every failed detection, or
creating a new model on each frame.

### Force-detection trace

Offsets below describe only the pinned local binary. They are observation
locations, not a supported runtime interface.

At the original Bach skeleton caller, offsets `+0x390` and `+0x391` are separate
force-detection fields. `+0x390` is a one-shot gate whose parameter is removed
after consumption. `+0x393` records whether the previous output body vector was
nonempty. `+0x398` and `+0x39c` retain the algorithm input dimensions.

The force path resets the original tracker and selects one extra iteration
when the one-shot gate is set and the second force field, missing previous body,
or changed dimensions satisfy the original branch. Parameter 1's reset reaches
the original `resetIds(-1)` operation; parameter 3 stores the iteration count.

The cold two-frame Swing trace was:

| Call | Bytes at `+0x390..+0x393` | Parameter 3 |
| --- | --- | ---: |
| First human frame | `01 01 00 00` | 1 |
| Next human frame | `00 01 00 01` | 0 |

A separate 12-request trace started with a blank frame, then a human frame,
six blank frames, a human return, a forward time jump to 5 seconds, a backward
jump to 0.1 seconds, and another request at that same time. Only the first
request had the one-shot gate and iteration count set to one. Every later
request had both at zero, including loss, recovery, and raw-host time jumps.
The second force field was one for the first two requests, then zero. It must
not be documented as a permanently enabled flag.

These observations do not establish the complete external force-event
lifecycle. In particular, raw-host time jumps do not exercise the TypeScript
provider's session-recreation policy. The product host has fixed dimensions;
the provider includes width and height in its tracking scope, so another size
uses another session rather than resizing the same node. No same-node resize
claim is made here.

## Time and history must be explicit

The Swing cases request `i / 30` seconds and the host rounds that value to
integer microseconds. The Bef reference supplies `1 + i / 30` directly as a
double after its two initialization passes. The independent reference run uses
the same double timestamps and initial measurement offset.

This distinction matters because original body logic compares time deltas
against thresholds. Do not construct a supposedly equivalent oracle by
rounding time through another unit, or replace a continuous history with
repeated copies of the target frame.

Likewise, a bounded source pre-roll window is a different history from replay
from the clip start. Preview/export agreement must compare the same history,
frame cadence, parameters at each historical frame, and session initialization.
The 60-frame results here use one persistent sequence per configuration; they
do not certify arbitrary editor pre-roll windows.

## Pinned inputs

The same private runtime and original body package used for the earlier
177-frame reference were used here:

| Input | Identity |
| --- | --- |
| Runtime revision | `D6342ECD-5432-33F0-A2AD-0C28F5699994-c092f19c71af1397` |
| `libcccreator.dylib` SHA-256 | `0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9` |
| Body resource | `7408076932065152296/9c891b188dd6b523a30efa8bfb63602b` |
| Original `slimbody.lua` SHA-256 | `1a2fa3e0141d07d4b30c0bd279f995561a5a61ce6ea7a595c389f14e312721ba` |
| Beach-woman source video SHA-256 | `d1f6593f61723b2a838c8bc962533d192f3071b92f0035a71fa601ca63b471f4` |

The source is 1080 × 1920, 24000/1001 fps, 316 frames. The comparison extracts
the first 60 timeline frames at 30 fps, so the cadence conversion can repeat
decoded source frames.

The private runtime resides under
`~/Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current`.
The source video is the local
`.local/jianying-parity/beauty-preview-export-20261013-r1/media-audit/beach-woman-1080-source.mp4`
fixture. Models, original packages, native libraries, and source media remain
local and must not be added to Git.

## Reproduction and local evidence

The complete local bundle is in
`.local/body-editor-native-20261020/native-host-audit/` in the main QCut checkout.
Its files include:

- `audit-summary.json`: all 60 per-frame full-resolution comparisons, aggregate
  statistics, and the four renderer configurations.
- `gallery/index.html`: original, product native, independent, CPU reference,
  and difference images for frames 0, 1, 19, 20, 21, 39, 40, and 59.
- `run_1080.py`: the persistent Swing host cases.
- `run_independent60.py`: the independent sequence using only original input.
- `cpu-reference-configuration.json`: exact double timestamps and parameter
  events passed through the original Lua handler.
- `trace/params.log`, `trace/swing-flags.log`, `trace/bef-flags.log`, and
  `trace/blank-seek.log`: original-library call and state observations.
- `trace/blank-seek-cases.json`: the ordered blank/recovery/time-jump inputs.
- `build_gallery.py`: full-resolution metric recomputation and gallery creation.

For Swing reproduction, use the locally built host with the pinned runtime,
Models directory, and original body package; set `DYLD_LIBRARY_PATH` to the
runtime's `Frameworks`, and `QCUT_FRAME_WIDTH=1080`,
`QCUT_FRAME_HEIGHT=1920`. Feed sequential tab-separated
`render`, request ID, seconds, input RGBA path, output RGBA path, and full body
parameter JSON commands. The local prototype additionally uses
`QCUT_AUDIT_SINGLE_PASS=1` and `QCUT_AUDIT_PREPARAMS=1`; these are local audit
switches, not production protocol options.

The Bef run uses the existing local `bach_reset_audit` original-graph probe.
It selects the modern skeleton CPU backend through private process
instrumentation, performs two unmeasured time-zero initialization passes, and
calls the original `resetIds(-1)` before measurement. Controls change through
the original Lua `onEvent` before `onUpdate`, at probe passes 22 and 42.
This instrumentation is not a shipping backend-selection API. No public API
equivalent was established by this audit, and no model weights were changed.

For the independent run, use the repository's Python environment, the private
standalone runtime, and `BEAUTY_RENDER_RESOLUTION=original`. Keep the session
alive for all 60 original input frames, using `1 + i / 30` and the same control
schedule. Recompute differences from output RGBA, including alpha, before
examining amplified images.

Gallery differences are absolute RGB differences multiplied by six and clipped
to 255 for visibility. Metrics always use the unamplified full-resolution data.
An all-black CPU-reference difference image confirms this particular profile;
it must not obscure the separate product-native residual.

## Accepted scope and remaining work

Accepted by this audit: original-graph versus independent equality for the
pinned warm-reset CPU profile, across 60 portrait-HD frames and two parameter
changes; native evidence explaining why cold Swing's first frame behaves
differently.

Not accepted by this audit: equality with default product CoreML; complete
Swing force-event semantics; all-person or all-video generalization; removal
of original private model dependencies; editor cancellation/crash/seek
recovery; or a new default native host update policy. Those require their own
named configurations and acceptance evidence.
