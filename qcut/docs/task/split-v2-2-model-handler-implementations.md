# Subtask V2-2: Split `model-handler-implementations.ts` (1518 → 4 category files)

**Parent Plan:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md)
**Phase:** 2
**Estimated Effort:** 20-25 minutes
**Risk Level:** Low — all 33 handlers are independent exported functions with one consumer

---

## Goal

Split the monolithic handler file into 4 category files under a `handlers/` subdirectory. The single consumer (`model-handlers.ts`) updates its imports. No API shape changes.

---

## Files Involved

| File | Action |
|------|--------|
| `.../generation/model-handler-implementations.ts` | **Delete** after migration |
| `.../generation/handlers/text-to-video-handlers.ts` | **Create** — 8 T2V handlers |
| `.../generation/handlers/image-to-video-handlers.ts` | **Create** — 15 I2V handlers |
| `.../generation/handlers/upscale-handlers.ts` | **Create** — 2 upscale handlers |
| `.../generation/handlers/avatar-handlers.ts` | **Create** — 8 avatar/extend handlers |
| `.../generation/model-handlers.ts` | **Edit** — update import paths |

> Base path: `apps/web/src/components/editor/media-panel/views/ai/hooks/generation`

### Single Consumer

| File | Line |
|------|------|
| `.../generation/model-handlers.ts:52` | Imports all 33 handler functions |

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
import type { ModelHandlerContext, ModelHandlerResult, TextToVideoSettings } from "../model-handlers";
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
import type { ModelHandlerContext, ModelHandlerResult, ImageToVideoSettings } from "../model-handlers";
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
import type { ModelHandlerContext, ModelHandlerResult, UpscaleSettings } from "../model-handlers";
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
import type { ModelHandlerContext, ModelHandlerResult, AvatarSettings } from "../model-handlers";
```

---

## Implementation Steps

### Step 1: Create `handlers/` directory

```bash
mkdir -p apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers
```

### Step 2: Create the 4 handler files

For each file:
1. Add imports (types from `../model-handlers`, generators from `@/lib/ai-video`)
2. Add coercion types used only by handlers in that file
3. Copy handler function bodies verbatim
4. Export all handlers as named exports

### Step 3: Update `model-handlers.ts` imports

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

### Step 4: Delete `model-handler-implementations.ts`

### Step 5: Verify all 33 handlers are accounted for

Run: `grep -c "export function handle" handlers/*.ts` — should total 33.

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

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Missing handler in router after split | Count exports per file; must total 33 |
| Coercion type shared between categories | Each file declares its own local coercion types; no sharing needed |
| Import path `../model-handlers` resolves differently from `handlers/` | Use relative imports consistently |
| `debugLogger` only used by avatar handlers | Only import in `avatar-handlers.ts` |
