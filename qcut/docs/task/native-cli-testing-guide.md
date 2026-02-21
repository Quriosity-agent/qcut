# Testing the Native Pipeline CLI

> How to actually run, smoke-test, and verify the native TypeScript pipeline CLI.

## Prerequisites

- Bun installed (`bun --version`)
- Dependencies installed (`bun install` from `qcut/`)
- No API keys needed for smoke tests

## 1. Smoke Tests (No API Keys Required)

These commands work immediately — no keys, no network.

### 1.1 Verify CLI Loads

```bash
bun run pipeline --version
# Expected: 1.0.0

bun run pipeline --help
# Expected: Usage text with all commands listed
```

### 1.2 List Models (Registry Test)

```bash
bun run pipeline list-models
# Expected: 70+ models printed, grouped by category

bun run pipeline list-models --category text_to_video
# Expected: Subset of video models only

bun run pipeline list-models --json
# Expected: JSON array of model objects
```

### 1.3 Specialized Model Lists

```bash
bun run pipeline list-video-models
bun run pipeline list-avatar-models
bun run pipeline list-motion-models
bun run pipeline list-speech-models
bun run pipeline vimax:list-models
```

### 1.4 Cost Estimation

```bash
bun run pipeline estimate-cost -m flux_dev
# Expected: Cost estimate for image generation

bun run pipeline estimate-cost -m kling_2_6_pro -d 5s
# Expected: Cost estimate for 5s video

bun run pipeline estimate-cost -m veo3 -d 8s
```

### 1.5 Key Management

```bash
bun run pipeline check-keys
# Expected: All keys listed with "not set" status

bun run pipeline setup
# Expected: Creates ~/.qcut/.env template

bun run pipeline check-keys
# Expected: All keys listed (still not set, but .env file exists)
```

### 1.6 Project Management

```bash
# Preview project structure (dry run)
bun run pipeline init-project --directory /tmp/qcut-test --dry-run
# Expected: Lists directories that would be created

# Actually create it
bun run pipeline init-project --directory /tmp/qcut-test
# Expected: Creates input/, output/, config/ subdirectories

# Check structure
bun run pipeline structure-info --directory /tmp/qcut-test
# Expected: File counts per directory (all 0)

# Create example pipelines
bun run pipeline create-examples -o /tmp/qcut-test/pipelines
# Expected: 5 YAML files written

ls /tmp/qcut-test/pipelines/
# Expected: text-to-video-basic.yaml, image-to-video-chain.yaml, etc.

# Clean up
rm -rf /tmp/qcut-test
```

### 1.7 Portrait Registry (Local File Ops)

```bash
# Create test portrait directory
mkdir -p /tmp/portraits/Alice /tmp/portraits/Bob
touch /tmp/portraits/Alice/front.png /tmp/portraits/Bob/front.png

# Build registry
bun run pipeline vimax:create-registry --input /tmp/portraits

# View registry
bun run pipeline vimax:show-registry --input /tmp/portraits/registry.json
# Expected: JSON registry with Alice and Bob entries

rm -rf /tmp/portraits
```

### 1.8 Organize Project

```bash
# Setup test files
mkdir -p /tmp/org-test
touch /tmp/org-test/photo.png /tmp/org-test/clip.mp4 /tmp/org-test/song.mp3 /tmp/org-test/notes.txt

# Preview organization (dry run)
bun run pipeline organize-project --directory /tmp/org-test --dry-run
# Expected: Shows which files would move to which folders

# Actually organize
bun run pipeline init-project --directory /tmp/org-test
bun run pipeline organize-project --directory /tmp/org-test
bun run pipeline structure-info --directory /tmp/org-test
# Expected: Files sorted into input/images, input/videos, input/audio, input/text

rm -rf /tmp/org-test
```

---

## 2. Error Handling Tests (No API Keys)

Verify the CLI fails gracefully without keys.

### 2.1 Generate Without Key

```bash
bun run pipeline generate-image -m flux_dev -t "test"
# Expected: Error about missing FAL_KEY (not a crash/stacktrace)
```

### 2.2 Generate Without Required Flags

```bash
bun run pipeline generate-image
# Expected: Error about missing --model and --text

bun run pipeline create-video -m kling_2_6_pro
# Expected: Error about missing --text or --image-url
```

### 2.3 Unknown Command

```bash
bun run pipeline not-a-command
# Expected: Exit code 2, error about unknown command
```

### 2.4 Invalid Pipeline YAML

```bash
echo "invalid: yaml: [" > /tmp/bad.yaml
bun run pipeline run-pipeline -c /tmp/bad.yaml -i "test"
# Expected: YAML parse error (not a crash)
rm /tmp/bad.yaml
```

---

## 3. API Key Setup (For Live Generation Tests)

```bash
# Set FAL key (interactive hidden prompt)
bun run pipeline set-key --name FAL_KEY

# Verify it's stored
bun run pipeline check-keys
# Expected: FAL_KEY shows "envfile" source

# View key (masked)
bun run pipeline get-key --name FAL_KEY
# Expected: sk-***...***

# Optional: set more keys for full coverage
bun run pipeline set-key --name GEMINI_API_KEY      # for analyze-video
bun run pipeline set-key --name OPENROUTER_API_KEY  # for LLM/ViMax agents
bun run pipeline set-key --name ELEVENLABS_API_KEY  # for avatar TTS
```

---

## 4. Live Generation Tests (Requires FAL_KEY)

### 4.1 Generate Image

```bash
bun run pipeline generate-image -m flux_dev -t "A red fox in snow" -o /tmp/cli-test
# Expected: Progress bar → .png file in /tmp/cli-test/
# Verify: open /tmp/cli-test/*.png
```

### 4.2 Generate Image (JSON Output)

```bash
bun run pipeline generate-image -m flux_dev -t "A red fox in snow" -o /tmp/cli-test --json
# Expected: JSON with success, outputPath, cost, duration
```

### 4.3 Create Video

```bash
bun run pipeline create-video -m kling_2_6_pro -t "Ocean waves" -d 5s -o /tmp/cli-test
# Expected: Progress bar → .mp4 file
# Note: Video generation takes 1-3 minutes
```

### 4.4 Image to Video

```bash
# Use the image from 4.1 as input
bun run pipeline create-video -m kling_2_6_pro \
  --image-url /tmp/cli-test/<image-from-4.1>.png \
  -t "Fox runs through snow" -d 5s -o /tmp/cli-test
```

### 4.5 Image Grid

```bash
bun run pipeline generate-grid -t "Sunset over ocean" --layout 2x2 -o /tmp/cli-test
# Expected: 2x2 composite .png
```

### 4.6 Upscale Image

```bash
bun run pipeline upscale-image --image /tmp/cli-test/<image>.png --target 1080p -o /tmp/cli-test
```

---

## 5. Analysis Tests (Requires GEMINI_API_KEY)

### 5.1 Analyze Video

```bash
bun run pipeline analyze-video -i /path/to/video.mp4 --analysis-type summary
bun run pipeline analyze-video -i /path/to/video.mp4 --analysis-type timeline -f json
bun run pipeline analyze-video -i /path/to/video.mp4 --prompt "Count the people"
```

### 5.2 Transcribe Audio

```bash
bun run pipeline transcribe -i /path/to/audio.mp3 --srt
# Expected: Text output + .srt file
```

---

## 6. Pipeline Tests (Requires FAL_KEY)

### 6.1 Run Example Pipeline

```bash
bun run pipeline create-examples -o /tmp/cli-pipelines
bun run pipeline run-pipeline -c /tmp/cli-pipelines/text-to-video-basic.yaml \
  -i "A peaceful mountain lake at sunrise" --no-confirm -o /tmp/cli-test
```

### 6.2 Pipeline with Intermediates

```bash
bun run pipeline run-pipeline -c /tmp/cli-pipelines/image-to-video-chain.yaml \
  -i "A cyberpunk city" --no-confirm --save-intermediates -o /tmp/cli-test
# Expected: Both intermediate image and final video saved
```

### 6.3 Stdin Input

```bash
echo "A starry night sky" | bun run pipeline run-pipeline \
  -c /tmp/cli-pipelines/text-to-video-basic.yaml --input - --no-confirm
```

---

## 7. ViMax Tests (Requires FAL_KEY + LLM Key)

### 7.1 Extract Characters

```bash
bun run pipeline vimax:extract-characters \
  -t "Alice was a curious girl. The Mad Hatter sat at the long table with the March Hare." \
  -o /tmp/cli-test
# Expected: characters.json with Alice, Mad Hatter, March Hare
```

### 7.2 Generate Script

```bash
bun run pipeline vimax:generate-script \
  --idea "A robot discovers it can dream" -d 30 -o /tmp/cli-test
# Expected: script.json with scenes
```

### 7.3 Full Idea to Video (Long Running)

```bash
bun run pipeline vimax:idea2video \
  --idea "A cat astronaut explores Mars" -d 30 --no-portraits -o /tmp/cli-test
# Note: This runs the full pipeline — may take 5-15 minutes
```

---

## 8. Unit Tests

```bash
# Run all tests (includes native pipeline tests)
bun run test

# Run only native pipeline tests
cd apps/web && bunx vitest run --reporter=verbose 2>&1 | grep -E "(native|cli|vimax)"
```

Test files covering the CLI:

| File | Coverage |
|------|----------|
| `electron/__tests__/cli-pipeline.test.ts` | Arg parsing, list-models, estimate-cost, generate validation, run-pipeline |
| `electron/__tests__/native-pipeline-e2e.test.ts` | Registry, model lookups, cost estimation, chain validation |
| `electron/__tests__/cli-v2-gaps.test.ts` | Arg parsing parity |
| `electron/__tests__/cli-v3-gaps.test.ts` | negative-prompt, project-id, convenience functions |
| `electron/__tests__/native-registry.test.ts` | Registry CRUD |
| `electron/__tests__/native-cost-calculator.test.ts` | Cost math |
| `electron/__tests__/native-chain-parser.test.ts` | YAML parsing |
| `electron/__tests__/native-step-executors.test.ts` | Step executor units |
| `electron/__tests__/vimax-*.test.ts` (4 files) | ViMax adapters, agents, pipelines |

---

## Quick Checklist

Copy-paste this for a fast smoke test run:

```bash
# 1. CLI loads
bun run pipeline --version

# 2. Registry works
bun run pipeline list-models | head -5

# 3. Cost estimation works
bun run pipeline estimate-cost -m flux_dev

# 4. Key management works
bun run pipeline check-keys

# 5. Project management works
bun run pipeline init-project --directory /tmp/qcut-smoke --dry-run

# 6. Error handling works
bun run pipeline generate-image 2>&1 | head -3

# 7. Unit tests pass
bun run test
```

All 7 checks should pass without any API keys configured.
