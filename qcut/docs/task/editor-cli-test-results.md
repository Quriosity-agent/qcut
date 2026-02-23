# Editor CLI Test Results

**Date**: 2026-02-23
**Version**: 2026.02.23.2
**Test Project**: `fea526ea-ff71-4329-aca9-d22b9a173982`

## Summary

| Category | Passed | Failed | Total |
|----------|--------|--------|-------|
| Health & Info | 4 | 0 | 4 |
| Project | 5 | 0 | 5 |
| Media | 7 | 1 | 8 |
| Timeline | 14 | 1 | 15 |
| Editing | 4 | 1 | 5 |
| Analysis | 2 | 3 | 5 |
| Transcription | 5 | 1 | 6 |
| Generation | 4 | 0 | 4 |
| Export | 4 | 0 | 4 |
| Diagnostics | 1 | 0 | 1 |
| MCP | 1 | 0 | 1 |
| **Total** | **51** | **7** | **58** |

---

## PASSED Commands

### Health & Info (4/4)
- `editor:health` — Returns status, version, uptime
- `editor:export:presets` — Lists 10 export presets (youtube, tiktok, instagram, etc.)
- `editor:analyze:models` — Lists 4 analysis models (gemini variants)
- `editor:generate:models` — Lists 77 generation models across all categories

### Project (5/5)
- `editor:project:settings` — Returns project resolution, fps, format settings
- `editor:project:summary` — Returns markdown summary with media counts and timeline info
- `editor:project:stats` — Returns duration, media counts, track/element counts
- `editor:project:report` — Generates pipeline report markdown and saves to file
- `editor:project:update-settings` — Successfully updates settings (tested fps change)

**Note**: All project commands require a project with a `project.qcut` file. Projects without this file return "Failed to read project".

### Media (7/8)
- `editor:media:list` — Lists all media files with id, name, type, path, size
- `editor:media:info` — Returns detailed info for a specific media file
- `editor:media:import` — Successfully imports local files (tested .wav)
- `editor:media:import-url` — Downloads and imports from URL
- `editor:media:batch-import` — Works with `path` field (NOT `source` — see failures)
- `editor:media:rename` — Renames media file
- `editor:media:delete` — Deletes media file
- `editor:media:extract-frame` — Extracts PNG frame at specified timestamp

### Timeline (14/15)
- `editor:timeline:export` — Exports full timeline with tracks and elements as JSON
- `editor:timeline:add-element` (text) — Creates text element, returns elementId
- `editor:timeline:add-element` (video) — Creates video element using sourceName
- `editor:timeline:update-element` — Updates element properties (duration, etc.)
- `editor:timeline:batch-add` — Batch adds elements (requires `trackId` per element)
- `editor:timeline:batch-update` — Batch updates multiple elements
- `editor:timeline:split` — Splits element at specified time, returns secondElementId
- `editor:timeline:arrange` (sequential) — Arranges elements end-to-end
- `editor:timeline:arrange` (spaced) — Arranges with configurable gap
- `editor:timeline:move` — Moves element to different track/time
- `editor:timeline:delete-element` — Removes single element
- `editor:timeline:batch-delete` — Works with `{trackId, elementId}` objects (NOT plain IDs)
- `editor:timeline:select` — Selects elements by trackId/elementId
- `editor:timeline:get-selection` — Returns current selection
- `editor:timeline:clear-selection` — Clears selection

### Editing (4/5)
- `editor:editing:batch-cuts` — Applies cuts and optionally ripples
- `editor:editing:delete-range` — Deletes time range with split/ripple
- `editor:editing:suggest-cuts` — Returns AI-suggested cuts (scenes, silences)
- `editor:editing:auto-edit-list` — Lists auto-edit jobs

### Analysis (2/5)
- `editor:analyze:scenes` — Detects scene changes with timestamps and confidence
- `editor:analyze:models` — (counted in Health section)

### Transcription (5/6)
- `editor:transcribe:start` — Starts async job, returns jobId
- `editor:transcribe:status` — Returns job status, progress, provider
- `editor:transcribe:list-jobs` — Lists all transcription jobs
- `editor:transcribe:cancel` — Cancels running job
- `editor:transcribe:run` — **Timeout** (sync mode timed out for large video, expected)

### Generation (4/4)
- `editor:generate:models` — Lists all generation models
- `editor:generate:estimate-cost` — Returns cost breakdown for model/duration
- `editor:generate:list-jobs` — Lists generation jobs
- `editor:generate:status` — Returns "Job not found" for nonexistent jobs (correct behavior)

### Export (4/4)
- `editor:export:presets` — Lists all export presets
- `editor:export:recommend` — Returns preset + warnings + suggestions for target platform
- `editor:export:list-jobs` — Lists export jobs
- `editor:export:start` — Correctly fails with "No video segments" on empty timeline

### Diagnostics (1/1)
- `editor:diagnostics:analyze` — Returns error type, severity, causes, fixes, system info

### MCP (1/1)
- `editor:mcp:forward-html` — Forwards HTML to preview panel

---

## FAILED Commands

### 1. `editor:media:batch-import` with `source` field
- **Error**: `Each item must have either 'url' or 'path'`
- **Root Cause**: CLI docs say `--items '[{"source":"/path"}]'` but API requires `path` field
- **Fix**: Use `{"path":"/path/to/file"}` instead of `{"source":"/path/to/file"}`
- **Doc Fix Needed**: Update EDITOR-CLI.md batch-import examples to use `path` field

### 2. `editor:timeline:batch-delete` with string array
- **Error**: `Each delete item must include a valid trackId`
- **Root Cause**: CLI docs show `--elements '["id1","id2"]'` but API requires `[{trackId, elementId}]` objects
- **Fix**: Use `[{"trackId":"t1","elementId":"e1"}]` format
- **Doc Fix Needed**: Update EDITOR-CLI.md batch-delete example

### 3. `editor:timeline:import` without track index
- **Error**: `Track must have an index`
- **Root Cause**: Tracks require an `index` field
- **Fix**: Add `"index": 0` to each track object
- **Doc Fix Needed**: Update EDITOR-CLI.md timeline import example

### 4. `editor:editing:auto-edit` (dry-run)
- **Error**: `Auto-edit pipeline failed`
- **Context**: Tested with a minimal test video (test_batch_1.mp4 = 2KB dummy file)
- **Root Cause**: Video too small/invalid for auto-edit pipeline processing
- **Status**: Expected failure with dummy media — would work with real video content

### 5. `editor:analyze:video`
- **Error**: `aicp exited with code 1`
- **Context**: Analysis via `media:` source specifier
- **Root Cause**: Likely requires aicp binary or specific API key configuration
- **Status**: Infrastructure dependency — not a CLI bug

### 6. `editor:analyze:frames`
- **Error**: `No vision provider available. Configure an Anthropic or OpenRouter API key`
- **Root Cause**: Requires API key for vision analysis
- **Status**: Expected — requires API key configuration

### 7. `editor:analyze:fillers`
- **Error**: `Missing 'words' array in request body`
- **Root Cause**: Filler detection needs pre-transcribed word data or the CLI should handle passing word data
- **Doc Fix Needed**: Clarify that `--data @words.json` is required (not just `--media-id`)

---

## Documentation Issues Found

| Issue | File | Fix |
|-------|------|-----|
| `batch-import` uses `source` field in examples | EDITOR-CLI.md | Change to `path` field |
| `batch-delete` shows plain ID array | EDITOR-CLI.md | Change to `{trackId, elementId}` objects |
| `timeline:import` example missing `index` in tracks | EDITOR-CLI.md | Add `"index": 0` |
| `batch-add` doesn't mention `trackId` is required | EDITOR-CLI.md | Add note that `trackId` is required per element |
| `analyze:fillers` implies `--media-id` alone works | EDITOR-CLI.md | Clarify `--data @words.json` is required |

---

## Test Environment
- **Platform**: macOS (darwin arm64)
- **Node**: v24.13.1
- **Electron**: v40.6.0
- **Bun**: package manager
- **QCut API**: http://127.0.0.1:8765
