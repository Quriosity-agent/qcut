# Editor CLI Fix Plan

**Date**: 2026-02-23
**Branch**: `claude-cli-v4`
**Based on**: [editor-cli-test-results.md](editor-cli-test-results.md)
**Estimated time**: ~15 minutes (5 subtasks, all localized)

---

## Overview

7 failures found during live CLI testing. 5 require code fixes (3 CLI-side, 1 API-side, 1 combined). 2 are expected (missing API keys). All fixes are localized — no architectural changes needed.

---

## Subtask 1: Normalize `source` → `path` in batch-import CLI handler

**Priority**: High
**Files**:
- `electron/native-pipeline/editor-handlers-media.ts` (lines 158-189)
- `.claude/skills/native-cli/EDITOR-CLI.md` (batch-import section)

**Problem**: `editor:media:batch-import` accepts `--items '[{"source":"/path"}]'` but the API requires `{"path":"/file"}` or `{"url":"..."}`. Single import uses `--source`, creating user confusion.

**Fix**: In `mediaBatchImport()`, normalize items before sending to API:
```typescript
const normalizedItems = items.map(item => {
  if (item.source && !item.path && !item.url) {
    return { ...item, path: item.source, source: undefined };
  }
  return item;
});
```

**Doc update**: Update EDITOR-CLI.md examples to use `path` field, add note that `source` is also accepted.

**Test**: `bun run pipeline editor:media:batch-import --project-id <id> --items '[{"source":"/tmp/test.mp4"}]'`

---

## Subtask 2: Support plain ID array in batch-delete CLI handler

**Priority**: High
**Files**:
- `electron/native-pipeline/editor-handlers-timeline.ts` (lines 286-317)
- `.claude/skills/native-cli/EDITOR-CLI.md` (batch-delete section)

**Problem**: `editor:timeline:batch-delete --elements '["id1","id2"]'` fails with "Each delete item must include a valid trackId". API requires `[{trackId, elementId}]` objects.

**Fix**: In `timelineBatchDelete()`, auto-resolve plain string IDs by looking up trackId from timeline export:
```typescript
// If elements are plain strings, resolve their trackId from current timeline
if (elements.length > 0 && typeof elements[0] === 'string') {
  const timeline = await client.get(`/api/claude/timeline/${opts.projectId}`);
  const resolvedElements = elements.map(id => {
    for (const track of timeline.tracks) {
      if (track.elements.some(e => e.id === id)) {
        return { trackId: track.id, elementId: id };
      }
    }
    return { trackId: '', elementId: id }; // will fail at API with clear error
  });
  elements = resolvedElements;
}
```

**Doc update**: Update EDITOR-CLI.md to show both formats are accepted, recommend `{trackId, elementId}` for efficiency.

**Test**: `bun run pipeline editor:timeline:batch-delete --project-id <id> --elements '["elem-id"]' --ripple`

---

## Subtask 3: Auto-assign track index in timeline import

**Priority**: Medium
**Files**:
- `electron/claude/claude-timeline-handler.ts` (lines 400-428, `validateTimeline`)
- `.claude/skills/native-cli/EDITOR-CLI.md` (timeline import section)

**Problem**: `editor:timeline:import --data '{"tracks":[{"id":"t1","type":"video","elements":[]}]}'` fails with "Track must have an index". The markdown parser already auto-assigns indices, but JSON import doesn't.

**Fix**: In `validateTimeline()`, auto-assign indices when missing (same pattern as markdown parser):
```typescript
for (let i = 0; i < timeline.tracks.length; i++) {
  const track = timeline.tracks[i];
  if (typeof track.index !== "number") {
    track.index = i;
  }
}
```

**Doc update**: Note that `index` is optional and auto-assigned if omitted.

**Test**: `bun run pipeline editor:timeline:import --project-id <id> --data '{"name":"Test","tracks":[{"id":"t1","type":"video","elements":[]}]}' --replace`

---

## Subtask 4: Add trackId requirement note to batch-add docs + CLI validation

**Priority**: Medium
**Files**:
- `electron/native-pipeline/editor-handlers-timeline.ts` (lines 189-217, `timelineBatchAdd`)
- `.claude/skills/native-cli/EDITOR-CLI.md` (batch-add section)

**Problem**: `editor:timeline:batch-add` requires `trackId` per element but docs don't mention it. The error "Each element must include a valid trackId" comes from the API with no CLI-side guidance.

**Fix**: Add early validation in CLI handler with a helpful error message:
```typescript
for (const element of elements) {
  if (!element.trackId) {
    return { success: false, error:
      "Each element must include 'trackId'. Use editor:timeline:export to find track IDs." };
  }
}
```

**Doc update**: Add `trackId` to batch-add example and add note about the requirement.

**Test**: `bun run pipeline editor:timeline:batch-add --project-id <id> --elements '[{"type":"text","content":"Hi","startTime":0,"duration":2,"trackId":"<track-id>"}]'`

---

## Subtask 5: Support `--media-id` only mode for filler detection

**Priority**: High
**Files**:
- `electron/claude/claude-http-analysis-routes.ts` (lines 202-226, filler route)
- `electron/native-pipeline/editor-handlers-analysis.ts` (lines 177-205, `analyzeFillers`)
- `.claude/skills/native-cli/EDITOR-CLI.md` (fillers section)

**Problem**: `editor:analyze:fillers --project-id <id> --media-id <id>` fails with "Missing 'words' array in request body". The API strictly requires a pre-transcribed `words` array — there's no auto-transcribe path.

**Fix (API-side)**: Modify the HTTP filler route to support two modes:

1. **Direct mode** (existing): Pass `words` array directly — fast, no extra API call
2. **Auto-transcribe mode** (new): Pass `mediaId` only — API transcribes first, then detects fillers

```typescript
router.post("/api/claude/analyze/:projectId/fillers", async (req) => {
  const projectId = req.params.projectId;

  // Mode 1: Direct words array (existing behavior)
  if (Array.isArray(req.body?.words)) {
    const result = await analyzeFillers(projectId, {
      mediaId: req.body.mediaId,
      words: req.body.words,
    });
    return result;
  }

  // Mode 2: Auto-transcribe from mediaId
  if (req.body?.mediaId) {
    const transcription = await transcribeMedia(projectId, {
      mediaId: req.body.mediaId,
      provider: req.body.provider,
      language: req.body.language,
    });
    if (!transcription?.words?.length) {
      throw new HttpError(400, "Transcription produced no words");
    }
    const result = await analyzeFillers(projectId, {
      mediaId: req.body.mediaId,
      words: transcription.words,
    });
    return result;
  }

  throw new HttpError(400, "Provide 'words' array or 'mediaId' for auto-transcription");
});
```

**Doc update**: Clarify both modes in EDITOR-CLI.md.

**Test**:
```bash
# Mode 1: with words data
bun run pipeline editor:analyze:fillers --project-id <id> --data @words.json
# Mode 2: with media-id only (auto-transcribe)
bun run pipeline editor:analyze:fillers --project-id <id> --media-id <id>
```

---

## Not Fixed (Expected Failures)

| Command | Reason | Action |
|---------|--------|--------|
| `editor:analyze:video` | Requires aicp binary setup | No fix — infrastructure dependency |
| `editor:analyze:frames` | Requires Anthropic or OpenRouter API key | No fix — add key via `bun run pipeline set-key` |
| `editor:editing:auto-edit` (dry-run) | Tested with 2KB dummy video | No fix — works with real video content |
| `editor:transcribe:run` (sync) | Timed out on large video | No fix — use async `transcribe:start --poll` instead |
| `editor:export:start` | Empty timeline, no segments | No fix — correct behavior |

---

## Implementation Order

1. **Subtask 3** (timeline import auto-index) — smallest change, API-side only
2. **Subtask 1** (batch-import normalize) — small CLI handler change
3. **Subtask 4** (batch-add validation) — small CLI handler change + docs
4. **Subtask 2** (batch-delete resolve IDs) — CLI handler + timeline lookup
5. **Subtask 5** (fillers auto-transcribe) — API route change, most complex

---

## Verification Plan

After all fixes, re-run the full test suite:
```bash
bun run build && bun run electron &
sleep 10
# Re-test each fixed command
bun run pipeline editor:media:batch-import --project-id <id> --items '[{"source":"/tmp/test.mp4"}]'
bun run pipeline editor:timeline:batch-delete --project-id <id> --elements '["elem-id"]' --ripple
bun run pipeline editor:timeline:import --project-id <id> --data '{"name":"T","tracks":[{"id":"t1","type":"video","elements":[]}]}' --replace
bun run pipeline editor:timeline:batch-add --project-id <id> --elements '[{"type":"text","content":"Hi","startTime":0,"duration":2,"trackId":"<id>"}]'
bun run pipeline editor:analyze:fillers --project-id <id> --media-id <id>
```

Target: **58/58 commands passing** (up from 51/58).

---

## Status: COMPLETE

All 5 subtasks implemented and verified on 2026-02-23:

| Subtask | Status | Result |
|---------|--------|--------|
| 1. batch-import `source` → `path` | Done | `source` accepted as alias, no 400 error |
| 2. batch-delete plain string IDs | Done | String IDs auto-resolved from timeline |
| 3. timeline import auto-index | Done | `index` auto-assigned, import succeeds |
| 4. batch-add trackId validation | Done | Clear error: "Each element must include 'trackId'" |
| 5. fillers auto-transcribe | Done | `mediaId`-only mode triggers auto-transcription |

Documentation updated in `.claude/skills/native-cli/EDITOR-CLI.md`.
