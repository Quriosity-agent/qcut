# Transcription Pipeline Implementation Plan

## Overview

Add end-to-end transcription capability to the Transcribe panel:
1. Accept video or audio input
2. Extract audio from video (if needed) using existing FFmpeg handler
3. Transcribe using FAL AI ElevenLabs Scribe v2
4. Store results in project folder (`media/generated/audio/`)
5. Display word-level timestamps in existing word-timeline panel

## API Reference

### FAL AI ElevenLabs Scribe v2

- **Endpoint:** `fal-ai/elevenlabs/speech-to-text/scribe-v2`
- **Cost:** $0.008/minute (+30% with keyterms)
- **Features:**
  - 99 language support with auto-detection
  - Word-level timestamps (start/end in seconds)
  - Speaker diarization
  - Audio event tagging (laughter, applause, music)

**Input Parameters:**
```typescript
{
  audio_url: string;           // Required - URL to audio file
  language_code?: string;      // Optional - e.g., "eng", "spa"
  diarize?: boolean;           // Default: true - identify speakers
  tag_audio_events?: boolean;  // Default: true - tag laughter, etc.
  keyterms?: string[];         // Optional - bias toward specific words
}
```

**Output Schema:**
```typescript
{
  text: string;                    // Full transcription
  language_code: string;           // Detected/specified language
  language_probability: number;    // Confidence score
  words: Array<{
    text: string;                  // Word or event text
    start: number;                 // Start time in seconds
    end: number;                   // End time in seconds
    type: "word" | "spacing" | "audio_event" | "punctuation";
    speaker_id: string | null;     // Speaker identifier
  }>;
}
```

**JavaScript Example:**
```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/elevenlabs/speech-to-text/scribe-v2", {
  input: {
    audio_url: "https://storage.example.com/audio.mp3",
    diarize: true,
    tag_audio_events: true,
  },
  logs: true,
});
```

---

## Existing Infrastructure (Already Implemented)

| Component | Location | Status |
|-----------|----------|--------|
| Audio extraction | `electron/ffmpeg-handler.ts` | ✅ Ready |
| Word timeline store | `stores/word-timeline-store.ts` | ✅ Ready |
| Word timeline view | `views/word-timeline-view.tsx` | ✅ Ready |
| FAL client pattern | `lib/fal-ai-client.ts` | ✅ Ready |
| Media import | `electron/media-import-handler.ts` | ✅ Ready |

**Existing FFmpeg Audio Extraction:**
```typescript
// Already available in preload.ts
window.electronAPI.ffmpeg.extractAudio({
  videoPath: "/path/to/video.mp4",
  format: "wav"  // Output: 16kHz mono PCM
});
// Returns: { audioPath: string, fileSize: number }
```

---

## Implementation Tasks

### Task 1: Create ElevenLabs Transcription Handler

**File:** `electron/elevenlabs-transcribe-handler.ts`

```typescript
import { ipcMain } from "electron";
import * as fs from "fs/promises";
import * as path from "path";

interface TranscribeOptions {
  audioPath: string;
  language?: string;
  diarize?: boolean;
  tagAudioEvents?: boolean;
}

interface TranscribeResult {
  text: string;
  language_code: string;
  language_probability: number;
  words: Array<{
    text: string;
    start: number;
    end: number;
    type: string;
    speaker_id: string | null;
  }>;
}

export function registerElevenLabsTranscribeHandler(): void {
  // Upload file to FAL storage
  ipcMain.handle("transcribe:upload-to-fal", async (_, filePath: string) => {
    const apiKey = await getApiKey("fal");
    const fileBuffer = await fs.readFile(filePath);
    const fileName = path.basename(filePath);

    // FAL file upload endpoint
    const response = await fetch("https://fal.ai/api/storage/upload", {
      method: "POST",
      headers: {
        "Authorization": `Key ${apiKey}`,
        "Content-Type": "application/octet-stream",
        "X-Filename": fileName,
      },
      body: fileBuffer,
    });

    const { url } = await response.json();
    return { url };
  });

  // Main transcription handler
  ipcMain.handle("transcribe:elevenlabs", async (_, options: TranscribeOptions) => {
    const apiKey = await getApiKey("fal");

    // Step 1: Upload audio to FAL storage
    const fileBuffer = await fs.readFile(options.audioPath);
    const fileName = path.basename(options.audioPath);

    const uploadResponse = await fetch("https://fal.ai/api/storage/upload", {
      method: "POST",
      headers: {
        "Authorization": `Key ${apiKey}`,
        "Content-Type": "application/octet-stream",
        "X-Filename": fileName,
      },
      body: fileBuffer,
    });

    const { url: audioUrl } = await uploadResponse.json();

    // Step 2: Call ElevenLabs Scribe v2
    const transcribeResponse = await fetch(
      "https://fal.run/fal-ai/elevenlabs/speech-to-text/scribe-v2",
      {
        method: "POST",
        headers: {
          "Authorization": `Key ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audio_url: audioUrl,
          language_code: options.language,
          diarize: options.diarize ?? true,
          tag_audio_events: options.tagAudioEvents ?? true,
        }),
      }
    );

    const result: TranscribeResult = await transcribeResponse.json();
    return result;
  });
}
```

**Register in:** `electron/main.ts`
```typescript
import { registerElevenLabsTranscribeHandler } from "./elevenlabs-transcribe-handler";
// In app.whenReady():
registerElevenLabsTranscribeHandler();
```

---

### Task 2: Add Preload API

**File:** `electron/preload.ts` (add to transcribe section)

```typescript
transcribe: {
  // ... existing Gemini methods

  elevenlabs: (options: {
    audioPath: string;
    language?: string;
    diarize?: boolean;
    tagAudioEvents?: boolean;
  }): Promise<{
    text: string;
    language_code: string;
    language_probability: number;
    words: Array<{
      text: string;
      start: number;
      end: number;
      type: string;
      speaker_id: string | null;
    }>;
  }> => ipcRenderer.invoke("transcribe:elevenlabs", options),
},
```

**File:** `apps/web/src/types/electron.d.ts`

Add types for the new API method.

---

### Task 3: Create Transcription Hook

**File:** `apps/web/src/hooks/use-elevenlabs-transcription.ts`

```typescript
import { useState, useCallback } from "react";
import { useWordTimelineStore } from "@/stores/word-timeline-store";

interface TranscriptionOptions {
  language?: string;
  diarize?: boolean;
  tagAudioEvents?: boolean;
}

export function useElevenLabsTranscription() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { loadFromTranscription } = useWordTimelineStore();

  const transcribeMedia = useCallback(async (
    filePath: string,
    options?: TranscriptionOptions
  ) => {
    setIsTranscribing(true);
    setError(null);

    try {
      const ext = filePath.split(".").pop()?.toLowerCase();
      const isVideo = ["mp4", "mov", "avi", "mkv", "webm"].includes(ext || "");

      let audioPath = filePath;

      // Step 1: Extract audio if video
      if (isVideo) {
        setProgress("Extracting audio from video...");
        const result = await window.electronAPI.ffmpeg.extractAudio({
          videoPath: filePath,
          format: "wav",
        });
        audioPath = result.audioPath;
      }

      // Step 2: Transcribe with ElevenLabs
      setProgress("Transcribing audio...");
      const result = await window.electronAPI.transcribe.elevenlabs({
        audioPath,
        language: options?.language,
        diarize: options?.diarize ?? true,
        tagAudioEvents: options?.tagAudioEvents ?? true,
      });

      // Step 3: Load into store
      const fileName = filePath.split(/[/\\]/).pop() || "transcription";
      loadFromTranscription(result, `${fileName}_transcript.json`);

      setProgress("Complete!");
      return result;

    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription failed";
      setError(message);
      throw err;
    } finally {
      setIsTranscribing(false);
    }
  }, [loadFromTranscription]);

  return {
    transcribeMedia,
    isTranscribing,
    progress,
    error,
  };
}
```

---

### Task 4: Update Word Timeline Store

**File:** `apps/web/src/stores/word-timeline-store.ts`

Add new method:

```typescript
// Load from transcription result (not file)
loadFromTranscription: (data: TranscriptionResult, fileName: string) => {
  const words = transformWords(data.words);
  set({
    data: {
      text: data.text,
      language_code: data.language_code,
      language_probability: data.language_probability,
      words,
    },
    fileName,
    selectedWordId: null,
  });
},

// Save current data to project folder
saveToProject: async (projectId: string): Promise<string> => {
  const { data, fileName } = get();
  if (!data || !fileName) throw new Error("No data to save");

  const savePath = `media/generated/audio/${fileName}`;
  await window.electronAPI.mediaImport.saveJson({
    projectId,
    relativePath: savePath,
    data,
  });

  return savePath;
},
```

---

### Task 5: Update Transcribe Panel UI

**File:** `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx`

Add media file selection and transcribe button:

```typescript
// Add to imports
import { useElevenLabsTranscription } from "@/hooks/use-elevenlabs-transcription";

// Inside component:
const { transcribeMedia, isTranscribing, progress, error } = useElevenLabsTranscription();

// Update dropzone to accept media files
const { getRootProps, getInputProps, isDragActive } = useDropzone({
  onDrop,
  accept: {
    "application/json": [".json"],
    "video/*": [".mp4", ".mov", ".avi", ".mkv", ".webm"],
    "audio/*": [".wav", ".mp3", ".m4a", ".aac"],
  },
  maxFiles: 1,
});

// Handle media file drop
const onDrop = useCallback(async (acceptedFiles: File[]) => {
  const file = acceptedFiles[0];
  if (!file) return;

  if (file.name.endsWith(".json")) {
    loadFromJson(file);
  } else {
    // Media file - needs transcription
    await transcribeMedia(file.path);
  }
}, [loadFromJson, transcribeMedia]);

// Add progress/error display in UI
{isTranscribing && (
  <div className="p-4 text-center">
    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
    <p className="text-sm text-muted-foreground">{progress}</p>
  </div>
)}

{error && (
  <div className="p-4 text-center text-destructive">
    <p>{error}</p>
  </div>
)}
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │         Transcribe Panel (word-timeline-view)       │    │
│  │  ┌───────────────────────────────────────────────┐  │    │
│  │  │  Drop video/audio or JSON file here           │  │    │
│  │  └───────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              [Video File]        [Audio File]
                    │                   │
                    ▼                   │
        ┌───────────────────┐           │
        │  FFmpeg Extract   │           │
        │  Audio (16kHz)    │           │
        └─────────┬─────────┘           │
                  │                     │
                  └──────────┬──────────┘
                             ▼
                  ┌───────────────────┐
                  │  Upload to FAL    │
                  │  Storage          │
                  └─────────┬─────────┘
                            ▼
                  ┌───────────────────┐
                  │  ElevenLabs       │
                  │  Scribe v2 API    │
                  │  ($0.008/min)     │
                  └─────────┬─────────┘
                            ▼
                  ┌───────────────────┐
                  │  Word Timeline    │
                  │  JSON Response    │
                  └─────────┬─────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
    ┌───────────────────┐      ┌───────────────────┐
    │  Load into        │      │  Save to project  │
    │  word-timeline    │      │  media/generated/ │
    │  store            │      │  audio/           │
    └─────────┬─────────┘      └───────────────────┘
              ▼
    ┌───────────────────┐
    │  Display words    │
    │  Click → Seek     │
    └───────────────────┘
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `electron/elevenlabs-transcribe-handler.ts` | **Create** | FAL upload + ElevenLabs API handler |
| `electron/main.ts` | Modify | Register new handler |
| `electron/preload.ts` | Modify | Add `transcribe.elevenlabs()` API |
| `apps/web/src/types/electron.d.ts` | Modify | Add TypeScript types |
| `apps/web/src/hooks/use-elevenlabs-transcription.ts` | **Create** | React hook for transcription flow |
| `apps/web/src/stores/word-timeline-store.ts` | Modify | Add `loadFromTranscription`, `saveToProject` |
| `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx` | Modify | Add media input, progress UI |

---

## Verification

### Manual Test
1. Open QCut, go to **Transcribe** tab
2. Drop a video file (MP4 with speech)
3. Verify:
   - Progress shows "Extracting audio..."
   - Progress shows "Transcribing audio..."
   - Words appear in panel
4. Click a word → playhead seeks to that timestamp
5. Check `media/generated/audio/` for saved JSON

### Unit Tests
- `elevenlabs-transcribe-handler.test.ts` - Mock FAL API responses
- `use-elevenlabs-transcription.test.ts` - Test hook state transitions

### Integration Test
- Use short audio sample (< 30 seconds) for cost efficiency
- Verify JSON structure matches expected format

---

## Environment Requirements

```bash
# Required environment variable
VITE_FAL_API_KEY=your_fal_api_key
```

API key can also be stored via QCut's secure API key management (Settings → API Keys).

---

## Cost Estimate

| Audio Duration | Estimated Cost |
|----------------|----------------|
| 1 minute       | $0.008         |
| 10 minutes     | $0.08          |
| 1 hour         | $0.48          |

Note: +30% if using `keyterms` parameter.
