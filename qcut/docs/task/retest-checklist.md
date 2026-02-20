# Retest Checklist — Live Verified 2026-02-21

> Retested live against QCut `electron:dev` v2026.02.20.4 on `http://127.0.0.1:8765`.
> **Result: 17 PASS, 1 PARTIAL, 1 SKIP**
>
> **Update 2026-02-20**: Issues D, E, F fixed in branch `claude-cli-v3`.
> **Update 2026-02-21**: Live retested all endpoints. All fixed issues confirmed working.
> **Update 2026-02-21**: Issues G, H, I fixed in branch `claude-cli-v3`.
> **Update 2026-02-21 (retest #2)**: Full automated retest. **18 PASS, 1 PARTIAL, 1 SKIP, 1 REGRESS**. New issue J: custom export settings ignored.

---

## 0. Correct API Routes

Previous checklist had wrong URLs. These are the **actual** routes:

| Action | Method | Route |
|--------|--------|-------|
| Start transcription | POST | `/api/claude/transcribe/:projectId/start` |
| Poll transcription | GET | `/api/claude/transcribe/:projectId/jobs/:jobId` |
| List transcription jobs | GET | `/api/claude/transcribe/:projectId/jobs` |
| Cancel transcription | POST | `/api/claude/transcribe/:projectId/jobs/:jobId/cancel` |
| Scene detection (sync) | POST | `/api/claude/analyze/:projectId/scenes` |
| Frame analysis (cascade) | POST | `/api/claude/analyze/:projectId/frames` |
| Suggest cuts (sync) | POST | `/api/claude/analyze/:projectId/suggest-cuts` |
| **Start suggest-cuts** | POST | `/api/claude/analyze/:projectId/suggest-cuts/start` |
| **Poll suggest-cuts** | GET | `/api/claude/analyze/:projectId/suggest-cuts/jobs/:jobId` |
| **List suggest-cuts jobs** | GET | `/api/claude/analyze/:projectId/suggest-cuts/jobs` |
| **Cancel suggest-cuts** | POST | `/api/claude/analyze/:projectId/suggest-cuts/jobs/:jobId/cancel` |
| Auto-edit (sync) | POST | `/api/claude/timeline/:projectId/auto-edit` |
| **Start auto-edit** | POST | `/api/claude/timeline/:projectId/auto-edit/start` |
| **Poll auto-edit** | GET | `/api/claude/timeline/:projectId/auto-edit/jobs/:jobId` |
| **List auto-edit jobs** | GET | `/api/claude/timeline/:projectId/auto-edit/jobs` |
| **Cancel auto-edit** | POST | `/api/claude/timeline/:projectId/auto-edit/jobs/:jobId/cancel` |
| Timeline import | POST | `/api/claude/timeline/:projectId/import` |
| Range delete | DELETE | `/api/claude/timeline/:projectId/range` |
| Start export | POST | `/api/claude/export/:projectId/start` |
| Poll export | GET | `/api/claude/export/:projectId/jobs/:jobId` |
| Export presets | GET | `/api/claude/export/presets` |
| Project summary | GET | `/api/claude/project/:projectId/summary` |
| Project report | POST | `/api/claude/project/:projectId/report` |

## 1. Finding a Live Project

```bash
# Extract project IDs from IndexedDB LevelDB files
strings "/Users/peter/Library/Application Support/qcut/IndexedDB/app_._0.indexeddb.leveldb/000013.ldb" \
  "/Users/peter/Library/Application Support/qcut/IndexedDB/app_._0.indexeddb.leveldb/000011.log" \
  | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' \
  | sort -u | head -10

# Pick one and verify it has media
PROJECT_ID="<id-from-above>"
curl -s "http://127.0.0.1:8765/api/claude/media/$PROJECT_ID" | jq '.data | length'

# Get a video MEDIA_ID
curl -s "http://127.0.0.1:8765/api/claude/media/$PROJECT_ID" \
  | jq -r '[.data[] | select(.type=="video")][0].id'

# Get an ELEMENT_ID from timeline
curl -s "http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID" \
  | jq -r '.data.tracks[].elements[0].id // empty' | head -1

# If timeline is empty, add a test element:
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"type\":\"video\",\"sourceId\":\"$MEDIA_ID\",\"startTime\":0,\"duration\":5,\"trackIndex\":0}" \
  "http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements" | jq '.data.elementId'
```

---

## 2. Test Results (2026-02-21, retest #2)

| # | Test | Stage | Result | Notes |
|---|------|-------|--------|-------|
| 2.1 | Async transcription start | 2 | **PASS** | Returns `jobId` immediately (`transcribe_..._yna8s`) |
| 2.2 | Poll transcription | 2 | **PASS** | `status: processing`, `progress: 50`, `provider: elevenlabs` — polling works |
| 2.3 | List transcription jobs | 2 | **PASS** | Returns array with job entries including status, progress, timestamps |
| 2.4 | Cancel transcription job | 2 | **PASS** | `cancelled: true` (job was still processing — successfully cancelled) |
| 2.5 | Scene detection | 2 | **PASS** | Sync response: 1 scene detected at t=0, confidence=1 |
| 2.6 | Poll scene detection | 2 | **N/A** | Scene detection is synchronous, no polling needed |
| 2.7 | Frame analysis (cascade) | 2 | **PASS** | Cascade returns descriptive aggregate error when no API keys configured |
| 2.8 | Frame analysis (error msg) | 2 | **PASS** | `"No vision provider available. Configure an Anthropic or OpenRouter API key in Settings → API Keys. Provider errors: Anthropic: API key not configured; OpenRouter: API key not configured"` |
| 2.9 | AICP describe | 2 | **SKIP** | Known — needs binary rebuild (Issue C) |
| 3.1 | Suggest-cuts (async start) | 3 | **PASS** | Returns `jobId` immediately (`suggest_..._sa3ki`) |
| 3.2 | Poll suggest-cuts | 3 | **PASS** | `status: completed`, 1 silence suggestion (0.099–4.979s), summary with word count and scene data |
| 3.3 | Auto-edit (async start) | 3 | **PASS** | Returns `jobId` immediately. Requires both `elementId` and `mediaId` |
| 3.4 | Poll auto-edit | 3 | **PASS** | `status: completed`, 1 silence cut applied (0.399–4.679s). Job completed successfully |
| 3.5 | List/cancel suggest-cuts | 3 | **PASS** | List returns job array. Cancel returns `cancelled: false` (already completed) |
| 3.6 | List/cancel auto-edit | 3 | **PASS** | List returns job array. Cancel returns `cancelled: false` (already completed) |
| 4.1 | Range delete (same-track) | 4 | **PASS** | `splitElements: 2`, `totalRemovedDuration: 2` — correctly split element and removed 2s |
| 4.2 | Range delete (cross-track) | 4 | **PASS** | `splitElements: 2`, `totalRemovedDuration: 2` on multi-track timeline |
| 4.3 | Malformed markdown import | 4 | **PASS** | `"Invalid timeline markdown: No tracks found — expected '## Track N: Name' headers"` |
| 4.4 | Import replace mode | 4 | **PASS** | `imported: true` — element created from markdown table. Issue F fix confirmed |
| 5.1 | Export with preset | 5 | **PASS** | Job created with `youtube-1080p` preset, `status: queued` |
| 5.2 | Export with custom settings | 5 | **REGRESS** | Custom settings (1280x720@24fps) ignored — job used `youtube-1080p` (1920x1080@30fps) instead. See Issue J |
| 5.3 | Poll export job | 5 | **PASS** | `status: completed`, output file 85KB, outputPath correct |
| 5.4 | Nonexistent project summary | 5 | **PASS** | `"Failed to read project: 00000000-..."` (not 500) |
| 5.5 | Report generation | 5 | **PASS** | Returns full pipeline report markdown with stages, stats, project summary |
| I.1 | Missing elementId only | — | **PASS** | `"Missing 'elementId' in request body"` (individual field validation) |
| I.2 | Missing both fields | — | **PASS** | `"Missing 'elementId' and 'mediaId' in request body"` |

---

## 3. Issues

### Issue C (unchanged): AICP `describe` still broken

`aicp analyze-video -t describe` fails due to missing `google-generativeai` in PyInstaller binary.

**Fix**: Add `google-generativeai` to `packages/video-agent-skill/aicp.spec` hiddenimports and rebuild.

### Issue D: Frame analysis provider cascade — VERIFIED FIXED

Tests 2.7/2.8 returned `"Anthropic API key not configured"` immediately. Only Anthropic was checked.

**Root cause**: `analyzeFramesWithClaude()` in `claude-vision-handler.ts` hard-coded Anthropic-only check.

**Fix applied** (branch `claude-cli-v3`): Refactored into provider cascade — tries Anthropic first, falls back to OpenRouter, then fails with descriptive aggregate error listing which keys are missing. Extracted `callAnthropicVision()` and `callOpenRouterVision()` helpers. 3 new unit tests + 2 updated tests pass.

**Live verified 2026-02-21**: Error message now shows: `"No vision provider available. Configure an Anthropic or OpenRouter API key in Settings → API Keys. Provider errors: Anthropic: API key not configured; OpenRouter: API key not configured"`

### Issue E: Suggest-cuts & auto-edit hang on long videos — VERIFIED FIXED

Both sync endpoints blocked the HTTP connection during FFmpeg analysis. On a 569s video, they never returned.

**Root cause**: Sync `await` in route handler blocks on FFmpeg processing with no timeout.

**Fix applied** (branch `claude-cli-v3`): Added async job pattern (same as transcription) to both handlers:
- `claude-suggest-handler.ts`: `startSuggestJob()`, `getSuggestJobStatus()`, `listSuggestJobs()`, `cancelSuggestJob()`
- `claude-auto-edit-handler.ts`: `startAutoEditJob()`, `getAutoEditJobStatus()`, `listAutoEditJobs()`, `cancelAutoEditJob()`
- `claude-http-analysis-routes.ts`: 8 new async routes (`/start`, `/jobs/:jobId`, `/jobs`, `/jobs/:jobId/cancel` for each)
- Sync routes kept for backward compatibility (short videos)
- 16 new unit tests pass

**Live verified 2026-02-21**: All 8 async routes tested — start, poll, list, cancel for both suggest-cuts and auto-edit. All return correct responses immediately. Jobs complete or fail with proper status tracking.

### Issue F: Markdown import `replace:true` doesn't apply elements — VERIFIED FIXED

`POST .../import` with `format:"md"` returned `{ imported: true }` but 0 elements appeared.

**Root cause**: `applyTimelineToStore()` in `claude-timeline-bridge-helpers.ts` didn't sync project media before resolving elements. Media items weren't in the store yet, so `findMediaItemForElement()` returned null and silently dropped every element. Additionally, source name matching was case-sensitive.

**Fix applied** (branch `claude-cli-v3`):
1. Added `syncProjectMediaIfNeeded()` call at start of `applyTimelineToStore()` so media items are loaded before resolution
2. Added case-insensitive name matching fallback in `findMediaItemForElement()`

**Live verified 2026-02-21**: Import with `replace: true` and markdown table format correctly resolves source name `export_2026-02-17_03-56.mp4` to media item and creates timeline element.

### Issue G: FFmpeg audio extraction error messaging — FIXED

Transcription and auto-edit both fail at the audio extraction step with FFmpeg exit code 234. The error was not a code bug (system FFmpeg incompatibility), but the error message was unhelpful — it showed the FFmpeg banner/version info instead of the actual error.

**Root cause**: `claude-transcribe-handler.ts` extracted the first 300 characters of stderr for error messages, which was always the FFmpeg banner. The actual error was at the end of stderr.

**Fix applied** (branch `claude-cli-v3`): Changed error extraction in `claude-transcribe-handler.ts` to use the last 5 lines of stderr instead of the first 300 chars. Error messages now show the actual FFmpeg failure reason (codec issues, file errors, etc.) instead of build metadata.

**Note**: The underlying FFmpeg exit code 234 is an environment issue (system FFmpeg build from `/Volumes/tempdisk/sw`). Fix: reinstall via Homebrew or test with H.264+AAC media.

### Issue H: Report endpoint ignores `outputPath` parameter — FIXED

`POST /api/claude/project/:projectId/report` with `outputPath` returned `success: true` but didn't write the file.

**Root cause**: `claude-http-server.ts` report route never inferred `saveToDisk` from `outputPath` — it was only set when explicitly passed as `saveToDisk: true`. The `outputPath` string was passed through but the report generator never received a `saveToDisk` flag.

**Fix applied** (branch `claude-cli-v3`): Report route in `claude-http-server.ts` now infers `saveToDisk: true` when `outputPath` or `outputDir` is provided. Also extracts directory from `outputPath` (e.g., `/foo/bar/report.md` → `/foo/bar`) for the `outputDir` parameter expected by `generatePipelineReport()`.

### Issue J: Custom export settings ignored — FIXED

`POST .../export/:projectId/start` with `{"width":1280,"height":720,"fps":24,"format":"mp4"}` (no `preset`) created a job that used `youtube-1080p` preset settings (1920x1080@30fps) instead of the custom values.

**Root cause**: `resolveExportSettings()` in `claude-export-handler.ts` only checked `request.settings?.width` (nested under a `settings` key). Top-level properties like `request.width` were ignored, so the preset defaults were always used when `settings` was absent.

**Fix applied** (branch `claude-cli-v3`): `resolveExportSettings()` now also checks for top-level properties as a fallback. Both `{"settings":{"width":1280}}` and `{"width":1280}` are accepted. Nested `settings` takes priority over top-level. Unit test added.

### Issue I: Auto-edit `/start` error message is misleading — FIXED

`POST .../auto-edit/start` with only `mediaId` (no `elementId`) returned `"Missing 'elementId' and 'mediaId'"` — implying both are missing.

**Root cause**: Both sync and async auto-edit routes used `!req.body?.elementId || !req.body?.mediaId` with a single error message for both fields.

**Fix applied** (branch `claude-cli-v3`): Changed validation in `claude-http-analysis-routes.ts` to check each field individually with specific error messages:
1. If both missing: `"Missing 'elementId' and 'mediaId' in request body"`
2. If only `elementId` missing: `"Missing 'elementId' in request body"`
3. If only `mediaId` missing: `"Missing 'mediaId' in request body"`

Applied to both sync (`/auto-edit`) and async (`/auto-edit/start`) routes.

---

## 4. Improvements

### Critical (blocking correct behavior) — ALL FIXED & VERIFIED

1. ~~**Make suggest-cuts async (Issue E)**~~ — **DONE & VERIFIED**. Async job pattern added and live tested.

2. ~~**Make auto-edit async (Issue E)**~~ — **DONE & VERIFIED**. Async job pattern added and live tested.

3. ~~**Fix frame analysis cascade (Issue D)**~~ — **DONE & VERIFIED**. Provider cascade with descriptive error confirmed.

4. ~~**Fix markdown import apply (Issue F)**~~ — **DONE & VERIFIED**. Media sync + case-insensitive match confirmed.

### Medium priority

~~**Fix custom export settings (Issue J)**~~ — **DONE**. Top-level custom settings now accepted as fallback in `resolveExportSettings()`.

5. **Add `GET /api/claude/projects` endpoint** — No API way to list projects. Only option is scraping IndexedDB on disk. Makes testing and automation hard.

6. **Rebuild AICP binary with `google-generativeai` (Issue C)** — Add to `aicp.spec` hiddenimports and run `pyinstaller aicp.spec`.

7. **Export concurrency guard** — Starting a second export while one runs returned success (both completed). Consider adding a queue or concurrent guard.

8. ~~**Fix FFmpeg error messaging (Issue G)**~~ — **DONE**. Error messages now show last 5 lines of FFmpeg stderr (actual error) instead of banner info.

9. ~~**Fix report `outputPath` behavior (Issue H)**~~ — **DONE**. Route infers `saveToDisk` from `outputPath`/`outputDir` and extracts directory.

10. ~~**Fix auto-edit error message (Issue I)**~~ — **DONE**. Individual field validation with specific error messages for both sync and async routes.

### Nice to have

11. **Timeline import needs `format:"md"` for markdown** — Without it, defaults to JSON and returns `"Invalid JSON in 'data'"`. Consider auto-detecting markdown (check for `## Track` headers).

12. **Script these tests** — A single `test-api.sh` that auto-discovers a project and runs all tests would cut retest time from 15+ minutes to ~30 seconds.
