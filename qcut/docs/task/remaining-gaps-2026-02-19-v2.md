# Remaining Gaps: Python → TypeScript Parity (v2)

> **Date:** 2026-02-19
> **Previous audit:** [remaining-gaps-2026-02-19.md](remaining-gaps-2026-02-19.md) — 15 items, ALL DONE
> **Python source:** `packages/video-agent-skill/packages/core/ai_content_pipeline/`
> **TypeScript target:** `electron/native-pipeline/`
> **Status:** ALL GAPS IMPLEMENTED (2026-02-19)

---

## Summary

| Category | Gap Count | Status |
|----------|:---------:|:------:|
| `transcribe` Missing Options | 8 options | DONE |
| `transfer-motion` Missing Options | 3 options | DONE |
| `generate-avatar` Missing Options | 2 options | DONE |
| `analyze-video` Missing Options | 2 options | DONE |
| `upscale-image` Missing Options | 2 options | DONE |
| `generate-grid` Missing Options | 2 options | DONE |
| `vimax:idea2video` Missing Options | 2 options | DONE |
| Stdin Pipe Support (`--input -`) | 1 utility | DONE |
| ViMax Adapter Utility Methods | 4 methods | DONE |
| **Total** | **26 items** | **ALL DONE** |

---

## 1. `transcribe` Command — 8 Missing Options

**Python source:** `cli/commands/audio.py` — `transcribe_cmd()`
**TypeScript:** `cli-runner.ts` — `handleTranscribe()`

| Option | Python | TypeScript | Notes |
|--------|:------:|:----------:|-------|
| `--language` | Yes | No | Language code (eng, spa, fra). Default: auto-detect |
| `--diarize/--no-diarize` | Yes (default: true) | No | Speaker diarization |
| `--tag-events/--no-tag-events` | Yes (default: true) | No | Audio event tagging (laughter, music, etc.) |
| `--keyterms` | Yes (multiple) | No | Terms to bias transcription (+30% cost) |
| `--srt` | Yes | No | Generate SRT subtitle file from word timestamps |
| `--srt-max-words` | Yes (default: 8) | No | Max words per subtitle line |
| `--srt-max-duration` | Yes (default: 4.0) | No | Max seconds per subtitle |
| `--raw-json` | Yes | No | Save raw API response with word-level timestamps |

**Impact:** Users cannot generate subtitles, control diarization, or specify transcription language via CLI.

**Fix files:**
- `electron/native-pipeline/cli.ts` — Add 8 parseArgs options
- `electron/native-pipeline/cli-runner.ts` — Add options to `CLIRunOptions`, pass to `handleTranscribe()`
- `electron/native-pipeline/step-executors.ts` — Pass language/diarize/keyterms params to STT API call
- New: SRT generation utility (convert word timestamps → SRT format)

---

## 2. `transfer-motion` Command — 3 Missing Options

**Python source:** `cli/commands/motion.py` — `transfer_motion_cmd()`
**TypeScript:** `cli-runner.ts` — `handleTransferMotion()`

| Option | Python | TypeScript | Notes |
|--------|:------:|:----------:|-------|
| `--orientation` | Yes (`video`/`image`) | No | Character orientation. Video: max 30s. Image: max 10s |
| `--no-sound` | Yes (flag) | No | Remove audio from output |
| `--prompt, -p` | Yes | No | Text description to guide generation |

**Fix files:**
- `electron/native-pipeline/cli.ts` — Add `orientation`, `no-sound` parseArgs options
- `electron/native-pipeline/cli-runner.ts` — Add to `CLIRunOptions`, pass to `handleTransferMotion()` step params

---

## 3. `generate-avatar` Command — 2 Missing Options

**Python source:** `cli/commands/media.py` — `generate_avatar_cmd()`
**TypeScript:** `cli-runner.ts` — `handleGenerate()` (shared handler)

| Option | Python | TypeScript | Notes |
|--------|:------:|:----------:|-------|
| `--reference-images` | Yes (multiple, max 4) | No | Reference images for video generation |
| Smart mode detection | Yes | No | Auto-selects mode: lipsync/TTS/reference/transform |

**Python mode detection logic:**
```
image + audio       → lipsync mode
image + text        → TTS avatar mode
reference-images    → reference-based video generation
video               → video transformation
```

**Impact:** No reference-image-based avatar generation from CLI.

**Fix files:**
- `electron/native-pipeline/cli.ts` — Add `reference-images` as multiple string option
- `electron/native-pipeline/cli-runner.ts` — Add `referenceImages?: string[]` to `CLIRunOptions`, add mode detection logic to `handleGenerate()` or new `handleGenerateAvatar()`

---

## 4. `analyze-video` Command — 2 Missing Options

**Python source:** `cli/commands/media.py` — `analyze_video_cmd()`
**TypeScript:** `cli-runner.ts` — `handleAnalyzeVideo()`

| Option | Python | TypeScript | Notes |
|--------|:------:|:----------:|-------|
| `--type, -t` | Yes (default: `timeline`) | No | Analysis type |
| `--format, -f` | Yes (`md`/`json`/`both`) | No | Output format (markdown, JSON, or both) |

**Fix files:**
- `electron/native-pipeline/cli.ts` — Add `analysis-type`, `output-format` parseArgs options
- `electron/native-pipeline/cli-runner.ts` — Pass to step params and format output accordingly

---

## 5. `upscale-image` Command — 2 Missing Options

**Python source:** `cli/commands/imaging.py` — `upscale_image_cmd()`
**TypeScript:** `cli-runner.ts` — `handleUpscaleImage()`

| Option | Python | TypeScript | Notes |
|--------|:------:|:----------:|-------|
| `--target` | Yes (`720p`/`1080p`/`1440p`/`2160p`) | No | Target resolution (overrides --factor/--upscale) |
| `--format` | Yes (`png`/`jpg`/`webp`, default: `png`) | No | Output image format |

**Fix files:**
- `electron/native-pipeline/cli.ts` — Add `target`, `output-format` parseArgs options
- `electron/native-pipeline/cli-runner.ts` — Map `--target` to resolution params, use `--format` for download extension

---

## 6. `generate-grid` Command — 2 Missing Options

**Python source:** `cli/commands/imaging.py` — `generate_grid_cmd()`
**TypeScript:** `cli-runner.ts` — `handleGenerateGrid()`

| Option | Python | TypeScript | Notes |
|--------|:------:|:----------:|-------|
| `--style, -s` | Yes | No | Style override applied to all panel prompts |
| `--upscale` | Yes (float) | No | Post-generation upscale factor (e.g., 2 for 2x) |

**Note:** Python uses `--prompt-file` (markdown with per-panel descriptions) vs TypeScript's `--text` (single prompt). This is a design choice, not a gap — TypeScript generates all panels from one prompt.

**Fix files:**
- `electron/native-pipeline/cli.ts` — `style` already parsed (added in v1). Add `grid-upscale` option
- `electron/native-pipeline/cli-runner.ts` — Prepend style to prompts, run upscale step after grid compositing

---

## 7. `vimax:idea2video` — 2 Missing Options

**Python source:** `vimax/cli/commands.py` — `idea2video_cmd()`
**TypeScript:** `vimax-cli-handlers.ts` — `handleVimaxIdea2Video()`

| Option | Python | TypeScript | Notes |
|--------|:------:|:----------:|-------|
| `--config, -c` | Yes (YAML path) | No | Load pipeline config from YAML file |
| `--references/--no-references` | Yes (default: true) | No | Separate flag from `--portraits` to control storyboard reference use |

**Python distinction:**
- `--portraits/--no-portraits` → Whether to **generate** character portraits
- `--references/--no-references` → Whether to **use** portraits in storyboard generation

TypeScript only has `--no-portraits` which conflates both behaviors.

**Fix files:**
- `electron/native-pipeline/cli.ts` — Add `no-references` parseArgs option
- `electron/native-pipeline/cli-runner.ts` — Add `noReferences?: boolean` to `CLIRunOptions`
- `electron/native-pipeline/vimax-cli-handlers.ts` — Pass `use_character_references` separately from `generate_portraits`

---

## 8. Stdin Pipe Support (`--input -`)

**Python:** Multiple commands support `--input -` to read from stdin pipe.
**TypeScript:** `readHiddenInput()` exists for `set-key` only.

**Commands that should support `--input -` in Python:**
- `generate-image` (read prompt from stdin)
- `create-video` (read prompt from stdin)
- `run-pipeline` (read input from stdin)
- `transcribe` (read audio path from stdin)
- `transfer-motion` (read image path from stdin)
- `upscale-image` (read image path from stdin)

**Fix:** Add a `readStdin()` utility to `interactive.ts` and check `options.input === "-"` in relevant handlers to read from `process.stdin`.

---

## 9. ViMax Adapter Utility Methods — 4 Missing

**Python source:** `vimax/adapters/image_adapter.py`, `vimax/adapters/video_adapter.py`
**TypeScript:** `vimax/adapters/image-adapter.ts`, `vimax/adapters/video-adapter.ts`

| Method | Python | TypeScript | Notes |
|--------|:------:|:----------:|-------|
| `ImageGeneratorAdapter.get_available_models()` | Yes | No | Returns list of supported text-to-image models |
| `ImageGeneratorAdapter.get_model_info()` | Yes | No | Returns model metadata (cost, max steps, etc.) |
| `ImageGeneratorAdapter.supports_reference_images()` | Yes | No | Checks if model supports reference-based generation |
| `VideoGeneratorAdapter.get_available_models()` | Yes | No | Returns list of supported video models |

**Impact:** No programmatic way to query adapter capabilities from TypeScript code. Used by ViMax agents to validate model selection.

**Fix files:**
- `electron/native-pipeline/vimax/adapters/image-adapter.ts` — Add 3 static/instance methods
- `electron/native-pipeline/vimax/adapters/video-adapter.ts` — Add 1 static/instance method

---

## Non-Gaps (Confirmed Parity)

| Area | Status | Notes |
|------|:------:|-------|
| Model Registry | PARITY+ | TS has 77 models vs Python 73 (4 extra) |
| ViMax Agents | PARITY | All 7 agents ported with same logic |
| ViMax Pipelines | PARITY | idea2video, script2video, novel2movie all ported |
| ViMax Types | PARITY | Shot, character, output types all match |
| Chain Parser | PARITY | Parallel groups, variables, conditions, validation |
| Cost Calculator | PARITY | Per-model and pipeline cost estimation |
| Stream Emitter | PARITY | JSONL events: start, progress, complete, error |
| Error Codes | PARITY+ | TS has 11 codes vs Python 6 (more granular) |
| CLI Output | PARITY | JSON envelope, human-readable, quiet modes |
| Interactive Mode | PARITY | CI detection (9 env vars), confirm(), hidden input |
| Key Management | PARITY+ | TS supports 10 keys vs Python 4 |
| Project Commands | PARITY | init, organize, structure-info all ported |

---

## Recommended Priority Order

1. **`transcribe` options** (0.5d) — SRT subtitle generation is high-value for video editors
2. **`transfer-motion` options** (0.25d) — `--orientation` and `--prompt` directly affect output quality
3. **`generate-avatar` reference images** (0.25d) — Enables reference-based video generation
4. **`vimax:idea2video` references flag** (0.15d) — Separates portrait generation from reference use
5. **`analyze-video` options** (0.25d) — Output format control for CI integration
6. **`upscale-image` options** (0.15d) — Target resolution is more user-friendly than factor
7. **`generate-grid` options** (0.15d) — Style override and post-upscale
8. **Stdin pipe support** (0.25d) — Enables scripting and CI piping patterns
9. **Adapter utility methods** (0.25d) — Internal API completeness for agent code
