# Transcription Pipeline Implementation Plan

## Overview

Add end-to-end transcription capability to the Transcribe panel:
1. Accept video or audio input
2. Extract audio from video (if needed) using existing FFmpeg handler
3. Transcribe using FAL AI ElevenLabs Scribe v2
4. Store results following QCut's organize-project structure
5. Display word-level timestamps in existing word-timeline panel

## Project Structure Alignment

Following the **organize-project skill** standard structure:

```text
Documents/QCut/Projects/{project-name}/
├── media/
│   ├── imported/              # User-imported source media
│   │   └── video.mp4          # Original video (symlink or copy)
│   ├── generated/             # AI-generated content
│   │   └── transcripts/       # Transcription JSON files
│   │       └── {filename}_{timestamp}_transcript.json
│   └── temp/                  # Temporary processing files
│       └── extracted_audio/   # FFmpeg extracted audio (cleaned up after)
│           └── audio_{timestamp}.wav
└── cache/                     # Processing cache
```

### File Placement Rules

| File Type | Location | Cleanup |
|-----------|----------|---------|
| Source video/audio | `media/imported/` | Keep |
| Extracted audio (WAV) | `media/temp/extracted_audio/` | Delete after transcription |
| Transcription JSON | `media/generated/transcripts/` | Keep |
| Processing cache | `cache/` | Optional cleanup |

### Naming Conventions

- **Extracted audio**: `audio_{timestamp}.wav` (e.g., `audio_20260131_114523.wav`)
- **Transcription JSON**: `{source_filename}_{timestamp}_transcript.json`
  - Example: `interview_20260131_114530_transcript.json`

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
import { useProjectStore } from "@/stores/project-store";

interface TranscriptionOptions {
  language?: string;
  diarize?: boolean;
  tagAudioEvents?: boolean;
}

export function useElevenLabsTranscription() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { loadFromTranscription, saveToProject } = useWordTimelineStore();
  const { currentProject } = useProjectStore();

  const transcribeMedia = useCallback(async (
    filePath: string,
    options?: TranscriptionOptions
  ) => {
    setIsTranscribing(true);
    setError(null);

    let extractedAudioPath: string | null = null;

    try {
      const ext = filePath.split(".").pop()?.toLowerCase();
      const isVideo = ["mp4", "mov", "avi", "mkv", "webm"].includes(ext || "");

      let audioPath = filePath;

      // Step 1: Extract audio if video (saves to media/temp/extracted_audio/)
      if (isVideo) {
        setProgress("Extracting audio from video...");
        const result = await window.electronAPI.ffmpeg.extractAudio({
          videoPath: filePath,
          format: "wav",
          // Output goes to project's media/temp/extracted_audio/
          outputDir: currentProject?.id
            ? `media/temp/extracted_audio`
            : undefined,
        });
        audioPath = result.audioPath;
        extractedAudioPath = result.audioPath; // Track for cleanup
      }

      // Step 2: Transcribe with ElevenLabs
      setProgress("Transcribing audio...");
      const result = await window.electronAPI.transcribe.elevenlabs({
        audioPath,
        language: options?.language,
        diarize: options?.diarize ?? true,
        tagAudioEvents: options?.tagAudioEvents ?? true,
      });

      // Step 3: Generate filename with timestamp
      const sourceFileName = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") || "transcription";
      const timestamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
      const transcriptFileName = `${sourceFileName}_${timestamp}_transcript.json`;

      // Step 4: Load into store
      loadFromTranscription(result, transcriptFileName);

      // Step 5: Save to project folder (media/generated/transcripts/)
      if (currentProject?.id) {
        setProgress("Saving transcript to project...");
        await saveToProject(currentProject.id);
      }

      // Step 6: Cleanup temp audio file
      if (extractedAudioPath) {
        setProgress("Cleaning up temporary files...");
        await window.electronAPI.fs.unlink(extractedAudioPath).catch(() => {
          // Ignore cleanup errors
        });
      }

      setProgress("Complete!");
      return result;

    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription failed";
      setError(message);
      throw err;
    } finally {
      setIsTranscribing(false);
    }
  }, [loadFromTranscription, saveToProject, currentProject]);

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

Add new methods following organize-project structure:

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
// Following organize-project: AI-generated content → media/generated/
saveToProject: async (projectId: string): Promise<string> => {
  const { data, fileName } = get();
  if (!data || !fileName) throw new Error("No data to save");

  // Save to media/generated/transcripts/ per organize-project structure
  const savePath = `media/generated/transcripts/${fileName}`;

  await window.electronAPI.projectFolder.saveJson({
    projectId,
    relativePath: savePath,
    data,
  });

  return savePath;
},

// Load existing transcript from project
loadFromProject: async (projectId: string, fileName: string): Promise<void> => {
  const filePath = `media/generated/transcripts/${fileName}`;
  const data = await window.electronAPI.projectFolder.readJson({
    projectId,
    relativePath: filePath,
  });

  if (data) {
    const words = transformWords(data.words);
    set({
      data: { ...data, words },
      fileName,
      selectedWordId: null,
    });
  }
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

```text
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
              media/imported/     media/imported/
                    │                   │
                    ▼                   │
        ┌───────────────────┐           │
        │  FFmpeg Extract   │           │
        │  Audio (16kHz)    │           │
        │  → media/temp/    │           │
        │  extracted_audio/ │           │
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
              ┌─────────────┼─────────────┐
              ▼             │             ▼
    ┌───────────────┐       │   ┌───────────────────┐
    │  Load into    │       │   │  Save JSON to     │
    │  word-timeline│       │   │  media/generated/ │
    │  store        │       │   │  transcripts/     │
    └───────┬───────┘       │   └───────────────────┘
            │               │
            ▼               ▼
    ┌───────────────┐  ┌───────────────┐
    │  Display words│  │  Cleanup temp │
    │  Click → Seek │  │  audio files  │
    └───────────────┘  └───────────────┘
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `electron/elevenlabs-transcribe-handler.ts` | **Create** | FAL upload + ElevenLabs API handler |
| `electron/main.ts` | Modify | Register new handler |
| `electron/preload.ts` | Modify | Add `transcribe.elevenlabs()` API |
| `apps/web/src/types/electron.d.ts` | Modify | Add TypeScript types |
| `apps/web/src/hooks/use-elevenlabs-transcription.ts` | **Create** | React hook with cleanup logic |
| `apps/web/src/stores/word-timeline-store.ts` | Modify | Add `loadFromTranscription`, `saveToProject`, `loadFromProject` |
| `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx` | Modify | Add media input, progress UI |

### Project Folder Integration

The implementation uses these project folder paths (per organize-project skill):

| Purpose | Path | Persistence |
|---------|------|-------------|
| Extracted audio | `media/temp/extracted_audio/` | Temporary (deleted after use) |
| Transcription JSON | `media/generated/transcripts/` | Permanent |
| Source media | `media/imported/` | Permanent (symlink or copy) |

---

## Verification

### Manual Test
1. Open QCut, go to **Transcribe** tab
2. Drop a video file (MP4 with speech)
3. Verify progress indicators:
   - "Extracting audio from video..."
   - "Transcribing audio..."
   - "Saving transcript to project..."
   - "Cleaning up temporary files..."
   - "Complete!"
4. Click a word → playhead seeks to that timestamp
5. Verify file structure (per organize-project skill):
   ```text
   Documents/QCut/Projects/{project-name}/
   ├── media/generated/transcripts/
   │   └── {filename}_{timestamp}_transcript.json  ✅ Saved
   └── media/temp/extracted_audio/
       └── (should be empty - cleaned up)  ✅ Cleaned
   ```

### Unit Tests
- `elevenlabs-transcribe-handler.test.ts` - Mock FAL API responses
- `use-elevenlabs-transcription.test.ts` - Test hook state transitions
- Verify temp file cleanup occurs even on error

### Integration Test
- Use short audio sample (< 30 seconds) for cost efficiency
- Verify JSON structure matches expected format
- Verify files are saved to correct project structure paths
- Verify temp files are cleaned up after transcription

---

## Implementation Subtasks Summary

| # | Subtask | Est. Time | Priority | Files |
|---|---------|-----------|----------|-------|
| 1 | Create ElevenLabs Handler | 30 min | P0 | 1 new, 1 modify |
| 2 | Add Preload API & Types | 20 min | P0 | 2 modify |
| 3 | Create Transcription Hook | 25 min | P0 | 1 new |
| 4 | Update Word Timeline Store | 20 min | P0 | 1 modify |
| 5 | Update Transcribe Panel UI | 25 min | P0 | 1 modify |
| 6 | Unit Tests | 30 min | P1 | 3 new |
| 7 | Integration Tests | 20 min | P2 | 1 new |

**Total Estimated Time:** ~2.5 hours

---

## Detailed Subtask Breakdown

### Subtask 1: Create ElevenLabs Transcription Handler (30 min)

**Priority:** P0 - Core functionality

**Files:**
| Action | Path |
|--------|------|
| Create | `electron/elevenlabs-transcribe-handler.ts` |
| Modify | `electron/main.ts` (register handler) |

**Implementation Notes:**
- Follow existing pattern from `electron/gemini-transcribe-handler.ts`
- Use secure API key storage pattern from `electron/api-key-handler.ts`
- Add proper error handling with descriptive messages
- Log key steps for debugging (following existing logging patterns)

**Long-term Maintainability:**
- Extract FAL API calls into reusable utility functions
- Define TypeScript interfaces for all request/response types
- Add JSDoc comments for public functions

---

### Subtask 2: Add Preload API & Types (20 min)

**Priority:** P0 - Required for frontend integration

**Files:**
| Action | Path |
|--------|------|
| Modify | `electron/preload.ts` |
| Modify | `apps/web/src/types/electron.d.ts` |

**Implementation Notes:**
- Add `elevenlabs` method to existing `transcribe` namespace
- Follow existing type patterns in `electron.d.ts`
- Ensure types match handler interface exactly

**Long-term Maintainability:**
- Keep types in sync with handler interfaces
- Use shared type definitions where possible
- Document API in JSDoc format

---

### Subtask 3: Create Transcription Hook (25 min)

**Priority:** P0 - Frontend business logic

**Files:**
| Action | Path |
|--------|------|
| Create | `apps/web/src/hooks/use-elevenlabs-transcription.ts` |

**Implementation Notes:**
- Follow existing hook patterns (e.g., `use-ai-pipeline.ts`)
- Implement proper cleanup in `finally` block
- Track extracted audio path for cleanup
- Use `useCallback` for memoization

**Long-term Maintainability:**
- Separate concerns: transcription logic vs UI state
- Make cleanup robust (catch errors, don't fail silently)
- Add progress tracking for UX feedback
- Consider adding cancellation support in future

---

### Subtask 4: Update Word Timeline Store (20 min)

**Priority:** P0 - State management

**Files:**
| Action | Path |
|--------|------|
| Modify | `apps/web/src/stores/word-timeline-store.ts` |

**New Methods:**
- `loadFromTranscription(data, fileName)` - Load from API result
- `saveToProject(projectId)` - Save to project folder
- `loadFromProject(projectId, fileName)` - Load existing transcript

**Long-term Maintainability:**
- Follow organize-project structure for file paths
- Add validation for data integrity
- Consider adding versioning for transcript format

---

### Subtask 5: Update Transcribe Panel UI (25 min)

**Priority:** P0 - User interface

**Files:**
| Action | Path |
|--------|------|
| Modify | `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx` |

**Implementation Notes:**
- Extend dropzone to accept video/audio files
- Add loading state with progress indicator
- Add error display with retry option
- Disable interactions during transcription

**Long-term Maintainability:**
- Extract progress UI into reusable component
- Add accessibility attributes (aria-busy, etc.)
- Consider adding transcription history/list

---

### Subtask 6: Unit Tests (30 min)

**Priority:** P1 - Quality assurance

**Files:**
| Action | Path |
|--------|------|
| Create | `electron/__tests__/elevenlabs-transcribe-handler.test.ts` |
| Create | `apps/web/src/hooks/__tests__/use-elevenlabs-transcription.test.ts` |
| Create | `apps/web/src/stores/__tests__/word-timeline-store-transcription.test.ts` |

**Test Cases - Handler (`elevenlabs-transcribe-handler.test.ts`):**
```typescript
describe("ElevenLabs Transcribe Handler", () => {
  it("should upload audio to FAL storage");
  it("should call ElevenLabs API with correct parameters");
  it("should handle missing API key gracefully");
  it("should handle FAL upload failure");
  it("should handle transcription API failure");
  it("should return properly formatted result");
});
```

**Test Cases - Hook (`use-elevenlabs-transcription.test.ts`):**
```typescript
describe("useElevenLabsTranscription", () => {
  it("should extract audio from video before transcription");
  it("should skip extraction for audio files");
  it("should update progress during transcription");
  it("should save transcript to project folder");
  it("should cleanup temp files after success");
  it("should cleanup temp files after failure");
  it("should set error state on failure");
});
```

**Test Cases - Store (`word-timeline-store-transcription.test.ts`):**
```typescript
describe("WordTimelineStore Transcription", () => {
  it("should load from transcription result");
  it("should save to correct project path");
  it("should load existing transcript from project");
  it("should handle missing data gracefully");
});
```

---

### Subtask 7: Integration Tests (20 min)

**Priority:** P2 - End-to-end validation

**Files:**
| Action | Path |
|--------|------|
| Create | `apps/web/src/__tests__/transcription-pipeline.integration.test.ts` |

**Test Scenarios:**
```typescript
describe("Transcription Pipeline Integration", () => {
  it("should complete full transcription flow for video");
  it("should complete full transcription flow for audio");
  it("should save transcript in correct project location");
  it("should cleanup temp files after completion");
  it("should display words in timeline panel");
});
```

**Note:** Use mocked FAL API to avoid costs during testing.

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

---

## Long-term Maintainability Considerations

### Architecture Principles

1. **Separation of Concerns**
   - Handler: FAL API communication only
   - Hook: Business logic orchestration
   - Store: State management
   - UI: Presentation only

2. **Error Handling Strategy**
   - All errors bubble up with descriptive messages
   - Cleanup always runs (even on error)
   - User sees actionable error messages

3. **Extensibility Points**
   - Easy to add new transcription providers (swap handler)
   - Transcript format is provider-agnostic in store
   - UI can display any word-level data

### Future Enhancements (Not in Scope)

| Enhancement | Complexity | Notes |
|-------------|------------|-------|
| Multiple transcription providers | Medium | Abstract handler interface |
| Transcription queue | Medium | Use job queue pattern |
| Real-time transcription | High | WebSocket + streaming API |
| Speaker identification colors | Low | UI-only change |
| Transcript editing | Medium | Store changes + new UI |
| Export to SRT/VTT | Low | Utility function |
| Batch transcription | Medium | Queue + progress tracking |

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@fal-ai/client` | (optional) | FAL SDK (or use fetch) |
| `electron` | existing | IPC handlers |
| `zustand` | existing | State management |
| `react-dropzone` | existing | File drop UI |

### Breaking Change Policy

- Transcript JSON format is versioned
- Old transcripts remain loadable
- Store handles format migration if needed

---

## References

- [FAL AI ElevenLabs Scribe v2 API](https://fal.ai/models/fal-ai/elevenlabs/speech-to-text/scribe-v2/api)
- [QCut organize-project Skill](/.claude/skills/organize-project/SKILL.md)
- [Existing Gemini Handler](electron/gemini-transcribe-handler.ts)
- [Word Timeline Store](apps/web/src/stores/word-timeline-store.ts)
