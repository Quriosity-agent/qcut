# Stage 3: Cut List & Smart Editing

> **Goal**: Let Claude Code submit a list of cuts or auto-edit rules and have them executed in one API call
> **Estimated effort**: ~4 hours total across 4 subtasks
> **Dependencies**: Stage 2 (transcription + scene detection provide the data for cut decisions)

---

## Current State

| Capability | Status | File |
|---|---|---|
| Split element at timestamp | Ready | `POST /api/claude/timeline/:id/elements/:eid/split` |
| Word-level timestamps from transcription | Ready | `apps/web/src/stores/word-timeline-store.ts` |
| Filler word detection | Ready | `electron/ai-filler-handler.ts` |
| Silence gap detection (1.5s+) | Ready | `electron/ai-filler-handler.ts` |
| Single element delete | Ready | `DELETE /api/claude/timeline/:id/elements/:eid` |

**What's missing**: No batch cut-list endpoint. No auto-edit (remove fillers/silences). No time-range delete. Must call split individually per cut point.

---

## Subtask 3.1: Batch Cut-List Endpoint

**What**: `POST /api/claude/timeline/:projectId/cuts`

Accepts an array of `{start, end}` intervals to remove from a video element, executing all cuts in one atomic operation with undo support.

**Relevant files**:
- `electron/claude/claude-timeline-handler.ts` (450 lines) — add cut-list handler
- `apps/web/src/stores/timeline/split-operations.ts` (304 lines) — reuse `splitElementOperation()`
- `apps/web/src/stores/timeline-store.ts` (1066 lines) — `pushHistory()` for undo
- `electron/claude/claude-http-server.ts` — register route
- `electron/types/claude-api.ts` — add CutList types

**Implementation**:
```typescript
// Add to claude-timeline-handler.ts

interface CutInterval {
  start: number;   // seconds
  end: number;     // seconds
}

interface CutListRequest {
  elementId: string;
  cuts: CutInterval[];     // Intervals to REMOVE
  ripple?: boolean;        // Shift subsequent elements left (default: true)
}

interface CutListResponse {
  removedCount: number;
  remainingElements: Array<{ id: string; startTime: number; duration: number }>;
  totalRemovedDuration: number;
}
```

**Algorithm**:
```
1. Sort cuts by start time (descending — process from end to avoid offset drift)
2. Push single history snapshot (one undo restores everything)
3. For each cut interval (from end to start):
   a. Find element(s) overlapping the interval
   b. Split at cut.start → get right piece
   c. Split right piece at cut.end → get middle piece (to remove) + tail
   d. Delete middle piece
   e. If ripple, shift all subsequent elements left by cut duration
4. Return remaining element list
```

**Why descending order**: Cutting from end-to-start prevents earlier cuts from invalidating later timestamps. This is the standard NLE algorithm.

**API contract**:
```
POST /api/claude/timeline/:projectId/cuts
Body: {
  "elementId": "el_abc123",
  "cuts": [
    { "start": 2.0, "end": 3.5 },
    { "start": 8.0, "end": 10.0 },
    { "start": 15.5, "end": 16.0 }
  ],
  "ripple": true
}
Response: {
  "success": true,
  "data": {
    "removedCount": 3,
    "remainingElements": [
      { "id": "el_abc123", "startTime": 0, "duration": 2.0 },
      { "id": "el_def456", "startTime": 2.0, "duration": 4.5 },
      { "id": "el_ghi789", "startTime": 6.5, "duration": 5.5 }
    ],
    "totalRemovedDuration": 4.0
  }
}
```

**Test file**: `electron/__tests__/claude-cut-list.test.ts`

**Tests to write**:
- Removes single interval from element
- Removes multiple non-overlapping intervals
- Processes cuts in correct order (descending)
- Ripple mode shifts elements left
- Non-ripple mode leaves gaps
- Single undo restores all cuts
- Handles cuts at element boundaries (start/end)
- Rejects overlapping cut intervals
- Rejects cuts outside element duration

---

## Subtask 3.2: Auto-Edit Endpoint (Remove Fillers & Silences)

**What**: `POST /api/claude/timeline/:projectId/auto-edit`

Combines transcription + filler detection + cut execution into one call. "Remove all filler words and silences from this video."

**Relevant files**:
- `electron/claude/claude-timeline-handler.ts` — orchestration
- `electron/elevenlabs-transcribe-handler.ts` (436 lines) — transcription
- `electron/ai-filler-handler.ts` — filler/silence detection
- Subtask 3.1 cut-list endpoint — execute the cuts

**Implementation**:
```typescript
// New file: electron/claude/claude-auto-edit-handler.ts (<250 lines)

interface AutoEditRequest {
  elementId: string;
  rules: {
    removeFillers?: boolean;          // Remove "um", "uh", "like", etc.
    removeSilences?: boolean;         // Remove silence gaps
    silenceThreshold?: number;        // Minimum silence duration (default: 1.5s)
    keepSilencePadding?: number;      // Keep N seconds of silence as breathing room (default: 0.3s)
    customPatterns?: string[];        // Additional words to remove
  };
  dryRun?: boolean;                   // Return cut list without executing
}

interface AutoEditResponse {
  cuts: CutInterval[];                // What was (or would be) removed
  totalRemovedDuration: number;
  fillerCount: number;
  silenceCount: number;
  remainingDuration: number;
  // If dryRun: false, also includes remainingElements
}
```

**Pipeline flow**:
```
1. Extract audio from video element's source media
2. Transcribe via ElevenLabs (word-level timestamps)
3. Run filler detection
4. Convert filler words + silences → CutInterval[]
5. If dryRun: return cut list for review
6. If !dryRun: execute via Subtask 3.1 cut-list endpoint
```

**The `dryRun` option is critical**: Lets Claude Code preview what will be removed before committing. This matches professional editing workflows where editors review before executing.

**API contract**:
```
POST /api/claude/timeline/:projectId/auto-edit
Body: {
  "elementId": "el_abc123",
  "rules": { "removeFillers": true, "removeSilences": true, "silenceThreshold": 2.0 },
  "dryRun": true
}
Response: {
  "success": true,
  "data": {
    "cuts": [
      { "start": 2.1, "end": 2.4, "reason": "filler: um" },
      { "start": 5.0, "end": 7.2, "reason": "silence: 2.2s" }
    ],
    "totalRemovedDuration": 2.5,
    "fillerCount": 1,
    "silenceCount": 1,
    "remainingDuration": 117.5
  }
}
```

**Test file**: `electron/__tests__/claude-auto-edit-handler.test.ts`

**Tests to write**:
- Dry run returns cut list without modifying timeline
- Filler removal identifies common filler words
- Silence removal respects threshold parameter
- Padding keeps breathing room around cuts
- Full execution applies all cuts
- Custom patterns detect additional words
- Empty transcription returns no cuts
- Handles overlapping filler + silence regions (merge intervals)

---

## Subtask 3.3: Time-Range Operations

**What**: `DELETE /api/claude/timeline/:projectId/range`

Deletes all content within a time range across all tracks (or specified tracks).

**Relevant files**:
- `electron/claude/claude-timeline-handler.ts` — add range operation
- `apps/web/src/stores/timeline-store.ts` — element lookup by time
- `apps/web/src/stores/timeline-store-operations.ts` (1172 lines) — ripple operations

**Implementation**:
```typescript
interface RangeDeleteRequest {
  startTime: number;
  endTime: number;
  trackIds?: string[];      // Specific tracks, or all if omitted
  ripple?: boolean;         // Shift subsequent content left
}

interface RangeDeleteResponse {
  deletedElements: number;
  splitElements: number;    // Elements that were partially in range and got trimmed
  totalRemovedDuration: number;
}
```

**Algorithm**:
```
For each track (or specified tracks):
  1. Find elements overlapping [startTime, endTime]
  2. For each overlapping element:
     a. Fully contained → delete
     b. Partially overlapping at start → trim right side
     c. Partially overlapping at end → trim left side
     d. Element spans entire range → split at start, split at end, delete middle
  3. If ripple, shift all elements after endTime left
```

**API contract**:
```
DELETE /api/claude/timeline/:projectId/range
Body: { "startTime": 10.0, "endTime": 15.0, "ripple": true }
Response: {
  "success": true,
  "data": { "deletedElements": 2, "splitElements": 1, "totalRemovedDuration": 5.0 }
}
```

**Test file**: `electron/__tests__/claude-range-operations.test.ts`

**Tests to write**:
- Deletes fully contained elements
- Trims partially overlapping elements
- Splits spanning elements correctly
- Ripple shifts subsequent elements
- Handles multi-track range delete
- Track filter limits scope
- Empty range returns zero changes
- Single undo restores everything

---

## Subtask 3.4: Scene-Based Cut Suggestions

**What**: `POST /api/claude/analyze/:projectId/suggest-cuts`

Combines scene detection (Stage 2.2) + transcription (Stage 2.1) + content analysis to suggest intelligent cut points.

**Relevant files**:
- `electron/claude/claude-scene-handler.ts` (from Stage 2.2) — scene boundaries
- `electron/elevenlabs-transcribe-handler.ts` — word timestamps
- `electron/claude/claude-analyze-handler.ts` — video analysis

**Implementation**:
```typescript
// New file: electron/claude/claude-suggest-handler.ts (<200 lines)

interface CutSuggestion {
  start: number;
  end: number;
  reason: string;           // "filler_word" | "silence" | "scene_transition" | "duplicate_content" | "low_quality"
  confidence: number;       // 0.0 - 1.0
  description: string;      // Human-readable explanation
}

async function suggestCuts(
  projectId: string,
  mediaId: string,
  goals: string[]           // ["remove_fillers", "tighten_pacing", "highlight_reel"]
): Promise<CutSuggestion[]> {
  // 1. Run transcription (if not cached)
  // 2. Run scene detection (if not cached)
  // 3. Run filler detection
  // 4. Combine all signals into ranked suggestions
  // 5. Return sorted by confidence
}
```

**This is the "AI editor" endpoint** — it doesn't execute cuts, just suggests them. Claude Code reviews suggestions and calls the cut-list endpoint (3.1) to execute.

**Test file**: `electron/__tests__/claude-suggest-handler.test.ts`

**Tests to write**:
- Returns suggestions sorted by confidence
- Includes filler words as suggestions
- Includes silence gaps as suggestions
- Includes scene boundaries as potential cut points
- Respects goal filters
- Returns empty list for clean video

---

## File Impact Summary

| File | Change Type | Lines Added (est.) |
|---|---|---|
| `electron/claude/claude-timeline-handler.ts` | Edit | +120 (cut-list + range ops) |
| `electron/claude/claude-auto-edit-handler.ts` | **New** | ~230 |
| `electron/claude/claude-suggest-handler.ts` | **New** | ~180 |
| `electron/claude/claude-http-server.ts` | Edit | +20 (4 new routes) |
| `electron/types/claude-api.ts` | Edit | +50 (new types) |
| `electron/__tests__/claude-cut-list.test.ts` | **New** | ~200 |
| `electron/__tests__/claude-auto-edit-handler.test.ts` | **New** | ~180 |
| `electron/__tests__/claude-range-operations.test.ts` | **New** | ~160 |
| `electron/__tests__/claude-suggest-handler.test.ts` | **New** | ~120 |

---

## End-to-End Flow After Stage 3

```
Claude Code Workflow:
  1. Import video (Stage 1)
  2. Transcribe + detect scenes (Stage 2)
  3. GET /suggest-cuts → review suggestions
  4. POST /auto-edit { dryRun: true } → preview filler removal
  5. POST /auto-edit { dryRun: false } → execute
  6. POST /cuts → additional manual cuts
  7. DELETE /range → remove unwanted sections
  8. → Stage 4 (organize timeline)
```

---

## Manual Testing in QCut

### Prerequisites

1. Start QCut in dev mode: `bun run electron:dev`
2. The HTTP API starts automatically on `http://127.0.0.1:8765`
3. Import a video with speech (fillers/silences work best with talking-head content)
4. Note your **project ID** from the URL bar (e.g. `editor/proj_abc123`) and an **element ID** + **media ID** from the timeline

### Quick health check

```bash
curl http://127.0.0.1:8765/api/claude/health
```

### 1. Suggest Cuts (read-only — safest to test first)

Analyzes a media file and returns cut suggestions without modifying the timeline.

```bash
curl -X POST http://127.0.0.1:8765/api/claude/analyze/{projectId}/suggest-cuts \
  -H "Content-Type: application/json" \
  -d '{
    "mediaId": "YOUR_MEDIA_ID",
    "includeFillers": true,
    "includeSilences": true,
    "includeScenes": true
  }'
```

**What to verify**:
- Response contains `suggestions` array with `type`, `start`, `end`, `reason`, `confidence`
- `summary` shows counts for filler/silence/scene suggestions
- `transcription` metadata (wordCount, duration) is present
- `scenes` metadata (totalScenes, averageShotDuration) is present
- Try with individual flags disabled (`"includeFillers": false`) to confirm filtering works

### 2. Auto-Edit — Dry Run (read-only preview)

Preview what fillers and silences would be removed, without executing.

```bash
curl -X POST http://127.0.0.1:8765/api/claude/timeline/{projectId}/auto-edit \
  -H "Content-Type: application/json" \
  -d '{
    "elementId": "YOUR_ELEMENT_ID",
    "mediaId": "YOUR_MEDIA_ID",
    "removeFillers": true,
    "removeSilences": true,
    "silenceThreshold": 1.5,
    "keepSilencePadding": 0.3,
    "dryRun": true
  }'
```

**What to verify**:
- `applied` is `false`
- `cuts` array shows what would be removed, each with `start`, `end`, `reason`
- `transcription.wordCount` and `transcription.duration` are populated
- `analysis.fillerCount` and `analysis.silenceCount` match expectations
- Silence cuts have padding applied (e.g. a 1.5–3.5s silence with 0.3s padding → 1.8–3.2s cut)

### 3. Batch Cuts (modifies timeline — use Ctrl+Z to undo)

Remove specific time ranges from a single element. **This modifies the timeline** — the entire batch is undoable with a single Ctrl+Z.

```bash
curl -X POST http://127.0.0.1:8765/api/claude/timeline/{projectId}/cuts \
  -H "Content-Type: application/json" \
  -d '{
    "elementId": "YOUR_ELEMENT_ID",
    "cuts": [
      { "start": 2.0, "end": 3.0 },
      { "start": 8.0, "end": 9.5 }
    ]
  }'
```

**What to verify**:
- Timeline visually shows the element split with gaps removed
- `cutsApplied` matches the number of cuts sent
- `remainingElements` lists the surviving pieces with correct `startTime` and `duration`
- **Ctrl+Z undoes all cuts at once** (single history snapshot)
- Try with overlapping or adjacent cuts — should be rejected with a 400 error

### 4. Range Delete (modifies timeline — use Ctrl+Z to undo)

Delete all content within a time range across tracks.

```bash
curl -X DELETE http://127.0.0.1:8765/api/claude/timeline/{projectId}/range \
  -H "Content-Type: application/json" \
  -d '{
    "startTime": 5.0,
    "endTime": 10.0
  }'
```

**What to verify**:
- Elements fully within 5.0–10.0s are deleted
- Elements partially overlapping are trimmed (split at the boundary)
- `elementsDeleted` and `elementsSplit` counts are correct
- **Ctrl+Z undoes the entire range delete**
- Try with `"trackIds": ["track_id"]` to limit to a specific track

### 5. Auto-Edit — Full Execution (modifies timeline)

Actually remove fillers and silences. Run the dry run first (step 2) to preview.

```bash
curl -X POST http://127.0.0.1:8765/api/claude/timeline/{projectId}/auto-edit \
  -H "Content-Type: application/json" \
  -d '{
    "elementId": "YOUR_ELEMENT_ID",
    "mediaId": "YOUR_MEDIA_ID",
    "removeFillers": true,
    "removeSilences": true,
    "dryRun": false
  }'
```

**What to verify**:
- `applied` is `true`
- `result` contains `cutsApplied` and `totalRemovedDuration`
- Timeline shows fillers and silences removed
- Playback sounds tighter without filler words
- **Ctrl+Z undoes the entire auto-edit**

### Finding Element and Media IDs

If you don't know the IDs, use the timeline and media endpoints:

```bash
# Get timeline (shows all elements with IDs)
curl http://127.0.0.1:8765/api/claude/timeline/{projectId}

# Get media list (shows all imported media with IDs)
curl http://127.0.0.1:8765/api/claude/media/{projectId}
```

### Error Cases to Test

| Scenario | Expected |
|----------|----------|
| Missing `mediaId` | 400: "Missing 'mediaId'" |
| Missing `elementId` on cuts | 400: "Missing 'elementId' and 'cuts'" |
| Empty cuts array | 400 from validation |
| Overlapping cut intervals | 400: "Overlapping cut intervals" |
| `start >= end` on a cut | 400: "start must be less than end" |
| Non-existent element ID | Timeout (504) — element not found in renderer |
| No QCut window open | 503: "No active QCut window" |

### Automated Tests

All Stage 3 handlers have unit tests. Run them with:

```bash
# All Stage 3 tests (50 tests)
bun run test -- electron/__tests__/claude-cuts-handler.test.ts \
  electron/__tests__/claude-range-handler.test.ts \
  electron/__tests__/claude-auto-edit-handler.test.ts \
  electron/__tests__/claude-suggest-handler.test.ts

# Timeline bridge tests (6 tests)
bun run test -- src/lib/__tests__/claude-timeline-bridge.test.ts

# Full suite
bun run test
```
