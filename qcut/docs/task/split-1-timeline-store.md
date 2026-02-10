# Subtask 1: Split `timeline-store.ts` (1886 → ~900 + ~986)

**Parent Plan:** [split-top5-large-files-plan.md](./split-top5-large-files-plan.md)
**Estimated Effort:** 30-40 minutes
**Risk Level:** Medium — core store, many consumers

---

## Goal

Split `apps/web/src/stores/timeline-store.ts` into two files with zero behavior change. The store API shape (all exported methods and state) must remain identical to consumers.

---

## Files Involved

| File | Action |
|------|--------|
| `apps/web/src/stores/timeline-store.ts` | Edit — keep base store |
| `apps/web/src/stores/timeline-store-operations.ts` | **Create** — heavy operations |
| `apps/web/src/stores/__tests__/timeline-store.test.ts` | Verify passes unchanged |

---

## What Stays in `timeline-store.ts` (~900 lines)

| Section | Lines (current) | Description |
|---------|-----------------|-------------|
| Imports & types | 1-49 | All imports, TimelineStore type |
| Module-level helpers | 50-166 | `autoSaveTimer`, `updateTracks`, `autoSaveTimeline`, `autoSaveTimelineGuarded`, `updateTracksAndSave` |
| Store creation + initial state | 167-191 | `create<TimelineStore>((set, get) => { ... })` |
| Selection & history | 192-253 | `getSortedTracks`, `pushHistory`, `undo`, `selectElement`, `deselectElement`, `clearSelectedElements`, `setSelectedElements` |
| Track CRUD | 254-269 | `addTrack`, `insertTrackAt` |
| Element CRUD (add/remove) | 390-559 | `addElementToTrack`, `removeElementFromTrack` |
| Element movement & updates | 637-759 | `moveElementToTrack`, `updateElementTrim`, `updateElementDuration`, `updateElementStartTime` |
| Element properties | 851-894 | `toggleTrackMute`, `toggleElementHidden`, `updateTextElement` |
| Transform & media | 896-985 | `updateElementTransform/Position/Size/Rotation`, `updateMediaElement`, `updateRemotionElement` |
| Persistence | 1354-1571 | `getTotalDuration`, `getProjectThumbnail`, `redo`, `loadProjectTimeline`, `saveProjectTimeline`, `saveImmediate`, `clearTimeline`, `restoreTracks` |
| Feature toggles | 1573-1607 | `toggleSnapping`, `toggleRippleEditing`, `toggleEffectsTrack`, `autoShowEffectsTrack` |
| Overlap & track utils | 1609-1647 | `checkElementOverlap`, `findOrCreateTrack` |
| Operations spread | — | `...createTimelineOperations({ get, set, ... })` |

## What Moves to `timeline-store-operations.ts` (~986 lines)

| Section | Lines (current) | Description |
|---------|-----------------|-------------|
| Ripple deletion | 271-388 | `removeTrack`, `removeTrackWithRipple` |
| Ripple element removal | 561-635 | `removeElementFromTrackWithRipple` |
| Ripple start time | 761-849 | `updateElementStartTimeWithRipple` |
| Split operations | 987-1119 | `splitElement`, `splitAndKeepLeft`, `splitAndKeepRight` |
| Audio & media | 1121-1352 | `getAudioElements`, `separateAudio`, `replaceElementMedia` |
| Drag state | 1425-1463 | `dragState`, `setDragState`, `startDrag`, `updateDragTime`, `endDrag` |
| Add-at-time | 1649-1752 | `addMediaAtTime`, `addTextAtTime`, `addMediaToNewTrack`, `addTextToNewTrack` |
| Effects management | 1755-1883 | `addEffectToElement`, `removeEffectFromElement`, `getElementEffectIds`, `clearElementEffects` |

---

## Implementation Steps

### Step 1: Create `timeline-store-operations.ts`

```typescript
// apps/web/src/stores/timeline-store-operations.ts

import type { TimelineStore } from './timeline-store';
// ... other imports needed by moved functions

interface OperationDeps {
  updateTracks: (tracks: Track[]) => void;
  updateTracksAndSave: (mutator: (tracks: Track[]) => Track[]) => void;
  autoSaveTimeline: () => void;
  pushHistory: () => void;
}

type StoreGet = () => TimelineStore;
type StoreSet = (partial: Partial<TimelineStore>) => void;

export function createTimelineOperations({
  get,
  set,
  deps,
}: {
  get: StoreGet;
  set: StoreSet;
  deps: OperationDeps;
}) {
  return {
    // All heavy operations here, using deps.updateTracks, deps.pushHistory, etc.
    removeTrack: (trackId: string) => { ... },
    // ...
  };
}
```

### Step 2: Wire operations into store

In `timeline-store.ts`, inside the `create()` call:

```typescript
const deps = { updateTracks, updateTracksAndSave, autoSaveTimeline, pushHistory };
const operations = createTimelineOperations({ get, set, deps });

return {
  // ... base state and methods ...
  ...operations,
};
```

### Step 3: Move functions one group at a time

1. Move ripple operations (test after)
2. Move split operations (test after)
3. Move audio/media operations (test after)
4. Move drag state (test after)
5. Move add-at-time (test after)
6. Move effects (test after)

### Step 4: Verify imports

- Ensure `timeline-store-operations.ts` only imports **from** the base store, never the reverse.
- Check for any circular dependency via `bun run check-types`.

---

## Verification

```bash
# Type check
bun run check-types

# Existing tests
bun x vitest run apps/web/src/stores/__tests__/timeline-store.test.ts

# Lint
bun lint:clean

# Smoke test
bun run electron:dev
```

---

## Unit Tests to Add

Create `apps/web/src/stores/__tests__/timeline-store-operations.test.ts`:

| Test Case | What It Validates |
|-----------|-------------------|
| `createTimelineOperations returns all expected methods` | API shape is complete |
| `splitElement creates two elements with correct boundaries` | Split logic correctness |
| `removeTrackWithRipple shifts remaining elements` | Ripple deletion |
| `addMediaAtTime respects overlap detection` | Add-at-time guard |
| `addEffectToElement pushes history` | Effects + undo integration |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Circular import between base ↔ operations | Operations file only imports types from base; deps injected at runtime |
| Store API shape change breaks consumers | Spread `...operations` preserves every method name |
| Module-level helpers (`updateTracksAndSave`) not accessible | Pass as `deps` parameter |
| `replaceElementMedia` uses dynamic imports | Keep the dynamic import in operations file; it's self-contained |
