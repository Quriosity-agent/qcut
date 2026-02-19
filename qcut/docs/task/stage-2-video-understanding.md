# Stage 2: Video Understanding

> **Goal**: Let Claude Code transcribe and visually understand video content via QCut APIs
> **Estimated effort**: ~5 hours total across 4 subtasks
> **Dependencies**: Stage 1 Subtask 1.4 (frame extraction) recommended but not required
> **Status**: IMPLEMENTED (2026-02-19) — All 4 subtasks complete, 28 tests passing

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

**Test file**: `electron/__tests__/claude-transcribe-handler.test.ts` (6 tests passing)

| Spec'd test | Status | Notes |
|---|---|---|
| Triggers ElevenLabs transcription for valid media | ✅ | Tested (fails at network boundary as expected in unit test) |
| Triggers Gemini transcription as alternative | ✅ | Provider path tested |
| Returns word-level timestamps | ⚠️ | Validated in types; full integration requires live API |
| Handles audio extraction from video | ✅ | Video vs audio path detection tested |
| Rejects invalid media ID | ✅ | |
| Times out after 5 minutes | ⚠️ | Timeout is in code (TRANSCRIPTION_TIMEOUT_MS) but not unit-tested |

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

**Test file**: `electron/__tests__/claude-scene-handler.test.ts` (9 tests passing)

| Spec'd test | Status | Notes |
|---|---|---|
| Detects scene boundaries via FFmpeg filter | ⚠️ | Requires real FFmpeg binary; spawn path tested |
| Parses FFmpeg showinfo output correctly | ✅ | Tested with realistic multi-line stderr |
| Returns sorted timestamps with confidence | ✅ | |
| AI analysis enriches with descriptions (mock API) | ⚠️ | AI enrichment code exists; not mock-tested (needs Gemini SDK mock) |
| Handles single-shot video (no scene changes) | ✅ | Empty showinfo output → empty array |
| Respects threshold parameter | ✅ | Tested (spawn path validated) |

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

**Test file**: `electron/__tests__/claude-vision-handler.test.ts` (8 tests passing)

| Spec'd test | Status | Notes |
|---|---|---|
| Extracts frames at specified timestamps | ⚠️ | Requires real FFmpeg binary; spawn path tested |
| Sends frames to Claude Vision API (mocked) | ⚠️ | API call code exists; not mock-tested (needs fetch mock) |
| Parses structured response into FrameAnalysis | ✅ | JSON, code-block, and malformed input tested |
| Handles interval-based extraction | ⚠️ | `resolveTimestamps` logic exists but not directly unit-tested |
| Respects 20-image batch limit | ✅ | Tested via parser with 25 items |
| Falls back gracefully when API key missing | ⚠️ | Error thrown in code; not explicitly tested |

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

