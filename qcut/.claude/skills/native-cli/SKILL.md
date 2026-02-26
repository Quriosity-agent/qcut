---
name: native-cli
description: Run QCut's native TypeScript pipeline CLI for AI content generation, video analysis, transcription, YAML pipelines, ViMax agentic video production, and project management. Use when user asks to generate images/videos, run pipelines, manage API keys, or use ViMax commands.
---

# Native Pipeline CLI Skill

Run QCut's built-in TypeScript pipeline CLI (`qcut-pipeline` / `bun run pipeline`).

## Additional resources

- For standalone CLI commands (generate, analyze, transcribe, pipelines, ViMax, project management, API keys), see [REFERENCE.md](REFERENCE.md)
- For editor commands: media, project, timeline, editing, export, diagnostics, MCP, see [editor-core.md](editor-core.md)
- For editor AI commands: video analysis, transcription, AI generation, Remotion, navigator, see [editor-ai.md](editor-ai.md)

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
bun run pipeline setup          # Create .env template
bun run pipeline set-key --name FAL_KEY   # Set a key (interactive)
bun run pipeline check-keys     # Check configured keys
```

**Supported keys:** `FAL_KEY`, `GEMINI_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `RUNWAY_API_KEY`, `HEYGEN_API_KEY`, `DID_API_KEY`, `SYNTHESIA_API_KEY`

## Quick Commands

```bash
bun run pipeline list-models                          # List all models
bun run pipeline list-models --category text_to_video # Filter by category
bun run pipeline generate-image -t "A cinematic portrait at golden hour"
bun run pipeline create-video -m kling_2_6_pro -t "Ocean waves at sunset" -d 5s
bun run pipeline generate-avatar -m omnihuman_v1_5 -t "Hello world" --image-url avatar.png
bun run pipeline analyze-video -i video.mp4 --analysis-type summary
bun run pipeline transcribe -i audio.mp3 --srt
bun run pipeline run-pipeline -c pipeline.yaml -i "A sunset" --no-confirm
bun run pipeline estimate-cost -m veo3 -d 8s
```

## ViMax Quick Start

```bash
bun run pipeline vimax:idea2video --idea "A detective in 1920s Paris" -d 120
bun run pipeline vimax:script2video --script script.json --portraits registry.json
bun run pipeline vimax:novel2movie --novel book.txt --max-scenes 20
bun run pipeline vimax:list-models
```

## Editor Quick Start

Requires QCut running (`bun run electron:dev`).

```bash
bun run pipeline editor:health                                    # Check connection
bun run pipeline editor:media:import --project-id <id> --source video.mp4
bun run pipeline editor:timeline:export --project-id <id> --json
bun run pipeline editor:analyze:video --project-id <id> --source "media:<id>"
bun run pipeline editor:transcribe:run --project-id <id> --media-id <id>
bun run pipeline editor:export:start --project-id <id> --preset youtube-1080p --poll
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
| CLI entry point | `electron/native-pipeline/cli/cli.ts` |
| Command router | `electron/native-pipeline/cli/cli-runner/runner.ts` |
| Editor dispatch | `electron/native-pipeline/cli/cli-handlers-editor.ts` |
| Admin handlers | `electron/native-pipeline/cli/cli-handlers-admin.ts` |
| Media handlers | `electron/native-pipeline/cli/cli-handlers-media.ts` |
| ViMax handlers | `electron/native-pipeline/cli/vimax-cli-handlers.ts` |
| Remotion handler | `electron/native-pipeline/cli/cli-handlers-remotion.ts` |
| Moyin handler | `electron/native-pipeline/cli/cli-handlers-moyin.ts` |
| Key manager | `electron/native-pipeline/key-manager.ts` |
