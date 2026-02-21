---
name: Native CLI
description: Run QCut's native TypeScript pipeline CLI for AI content generation, video analysis, transcription, YAML pipelines, ViMax agentic video production, and project management. Use when user asks to generate images/videos, run pipelines, manage API keys, or use ViMax commands.
dependencies: bun (package manager)
---

# Native Pipeline CLI Skill

Run QCut's built-in TypeScript pipeline CLI (`qcut-pipeline` / `bun run pipeline`).

Reference files:
- `REFERENCE.md` - full command reference with all flags and options

## How to Run

```bash
# Dev (recommended)
bun run pipeline <command> [options]

# Direct source
bun run electron/native-pipeline/cli.ts <command> [options]

# Production binary (after build)
qcut-pipeline <command> [options]
```

## API Key Setup

Keys are stored in `~/.qcut/.env` (mode `0600`).

```bash
# Create .env template
bun run pipeline setup

# Set a key (interactive hidden prompt - preferred)
bun run pipeline set-key --name FAL_KEY

# Check which keys are configured
bun run pipeline check-keys
```

**Supported keys:** `FAL_KEY`, `GEMINI_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `RUNWAY_API_KEY`, `HEYGEN_API_KEY`, `DID_API_KEY`, `SYNTHESIA_API_KEY`

## Quick Commands

Always check available models first:

```bash
bun run pipeline list-models
bun run pipeline list-models --category text_to_video
```

### Generate Image

```bash
bun run pipeline generate-image -m flux_dev -t "A cinematic portrait at golden hour"
```

### Generate Video

```bash
bun run pipeline create-video -m kling_2_6_pro -t "Ocean waves at sunset" -d 5s
```

### Generate Avatar

```bash
bun run pipeline generate-avatar -m omnihuman_v1_5 -t "Hello world" --image-url avatar.png
```

### Transfer Motion

```bash
bun run pipeline transfer-motion --image-url subject.png --video-url motion.mp4
```

### Image Grid

```bash
bun run pipeline generate-grid -t "Forest at dawn" --layout 2x2 --style "cinematic"
```

### Upscale Image

```bash
bun run pipeline upscale-image --image photo.jpg --target 1080p
```

### Analyze Video

```bash
bun run pipeline analyze-video -i video.mp4 --analysis-type summary
bun run pipeline analyze-video -i video.mp4 --prompt "Count people in each scene" -f json
```

### Transcribe Audio

```bash
bun run pipeline transcribe -i audio.mp3 --srt --srt-max-words 8
```

### Run YAML Pipeline

```bash
bun run pipeline run-pipeline -c pipeline.yaml -i "A sunset over mountains" --no-confirm
```

### Cost Estimation

```bash
bun run pipeline estimate-cost -m veo3 -d 8s
```

## ViMax — Agentic Video Production

### Full Pipelines

```bash
# Idea to video (end-to-end)
bun run pipeline vimax:idea2video --idea "A detective in 1920s Paris" -d 120

# Script to video (from existing script.json)
bun run pipeline vimax:script2video --script script.json --portraits registry.json

# Novel to movie
bun run pipeline vimax:novel2movie --novel book.txt --max-scenes 20
```

### Individual Steps

```bash
# Extract characters from text
bun run pipeline vimax:extract-characters --input story.txt

# Generate screenplay
bun run pipeline vimax:generate-script --idea "A robot learns to paint" -d 60

# Generate character portraits
bun run pipeline vimax:generate-portraits --input story.txt --views front,side

# Generate storyboard from script
bun run pipeline vimax:generate-storyboard --script script.json --portraits registry.json

# Build portrait registry from files
bun run pipeline vimax:create-registry --input ./portraits

# List ViMax models
bun run pipeline vimax:list-models
```

## Project Management

```bash
# Initialize project structure
bun run pipeline init-project --directory ./my-project

# Organize loose files into categories
bun run pipeline organize-project --directory ./my-project --recursive

# Show file counts
bun run pipeline structure-info --directory ./my-project

# Get example YAML pipelines
bun run pipeline create-examples -o ./my-pipelines
```

## Global Options

| Flag | Short | Description |
|------|-------|-------------|
| `--output-dir` | `-o` | Output directory (default: `./output`) |
| `--model` | `-m` | Model key |
| `--json` | | Output as JSON |
| `--quiet` | `-q` | Suppress progress |
| `--verbose` | `-v` | Debug logging |
| `--stream` | | JSONL progress events on stderr |
| `--help` | `-h` | Print help |

## Key Source Files

| Component | File |
|-----------|------|
| CLI entry point | `electron/native-pipeline/cli.ts` |
| Command router | `electron/native-pipeline/cli-runner.ts` |
| ViMax handlers | `electron/native-pipeline/vimax-cli-handlers.ts` |
| Admin handlers | `electron/native-pipeline/cli-handlers-admin.ts` |
| Media handlers | `electron/native-pipeline/cli-handlers-media.ts` |
| Key manager | `electron/native-pipeline/key-manager.ts` |
| Example pipelines | `electron/native-pipeline/example-pipelines.ts` |
