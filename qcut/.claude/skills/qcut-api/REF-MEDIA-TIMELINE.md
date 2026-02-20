# Media & Timeline API Reference

Base URL: `http://127.0.0.1:8765/api/claude`

## Types

```typescript
interface ClaudeAPIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

interface MediaFile {
  id: string;                  // Deterministic: media_${base64url(name)}
  name: string;
  type: "video" | "audio" | "image";
  path: string;
  size: number;
  duration?: number;
  dimensions?: { width: number; height: number };
  createdAt: number;
  modifiedAt: number;
}

interface UrlImportRequest { url: string; filename?: string }
interface BatchImportItem { path?: string; url?: string; filename?: string }
interface BatchImportResult { index: number; success: boolean; mediaFile?: MediaFile; error?: string }
interface FrameExtractRequest { timestamp: number; format?: "png" | "jpg" }
interface FrameExtractResult { path: string; timestamp: number; format: string }

interface ClaudeTimeline {
  name: string; duration: number; width: number; height: number; fps: number;
  tracks: ClaudeTrack[];
}
interface ClaudeTrack {
  id: string; index: number; name: string; type: string;
  elements: ClaudeElement[];
}
interface ClaudeElement {
  id: string; trackIndex: number; startTime: number; endTime: number; duration: number;
  type: "video" | "audio" | "image" | "text" | "sticker" | "captions" | "remotion" | "media";
  sourceId?: string; sourceName?: string; content?: string;
  style?: Record<string, unknown>; effects?: string[];
  trim?: { start: number; end: number };
}

// Batch operations
interface ClaudeBatchAddElementRequest {
  type: string; trackId: string; startTime: number; duration: number;
  mediaId?: string; sourceId?: string; sourceName?: string;
  content?: string; style?: Record<string, unknown>;
}
interface ClaudeBatchAddResponse {
  added: { index: number; success: boolean; elementId?: string; error?: string }[];
  failedCount: number;
}
interface ClaudeBatchUpdateItemRequest {
  elementId: string; startTime?: number; endTime?: number; duration?: number;
  trimStart?: number; trimEnd?: number; content?: string; style?: Record<string, unknown>;
}
interface ClaudeBatchUpdateResponse { updatedCount: number; failedCount: number; results: { index: number; success: boolean; error?: string }[] }
interface ClaudeBatchDeleteItemRequest { trackId: string; elementId: string }
interface ClaudeBatchDeleteResponse { deletedCount: number; failedCount: number; results: { index: number; success: boolean; error?: string }[] }

// Timeline operations
interface ClaudeSplitRequest { splitTime: number; mode?: "split" | "keepLeft" | "keepRight" }
interface ClaudeSplitResponse { secondElementId: string | null }
interface ClaudeMoveRequest { toTrackId: string; newStartTime?: number }
interface ClaudeSelectionItem { trackId: string; elementId: string }

type ClaudeArrangeMode = "sequential" | "spaced" | "manual";
interface ClaudeArrangeRequest { trackId: string; mode: ClaudeArrangeMode; gap?: number; order?: string[]; startOffset?: number }
interface ClaudeArrangeResponse { arranged: { elementId: string; newStartTime: number }[] }
```

## Media Endpoints

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

#### Rename / Delete
```bash
curl -s -X PATCH -H "Content-Type: application/json" \
  -d '{"newName":"intro-clip"}' \
  http://127.0.0.1:8765/api/claude/media/$PROJECT_ID/$MEDIA_ID/rename | jq

curl -s -X DELETE http://127.0.0.1:8765/api/claude/media/$PROJECT_ID/$MEDIA_ID | jq
```

## Timeline Endpoints

#### Export timeline
```bash
curl -s "http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID?format=json" | jq
curl -s "http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID?format=md" | jq -r '.data'
```

#### Import timeline
```bash
# JSON
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"data":"{...}","format":"json"}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/import | jq

# Markdown with replace mode
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"data":"# Timeline...","format":"md","replace":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/import | jq
```

#### Add single element
```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"type":"text","trackIndex":0,"startTime":5,"endTime":10,"content":"Hello"}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements | jq
```

#### Batch add (max 50)
```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elements":[
    {"type":"media","trackId":"TRACK_ID","startTime":0,"duration":5,"sourceName":"clip.mp4"},
    {"type":"text","trackId":"TEXT_TRACK_ID","startTime":0,"duration":3,"content":"Title"}
  ]}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements/batch | jq
```

#### Batch update (max 50)
```bash
curl -s -X PATCH -H "Content-Type: application/json" \
  -d '{"updates":[
    {"elementId":"EL_1","startTime":8},
    {"elementId":"EL_2","duration":6}
  ]}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements/batch | jq
```

#### Batch delete (max 50)
```bash
curl -s -X DELETE -H "Content-Type: application/json" \
  -d '{"elements":[{"trackId":"TRACK_ID","elementId":"EL_1"}],"ripple":true}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements/batch | jq
```

#### Split element
```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"splitTime":3.5,"mode":"split"}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements/$ELEMENT_ID/split | jq
```
Modes: `split` (two clips), `keepLeft`, `keepRight`.

#### Move element
```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"toTrackId":"track_2","newStartTime":5.0}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/elements/$ELEMENT_ID/move | jq
```

#### Arrange elements
```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"trackId":"TRACK_ID","mode":"sequential","gap":0.5,"startOffset":0}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/arrange | jq

# Manual order
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"trackId":"TRACK_ID","mode":"manual","order":["EL_3","EL_1","EL_2"],"gap":0.25}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/arrange | jq
```

#### Selection
```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"elements":[{"trackId":"track_1","elementId":"el_abc"}]}' \
  http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/selection | jq

curl -s http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/selection | jq
curl -s -X DELETE http://127.0.0.1:8765/api/claude/timeline/$PROJECT_ID/selection | jq
```
