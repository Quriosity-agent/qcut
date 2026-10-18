# Persistent body geometry

`PersistentCombinedBody` preserves ten-part geometry history for an explicitly
ordered stream. It consumes supplied normalized perception; it performs no image
decoding, inference, native-library loading or file reads. `CombinedBody` keeps its
existing cold-deformer behavior.

```python
from body_composition import PersistentCombinedBody

body = PersistentCombinedBody(mode=1)
result = body.update(
    coords=normalized18,
    visibility=visibility18,
    width=720,
    height=1280,
    faces=faces106,
    rectangles=rectangles,
    rolls=rolls,
    targets={"LongLeg": 0.21, "SlimArm": 0.3},
)
# Draw result["positions"], result["uv"], result["tri"] once.
body.reset()
```

Coordinates are normalized Y-up; face fields may all be `None`. Targets are
internal values, not slider percentages. The controls adapter remains responsible
for percentage scaling. Returns match `CombinedBody`: base/UV/triangles, cumulative
delta and positions, states, cumulative per-part stages, descriptors and Status.
Returned state snapshots are detached from retained state.

Mode 1 refreshes measurable anchors. Mode 2 retains populated anchors according to
each part's original condition. Shoulder raw-grid caches continue evolving in both
modes. The implementation preserves float32 arithmetic order, per-part intensity
steps, full Status history, shared descriptor history, shoulder raw grids and their
ROI compaction counters.

Each instance owns its counters. `reset()` clears all history, including those
counters, while retaining the selected mode. This makes a replay from a chosen
stream boundary deterministic and prevents unrelated streams from changing the
cache compaction phase. It does not reproduce process-global coupling between
unrelated original application objects.

A width/height change raises before advancing history. Reset explicitly before
changing dimensions, switching person identity, seeking or crossing a cut. A
reset itself does not reconstruct the history required at a later frame: replay
the preceding ordered frames when that history is needed.

An all-zero visibility frame with finite coordinates advances the original
missing-joint and intensity-decay logic. It does not mean that a new person has
arrived. A detector returning no external body is a separate caller policy; this
class does not skip or synthesize that frame. Warm zero targets, including omitted
parts of a partial target mapping, decay retained intensity rather than resetting
to the original image immediately.

The bounded arithmetic profile remains macOS float32 libm, orientation zero,
bit16 and no populated protection/segmentation masks. This API does not implement
multi-person identity, detector lifecycle, render scheduling, preview/export
integration or arbitrary video parity.

Validation uses synthetic data in `test_body_composition_persistent.py`, including
a 60-frame digest frozen from the owned reference implementation. A local audit
also compared four 60-frame scenarios (status branches, changing targets in both
modes, and continuous motion) against that reference under Python 3.12 and 3.14:
all returned fields, states, meshes, shoulder raw caches, bounds and counters
matched exactly. Local evidence lives under
`.local/body-temporal-20261018/geometry/`; private perception inputs are not part of
the source or tests. These are controlled geometry sequences, not acceptance of
real motion video or a new native product run.
