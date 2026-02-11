# Subtask V2-2: Split `model-handler-implementations.ts` (1518 → 4 category files)

**Parent Plan:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md)
**Phase:** 2
**Estimated Effort:** 20-25 minutes
**Risk Level:** Medium — handlers are independent, but router mappings/fallback behavior are runtime-sensitive

---

## Status (2026-02-11)

Completed and verified.

Validation summary:
- `model-handler-types.ts` exists and `model-handlers.ts` re-exports the moved types.
- Handler implementations are split under `handlers/` by category (8 T2V, 15 I2V, 2 upscale, 8 avatar/extend).
- `model-handler-implementations.ts` is a compatibility re-export shim.
- Router regression and handler export tests exist:
  - `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers/__tests__/handler-exports.test.ts`
  - `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/__tests__/model-handlers-routing.test.ts`

Executed verification:
- `rg -n "^export async function handle" apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers -g "*.ts"` -> 33 matches.
- `bun x vitest run --config apps/web/vitest.config.ts apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers/__tests__/handler-exports.test.ts apps/web/src/components/editor/media-panel/views/ai/hooks/generation/__tests__/model-handlers-routing.test.ts` -> 2 test files passed, 9 tests passed.

---

## Goal

Split the monolithic handler file into 4 category files under a `handlers/` subdirectory. The single consumer (`model-handlers.ts`) updates its imports. No API shape or routing behavior changes.

---

## Files Involved

| File | Action |
|------|--------|
| `.../generation/model-handler-implementations.ts` | **Keep as temporary compatibility re-export**, then delete in cleanup PR |
| `.../generation/model-handler-types.ts` | **Create** — shared handler context/settings/result types |
| `.../generation/handlers/text-to-video-handlers.ts` | **Create** — 8 T2V handlers |
| `.../generation/handlers/image-to-video-handlers.ts` | **Create** — 15 I2V handlers |
| `.../generation/handlers/upscale-handlers.ts` | **Create** — 2 upscale handlers |
| `.../generation/handlers/avatar-handlers.ts` | **Create** — 8 avatar/extend handlers |
| `.../generation/model-handlers.ts` | **Edit** — update import paths |

> Base path: `apps/web/src/components/editor/media-panel/views/ai/hooks/generation`

### Primary Consumer

| File | Line |
|------|------|
| `.../generation/model-handlers.ts:52` | Imports all 33 handler functions |

Note: `.../generation/index.ts` re-exports router functions and public types from `model-handlers.ts`, so `model-handlers.ts` public exports must remain stable.

---

## What Goes Where

### `handlers/text-to-video-handlers.ts` (~270 lines)

| Function | Original Lines | Model |
|----------|---------------|-------|
| `handleVeo31FastT2V` | 87-104 | Veo 3.1 Fast |
| `handleVeo31T2V` | 109-126 | Veo 3.1 Standard |
| `handleHailuo23T2V` | 131-154 | Hailuo 2.3 |
| `handleLTXV2ProT2V` | 159-185 | LTX V2 Pro |
| `handleLTXV2FastT2V` | 190-216 | LTX V2 Fast |
| `handleViduQ3T2V` | 221-281 | Vidu Q3 |
| `handleWAN26T2V` | 286-314 | WAN v2.6 |
| `handleGenericT2V` | 319-352 | Generic fallback |

Coercion types needed: `LTXV2Duration`, `LTXV2Resolution`, `LTXV2FPS`, `HailuoDuration`, `ViduQ3Duration`, `ViduQ3Resolution`, `ViduQ3AspectRatio`, `WAN26T2VResolution`, `WAN26Duration`

Imports needed:
```typescript
import { generateVideoFromText, generateLTXV2Video, generateViduQ3TextVideo, generateWAN26TextVideo, generateVideo } from "@/lib/ai-video";
import { falAIClient } from "@/lib/fal-ai-client";
import type { ModelHandlerContext, ModelHandlerResult, TextToVideoSettings } from "../model-handler-types";
```

### `handlers/image-to-video-handlers.ts` (~620 lines)

| Function | Original Lines | Model |
|----------|---------------|-------|
| `handleVeo31FastI2V` | 361-389 | Veo 3.1 Fast I2V |
| `handleVeo31I2V` | 394-422 | Veo 3.1 Standard I2V |
| `handleVeo31FastF2V` | 427-457 | Veo 3.1 Fast F2V |
| `handleVeo31F2V` | 462-492 | Veo 3.1 Standard F2V |
| `handleViduQ2I2V` | 497-535 | Vidu Q2 |
| `handleLTXV2I2V` | 540-577 | LTX V2 Standard |
| `handleLTXV2FastI2V` | 582-619 | LTX V2 Fast |
| `handleSeedanceProFastI2V` | 624-662 | Seedance Fast |
| `handleSeedanceProI2V` | 667-709 | Seedance Pro |
| `handleKlingV25I2V` | 714-752 | Kling v2.5 |
| `handleKlingV26I2V` | 757-793 | Kling v2.6 |
| `handleWAN25I2V` | 798-840 | WAN 2.5 |
| `handleWAN26I2V` | 845-888 | WAN v2.6 |
| `handleViduQ3I2V` | 893-949 | Vidu Q3 |
| `handleGenericI2V` | 954-977 | Generic fallback |

Coercion types needed: `ViduQ2Duration`, `ViduQ2Resolution`, `ViduQ2MovementAmplitude`, `LTXV2Duration`, `LTXV2Resolution`, `LTXV2FPS`, `SeedanceDuration`, `SeedanceResolution`, `SeedanceAspectRatio`, `KlingDuration`, `KlingAspectRatio`, `WAN25Duration`, `WAN25Resolution`, `WAN26Duration`, `WAN26Resolution`, `WAN26AspectRatio`, `ViduQ3Duration`, `ViduQ3Resolution`, `ViduQ3AspectRatio`

Imports needed:
```typescript
import { generateVideoFromImage, generateViduQ2Video, generateLTXV2ImageVideo, generateSeedanceVideo, generateKlingImageVideo, generateKling26ImageVideo, generateWAN25ImageVideo, generateWAN26ImageVideo, generateViduQ3ImageVideo, generateVideo } from "@/lib/ai-video";
import { falAIClient } from "@/lib/fal-ai-client";
import type { ModelHandlerContext, ModelHandlerResult, ImageToVideoSettings } from "../model-handler-types";
```

### `handlers/upscale-handlers.ts` (~120 lines)

| Function | Original Lines | Model |
|----------|---------------|-------|
| `handleByteDanceUpscale` | 986-1036 | ByteDance |
| `handleFlashVSRUpscale` | 1041-1099 | FlashVSR |

Coercion types needed: `ByteDanceResolution`, `ByteDanceFPS`, `FlashVSRAcceleration`, `FlashVSROutputFormat`, `FlashVSROutputQuality`, `FlashVSRWriteMode`

Imports needed:
```typescript
import { upscaleByteDanceVideo, upscaleFlashVSRVideo } from "@/lib/ai-video";
import type { ModelHandlerContext, ModelHandlerResult, UpscaleSettings } from "../model-handler-types";
```

### `handlers/avatar-handlers.ts` (~415 lines)

| Function | Original Lines | Model |
|----------|---------------|-------|
| `handleKlingO1Ref2Video` | 1108-1136 | Kling O1 Ref |
| `handleWAN26Ref2Video` | 1143-1199 | WAN v2.6 Ref |
| `handleKlingO1V2V` | 1204-1232 | Kling O1 V2V |
| `handleKlingAvatarV2` | 1237-1286 | Kling Avatar v2 |
| `handleGenericAvatar` | 1291-1321 | Generic fallback |
| `handleSyncLipsyncReact1` | 1327-1396 | Sync Lipsync |
| `handleVeo31FastExtendVideo` | 1402-1457 | Veo 3.1 Fast Extend |
| `handleVeo31ExtendVideo` | 1463-1518 | Veo 3.1 Extend |

Imports needed:
```typescript
import { generateAvatarVideo, generateKlingO1Video, generateWAN26RefVideo, generateVideo } from "@/lib/ai-video";
import { falAIClient } from "@/lib/fal-ai-client";
import { debugLogger } from "@/lib/debug-logger";
import type { ModelHandlerContext, ModelHandlerResult, AvatarSettings } from "../model-handler-types";
```

---

## Implementation Steps

### Step 1: Create `handlers/` directory

```bash
# macOS/Linux
mkdir -p apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force -Path "apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers"
```

### Step 2: Create `model-handler-types.ts`

Move shared types from `model-handlers.ts` into:

```
apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handler-types.ts
```

Types:
- `ModelHandlerContext`
- `TextToVideoSettings`
- `ImageToVideoSettings`
- `AvatarSettings`
- `UpscaleSettings`
- `ModelHandlerResult`

Then re-export these from `model-handlers.ts` to keep public API unchanged.

### Step 3: Create the 4 handler files

For each file:
1. Add imports (types from `../model-handler-types`, generators from `@/lib/ai-video`)
2. Add coercion types used only by handlers in that file
3. Copy handler function bodies verbatim
4. Export all handlers as named exports

### Step 4: Update `model-handlers.ts` imports

Replace single import from `./model-handler-implementations` with 4 imports:

```typescript
// Before
import { handleVeo31FastT2V, handleVeo31T2V, ... } from "./model-handler-implementations";

// After
import { handleVeo31FastT2V, handleVeo31T2V, ... } from "./handlers/text-to-video-handlers";
import { handleVeo31FastI2V, handleVeo31I2V, ... } from "./handlers/image-to-video-handlers";
import { handleByteDanceUpscale, handleFlashVSRUpscale } from "./handlers/upscale-handlers";
import { handleKlingO1Ref2Video, handleWAN26Ref2Video, ... } from "./handlers/avatar-handlers";
```

Also update header comment in `model-handlers.ts` to reference `handlers/*-handlers.ts` and `model-handler-types.ts`.

### Step 5: Keep temporary compatibility file

Temporarily keep `model-handler-implementations.ts` as a deprecated re-export shim:

```typescript
export * from "./handlers/text-to-video-handlers";
export * from "./handlers/image-to-video-handlers";
export * from "./handlers/upscale-handlers";
export * from "./handlers/avatar-handlers";
```

Delete this shim in a follow-up cleanup PR after verifying no hidden imports.

### Step 6: Verify all 33 handlers are accounted for

Run:

```bash
rg -n "^export async function handle" apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers -g "*.ts"
```

Expect 33 matches.

---

## Verification

```bash
# Type check
bun run check-types

# Lint
bun lint:clean

# Smoke test AI generation: try T2V, I2V, and avatar tabs
bun run electron:dev
```

---

## Unit Tests

Create `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers/__tests__/handler-exports.test.ts`:

| Test Case | What It Validates |
|-----------|-------------------|
| `text-to-video-handlers exports exactly 8 functions` | No missing T2V exports |
| `image-to-video-handlers exports exactly 15 functions` | No missing I2V exports |
| `upscale-handlers exports exactly 2 functions` | No missing upscale exports |
| `avatar-handlers exports exactly 8 functions` | No missing avatar exports |
| `All 33 handlers are functions` | Type safety |
| `handleWAN26T2V is in text-to-video, not image-to-video` | Correct categorization |

Add router behavior regression tests:

| Test Case | What It Validates |
|-----------|-------------------|
| `routeTextToVideoHandler maps wan_26_t2v to WAN handler` | Existing model routing preserved |
| `routeImageToVideoHandler returns skip for frame model when frames missing` | Existing guard behavior preserved |
| `routeAvatarHandler unknown model falls back to generic` | Existing fallback preserved |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Missing handler in router after split | Count exports per file; must total 33 |
| Router mapping regression during import rewrite | Add route-level regression tests for representative model IDs + fallback paths |
| Type-only import cycle grows into runtime cycle later | Extract shared types to `model-handler-types.ts` |
| Import path `../model-handlers` resolves differently from `handlers/` | Use relative imports consistently |
| `debugLogger` only used by avatar handlers | Only import in `avatar-handlers.ts` |
