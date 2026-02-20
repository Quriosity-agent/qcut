# Retest Checklist — Fixes Not Yet Verified Live

> All items below had code fixes applied but have **not been retested** against a running QCut instance.
> Requires: `bun run electron:dev` then test against `http://127.0.0.1:8765`

---

## Prerequisites

```bash
# 1. Rebuild and start QCut (required — async routes + fixes not in old instance)
bun run electron:dev

# 2. Set variables
PROJECT_ID="<your-project-id>"
MEDIA_ID="<9.5min-video-media-id>"
ELEMENT_ID="<element-on-timeline>"
```

---

## Stage 2: Async Transcription (was: 30s HTTP timeout)

**Original failure**: `POST /transcribe/:pid` on 9.5min audio returned empty response (30s timeout).
**Fix applied**: Async job routes added in `claude-http-analysis-routes.ts`.

```bash
# Test 2.1 — Start async transcription
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"mediaId\":\"$MEDIA_ID\"}" \
  http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/start | jq
# Expected: { success: true, data: { jobId: "transcribe_..." } }

# Test 2.2 — Poll until completed
JOB_ID="<from above>"
curl -s http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/jobs/$JOB_ID | jq
# Expected: status goes queued → running → completed, result has words/segments

# Test 2.3 — List jobs
curl -s http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/jobs | jq
# Expected: array with at least 1 job

# Test 2.4 — Cancel job (start a new one first)
curl -s -X POST http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/jobs/$JOB_ID/cancel | jq
# Expected: { success: true }
```

---

## Stage 2: Async Scene Detection (was: 30s HTTP timeout)

**Original failure**: `POST /analyze/:pid/scenes` on 9.5min video returned empty response (30s timeout).
**Fix applied**: Async job routes added. Also noted: scene detection async "not yet implemented (only transcription has async)" — verify this is now present.

```bash
# Test 2.5 — Start async scene detection
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"mediaId\":\"$MEDIA_ID\",\"threshold\":0.3}" \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/scenes/start | jq
# Expected: { success: true, data: { jobId: "..." } }

# Test 2.6 — Poll until completed
curl -s http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/scenes/jobs/$JOB_ID | jq
# Expected: status → completed, result has scenes array
```

---

## Stage 2: Frame Analysis Provider Cascade (was: "Anthropic API key not configured")

**Original failure**: `POST /analyze/:pid/frames` returned "Anthropic API key not configured".
**Fix applied**: Provider cascade — Claude CLI → OpenRouter → Anthropic API.

```bash
# Test 2.7 — Frame analysis without Anthropic key configured
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"mediaId\":\"$MEDIA_ID\",\"timestamps\":[0,5]}" \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/frames | jq
# Expected: success with frame descriptions (NOT "Anthropic API key not configured")

# Test 2.8 — Async frame analysis on long video
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"mediaId\":\"$MEDIA_ID\",\"timestamps\":[0,30,60]}" \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/frames/start | jq
# Expected: { success: true, data: { jobId: "..." } }
```

---

## Stage 2: AICP `describe` Missing Module

**Original failure**: `aicp analyze-video` with `describe` type fails — missing `google-generativeai` in binary.
**Fix status**: NOT fixed — needs addition to `packages/video-agent-skill/aicp.spec` hiddenimports + rebuild.

```bash
# Test 2.9 — AICP describe analysis (expected to still fail until binary rebuilt)
# Run from terminal with AICP binary:
resources/bin/aicp analyze-video -i /path/to/video.mp4 -t describe
# Expected after fix: markdown description output
```

---

## Stage 3: Async Suggest-Cuts (was: 30s HTTP timeout)

**Original failure**: `POST /analyze/:pid/suggest-cuts` on 9.5min video timed out.
**Fix applied**: Async job routes added in `claude-http-analysis-routes.ts`.

```bash
# Test 3.1 — Start async suggest-cuts
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"mediaId\":\"$MEDIA_ID\",\"includeFillers\":true,\"includeSilences\":true,\"includeScenes\":true}" \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts/start | jq
# Expected: { success: true, data: { jobId: "..." } }

# Test 3.2 — Poll until completed
curl -s http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts/jobs/$JOB_ID | jq
# Expected: status → completed, result has suggestions array + summary
```

---

## Stage 3: Async Auto-Edit (was: 30s HTTP timeout)

**Original failure**: `POST /timeline/:pid/auto-edit` on 9.5min video timed out.
**Fix applied**: Async job routes added.

```bash
# Test 3.3 — Start async auto-edit (dry run)
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"elementId\":\"$ELEMENT_ID\",\"mediaId\":\"$MEDIA_ID\",\"removeFillers\":true,\"removeSilences\":true,\"dryRun\":true}" \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit/start | jq
# Expected: { success: true, data: { jobId: "..." } }

# Test 3.4 — Poll until completed
curl -s http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit/jobs/$JOB_ID | jq
# Expected: status → completed, result.applied = false, result.cuts array populated
```

---

## Stage 4: Range Delete Ripple (was: elements not shifted left)

**Original failure**: `DELETE /timeline/:pid/range` with `crossTrackRipple=true` — split/delete worked but elements not shifted.
**Fix applied**: Replaced inline logic with `deleteTimeRange()` store method (commit `38a75719`).

```bash
# Setup: ensure timeline has multiple elements across 2+ tracks

# Test 4.1 — Range delete with same-track ripple
curl -s -X DELETE -H "Content-Type: application/json" \
  -d '{"startTime":5,"endTime":10,"ripple":true,"crossTrackRipple":false}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/range | jq
# Expected: elements after 10s shift left by 5s on affected tracks ONLY
# Verify: export timeline, check startTimes of elements after the deleted range

# Test 4.2 — Range delete with cross-track ripple
curl -s -X DELETE -H "Content-Type: application/json" \
  -d '{"startTime":5,"endTime":10,"ripple":true,"crossTrackRipple":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/range | jq
# Expected: ALL tracks shift elements left by 5s after the deleted range
# Verify: export timeline, check text track elements also shifted
```

---

## Stage 4: Malformed Markdown Import (was: silent success)

**Original failure**: Importing `"# Not a timeline"` returned `imported: true`.
**Fix applied**: `markdownToTimeline()` throws when no tracks/elements found; HTTP returns 400 (commit `ebb92761`).

```bash
# Test 4.3 — Malformed markdown import
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"data":"# Not a real timeline\nJust some random text","format":"md"}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/import | jq
# Expected: { success: false, error: "..." } with 400 status
```

---

## Stage 4: Markdown Import Replace Mode

**Fix applied**: Added `replace: true` flag (commit `ebb92761`).

```bash
# Test 4.4 — Import with replace mode
# First export current timeline
TIMELINE=$(curl -s "http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID?format=md" | jq -r '.data')

# Re-import with replace (should not duplicate)
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"data\":$(echo "$TIMELINE" | jq -Rs .),\"format\":\"md\",\"replace\":true}" \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/import | jq
# Expected: imported=true, element count stays same (not doubled)
```

---

## Stage 5: Export Start (was: "No video segments found")

**Original failure**: `collectExportSegments()` matched `element.sourceId === mediaFile.id` but they use different ID systems.
**Fix applied**: 4-level fallback matching: ID → filename/sourceName → base64-decoded ID → skip.

```bash
# Test 5.1 — Export with preset
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"preset":"youtube-1080p"}' \
  http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/start | jq
# Expected: { success: true, data: { jobId: "..." } } (NOT "No video segments found")

# Test 5.2 — Export with custom settings
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"settings":{"width":1920,"height":1080,"fps":30,"format":"mp4"}}' \
  http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/start | jq
# Expected: same — job created successfully

# Test 5.3 — Poll export job progress
curl -s http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/jobs/$JOB_ID | jq
# Expected: status progresses queued → exporting → completed, outputPath populated
```

---

## Stage 5: Project Summary Error Handling (was: 500 for nonexistent project)

**Original failure**: `GET /project/nonexistent/summary` returned 500 instead of 400.
**Fix applied**: Error handler detects `"Failed to read project"` and returns 400.

```bash
# Test 5.4 — Nonexistent project summary
curl -s -o /dev/null -w "%{http_code}" \
  http://127.0.0.1:8765/api/claude/project/nonexistent_project_xyz/summary
# Expected: 400 (not 500)
```

---

## Stage 5: Report Save Error Handling (was: silent ENOENT success)

**Original failure**: `POST /project/:pid/report` with invalid `saveTo` returned `success: true`.
**Fix applied**: `writeFile` errors now propagate as HTTP errors.

```bash
# Test 5.5 — Report save to invalid path
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"saveTo":"/nonexistent/directory/that/doesnt/exist/"}' \
  http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/report | jq
# Expected: { success: false, error: "..." } (not success: true)
```

---

## Summary

| # | Test | Stage | What Failed | Fix Type |
|---|------|-------|-------------|----------|
| 2.1-2.4 | Async transcription | 2 | 30s HTTP timeout | Async job routes |
| 2.5-2.6 | Async scene detection | 2 | 30s HTTP timeout | Async job routes |
| 2.7-2.8 | Frame analysis provider | 2 | No Anthropic key | Provider cascade |
| 2.9 | AICP describe | 2 | Missing module | **NOT FIXED** — needs binary rebuild |
| 3.1-3.2 | Async suggest-cuts | 3 | 30s HTTP timeout | Async job routes |
| 3.3-3.4 | Async auto-edit | 3 | 30s HTTP timeout | Async job routes |
| 4.1-4.2 | Range delete ripple | 4 | Elements not shifted | `deleteTimeRange()` store method |
| 4.3 | Malformed markdown | 4 | Silent success | Throws + returns 400 |
| 4.4 | Import replace mode | 4 | No replace option | `replace: true` flag |
| 5.1-5.3 | Export start | 5 | sourceId mismatch | 4-level fallback matching |
| 5.4 | Summary error code | 5 | 500 instead of 400 | Error detection |
| 5.5 | Report save error | 5 | Silent ENOENT | Error propagation |

**Total: 17 tests across 12 fixes to verify.**
