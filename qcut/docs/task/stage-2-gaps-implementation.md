# Stage 2 Gaps: Implementation Plan

> **Goal**: Close all remaining gaps in Stage 2 Video Understanding
> **Estimated effort**: ~3 hours across 3 subtasks
> **Priority**: Long-term maintainability — async pattern, proper mocks, edge coverage
> **Status**: PLANNED

---

## Critical Discovery

The HTTP server has a **30-second global timeout** (`electron/claude/claude-http-server.ts:694`), but several Stage 2 handlers have much longer internal timeouts:

| Handler | Internal Timeout | HTTP Timeout | Result |
|---------|-----------------|--------------|--------|
| Transcription | 5 min | 30s | **Client gets 408 while handler keeps running** |
| Scene Detection | 3 min | 30s | **Same — orphaned FFmpeg process** |
| Vision API | 2 min | 30s | **Same — wasted API cost** |
| Audio Extraction | 2 min | 30s | **Same** |

This makes Subtask G1 (async job pattern) a **blocking priority** — without it, transcription and scene detection will always fail on real-world video lengths.

---

## Subtask G1: Async Job Pattern for Transcription (~1.5 hours)

### Why

Current transcription is synchronous. A 5-minute video transcription will hit the 30s HTTP timeout every time. The generate handler already has a working job pattern — replicate it.

### Files to change

| File | Change | Est. Lines |
|---|---|---|
| `electron/claude/claude-transcribe-handler.ts` | Add job map, `startTranscribeJob()`, `getTranscribeJobStatus()`, `listTranscribeJobs()`, `cancelTranscribeJob()` | +80 |
| `electron/claude/claude-http-server.ts` | Replace sync route with 4 async routes (start, poll, list, cancel) | +30, -15 |
| `electron/types/claude-api.ts` | Add `TranscribeJob` type | +15 |
| `electron/__tests__/claude-transcribe-handler.test.ts` | Update tests for async pattern | +40, -10 |
| `electron/__tests__/stage2-integration.test.ts` | Add integration test for async audio extraction job | +20 |

### Implementation steps

**Step 1: Define `TranscribeJob` type** (`electron/types/claude-api.ts`)

```typescript
export interface TranscribeJob {
  jobId: string;
  projectId: string;
  mediaId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;        // 0-100
  message: string;
  provider: string;
  result?: TranscriptionResult;
  createdAt: number;
  completedAt?: number;
}
```

**Step 2: Add job tracking** (`electron/claude/claude-transcribe-handler.ts`)

Follow the exact pattern from `claude-generate-handler.ts`:
- In-memory `Map<string, TranscribeJob>` with `MAX_JOBS = 50`
- `pruneOldJobs()` function (identical to generate handler)
- Job ID format: `transcribe_<timestamp>_<random5>`

New exported functions:
- `startTranscribeJob(projectId, request)` → `{ jobId }` — creates job, fires background, returns immediately
- `getTranscribeJobStatus(jobId)` → `TranscribeJob | null`
- `listTranscribeJobs()` → `TranscribeJob[]` sorted newest-first
- `cancelTranscribeJob(jobId)` → `boolean`

Background function `runTranscription(jobId)`:
- Updates `job.progress` at each step:
  - 10%: "Resolving media..."
  - 25%: "Extracting audio from video..."
  - 50%: "Uploading to provider..."
  - 75%: "Transcribing audio..."
  - 100%: "Transcription complete"
- Catches all errors → `job.status = "failed"`, `job.message = error`
- Sets `job.completedAt` on completion/failure

Keep existing `transcribeMedia()` as internal — the background function calls it.

**Step 3: Replace HTTP route** (`electron/claude/claude-http-server.ts`)

Replace:
```
POST /api/claude/transcribe/:projectId  (sync, blocks)
```

With:
```
POST /api/claude/transcribe/:projectId/start       → { jobId }
GET  /api/claude/transcribe/:projectId/jobs/:jobId  → TranscribeJob
GET  /api/claude/transcribe/:projectId/jobs          → TranscribeJob[]
POST /api/claude/transcribe/:projectId/jobs/:jobId/cancel → { cancelled }
```

Keep the old sync route as a fallback (for backwards compatibility) but document it as deprecated.

**Step 4: Update unit tests** (`electron/__tests__/claude-transcribe-handler.test.ts`)

Add tests:
- `startTranscribeJob` returns a job ID immediately
- Job status is "queued" right after creation
- `getTranscribeJobStatus` returns null for unknown IDs
- `cancelTranscribeJob` returns false for completed jobs
- `listTranscribeJobs` returns sorted by creation time

**Step 5: Integration test** (`electron/__tests__/stage2-integration.test.ts`)

Add test verifying `extractAudio()` can be called from the job pattern context (no mocking of fs/child_process).

### Acceptance criteria

- [ ] `POST /transcribe/:projectId/start` returns in <100ms
- [ ] Polling `GET /jobs/:jobId` returns progress updates
- [ ] Completed job has full `TranscriptionResult` in `result` field
- [ ] Cancellation kills FFmpeg subprocess if running
- [ ] All existing unit tests still pass
- [ ] New unit tests cover async lifecycle

---

## Subtask G2: API Mock Tests (~1 hour)

### Why

Three handlers make external API calls that are never tested with mocked responses. The response parsing and mapping logic is untested end-to-end.

### Files to change

| File | Change | Est. Lines |
|---|---|---|
| `electron/__tests__/claude-vision-handler.test.ts` | Add mocked Claude Vision API tests | +80 |
| `electron/__tests__/claude-transcribe-handler.test.ts` | Add mocked ElevenLabs API tests | +100 |
| `electron/__tests__/claude-scene-handler.test.ts` | Add mocked Gemini SDK tests | +70 |

### G2.1: Vision Handler — Mock Claude Vision API

**File**: `electron/__tests__/claude-vision-handler.test.ts`

Mock `globalThis.fetch` to return a realistic Claude Vision API response.

Tests to add:
1. **Full pipeline with mocked API**: mock `getMediaInfo` → real-ish media, mock `existsSync` → true for frame paths, mock `readFile` → fake JPEG buffer, mock `fetch` → Claude API response with JSON array. Verify `analyzeFrames()` returns correct `FrameAnalysis[]`.
2. **API error handling**: mock fetch returning 401/500, verify error message includes status code.
3. **API key missing**: mock `getDecryptedApiKeys` → no `anthropicApiKey`, verify throws with settings guidance message.
4. **Timeout handling**: mock fetch rejecting with `AbortError`, verify error propagation.

Mock response shape:
```json
{
  "content": [{
    "type": "text",
    "text": "[{\"objects\":[\"person\"],\"text\":[],\"description\":\"A person\",\"mood\":\"calm\",\"composition\":\"centered\"}]"
  }]
}
```

**API endpoint**: `https://api.anthropic.com/v1/messages` (POST)

### G2.2: Transcribe Handler — Mock ElevenLabs via FAL

**File**: `electron/__tests__/claude-transcribe-handler.test.ts`

Requires mocking 3 sequential fetch calls:

1. **FAL storage initiate** (`POST https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3`)
   - Response: `{ "upload_url": "https://mock-upload", "file_url": "https://mock-cdn/audio.mp3" }`

2. **FAL storage upload** (`PUT https://mock-upload`)
   - Response: status 200

3. **ElevenLabs Scribe v2** (`POST https://fal.run/fal-ai/elevenlabs/speech-to-text/scribe-v2`)
   - Response with word-level data:
   ```json
   {
     "text": "Hello world",
     "language_code": "en",
     "words": [
       { "text": "Hello", "start": 0.0, "end": 0.4, "type": "word", "speaker_id": "A" },
       { "text": " ", "start": 0.4, "end": 0.5, "type": "spacing", "speaker_id": null },
       { "text": "world", "start": 0.5, "end": 0.9, "type": "word", "speaker_id": "A" }
     ]
   }
   ```

Tests to add:
1. **Full ElevenLabs pipeline**: mock all 3 fetches, verify `TranscriptionResult` has correct words, segments, language, duration.
2. **FAL initiate failure**: mock first fetch returning 500, verify error includes "FAL storage initiate failed".
3. **FAL upload failure**: mock upload returning 403, verify error.
4. **Missing FAL API key**: verify throws with settings guidance.
5. **Speaker mapping**: verify `speaker_id: "A"` maps to `speaker: "A"` and `null` maps to `undefined`.
6. **Segment building**: verify `buildSegments()` splits on spacing gaps >0.5s.

### G2.3: Scene Handler — Mock Gemini SDK

**File**: `electron/__tests__/claude-scene-handler.test.ts`

Cannot mock `fetch` — handler uses `@google/generative-ai` SDK. Must mock the module:

```typescript
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            description: "Wide shot of a room",
            shotType: "wide",
            transitionType: "cut"
          })
        }
      })
    })
  }))
}));
```

Tests to add:
1. **AI enrichment populates scene fields**: provide scenes with timestamps, mock Gemini response, verify `description`, `shotType`, `transitionType` are filled.
2. **Per-scene error resilience**: make one Gemini call fail, verify other scenes still get enriched.
3. **Missing Gemini API key**: verify handler skips enrichment (returns original scenes, no throw).
4. **Max 20 scenes for enrichment**: provide 25 scenes, verify only first 20 get Gemini calls.

### Acceptance criteria

- [ ] All 3 handlers have mocked API response tests
- [ ] Error paths (401, 500, timeout, missing key) are covered
- [ ] Response parsing/mapping verified end-to-end with realistic data
- [ ] No real API calls made in any test

---

## Subtask G3: Edge Case Tests (~30 minutes)

### Files to change

| File | Change | Est. Lines |
|---|---|---|
| `electron/__tests__/claude-vision-handler.test.ts` | Add `resolveTimestamps` tests | +35 |
| `electron/__tests__/claude-vision-handler.test.ts` | Add API key missing test | +10 |
| `electron/__tests__/stage2-integration.test.ts` | Add HTTP timeout awareness note | +5 |

### G3.1: `resolveTimestamps` Unit Tests

**File**: `electron/__tests__/claude-vision-handler.test.ts`

The function (`electron/claude/claude-vision-handler.ts:110-133`) has 3 branches:

1. **Explicit timestamps provided**: returns `request.timestamps.slice(0, 20)`
2. **Interval + duration**: generates timestamps every N seconds, max 20
3. **Default**: returns `[0]`

Tests to add:
```
resolveTimestamps
  ✓ returns explicit timestamps unchanged
  ✓ caps explicit timestamps at 20 (MAX_FRAMES_PER_REQUEST)
  ✓ generates timestamps from interval and duration
  ✓ caps interval timestamps at 20
  ✓ clamps interval to minimum 1 second
  ✓ returns [0] when no timestamps, interval, or duration
  ✓ returns [0] when interval provided but no duration
```

Need to export `resolveTimestamps` (currently private) or test indirectly via `analyzeFrames`.

**Decision**: Export it — it's pure logic, worth testing directly.

**File change**: `electron/claude/claude-vision-handler.ts` — add `resolveTimestamps` to exports.

### G3.2: API Key Missing Test

**File**: `electron/__tests__/claude-vision-handler.test.ts`

Test that `analyzeFrames()` throws with guidance message when `anthropicApiKey` is empty:
```
"Anthropic API key not configured. Go to Settings → API Keys to set it."
```

This requires the frame extraction step to succeed first (mock FFmpeg spawn or use integration approach), then hit the API key check.

### G3.3: HTTP Timeout Documentation

Add a comment in `electron/__tests__/stage2-integration.test.ts` documenting the 30s HTTP timeout vs handler timeouts, so future developers understand why the async job pattern exists.

### Acceptance criteria

- [ ] `resolveTimestamps` has 7 unit tests covering all branches
- [ ] API key missing path is tested for vision handler
- [ ] Timeout architecture is documented in integration test file

---

## Implementation Order

```
G1 (Async Transcription)  ──→  G2 (API Mocks)  ──→  G3 (Edge Cases)
        ↑ blocking                  independent          independent
```

**G1 first**: It's the highest priority — fixes the 30s timeout bug that makes transcription unusable on real videos. G2 and G3 are independent and can be done in any order after G1.

---

## Test Summary After Implementation

| Test File | Current | After |
|-----------|---------|-------|
| `claude-transcribe-handler.test.ts` | 6 | ~16 (+4 async lifecycle, +6 API mocks) |
| `claude-scene-handler.test.ts` | 9 | ~13 (+4 Gemini SDK mocks) |
| `claude-vision-handler.test.ts` | 8 | ~19 (+4 API mocks, +7 resolveTimestamps) |
| `claude-filler-handler-http.test.ts` | 5 | 5 (no changes) |
| `stage2-integration.test.ts` | 12 | ~14 (+1 async job, +1 doc) |
| **Total** | **40** | **~67** |

---

## Files Reference

| File | Purpose |
|---|---|
| `electron/claude/claude-transcribe-handler.ts` | Transcription handler (add async job pattern) |
| `electron/claude/claude-generate-handler.ts` | Reference: existing async job pattern to replicate |
| `electron/claude/claude-http-server.ts` | HTTP route registration (update transcribe routes) |
| `electron/claude/claude-scene-handler.ts` | Scene handler (add Gemini mock tests) |
| `electron/claude/claude-vision-handler.ts` | Vision handler (export `resolveTimestamps`, add API mocks) |
| `electron/types/claude-api.ts` | Add `TranscribeJob` type |
| `electron/__tests__/claude-transcribe-handler.test.ts` | Transcribe tests (async + API mocks) |
| `electron/__tests__/claude-scene-handler.test.ts` | Scene tests (Gemini SDK mocks) |
| `electron/__tests__/claude-vision-handler.test.ts` | Vision tests (API mocks + resolveTimestamps) |
| `electron/__tests__/stage2-integration.test.ts` | Integration tests (real FFmpeg) |
