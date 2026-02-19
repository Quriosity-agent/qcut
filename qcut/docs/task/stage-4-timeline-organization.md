# Stage 4: Timeline Organization

> **Goal**: Let Claude Code organize clips on the timeline efficiently with batch operations and full round-trip serialization
> **Estimated effort**: ~4 hours total across 4 subtasks
> **Dependencies**: Stage 1 (media imported), Stage 3 (cuts executed)
> **Status**: Implemented on February 19, 2026

---

## Current State

| Capability | Status | File |
|---|---|---|
| Add single element to track | Ready | `POST /api/claude/timeline/:id/elements` |
| Split/move/update/delete element | Ready | Multiple endpoints |
| Selection management | Ready | `POST/GET/DELETE .../selection` |
| Ripple editing (single-track) | Ready | `timeline-store-operations.ts` |
| Timeline export (JSON + Markdown) | Ready | `claude-timeline-handler.ts` |
| Timeline import (JSON only) | Ready | `claude-timeline-handler.ts` |
| Undo/redo | Ready | `timeline-store.ts` |

**Implemented in this stage**: Batch add/delete/update endpoints, markdown round-trip parsing, cross-track ripple support in range delete, timeline arrange endpoint.

---

## Subtask 4.1: Batch Element Operations

**What**: Three batch endpoints for add, update, and delete.
**Status**: Done

**Relevant files**:
- `electron/claude/claude-timeline-handler.ts` (450 lines) — add batch IPC handlers
- `electron/claude/claude-http-server.ts` (537 lines) — register routes
- `apps/web/src/stores/timeline-store.ts` (1066 lines) — existing `addElementToTrack()`, `removeElementFromTrack()`
- `electron/types/claude-api.ts` — batch types

### 4.1a: Batch Add Elements

```
POST /api/claude/timeline/:projectId/elements/batch
Body: {
  "elements": [
    { "type": "media", "mediaId": "media_...", "trackId": "track_1", "startTime": 0, "duration": 5 },
    { "type": "text", "content": "Title", "trackId": "track_2", "startTime": 0, "duration": 3 },
    { "type": "media", "mediaId": "media_...", "trackId": "track_1", "startTime": 5, "duration": 8 }
  ]
}
Response: {
  "success": true,
  "data": {
    "added": [
      { "index": 0, "elementId": "el_abc", "success": true },
      { "index": 1, "elementId": "el_def", "success": true },
      { "index": 2, "elementId": "el_ghi", "success": true }
    ],
    "failedCount": 0
  }
}
```

**Implementation**:
```typescript
// electron/claude/claude-timeline-handler.ts

async function batchAddElements(
  win: BrowserWindow,
  projectId: string,
  elements: CreateTimelineElement[]
): Promise<BatchResult> {
  // 1. Validate all elements before adding any (fail-fast)
  // 2. Push single history snapshot
  // 3. Send batch to renderer via IPC
  // 4. Renderer processes sequentially (order matters for overlaps)
  // 5. Return per-element results
}
```

**Limit**: Max 50 elements per batch.

### 4.1b: Batch Delete Elements

```
DELETE /api/claude/timeline/:projectId/elements/batch
Body: {
  "elements": [
    { "trackId": "track_1", "elementId": "el_abc" },
    { "trackId": "track_1", "elementId": "el_def" }
  ],
  "ripple": true
}
Response: { "success": true, "data": { "deletedCount": 2 } }
```

### 4.1c: Batch Update Elements

```
PATCH /api/claude/timeline/:projectId/elements/batch
Body: {
  "updates": [
    { "elementId": "el_abc", "startTime": 5.0 },
    { "elementId": "el_def", "duration": 10.0 },
    { "elementId": "el_ghi", "trimStart": 1.0, "trimEnd": 2.0 }
  ]
}
Response: { "success": true, "data": { "updatedCount": 3, "failedCount": 0 } }
```

**All batch operations**: Single undo snapshot, sequential processing within batch, per-item error reporting.

**Test file**: `electron/__tests__/claude-batch-elements.test.ts`

**Tests to write**:
- Batch adds multiple elements to multiple tracks
- Batch deletes with ripple
- Batch updates different properties
- Single undo restores entire batch
- Rejects batches exceeding 50 items
- Reports per-item failures without aborting batch
- Validates track compatibility before adding

---

## Subtask 4.2: Fix Markdown Timeline Import

**What**: Make `markdownToTimeline()` parse tracks and elements from the markdown format that `timelineToMarkdown()` exports.
**Status**: Done

**Relevant files**:
- `electron/claude/claude-timeline-handler.ts` (lines 102-146) — `markdownToTimeline()` currently throws on track data
- `electron/types/claude-api.ts` — `ClaudeTimeline`, `ClaudeTrack`, `ClaudeElement` types

**Current markdown export format** (from `timelineToMarkdown()`):
```markdown
# Project: My Video
- Duration: 120.00s
- Resolution: 1920×1080
- FPS: 30

## Track 1: Main (media)
| # | Type | Start | End | Duration | Source | Content |
|---|------|-------|-----|----------|--------|---------|
| 1 | video | 0.00s | 5.00s | 5.00s | clip1.mp4 | |
| 2 | video | 5.00s | 13.00s | 8.00s | clip2.mp4 | |

## Track 2: Text (text)
| # | Type | Start | End | Duration | Source | Content |
|---|------|-------|-----|----------|--------|---------|
| 1 | text | 0.00s | 3.00s | 3.00s | | Title Card |
```

**Implementation**:
```typescript
function markdownToTimeline(md: string): ClaudeTimeline {
  // 1. Parse metadata (existing code works)
  // 2. Find ## Track N: Name (type) headers
  // 3. Parse markdown table rows for each track
  // 4. Map columns → ClaudeElement properties
  // 5. Validate all parsed elements
  // 6. Return complete ClaudeTimeline
}
```

**Parsing rules**:
- `## Track N:` marks track start
- Track type in parentheses: `(media)`, `(text)`, etc.
- Table rows map to elements: `| # | Type | Start | End | Duration | Source | Content |`
- Time values: parse `"5.00s"` → `5.0`
- Source: filename for media, empty for text/sticker
- Content: text content for text elements

**Test file**: `electron/__tests__/claude-timeline-markdown.test.ts`

**Tests to write**:
- Round-trip: `timeline → markdown → timeline` produces equivalent result
- Parses multi-track markdown
- Handles empty tracks
- Handles text elements with content
- Handles media elements with source filenames
- Rejects malformed markdown with clear error
- Preserves timing precision (2 decimal places)

---

## Subtask 4.3: Cross-Track Ripple Delete

**What**: When deleting a time range, optionally shift elements on ALL tracks (not just the affected track).
**Status**: Done

**Relevant files**:
- `apps/web/src/stores/timeline-store-operations.ts` (1172 lines) — `removeElementFromTrackWithRipple()` currently single-track
- `apps/web/src/stores/timeline-store.ts` — store methods
- Stage 3.3 range delete — integrates with this

**Implementation**:
```typescript
// Add to timeline-store-operations.ts

function rippleDeleteAcrossTracks(
  state: TimelineState,
  startTime: number,
  endTime: number,
  excludeTrackIds?: string[]
): void {
  const rippleDuration = endTime - startTime;

  for (const track of state._tracks) {
    if (excludeTrackIds?.includes(track.id)) continue;

    for (const element of track.elements) {
      // Elements fully after the deleted range: shift left
      if (element.startTime >= endTime) {
        element.startTime -= rippleDuration;
      }
      // Elements spanning the range: handled by range delete (Stage 3.3)
    }
  }
}
```

**API**: Add `crossTrackRipple: boolean` option to the range delete endpoint (Stage 3.3).

```
DELETE /api/claude/timeline/:projectId/range
Body: { "startTime": 10.0, "endTime": 15.0, "ripple": true, "crossTrackRipple": true }
```

**Test file**: `electron/__tests__/claude-cross-track-ripple.test.ts`

**Tests to write**:
- Cross-track ripple shifts elements on all tracks
- Excludes specified tracks from ripple
- Preserves relative timing between tracks
- Audio track stays synchronized with video track after ripple
- Single undo restores all tracks

---

## Subtask 4.4: Timeline Arrange/Sequence Endpoint

**What**: `POST /api/claude/timeline/:projectId/arrange`
**Status**: Done

Automatically arranges elements on a track — sequential (end-to-end), spaced, or custom layout.

**Relevant files**:
- `electron/claude/claude-timeline-handler.ts` — add arrangement logic
- `apps/web/src/stores/timeline-store.ts` — `updateElementStartTime()`

**Implementation**:
```typescript
interface ArrangeRequest {
  trackId: string;
  mode: "sequential" | "spaced" | "manual";
  gap?: number;              // Gap between elements (default: 0 for sequential, 0.5 for spaced)
  order?: string[];          // Element IDs in desired order (for manual)
  startOffset?: number;      // Where to start arranging (default: 0)
}

interface ArrangeResponse {
  arranged: Array<{ elementId: string; newStartTime: number }>;
}
```

**Use case**: After batch-adding 10 clips, call arrange to lay them out sequentially.

```
POST /api/claude/timeline/:projectId/arrange
Body: {
  "trackId": "track_1",
  "mode": "sequential",
  "gap": 0.5,
  "startOffset": 0
}
Response: {
  "success": true,
  "data": {
    "arranged": [
      { "elementId": "el_1", "newStartTime": 0 },
      { "elementId": "el_2", "newStartTime": 5.5 },
      { "elementId": "el_3", "newStartTime": 14.0 }
    ]
  }
}
```

**Test file**: `electron/__tests__/claude-timeline-arrange.test.ts`

**Tests to write**:
- Sequential mode places elements end-to-end
- Spaced mode adds gap between elements
- Manual mode respects provided order
- Start offset shifts all placements
- Single undo restores original positions
- Handles empty track gracefully

---

## File Impact Summary

| File | Change Type | Lines Added (est.) |
|---|---|---|
| `electron/claude/claude-timeline-handler.ts` | Edit | batch handlers + renderer request/response + markdown parsing |
| `electron/claude/claude-http-server.ts` | Edit | batch routes + range + arrange routes |
| `electron/types/claude-api.ts` | Edit | Stage 4 request/response types |
| `electron/preload-types.ts` | Edit | preload API type updates for Stage 4 timeline methods/events |
| `electron/preload-integrations.ts` | Edit | new Stage 4 invoke/listener bridge channels |
| `apps/web/src/types/electron.d.ts` | Edit | renderer type updates for Stage 4 channels |
| `apps/web/src/lib/claude-timeline-bridge.ts` | Edit | renderer-side batch/update/delete/range/arrange handlers |
| `apps/web/src/lib/claude-timeline-bridge-helpers.ts` | Edit | track id included in exported timeline |
| `apps/web/src/stores/timeline-store.ts` | Edit | history-aware element add/update primitives for batching |
| `apps/web/src/stores/timeline-store-operations.ts` | Edit | `deleteTimeRange()` + `rippleDeleteAcrossTracks()` |
| `apps/web/src/stores/timeline/types.ts` | Edit | Stage 4 store method signatures |
| `electron/claude/__tests__/handler-functions.test.ts` | Edit | markdown track parsing/validation coverage |
| `electron/claude/__tests__/claude-http-server.test.ts` | Edit | Stage 4 route coverage additions |

---

## Verification Notes

- `bunx vitest run electron/claude/__tests__/handler-functions.test.ts` passes.
- `bunx vitest run electron/claude/__tests__/claude-http-server.test.ts` passes.
- Full workspace TypeScript compile is currently blocked by an existing environment issue: missing type definition file for `sharp`.

---

## Manual Test Plan (Real QCut)

Use this checklist to validate Stage 4 behavior in the real desktop app.

### 0) Setup

1. Launch QCut and open a real project.
2. Import at least 3 media files (video/audio/image) into the project.
3. Ensure Claude HTTP API is running:

```bash
curl -s http://127.0.0.1:8765/api/claude/health | jq
```

4. Set variables for convenience:

```bash
PROJECT_ID="your_project_id"
BASE_URL="http://127.0.0.1:8765/api/claude"
```

5. Export timeline JSON and note track IDs:

```bash
curl -s "$BASE_URL/timeline/$PROJECT_ID" | jq '.data.tracks[] | {id, index, name, type}'
```

6. List media IDs:

```bash
curl -s "$BASE_URL/media/$PROJECT_ID" | jq '.data[] | {id, name, type}'
```

### 1) Batch Add (4.1a)

1. Call batch add with valid `trackId` + `mediaId`/text:

```bash
curl -s -X POST "$BASE_URL/timeline/$PROJECT_ID/elements/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "elements": [
      { "type": "media", "mediaId": "MEDIA_ID_1", "trackId": "MEDIA_TRACK_ID", "startTime": 0, "duration": 4 },
      { "type": "text", "content": "Stage 4 Title", "trackId": "TEXT_TRACK_ID", "startTime": 0, "duration": 3 },
      { "type": "media", "mediaId": "MEDIA_ID_2", "trackId": "MEDIA_TRACK_ID", "startTime": 5, "duration": 5 }
    ]
  }' | jq
```

2. Expected:
- `success: true`
- `data.failedCount: 0`
- `data.added` has per-item `elementId`
- Elements appear in timeline UI.

3. Undo check:
- Press undo once in QCut.
- Expected: all batch-added elements are removed together.

4. Negative check:
- Send 51 items.
- Expected: HTTP 400 with batch limit message.

### 2) Batch Update (4.1c)

1. Use returned element IDs and update multiple fields:

```bash
curl -s -X PATCH "$BASE_URL/timeline/$PROJECT_ID/elements/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "updates": [
      { "elementId": "EL_ID_1", "startTime": 8 },
      { "elementId": "EL_ID_2", "duration": 6 },
      { "elementId": "EL_ID_3", "content": "Updated Title" }
    ]
  }' | jq
```

2. Expected:
- `updatedCount` reflects successful updates
- `failedCount` reflects invalid element IDs only
- UI updates applied.

3. Undo check:
- Press undo once.
- Expected: all updates revert together.

### 3) Batch Delete + Ripple (4.1b)

1. Delete 2 elements with ripple:

```bash
curl -s -X DELETE "$BASE_URL/timeline/$PROJECT_ID/elements/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "elements": [
      { "trackId": "MEDIA_TRACK_ID", "elementId": "EL_ID_1" },
      { "trackId": "MEDIA_TRACK_ID", "elementId": "EL_ID_2" }
    ],
    "ripple": true
  }' | jq
```

2. Expected:
- `deletedCount` increments
- Later elements on affected track shift left.

3. Undo check:
- Press undo once.
- Expected: both deletes and ripple shifts restore together.

### 4) Markdown Import/Export Round Trip (4.2)

1. Export markdown:

```bash
curl -s "$BASE_URL/timeline/$PROJECT_ID?format=md" | jq -r '.data' > /tmp/qcut-timeline.md
```

2. Re-import the same markdown:

```bash
curl -s -X POST "$BASE_URL/timeline/$PROJECT_ID/import" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile md /tmp/qcut-timeline.md '{format:\"md\", data:$md}')" | jq
```

3. Expected:
- `imported: true`
- No parsing error
- Tracks/elements preserved in UI.

4. Negative check:
- Corrupt one table row in markdown and import.
- Expected: HTTP 400 with clear markdown parse error.

### 5) Range Delete + Cross-Track Ripple (4.3)

1. Run range delete without cross-track ripple:

```bash
curl -s -X DELETE "$BASE_URL/timeline/$PROJECT_ID/range" \
  -H "Content-Type: application/json" \
  -d '{"startTime":10,"endTime":15,"ripple":true,"crossTrackRipple":false}' | jq
```

2. Run same test with cross-track ripple enabled:

```bash
curl -s -X DELETE "$BASE_URL/timeline/$PROJECT_ID/range" \
  -H "Content-Type: application/json" \
  -d '{"startTime":10,"endTime":15,"ripple":true,"crossTrackRipple":true}' | jq
```

3. Expected:
- With `false`: only targeted tracks ripple.
- With `true`: all tracks shift for content after `endTime`.
- `totalRemovedDuration` equals `endTime - startTime`.

4. Undo check:
- Press undo once.
- Expected: all tracks restore.

### 6) Arrange Endpoint (4.4)

1. Arrange sequential:

```bash
curl -s -X POST "$BASE_URL/timeline/$PROJECT_ID/arrange" \
  -H "Content-Type: application/json" \
  -d '{"trackId":"MEDIA_TRACK_ID","mode":"sequential","gap":0.5,"startOffset":0}' | jq
```

2. Arrange manual order:

```bash
curl -s -X POST "$BASE_URL/timeline/$PROJECT_ID/arrange" \
  -H "Content-Type: application/json" \
  -d '{"trackId":"MEDIA_TRACK_ID","mode":"manual","order":["EL_ID_3","EL_ID_1","EL_ID_2"],"gap":0.25}' | jq
```

3. Expected:
- Response contains `arranged[]` with new start times.
- UI reflects sequential/spaced/manual order.

4. Undo check:
- Press undo once.
- Expected: track returns to pre-arrange layout.

### 7) Final Exit Criteria

- Batch add/update/delete work with per-item result reporting.
- Markdown round-trip imports full tracks/elements, not metadata only.
- Cross-track ripple behaves differently when toggled.
- Arrange works in sequential/spaced/manual modes.
- Each operation family is single-undo atomic in real UI.

---

## End-to-End Flow After Stage 4

```
Claude Code Workflow:
  1. Import 5 videos (Stage 1 batch import)
  2. Transcribe + analyze all (Stage 2)
  3. Auto-edit each: remove fillers/silences (Stage 3)
  4. Batch add all edited clips to timeline (4.1a)
  5. Arrange sequentially with 0.5s gaps (4.4)
  6. Add text titles at scene boundaries (4.1a)
  7. Export timeline as markdown for review (existing)
  8. → Stage 5 (export final video)
```
