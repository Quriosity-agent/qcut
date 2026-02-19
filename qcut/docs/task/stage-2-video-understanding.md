# Stage 2: Video Understanding

> **Goal**: Let Claude Code transcribe and visually understand video content via QCut APIs
> **Estimated effort**: ~5 hours total across 4 subtasks
> **Dependencies**: Stage 1 Subtask 1.4 (frame extraction) recommended but not required

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

**What's missing**: No visual scene/shot detection. No Claude Vision frame analysis. No HTTP endpoint for transcription (IPC-only). No transcription-to-cut-list automation.

---

## Subtask 2.1: Transcription HTTP Endpoint

**What**: `POST /api/claude/transcribe/:projectId`

Exposes the existing ElevenLabs/Gemini transcription pipeline over HTTP so Claude Code can trigger transcription without the UI.

**Relevant files**:
- `electron/elevenlabs-transcribe-handler.ts` (436 lines) — existing IPC `transcribe:elevenlabs`
- `electron/gemini-transcribe-handler.ts` — existing IPC `transcribe:gemini`
- `electron/claude/claude-http-server.ts` (537 lines) — register new routes
- `electron/types/claude-api.ts` (230 lines) — add transcription types

**Implementation**:
```typescript
// Add to claude-http-server.ts route registration
// POST /api/claude/transcribe/:projectId
// Body: { "mediaId": "media_...", "provider": "elevenlabs" | "gemini", "language"?: "en" }
// Response: { "success": true, "data": { "words": [...], "srt": "...", "duration": 120.5 } }

// Internally:
// 1. Resolve media path from projectId + mediaId
// 2. Extract audio via FFmpeg if video file
// 3. Upload to FAL storage (for ElevenLabs) or send directly (Gemini)
// 4. Call provider API
// 5. Return structured word-level results
```

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

**Note**: Long-running (30s–2min). Return immediately with job ID, poll for completion.

**Test file**: `electron/__tests__/claude-transcribe-handler.test.ts`

**Tests to write**:
- Triggers ElevenLabs transcription for valid media
- Triggers Gemini transcription as alternative
- Returns word-level timestamps
- Handles audio extraction from video
- Rejects invalid media ID
- Times out after 5 minutes

---

## Subtask 2.2: Visual Scene Detection

**What**: `POST /api/claude/analyze/:projectId/scenes`

Detects scene/shot boundaries by extracting keyframes and analyzing visual similarity.

**Relevant files**:
- `electron/claude/claude-analyze-handler.ts` (430 lines) — extend with scene detection
- `electron/ffmpeg-basic-handlers.ts` — reuse frame capture
- `electron/types/claude-api.ts` — add SceneDetection types

**Implementation approach** (two-tier):

**Tier 1 — FFmpeg scene detection (fast, local)**:
```bash
ffmpeg -i input.mp4 -filter:v "select='gt(scene,0.3)',showinfo" -vsync vfr /tmp/frames/%04d.png
```
FFmpeg's built-in `scene` filter detects visual discontinuities. Parse `showinfo` output for timestamps.

**Tier 2 — AI-powered scene analysis (accurate, API cost)**:
Extract frames at detected scene boundaries → send to Claude Vision or Gemini for classification (shot type, content description).

```typescript
// New file: electron/claude/claude-scene-handler.ts (<300 lines)

interface SceneBoundary {
  timestamp: number;
  confidence: number;
  description?: string;      // From AI analysis (Tier 2)
  shotType?: string;          // "wide" | "medium" | "close-up" | "cutaway"
  transitionType?: string;    // "cut" | "dissolve" | "fade"
}

async function detectScenes(
  projectId: string,
  mediaId: string,
  options: { threshold?: number; aiAnalysis?: boolean; model?: string }
): Promise<SceneBoundary[]> {
  // 1. Resolve video path
  // 2. Run FFmpeg scene filter (Tier 1)
  // 3. Parse timestamps from showinfo output
  // 4. If aiAnalysis, extract frames at boundaries
  // 5. Send frames to Claude Vision / Gemini for classification
  // 6. Return merged results
}
```

**API contract**:
```
POST /api/claude/analyze/:projectId/scenes
Body: {
  "mediaId": "media_...",
  "threshold": 0.3,
  "aiAnalysis": true,
  "model": "gemini-2.5-flash"
}
Response: {
  "success": true,
  "data": {
    "scenes": [
      { "timestamp": 0.0, "confidence": 1.0, "description": "Wide shot of city skyline", "shotType": "wide" },
      { "timestamp": 5.2, "confidence": 0.87, "description": "Close-up of person speaking", "shotType": "close-up" }
    ],
    "totalScenes": 12,
    "averageShotDuration": 4.3
  }
}
```

**Test file**: `electron/__tests__/claude-scene-handler.test.ts`

**Tests to write**:
- Detects scene boundaries via FFmpeg filter
- Parses FFmpeg showinfo output correctly
- Returns sorted timestamps with confidence
- AI analysis enriches with descriptions (mock API)
- Handles single-shot video (no scene changes)
- Respects threshold parameter

---

## Subtask 2.3: Claude Vision Frame Analysis

**What**: `POST /api/claude/analyze/:projectId/frames`

Sends extracted frames to Claude's vision API for rich content understanding (objects, text, actions, composition).

**Relevant files**:
- `electron/claude/claude-analyze-handler.ts` — extend or new handler
- `electron/ffmpeg-basic-handlers.ts` — reuse frame capture
- `electron/types/claude-api.ts` — add FrameAnalysis types

**Implementation**:
```typescript
// New file: electron/claude/claude-vision-handler.ts (<250 lines)

interface FrameAnalysis {
  timestamp: number;
  objects: string[];          // ["person", "desk", "microphone"]
  text: string[];             // OCR results
  description: string;        // Natural language description
  mood: string;               // "energetic" | "calm" | "dramatic"
  composition: string;        // "rule-of-thirds" | "centered" | "off-center"
}

async function analyzeFrames(
  projectId: string,
  mediaId: string,
  options: {
    timestamps?: number[];    // Specific frames, or...
    interval?: number;        // ...extract every N seconds
    prompt?: string;          // Custom analysis prompt
  }
): Promise<FrameAnalysis[]> {
  // 1. Extract frames at timestamps or interval
  // 2. Batch send to Claude Vision API (max 20 images per request)
  // 3. Parse structured response
  // 4. Return per-frame analysis
}
```

**API key**: Reuse existing `ANTHROPIC_API_KEY` from secure storage or `getDecryptedApiKeys()`.

**Cost awareness**: Each frame analysis costs ~$0.01-0.03. Default to 1 frame per scene boundary (from 2.2), not every second.

**Test file**: `electron/__tests__/claude-vision-handler.test.ts`

**Tests to write**:
- Extracts frames at specified timestamps
- Sends frames to Claude Vision API (mocked)
- Parses structured response into FrameAnalysis
- Handles interval-based extraction
- Respects 20-image batch limit
- Falls back gracefully when API key missing

---

## Subtask 2.4: Filler Detection HTTP Endpoint

**What**: `POST /api/claude/analyze/:projectId/fillers`

Exposes the existing filler word analysis over HTTP, returning word-level filter decisions.

**Relevant files**:
- `electron/ai-filler-handler.ts` — existing IPC `ai-filler:analyze`
- `electron/claude/claude-http-server.ts` — register route
- `apps/web/src/stores/word-timeline-store.ts` — existing FilterState types

**Implementation**: Thin HTTP wrapper around existing IPC handler.

```
POST /api/claude/analyze/:projectId/fillers
Body: { "mediaId": "media_...", "words": [...] }
Response: {
  "success": true,
  "data": {
    "fillers": [{ "word": "um", "start": 2.1, "end": 2.4, "reason": "filler_word" }],
    "silences": [{ "start": 5.0, "end": 7.2, "duration": 2.2 }],
    "totalFillerTime": 8.5,
    "totalSilenceTime": 12.3
  }
}
```

**Note**: Requires transcription results as input. Can chain: transcribe → fillers → cut list (Stage 3).

**Test file**: `electron/__tests__/claude-filler-handler-http.test.ts`

**Tests to write**:
- Analyzes word list and returns filler detections
- Detects silence gaps above threshold
- Returns total filler/silence time
- Handles empty word list
- Tri-provider fallback works (Gemini → Claude → pattern)

---

## File Impact Summary

| File | Change Type | Lines Added (est.) |
|---|---|---|
| `electron/claude/claude-http-server.ts` | Edit | +25 (4 new routes) |
| `electron/claude/claude-scene-handler.ts` | **New** | ~280 |
| `electron/claude/claude-vision-handler.ts` | **New** | ~230 |
| `electron/types/claude-api.ts` | Edit | +40 (new types) |
| `electron/__tests__/claude-transcribe-handler.test.ts` | **New** | ~130 |
| `electron/__tests__/claude-scene-handler.test.ts` | **New** | ~150 |
| `electron/__tests__/claude-vision-handler.test.ts` | **New** | ~140 |
| `electron/__tests__/claude-filler-handler-http.test.ts` | **New** | ~100 |

---

## Pipeline Flow After Stage 2

```
Video File
  ├── Transcribe (2.1) → words + timestamps
  │     └── Filler Detection (2.4) → filler/silence intervals
  ├── Scene Detection (2.2) → scene boundaries + shot types
  └── Frame Analysis (2.3) → visual content understanding
        ↓
  Combined understanding → Stage 3 (cut list generation)
```
