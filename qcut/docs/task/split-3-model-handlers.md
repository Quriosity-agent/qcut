# Subtask 3: Split `model-handlers.ts` (1865 → ~200 + ~1665)

**Parent Plan:** [split-top5-large-files-plan.md](./split-top5-large-files-plan.md)
**Estimated Effort:** 20-25 minutes
**Risk Level:** Low — clear interface boundary, no state management

---

## Goal

Extract all `handle*` implementation functions and coercion types into `model-handler-implementations.ts`. Keep `model-handlers.ts` as the thin public surface: types, constants, and router functions.

---

## Files Involved

| File | Action |
|------|--------|
| `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` | Edit — keep public surface |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handler-implementations.ts` | **Create** — all handler implementations |

---

## What Stays in `model-handlers.ts` (~200 lines)

| Section | Lines (current) | Description |
|---------|-----------------|-------------|
| Imports | 1-39 | Service imports + re-import from implementations |
| Public types | 80-255 | `ModelHandlerContext`, `ModelHandlerResult`, `VideoResponse`, `TextToVideoSettings`, `ImageToVideoSettings`, `AvatarSettings`, `UpscaleSettings` |
| Constants | 1728-1731 | `VEO31_FRAME_MODELS` |
| Router: `routeTextToVideoHandler` | 1736-1759 | Switch on modelId → handler |
| Router: `routeImageToVideoHandler` | 1764-1812 | Switch on modelId → handler |
| Router: `routeUpscaleHandler` | 1817-1835 | Switch on modelId → handler |
| Router: `routeAvatarHandler` | 1840-1864 | Switch on modelId → handler |

## What Moves to `model-handler-implementations.ts` (~1665 lines)

### Coercion Types (Lines 40-79)

All model-specific literal types:
- `LTXV2Duration`, `LTXV2Resolution`, `LTXV2FPS`
- `HailuoDuration`
- `ViduQ2Duration`, `ViduQ2Resolution`, `ViduQ2MovementAmplitude`
- `ViduQ3Duration`, `ViduQ3Resolution`, `ViduQ3AspectRatio`
- `SeedanceDuration`, `SeedanceResolution`, `SeedanceAspectRatio`
- `KlingDuration`, `KlingAspectRatio`
- `WAN25Duration`, `WAN25Resolution`, `WAN26Duration`, `WAN26Resolution`
- `ByteDanceResolution`, `ByteDanceFPS`
- `FlashVSR*` types

### Text-to-Video Handlers (Lines 257-495)

| Function | Lines | Model |
|----------|-------|-------|
| `handleVeo31FastT2V` | 263-280 | Veo 3.1 Fast |
| `handleVeo31T2V` | 285-302 | Veo 3.1 |
| `handleHailuo23T2V` | 307-330 | Hailuo 2.3 |
| `handleLTXV2ProT2V` | 335-361 | LTX V2 Pro |
| `handleLTXV2FastT2V` | 366-392 | LTX V2 Fast |
| `handleViduQ3T2V` | 397-457 | Vidu Q3 |
| `handleGenericT2V` | 462-495 | Fallback |

### Image-to-Video Handlers (Lines 497-1153)

| Function | Lines | Model |
|----------|-------|-------|
| `handleVeo31FastI2V` | 504-532 | Veo 3.1 Fast |
| `handleVeo31I2V` | 537-565 | Veo 3.1 |
| `handleVeo31FastF2V` | 570-600 | Veo 3.1 Fast Frames |
| `handleVeo31F2V` | 605-635 | Veo 3.1 Frames |
| `handleViduQ2I2V` | 640-678 | Vidu Q2 |
| `handleLTXV2I2V` | 683-720 | LTX V2 |
| `handleLTXV2FastI2V` | 725-762 | LTX V2 Fast |
| `handleSeedanceProFastI2V` | 767-805 | Seedance Fast |
| `handleSeedanceProI2V` | 810-852 | Seedance |
| `handleKlingV25I2V` | 857-895 | Kling v2.5 |
| `handleKlingV26I2V` | 900-936 | Kling v2.6 |
| `handleWAN25I2V` | 941-983 | WAN 2.5 |
| `handleWAN26I2V` | 988-1031 | WAN v2.6 |
| `handleViduQ3I2V` | 1036-1092 | Vidu Q3 |
| `handleWAN26T2V` | 1097-1125 | WAN v2.6 T2V |
| `handleGenericI2V` | 1130-1153 | Fallback |

### Upscale Handlers (Lines 1155-1259)

| Function | Lines | Model |
|----------|-------|-------|
| `handleByteDanceUpscale` | 1162-1204 | ByteDance |
| `handleFlashVSRUpscale` | 1209-1259 | FlashVSR |

### Avatar & Extend Handlers (Lines 1261-1721)

| Function | Lines | Model |
|----------|-------|-------|
| `handleKlingO1Ref2Video` | 1268-1296 | Kling O1 Ref |
| `handleWAN26Ref2Video` | 1303-1404 | WAN v2.6 Ref |
| `handleKlingO1V2V` | 1409-1437 | Kling O1 V2V |
| `handleKlingAvatarV2` | 1442-1489 | Kling Avatar v2 |
| `handleGenericAvatar` | 1494-1524 | Fallback |
| `handleSyncLipsyncReact1` | 1530-1599 | Sync Lipsync |
| `handleVeo31FastExtendVideo` | 1605-1660 | Veo 3.1 Fast Extend |
| `handleVeo31ExtendVideo` | 1666-1721 | Veo 3.1 Extend |

---

## Implementation Steps

### Step 1: Create `model-handler-implementations.ts`

```typescript
// model-handler-implementations.ts

import type {
  ModelHandlerContext,
  ModelHandlerResult,
  TextToVideoSettings,
  ImageToVideoSettings,
  UpscaleSettings,
  AvatarSettings,
} from './model-handlers';

// Move all coercion types here
type LTXV2Duration = 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
// ... all other coercion types

// All handle* functions exported individually
export function handleVeo31FastT2V(...) { ... }
export function handleVeo31T2V(...) { ... }
// ... all 30+ handlers
```

### Step 2: Update `model-handlers.ts` routers to import from implementations

```typescript
import {
  handleVeo31FastT2V,
  handleVeo31T2V,
  handleHailuo23T2V,
  // ... all handlers
} from './model-handler-implementations';

// Routers stay here, using imported handlers
export function routeTextToVideoHandler(ctx, settings) {
  switch (ctx.modelId) {
    case 'veo31_fast': return handleVeo31FastT2V(ctx, settings);
    // ...
  }
}
```

### Step 3: Remove handler function bodies from `model-handlers.ts`

Delete the implementation code (lines 40-1721) and replace with the import statement.

### Step 4: Verify no reverse imports

`model-handler-implementations.ts` imports types FROM `model-handlers.ts`.
`model-handlers.ts` imports functions FROM `model-handler-implementations.ts`.
One-directional only (types flow down, implementations flow up).

---

## Verification

```bash
# Type check
bun run check-types

# Lint
bun lint:clean

# Smoke test AI video generation for T2V, I2V, avatar tabs
bun run electron:dev
```

---

## Unit Tests to Add

Create `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/__tests__/model-handler-implementations.test.ts`:

| Test Case | What It Validates |
|-----------|-------------------|
| `handleVeo31FastT2V returns result with video_url` | T2V handler shape |
| `handleKlingV26I2V coerces duration to 5 or 10` | Kling coercion |
| `handleByteDanceUpscale coerces resolution to valid enum` | Upscale coercion |
| `handleFlashVSRUpscale includes all required params` | FlashVSR settings |
| `handleWAN26T2V is a T2V handler (not I2V)` | Correct categorization |
| `all handle* functions are exported` | No missing exports |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Circular import | Types exported from `model-handlers.ts`, implementations import types only |
| Missing handler in router | Keep switch cases unchanged; only move function bodies |
| Coercion types used by both files | Coercion types are private to implementations; routers don't need them |
| Service imports (generateVideo, falAIClient) | Move alongside handler functions; they're only used in implementations |
