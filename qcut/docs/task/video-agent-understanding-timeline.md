# Video Agent: Video Understanding & Timeline Output

## Overview

The video agent skill (`packages/video-agent-skill/`) is a Python-based AI content pipeline (AICP) that analyzes video files and produces structured timeline output. It integrates with QCut's Electron desktop editor via IPC handlers.

## Architecture

```
QCut Electron App
  └─ IPC Layer (ai-pipeline-ipc.ts / ai-pipeline-handler.ts)
       └─ aicp CLI (Python binary)
            ├─ AnalyzerFactory → selects provider
            ├─ GeminiVideoAnalyzer (direct Gemini API)
            ├─ FalVideoAnalyzer (FAL/OpenRouter API)
            └─ Output: JSON + TXT timeline files
```

## Key Files

| File | Location | Role |
|------|----------|------|
| `gemini_analyzer.py` | `video-tools/video_utils/` | Direct Gemini API video analysis |
| `fal_video_analyzer.py` | `video-tools/video_utils/` | FAL/OpenRouter video analysis |
| `analyzer_factory.py` | `video-tools/video_utils/` | Provider selection factory |
| `analyzer_protocol.py` | `video-tools/video_utils/` | Common analyzer interface |
| `video_commands.py` | `video-tools/video_utils/ai_commands/` | CLI entry point for analysis |
| `ai-pipeline-ipc.ts` | `electron/` | Electron IPC bridge |
| `ai-pipeline-handler.ts` | `electron/` | Process management, output parsing |

## Video Understanding Flow

### 1. Request Initiation

The Electron app sends an IPC message (`ai-pipeline:generate`) which spawns the `aicp` CLI binary with the appropriate flags.

### 2. Provider Selection

```python
analyzer = AnalyzerFactory.create(provider='gemini')  # or 'fal'
```

The factory selects a provider based on config or environment variable `MEDIA_ANALYZER_PROVIDER`.

### 3. Video Upload & Analysis

**Gemini Direct:**
- Video uploaded via Gemini File API (supports large files)
- Model processes the video with a structured prompt
- Returns JSON/text analysis

**FAL/OpenRouter:**
- Requires URL-accessible media (no local file upload)
- Routes through OpenRouter unified API
- Supports multiple Gemini model variants

### 4. Analysis Types

| Type | Output | Use Case |
|------|--------|----------|
| **description** | Comprehensive visual/audio breakdown with timestamps | Content cataloging, SEO |
| **transcription** | Speech-to-text with timestamps and speaker IDs | Captions, subtitles |
| **scenes** | Scene-by-scene timeline with timestamp ranges | Editing, finding moments |
| **extraction** | Key entities — people, objects, text, locations | Indexing, search |
| **qa** | Answers to specific questions about the video | Custom queries |

### 5. File Output

Results are saved in two formats per analysis type:

```
output/
├── analysis/
│   ├── {video_name}_description.json    # Structured data
│   ├── {video_name}_description.txt     # Human-readable
│   ├── {video_name}_transcription.json
│   ├── {video_name}_transcription.txt
│   ├── {video_name}_scenes.json
│   └── {video_name}_scenes.txt
```

## Timeline Data Structure

### Analysis Output (JSON)

```json
{
  "file_id": "files/su0m9fl6fax4",
  "transcription": "Speaker: (Woman) Time: 00:00-00:09 Text: ...",
  "include_timestamps": true,
  "speaker_identification": true,
  "analysis_type": "audio_transcription"
}
```

### Conversion to QCut Timeline Elements

The analysis output maps to QCut's timeline element types:

```typescript
// Transcription → CaptionElement
interface CaptionElement extends BaseTimelineElement {
  type: "captions";
  text: string;
  language: string;
  confidence?: number;
  source: "transcription" | "manual" | "imported";
}

// Scene descriptions → MarkdownElement
interface MarkdownElement extends BaseTimelineElement {
  type: "markdown";
  markdownContent: string;
  theme: "light" | "dark" | "transparent";
  fontSize: number;
}

// Common base
interface TimelineElement {
  id: string;
  name: string;
  duration: number;
  startTime: number;
  trimStart: number;
  trimEnd: number;
}
```

**Mapping logic:**
- Transcription timestamps → `startTime` + `duration` on CaptionElements
- Scene timestamp ranges → `startTime` + `duration` on MarkdownElements
- Speaker labels → element metadata
- Extracted entities → text overlay elements

## AI Models Used

| Provider | Models | Best For |
|----------|--------|----------|
| **Gemini Direct** | `gemini-2.0-flash`, `gemini-2.5`, `gemini-3` | Full video upload, richest analysis |
| **FAL/OpenRouter** | `gemini-2.5-flash` (default), `gemini-2.5-pro`, `gemini-3-pro`, `gemini-3-flash` | URL-accessible media, cost flexibility |
| **Whisper** | OpenAI Whisper | Audio transcription fallback |

## Analysis Prompt Structure

The detailed timeline prompt requests:

```
For EVERY 2-5 second interval throughout the entire video:

### [MM:SS - MM:SS] Scene Title
- **Visual**: What is shown on screen
- **Audio**: What is being said
- **Action**: What is happening
- **On-screen text**: Any chyrons, graphics text

Additional sections:
- Complete Transcript with speaker labels and timestamps
- People Directory with descriptions
- Graphics/Text Log with timestamps
- Key Quotes with exact timestamps
```

## YAML Pipeline Integration

Video analysis can be orchestrated via YAML pipelines:

```yaml
name: "Analyze and Process"
steps:
  - type: "video_analysis"
    model: "gemini-2.5-flash"
    params:
      input: "video.mp4"
      analysis_type: "scenes"

  # Parallel batch analysis
  - type: "parallel_group"
    model: "parallel"
    params:
      max_workers: 3
      parallel_steps:
        - type: "video_analysis"
          params: { input: "clip1.mp4" }
        - type: "video_analysis"
          params: { input: "clip2.mp4" }
```

## Electron IPC Interface

| IPC Channel | Purpose |
|-------------|---------|
| `ai-pipeline:check` | Check AICP availability, version, features |
| `ai-pipeline:status` | Detailed pipeline state |
| `ai-pipeline:generate` | Spawn analysis with options |
| `ai-pipeline:progress` | Real-time progress events |
| `ai-pipeline:list-models` | Available AI models |
| `ai-pipeline:estimate-cost` | Cost prediction |
| `ai-pipeline:cancel` | Stop active process |

The handler (`ai-pipeline-handler.ts`) manages the child process lifecycle, captures JSON output from stdout, extracts generated file paths, and auto-imports results into QCut's media/timeline stores.

## Environment Variables

```bash
GEMINI_API_KEY=...              # Required for Gemini direct analysis
FAL_KEY=...                     # Required for FAL providers
OPENROUTER_API_KEY=...          # Optional: unified model access
MEDIA_ANALYZER_PROVIDER=gemini  # Default provider selection
FAL_DEFAULT_MODEL=google/gemini-2.5-flash
```

## Performance

| Operation | Time | Approximate Cost |
|-----------|------|-----------------|
| Video upload (100MB) | 10-30s | Free |
| Analysis (5min video, flash) | ~30s | $0.01-0.05 |
| Analysis (5min video, pro) | ~45s | $0.05-0.15 |
| Parallel batch | 2-3x speedup | Same total cost |

## Design Patterns

- **Factory**: `AnalyzerFactory.create(provider)` — provider-agnostic initialization
- **Protocol**: `MediaAnalyzerProtocol` — common interface across all analyzers
- **Step Executor**: Pipeline steps executed sequentially or in parallel groups
- **IPC Bridge**: Electron spawns Python CLI, parses structured output, forwards to stores
