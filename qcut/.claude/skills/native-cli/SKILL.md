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

## Step 1: Ensure QCut is Running

Before any `editor:*` command, check if QCut is running. If not, build and launch it.

```bash
# Check if QCut is running
curl -s --connect-timeout 2 http://127.0.0.1:8765/api/claude/health || echo "NOT_RUNNING"
```

If NOT_RUNNING:

```bash
bun run build                # Build first
bun run electron &           # Launch in background
sleep 5                      # Wait for startup
```

## Step 2: Find Project, Media & Timeline

Most editor commands need `--project-id`, `--media-id`, or `--element-id`. Run these to discover them.

```bash
# 1. List projects → get project-id
bun run pipeline editor:navigator:projects

# 2. Open a project (navigates the editor)
bun run pipeline editor:navigator:open --project-id <project-id>

# 3. List media → get media-id values
bun run pipeline editor:media:list --project-id <project-id> --json

# 4. Export timeline → get track-id and element-id values
bun run pipeline editor:timeline:export --project-id <project-id> --json
```

Now you have the IDs needed for all other editor commands.

## How to Run

```bash
bun run pipeline <command> [options]            # Dev (recommended)
bun run electron/native-pipeline/cli.ts <command> [options]  # Direct source
qcut-pipeline <command> [options]               # Production binary
```

## Quick Commands

```bash
bun run pipeline list-models                          # List all models
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
```

## API Key Setup

Keys stored in `~/.qcut/.env` (mode `0600`).

```bash
bun run pipeline setup          # Create .env template
bun run pipeline set-key --name FAL_KEY   # Set a key (interactive)
bun run pipeline check-keys     # Check configured keys
```

**Supported keys:** `FAL_KEY`, `GEMINI_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `RUNWAY_API_KEY`, `HEYGEN_API_KEY`, `DID_API_KEY`, `SYNTHESIA_API_KEY`

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
