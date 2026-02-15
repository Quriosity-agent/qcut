# Phase 4: Split `image-to-video.ts` (1259 → ~300)

**Risk Level:** Low — 12 independent generator functions grouped by model family, no shared mutable state
**Estimated Time:** ~20 minutes

## Overview

This file contains 12 generator functions that follow identical patterns: validate inputs, build payload, call FAL API, return result. Each function is self-contained with no shared state. The split groups generators by model family into 4 files, keeping only the main dispatch function in the original.

## Source File

`apps/web/src/lib/ai-video/generators/image-to-video.ts` — 1259 lines

### Current Structure

| Section | Lines | Count | Description |
|---------|------:|------:|-------------|
| Imports | 1-62 | — | Types, FAL utils, validators |
| `generateVideoFromImage()` | 71-192 | 1 | Generic dispatch function |
| Vidu Q2 | 197-294 | 1 | `generateViduQ2Video` |
| LTX V2.0 | 299-398 | 1 | `generateLTXV2ImageVideo` |
| Seedance | 403-500 | 1 | `generateSeedanceVideo` |
| Kling v2.5 | 505-585 | 1 | `generateKlingImageVideo` |
| Kling v2.6 | 590-660 | 1 | `generateKling26ImageVideo` |
| Kling O1 V2V | 665-756 | 1 | `generateKlingO1Video` |
| Kling O1 Ref | 761-833 | 1 | `generateKlingO1RefVideo` |
| WAN v2.5 | 838-930 | 1 | `generateWAN25ImageVideo` |
| WAN v2.6 I2V | 941-1046 | 1 | `generateWAN26ImageVideo` |
| WAN v2.6 Ref | 1058-1164 | 1 | `generateWAN26RefVideo` |
| Vidu Q3 | 1175-1259 | 1 | `generateViduQ3ImageVideo` |

---

## New Files

### 1. `apps/web/src/lib/ai-video/generators/kling-generators.ts` (~320 lines)

**Contents:** All 4 Kling model generators.

| Function | Current Lines | ~Size |
|----------|--------------|------:|
| `generateKlingImageVideo` | 505-585 | 81 |
| `generateKling26ImageVideo` | 590-660 | 71 |
| `generateKlingO1Video` | 665-756 | 92 |
| `generateKlingO1RefVideo` | 761-833 | 73 |

**Dependencies:**
- `handleAIServiceError` from `@/lib/error-handler`
- `KlingI2VRequest`, `Kling26I2VRequest`, `KlingO1V2VRequest`, `KlingO1Ref2VideoRequest` from AI types
- `getFalApiKeyAsync`, `generateJobId`, `makeFalRequest` from `../core/fal-request`
- `getModelConfig`, `fileToDataURL`, `withErrorHandling` from `./base-generator`
- `validateKlingPrompt`, `validateKlingCfgScale` from `../validation/validators`
- `ERROR_MESSAGES` from AI constants

### 2. `apps/web/src/lib/ai-video/generators/wan-generators.ts` (~310 lines)

**Contents:** All 3 WAN model generators.

| Function | Current Lines | ~Size |
|----------|--------------|------:|
| `generateWAN25ImageVideo` | 838-930 | 93 |
| `generateWAN26ImageVideo` | 941-1046 | 106 |
| `generateWAN26RefVideo` | 1058-1164 | 107 |

**Dependencies:**
- Same FAL utils and base generator imports
- `WAN25I2VRequest`, `WAN26I2VRequest`, `WAN26Ref2VideoRequest` from AI types
- `validateWAN25Prompt`, `validateWAN25NegativePrompt`, `validateWAN26Prompt`, `validateWAN26NegativePrompt`, `validateWAN26DurationResolutionAspectRatio` from validators

### 3. `apps/web/src/lib/ai-video/generators/vidu-generators.ts` (~190 lines)

**Contents:** Both Vidu model generators.

| Function | Current Lines | ~Size |
|----------|--------------|------:|
| `generateViduQ2Video` | 197-294 | 98 |
| `generateViduQ3ImageVideo` | 1175-1259 | 85 |

**Dependencies:**
- Same FAL utils and base generator imports
- `ViduQ2I2VRequest`, `ViduQ3I2VRequest` from AI types
- `validateViduQ2Prompt`, `validateViduQ3Prompt`, `validateViduQ3Resolution` from validators

### 4. `apps/web/src/lib/ai-video/generators/misc-generators.ts` (~200 lines)

**Contents:** LTX and Seedance generators.

| Function | Current Lines | ~Size |
|----------|--------------|------:|
| `generateLTXV2ImageVideo` | 299-398 | 100 |
| `generateSeedanceVideo` | 403-500 | 98 |

**Dependencies:**
- Same FAL utils and base generator imports
- `LTXV2I2VRequest`, `SeedanceI2VRequest` from AI types
- `validateLTXV2Constraints`, `validateLTXV2FastConstraints`, `validateSeedancePrompt`, `validateSeedanceParameters` from validators

---

## What Stays in `image-to-video.ts` (~300 lines)

| Section | Lines | Description |
|---------|------:|-------------|
| Imports | ~40 | Reduced — FAL utils, Sora2 helpers, types |
| `generateVideoFromImage()` | ~122 | Generic dispatch function (lines 71-192) |
| Re-exports | ~20 | Barrel re-exports from 4 new modules |

```typescript
// Re-exports
export { generateKlingImageVideo, generateKling26ImageVideo, generateKlingO1Video, generateKlingO1RefVideo } from './kling-generators'
export { generateWAN25ImageVideo, generateWAN26ImageVideo, generateWAN26RefVideo } from './wan-generators'
export { generateViduQ2Video, generateViduQ3ImageVideo } from './vidu-generators'
export { generateLTXV2ImageVideo, generateSeedanceVideo } from './misc-generators'
```

The `generateVideoFromImage()` dispatch function imports generators from the new modules. Its switch/if logic routes to the appropriate generator based on model name.

---

## Implementation Steps

### Step 1: Create `kling-generators.ts`

1. Create `apps/web/src/lib/ai-video/generators/kling-generators.ts`
2. Copy imports: `handleAIServiceError`, Kling request types, FAL utils, base generator utils, Kling validators
3. Move all 4 Kling functions (lines 505-833)
4. Export all 4 functions

### Step 2: Create `wan-generators.ts`

1. Create `apps/web/src/lib/ai-video/generators/wan-generators.ts`
2. Copy imports: WAN request types, FAL utils, base generator utils, WAN validators
3. Move all 3 WAN functions (lines 838-1164)
4. Export all 3 functions

### Step 3: Create `vidu-generators.ts`

1. Create `apps/web/src/lib/ai-video/generators/vidu-generators.ts`
2. Copy imports: Vidu request types, FAL utils, base generator utils, Vidu validators
3. Move both Vidu functions (lines 197-294, 1175-1259)
4. Export both functions

### Step 4: Create `misc-generators.ts`

1. Create `apps/web/src/lib/ai-video/generators/misc-generators.ts`
2. Copy imports: LTX/Seedance request types, FAL utils, base generator utils, LTX/Seedance validators
3. Move LTX and Seedance functions (lines 299-500)
4. Export both functions

### Step 5: Update `image-to-video.ts`

1. Remove all moved generator functions
2. Add re-exports from 4 new modules
3. Update `generateVideoFromImage()` imports if it references generators directly
4. Remove unused imports (validators, request types that moved out)

### Step 6: Verify external imports

1. Check all files that import individual generators:
   ```bash
   grep -r "generateKling\|generateWAN\|generateVidu\|generateLTX\|generateSeedance" --include="*.ts" --include="*.tsx"
   ```
2. All should import from `image-to-video.ts` — re-exports make this transparent

---

## Risks

| Risk | Mitigation |
|------|------------|
| All generators share FAL utilities | Each module imports `getFalApiKeyAsync`, `makeFalRequest`, etc. directly |
| All generators share validators | Each module imports specific validators from `../validation/validators` |
| `generateVideoFromImage` dispatches to generators | Import from new modules; same function signatures |
| External imports break | Re-export all generators from `image-to-video.ts` barrel |
| Kling O1 uses `window.electronAPI` | Keep in `kling-generators.ts` — same browser environment |

## Verification

```bash
bun check-types
bun lint:clean
bun run test
bun run electron:dev  # Test image-to-video generation with at least one model
```

## Test Scenarios

- [ ] Generate video from image with Kling model
- [ ] Generate video from image with WAN model
- [ ] Generate video from image with Vidu model
- [ ] Generate video from image with LTX model
- [ ] Generate video from image with Seedance model
- [ ] Generic `generateVideoFromImage()` dispatch routes correctly
- [ ] Error handling works for invalid prompts
- [ ] Missing API key shows appropriate error
