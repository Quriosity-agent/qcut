# Remaining Gaps: Python → TypeScript Parity (v3)

> **Date:** 2026-02-19
> **Previous audits:**
> - [v1](remaining-gaps-2026-02-19.md) — 15 items, ALL DONE
> - [v2](remaining-gaps-2026-02-19-v2.md) — 26 items, ALL DONE
> **Python source:** `packages/video-agent-skill/packages/core/ai_content_pipeline/`
> **TypeScript target:** `electron/native-pipeline/`
> **Status:** ALL GAPS IMPLEMENTED (2026-02-19)

---

## Summary

| Category | Gap Count | Status |
|----------|:---------:|:------:|
| Unused CLI Options (Wire to Handlers) | 3 options | DONE |
| `script2video` Missing `--no-references` | 1 option | DONE |
| `create-registry` Missing `--project-id` | 1 option | DONE |
| Adapter Convenience Functions | 5 functions | DONE |
| `ImageGeneratorAdapter.getAvailableReferenceModels()` | 1 method | DONE |
| **Total** | **11 items** | **ALL DONE** |

---

## 1. Unused CLI Options — Wire to Handlers (3 options)

These options are parsed in `cli.ts` and defined in `CLIRunOptions` but **never consumed** by any handler.

### 1.1 `--negative-prompt`

**Python:** `create-video` and `generate-image` support negative prompts.
**TypeScript:** Parsed (`cli.ts:208`, `cli-runner.ts:98`) but never passed to step params in `handleGenerate()`.
**Step executors support it:** Yes — `step-executors.ts:183` applies `negative_prompt` from payload.

**Fix:** In `cli-runner.ts::handleGenerate()`, add:
```ts
if (options.negativePrompt) params.negative_prompt = options.negativePrompt;
```

### 1.2 `--voice-id`

**Python:** `generate-avatar` uses voice_id for ElevenLabs TTS avatar mode.
**TypeScript:** Parsed (`cli.ts:209`, `cli-runner.ts:99`) but never passed to step params.
**Step executors support it:** Yes — `step-executors.ts:333` applies `voice_id` for ElevenLabs.

**Fix:** In `cli-runner.ts::handleGenerate()`, add:
```ts
if (options.voiceId) params.voice_id = options.voiceId;
```

### 1.3 `--config-dir`, `--cache-dir`, `--state-dir`

**Python:** Global CLI options that override XDG directory paths for config, cache, state.
**TypeScript:** Parsed (`cli.ts:205-207`, `cli-runner.ts:96-98`) but never consumed.
**Impact:** Low — these are for environment/deployment customization.

**Fix:** Pass to `loadEnvFile()` or key-manager functions if needed. Or remove from parser if not planned.

---

## 2. `script2video` Missing `--no-references` (1 option)

**Python source:** `vimax/cli/commands.py` — `script2video_cmd()` has `--references/--no-references`
**TypeScript:** `vimax-cli-handlers.ts:682` hardcodes `use_character_references: !!portraitRegistry || true`

The `||true` means references are always enabled regardless of user intent. Python allows disabling reference use even when portraits are loaded.

**Fix files:**
- `electron/native-pipeline/vimax-cli-handlers.ts` — Line 682: Replace `!!portraitRegistry || true` with `!(options.noReferences ?? false)`

---

## 3. `create-registry` Missing `--project-id` (1 option)

**Python source:** `vimax/cli/commands.py` — `create_registry_cmd()` has `--project-id` option (default: `"project"`)
**TypeScript:** `vimax-cli-handlers.ts:425` hardcodes `new CharacterPortraitRegistry("cli-project")`

**Fix files:**
- `electron/native-pipeline/cli.ts` — Add `"project-id": { type: "string" }` to parseArgs
- `electron/native-pipeline/cli.ts` — Add `projectId: values["project-id"] as string | undefined` to return
- `electron/native-pipeline/cli-runner.ts` — Add `projectId?: string` to `CLIRunOptions`
- `electron/native-pipeline/vimax-cli-handlers.ts` — Use `options.projectId || "cli-project"` instead of hardcoded value

---

## 4. Adapter Convenience Functions (5 functions)

**Python source:** Module-level convenience functions exported from adapter files for quick one-off operations without instantiating adapter classes.

**TypeScript:** Only has class-based API (must create adapter instance).

### Missing Functions

| Function | Python File | Purpose |
|----------|-------------|---------|
| `generateImage(prompt, model?, ...)` | `image_adapter.py` | Quick single image generation |
| `generateImageWithReference(prompt, ref, ...)` | `image_adapter.py` | Quick reference-based generation |
| `generateVideo(imagePath, prompt, ...)` | `video_adapter.py` | Quick single video generation |
| `chat(messages, model?, ...)` | `llm_adapter.py` | Quick LLM chat without adapter |
| `generate(prompt, model?, ...)` | `llm_adapter.py` | Quick text generation |

**Fix files:**
- `electron/native-pipeline/vimax/adapters/image-adapter.ts` — Add 2 exported convenience functions
- `electron/native-pipeline/vimax/adapters/video-adapter.ts` — Add 1 exported convenience function
- `electron/native-pipeline/vimax/adapters/llm-adapter.ts` — Add 2 exported convenience functions

---

## 5. `ImageGeneratorAdapter.getAvailableReferenceModels()` (1 method)

**Python:** `image_adapter.py` has `get_available_reference_models()` that returns keys from `REFERENCE_MODEL_MAP`.
**TypeScript:** Has `getAvailableModels()` and `supportsReferenceImages()` but no method to list ALL reference-capable models.

**Fix:** Add static method to `image-adapter.ts`:
```ts
static getAvailableReferenceModels(): string[] {
  return Object.keys(REFERENCE_MODEL_MAP);
}
```

---

## Non-Gaps (Confirmed Parity or Design Choices)

| Area | Status | Notes |
|------|:------:|-------|
| `--resolution` option | PARITY | Wired in `handleGenerate()` at line 307 |
| `--json` global flag | PARITY | Handled in `cli.ts::main()` output formatting |
| LLM Adapter | PARITY | Full implementation including `chatWithStructuredOutput()` |
| Generate-avatar mode detection | PARITY | Smart mode with reference-images support added in v2 |
| SRT generation | PARITY | Full implementation with word timestamp extraction |
| Stdin pipe (`--input -`) | PARITY | `readStdin()` utility wired in `cli-runner.ts::run()` |
| Pipeline confirmation | PARITY | `confirm()` + `isInteractive()` + `--no-confirm` |
| Portrait registry | PARITY | Full registry with views, save/load, storyboard injection |
| Adapter static methods | DESIGN | TS uses static vs Python instance — TS approach is cleaner |
| `--save-json` option | DESIGN | Python has per-command `--save-json`; TS uses global `--json` flag instead |
| `--characters` vs `--text` | DESIGN | TS auto-detects JSON vs text input — more flexible than Python |

---

## Recommended Priority Order

1. **Wire unused options** (0.5d) — `negativePrompt`, `voiceId` are 2-line fixes that unlock real functionality
2. **Fix `script2video` references** (0.1d) — One-line fix for correctness
3. **Add `--project-id`** (0.1d) — Small feature addition
4. **Add convenience functions** (0.25d) — Better API ergonomics for programmatic use
5. **Add `getAvailableReferenceModels()`** (0.1d) — API completeness
