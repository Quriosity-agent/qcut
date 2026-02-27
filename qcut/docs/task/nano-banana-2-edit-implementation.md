# Nano Banana 2 Edit — Implementation Plan

**Model**: `fal-ai/nano-banana-2/edit` (Google's state-of-the-art image editing model)
**Branch**: `nano-banana2`
**Estimated time**: ~45 minutes (5 subtasks)

---

## API Reference

| Parameter | Type | Required | Default | Notes |
|-----------|------|----------|---------|-------|
| `prompt` | string | Yes | — | 3–50,000 chars |
| `image_urls` | string[] | Yes | — | Multi-image input |
| `num_images` | int | No | 1 | 1–4 |
| `seed` | int | No | — | Reproducibility |
| `aspect_ratio` | enum | No | "auto" | auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16 |
| `output_format` | enum | No | "png" | jpeg, png, webp |
| `resolution` | enum | No | "1K" | 0.5K, 1K, 2K, 4K |
| `safety_tolerance` | enum | No | "4" | 1 (strict) – 6 (lenient) |
| `sync_mode` | bool | No | false | Return data URI |
| `limit_generations` | bool | No | true | Limit to 1 per round |
| `enable_web_search` | bool | No | false | Web-enhanced gen |

**Output**: `{ images: [{ url, file_name, content_type, file_size, width, height }], description }`
**Pricing**: ~$0.08/image (1K), 1.5× for 2K, 2× for 4K, 0.75× for 0.5K. +$0.015 if web search.

---

## Subtask 1: Register model in UI image-edit system (~8 min)

Add Nano Banana 2 Edit to the frontend image-edit capabilities and client.

### Files to modify

**`apps/web/src/lib/ai-clients/image-edit-capabilities.ts`**
- Add `"nano-banana-2"` to `IMAGE_EDIT_MODEL_IDS` array
- Add entry in `MODEL_CAPABILITIES`: `{ maxImages: 4, supportsMultiple: true }`

**`apps/web/src/lib/ai-clients/image-edit-client.ts`**
- Add `"nano-banana-2"` endpoint mapping in `MODEL_ENDPOINTS`:
  ```
  endpoint: "fal-ai/nano-banana-2/edit"
  defaults: { output_format: "png", num_images: 1, sync_mode: true }
  ```
- Add request body builder case handling `resolution`, `aspect_ratio`, `safety_tolerance`, `enable_web_search`, `limit_generations`

**`apps/web/src/lib/ai-clients/image-edit-models-info.ts`**
- Add model info entry with name, provider, description, pricing

### Acceptance criteria
- `"nano-banana-2"` is a valid `ImageEditModelId`
- `getModelCapabilities("nano-banana-2")` returns `{ maxImages: 4, supportsMultiple: true }`
- API calls to `fal-ai/nano-banana-2/edit` work with all supported parameters

---

## Subtask 2: Create parameter handler (~5 min)

Create a dedicated parameter converter following the existing `nano-banana-params.ts` pattern.

### Files to create

**`apps/web/src/lib/fal-ai/model-handlers/nano-banana-2-params.ts`**
- Export `convertNanoBanana2Parameters(params)` function
- Validate/clamp: `num_images` (1–4), `image_urls` (truncate >10), `resolution` (0.5K/1K/2K/4K), `safety_tolerance` (1–6)
- Normalize `output_format` via existing `normalizeOutputFormat()`
- Pass through `aspect_ratio`, `seed`, `enable_web_search`, `limit_generations`
- Use `debugLogger` for warnings on clamped values

### Files to modify

**`apps/web/src/lib/fal-ai/model-handlers/index.ts`**
- Re-export `convertNanoBanana2Parameters`

### Acceptance criteria
- Parameters are validated and clamped to API spec ranges
- Logs warnings for out-of-range values
- Unknown parameters are dropped (no pass-through of arbitrary fields)

---

## Subtask 3: Register model in native CLI pipeline (~8 min)

Add Nano Banana 2 Edit to the Electron-side native pipeline registry so the CLI can use it.

### Files to modify

**`electron/native-pipeline/registry-data/image-to-image.ts`**
- Add `ModelRegistry.register()` call for `nano_banana_2_edit`:
  ```ts
  key: "nano_banana_2_edit",
  name: "Nano Banana 2 Edit",
  provider: "Google (via FAL)",
  endpoint: "fal-ai/nano-banana-2/edit",
  categories: ["image_to_image"],
  aspectRatios: ["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16"],
  resolutions: ["0.5K","1K","2K","4K"],
  defaults: { aspect_ratio:"auto", resolution:"1K", output_format:"png", num_images:1, sync_mode:true },
  costEstimate: 0.08,
  processingTime: 10,
  ```

**`electron/native-pipeline/vimax/adapters/image-adapter.ts`**
- Add `nano_banana_2` to `MODEL_MAP` → `"fal-ai/nano-banana-2"`
- Add `nano_banana_2` to `REFERENCE_MODEL_MAP` → `"fal-ai/nano-banana-2/edit"`

### Files to verify

**`electron/native-pipeline/cli/cli-runner/handler-generate.ts`**
- Confirm the generate handler picks up new registry entries automatically (it should via `ModelRegistry.get()`)

### Acceptance criteria
- `qcut generate --model nano_banana_2_edit --prompt "..." --image-urls "..."` works from CLI
- Model shows in `qcut models list` under image_to_image category

---

## Subtask 4: Register in Python AICP pipeline (~5 min)

Add to the Python model registries for AICP/ViMax pipelines.

### Files to modify

**`packages/video-agent-skill/packages/core/ai_content_pipeline/ai_content_pipeline/registry_data.py`**
- Add `ModelDefinition` registration for `nano_banana_2_edit` with full parameter schema

**`packages/video-agent-skill/packages/providers/fal/image-to-image/fal_image_to_image/models/nano_banana.py`**
- Add Nano Banana 2 model config (endpoint, defaults, parameter validation)
- Or create new file `nano_banana_2.py` if cleaner separation is preferred

**`packages/video-agent-skill/packages/core/ai_content_platform/vimax/adapters/image_adapter.py`**
- Add `"nano_banana_2"` to `MODEL_MAP` and `REFERENCE_MODEL_MAP`

### Acceptance criteria
- `aicp generate --model nano_banana_2_edit` works from Python CLI
- ViMax pipelines can reference the model for image editing steps

---

## Subtask 5: Unit tests (~10 min)

### Files to create

**`apps/web/src/lib/fal-ai/model-handlers/__tests__/nano-banana-2-params.test.ts`**
- Test `convertNanoBanana2Parameters()`:
  - Clamps `num_images` to 1–4 range
  - Truncates `image_urls` >10 entries
  - Validates `resolution` enum values
  - Normalizes `output_format`
  - Passes through valid `aspect_ratio`, `seed`, `enable_web_search`
  - Drops unknown parameters

**`apps/web/src/lib/ai-clients/__tests__/nano-banana-2-edit.test.ts`**
- Test model registration:
  - `"nano-banana-2"` is in `IMAGE_EDIT_MODEL_IDS`
  - `getModelCapabilities("nano-banana-2")` returns correct values
  - `isValidImageEditModelId("nano-banana-2")` returns true

### Existing test files to verify compatibility

**`apps/web/src/lib/__tests__/image-edit-multi-image.test.ts`**
- Ensure existing multi-image tests still pass with new model added

**`electron/__tests__/cli-v3-gaps.test.ts`**
- Verify CLI gap tests don't flag nano_banana_2_edit as missing

### Run command
```bash
bun run test
```

### Acceptance criteria
- All new tests pass
- All existing tests still pass
- No TypeScript errors (`bun check-types`)

---

## Key differences: Nano Banana 2 vs Nano Banana (v1)

| Feature | v1 (`nano-banana`) | v2 (`nano-banana-2`) |
|---------|---------------------|----------------------|
| Endpoint | `fal-ai/nano-banana/edit` | `fal-ai/nano-banana-2/edit` |
| Resolution | Not supported | 0.5K, 1K, 2K, 4K |
| Safety tolerance | Not supported | 1–6 scale |
| Web search | Not supported | Optional enhancement |
| Limit generations | Not supported | Per-round limiting |
| Pricing | ~$0.015/image | ~$0.08/image (1K) |
| Provider | FAL AI | Google (via FAL) |

## Architecture notes

- Reuse existing `ImageEditRequest` interface — it already has `resolution`, `aspectRatio`, `outputFormat`, `safetyTolerance` fields
- No new UI panel needed — the model plugs into the existing adjustment panel model selector
- The `nano-banana-params.ts` pattern is followed for the new param converter
- Both v1 and v2 coexist — no breaking changes to existing nano-banana integration
