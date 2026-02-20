# Analysis & Video Understanding API Reference

Base URL: `http://127.0.0.1:8765/api/claude`

## Types

```typescript
// Transcription
interface TranscriptionWord { text: string; start: number; end: number; speaker?: string; type?: "word" | "spacing" | "audio_event" | "punctuation" }
interface TranscriptionSegment { text: string; start: number; end: number }
interface TranscriptionResult { words: TranscriptionWord[]; segments: TranscriptionSegment[]; language: string; duration: number }
interface TranscribeRequest { mediaId: string; provider?: string; language?: string; diarize?: boolean }
interface TranscribeJob {
  jobId: string; projectId: string; mediaId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number; message: string; provider?: string;
  result?: TranscriptionResult; createdAt: number; updatedAt: number;
}

// Scene Detection (sync only — no async job routes)
interface SceneBoundary { timestamp: number; confidence: number; description?: string; shotType?: "wide" | "medium" | "close-up" | "cutaway" | "unknown"; transitionType?: "cut" | "dissolve" | "fade" | "unknown" }
interface SceneDetectionRequest { mediaId: string; threshold?: number; aiAnalysis?: boolean; model?: string }
interface SceneDetectionResult { scenes: SceneBoundary[]; totalScenes: number; averageShotDuration: number }

// Frame Analysis (sync only — provider cascade: Anthropic → OpenRouter)
interface FrameAnalysis { timestamp: number; objects: string[]; text: string[]; description: string; mood?: string; composition?: string }
interface FrameAnalysisRequest { mediaId: string; timestamps?: number[]; interval?: number; prompt?: string }
interface FrameAnalysisResult { frames: FrameAnalysis[]; totalFramesAnalyzed: number }

// Filler Detection
interface FillerWord { word: string; start: number; end: number; reason: string }
interface SilenceGap { start: number; end: number; duration: number }
interface FillerAnalysisRequest { mediaId: string; words?: { id: string; text: string; start: number; end: number; type?: string; speaker_id?: string }[] }
interface FillerAnalysisResult { fillers: FillerWord[]; silences: SilenceGap[]; totalFillerTime: number; totalSilenceTime: number }

// Video Analysis (AICP)
type AnalyzeSource = { type: "timeline"; elementId: string } | { type: "media"; mediaId: string } | { type: "path"; filePath: string };
interface AnalyzeOptions { source: AnalyzeSource; analysisType?: "timeline" | "describe" | "transcribe"; model?: string; format?: "md" | "json" | "both" }
type AnalyzeResult = { success: true; markdown?: string; json?: unknown; videoPath: string; duration: number; cost: number } | { success: false; error: string; duration: number };
interface AnalyzeModel { key: string; provider: string; modelId: string; description: string }
```

## Transcription Endpoints

#### Sync (short videos only, <30s processing)
```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID"}' \
  http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID | jq
```

#### Async (recommended for all videos)
```bash
# Start
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID"}' \
  http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/start | jq

# Poll
curl -s http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/jobs/$JOB_ID | jq

# List all
curl -s http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/jobs | jq

# Cancel
curl -s -X POST http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/jobs/$JOB_ID/cancel | jq
```

## Scene Detection Endpoint (sync only)

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","threshold":0.3,"aiAnalysis":true}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/scenes | jq
```

Returns scenes synchronously. No async job routes available for scene detection.

## Frame Analysis Endpoint (sync only)

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","timestamps":[0,5,10],"prompt":"Describe what you see"}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/frames | jq
```

**Provider cascade:** Tries Anthropic API first, falls back to OpenRouter. Requires at least one API key configured in Settings. If neither is available, returns a descriptive error listing which keys are missing.

## Filler Detection Endpoint

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID"}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/fillers | jq
```

Returns `fillers` (words like "um", "uh") and `silences` (gaps > 1.5s). No API keys required.

## Video Analysis (AICP) Endpoints

```bash
# Analyze video
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"source":{"type":"media","mediaId":"MEDIA_ID"},"analysisType":"timeline","format":"md"}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID | jq

# List models
curl -s http://127.0.0.1:8765/api/claude/analyze/models | jq
```

## Async Job Pattern

All async endpoints follow the same pattern:

```bash
# 1. Start job → returns { jobId }
POST /<handler>/$PROJECT_ID/start

# 2. Poll until status is "completed" or "failed"
GET /<handler>/$PROJECT_ID/jobs/$JOB_ID

# 3. List all jobs
GET /<handler>/$PROJECT_ID/jobs

# 4. Cancel
POST /<handler>/$PROJECT_ID/jobs/$JOB_ID/cancel
```

Job statuses: `queued` -> `running` -> `completed` | `failed` | `cancelled`
