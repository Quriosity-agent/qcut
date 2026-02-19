# Stage 2: Video Understanding

> **Goal**: Let Claude Code transcribe and visually understand video content via QCut APIs
> **Estimated effort**: ~5 hours total across 4 subtasks
> **Dependencies**: Stage 1 Subtask 1.4 (frame extraction) recommended but not required
> **Status**: IMPLEMENTED (2026-02-19) — All 4 subtasks complete, 40 tests passing (28 unit + 12 integration)

---

## Current State

| Capability | Status | File |
|---|---|---|
| ElevenLabs Scribe v2 (word-level timestamps, 99 languages) | Ready | `electron/elevenlabs-transcribe-handler.ts` |
| Gemini audio-to-SRT transcription | Ready | `electron/gemini-transcribe-handler.ts` |
| FFmpeg audio extraction | Ready | `electron/ffmpeg-handler.ts` |
| Filler word detection (Gemini → Claude → pattern fallback) | Ready | `electron/ai-filler-handler.ts` |
| Video analysis via AICP CLI (narrative description) | Ready | `electron/claude/claude-analyze-handler.ts` |
| Word-level timeline store | Ready | `apps/web/src/stores/word-timeline-store.ts` |
| **Transcription HTTP endpoint** | **Done** | `electron/claude/claude-transcribe-handler.ts` |
| **Visual scene detection (FFmpeg + AI)** | **Done** | `electron/claude/claude-scene-handler.ts` |
| **Claude Vision frame analysis** | **Done** | `electron/claude/claude-vision-handler.ts` |
| **Filler detection HTTP endpoint** | **Done** | `electron/claude/claude-filler-handler.ts` |

**What's missing**: ~~No visual scene/shot detection. No Claude Vision frame analysis. No HTTP endpoint for transcription (IPC-only).~~ No transcription-to-cut-list automation (Stage 3).

**Known gap**: Subtask 2.1 note specifies "return immediately with job ID, poll for completion" async pattern. Current implementation is synchronous (blocks until transcription completes). The HTTP server's 30s default timeout may be too short for long transcriptions. Consider adding async job pattern if real-world usage hits timeouts.

---

## Subtask 2.1: Transcription HTTP Endpoint ✅ DONE

**What**: `POST /api/claude/transcribe/:projectId`

**Implementation file**: `electron/claude/claude-transcribe-handler.ts` (467 lines)

Exposes the existing ElevenLabs/Gemini transcription pipeline over HTTP so Claude Code can trigger transcription without the UI.

**Relevant files**:
- `electron/elevenlabs-transcribe-handler.ts` (436 lines) — existing IPC `transcribe:elevenlabs`
- `electron/gemini-transcribe-handler.ts` — existing IPC `transcribe:gemini`
- `electron/claude/claude-http-server.ts` — route registered
- `electron/types/claude-api.ts` — `TranscribeRequest`, `TranscriptionResult`, `TranscriptionWord`, `TranscriptionSegment` types added

**What was implemented**:
- ✅ Resolve media path from projectId + mediaId
- ✅ Extract audio via FFmpeg if video file (auto-detects video extensions)
- ✅ Upload to FAL storage (for ElevenLabs) or send directly (Gemini)
- ✅ Call provider API (ElevenLabs Scribe v2 or Gemini 2.5 Flash)
- ✅ Return structured word-level results with segments
- ✅ 5-minute timeout on API calls
- ⚠️ **NOT implemented**: Async job ID + poll pattern (spec note line 71). Currently synchronous.

**API contract**:
```
POST /api/claude/transcribe/:projectId
Body: {
  "mediaId": "media_...",
  "provider": "elevenlabs",
  "language": "auto",
  "diarize": true
}
Response: {
  "success": true,
  "data": {
    "words": [{ "text": "hello", "start": 0.5, "end": 0.8, "speaker": "A", "type": "word" }],
    "segments": [{ "text": "Hello world", "start": 0.5, "end": 1.2 }],
    "language": "en",
    "duration": 120.5
  }
}
```

**Test file**: `electron/__tests__/claude-transcribe-handler.test.ts` (6 unit tests passing)

| Spec'd test | Status | Notes |
|---|---|---|
| Triggers ElevenLabs transcription for valid media | ✅ | Tested (fails at network boundary as expected in unit test) |
| Triggers Gemini transcription as alternative | ✅ | Provider path tested |
| Returns word-level timestamps | ⚠️ | Validated in types; full integration requires live API |
| Handles audio extraction from video | ✅ | Video vs audio path detection tested |
| Rejects invalid media ID | ✅ | |
| Times out after 5 minutes | ⚠️ | Timeout is in code (TRANSCRIPTION_TIMEOUT_MS) but not unit-tested |

**Integration tests** (`stage2-integration.test.ts`): 3 tests — real FFmpeg audio extraction from video, valid MP3 output verified by magic bytes, reasonable file size for 9s audio.

---

## Subtask 2.2: Visual Scene Detection ✅ DONE

**What**: `POST /api/claude/analyze/:projectId/scenes`

**Implementation file**: `electron/claude/claude-scene-handler.ts` (347 lines)

Detects scene/shot boundaries by extracting keyframes and analyzing visual similarity.

**What was implemented**:
- ✅ Tier 1: FFmpeg scene filter (`select='gt(scene,threshold)',showinfo`)
- ✅ Tier 2: AI-powered scene analysis via Gemini (extracts frames, sends to Gemini for shot classification)
- ✅ `SceneBoundary` type with timestamp, confidence, description, shotType, transitionType
- ✅ `SceneDetectionResult` with scenes, totalScenes, averageShotDuration
- ✅ Threshold parameter (clamped 0.05–0.95)
- ✅ Deduplication of close timestamps (<0.5s apart)
- ✅ Auto-inserts first frame as scene 0 when not detected
- ✅ Batched frame extraction (5 at a time) for AI analysis
- ✅ Max 20 scenes for AI enrichment (cost control)

**API contract** — matches spec exactly.

**Test file**: `electron/__tests__/claude-scene-handler.test.ts` (9 unit tests passing)

| Spec'd test | Status | Notes |
|---|---|---|
| Detects scene boundaries via FFmpeg filter | ✅ | Unit test + integration test with real FFmpeg |
| Parses FFmpeg showinfo output correctly | ✅ | Tested with realistic multi-line stderr + real FFmpeg stderr |
| Returns sorted timestamps with confidence | ✅ | Verified with real 3-scene video |
| AI analysis enriches with descriptions (mock API) | ⚠️ | AI enrichment code exists; not mock-tested (needs Gemini SDK mock) |
| Handles single-shot video (no scene changes) | ✅ | Empty showinfo output → empty array |
| Respects threshold parameter | ✅ | Tested: higher threshold produces fewer scenes (real FFmpeg) |

**Integration tests** (`stage2-integration.test.ts`): 5 tests — detects 2 scene boundaries at ~3s and ~6s in real video, threshold comparison, auto-insert scene 0, sorted/deduplicated results, real FFmpeg stderr parsing.

---

## Subtask 2.3: Claude Vision Frame Analysis ✅ DONE

**What**: `POST /api/claude/analyze/:projectId/frames`

**Implementation file**: `electron/claude/claude-vision-handler.ts` (321 lines)

Sends extracted frames to Claude's vision API for rich content understanding (objects, text, actions, composition).

**What was implemented**:
- ✅ `FrameAnalysis` type with timestamp, objects, text, description, mood, composition
- ✅ Extract frames via FFmpeg at specified timestamps or interval
- ✅ Batch send to Claude Vision API (`claude-sonnet-4-5-20250929`)
- ✅ Max 20 images per request (MAX_FRAMES_PER_REQUEST)
- ✅ Frame downscaling to 1280×720 for cost efficiency
- ✅ Custom prompt support
- ✅ Uses `getDecryptedApiKeys()` for Anthropic API key
- ✅ Robust JSON parsing (handles code blocks, bare JSON, etc.)
- ✅ Defaults to single frame at 0s when no timestamps/interval provided

**API contract** — matches spec exactly.

**Test file**: `electron/__tests__/claude-vision-handler.test.ts` (8 unit tests passing)

| Spec'd test | Status | Notes |
|---|---|---|
| Extracts frames at specified timestamps | ✅ | Integration test extracts real JPEG frames at multiple timestamps |
| Sends frames to Claude Vision API (mocked) | ⚠️ | API call code exists; not mock-tested (needs fetch mock) |
| Parses structured response into FrameAnalysis | ✅ | JSON, code-block, and malformed input tested |
| Handles interval-based extraction | ⚠️ | `resolveTimestamps` logic exists but not directly unit-tested |
| Respects 20-image batch limit | ✅ | Tested via parser with 25 items |
| Falls back gracefully when API key missing | ⚠️ | Error thrown in code; not explicitly tested |

**Integration tests** (`stage2-integration.test.ts`): 4 tests — extracts real JPEG frames at various timestamps, multi-frame extraction, validates JPEG magic bytes (FF D8 FF).

---

## Subtask 2.4: Filler Detection HTTP Endpoint ✅ DONE

**What**: `POST /api/claude/analyze/:projectId/fillers`

**Implementation file**: `electron/claude/claude-filler-handler.ts` (100 lines)

Exposes the existing filler word analysis over HTTP, returning word-level filter decisions.

**What was implemented**:
- ✅ Thin HTTP wrapper around `analyzeFillersWithPriority()` from `ai-filler-handler.ts`
- ✅ Separates filler words and silence gaps in response
- ✅ Computes totalFillerTime and totalSilenceTime
- ✅ 1.0s silence threshold
- ✅ All 5 spec'd tests passing

**API contract** — matches spec exactly.

**Test file**: `electron/__tests__/claude-filler-handler-http.test.ts` (5 tests passing)

| Spec'd test | Status | Notes |
|---|---|---|
| Analyzes word list and returns filler detections | ✅ | |
| Detects silence gaps above threshold | ✅ | |
| Returns total filler/silence time | ✅ | |
| Handles empty word list | ✅ | |
| Tri-provider fallback works (Gemini → Claude → pattern) | ✅ | Tested with no API keys → pattern fallback |

---

## File Impact Summary

| File | Change Type | Est. | Actual | Status |
|---|---|---|---|---|
| `electron/claude/claude-http-server.ts` | Edit | +25 | +75 (4 routes + imports) | ✅ |
| `electron/claude/claude-transcribe-handler.ts` | **New** | — | 467 lines | ✅ |
| `electron/claude/claude-scene-handler.ts` | **New** | ~280 | 347 lines | ✅ |
| `electron/claude/claude-vision-handler.ts` | **New** | ~230 | 321 lines | ✅ |
| `electron/claude/claude-filler-handler.ts` | **New** | — | 100 lines | ✅ |
| `electron/types/claude-api.ts` | Edit | +40 | +117 lines | ✅ |
| `electron/__tests__/claude-transcribe-handler.test.ts` | **New** | ~130 | 6 tests | ✅ |
| `electron/__tests__/claude-scene-handler.test.ts` | **New** | ~150 | 9 tests | ✅ |
| `electron/__tests__/claude-vision-handler.test.ts` | **New** | ~140 | 8 tests | ✅ |
| `electron/__tests__/claude-filler-handler-http.test.ts` | **New** | ~100 | 5 tests | ✅ |
| `electron/__tests__/stage2-integration.test.ts` | **New** | — | 12 tests | ✅ |
| `apps/web/src/test/e2e/fixtures/media/test-scenes.mp4` | **New** | — | Test fixture | ✅ |

> **Note**: Original spec didn't list `claude-transcribe-handler.ts` or `claude-filler-handler.ts` as new files (implied they'd be inline in the HTTP server), but were extracted into separate handler files following the existing codebase pattern.

---

## Pipeline Flow After Stage 2

```
Video File
  ├── Transcribe (2.1) → words + timestamps          ✅ DONE
  │     └── Filler Detection (2.4) → filler/silence   ✅ DONE
  ├── Scene Detection (2.2) → scene boundaries         ✅ DONE
  └── Frame Analysis (2.3) → visual content            ✅ DONE
        ↓
  Combined understanding → Stage 3 (cut list generation)
```

---

## Integration Test Suite (2026-02-19)

**File**: `electron/__tests__/stage2-integration.test.ts` — 12 tests using real FFmpeg

**Test video**: `apps/web/src/test/e2e/fixtures/media/test-scenes.mp4`
- 9 seconds, 640x360, H.264 + AAC audio
- 3 distinct color scenes: red (0-3s), blue (3-6s), green (6-9s)
- 440Hz sine wave audio track

| Test | What it verifies |
|---|---|
| Scene: detects 2 boundaries at ~3s and ~6s | Real FFmpeg scene filter works on color transitions |
| Scene: higher threshold = fewer scenes | Threshold parameter affects detection sensitivity |
| Scene: auto-inserts scene at timestamp 0 | First-frame insertion logic |
| Scene: sorted and deduplicated results | Post-processing pipeline |
| Scene: parses real FFmpeg stderr | `parseShowInfoOutput()` handles real `showinfo` output |
| Frame: extracts frame at t=0 | FFmpeg frame extraction produces non-empty file |
| Frame: extracts frame at t=4.5 (blue) | Mid-scene extraction works |
| Frame: extracts 6 frames at multiple timestamps | Sequential multi-frame extraction |
| Frame: valid JPEG magic bytes (FF D8 FF) | Output is a real JPEG file |
| Audio: extracts MP3 from video | `extractAudio()` produces MP3 file |
| Audio: valid MP3 magic bytes | Output is a real MP3 file |
| Audio: reasonable file size (~5-100KB for 9s) | Not empty, not unreasonably large |

**Mocking strategy**: Only Electron internals (app, ipcMain, electron-log) are mocked. FFmpeg, fs, and child_process are all REAL.

---

## Remaining Gaps

### Priority 1 — Functional gaps

| Gap | Severity | Details |
|---|---|---|
| **2.1: No async job pattern** | Medium | Transcription is synchronous. HTTP server has 30s default timeout. Long videos (>5min) will timeout. Spec called for job ID + poll pattern like Stage 1 generate. |
| **2.3: `resolveTimestamps` not unit-tested** | Low | Interval-based frame extraction logic exists but has no dedicated test. Integration test only covers explicit timestamps. |
| **2.3: API key missing fallback not tested** | Low | Code throws error when Anthropic API key is missing, but no test verifies this path. |

### Priority 2 — API mock gaps (no live API testing)

| Gap | Severity | Details |
|---|---|---|
| **2.1: No mocked ElevenLabs/Gemini API response** | Medium | Unit tests hit the network boundary and fail; no mock validates the full response-parsing pipeline end-to-end. |
| **2.2: No mocked Gemini AI enrichment** | Medium | Tier 2 AI scene analysis code exists but is never exercised in tests. Needs Gemini SDK mock. |
| **2.3: No mocked Claude Vision API call** | Medium | `analyzeFramesWithClaude()` is never tested with a mocked `fetch` response. |
| **2.1: No word-level timestamp validation** | Low | Types are defined but no test verifies the ElevenLabs → `TranscriptionWord` mapping with realistic mock data. |

### Priority 3 — Edge cases

| Gap | Severity | Details |
|---|---|---|
| **2.1: Timeout not tested** | Low | `TRANSCRIPTION_TIMEOUT_MS` (5 min) is set but not validated in tests. |
| **2.2: Very long video performance** | Low | Scene detection on 1hr+ video not tested. 3-minute timeout exists but untested. |
| **2.3: 20-frame limit enforcement** | Low | `MAX_FRAMES_PER_REQUEST` is tested in parser but not in the full `analyzeFrames()` flow. |
| **2.4: No live API filler detection test** | Low | Only pattern fallback is tested. Gemini and Claude filler detection paths require API keys. |

### Not in scope (Stage 3)

- Transcription → cut list automation
- Combined understanding (transcription + scenes + frames) → edit decisions
- Timeline manipulation based on analysis results

