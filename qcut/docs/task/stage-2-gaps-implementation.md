# Stage 2 Gaps: Implementation Results

> **Goal**: Close all remaining gaps in Stage 2 Video Understanding
> **Status**: COMPLETED
> **Test results**: 63 tests pass across 4 test files (2739 total suite passing)

---

## Summary

| Subtask | Status | Tests Added |
|---------|--------|-------------|
| G1: Async transcription jobs | Done | 6 tests |
| G2: API mock tests (vision, transcribe, scene) | Done | 16 tests |
| G3: Edge cases + resolveTimestamps | Done | 7 tests |
| **Total new tests** | | **29** |

---

## G1: Async Job Pattern for Transcription — DONE

### Problem
The HTTP server has a 30-second global timeout, but transcription takes up to 5 minutes. Every real transcription request timed out.

### Changes

| File | Change |
|------|--------|
| `electron/types/claude-api.ts` | Added `TranscribeJob` interface |
| `electron/claude/claude-transcribe-handler.ts` | Added job map, `startTranscribeJob()`, `getTranscribeJobStatus()`, `listTranscribeJobs()`, `cancelTranscribeJob()`, `_clearTranscribeJobs()`, `runTranscription()` |
| `electron/claude/claude-http-analysis-routes.ts` | Added 4 async routes (kept sync route as fallback) |
| `electron/__tests__/claude-transcribe-handler.test.ts` | 6 new async lifecycle tests |

### New API Routes

```
POST /api/claude/transcribe/:projectId/start        → { jobId }
GET  /api/claude/transcribe/:projectId/jobs/:jobId   → TranscribeJob
GET  /api/claude/transcribe/:projectId/jobs          → TranscribeJob[]
POST /api/claude/transcribe/:projectId/jobs/:jobId/cancel → { cancelled }
```

### Key Design Decisions
- Replicated pattern from `claude-generate-handler.ts` (proven in production)
- `MAX_TRANSCRIBE_JOBS = 50` with automatic pruning of completed jobs >1 hour old
- Job ID format: `transcribe_<timestamp>_<random5>`
- `transcribeMedia()` unchanged — background runner calls it internally
- Added `onProgress` callback to `transcribeMedia()` for progress reporting

---

## G2: API Mock Tests — DONE

### Vision Handler (4 new tests)
- Full pipeline with mocked Claude Vision API response
- API error handling (401)
- API timeout (AbortError)
- Anthropic API key missing → guidance message

Mock setup required:
- `node:child_process` spawn (for FFmpeg frame extraction)
- `node:fs/promises` readFile (for frame data)
- `globalThis.fetch` (for Claude Vision API)
- `api-key-handler` getDecryptedApiKeys

### Transcribe Handler (5 new tests)
- Full ElevenLabs pipeline (3 sequential fetches: FAL initiate → upload → Scribe v2)
- FAL storage initiate failure (500)
- FAL storage upload failure (403)
- Missing FAL API key
- Speaker ID mapping (`speaker_id: "B"` → `speaker: "B"`, `null` → `undefined`)

### Scene Handler (7 new tests)
- FFmpeg scene detection with mocked spawn stderr output
- Auto-adds scene at t=0 if missing
- FFmpeg spawn error handling
- Gemini AI enrichment with mocked SDK
- Skips AI when Gemini key missing (no throw, logs warning)
- Graceful handling of Gemini API errors

Mock setup for Gemini:
```typescript
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: mockGenerateContent,
    })),
  })),
}));
```

### Lesson Learned: Mock Leakage
`vi.clearAllMocks()` does NOT clear `mockResolvedValueOnce()` queues. If a test sets a once-value but the mock is never called (e.g., test throws earlier), the value leaks to the next test. Fix: use `mockReset()` in `beforeEach` and re-apply default implementations.

---

## G3: Edge Cases — DONE

### resolveTimestamps (7 tests)
Exported `resolveTimestamps` from `claude-vision-handler.ts` (was private). Tests cover all 3 branches:
1. Explicit timestamps (unchanged, capped at 20)
2. Interval + duration (generates every N seconds, min interval 1s, capped at 20)
3. Default fallback (`[0]`)

### HTTP Timeout Documentation
Added architecture note to `stage2-integration.test.ts` header documenting the 30s HTTP timeout vs handler internal timeouts, explaining why the async job pattern exists.

---

## Test Count After Implementation

| Test File | Before | After |
|-----------|--------|-------|
| `claude-transcribe-handler.test.ts` | 6 | 17 |
| `claude-scene-handler.test.ts` | 9 | 15 |
| `claude-vision-handler.test.ts` | 8 | 19 |
| `stage2-integration.test.ts` | 12 | 12 |
| **Total Stage 2 tests** | **35** | **63** |

---

## Files Changed

| File | Type |
|------|------|
| `electron/types/claude-api.ts` | Added `TranscribeJob` type |
| `electron/claude/claude-transcribe-handler.ts` | Async job pattern + onProgress |
| `electron/claude/claude-http-analysis-routes.ts` | 4 new async routes |
| `electron/claude/claude-vision-handler.ts` | Exported `resolveTimestamps` |
| `electron/__tests__/claude-transcribe-handler.test.ts` | +11 tests |
| `electron/__tests__/claude-vision-handler.test.ts` | +11 tests |
| `electron/__tests__/claude-scene-handler.test.ts` | +6 tests |
| `electron/__tests__/stage2-integration.test.ts` | HTTP timeout docs |
