# QCut API — Complete Reference

Base URL: `http://127.0.0.1:8765`
All endpoints prefixed with `/api/claude/`

---

## Type Definitions

All types defined in `electron/types/claude-api.ts`.

### Response Wrapper

```typescript
interface ClaudeAPIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}
```

### Media Types

```typescript
interface MediaFile {
  id: string;                                    // Deterministic: media_${base64url(name)}
  name: string;
  type: "video" | "audio" | "image";
  path: string;
  size: number;                                  // Bytes
  duration?: number;                             // Seconds
  dimensions?: { width: number; height: number };
  createdAt: number;
  modifiedAt: number;
}

interface MediaMetadata {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  bitrate?: number;
  audio?: { codec: string; sampleRate: number; channels: number };
}
```

### Timeline Types

```typescript
interface ClaudeTimeline {
  name: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  tracks: ClaudeTrack[];
}

interface ClaudeTrack {
  id: string;
  index: number;
  name: string;
  type: string;
  elements: ClaudeElement[];
}

interface ClaudeElement {
  id: string;
  trackIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  type: "video" | "audio" | "image" | "text" | "sticker" | "captions" | "remotion" | "media";
  sourceId?: string;
  sourceName?: string;
  content?: string;
  style?: Record<string, unknown>;
  effects?: string[];
  trim?: { start: number; end: number };
}
```

### Batch Operation Types

```typescript
interface ClaudeBatchAddElementRequest {
  type: string;
  trackId: string;
  startTime: number;
  duration: number;
  mediaId?: string;
  sourceId?: string;
  sourceName?: string;
  content?: string;
  style?: Record<string, unknown>;
}

interface ClaudeBatchAddResponse {
  added: { index: number; success: boolean; elementId?: string; error?: string }[];
  failedCount: number;
}

interface ClaudeBatchUpdateItemRequest {
  elementId: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  trimStart?: number;
  trimEnd?: number;
  content?: string;
  style?: Record<string, unknown>;
}

interface ClaudeBatchUpdateResponse {
  updatedCount: number;
  failedCount: number;
  results: { index: number; success: boolean; error?: string }[];
}

interface ClaudeBatchDeleteItemRequest {
  trackId: string;
  elementId: string;
}

interface ClaudeBatchDeleteResponse {
  deletedCount: number;
  failedCount: number;
  results: { index: number; success: boolean; error?: string }[];
}
```

### Timeline Operation Types

```typescript
interface ClaudeSplitRequest {
  splitTime: number;
  mode?: "split" | "keepLeft" | "keepRight";
}

interface ClaudeSplitResponse {
  secondElementId: string | null;
}

interface ClaudeMoveRequest {
  toTrackId: string;
  newStartTime?: number;
}

interface ClaudeSelectionItem {
  trackId: string;
  elementId: string;
}

type ClaudeArrangeMode = "sequential" | "spaced" | "manual";

interface ClaudeArrangeRequest {
  trackId: string;
  mode: ClaudeArrangeMode;
  gap?: number;
  order?: string[];        // Element IDs for manual mode
  startOffset?: number;
}

interface ClaudeArrangeResponse {
  arranged: { elementId: string; newStartTime: number }[];
}

interface ClaudeRangeDeleteRequest {
  startTime: number;
  endTime: number;
  trackIds?: string[];
  ripple?: boolean;
  crossTrackRipple?: boolean;
}

interface ClaudeRangeDeleteResponse {
  deletedElements: number;
  splitElements: number;
  totalRemovedDuration: number;
}
```

### Cut List Types (Stage 3)

```typescript
interface CutInterval {
  start: number;
  end: number;
}

interface BatchCutRequest {
  elementId: string;
  cuts: CutInterval[];
  ripple?: boolean;
}

interface BatchCutResponse {
  cutsApplied: number;
  elementsRemoved: number;
  remainingElements: { id: string; startTime: number; duration: number }[];
  totalRemovedDuration: number;
}
```

### Auto-Edit Types (Stage 3)

```typescript
interface AutoEditRequest {
  elementId: string;
  mediaId: string;
  removeFillers?: boolean;
  removeSilences?: boolean;
  silenceThreshold?: number;      // Default: 1.5s
  keepSilencePadding?: number;    // Default: 0.3s
  dryRun?: boolean;
  provider?: "elevenlabs" | "gemini";
  language?: string;
}

interface AutoEditCutInfo extends CutInterval {
  reason: string;
}

interface AutoEditResponse {
  transcription: { wordCount: number; duration: number };
  analysis: { fillerCount: number; silenceCount: number };
  cuts: AutoEditCutInfo[];
  applied: boolean;
  result?: BatchCutResponse;
}

interface AutoEditJob {
  jobId: string;
  projectId: string;
  mediaId: string;
  elementId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  result?: AutoEditResponse;
  createdAt: number;
  updatedAt: number;
}
```

### Cut Suggestion Types (Stage 3)

```typescript
interface CutSuggestion {
  type: "filler" | "silence" | "scene_transition" | "pacing";
  start: number;
  end: number;
  reason: string;
  confidence: number;             // 0-1
  word?: string;
}

interface SuggestCutsRequest {
  mediaId: string;
  provider?: string;
  language?: string;
  sceneThreshold?: number;
  includeFillers?: boolean;
  includeSilences?: boolean;
  includeScenes?: boolean;
}

interface SuggestCutsResponse {
  suggestions: CutSuggestion[];
  summary: {
    fillerCount: number;
    silenceCount: number;
    sceneTransitionCount: number;
    estimatedTimeRemoved: number;
  };
  transcription?: { wordCount: number; duration: number };
  scenes?: { totalScenes: number; averageShotDuration: number };
}

interface SuggestCutsJob {
  jobId: string;
  projectId: string;
  mediaId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  result?: SuggestCutsResponse;
  createdAt: number;
  updatedAt: number;
}
```

### Transcription Types (Stage 2)

```typescript
interface TranscriptionWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  type?: "word" | "spacing" | "audio_event" | "punctuation";
}

interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
}

interface TranscriptionResult {
  words: TranscriptionWord[];
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
}

interface TranscribeRequest {
  mediaId: string;
  provider?: string;
  language?: string;
  diarize?: boolean;
}

interface TranscribeJob {
  jobId: string;
  projectId: string;
  mediaId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  provider?: string;
  result?: TranscriptionResult;
  createdAt: number;
  updatedAt: number;
}
```

### Scene Detection Types (Stage 2)

```typescript
interface SceneBoundary {
  timestamp: number;
  confidence: number;
  description?: string;
  shotType?: "wide" | "medium" | "close-up" | "cutaway" | "unknown";
  transitionType?: "cut" | "dissolve" | "fade" | "unknown";
}

interface SceneDetectionRequest {
  mediaId: string;
  threshold?: number;
  aiAnalysis?: boolean;
  model?: string;
}

interface SceneDetectionResult {
  scenes: SceneBoundary[];
  totalScenes: number;
  averageShotDuration: number;
}

interface SceneDetectionJob {
  jobId: string;
  projectId: string;
  mediaId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  result?: SceneDetectionResult;
  createdAt: number;
  updatedAt: number;
}
```

### Frame Analysis Types (Stage 2)

```typescript
interface FrameAnalysis {
  timestamp: number;
  objects: string[];
  text: string[];
  description: string;
  mood?: string;
  composition?: string;
}

interface FrameAnalysisRequest {
  mediaId: string;
  timestamps?: number[];
  interval?: number;
  prompt?: string;
}

interface FrameAnalysisResult {
  frames: FrameAnalysis[];
  totalFramesAnalyzed: number;
}

interface FrameAnalysisJob {
  jobId: string;
  projectId: string;
  mediaId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  result?: FrameAnalysisResult;
  createdAt: number;
  updatedAt: number;
}
```

### Filler Detection Types (Stage 2)

```typescript
interface FillerWord {
  word: string;
  start: number;
  end: number;
  reason: string;
}

interface SilenceGap {
  start: number;
  end: number;
  duration: number;
}

interface FillerAnalysisRequest {
  mediaId: string;
  words?: { id: string; text: string; start: number; end: number; type?: string; speaker_id?: string }[];
}

interface FillerAnalysisResult {
  fillers: FillerWord[];
  silences: SilenceGap[];
  totalFillerTime: number;
  totalSilenceTime: number;
}
```

### Project Types

```typescript
interface ProjectSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  backgroundColor: string;
  exportFormat: string;
  exportQuality: string;
}

interface ProjectStats {
  totalDuration: number;
  mediaCount: { video: number; audio: number; image: number };
  trackCount: number;
  elementCount: number;
  lastModified: number;
  fileSize: number;
}

interface ProjectSummary {
  markdown: string;
  stats: { totalDuration: number; mediaCount: number; elementCount: number };
}
```

### Export Types

```typescript
interface ExportPreset {
  id: string;
  name: string;
  platform: string;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
  format: string;
}

interface ExportRecommendation {
  preset: ExportPreset;
  warnings: string[];
  suggestions: string[];
  estimatedFileSize?: string;
}

interface ExportJobRequest {
  preset?: string;
  settings?: { width?: number; height?: number; fps?: number; bitrate?: string; format?: string; codec?: string };
  outputPath?: string;
}

interface ExportJobStatus {
  jobId: string;
  projectId: string;
  status: "queued" | "exporting" | "completed" | "failed";
  progress: number;
  outputPath?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  currentFrame?: number;
  totalFrames?: number;
  timeRemaining?: number;
  duration?: number;
  fileSize?: number;
  presetId?: string;
}
```

### Pipeline Report Types (Stage 5)

```typescript
interface PipelineStep {
  stage: string;
  action: string;
  details: string;
  timestamp: number;
  duration?: number;
  projectId?: string;
  metadata?: Record<string, unknown>;
}

interface PipelineReport {
  markdown: string;
  savedTo?: string;
}
```

### Generate Types (Stage 1)

```typescript
interface GenerateAndAddRequest {
  model: string;
  prompt: string;
  imageUrl?: string;
  videoUrl?: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  negativePrompt?: string;
  addToTimeline?: boolean;
  trackId?: string;
  startTime?: number;
  projectId: string;
}

interface GenerateJobStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  model: string;
  result?: { url?: string; mediaId?: string; elementId?: string };
  createdAt: number;
  updatedAt: number;
}
```

### Import Types

```typescript
interface UrlImportRequest {
  url: string;
  filename?: string;
}

interface BatchImportItem {
  path?: string;
  url?: string;
  filename?: string;
}

interface BatchImportResult {
  index: number;
  success: boolean;
  mediaFile?: MediaFile;
  error?: string;
}

interface FrameExtractRequest {
  timestamp: number;
  format?: "png" | "jpg";
}

interface FrameExtractResult {
  path: string;
  timestamp: number;
  format: string;
}
```

### Diagnostics Types

```typescript
interface ErrorReport {
  message: string;
  stack?: string;
  context: string;
  timestamp: number;
  componentStack?: string;
}

interface DiagnosticResult {
  errorType: string;
  severity: "low" | "medium" | "high" | "critical";
  possibleCauses: string[];
  suggestedFixes: string[];
  canAutoFix: boolean;
  autoFixAction?: string;
  systemInfo: SystemInfo;
}

interface SystemInfo {
  platform: string;
  arch: string;
  osVersion: string;
  appVersion: string;
  nodeVersion: string;
  electronVersion: string;
  memory: { total: number; free: number; used: number };
  cpuCount: number;
}
```

### Video Analysis Types

```typescript
type AnalyzeSource =
  | { type: "timeline"; elementId: string }
  | { type: "media"; mediaId: string }
  | { type: "path"; filePath: string };

interface AnalyzeOptions {
  source: AnalyzeSource;
  analysisType?: "timeline" | "describe" | "transcribe";
  model?: string;
  format?: "md" | "json" | "both";
}

type AnalyzeResult =
  | { success: true; markdown?: string; json?: unknown; outputFiles?: string[]; videoPath: string; duration: number; cost: number }
  | { success: false; error: string; duration: number };

interface AnalyzeModel {
  key: string;
  provider: string;
  modelId: string;
  description: string;
}
```

---

## HTTP REST API — Complete Route Reference

### Health Check

```bash
curl -s http://127.0.0.1:8765/api/claude/health | jq
```

---

### Media Endpoints

#### List media files

```bash
curl -s http://127.0.0.1:8765/api/claude/media/$PROJECT_ID | jq
```

#### Get media info

```bash
curl -s http://127.0.0.1:8765/api/claude/media/$PROJECT_ID/$MEDIA_ID | jq
```

#### Import local file

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"source":"/absolute/path/to/file.mp4"}' \
  http://127.0.0.1:8765/api/claude/media/$PROJECT_ID/import | jq
```

#### Import from URL

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/video.mp4","filename":"custom-name.mp4"}' \
  http://127.0.0.1:8765/api/claude/media/$PROJECT_ID/import-from-url | jq
```

#### Batch import (max 20)

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"items":[
    {"path":"/path/to/video1.mp4"},
    {"url":"https://example.com/clip.mp4","filename":"clip.mp4"}
  ]}' \
  http://127.0.0.1:8765/api/claude/media/$PROJECT_ID/batch-import | jq
```

#### Extract video frame

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"timestamp":5.0,"format":"png"}' \
  http://127.0.0.1:8765/api/claude/media/$PROJECT_ID/$MEDIA_ID/extract-frame | jq
```

#### Rename media file

```bash
curl -s -X PATCH -H "Content-Type: application/json" \
  -d '{"newName":"intro-clip"}' \
  http://127.0.0.1:8765/api/claude/media/$PROJECT_ID/$MEDIA_ID/rename | jq
```

#### Delete media file

```bash
curl -s -X DELETE http://127.0.0.1:8765/api/claude/media/$PROJECT_ID/$MEDIA_ID | jq
```

---

### Timeline Endpoints

#### Export timeline

```bash
# JSON
curl -s "http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID?format=json" | jq

# Markdown
curl -s "http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID?format=md" | jq -r '.data'
```

#### Import timeline

```bash
# JSON import
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"data":"{...}","format":"json"}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/import | jq

# Markdown import (with replace mode)
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"data":"# Timeline...","format":"md","replace":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/import | jq
```

#### Add single element

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"type":"text","trackIndex":0,"startTime":5,"endTime":10,"content":"Hello World"}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements | jq
```

#### Batch add elements (max 50)

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elements":[
    {"type":"media","trackId":"TRACK_ID","startTime":0,"duration":5,"sourceName":"clip.mp4"},
    {"type":"text","trackId":"TEXT_TRACK_ID","startTime":0,"duration":3,"content":"Title"}
  ]}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements/batch | jq
```

#### Batch update elements (max 50)

```bash
curl -s -X PATCH -H "Content-Type: application/json" \
  -d '{"updates":[
    {"elementId":"EL_1","startTime":8},
    {"elementId":"EL_2","duration":6},
    {"elementId":"EL_3","content":"Updated Title"}
  ]}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements/batch | jq
```

#### Batch delete elements (max 50)

```bash
curl -s -X DELETE -H "Content-Type: application/json" \
  -d '{"elements":[
    {"trackId":"TRACK_ID","elementId":"EL_1"},
    {"trackId":"TRACK_ID","elementId":"EL_2"}
  ],"ripple":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements/batch | jq
```

#### Split element

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"splitTime":3.5,"mode":"split"}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements/$ELEMENT_ID/split | jq
```

Modes: `split` (two clips), `keepLeft` (trim right), `keepRight` (trim left).

#### Move element

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"toTrackId":"track_2","newStartTime":5.0}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements/$ELEMENT_ID/move | jq
```

#### Arrange elements on track

```bash
# Sequential (back-to-back with gap)
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"trackId":"TRACK_ID","mode":"sequential","gap":0.5,"startOffset":0}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/arrange | jq

# Manual order
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"trackId":"TRACK_ID","mode":"manual","order":["EL_3","EL_1","EL_2"],"gap":0.25}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/arrange | jq
```

#### Selection management

```bash
# Set selection
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elements":[{"trackId":"track_1","elementId":"el_abc"}]}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/selection | jq

# Get selection
curl -s http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/selection | jq

# Clear selection
curl -s -X DELETE http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/selection | jq
```

---

### Cut List & Range Delete Endpoints

#### Batch cuts on element

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elementId":"EL_ID","cuts":[{"start":2,"end":3},{"start":6,"end":7}]}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/cuts | jq
```

Validates: no overlapping intervals, `start < end` required. Adjacent cuts allowed.

#### Range delete

```bash
curl -s -X DELETE -H "Content-Type: application/json" \
  -d '{"startTime":5,"endTime":10,"ripple":true,"crossTrackRipple":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/range | jq

# Scoped to specific tracks
curl -s -X DELETE -H "Content-Type: application/json" \
  -d '{"startTime":5,"endTime":10,"trackIds":["track_1"],"ripple":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/range | jq
```

---

### Auto-Edit Endpoints

#### Sync auto-edit (short videos only)

```bash
# Dry run (preview)
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elementId":"EL_ID","mediaId":"MEDIA_ID","removeFillers":true,"removeSilences":true,"dryRun":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit | jq

# Execute
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elementId":"EL_ID","mediaId":"MEDIA_ID","removeFillers":true,"removeSilences":true,"dryRun":false}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit | jq
```

#### Async auto-edit (long videos)

```bash
# Start job
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elementId":"EL_ID","mediaId":"MEDIA_ID","removeFillers":true,"removeSilences":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit/start | jq

# Poll status
curl -s http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit/jobs/$JOB_ID | jq

# List all jobs
curl -s http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit/jobs | jq

# Cancel job
curl -s -X POST http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit/jobs/$JOB_ID/cancel | jq
```

---

### Transcription Endpoints

#### Sync transcription (short videos)

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID"}' \
  http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID | jq
```

#### Async transcription (long videos)

```bash
# Start job
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID"}' \
  http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/start | jq

# Poll status
curl -s http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/jobs/$JOB_ID | jq

# List all jobs
curl -s http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/jobs | jq

# Cancel job
curl -s -X POST http://127.0.0.1:8765/api/claude/transcribe/$PROJECT_ID/jobs/$JOB_ID/cancel | jq
```

---

### Scene Detection Endpoints

#### Sync scene detection

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","threshold":0.3,"aiAnalysis":true}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/scenes | jq
```

#### Async scene detection

```bash
# Start job
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","threshold":0.3}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/scenes/start | jq

# Poll / List / Cancel
curl -s http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/scenes/jobs/$JOB_ID | jq
curl -s http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/scenes/jobs | jq
curl -s -X POST http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/scenes/jobs/$JOB_ID/cancel | jq
```

---

### Frame Analysis Endpoints

#### Sync frame analysis

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","timestamps":[0,5,10],"prompt":"Describe what you see"}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/frames | jq
```

#### Async frame analysis

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","timestamps":[0,5,10]}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/frames/start | jq

# Poll / List / Cancel
curl -s http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/frames/jobs/$JOB_ID | jq
curl -s http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/frames/jobs | jq
curl -s -X POST http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/frames/jobs/$JOB_ID/cancel | jq
```

---

### Filler Detection Endpoint

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID"}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/fillers | jq
```

Returns `fillers` (words like "um", "uh") and `silences` (gaps > 1.5s).

---

### Cut Suggestion Endpoints

#### Sync suggest-cuts

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","includeFillers":true,"includeSilences":true,"includeScenes":true}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts | jq
```

#### Async suggest-cuts

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","includeFillers":true,"includeSilences":true}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts/start | jq

# Poll / List / Cancel
curl -s http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts/jobs/$JOB_ID | jq
curl -s http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts/jobs | jq
curl -s -X POST http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts/jobs/$JOB_ID/cancel | jq
```

---

### Video Analysis Endpoints (AICP)

```bash
# Analyze video
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"source":{"type":"media","mediaId":"MEDIA_ID"},"analysisType":"timeline","format":"md"}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID | jq

# List available models
curl -s http://127.0.0.1:8765/api/claude/analyze/models | jq
```

---

### Generate Endpoints (AI Generation)

```bash
# Start generation
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"model":"fal-ai/wan","prompt":"A sunset over the ocean","duration":5,"addToTimeline":true,"trackId":"TRACK_ID"}' \
  http://127.0.0.1:8765/api/claude/generate/$PROJECT_ID/start | jq

# Poll job
curl -s http://127.0.0.1:8765/api/claude/generate/$PROJECT_ID/jobs/$JOB_ID | jq

# List jobs
curl -s http://127.0.0.1:8765/api/claude/generate/$PROJECT_ID/jobs | jq

# Cancel job
curl -s -X POST http://127.0.0.1:8765/api/claude/generate/$PROJECT_ID/jobs/$JOB_ID/cancel | jq

# List models
curl -s http://127.0.0.1:8765/api/claude/generate/models | jq

# Estimate cost
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"model":"fal-ai/wan","duration":5}' \
  http://127.0.0.1:8765/api/claude/generate/estimate-cost | jq
```

---

### Project Endpoints

#### Get settings

```bash
curl -s http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/settings | jq
```

#### Update settings

```bash
curl -s -X PATCH -H "Content-Type: application/json" \
  -d '{"name":"My Video","fps":60,"width":3840,"height":2160}' \
  http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/settings | jq
```

#### Get stats

```bash
curl -s http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/stats | jq
```

#### Get project summary

```bash
curl -s http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/summary | jq -r '.data.markdown'
```

Returns a comprehensive markdown summary with project settings, media files, timeline overview, and export info.

#### Generate pipeline report

```bash
# Get report (in-memory)
curl -s -X POST -H "Content-Type: application/json" \
  -d '{}' \
  http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/report | jq -r '.data.markdown'

# Save to disk
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"saveTo":"/tmp/","clearLog":false}' \
  http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/report | jq

# Save and clear operation log
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"saveTo":"/tmp/","clearLog":true}' \
  http://127.0.0.1:8765/api/claude/project/$PROJECT_ID/report | jq
```

---

### Export Endpoints

#### List presets

```bash
curl -s http://127.0.0.1:8765/api/claude/export/presets | jq
```

| ID | Name | Resolution | FPS | Bitrate |
|----|------|-----------|-----|---------|
| `youtube-4k` | YouTube 4K | 3840x2160 | 60 | 45Mbps |
| `youtube-1080p` | YouTube 1080p | 1920x1080 | 30 | 8Mbps |
| `youtube-720p` | YouTube 720p | 1280x720 | 30 | 5Mbps |
| `tiktok` | TikTok | 1080x1920 | 30 | 6Mbps |
| `instagram-reel` | Instagram Reel | 1080x1920 | 30 | 5Mbps |
| `instagram-post` | Instagram Post | 1080x1080 | 30 | 5Mbps |
| `instagram-landscape` | Instagram Landscape | 1080x566 | 30 | 5Mbps |
| `twitter` | Twitter/X | 1920x1080 | 30 | 6Mbps |
| `linkedin` | LinkedIn | 1920x1080 | 30 | 8Mbps |
| `discord` | Discord (8MB limit) | 1280x720 | 30 | 2Mbps |

#### Get recommendation

```bash
curl -s http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/recommend/tiktok | jq
```

#### Start export job

```bash
# Using preset
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"preset":"youtube-1080p"}' \
  http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/start | jq

# Custom settings
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"settings":{"width":1920,"height":1080,"fps":30,"format":"mp4"}}' \
  http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/start | jq
```

#### Poll export job

```bash
curl -s http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/jobs/$JOB_ID | jq
```

#### List export jobs

```bash
curl -s http://127.0.0.1:8765/api/claude/export/$PROJECT_ID/jobs | jq
```

---

### Diagnostics Endpoint

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"message":"ENOENT: no such file","context":"media-import","timestamp":1707580800000}' \
  http://127.0.0.1:8765/api/claude/diagnostics/analyze | jq
```

| Error Type | Triggers | Severity |
|-----------|----------|----------|
| `file_not_found` | ENOENT, "no such file" | medium |
| `permission_denied` | EACCES, EPERM | high |
| `out_of_memory` | ENOMEM, "heap" | critical |
| `ffmpeg_error` | "ffmpeg" in message/stack/context | medium |
| `network_error` | "network", "fetch", ECONNREFUSED | low |
| `ui_error` | "react" in stack, componentStack present | medium |
| `storage_error` | "indexeddb", "storage", "quota" | high |
| `unknown` | Everything else | medium |

---

## Security

### Path Validation Functions (from `electron/claude/utils/helpers.ts`)

| Function | Purpose |
|----------|---------|
| `isValidSourcePath(path)` | Absolute path, no null bytes |
| `isPathSafe(target, base)` | Target stays within base directory |
| `sanitizeFilename(name)` | Strips `/`, `\`, null bytes, `..` |
| `sanitizeProjectId(id)` | Prevents path traversal in project IDs |

### HTTP Server Security

| Measure | Detail |
|---------|--------|
| Binding | `127.0.0.1` only (no external access) |
| Auth | Optional bearer token (`QCUT_API_TOKEN`) |
| Body limit | 1MB max request body |
| Timeout | 30 seconds per request |
| Port | Default 8765, configurable via `QCUT_API_PORT` |
| CORS | Headers added on all responses |

---

## Electron IPC Reference

For use in renderer process code (React components).

### Namespace: `window.electronAPI.claude`

```typescript
// Media
await window.electronAPI.claude.media.list(projectId);
await window.electronAPI.claude.media.info(projectId, mediaId);
await window.electronAPI.claude.media.import(projectId, sourcePath);
await window.electronAPI.claude.media.delete(projectId, mediaId);
await window.electronAPI.claude.media.rename(projectId, mediaId, newName);

// Timeline
await window.electronAPI.claude.timeline.export(projectId, "json" | "md");
await window.electronAPI.claude.timeline.import(projectId, data, "json" | "md");
await window.electronAPI.claude.timeline.addElement(projectId, element);
await window.electronAPI.claude.timeline.updateElement(projectId, elementId, changes);
await window.electronAPI.claude.timeline.removeElement(projectId, elementId);

// Timeline event listeners (renderer-side)
window.electronAPI.claude.timeline.onRequest(callback);
window.electronAPI.claude.timeline.onApply(callback);
window.electronAPI.claude.timeline.onAddElement(callback);
window.electronAPI.claude.timeline.onUpdateElement(callback);
window.electronAPI.claude.timeline.onRemoveElement(callback);
window.electronAPI.claude.timeline.onSplitElement(callback);
window.electronAPI.claude.timeline.onMoveElement(callback);
window.electronAPI.claude.timeline.onSelectElements(callback);
window.electronAPI.claude.timeline.sendResponse(timeline);
window.electronAPI.claude.timeline.removeListeners();

// Project
await window.electronAPI.claude.project.getSettings(projectId);
await window.electronAPI.claude.project.updateSettings(projectId, settings);
await window.electronAPI.claude.project.getStats(projectId);

// Project event listeners (renderer-side)
window.electronAPI.claude.project.onStatsRequest(callback);
window.electronAPI.claude.project.sendStatsResponse(stats, requestId);
window.electronAPI.claude.project.onUpdated(callback);
window.electronAPI.claude.project.removeListeners();

// Export
await window.electronAPI.claude.export.getPresets();
await window.electronAPI.claude.export.recommend(projectId, target);

// Diagnostics
await window.electronAPI.claude.diagnostics.analyze(errorReport);
```
