# Stage 4: Timeline Organization

> **Goal**: Let Claude Code organize clips on the timeline efficiently with batch operations and full round-trip serialization
> **Status**: IMPLEMENTED + TESTED (2026-02-20)
> **Tests**: 18 bridge tests + 10 handler-functions tests + 10 HTTP server tests, live API tests below

---

## Live API Test Results (2026-02-20)

Tested against running QCut instance (localhost:8765) with real media files.

| # | Endpoint | Input | Result | Details |
|---|----------|-------|--------|---------|
| 1 | `POST /timeline/:pid/elements/batch` | 3 media elements | **PASS** | All 3 added, failedCount=0, per-item elementIds returned |
| 2 | `POST /timeline/:pid/elements/batch` | 51 elements (over limit) | **PASS** | 400: "Batch add limited to 50 elements" |
| 3 | `POST /timeline/:pid/elements/batch` | Media on text track | **PASS** | 400: "Element type 'media' is not compatible with track (text)" |
| 4 | `PATCH /timeline/:pid/elements/batch` | Update 3 startTime/duration | **PASS** | updatedCount=3, failedCount=0 |
| 5 | `PATCH /timeline/:pid/elements/batch` | Valid + nonexistent element | **PASS** | updatedCount=1, failedCount=1, per-item error |
| 6 | `PATCH /timeline/:pid/elements/batch` | Update text content | **PASS** | Content updated to "Updated Title Card" |
| 7 | `DELETE /timeline/:pid/elements/batch` | Delete 1 element with ripple | **PASS** | deletedCount=1, failedCount=0 |
| 8 | `DELETE /timeline/:pid/elements/batch` | Nonexistent element | **PASS** | deletedCount=0, failedCount=1, per-item error |
| 9 | `POST /timeline/:pid/arrange` | Sequential mode, gap=0.5 | **PASS** | 2 elements arranged, correct startTimes |
| 10 | `POST /timeline/:pid/arrange` | Manual order (reversed) | **PASS** | Elements reordered with gap=1.0, startOffset=2 |
| 11 | `POST /timeline/:pid/arrange` | Spaced mode (default gap) | **PASS** | Default 0.5s gap applied |
| 12 | `POST /timeline/:pid/arrange` | Nonexistent track | **PASS** | Returns empty arranged[] (no error) |
| 13 | `GET /timeline/:pid?format=md` | Markdown export | **PASS** | Valid markdown with project info + track tables |
| 14 | `POST /timeline/:pid/import` | Re-import exported markdown | **PASS** | imported=true, elements appended |
| 15 | `POST /timeline/:pid/import` | Malformed markdown | **PARTIAL** | Returns imported=true but no elements — should warn/fail |
| 16 | `POST /timeline/:pid/import` | JSON round-trip | **PASS** | Full JSON export + import works |
| 17 | `POST /timeline/:pid/selection` | Set 1 element selected | **PASS** | selected=1 |
| 18 | `GET /timeline/:pid/selection` | Get selection | **PASS** | Returns trackId + elementId |
| 19 | `DELETE /timeline/:pid/selection` | Clear selection | **PASS** | cleared=true |
| 20 | `DELETE /timeline/:pid/range` | No cross-track ripple | **PASS** | Split/delete correct, text tracks unchanged |
| 21 | `DELETE /timeline/:pid/range` | With crossTrackRipple=true | **ISSUE** | Split/delete works but elements NOT shifted left — ripple not applied |

### Results Summary

**19 PASS / 1 PARTIAL / 1 ISSUE**

### Issues Found

| Issue | Severity | Details |
|-------|----------|---------|
| **Range delete ripple not shifting elements** | High | `ripple: true` on range delete splits and removes content correctly but does NOT shift subsequent elements left to close the gap. Both same-track and cross-track ripple are missing. |
| **Malformed markdown import silently succeeds** | Low | Importing random text (`"# Not a timeline"`) returns `imported: true` instead of a warning or error. No elements are added, but the success response is misleading. |
| **Markdown import appends, doesn't replace** | Info | By design — `applyTimelineToStore()` appends to existing timeline. Re-importing the same markdown duplicates elements. Consider a `replace` mode option. |

---

## Current State

| Capability | Status | File |
|---|---|---|
| Batch add elements | **Working** | `POST /timeline/:pid/elements/batch` |
| Batch update elements | **Working** | `PATCH /timeline/:pid/elements/batch` |
| Batch delete elements | **Working** | `DELETE /timeline/:pid/elements/batch` |
| Arrange/sequence elements | **Working** | `POST /timeline/:pid/arrange` |
| Markdown export | **Working** | `GET /timeline/:pid?format=md` |
| Markdown import | **Working** | `POST /timeline/:pid/import` (format=md) |
| JSON export/import | **Working** | `GET/POST /timeline/:pid` |
| Selection management | **Working** | `POST/GET/DELETE .../selection` |
| Range delete (split/remove) | **Working** | `DELETE /timeline/:pid/range` |
| Range delete (ripple shift) | **Not working** | Elements not shifted after range removal |
| Cross-track ripple | **Not working** | `crossTrackRipple` flag forwarded but no effect |

---

## Subtask 4.1: Batch Element Operations

**Endpoints**:
- `POST /api/claude/timeline/:projectId/elements/batch` — batch add
- `PATCH /api/claude/timeline/:projectId/elements/batch` — batch update
- `DELETE /api/claude/timeline/:projectId/elements/batch` — batch delete

**Implementation**: `electron/claude/claude-timeline-handler.ts` + `apps/web/src/lib/claude-timeline-bridge.ts`

**Live test**: All PASS — batch add (3 elements), update (startTime/duration/content), delete (with ripple). Limit enforced at 50. Per-item error reporting works (valid + invalid elements in same batch). Track type compatibility validated.

**Unit tests**: 18 passing (`src/lib/__tests__/claude-timeline-bridge.test.ts`)

---

## Subtask 4.2: Markdown Timeline Import/Export

**Endpoints**:
- `GET /api/claude/timeline/:projectId?format=md` — export as markdown
- `POST /api/claude/timeline/:projectId/import` — import (format=md or json)

**Implementation**: `electron/claude/claude-timeline-handler.ts` (`timelineToMarkdown()` + `markdownToTimeline()`)

**Live test**: Export PASS — produces valid markdown with project info table + per-track element tables. Import PASS — re-importing exported markdown succeeds and adds elements. JSON round-trip also works.

**Issue**: Malformed markdown (`"# Not a timeline"`) returns `imported: true` instead of an error. No elements are added but the response is misleading.

**Note**: Import appends to existing timeline (by design). Re-importing the same markdown duplicates elements. Consider adding a `replace` mode.

**Unit tests**: 4 passing in `handler-functions.test.ts` (markdown parse + round-trip + malformed rejection + metadata extraction)

---

## Subtask 4.3: Cross-Track Ripple Delete

**Endpoint**: `DELETE /api/claude/timeline/:projectId/range` with `crossTrackRipple: true`

**Implementation**: `electron/claude/claude-range-handler.ts` + `apps/web/src/lib/claude-timeline-bridge.ts` (`onDeleteRange`)

**Live test**: **ISSUE** — The `crossTrackRipple` flag is forwarded from HTTP server to renderer via IPC, but the renderer bridge (`onDeleteRange`) does not implement any ripple shift logic. It correctly splits and deletes content within the range, but elements after the range are NOT shifted left to close the gap.

**Root cause**: The `onDeleteRange` handler in `claude-timeline-bridge.ts` (lines 1260-1370) performs split/delete operations but ignores the `ripple` and `crossTrackRipple` flags. Neither same-track nor cross-track ripple shifting is implemented.

**Fix needed**: After performing the range delete, iterate all tracks (or affected tracks for same-track ripple) and shift elements with `startTime >= endTime` left by `(endTime - startTime)` seconds using `updateElementStartTime()`.

**Unit tests**: 1 HTTP server test verifies the flag is forwarded; no bridge-level test for actual ripple behavior

---

## Subtask 4.4: Timeline Arrange/Sequence Endpoint

**Endpoint**: `POST /api/claude/timeline/:projectId/arrange`

**Implementation**: `electron/claude/claude-timeline-handler.ts` + `apps/web/src/lib/claude-timeline-bridge.ts` (`onArrange`)

**Live test**: All PASS — sequential mode (gap=0.5), manual order (reversed elements, gap=1.0, startOffset=2), spaced mode (default 0.5s gap). Nonexistent track returns empty arranged[].

**Unit tests**: 1 HTTP server test verifies route dispatch

---

## Test Count Summary

| Test File | Tests | Location |
|-----------|-------|----------|
| `claude-timeline-bridge.test.ts` | 18 | `src/lib/__tests__/` (runnable via `bun run test`) |
| `handler-functions.test.ts` | 10 | `electron/claude/__tests__/` (not in vitest include glob) |
| `claude-http-server.test.ts` | 10 (Stage 4) | `electron/claude/__tests__/` (not in vitest include glob) |
| **Runnable total** | **18** | |

**Note**: Tests in `electron/claude/__tests__/` are not discoverable by vitest because the include glob is `../../electron/__tests__/**` (not `../../electron/claude/__tests__/**`). These tests pass when run directly with `bunx vitest run` but not via `bun run test`.

---

## Improvements Needed

| Priority | Issue | Fix |
|----------|-------|-----|
| **High** | Range delete ripple not implemented | Add element shifting in `onDeleteRange` handler in `claude-timeline-bridge.ts` — after split/delete, iterate tracks and shift elements with `startTime >= endTime` left by range duration |
| **High** | Cross-track ripple not implemented | Same fix as above, but apply to ALL tracks (not just the one with deleted content) |
| **Medium** | Vitest include glob misses `electron/claude/__tests__/` | Update `vitest.config.ts` include to add `../../electron/claude/__tests__/**/*.test.ts` |
| **Low** | Malformed markdown import silently succeeds | `markdownToTimeline()` should return empty tracks when no content parsed; HTTP handler should return a warning or check if anything was actually imported |
| **Low** | Markdown import only appends | Add optional `replace: true` flag to clear existing timeline before importing |

---

## Implementation Files

| File | Lines | Purpose |
|---|---|---|
| `electron/claude/claude-timeline-handler.ts` | ~1000 | Batch IPC handlers, markdown parsing, arrange logic |
| `electron/claude/claude-range-handler.ts` | 96 | Range delete handler (split/remove, no ripple) |
| `apps/web/src/lib/claude-timeline-bridge.ts` | 1444 | Renderer-side IPC bridge for all timeline ops |
| `apps/web/src/lib/claude-timeline-bridge-helpers.ts` | 475 | Helper functions for element resolution |
| `electron/claude/claude-http-server.ts` | ~600 | Route registration |

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

### 7) Exit Criteria Status

| Criterion | Status |
|-----------|--------|
| Batch add/update/delete with per-item result reporting | **PASS** |
| Markdown round-trip imports full tracks/elements | **PASS** (appends, not replaces) |
| Cross-track ripple behaves differently when toggled | **FAIL** — ripple shift not implemented |
| Arrange works in sequential/spaced/manual modes | **PASS** |
| Each operation family is single-undo atomic | **Not verified** (requires UI testing) |
