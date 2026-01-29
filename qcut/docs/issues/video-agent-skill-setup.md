# Video Agent Skill - Setup Guide

Repository: https://github.com/donghaozhang/video-agent-skill

## Overview

AI Content Generation Suite - a Python package consolidating 40+ AI models across 8 categories for video, image, and audio generation.

## Why This Matters for Gemini CLI

**Gemini CLI by itself cannot generate videos.** It's a text/code assistant. To give Gemini CLI video generation capabilities, you need to provide it with external tools.

This package serves as that **video skill layer**:

```
┌─────────────────────────────────────────────────────────┐
│                     Gemini CLI                          │
│              (understands intent, writes code)          │
└─────────────────────┬───────────────────────────────────┘
                      │ calls
                      ▼
┌─────────────────────────────────────────────────────────┐
│              video-agent-skill package                  │
│         (ai-content-pipeline CLI / Python API)          │
└─────────────────────┬───────────────────────────────────┘
                      │ routes to
                      ▼
┌─────────────────────────────────────────────────────────┐
│              AI Video Providers                         │
│  FAL.ai │ Google Veo │ Kling │ Runway │ ElevenLabs     │
└─────────────────────────────────────────────────────────┘
```

**How Gemini CLI uses this:**
1. User asks Gemini CLI: "Generate a video of a sunset over mountains"
2. Gemini CLI writes/executes: `ai-content-pipeline create-video --text "sunset over mountains"`
3. The package handles API calls to FAL/Veo/Kling
4. Video file is generated and saved

**Alternative approaches to give Gemini video skills:**
| Method | Pros | Cons |
|--------|------|------|
| video-agent-skill (this) | 40+ models, unified interface | Requires Python setup |
| Direct Veo API | Native Google, no middleware | Only Google models, GCP setup |
| MCP Server | Protocol-based, extensible | More complex setup |
| Custom function calling | Full control | Must build from scratch |

## Installation

```bash
# Clone the repository
git clone https://github.com/donghaozhang/video-agent-skill.git
cd video-agent-skill

# Install the package
pip install -e .
```

## API Keys Configuration

Create a `.env` file in the project root:

```dotenv
FAL_KEY=your_fal_api_key
GEMINI_API_KEY=your_gemini_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
PROJECT_ID=your-gcp-project-id
OUTPUT_BUCKET_PATH=gs://your-bucket/veo_output/
```

### Where to Get API Keys

| Provider | URL |
|----------|-----|
| FAL AI | https://fal.ai/dashboard |
| Google Gemini | https://makersuite.google.com/app/apikey |
| OpenRouter | https://openrouter.ai/keys |
| ElevenLabs | https://elevenlabs.io/app/settings |

## Usage with Gemini CLI

### Basic Commands

```bash
# List all available models
ai-content-pipeline list-models

# Generate an image
ai-content-pipeline generate-image --text "epic space battle" --model flux_dev

# Create video from text
ai-content-pipeline create-video --text "serene mountain lake"

# Create example configurations
ai-content-pipeline create-examples

# Use the short alias
aicp --help
```

### Test with Mock Mode (FREE)

Validate your setup without spending money:

```bash
ai-content-pipeline generate-image --text "test prompt" --mock
```

## YAML Pipeline Configuration

Create a `config.yaml` file:

```yaml
name: "Text to Video Pipeline"
description: "Generate video from text prompt"
steps:
  - name: "generate_image"
    type: "text_to_image"
    model: "flux_dev"
    aspect_ratio: "16:9"

  - name: "create_video"
    type: "image_to_video"
    model: "kling_video"
    input_from: "generate_image"
    duration: 8
```

Run the pipeline:

```bash
ai-content-pipeline run-chain --config config.yaml --input "cyberpunk city at night"
```

## Python API Usage

```python
from packages.core.ai_content_pipeline.pipeline.manager import AIPipelineManager

manager = AIPipelineManager()

# Quick video creation
result = manager.quick_create_video(
    text="serene mountain lake",
    image_model="flux_dev",
    video_model="auto"
)

# Run custom chain
chain = manager.create_chain_from_config("config.yaml")
result = manager.execute_chain(chain, "input text")
```

## Parallel Execution

Enable parallel processing for 2-3x speedup:

```bash
PIPELINE_PARALLEL_ENABLED=true ai-content-pipeline run-chain --config config.yaml
```

## Cost Estimates

| Category | Cost Range |
|----------|------------|
| Text-to-Image | $0.001-0.004 per image |
| Text-to-Video | $0.08-6.00 per video |
| Avatar Generation | $0.02-0.05 per video |
| Video Processing | $0.05-2.50 per video |

Estimate costs before running:

```bash
ai-content-pipeline estimate-cost --config config.yaml
```

## Available Model Categories

1. **Text-to-Image**: flux_dev, flux_pro, etc.
2. **Image-to-Video**: kling_video, runway, etc.
3. **Text-to-Video**: Sora 2, Veo, Kling
4. **Avatar Generation**: Talking head generation
5. **Text-to-Speech**: ElevenLabs (20+ voices)
6. **Video Processing**: Upscaling, transformations
7. **Image-to-Image**: Style transfer, editing
8. **Video-to-Video**: Processing, enhancement

## Testing

```bash
python tests/run_all_tests.py --quick
```

## Troubleshooting

### Common Issues

1. **API Key Not Found**: Ensure `.env` file is in the project root
2. **Module Not Found**: Run `pip install -e .` from the project directory
3. **Permission Denied**: Check your API key permissions on respective platforms

### Validate Setup

```bash
# Check if installation is successful
ai-content-pipeline --help

# Test with mock mode (no API calls)
ai-content-pipeline generate-image --text "test" --mock
```
