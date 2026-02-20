# Claude API Fixes — Implementation Plan

> Based on [retest-checklist.md](retest-checklist.md) (2026-02-20)
> **4 critical issues, 3 medium, 3 nice-to-have**
>
> **Status**: Critical fixes #1–#4 implemented and tested (2026-02-20)
> **Status**: Issues G, H, I (items #8–#10) fixed (2026-02-21)

---

## Critical Fixes

### 1. Make suggest-cuts async (Issue E)

**Problem**: `POST /api/claude/analyze/:projectId/suggest-cuts` blocks the HTTP connection while running transcription + scene detection + filler analysis. Hangs >5min on 569s video.

**Solution**: Wrap in the same async job pattern used by transcription — return `jobId` immediately, process in background, poll for results.

**Subtasks**:

- [ ] **1a. Add job map and types to suggest handler**
  - File: `electron/claude/claude-suggest-handler.ts`
  - Add `SuggestJob` type (jobId, projectId, status, result, error, timestamps)
  - Add `suggestJobs: Map<string, SuggestJob>` with auto-pruning (max 50)
  - Export `startSuggestJob()` → returns `{ jobId }`, fires `suggestCuts()` in background
  - Export `getSuggestJobStatus(jobId)` → returns job or null
  - Export `listSuggestJobs()` → returns all jobs sorted newest-first
  - Export `cancelSuggestJob(jobId)` → marks as cancelled

- [ ] **1b. Register async routes in analysis routes**
  - File: `electron/claude/claude-http-analysis-routes.ts`
  - Add `POST /api/claude/analyze/:projectId/suggest-cuts/start` → calls `startSuggestJob()`
  - Add `GET /api/claude/analyze/:projectId/suggest-cuts/jobs/:jobId` → calls `getSuggestJobStatus()`
  - Add `GET /api/claude/analyze/:projectId/suggest-cuts/jobs` → calls `listSuggestJobs()` filtered by projectId
  - Add `POST /api/claude/analyze/:projectId/suggest-cuts/jobs/:jobId/cancel` → calls `cancelSuggestJob()`
  - Keep existing sync route for backward compatibility (short videos)

- [ ] **1c. Add unit tests**
  - File: `electron/__tests__/claude-suggest-handler.test.ts`
  - Test: `startSuggestJob` returns jobId immediately
  - Test: `getSuggestJobStatus` returns correct status transitions
  - Test: `cancelSuggestJob` marks job as cancelled
  - Test: auto-pruning removes old jobs beyond limit

**Reference pattern**: `electron/claude/claude-transcribe-handler.ts:447-553`

**Estimated effort**: ~30min

---

### 2. Make auto-edit async (Issue E)

**Problem**: `POST /api/claude/timeline/:projectId/auto-edit` blocks identically to suggest-cuts — runs transcription → filler detection → batch cuts synchronously.

**Solution**: Same async job pattern.

**Subtasks**:

- [ ] **2a. Add job map and types to auto-edit handler**
  - File: `electron/claude/claude-auto-edit-handler.ts`
  - Add `AutoEditJob` type (jobId, projectId, status, result, error, timestamps)
  - Add `autoEditJobs: Map<string, AutoEditJob>` with auto-pruning
  - Export `startAutoEditJob(projectId, request, win)` → returns `{ jobId }`
  - Export `getAutoEditJobStatus(jobId)` → returns job or null
  - Export `listAutoEditJobs()`, `cancelAutoEditJob(jobId)`

- [ ] **2b. Register async routes in analysis routes**
  - File: `electron/claude/claude-http-analysis-routes.ts`
  - Add `POST /api/claude/timeline/:projectId/auto-edit/start`
  - Add `GET /api/claude/timeline/:projectId/auto-edit/jobs/:jobId`
  - Add `GET /api/claude/timeline/:projectId/auto-edit/jobs`
  - Add `POST /api/claude/timeline/:projectId/auto-edit/jobs/:jobId/cancel`
  - Keep existing sync route

- [ ] **2c. Add unit tests**
  - File: `electron/__tests__/claude-auto-edit-handler.test.ts`
  - Same test pattern as 1c

**Reference pattern**: `electron/claude/claude-transcribe-handler.ts:447-553`

**Estimated effort**: ~30min

---

### 3. Fix frame analysis provider cascade (Issue D)

**Problem**: `analyzeFramesWithClaude()` only checks `keys.anthropicApiKey` and fails immediately if missing. No fallback to OpenRouter or claude-cli.

**Root cause**: Lines 143-149 in `electron/claude/claude-vision-handler.ts` — hard-coded Anthropic-only check.

**Subtasks**:

- [ ] **3a. Implement provider cascade in vision handler**
  - File: `electron/claude/claude-vision-handler.ts`
  - Modify `analyzeFramesWithClaude()` to try providers in order:
    1. Anthropic direct (if `anthropicApiKey` set)
    2. OpenRouter (if `openrouterApiKey` set) — use `https://openrouter.ai/api/v1/chat/completions` with vision model
    3. Fail with descriptive error listing which keys are missing
  - Check how `getDecryptedApiKeys()` returns keys — file: `electron/api-key-handler.ts`

- [ ] **3b. Add unit tests**
  - File: `electron/__tests__/claude-vision-handler.test.ts`
  - Test: Anthropic key present → uses Anthropic API
  - Test: Only OpenRouter key present → uses OpenRouter API
  - Test: No keys → throws descriptive error
  - Test: Anthropic fails → falls back to OpenRouter

**Estimated effort**: ~25min

---

### 4. Fix Markdown import apply (Issue F)

**Problem**: `POST /api/claude/timeline/:projectId/import` with `format:"md"` returns `{ imported: true }` but elements don't appear in the timeline.

**Root cause**: The IPC chain works: `claude-timeline-handler.ts:891` sends `claude:timeline:apply` → `preload-integrations.ts:276` forwards to renderer → `claude-timeline-bridge.ts:176` receives it. The issue is in the bridge's `onApply` callback — either the parsed timeline format doesn't match what `useTimelineStore` expects, or the store update doesn't trigger a re-render.

**Subtasks**:

- [ ] **4a. Debug the onApply handler in the timeline bridge**
  - File: `apps/web/src/lib/claude-timeline-bridge.ts:176`
  - Add logging to confirm data reaches the handler
  - Verify `ClaudeTimeline` format matches what `useTimelineStore` expects
  - Check `replace` path vs `merge` path in the handler

- [ ] **4b. Verify markdownToTimeline output format**
  - File: `electron/claude/claude-timeline-handler.ts:222`
  - Ensure parsed Markdown produces valid `ClaudeTimeline` with correct track/element structure
  - Ensure element `sourceId` references exist in the project's media library

- [ ] **4c. Fix the store update and add IPC round-trip test**
  - File: `apps/web/src/lib/claude-timeline-bridge.ts`
  - File: `apps/web/src/lib/__tests__/claude-timeline-bridge.test.ts`
  - Ensure `useTimelineStore.setState()` is called correctly for `replace` mode
  - Test: mock IPC apply event → verify store state updated

**Estimated effort**: ~40min

---

## Medium Priority

### 5. Add `GET /api/claude/projects` endpoint

**Problem**: No API way to list projects. Only option is scraping IndexedDB LevelDB files on disk.

**Subtasks**:

- [ ] **5a. Add project list handler**
  - File: `electron/claude/claude-project-handler.ts`
  - Export `listProjects()` that reads project list from IndexedDB via IPC to renderer
  - Return: `{ projects: [{ id, name, createdAt, mediaCount }] }`

- [ ] **5b. Register route**
  - File: `electron/claude/claude-http-server.ts`
  - Add `GET /api/claude/projects` route

- [ ] **5c. Add unit test**
  - File: `electron/__tests__/claude-project-handler.test.ts` (new or extend existing)

**Estimated effort**: ~20min

---

### 6. Rebuild AICP binary with `google-generativeai` (Issue C)

**Problem**: `aicp analyze-video -t describe` fails — `google-generativeai` missing from PyInstaller hiddenimports.

**Subtasks**:

- [ ] **6a. Add hidden import to spec**
  - File: `packages/video-agent-skill/aicp.spec`
  - Add `google-generativeai` and its transitive deps to `hiddenimports`

- [ ] **6b. Rebuild and verify**
  - Run `pyinstaller aicp.spec` from `packages/video-agent-skill/`
  - Test: `./dist/aicp analyze-video -t describe --source <test-video>`

**Estimated effort**: ~15min

---

### 7. Export concurrency guard

**Problem**: Starting a second export while one runs returns an error. Should queue or return a clearer message.

**Subtasks**:

- [ ] **7a. Improve error message in export handler**
  - File: `electron/claude/claude-export-handler.ts`
  - When a second export is requested, return HTTP 409 with running job ID
  - Message: `"Export already running: {jobId}. Poll GET /api/claude/export/:projectId/jobs/{jobId} for status."`

- [ ] **7b. Add test**
  - File: `electron/__tests__/claude-export-handler.test.ts` (new or extend)

**Estimated effort**: ~10min

---

## Nice to Have

### 8. Auto-detect Markdown import format

**Problem**: Timeline import requires explicit `format:"md"` for Markdown. Without it, defaults to JSON and fails.

- [ ] File: `electron/claude/claude-timeline-handler.ts:880`
- [ ] If `data` starts with `#` or contains `## Track`, auto-set `format = "md"`
- [ ] Test: `electron/__tests__/claude-timeline-handler.test.ts` (extend)

**Estimated effort**: ~5min

---

### 9. Automated API test script

**Problem**: Manual retesting takes 15+ minutes.

- [ ] File: `scripts/test-claude-api.sh` (new)
- [ ] Auto-discover project from IndexedDB
- [ ] Run all 18 test cases from retest-checklist
- [ ] Output pass/fail table

**Estimated effort**: ~45min

---

### 10. Short test video fixture

**Problem**: Testing with 569s video causes hangs. Need a ≤30s test video.

- [ ] Add a ~10s test video to `electron/__tests__/fixtures/` or `tests/fixtures/`
- [ ] Reference in API test script and unit tests

**Estimated effort**: ~5min

---

## Implementation Order

| Priority | Task | Depends On | Effort |
|----------|------|------------|--------|
| 1 | Suggest-cuts async (#1) | — | 30min |
| 2 | Auto-edit async (#2) | — | 30min |
| 3 | Frame analysis cascade (#3) | — | 25min |
| 4 | Markdown import fix (#4) | — | 40min |
| 5 | List projects endpoint (#5) | — | 20min |
| 6 | AICP binary rebuild (#6) | — | 15min |
| 7 | Export concurrency guard (#7) | — | 10min |
| 8 | Auto-detect md format (#8) | #4 | 5min |
| 9 | API test script (#9) | #1–#4 | 45min |
| 10 | Test video fixture (#10) | — | 5min |

**Total estimated effort**: ~3.5 hours

Tasks 1–3 are independent and can be implemented in parallel.
