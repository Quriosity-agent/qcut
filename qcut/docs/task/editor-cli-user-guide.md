# QCut CLI User Guide

Complete reference for the `qcut-pipeline` CLI tool covering all pipeline, ViMax, and editor commands.

## Quick Start

```bash
# Run from the qcut/ directory
bun run pipeline <command> [options]

# Or directly
bun run electron/native-pipeline/cli.ts <command> [options]

# Get help
bun run pipeline --help
```

## Global Options

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--output-dir` | `-o` | Output directory | `./output` |
| `--model` | `-m` | AI model key (e.g. `kling_2_6_pro`, `flux_dev`) | - |
| `--json` | | Output results as JSON | `false` |
| `--quiet` | `-q` | Suppress progress output | `false` |
| `--verbose` | `-v` | Enable debug output | `false` |
| `--help` | `-h` | Show help | - |
| `--version` | | Show version | - |

---

## Part 1: Pipeline Commands

### Image Generation

```bash
# Generate an image from text
bun run pipeline generate-image --text "A cat in space" --model flux_dev

# With aspect ratio and negative prompt
bun run pipeline generate-image \
  --text "A sunset over mountains" \
  --model flux_dev \
  --aspect-ratio "16:9" \
  --negative-prompt "blurry, low quality"
```

### Video Creation

```bash
# Create a video from text
bun run pipeline create-video --text "Ocean waves crashing" --model kling_2_6_pro --duration 5s

# From an image (image-to-video)
bun run pipeline create-video \
  --model kling_2_6_pro \
  --image-url "/path/to/image.png" \
  --text "The scene comes alive" \
  --duration 5s \
  --aspect-ratio "16:9"
```

### Avatar Generation

```bash
# Generate a talking avatar video
bun run pipeline generate-avatar \
  --text "Hello, welcome to QCut!" \
  --model avatar_model \
  --audio-url "/path/to/speech.mp3"
```

### Video Analysis

```bash
# Analyze a video with AI vision
bun run pipeline analyze-video \
  --source "/path/to/video.mp4" \
  --analysis-type "describe" \
  --output-format json
```

### Transcription

```bash
# Transcribe audio to text
bun run pipeline transcribe \
  --source "/path/to/video.mp4" \
  --language en \
  --srt \
  --srt-max-words 10
```

### Motion Transfer

```bash
# Transfer motion from video to image
bun run pipeline transfer-motion \
  --video-url "/path/to/motion.mp4" \
  --image-url "/path/to/still.png" \
  --orientation landscape
```

### Image Upscaling

```bash
bun run pipeline upscale-image \
  --image-url "/path/to/image.png" \
  --target "2x"
```

### Image Grid

```bash
bun run pipeline generate-grid \
  --text "Four seasons landscapes" \
  --model flux_dev \
  --layout "2x2"
```

### YAML Pipelines

```bash
# Run a multi-step pipeline from a YAML config
bun run pipeline run-pipeline \
  --config pipeline.yaml \
  --input "A sunset beach scene" \
  --save-intermediates \
  --parallel \
  --max-workers 4
```

### Model Listing

```bash
bun run pipeline list-models              # All models
bun run pipeline list-avatar-models       # Avatar models
bun run pipeline list-video-models        # Video models
bun run pipeline list-motion-models       # Motion transfer models
bun run pipeline list-speech-models       # Speech/TTS models
```

### Cost Estimation

```bash
bun run pipeline estimate-cost --model kling_2_6_pro --duration 10 --resolution 1080p
```

### API Key Management

```bash
bun run pipeline setup                    # Create API key template file
bun run pipeline set-key --name FAL_KEY --value "your-api-key"
bun run pipeline get-key --name FAL_KEY   # Shows masked key
bun run pipeline delete-key --name FAL_KEY
bun run pipeline check-keys               # Check all configured keys
```

### Project Management

```bash
bun run pipeline init-project --directory ./my-project
bun run pipeline organize-project --directory ./my-project --recursive
bun run pipeline structure-info --directory ./my-project
bun run pipeline create-examples --directory ./my-project
```

---

## Part 2: ViMax Commands

ViMax is the agentic video production system for end-to-end video creation.

```bash
# Full idea-to-video pipeline
bun run pipeline vimax:idea2video \
  --idea "A documentary about ocean life" \
  --video-model kling_2_6_pro \
  --image-model flux_dev

# Script to video
bun run pipeline vimax:script2video \
  --script "Scene 1: A sunrise. Scene 2: Birds flying." \
  --video-model kling_2_6_pro

# Novel to movie
bun run pipeline vimax:novel2movie \
  --novel "/path/to/novel.txt" \
  --max-scenes 10 \
  --title "My Movie"

# Extract characters from text
bun run pipeline vimax:extract-characters \
  --script "Alice met Bob at the park..." \
  --max-characters 5

# Generate screenplay
bun run pipeline vimax:generate-script \
  --idea "A comedy about robots" \
  --llm-model gemini

# Generate storyboard from script
bun run pipeline vimax:generate-storyboard \
  --script "/path/to/script.txt" \
  --image-model flux_dev

# Generate character portraits
bun run pipeline vimax:generate-portraits \
  --script "/path/to/script.txt" \
  --image-model flux_dev \
  --portraits 3 \
  --views "front,side"

# Create portrait registry from files
bun run pipeline vimax:create-registry --directory ./portraits

# Show registry contents
bun run pipeline vimax:show-registry

# List ViMax-specific models
bun run pipeline vimax:list-models
```

### ViMax Options

| Flag | Description |
|------|-------------|
| `--idea` | Text idea for generation |
| `--script` | Script text or file path |
| `--novel` | Novel text or file path |
| `--title` | Project title |
| `--max-scenes` | Maximum number of scenes |
| `--llm-model` | LLM model for text generation |
| `--image-model` | Image generation model |
| `--video-model` | Video generation model |
| `--portraits` | Number of portraits to generate |
| `--views` | Portrait views (comma-separated) |
| `--max-characters` | Maximum characters to extract |
| `--scripts-only` | Only generate scripts |
| `--storyboard-only` | Only generate storyboard |
| `--no-portraits` | Skip portrait generation |
| `--no-references` | Skip reference images |
| `--save-registry` | Save portrait registry (default: true) |

---

## Part 3: Editor Commands

Editor commands control a running QCut desktop instance via its HTTP API. QCut must be running with `bun run electron:dev` or `bun run electron`.

### Prerequisites

1. Start QCut: `bun run electron:dev`
2. The HTTP API starts on `http://127.0.0.1:8765` by default
3. All editor commands start with `editor:`

### Editor Connection Options

| Flag | Description | Default |
|------|-------------|---------|
| `--host` | API host | `127.0.0.1` |
| `--port` | API port | `8765` |
| `--token` | API auth token | - |
| `--timeout` | Job timeout in seconds | `300` (export: `600`) |
| `--poll` | Auto-poll async jobs until complete | `false` |
| `--poll-interval` | Poll interval in seconds | `3` |

### JSON Input Modes

Many commands accept JSON data via `--data`, `--elements`, `--cuts`, etc. Three input modes are supported:

```bash
# Inline JSON
--data '{"type":"text","content":"Hello"}'

# From file
--data @element.json

# From stdin
echo '{"type":"text"}' | bun run pipeline editor:timeline:add-element --data -
```

---

### Health Check

```bash
# Check if QCut is running and API is accessible
bun run pipeline editor:health
```

---

### Media Commands

Manage media files in the QCut media panel.

#### List media

```bash
bun run pipeline editor:media:list --project-id <id>
```

#### Get media info

```bash
bun run pipeline editor:media:info --project-id <id> --media-id <id>
```

#### Import local file

```bash
bun run pipeline editor:media:import --project-id <id> --source /path/to/video.mp4
```

#### Import from URL

```bash
bun run pipeline editor:media:import-url \
  --project-id <id> \
  --url "https://example.com/video.mp4" \
  --filename "my-video.mp4"
```

#### Batch import (max 20 items)

```bash
# Inline
bun run pipeline editor:media:batch-import \
  --project-id <id> \
  --items '[{"source":"/path/to/a.mp4"},{"source":"/path/to/b.mp4"}]'

# From file
bun run pipeline editor:media:batch-import \
  --project-id <id> \
  --items @imports.json
```

#### Extract a frame

```bash
bun run pipeline editor:media:extract-frame \
  --project-id <id> \
  --media-id <id> \
  --start-time 5.0 \
  --output-format png
```

#### Rename media

```bash
bun run pipeline editor:media:rename \
  --project-id <id> \
  --media-id <id> \
  --new-name "final-cut.mp4"
```

#### Delete media

```bash
bun run pipeline editor:media:delete --project-id <id> --media-id <id>
```

---

### Project Commands

Manage project settings and metadata.

#### Get settings

```bash
bun run pipeline editor:project:settings --project-id <id>
```

#### Update settings

```bash
bun run pipeline editor:project:update-settings \
  --project-id <id> \
  --data '{"fps":30,"width":1920,"height":1080}'

# From file
bun run pipeline editor:project:update-settings \
  --project-id <id> \
  --data @settings.json
```

#### Get statistics

```bash
bun run pipeline editor:project:stats --project-id <id>
```

#### Get summary (markdown)

```bash
bun run pipeline editor:project:summary --project-id <id>
```

#### Generate pipeline report

```bash
bun run pipeline editor:project:report \
  --project-id <id> \
  --output-dir ./reports \
  --clear-log
```

---

### Timeline Commands

Read and manipulate the editor timeline.

#### Export timeline

```bash
# Default format
bun run pipeline editor:timeline:export --project-id <id>

# As JSON
bun run pipeline editor:timeline:export --project-id <id> --json

# Specific format
bun run pipeline editor:timeline:export --project-id <id> --output-format json
```

#### Import timeline

```bash
# Import JSON timeline data
bun run pipeline editor:timeline:import \
  --project-id <id> \
  --data '{"name":"My Timeline","tracks":[{"id":"t1","type":"video","elements":[]}]}'

# From file
bun run pipeline editor:timeline:import --project-id <id> --data @timeline.json

# Replace existing timeline
bun run pipeline editor:timeline:import --project-id <id> --data @timeline.json --replace
```

**Important**: When importing elements that reference media files, use `sourceName` (the filename) in element data, not `mediaId`. The renderer resolves media by filename.

#### Add element

```bash
# Add a media element (use sourceName to link to imported media)
bun run pipeline editor:timeline:add-element \
  --project-id <id> \
  --data '{"type":"video","sourceName":"my-video.mp4","startTime":0,"duration":10,"trackId":"track-1"}'

# Add a text element
bun run pipeline editor:timeline:add-element \
  --project-id <id> \
  --data '{"type":"text","content":"Hello World","startTime":0,"duration":5}'
```

#### Batch add elements (max 50)

```bash
bun run pipeline editor:timeline:batch-add \
  --project-id <id> \
  --elements '[{"type":"text","content":"Title","startTime":0},{"type":"text","content":"End","startTime":10}]'
```

#### Update element

```bash
bun run pipeline editor:timeline:update-element \
  --project-id <id> \
  --element-id <id> \
  --changes '{"startTime":5,"duration":15}'

# Alternative: use --data instead of --changes
bun run pipeline editor:timeline:update-element \
  --project-id <id> \
  --element-id <id> \
  --data '{"startTime":5}'
```

#### Batch update elements (max 50)

```bash
bun run pipeline editor:timeline:batch-update \
  --project-id <id> \
  --updates '[{"elementId":"e1","changes":{"startTime":0}},{"elementId":"e2","changes":{"startTime":10}}]'
```

#### Delete element

```bash
bun run pipeline editor:timeline:delete-element \
  --project-id <id> \
  --element-id <id>
```

#### Batch delete elements (max 50)

```bash
# With ripple (close gaps)
bun run pipeline editor:timeline:batch-delete \
  --project-id <id> \
  --elements '["elem1","elem2","elem3"]' \
  --ripple
```

#### Split element

```bash
# Split at 10 seconds into the element
bun run pipeline editor:timeline:split \
  --project-id <id> \
  --element-id <id> \
  --split-time 10
```

#### Move element

```bash
# Move to a different track
bun run pipeline editor:timeline:move \
  --project-id <id> \
  --element-id <id> \
  --to-track <track-id>

# Move to a different track and time position
bun run pipeline editor:timeline:move \
  --project-id <id> \
  --element-id <id> \
  --to-track <track-id> \
  --start-time 15.0
```

**Known issue**: Moving an element within the same track may cause the element to disappear. Use different `--to-track` values.

#### Arrange elements on a track

```bash
# Sequential arrangement (end-to-end, no gaps)
bun run pipeline editor:timeline:arrange \
  --project-id <id> \
  --track-id <track-id> \
  --mode sequential

# Spaced arrangement (with gap between elements)
bun run pipeline editor:timeline:arrange \
  --project-id <id> \
  --track-id <track-id> \
  --mode spaced \
  --gap 2.0

# Manual order
bun run pipeline editor:timeline:arrange \
  --project-id <id> \
  --track-id <track-id> \
  --mode manual \
  --data '["elem3","elem1","elem2"]' \
  --start-time 0
```

Modes: `sequential`, `spaced`, `manual`

#### Selection

```bash
# Select elements
bun run pipeline editor:timeline:select \
  --project-id <id> \
  --elements '[{"trackId":"t1","elementId":"e1"},{"trackId":"t1","elementId":"e2"}]'

# Get current selection
bun run pipeline editor:timeline:get-selection --project-id <id>

# Clear selection
bun run pipeline editor:timeline:clear-selection --project-id <id>
```

---

### Editing Commands

Advanced editing operations.

#### Batch cuts

```bash
# Apply multiple cuts to an element
bun run pipeline editor:editing:batch-cuts \
  --project-id <id> \
  --element-id <id> \
  --cuts '[{"start":2,"end":4},{"start":8,"end":10}]' \
  --ripple
```

#### Delete time range

```bash
# Delete a time range across tracks
bun run pipeline editor:editing:delete-range \
  --project-id <id> \
  --start-time 5.0 \
  --end-time 15.0 \
  --ripple

# Limit to specific tracks (comma-separated)
bun run pipeline editor:editing:delete-range \
  --project-id <id> \
  --start-time 5.0 \
  --end-time 15.0 \
  --track-id "track-1,track-2" \
  --cross-track-ripple
```

#### Auto-edit (remove fillers/silences)

```bash
# Synchronous auto-edit
bun run pipeline editor:editing:auto-edit \
  --project-id <id> \
  --element-id <id> \
  --media-id <id> \
  --remove-fillers \
  --remove-silences \
  --threshold 0.5

# Async with polling
bun run pipeline editor:editing:auto-edit \
  --project-id <id> \
  --element-id <id> \
  --media-id <id> \
  --remove-fillers \
  --poll \
  --poll-interval 2

# Dry run (preview changes without applying)
bun run pipeline editor:editing:auto-edit \
  --project-id <id> \
  --element-id <id> \
  --media-id <id> \
  --remove-silences \
  --dry-run
```

#### Auto-edit job management

```bash
# Check job status
bun run pipeline editor:editing:auto-edit-status \
  --project-id <id> \
  --job-id <id>

# List all auto-edit jobs
bun run pipeline editor:editing:auto-edit-list --project-id <id>
```

#### AI-suggested cuts

```bash
# Get AI-suggested cuts (sync)
bun run pipeline editor:editing:suggest-cuts \
  --project-id <id> \
  --media-id <id> \
  --include-fillers \
  --include-silences \
  --include-scenes

# Async with polling
bun run pipeline editor:editing:suggest-cuts \
  --project-id <id> \
  --media-id <id> \
  --poll \
  --timeout 120

# Check suggest-cuts job status
bun run pipeline editor:editing:suggest-status \
  --project-id <id> \
  --job-id <id>
```

---

### Analysis Commands

AI-powered video and audio analysis.

#### Analyze video

```bash
# Using a media ID
bun run pipeline editor:analyze:video \
  --project-id <id> \
  --source "media:abc123" \
  --analysis-type describe \
  --model gemini

# Using a file path
bun run pipeline editor:analyze:video \
  --project-id <id> \
  --source "path:/path/to/video.mp4"

# Using a timeline element
bun run pipeline editor:analyze:video \
  --project-id <id> \
  --source "timeline:element-id"
```

Source format: `media:<id>`, `path:/file/path`, `timeline:<elementId>`, or bare path `/file/path`

#### List analysis models

```bash
bun run pipeline editor:analyze:models
```

#### Detect scenes

```bash
bun run pipeline editor:analyze:scenes \
  --project-id <id> \
  --media-id <id> \
  --threshold 0.5 \
  --model gemini
```

#### Analyze frames

```bash
# At specific timestamps
bun run pipeline editor:analyze:frames \
  --project-id <id> \
  --media-id <id> \
  --timestamps "0,5,10,15,20"

# At regular intervals
bun run pipeline editor:analyze:frames \
  --project-id <id> \
  --media-id <id> \
  --gap 5 \
  --prompt "Describe the mood of this frame"
```

#### Detect filler words

```bash
bun run pipeline editor:analyze:fillers \
  --project-id <id> \
  --media-id <id>

# With pre-existing word data
bun run pipeline editor:analyze:fillers \
  --project-id <id> \
  --data @words.json
```

---

### Transcription Commands

Speech-to-text transcription.

#### Transcribe (synchronous)

```bash
bun run pipeline editor:transcribe:run \
  --project-id <id> \
  --media-id <id> \
  --language en \
  --provider deepgram
```

#### Transcribe (async with polling)

```bash
# Start and poll until complete
bun run pipeline editor:transcribe:start \
  --project-id <id> \
  --media-id <id> \
  --poll \
  --poll-interval 2 \
  --timeout 120

# Start without polling (returns jobId)
bun run pipeline editor:transcribe:start \
  --project-id <id> \
  --media-id <id>
```

#### Job management

```bash
# Check status
bun run pipeline editor:transcribe:status \
  --project-id <id> \
  --job-id <id>

# List all jobs
bun run pipeline editor:transcribe:list-jobs --project-id <id>

# Cancel a job
bun run pipeline editor:transcribe:cancel \
  --project-id <id> \
  --job-id <id>
```

#### Transcription Options

| Flag | Description |
|------|-------------|
| `--language` | Language code (e.g. `en`, `zh`) |
| `--provider` | Transcription provider (e.g. `deepgram`) |
| `--no-diarize` | Disable speaker diarization |

---

### Generate Commands

AI content generation within the editor.

#### Start generation

```bash
# Text-to-image/video
bun run pipeline editor:generate:start \
  --project-id <id> \
  --model flux_dev \
  --text "A beautiful sunset" \
  --aspect-ratio "16:9"

# Image-to-video
bun run pipeline editor:generate:start \
  --project-id <id> \
  --model kling_2_6_pro \
  --text "The scene comes alive" \
  --image-url "/path/to/image.png" \
  --duration 5s

# With polling
bun run pipeline editor:generate:start \
  --project-id <id> \
  --model flux_dev \
  --text "Ocean waves" \
  --poll \
  --poll-interval 5

# Auto-add to timeline
bun run pipeline editor:generate:start \
  --project-id <id> \
  --model flux_dev \
  --text "Title card" \
  --add-to-timeline \
  --track-id track-1 \
  --start-time 0
```

#### Job management

```bash
# Check status
bun run pipeline editor:generate:status \
  --project-id <id> \
  --job-id <id>

# List all jobs
bun run pipeline editor:generate:list-jobs --project-id <id>

# Cancel a job
bun run pipeline editor:generate:cancel \
  --project-id <id> \
  --job-id <id>
```

#### List generation models

```bash
bun run pipeline editor:generate:models
```

#### Estimate cost

```bash
bun run pipeline editor:generate:estimate-cost \
  --model kling_2_6_pro \
  --duration 10 \
  --resolution 1080p
```

---

### Export Commands

Export the final project.

#### List presets

```bash
bun run pipeline editor:export:presets
```

#### Get recommended settings

```bash
bun run pipeline editor:export:recommend \
  --project-id <id> \
  --target tiktok
```

Targets: `youtube`, `tiktok`, `instagram-reel`, `twitter`, etc.

#### Start export

```bash
# With preset
bun run pipeline editor:export:start \
  --project-id <id> \
  --preset youtube-1080p \
  --poll

# With custom settings
bun run pipeline editor:export:start \
  --project-id <id> \
  --data '{"width":1920,"height":1080,"fps":30,"format":"mp4"}' \
  --output-dir ./exports \
  --poll \
  --timeout 600
```

#### Job management

```bash
# Check status
bun run pipeline editor:export:status \
  --project-id <id> \
  --job-id <id>

# List all jobs
bun run pipeline editor:export:list-jobs --project-id <id>
```

---

### Diagnostics Commands

Error analysis and debugging.

```bash
# Analyze an error
bun run pipeline editor:diagnostics:analyze \
  --message "Canvas rendering failed" \
  --stack "Error at line 42 in renderer.ts"

# With additional context
bun run pipeline editor:diagnostics:analyze \
  --message "Export stalled at 50%" \
  --data '{"exportFormat":"mp4","resolution":"4k"}'
```

---

### MCP Commands

Forward HTML to the MCP preview panel.

```bash
# Inline HTML
bun run pipeline editor:mcp:forward-html \
  --html "<h1>Hello World</h1><p>Preview content</p>"

# From file
bun run pipeline editor:mcp:forward-html \
  --html @preview.html

# With tool name
bun run pipeline editor:mcp:forward-html \
  --html @app.html \
  --tool-name "my-mcp-tool"
```

---

## Reference Tables

### All Editor Flags

| Flag | Type | Description |
|------|------|-------------|
| `--project-id` | string | Project identifier |
| `--media-id` | string | Media file identifier |
| `--element-id` | string | Timeline element identifier |
| `--job-id` | string | Async job identifier |
| `--track-id` | string | Track identifier (comma-separated for multiple) |
| `--to-track` | string | Target track for move operations |
| `--split-time` | number | Split point in seconds |
| `--start-time` | number | Start time in seconds |
| `--end-time` | number | End time in seconds |
| `--new-name` | string | New name for rename operations |
| `--source` | string | Source file path or source specifier |
| `--data` | string | JSON input (inline, `@file.json`, or `-` for stdin) |
| `--changes` | string | JSON changes object |
| `--updates` | string | JSON updates array |
| `--elements` | string | JSON elements array |
| `--cuts` | string | JSON cuts array |
| `--items` | string | JSON items array for batch import |
| `--url` | string | URL for import |
| `--filename` | string | Override filename |
| `--preset` | string | Export preset name |
| `--target` | string | Export target platform |
| `--threshold` | number | Detection threshold (0-1) |
| `--timestamps` | string | Comma-separated timestamps |
| `--gap` | number | Gap between elements / frame interval |
| `--mode` | string | Arrange mode: `sequential`, `spaced`, `manual` |
| `--output-format` | string | Output format |
| `--replace` | boolean | Replace timeline on import |
| `--ripple` | boolean | Ripple edit (close gaps) |
| `--cross-track-ripple` | boolean | Ripple across all tracks |
| `--remove-fillers` | boolean | Remove filler words |
| `--remove-silences` | boolean | Remove silences |
| `--poll` | boolean | Auto-poll async jobs |
| `--poll-interval` | number | Poll interval in seconds |
| `--timeout` | number | Job timeout in seconds |
| `--dry-run` | boolean | Preview changes without applying |
| `--add-to-timeline` | boolean | Auto-add generated content to timeline |
| `--include-fillers` | boolean | Include filler detection in suggest-cuts |
| `--include-silences` | boolean | Include silence detection in suggest-cuts |
| `--include-scenes` | boolean | Include scene detection in suggest-cuts |
| `--html` | string | HTML content (inline or `@file.html`) |
| `--message` | string | Error message for diagnostics |
| `--stack` | string | Stack trace for diagnostics |
| `--tool-name` | string | MCP tool name |
| `--clear-log` | boolean | Clear log after report |
| `--provider` | string | Service provider |
| `--language` | string | Language code |
| `--no-diarize` | boolean | Disable speaker diarization |

### Batch Limits

| Operation | Max Items |
|-----------|-----------|
| `editor:media:batch-import` | 20 |
| `editor:timeline:batch-add` | 50 |
| `editor:timeline:batch-update` | 50 |
| `editor:timeline:batch-delete` | 50 |

### Async Job Statuses

| Status | Description |
|--------|-------------|
| `queued` | Job is waiting to start |
| `running` | Job is in progress |
| `completed` | Job finished successfully |
| `failed` | Job encountered an error |
| `cancelled` | Job was cancelled |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `FAL_KEY` | FAL.ai API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `QCUT_API_HOST` | Override editor API host (default: `127.0.0.1`) |
| `QCUT_API_PORT` | Override editor API port (default: `8765`) |

---

## Common Workflows

### Import media and add to timeline

```bash
PROJECT=my-project

# 1. Import a video file
bun run pipeline editor:media:import \
  --project-id $PROJECT \
  --source /path/to/video.mp4

# 2. List media to get the media info
bun run pipeline editor:media:list --project-id $PROJECT --json

# 3. Add to timeline (use sourceName = filename)
bun run pipeline editor:timeline:add-element \
  --project-id $PROJECT \
  --data '{"type":"video","sourceName":"video.mp4","startTime":0,"duration":30}'
```

### Split and rearrange clips

```bash
PROJECT=my-project

# 1. Export timeline to see current state
bun run pipeline editor:timeline:export --project-id $PROJECT --json

# 2. Split element at 10 seconds
bun run pipeline editor:timeline:split \
  --project-id $PROJECT \
  --element-id elem-1 \
  --split-time 10

# 3. Delete the unwanted section
bun run pipeline editor:timeline:delete-element \
  --project-id $PROJECT \
  --element-id elem-1-right

# 4. Arrange remaining elements sequentially
bun run pipeline editor:timeline:arrange \
  --project-id $PROJECT \
  --track-id track-1 \
  --mode sequential
```

### Auto-edit a video (remove fillers and silences)

```bash
PROJECT=my-project

# 1. Transcribe first
bun run pipeline editor:transcribe:start \
  --project-id $PROJECT \
  --media-id media-1 \
  --poll

# 2. Auto-edit with filler and silence removal
bun run pipeline editor:editing:auto-edit \
  --project-id $PROJECT \
  --element-id elem-1 \
  --media-id media-1 \
  --remove-fillers \
  --remove-silences \
  --poll
```

### Generate AI content and add to timeline

```bash
PROJECT=my-project

# Generate and auto-add to timeline
bun run pipeline editor:generate:start \
  --project-id $PROJECT \
  --model flux_dev \
  --text "Professional title card: QCut Tutorial" \
  --add-to-timeline \
  --poll
```

### Export for social media

```bash
PROJECT=my-project

# 1. Get recommended settings for TikTok
bun run pipeline editor:export:recommend \
  --project-id $PROJECT \
  --target tiktok

# 2. Export with preset
bun run pipeline editor:export:start \
  --project-id $PROJECT \
  --preset tiktok \
  --poll \
  --timeout 600
```
