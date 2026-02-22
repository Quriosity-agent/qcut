# Editor CLI Phase 2: Timeline + Editing Commands

> **Date:** 2026-02-22
> **Goal:** Implement `editor:timeline:*` (14 commands) and `editor:editing:*` (7 commands) wrapping 25 HTTP endpoints for live timeline manipulation.
> **Reference:** [editor-cli-overview.md](editor-cli-overview.md), `electron/claude/claude-timeline-handler.ts`, `electron/claude/claude-cuts-handler.ts`, `electron/claude/claude-range-handler.ts`, `electron/claude/claude-auto-edit-handler.ts`, `electron/claude/claude-suggest-handler.ts`
> **Status:** Not started
> **Depends on:** Phase 1 (Subtasks 1.1-1.3)

---

## Subtask 2.1: Implement Timeline Read/Export Commands

**Time:** ~20 min
**Files:**
- `electron/native-pipeline/editor-handlers-timeline.ts` (create, ~350 lines)

**Changes:**

### editor:timeline:export
```
GET /api/claude/timeline/:projectId?format=json|md
```
**Required:** `--project-id`
**Optional:** `--format` (default: json; supports `md` for markdown)
**Output:** In `--json` mode, prints JSON. In TTY mode with `--format md`, prints raw markdown directly.

### editor:timeline:import
```
POST /api/claude/timeline/:projectId/import
Body: { data: <string|object>, format?: "json"|"md", replace?: boolean }
```
**Required:** `--project-id`, `--data` (JSON/markdown string, `@file`, or `-` for stdin)
**Optional:** `--format` (auto-detected if omitted), `--replace` (clear timeline first)

### editor:timeline:get-selection
```
GET /api/claude/timeline/:projectId/selection
```
**Required:** `--project-id`

### editor:timeline:clear-selection
```
DELETE /api/claude/timeline/:projectId/selection
```
**Required:** `--project-id`

---

## Subtask 2.2: Implement Timeline Element CRUD Commands

**Time:** ~30 min
**Files:**
- `electron/native-pipeline/editor-handlers-timeline.ts` (extend)

**Changes:**

### editor:timeline:add-element
```
POST /api/claude/timeline/:projectId/elements
Body: { type, trackIndex?, trackId?, startTime?, endTime?, duration?, sourceName?, ... }
```
**Required:** `--project-id`, `--data` (JSON element definition)
**Output:** `{ elementId: <id> }`

### editor:timeline:batch-add
```
POST /api/claude/timeline/:projectId/elements/batch
Body: { elements: [...] }
```
**Required:** `--project-id`, `--elements` (JSON array, `@file`, or `-`)
**Validation:** Max 50 elements (client-side check)

### editor:timeline:update-element
```
PATCH /api/claude/timeline/:projectId/elements/:elementId
Body: { changes: {...} }
```
**Required:** `--project-id`, `--element-id`, `--changes` (JSON object)

### editor:timeline:batch-update
```
PATCH /api/claude/timeline/:projectId/elements/batch
Body: { updates: [{elementId, trackId, changes}...] }
```
**Required:** `--project-id`, `--updates` (JSON array)
**Validation:** Max 50 updates

### editor:timeline:delete-element
```
DELETE /api/claude/timeline/:projectId/elements/:elementId
```
**Required:** `--project-id`, `--element-id`

### editor:timeline:batch-delete
```
DELETE /api/claude/timeline/:projectId/elements/batch
Body: { elements: [{trackId, elementId}...], ripple?: boolean }
```
**Required:** `--project-id`, `--elements` (JSON array)
**Optional:** `--ripple`
**Validation:** Max 50 elements

**Handler pattern for JSON input:**
```typescript
async function handleTimelineBatchAdd(
  client: EditorApiClient,
  options: CLIRunOptions
): Promise<CLIResult> {
  if (!options.projectId) return { success: false, error: "Missing --project-id" };
  if (!options.elements) return { success: false, error: "Missing --elements (JSON array or @file.json)" };

  const elements = await resolveJsonInput(options.elements);
  if (!Array.isArray(elements)) return { success: false, error: "--elements must be a JSON array" };
  if (elements.length > 50) return { success: false, error: "Batch limit: 50 elements" };

  const data = await client.post(
    `/api/claude/timeline/${options.projectId}/elements/batch`,
    { elements }
  );
  return { success: true, data };
}
```

---

## Subtask 2.3: Implement Timeline Manipulation Commands

**Time:** ~25 min
**Files:**
- `electron/native-pipeline/editor-handlers-timeline.ts` (extend)

**Changes:**

### editor:timeline:split
```
POST /api/claude/timeline/:projectId/elements/:elementId/split
Body: { splitTime: <number>, mode?: "split"|"keepLeft"|"keepRight" }
```
**Required:** `--project-id`, `--element-id`, `--split-time`
**Optional:** `--mode` (default: `split`)
**Validation:** `--split-time` must be a valid number

### editor:timeline:move
```
POST /api/claude/timeline/:projectId/elements/:elementId/move
Body: { toTrackId: <id>, newStartTime?: <number> }
```
**Required:** `--project-id`, `--element-id`, `--to-track`
**Optional:** `--start-time`

### editor:timeline:arrange
```
POST /api/claude/timeline/:projectId/arrange
Body: { trackId: <id>, mode: "sequential"|"spaced"|"manual", gap?: <number>, order?: <string[]>, startOffset?: <number> }
```
**Required:** `--project-id`, `--track-id`, `--mode`
**Optional:** `--gap` (for `spaced` mode), `--data` (for `manual` mode — JSON with `order` array)

### editor:timeline:select
```
POST /api/claude/timeline/:projectId/selection
Body: { elements: [{trackId, elementId}...] }
```
**Required:** `--project-id`, `--elements` (JSON array of `{trackId, elementId}`)

---

## Subtask 2.4: Implement Editing Commands — Cuts & Range

**Time:** ~20 min
**Files:**
- `electron/native-pipeline/editor-handlers-timeline.ts` (extend)

**Changes:**

### editor:editing:batch-cuts
```
POST /api/claude/timeline/:projectId/cuts
Body: { elementId: <id>, cuts: [{start, end}...], ripple?: boolean }
```
**Required:** `--project-id`, `--element-id`, `--cuts` (JSON array of `{start, end}`)
**Optional:** `--ripple`
**Output:** `{ cutsApplied, elementsRemoved, remainingElements, totalRemovedDuration }`

**Validation:** Server validates no overlapping intervals and `start < end`, but we can pre-validate client-side for better error messages.

### editor:editing:delete-range
```
DELETE /api/claude/timeline/:projectId/range
Body: { startTime: <n>, endTime: <n>, trackIds?: <string[]>, ripple?: boolean, crossTrackRipple?: boolean }
```
**Required:** `--project-id`, `--start-time`, `--end-time`
**Optional:** `--track-id` (comma-separated for multiple), `--ripple`, `--cross-track-ripple`
**Validation:** `--start-time < --end-time`

**Note:** The `--track-id` flag handles comma-separated values → split into array for the `trackIds` body param.

---

## Subtask 2.5: Implement Editing Commands — Auto-Edit

**Time:** ~25 min
**Files:**
- `electron/native-pipeline/editor-handlers-timeline.ts` (extend)

**Changes:**

### editor:editing:auto-edit
```
# Sync (default)
POST /api/claude/timeline/:projectId/auto-edit
Body: { elementId, mediaId, removeFillers?, removeSilences?, silenceThreshold?, keepSilencePadding?, dryRun?, provider?, language? }

# Async (with --poll)
POST /api/claude/timeline/:projectId/auto-edit/start
→ then polls /api/claude/timeline/:projectId/auto-edit/jobs/:jobId
```
**Required:** `--project-id`, `--element-id`, `--media-id`
**Optional:** `--remove-fillers`, `--remove-silences`, `--dry-run`, `--poll`, `--language`, `--provider`
**Behavior:**
- Without `--poll`: sends sync POST, returns result directly (may timeout for long videos)
- With `--poll`: sends async POST to `/start`, then polls job status until complete

### editor:editing:auto-edit-status
```
GET /api/claude/timeline/:projectId/auto-edit/jobs/:jobId
```
**Required:** `--project-id`, `--job-id`

### editor:editing:auto-edit-list
```
GET /api/claude/timeline/:projectId/auto-edit/jobs
```
**Required:** `--project-id`

---

## Subtask 2.6: Implement Editing Commands — Suggest Cuts

**Time:** ~20 min
**Files:**
- `electron/native-pipeline/editor-handlers-timeline.ts` (extend)

**Changes:**

### editor:editing:suggest-cuts
```
# Sync (default)
POST /api/claude/analyze/:projectId/suggest-cuts
Body: { mediaId, provider?, language?, sceneThreshold?, includeFillers?, includeSilences?, includeScenes? }

# Async (with --poll)
POST /api/claude/analyze/:projectId/suggest-cuts/start
→ then polls /api/claude/analyze/:projectId/suggest-cuts/jobs/:jobId
```
**Required:** `--project-id`, `--media-id`
**Optional:** `--poll`, `--threshold`, `--include-fillers`, `--include-silences`, `--include-scenes`, `--provider`, `--language`

**Note:** Suggest-cuts is under `/analyze/` on the server, but lives in `editor:editing:` on the CLI since it's conceptually an editing operation.

### editor:editing:suggest-status
```
GET /api/claude/analyze/:projectId/suggest-cuts/jobs/:jobId
```
**Required:** `--project-id`, `--job-id`

---

## Subtask 2.7: Unit Tests for Phase 2

**Time:** ~30 min
**Files:**
- `electron/native-pipeline/__tests__/editor-handlers.test.ts` (create or extend, ~150 lines for timeline)

**Changes:**

**Test cases:**

1. **Timeline export/import**
   - Export calls correct endpoint with format query param
   - Import resolves JSON input from `@file.json`
   - Import with `--replace` sends `replace: true` in body

2. **Element CRUD**
   - `add-element` requires `--project-id` and `--data`
   - `batch-add` rejects >50 elements
   - `batch-delete` includes `--ripple` flag in body
   - `update-element` sends changes as JSON body

3. **Manipulation**
   - `split` validates `--split-time` is a number
   - `move` constructs correct endpoint with element-id path param
   - `arrange` validates `--mode` against allowed values

4. **Editing**
   - `batch-cuts` sends cuts array in body
   - `delete-range` validates start < end
   - `auto-edit` without `--poll` sends sync POST
   - `auto-edit` with `--poll` sends async POST + polls
   - `suggest-cuts` maps to `/analyze/` endpoint (not `/timeline/`)

---

## Files Impact Summary

| File | Action | Lines |
|------|--------|-------|
| `electron/native-pipeline/editor-handlers-timeline.ts` | Create | ~350 |
| `electron/native-pipeline/__tests__/editor-handlers.test.ts` | Create/extend | ~150 |
| **Total** | | **~500** |

## API Endpoint Coverage

| Command | HTTP Method | Endpoint |
|---------|-------------|----------|
| `editor:timeline:export` | GET | `/api/claude/timeline/:projectId` |
| `editor:timeline:import` | POST | `/api/claude/timeline/:projectId/import` |
| `editor:timeline:add-element` | POST | `/api/claude/timeline/:projectId/elements` |
| `editor:timeline:batch-add` | POST | `/api/claude/timeline/:projectId/elements/batch` |
| `editor:timeline:update-element` | PATCH | `/api/claude/timeline/:projectId/elements/:elementId` |
| `editor:timeline:batch-update` | PATCH | `/api/claude/timeline/:projectId/elements/batch` |
| `editor:timeline:delete-element` | DELETE | `/api/claude/timeline/:projectId/elements/:elementId` |
| `editor:timeline:batch-delete` | DELETE | `/api/claude/timeline/:projectId/elements/batch` |
| `editor:timeline:split` | POST | `/api/claude/timeline/:projectId/elements/:elementId/split` |
| `editor:timeline:move` | POST | `/api/claude/timeline/:projectId/elements/:elementId/move` |
| `editor:timeline:arrange` | POST | `/api/claude/timeline/:projectId/arrange` |
| `editor:timeline:select` | POST | `/api/claude/timeline/:projectId/selection` |
| `editor:timeline:get-selection` | GET | `/api/claude/timeline/:projectId/selection` |
| `editor:timeline:clear-selection` | DELETE | `/api/claude/timeline/:projectId/selection` |
| `editor:editing:batch-cuts` | POST | `/api/claude/timeline/:projectId/cuts` |
| `editor:editing:delete-range` | DELETE | `/api/claude/timeline/:projectId/range` |
| `editor:editing:auto-edit` | POST | `/api/claude/timeline/:projectId/auto-edit` or `/auto-edit/start` |
| `editor:editing:auto-edit-status` | GET | `/api/claude/timeline/:projectId/auto-edit/jobs/:jobId` |
| `editor:editing:auto-edit-list` | GET | `/api/claude/timeline/:projectId/auto-edit/jobs` |
| `editor:editing:suggest-cuts` | POST | `/api/claude/analyze/:projectId/suggest-cuts` or `/suggest-cuts/start` |
| `editor:editing:suggest-status` | GET | `/api/claude/analyze/:projectId/suggest-cuts/jobs/:jobId` |
