# Editing API Reference — Cuts, Auto-Edit, Range Delete, Suggestions

Base URL: `http://127.0.0.1:8765/api/claude`

## Types

```typescript
// Cut List
interface CutInterval { start: number; end: number }
interface BatchCutRequest { elementId: string; cuts: CutInterval[]; ripple?: boolean }
interface BatchCutResponse {
  cutsApplied: number; elementsRemoved: number;
  remainingElements: { id: string; startTime: number; duration: number }[];
  totalRemovedDuration: number;
}

// Range Delete
interface ClaudeRangeDeleteRequest {
  startTime: number; endTime: number; trackIds?: string[];
  ripple?: boolean; crossTrackRipple?: boolean;
}
interface ClaudeRangeDeleteResponse { deletedElements: number; splitElements: number; totalRemovedDuration: number }

// Auto-Edit
interface AutoEditRequest {
  elementId: string; mediaId: string;
  removeFillers?: boolean; removeSilences?: boolean;
  silenceThreshold?: number;   // Default: 1.5s
  keepSilencePadding?: number; // Default: 0.3s
  dryRun?: boolean;
  provider?: "elevenlabs" | "gemini"; language?: string;
}
interface AutoEditCutInfo extends CutInterval { reason: string }
interface AutoEditResponse {
  transcription: { wordCount: number; duration: number };
  analysis: { fillerCount: number; silenceCount: number };
  cuts: AutoEditCutInfo[]; applied: boolean;
  result?: BatchCutResponse;
}
interface AutoEditJob {
  jobId: string; projectId: string; mediaId: string; elementId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number; message: string; result?: AutoEditResponse;
  createdAt: number; updatedAt: number;
}

// Cut Suggestions
interface CutSuggestion {
  type: "filler" | "silence" | "scene_transition" | "pacing";
  start: number; end: number; reason: string;
  confidence: number; // 0-1
  word?: string;
}
interface SuggestCutsRequest {
  mediaId: string; provider?: string; language?: string; sceneThreshold?: number;
  includeFillers?: boolean; includeSilences?: boolean; includeScenes?: boolean;
}
interface SuggestCutsResponse {
  suggestions: CutSuggestion[];
  summary: { fillerCount: number; silenceCount: number; sceneTransitionCount: number; estimatedTimeRemoved: number };
  transcription?: { wordCount: number; duration: number };
  scenes?: { totalScenes: number; averageShotDuration: number };
}
interface SuggestCutsJob {
  jobId: string; projectId: string; mediaId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number; message: string; result?: SuggestCutsResponse;
  createdAt: number; updatedAt: number;
}
```

## Batch Cuts Endpoint

Remove multiple time intervals from a single element. Validates no overlapping intervals and `start < end`.

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elementId":"EL_ID","cuts":[{"start":2,"end":3},{"start":6,"end":7}]}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/cuts | jq
```

## Range Delete Endpoint

Delete all content within a time range across tracks. Supports ripple and cross-track ripple.

```bash
curl -s -X DELETE -H "Content-Type: application/json" \
  -d '{"startTime":5,"endTime":10,"ripple":true,"crossTrackRipple":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/range | jq

# Scoped to specific tracks
curl -s -X DELETE -H "Content-Type: application/json" \
  -d '{"startTime":5,"endTime":10,"trackIds":["track_1"],"ripple":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/range | jq
```

## Auto-Edit Endpoints

### Sync (short videos only)

```bash
# Dry run — preview cuts without applying
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elementId":"EL_ID","mediaId":"MEDIA_ID","removeFillers":true,"removeSilences":true,"dryRun":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit | jq

# Execute
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elementId":"EL_ID","mediaId":"MEDIA_ID","removeFillers":true,"removeSilences":true,"dryRun":false}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit | jq
```

### Async (long videos)

```bash
# Start
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elementId":"EL_ID","mediaId":"MEDIA_ID","removeFillers":true,"removeSilences":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit/start | jq

# Poll / List / Cancel
curl -s http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit/jobs/$JOB_ID | jq
curl -s http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit/jobs | jq
curl -s -X POST http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit/jobs/$JOB_ID/cancel | jq
```

## Cut Suggestion Endpoints

### Sync (short videos only)

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","includeFillers":true,"includeSilences":true,"includeScenes":true}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts | jq
```

### Async (long videos)

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","includeFillers":true,"includeSilences":true}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts/start | jq

curl -s http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts/jobs/$JOB_ID | jq
curl -s http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts/jobs | jq
curl -s -X POST http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts/jobs/$JOB_ID/cancel | jq
```

## Typical Workflow: Analyze then Auto-Edit

```bash
# 1. Get cut suggestions (read-only)
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","includeFillers":true,"includeSilences":true}' \
  http://127.0.0.1:8765/api/claude/analyze/$PROJECT_ID/suggest-cuts | jq

# 2. Preview auto-edit (dry run)
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elementId":"EL_ID","mediaId":"MEDIA_ID","removeFillers":true,"removeSilences":true,"dryRun":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit | jq

# 3. Apply auto-edit
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elementId":"EL_ID","mediaId":"MEDIA_ID","removeFillers":true,"removeSilences":true,"dryRun":false}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/auto-edit | jq

# All operations are undoable with Ctrl+Z in QCut
```
