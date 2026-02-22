# Editor CLI Phase 3: Analysis + Transcription Commands

> **Date:** 2026-02-22
> **Goal:** Implement `editor:analyze:*` (5 commands) and `editor:transcribe:*` (5 commands) wrapping 10 HTTP endpoints for video understanding and speech-to-text.
> **Reference:** [editor-cli-overview.md](editor-cli-overview.md), `electron/claude/claude-analyze-handler.ts`, `electron/claude/claude-transcribe-handler.ts`, `electron/claude/claude-scene-handler.ts`, `electron/claude/claude-vision-handler.ts`, `electron/claude/claude-filler-handler.ts`
> **Status:** DONE
> **Depends on:** Phase 1 (Subtasks 1.1-1.3)
>
> | Subtask | File | Lines | Tests |
> |---------|------|-------|-------|
> | 3.1 Analyze commands | `editor-handlers-analysis.ts` | ~349 | 9 (video, models, scenes, frames, fillers) |
> | 3.2 Transcribe commands | (same file) | — | 8 (run, start sync+poll, status, list-jobs, cancel) |
> | 3.3 Wire + CLI | `cli-handlers-editor.ts`, `cli.ts` | ~30 added | — |
> | 3.4 Tests | `editor-handlers-analysis.test.ts` | ~506 | 21 passing |

---

## Subtask 3.1: Implement Video Analysis Commands

**Time:** ~25 min
**Files:**
- `electron/native-pipeline/editor-handlers-analysis.ts` (create, ~300 lines)

**Changes:**

### editor:analyze:video
```
POST /api/claude/analyze/:projectId
Body: {
  source: { type: "timeline"|"media"|"path", elementId?: string, mediaId?: string, filePath?: string },
  analysisType?: "timeline"|"describe"|"transcribe",
  model?: string,
  format?: "md"|"json"|"both"
}
```
**Required:** `--project-id`, `--source` (formatted as `type:identifier`, e.g. `media:my_media_id` or `path:/path/to/file.mp4`)
**Optional:** `--analysis-type` (default: timeline), `--model`, `--format`

**Source parsing logic:**
```typescript
function parseSource(sourceStr: string): AnalyzeSource {
  const [type, ...rest] = sourceStr.split(":");
  const id = rest.join(":");
  switch (type) {
    case "media": return { type: "media", mediaId: id };
    case "timeline": return { type: "timeline", elementId: id };
    case "path": return { type: "path", filePath: id };
    default: return { type: "path", filePath: sourceStr }; // fallback: treat as path
  }
}
```

### editor:analyze:models
```
GET /api/claude/analyze/models
```
No required flags. Returns list of available analysis models.
**Output:** Table of models (id, name, provider, capabilities)

---

## Subtask 3.2: Implement Scene & Frame & Filler Analysis

**Time:** ~25 min
**Files:**
- `electron/native-pipeline/editor-handlers-analysis.ts` (extend)

**Changes:**

### editor:analyze:scenes
```
POST /api/claude/analyze/:projectId/scenes
Body: { mediaId: <id>, threshold?: <number>, aiAnalysis?: boolean, model?: string }
```
**Required:** `--project-id`, `--media-id`
**Optional:** `--threshold` (0-1, default varies), `--model`
**Output:** Table of scenes (timestamp, confidence, shotType, transitionType, description)

**Note:** Sync only — no async job routes. If the video is very long, this may timeout at 30s.

### editor:analyze:frames
```
POST /api/claude/analyze/:projectId/frames
Body: { mediaId: <id>, timestamps?: <number[]>, interval?: <number>, prompt?: <string> }
```
**Required:** `--project-id`, `--media-id`
**Optional:** `--timestamps` (comma-separated: `0,5,10,15`), `--interval` (auto-extract every N seconds), `--prompt` (custom analysis prompt)
**Output:** Frame analysis results (timestamp, objects, text, description, mood)

**Timestamp parsing:**
```typescript
const timestamps = options.timestamps
  ? options.timestamps.split(",").map(Number).filter(n => !Number.isNaN(n))
  : undefined;
```

**Note:** Provider cascade (Anthropic → OpenRouter). Requires API key. Sync only.

### editor:analyze:fillers
```
POST /api/claude/analyze/:projectId/fillers
Body: { mediaId?: <id>, words?: [{id, text, start, end, type?, speaker_id?}...] }
```
**Required:** `--project-id`
**Optional:** `--media-id` (analyze media directly), `--data` (pre-existing word list as JSON)
**Output:** Filler words found + silence gaps + summary stats

**Note:** No API keys required. Sync only. Can accept either a `mediaId` for automatic transcription or a pre-existing `words` array.

---

## Subtask 3.3: Implement Transcription Commands

**Time:** ~25 min
**Files:**
- `electron/native-pipeline/editor-handlers-analysis.ts` (extend)

**Changes:**

### editor:transcribe:run
```
POST /api/claude/transcribe/:projectId
Body: { mediaId: <id>, provider?: <string>, language?: <string>, diarize?: boolean }
```
**Required:** `--project-id`, `--media-id`
**Optional:** `--provider`, `--language`, `--no-diarize`
**Output:** Transcription result (words, segments, language, duration)

**Note:** Sync-only endpoint. Will timeout after 30s for long videos. Use `editor:transcribe:start --poll` for long content.

### editor:transcribe:start
```
POST /api/claude/transcribe/:projectId/start
Body: { mediaId: <id>, provider?: <string>, language?: <string>, diarize?: boolean }
```
**Required:** `--project-id`, `--media-id`
**Optional:** `--poll`, `--poll-interval`, `--provider`, `--language`, `--no-diarize`
**Behavior:**
- Without `--poll`: returns `{ jobId }` immediately
- With `--poll`: polls until complete, shows progress, returns full result

### editor:transcribe:status
```
GET /api/claude/transcribe/:projectId/jobs/:jobId
```
**Required:** `--project-id`, `--job-id`
**Output:** Job status (status, progress, message, result when completed)

### editor:transcribe:list-jobs
```
GET /api/claude/transcribe/:projectId/jobs
```
**Required:** `--project-id`
**Output:** Table of jobs (jobId, status, mediaId, progress, createdAt)

### editor:transcribe:cancel
```
POST /api/claude/transcribe/:projectId/jobs/:jobId/cancel
```
**Required:** `--project-id`, `--job-id`

**Async polling implementation:**
```typescript
async function handleTranscribeStart(
  client: EditorApiClient,
  options: CLIRunOptions,
  onProgress: ProgressFn
): Promise<CLIResult> {
  if (!options.projectId) return { success: false, error: "Missing --project-id" };
  if (!options.mediaId) return { success: false, error: "Missing --media-id" };

  const body: Record<string, unknown> = { mediaId: options.mediaId };
  if (options.provider) body.provider = options.provider;
  if (options.language) body.language = options.language;

  const startResult = await client.post<{ jobId: string }>(
    `/api/claude/transcribe/${options.projectId}/start`,
    body
  );

  if (!options.poll) {
    return { success: true, data: startResult };
  }

  // Poll until complete
  onProgress({ stage: "polling", percent: 0, message: `Job ${startResult.jobId} started...` });

  const result = await client.pollJob(
    `/api/claude/transcribe/${options.projectId}/jobs/${startResult.jobId}`,
    {
      interval: (options.pollInterval ?? 3) * 1000,
      timeout: (options.timeout ?? 300) * 1000,
      onProgress: (job) => {
        onProgress({
          stage: "polling",
          percent: job.progress ?? 0,
          message: job.message ?? `Status: ${job.status}`,
        });
      },
    }
  );

  return { success: true, data: result };
}
```

---

## Subtask 3.4: Unit Tests for Phase 3

**Time:** ~25 min
**Files:**
- `electron/native-pipeline/__tests__/editor-handlers.test.ts` (extend, ~100 lines for analysis)

**Changes:**

**Test cases:**

1. **Source parsing**
   - `parseSource("media:abc123")` → `{ type: "media", mediaId: "abc123" }`
   - `parseSource("path:/tmp/video.mp4")` → `{ type: "path", filePath: "/tmp/video.mp4" }`
   - `parseSource("/tmp/video.mp4")` → falls back to path type

2. **Timestamp parsing**
   - `"0,5,10"` → `[0, 5, 10]`
   - `"0,invalid,10"` → `[0, 10]` (filters NaN)
   - undefined → undefined (use server defaults)

3. **Analyze commands**
   - `editor:analyze:video` requires `--project-id` and `--source`
   - `editor:analyze:scenes` sends threshold in body when provided
   - `editor:analyze:frames` sends parsed timestamps array

4. **Transcription commands**
   - `editor:transcribe:run` sends sync POST
   - `editor:transcribe:start` without `--poll` returns jobId
   - `editor:transcribe:start` with `--poll` calls `pollJob()`
   - `editor:transcribe:cancel` sends POST to cancel endpoint
   - `editor:transcribe:list-jobs` calls GET with project-id

---

## Files Impact Summary

| File | Action | Lines |
|------|--------|-------|
| `electron/native-pipeline/editor-handlers-analysis.ts` | Create | ~300 |
| `electron/native-pipeline/__tests__/editor-handlers.test.ts` | Extend | ~100 |
| **Total** | | **~400** |

## API Endpoint Coverage

| Command | HTTP Method | Endpoint |
|---------|-------------|----------|
| `editor:analyze:video` | POST | `/api/claude/analyze/:projectId` |
| `editor:analyze:models` | GET | `/api/claude/analyze/models` |
| `editor:analyze:scenes` | POST | `/api/claude/analyze/:projectId/scenes` |
| `editor:analyze:frames` | POST | `/api/claude/analyze/:projectId/frames` |
| `editor:analyze:fillers` | POST | `/api/claude/analyze/:projectId/fillers` |
| `editor:transcribe:run` | POST | `/api/claude/transcribe/:projectId` |
| `editor:transcribe:start` | POST | `/api/claude/transcribe/:projectId/start` |
| `editor:transcribe:status` | GET | `/api/claude/transcribe/:projectId/jobs/:jobId` |
| `editor:transcribe:list-jobs` | GET | `/api/claude/transcribe/:projectId/jobs` |
| `editor:transcribe:cancel` | POST | `/api/claude/transcribe/:projectId/jobs/:jobId/cancel` |
