# Remotion First-Class Timeline Citizen Plan

Make Remotion elements fully cuttable, exportable, and CLI-controllable — identical to media elements.

---

## Current State

| Capability | Status | Detail |
|---|---|---|
| Add to timeline | Working | Via API + `generate-remotion --add-to-timeline` |
| Split/cut | Working | `splitElementOperation()` is type-agnostic, no restrictions |
| Trim (drag handles) | Working | `trimStart`/`trimEnd` inherited from `BaseTimelineElement` |
| Move between tracks | Working | Validated to remotion tracks only |
| Live preview | Working | `RemotionPlayerWrapper` renders in preview panel |
| Export to video | **Broken** | Engine exists but is never wired into export flow |
| CLI management | **Missing** | No CLI commands for component listing, props, or export |

---

## Task 1: Wire RemotionExportEngine into the Export Flow

**Estimated time**: > 20 minutes — broken into subtasks.

The full infrastructure already exists (`RemotionExportEngine`, `requiresRemotionExport()`, progress store, frame extraction). It just needs to be connected.

### Subtask 1.1: Auto-detect Remotion elements in export dialog

When the user opens the export dialog, detect Remotion elements and show a notice.

**Files**:
- `apps/web/src/components/export-dialog.tsx` (lines 166-214)

**Changes**:
- After `hasCaptions` / `hasAudio` detection, add:
  ```typescript
  const hasRemotionElements = tracks.some(
    (t) => t.type === "remotion" && t.elements.length > 0
  );
  ```
- Show info badge: "Timeline contains Remotion elements — Remotion Engine will be used"

### Subtask 1.2: Auto-select Remotion engine in factory recommendation

When timeline has Remotion elements, the factory must recommend `ExportEngineType.REMOTION`.

**Files**:
- `apps/web/src/lib/export/export-engine-factory.ts` (lines 78-188, `getEngineRecommendation()`)

**Changes**:
- At the top of `getEngineRecommendation()`, before other engine checks:
  ```typescript
  if (requiresRemotionExport(tracks)) {
    return ExportEngineType.REMOTION;
  }
  ```
- Import `requiresRemotionExport` from `../remotion/export-engine-remotion`

### Subtask 1.3: Call `exportWithRemotion()` when engine is RemotionExportEngine

The export hook currently always calls `.export()` (base class). It must call `.exportWithRemotion()` when the engine is a `RemotionExportEngine`.

**Files**:
- `apps/web/src/hooks/export/use-export-progress.ts` (lines 141-180)

**Changes**:
- After engine creation (line 141), check engine type:
  ```typescript
  const isRemotionEngine = exportEngine instanceof RemotionExportEngine;
  ```
- At line 174, branch on engine type:
  ```typescript
  const blob = isRemotionEngine
    ? await (exportEngine as RemotionExportEngine).exportWithRemotion(...)
    : await exportEngine.export(...);
  ```
- Wire progress updates to `useExportStore.updateRemotionProgress()` for phase tracking

### Subtask 1.4: Skip Remotion elements in standard canvas renderer

When `RemotionExportEngine` handles Remotion elements (pre-renders + composites), the standard renderer must not attempt to render them again.

**Files**:
- `apps/web/src/lib/export/export-engine-renderer.ts` (lines 86-106, `renderElement()`)

**Changes**:
- Add case after markdown:
  ```typescript
  } else if (element.type === "remotion") {
    // Handled by RemotionExportEngine.compositeRemotionFrames()
    return;
  }
  ```

### Tests

- `apps/web/src/lib/export/__tests__/remotion-export-wiring.test.ts` (new)
  - Test `requiresRemotionExport()` returns true when remotion track has elements
  - Test factory recommends `REMOTION` engine when remotion elements exist
  - Test `renderElement()` returns early for remotion type
  - Test export hook selects correct export method based on engine type

---

## Task 2: Add Remotion CLI Commands

**Estimated time**: > 20 minutes — broken into subtasks.

Existing CLI has 21 timeline commands but no Remotion-specific operations. The `generate-remotion` command creates components but can't list, inspect, update props, or trigger export.

### Subtask 2.1: Register new CLI commands

**Files**:
- `electron/native-pipeline/cli/cli.ts` (lines 80-100, command registration)

**Commands to add**:
```text
editor:remotion:list          — List registered Remotion components
editor:remotion:inspect       — Show component details (props schema, source path)
editor:remotion:update-props  — Update props on a timeline Remotion element
editor:remotion:export        — Export timeline with Remotion elements
```

### Subtask 2.2: Create Remotion CLI handler module

**Files**:
- `electron/native-pipeline/editor/editor-handlers-remotion.ts` (new)

**Functions**:

| Function | API Endpoint | Purpose |
|---|---|---|
| `remotionList()` | `GET /api/claude/timeline/:projectId` | Filter timeline for remotion tracks, list elements with componentId, props, duration |
| `remotionInspect()` | `GET /api/claude/timeline/:projectId` | Deep inspect single element: component source, props schema, render mode |
| `remotionUpdateProps()` | `PATCH /api/claude/timeline/:projectId/elements/:elementId` | Update `props` field on a remotion element |
| `remotionExport()` | `POST /api/claude/export/:projectId/start` | Trigger export with `engineType: "remotion"` forced |

### Subtask 2.3: Route commands in editor handler dispatcher

**Files**:
- `electron/native-pipeline/cli/cli-handlers-editor.ts` (lines 56-76)

**Changes**:
- Add routing for `editor:remotion:*` commands to `handleRemotionCommand()` from new handler module

### Subtask 2.4: Add HTTP API endpoint for Remotion component listing

The existing `GET /api/claude/timeline/:projectId` returns the full timeline. A dedicated endpoint provides a cleaner interface for Remotion operations.

**Files**:
- `electron/claude/http/claude-http-shared-routes.ts` (after timeline routes, ~line 440)

**New endpoint**:
```
GET /api/claude/remotion/:projectId/elements
```
Returns:
```json
{
  "elements": [
    {
      "elementId": "...",
      "trackId": "...",
      "componentId": "...",
      "componentPath": "...",
      "props": {...},
      "startTime": 0,
      "duration": 12,
      "renderMode": "live"
    }
  ]
}
```

**Files also touched**:
- `electron/claude/handlers/claude-timeline-handler.ts` — add IPC handler `claude:remotion:listElements`

### Tests

- `electron/__tests__/remotion-cli-commands.test.ts` (new)
  - Test command routing dispatches correctly
  - Test `remotionList()` filters remotion elements from timeline
  - Test `remotionUpdateProps()` sends correct PATCH payload
  - Test `remotionExport()` forces remotion engine type

---

## Task 3: End-to-End Generate → Cut → Export CLI Workflow

**Estimated time**: < 20 minutes — single task, no subtasks needed.

Validate the full pipeline works end-to-end from CLI.

**Files**:
- `electron/native-pipeline/cli/cli-handlers-remotion.ts` (existing, lines 209-397)

**Changes**:
- After `--add-to-timeline` succeeds, if `--export` flag is also set, chain into `remotionExport()`
- Add `--export` and `--export-format` flags to `generate-remotion` command

**New CLI workflow**:
```bash
# Full pipeline: generate → add to timeline → export
bun run pipeline generate-remotion \
  --prompt "Good manners guide with 4 scenes" \
  --duration 12 \
  --add-to-timeline \
  --export \
  --export-format mp4 \
  --project-id <id>
```

### Tests

- Manual E2E test script documented in the plan
- Automated: `electron/__tests__/remotion-e2e-pipeline.test.ts` (new)
  - Mock editor API client
  - Test generate → add → export chain with `--export` flag

---

## Task 4: Remotion Element Trim Awareness in Preview

**Estimated time**: < 20 minutes — single task, no subtasks needed.

When a Remotion element is trimmed or split, the preview must offset `useCurrentFrame()` by `trimStart` so the Remotion animation plays from the correct internal frame.

**Files**:
- `apps/web/src/lib/remotion/player-wrapper.tsx` (lines 1-529)
- `apps/web/src/components/editor/preview-panel.tsx` (where RemotionPlayerWrapper is instantiated)

**Changes**:
- Pass `trimStart` as a prop to `RemotionPlayerWrapper`
- In the player wrapper, set `initialFrame` to `Math.round(trimStart * fps)` so a trimmed element starts at the correct internal frame
- Ensure `durationInFrames` accounts for `trimEnd` as well: `totalFrames - trimStartFrames - trimEndFrames`

### Tests

- `apps/web/src/lib/remotion/__tests__/player-wrapper-trim.test.ts` (new)
  - Test that trimStart offsets the initial frame
  - Test that trimEnd reduces the effective duration
  - Test split produces two elements that preview correctly

---

## Priority Order

| Priority | Task | Impact | Effort |
|---|---|---|---|
| 1 | **Task 1** — Wire export engine | Enables the core missing capability (export) | Medium |
| 2 | **Task 4** — Trim-aware preview | Ensures split/cut elements preview correctly | Small |
| 3 | **Task 2** — CLI commands | Enables automation and scripting workflows | Medium |
| 4 | **Task 3** — E2E pipeline | Convenience — chains existing capabilities | Small |

---

## Key Source Files Reference

| File | Purpose |
|---|---|
| `apps/web/src/lib/remotion/export-engine-remotion.ts` | RemotionExportEngine (693 lines, ready) |
| `apps/web/src/lib/export/export-engine-factory.ts` | Engine selection + recommendation |
| `apps/web/src/lib/export/export-engine-renderer.ts` | Canvas frame renderer (missing remotion case) |
| `apps/web/src/hooks/export/use-export-progress.ts` | Export hook (calls wrong method) |
| `apps/web/src/components/export-dialog.tsx` | Export UI (no remotion detection) |
| `apps/web/src/stores/export-store.ts` | Remotion progress types (ready, never called) |
| `apps/web/src/lib/remotion/player-wrapper.tsx` | Preview + frame extraction |
| `apps/web/src/stores/timeline/split-operations.ts` | Split logic (type-agnostic, works) |
| `electron/native-pipeline/cli/cli.ts` | CLI command registration |
| `electron/native-pipeline/cli/cli-handlers-remotion.ts` | Generate-remotion handler |
| `electron/native-pipeline/editor/editor-handlers-timeline.ts` | Timeline CLI handlers |
| `electron/claude/http/claude-http-shared-routes.ts` | HTTP API routes |
| `electron/claude/handlers/claude-timeline-handler.ts` | IPC timeline handler |
