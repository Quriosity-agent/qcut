---
name: AI Content Pipeline
description: Generate AI content (images, videos, audio, avatars) and analyze videos with AICP in QCut. Primary mode uses QCut's bundled AICP binary with secure API key injection.
dependencies: qcut>=0.3.67 (bundled aicp)
---

# AI Content Pipeline Skill

Generate AI content (images, videos, audio) and analyze media using AICP.

Reference files:
- `REFERENCE.md` - model specs, API endpoints, troubleshooting
- `EXAMPLES.md` - YAML pipeline examples

## Usage Modes

### Mode 1 (Recommended): QCut Bundled AICP

Use this when working inside QCut.

What QCut handles for you:
- bundled `aicp` binary (no local Python or pip required)
- encrypted API key storage in Electron main process
- `FAL_KEY` injection at spawn time for generation commands
- output path recovery and optional media auto-import in app flow

Setup steps:
1. Open QCut and go to `Editor -> Settings -> API Keys`.
2. Add your FAL API key once.
3. Use AI generation features from the app.

Notes:
- No `.env` file is required for normal QCut usage.
- If key is missing, app should fail fast with actionable guidance.

### Mode 2: Standalone CLI (Debug/Dev)

Use this for local debugging outside QCut.

```bash
# Use bundled binary directly
./electron/resources/bin/aicp/darwin-arm64/aicp --version
./electron/resources/bin/aicp/darwin-arm64/aicp --help
```

If you call remote provider models from standalone CLI, export keys manually:

```bash
export FAL_KEY=your_fal_key
# optional
export GEMINI_API_KEY=your_gemini_key
export ELEVENLABS_API_KEY=your_elevenlabs_key
```

## Quick Commands

Always inspect available models first in your current environment:

```bash
aicp list-models
```

Then use a model returned by your local `list-models` output.

### Generate Image

```bash
aicp generate-image \
  --text "A cinematic portrait at golden hour" \
  --model MODEL_FROM_LIST_MODELS
```

### Generate Video

```bash
aicp create-video --text "A serene mountain lake at sunset"
```

### Generate Avatar (Lipsync)

```bash
aicp generate-avatar \
  --image-url "https://..." \
  --audio-url "https://..." \
  --model omnihuman_v1_5
```

### Transfer Motion

```bash
aicp transfer-motion -i person.jpg -v dance.mp4
```

### Analyze Video

```bash
aicp analyze-video -i video.mp4
```

### Run YAML Pipeline

```bash
PIPELINE_PARALLEL_ENABLED=true aicp run-chain --config pipeline.yaml
```

## Model and Feature Availability

Do not assume all documented models are enabled in every runtime.

Availability depends on:
- packaged binary build contents
- provider modules present in runtime
- API keys and account/provider access

Practical rule:
- treat `aicp list-models` as source of truth for your current machine/runtime

## Known CLI Caveats

- `list-models` may emit provider initialization warnings in standalone mode.
- `list-models` does not reliably support `--json` in current upstream behavior.
- `generate-image` can fail if selected model is not actually available in your runtime.

## Output Structure

Generated content should follow QCut project structure:

```text
media/generated/
├── images/
├── videos/
└── audio/
```

This aligns with organize-project conventions.

## FAL API Direct Access

For direct API calls (not via CLI), model keys still map to endpoint slugs.
See `REFERENCE.md` for endpoint mappings.
