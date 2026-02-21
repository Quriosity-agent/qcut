# QCut Native Pipeline CLI Usage Guide

> **Binary:** `qcut-pipeline` (installed) or `bun run pipeline` (dev)

## Quick Start

```bash
# Setup API keys
bun run pipeline setup
bun run pipeline set-key --name FAL_KEY
bun run pipeline check-keys

# Generate an image
bun run pipeline generate-image -m flux_dev -t "A cat in space"

# Create a video
bun run pipeline create-video -m kling_2_6_pro -t "Ocean waves" -d 5s

# List available models
bun run pipeline list-models --category text_to_video
```

## How to Run

```bash
# Dev (via package.json script)
bun run pipeline <command> [options]

# Dev (direct)
bun run electron/native-pipeline/cli.ts <command> [options]

# Production (after build)
qcut-pipeline <command> [options]
```

## Global Options

| Flag | Short | Description |
|------|-------|-------------|
| `--output-dir` | `-o` | Output directory (default: `./output`) |
| `--model` | `-m` | Model key (e.g. `flux_dev`, `kling_2_6_pro`) |
| `--json` | | Output results as JSON |
| `--quiet` | `-q` | Suppress progress output |
| `--verbose` | `-v` | Enable debug logging |
| `--stream` | | Emit JSONL progress events to stderr |
| `--config-dir` | | Config directory (default: `~/.qcut`) |
| `--help` | `-h` | Print help |
| `--version` | | Print version |

---

## Generation Commands

### `generate-image` — Text to image

```bash
bun run pipeline generate-image -m flux_dev -t "Cyberpunk cityscape"
bun run pipeline generate-image -m flux_dev -t "A forest" --aspect-ratio 16:9 -o ./results
```

| Flag | Description |
|------|-------------|
| `--text`, `-t` | Text prompt (required) |
| `--model`, `-m` | Model key (required) |
| `--aspect-ratio` | e.g. `16:9`, `9:16`, `1:1` |
| `--resolution` | e.g. `1080p`, `720p` |
| `--negative-prompt` | Negative prompt |

### `create-video` — Text/image to video

```bash
bun run pipeline create-video -m kling_2_6_pro -t "Waves crashing" -d 5s
bun run pipeline create-video -m kling_2_6_pro --image-url ./photo.png -t "Zoom in slowly"
```

| Flag | Description |
|------|-------------|
| `--text`, `-t` | Text prompt |
| `--image-url` | Input image (for image-to-video) |
| `--model`, `-m` | Model key (required) |
| `--duration`, `-d` | Duration (e.g. `5s`) |
| `--aspect-ratio` | Aspect ratio |
| `--resolution` | Resolution |
| `--negative-prompt` | Negative prompt |

### `generate-avatar` — Talking avatar video

```bash
bun run pipeline generate-avatar -m omnihuman_v1_5 -t "Hello world" --image-url avatar.png
```

| Flag | Description |
|------|-------------|
| `--text`, `-t` | Script text |
| `--image-url` | Avatar image |
| `--audio-url` | Input audio URL |
| `--model`, `-m` | Model key |
| `--voice-id` | Voice ID for TTS |
| `--reference-images` | Reference images (repeatable) |
| `--duration`, `-d` | Duration |

### `transfer-motion` — Motion transfer

```bash
bun run pipeline transfer-motion --image-url subject.png --video-url motion.mp4
```

| Flag | Description |
|------|-------------|
| `--image-url` | Source image (required) |
| `--video-url` | Reference motion video (required) |
| `--model`, `-m` | Model key (default: `kling_motion_control`) |
| `--no-sound` | Strip audio from output |

### `generate-grid` — Image grid

```bash
bun run pipeline generate-grid -t "A forest at dawn" --layout 2x2 --style "cinematic"
```

| Flag | Description |
|------|-------------|
| `--text`, `-t` | Prompt (required) |
| `--model`, `-m` | Image model (default: `flux_dev`) |
| `--layout` | Grid layout: `2x2`, `3x3`, `2x3`, `3x2`, `1x2`, `2x1` |
| `--style` | Style prefix prepended to prompt |
| `--grid-upscale` | Upscale factor after compositing |

### `upscale-image` — Image upscaling

```bash
bun run pipeline upscale-image --image photo.jpg --target 1080p
```

| Flag | Description |
|------|-------------|
| `--image` | Local image path |
| `--image-url` | Image URL |
| `--input`, `-i` | Image path or URL (alias) |
| `--model`, `-m` | Upscaling model (default: `topaz`) |
| `--upscale` | Upscale factor (e.g. `2`) |
| `--target` | Target resolution: `720p`, `1080p`, `1440p`, `2160p` |

---

## Analysis Commands

### `analyze-video` — Video analysis with AI vision

```bash
bun run pipeline analyze-video -i video.mp4 --analysis-type summary
bun run pipeline analyze-video -i video.mp4 --prompt "Count the people in each scene" -f json
```

| Flag | Description |
|------|-------------|
| `--input`, `-i` | Video file or URL (required) |
| `--model`, `-m` | Vision model (default: `gemini_qa`) |
| `--analysis-type` | `timeline`, `summary`, `description`, `transcript` |
| `--prompt` | Custom analysis prompt (overrides analysis-type) |
| `--output-format`, `-f` | `md`, `json`, `both` |

### `transcribe` — Speech to text + SRT

```bash
bun run pipeline transcribe -i audio.mp3 --srt --srt-max-words 8
bun run pipeline transcribe -i speech.wav --language en --keyterms medical --keyterms diagnosis
```

| Flag | Description |
|------|-------------|
| `--input`, `-i` | Audio file or URL (required) |
| `--model`, `-m` | STT model (default: `scribe_v2`) |
| `--language` | Language code (e.g. `en`, `fr`) |
| `--srt` | Generate `.srt` subtitle file |
| `--srt-max-words` | Max words per SRT block |
| `--srt-max-duration` | Max duration (seconds) per SRT block |
| `--no-diarize` | Disable speaker diarization |
| `--keyterms` | Domain keywords to hint the model (repeatable) |
| `--raw-json` | Save raw JSON API response |

---

## YAML Pipelines

### `run-pipeline` — Run a multi-step pipeline

```bash
bun run pipeline run-pipeline -c pipeline.yaml -i "A sunset over mountains"
bun run pipeline run-pipeline -c pipeline.yaml --no-confirm --save-intermediates
echo "My prompt" | bun run pipeline run-pipeline -c pipeline.yaml --input -
```

| Flag | Description |
|------|-------------|
| `--config`, `-c` | Path to YAML pipeline file (required) |
| `--input`, `-i` | Input text, file path, or `-` for stdin |
| `--text`, `-t` | Alias for `--input` |
| `--prompt-file` | Read input from file path |
| `--save-intermediates` | Save each step's output |
| `--parallel` | Enable parallel step execution |
| `--max-workers` | Max concurrent workers (default: `8`) |
| `--no-confirm` | Skip cost confirmation prompt |

### Pipeline YAML format

```yaml
name: my-pipeline
steps:
  - type: text_to_image
    model: flux_dev
    params:
      image_size: landscape_16_9

  - type: image_to_video
    model: kling_2_6_pro
    params:
      duration: "5"

  # Parallel group
  - type: parallel_group
    merge_strategy: COLLECT_ALL
    steps:
      - type: text_to_image
        model: flux_schnell
      - type: text_to_image
        model: flux_dev

config:
  output_dir: ./output
  save_intermediates: true
```

**Valid step types:** `text_to_image`, `image_to_image`, `text_to_video`, `image_to_video`, `video_to_video`, `avatar`, `motion_transfer`, `upscale`, `upscale_video`, `add_audio`, `text_to_speech`, `speech_to_text`, `image_understanding`, `prompt_generation`

### `create-examples` — Get example pipeline files

```bash
bun run pipeline create-examples -o ./my-pipelines
```

Creates: `text-to-video-basic.yaml`, `image-to-video-chain.yaml`, `multi-step-pipeline.yaml`, `parallel-pipeline.yaml`, `avatar-generation.yaml`

---

## Model Discovery

```bash
# List all models
bun run pipeline list-models

# Filter by category
bun run pipeline list-models --category text_to_video

# Specialized lists
bun run pipeline list-avatar-models
bun run pipeline list-video-models
bun run pipeline list-motion-models
bun run pipeline list-speech-models

# Cost estimation
bun run pipeline estimate-cost -m veo3 -d 8s
bun run pipeline estimate-cost -m flux_dev
```

**Categories:** `text_to_image`, `image_to_image`, `text_to_video`, `image_to_video`, `video_to_video`, `avatar`, `motion_transfer`, `upscale`, `upscale_video`, `add_audio`, `text_to_speech`, `speech_to_text`, `image_understanding`, `prompt_generation`

---

## API Key Management

Keys are stored in `~/.qcut/.env` (file mode `0600`).

```bash
# Create .env template with all known keys
bun run pipeline setup

# Set a key (interactive hidden prompt)
bun run pipeline set-key --name FAL_KEY

# Set a key (inline — less secure)
bun run pipeline set-key --name FAL_KEY --value sk-abc123

# Check which keys are configured
bun run pipeline check-keys

# View a key (masked)
bun run pipeline get-key --name FAL_KEY

# View a key (full value)
bun run pipeline get-key --name FAL_KEY --reveal

# Delete a key
bun run pipeline delete-key --name FAL_KEY
```

**Supported keys:** `FAL_KEY`, `GEMINI_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `RUNWAY_API_KEY`, `HEYGEN_API_KEY`, `DID_API_KEY`, `SYNTHESIA_API_KEY`

---

## Project Management

```bash
# Initialize project directory structure
bun run pipeline init-project --directory ./my-project

# Preview without creating
bun run pipeline init-project --directory ./my-project --dry-run

# Organize loose files into category folders
bun run pipeline organize-project --directory ./my-project --recursive

# Show file counts per directory
bun run pipeline structure-info --directory ./my-project
```

**Project structure created by `init-project`:**

```
my-project/
├── input/
│   ├── images/
│   ├── videos/
│   ├── audio/
│   ├── text/
│   └── pipelines/
├── output/
│   ├── images/
│   ├── videos/
│   └── audio/
└── config/
```

---

## ViMax — Agentic Video Production

ViMax is the multi-agent pipeline that turns ideas, scripts, or novels into videos. All `vimax:*` commands share these override flags:

| Flag | Description |
|------|-------------|
| `--llm-model` | Override LLM agent model |
| `--image-model` | Override image generation model |
| `--video-model` | Override video generation model |

### Full Pipelines

```bash
# Idea → screenplay → characters → portraits → storyboard → video
bun run pipeline vimax:idea2video --idea "A detective in 1920s Paris" -d 120

# Skip portraits
bun run pipeline vimax:idea2video --idea "Space opera" --no-portraits

# Script → storyboard → video (from existing script.json)
bun run pipeline vimax:script2video --script script.json --portraits registry.json

# Novel → movie (chapters extracted, adapted, rendered)
bun run pipeline vimax:novel2movie --novel dracula.txt --max-scenes 20

# Novel → scripts only (no image/video generation)
bun run pipeline vimax:novel2movie --novel book.txt --scripts-only
```

### Individual Steps

```bash
# Extract characters from text
bun run pipeline vimax:extract-characters -t "Alice met the Mad Hatter..."
bun run pipeline vimax:extract-characters --input story.txt

# Generate screenplay from idea
bun run pipeline vimax:generate-script --idea "A robot learns to paint" -d 60

# Generate character portraits
bun run pipeline vimax:generate-portraits --input story.txt --views front,side
bun run pipeline vimax:generate-portraits --input characters.json --max-characters 3

# Generate storyboard from script
bun run pipeline vimax:generate-storyboard --script script.json
bun run pipeline vimax:generate-storyboard --script script.json --portraits registry.json --style "anime"

# Build portrait registry from existing portrait files
bun run pipeline vimax:create-registry --input ./portraits --project-id my-movie

# View registry contents
bun run pipeline vimax:show-registry --input ./portraits/registry.json

# List ViMax-relevant models
bun run pipeline vimax:list-models
```

**Portrait directory structure** (for `create-registry`):

```
portraits/
  Alice/
    front.png
    side.png
  Bob/
    front.png
    three_quarter.png
```

---

## Output Formats

**Default (TTY):** Progress bar + final output path.

**`--json`:** Single JSON object on stdout:

```json
{
  "schema_version": "1",
  "command": "generate-image",
  "success": true,
  "outputPath": "./output/cli-1234/output_1234.png",
  "cost": 0.005,
  "duration": 8.3
}
```

**`--stream`:** Newline-delimited JSON events on stderr (for `run-pipeline`):

```json
{"type":"progress","stage":"processing","percent":42,"message":"Step 2/3"}
```

**Exit codes:** `0` = success, `1` = error, `2` = unknown command

---

## Typical Workflows

### Quick image + video

```bash
bun run pipeline generate-image -m flux_dev -t "Red fox in snow" -o ./project
bun run pipeline create-video -m kling_2_6_pro --image-url ./project/output.png -t "Fox runs" -d 5s
```

### YAML pipeline from examples

```bash
bun run pipeline create-examples -o ./pipelines
bun run pipeline run-pipeline -c ./pipelines/image-to-video-chain.yaml -i "A red fox" --save-intermediates
```

### Full movie from a novel

```bash
bun run pipeline setup
bun run pipeline set-key --name FAL_KEY
bun run pipeline set-key --name GEMINI_API_KEY
bun run pipeline vimax:novel2movie --novel my-book.txt --max-scenes 15 -o ./movie-output
```
