# Stage 2: Video Understanding

> **Goal**: Let Claude Code transcribe and visually understand video content via QCut APIs
> **Status**: IMPLEMENTED + TESTED (2026-02-20)
> **Tests**: 68 unit/mock tests passing, live API tests below

---

## Live API Test Results (2026-02-20)

Tested against running QCut instance (localhost:8765) with real media files.

| # | Endpoint | Input | Result | Details |
|---|----------|-------|--------|---------|
| 1 | `POST /media/:pid/import` | transcribe.mp4 (9.5min, 1080p) | **PASS** | Imported as `media_dHJhbnNjcmliZS5tcDQ` |
| 2 | `POST /transcribe/:pid` | 5s test video (sine wave) | **PASS** | 1 word, lang=eng, duration=4.979s |
| 3 | `POST /transcribe/:pid` | 9.5min real speech audio | **FAIL** | 30s HTTP timeout — empty response |
| 4 | `aicp transcribe` CLI | 9.5min real speech (MP3) | **PASS** | 2970 words, $0.07, 33s processing |
| 5 | `POST /analyze/:pid/scenes` | 5s solid-red video | **PASS** | 1 scene at t=0 (no changes, correct) |
| 6 | `POST /analyze/:pid/scenes` | 9.5min real video | **FAIL** | 30s HTTP timeout |
| 7 | `POST /analyze/:pid/frames` | 5s video, t=[0,2] | **FAIL** | "Anthropic API key not configured" |
| 8 | `POST /analyze/:pid/frames` | 9.5min video, t=[0,30,60] | **FAIL** | "Anthropic API key not configured" |
| 9 | `POST /analyze/:pid/fillers` | 17 words with "um" + 1.5s gap | **PASS** | Found 1 filler ("um"), 1 silence (2.5-4s) |
| 10 | `aicp analyze-video` CLI | 5s test video, timeline type | **PASS** | Detailed markdown output, $0.009 |
| 11 | `aicp analyze-video` CLI | real video, describe type | **FAIL** | Missing `google-generativeai` in binary |

### Failure Analysis

| Failure | Root Cause | Fix |
|---------|-----------|-----|
| **#3, #6: HTTP timeout** | 30s global HTTP timeout vs 5min/3min handler timeouts | Async job pattern added (code done, needs QCut restart) |
| **#7, #8: No Anthropic key** | API key not configured in Settings | Expected — user must add key |
| **#11: Missing module** | `google-generativeai` not in PyInstaller spec | Need to add to `aicp.spec` hiddenimports |

### AICP Binary Fixes Applied

The bundled AICP binary (`resources/bin/aicp`) was missing modules. Fixed in `packages/video-agent-skill/aicp.spec`:

| Module | Command Affected | Status |
|--------|-----------------|--------|
| `fal_speech_to_text` | `aicp transcribe` | **Fixed** — added to pathex + hiddenimports |
| `video_utils` | `aicp analyze-video` (timeline) | **Fixed** — added to pathex + hiddenimports |
| `google-generativeai` | `aicp analyze-video` (describe) | **Not fixed** — needs separate addition |

Binary rebuilt and copied to `resources/bin/aicp` and `electron/resources/bin/aicp/darwin-arm64/aicp`.

---

## Subtask 2.1: Transcription HTTP Endpoint

**Endpoints**:
- `POST /api/claude/transcribe/:projectId` — sync (works for short audio <30s processing)
- `POST /api/claude/transcribe/:projectId/start` — async, returns `{ jobId }` (code added, needs restart)
- `GET /api/claude/transcribe/:projectId/jobs/:jobId` — poll status
- `GET /api/claude/transcribe/:projectId/jobs` — list all jobs
- `POST /api/claude/transcribe/:projectId/jobs/:jobId/cancel` — cancel job

**Implementation**: `electron/claude/claude-transcribe-handler.ts`

**Live test**: PASS on short video. FAIL on 9.5min audio (30s HTTP timeout). Async pattern implemented in code to fix this.

**AICP CLI transcription**: PASS after binary fix. `aicp transcribe -i audio.mp3` works via FAL + ElevenLabs Scribe v2. Note: AICP does NOT auto-extract audio from video — must pass audio file directly.

**Unit tests**: 17 passing (6 original + 6 async lifecycle + 5 ElevenLabs API mocks)

---

## Subtask 2.2: Visual Scene Detection

**Endpoint**: `POST /api/claude/analyze/:projectId/scenes`

**Implementation**: `electron/claude/claude-scene-handler.ts`

**Live test**: PASS on 5s video (correctly found 1 scene). FAIL on 9.5min video (30s HTTP timeout — FFmpeg scene detection takes >30s on long videos).

**Unit tests**: 15 passing (5 parseShowInfo + 4 detectScenes + 3 mocked FFmpeg + 3 mocked Gemini AI)

---

## Subtask 2.3: Claude Vision Frame Analysis

**Endpoint**: `POST /api/claude/analyze/:projectId/frames`

**Implementation**: `electron/claude/claude-vision-handler.ts`

**Live test**: FAIL — "Anthropic API key not configured." Frame extraction via FFmpeg works (error happens after extraction, at the API call step). Requires user to configure Anthropic API key in Settings.

**Unit tests**: 19 passing (5 parseResponse + 4 analyzeFrames + 4 mocked API + 7 resolveTimestamps)

---

## Subtask 2.4: Filler Detection HTTP Endpoint

**Endpoint**: `POST /api/claude/analyze/:projectId/fillers`

**Implementation**: `electron/claude/claude-filler-handler.ts`

**Live test**: PASS — correctly identified "um" as filler word, detected 1.5s silence gap at 2.5-4s. No API keys required (pattern fallback works).

**Unit tests**: 5 passing

---

## AICP Video Analysis

**Endpoint**: `POST /api/claude/analyze/:projectId`

**Implementation**: `electron/claude/claude-analyze-handler.ts` (spawns AICP binary)

**Live test (CLI)**: PASS for `timeline` analysis type via FAL. Returns detailed second-by-second markdown. FAIL for `describe` type (missing `google-generativeai` in binary).

**Note**: The QCut HTTP endpoint calls whichever AICP binary `AIPipelineManager` resolves. Running instance has old binary — needs restart after binary update.

---

## Test Count Summary

| Test File | Tests |
|-----------|-------|
| `claude-transcribe-handler.test.ts` | 17 |
| `claude-scene-handler.test.ts` | 15 |
| `claude-vision-handler.test.ts` | 19 |
| `claude-filler-handler-http.test.ts` | 5 |
| `stage2-integration.test.ts` | 12 |
| **Total** | **68** |

---

## Remaining Issues

| Issue | Severity | Status |
|-------|----------|--------|
| 30s HTTP timeout kills long transcription/scene detection | High | Async job pattern coded, needs QCut restart to activate |
| Frame analysis requires Anthropic API key | Medium | By design — user must configure |
| AICP `describe` type missing `google-generativeai` | Low | Need to add to `aicp.spec` and rebuild |
| Scene detection on 9.5min+ video needs async pattern too | Medium | Not yet implemented (only transcription has async) |
| Async routes not in running QCut instance | Blocker | Need to rebuild/restart QCut electron app |
