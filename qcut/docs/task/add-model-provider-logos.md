# Add Provider Logos to AI Model Selection

**Branch:** `refactor-ui`
**Priority:** UI Enhancement
**Estimated Time:** ~45 minutes (4 subtasks)

## Overview

Add provider/brand logos next to model names in the AI generation panel's model selection grid. Similar to the reference screenshot showing logos for Pollo AI, Google, Seedream, Wan AI, Flux AI, OpenAI, Kling AI, etc.

Currently, the model selection grid at `apps/web/src/components/editor/media-panel/views/ai/index.tsx:970-1016` renders models as simple text buttons with name and price. This task adds a provider logo icon next to each model name.

## Current State

- SVG placeholder logos already created in `apps/web/public/model-logos/` (13 files)
- Model configs have no `provider` or `logo` field — identity must be derived from model ID or name
- The model selection grid uses `AI_MODELS` array filtered by `activeTab`

## Provider Logo Mapping

| Provider Key | Logo File | Models Using It |
|---|---|---|
| `openai` | `openai.svg` | GPT Image 1.5 |
| `sora` | `sora.svg` | Sora 2 T2V/I2V (all sora2_* models) |
| `kling` | `kling.svg` | Kling v2.5/v2.6/v3/O1 (all kling_* models) |
| `google` | `google.svg` | Veo 3.1, Imagen4, Gemini 3, Nano Banana (veo31_*, imagen4*, gemini*, nano*) |
| `bytedance` | `bytedance.svg` | Seedance, SeedDream (seedance*, seeddream*) |
| `wan` | `wan.svg` | WAN v2.5/v2.6 (wan_*, wan25*, wan26*) |
| `lightricks` | `lightricks.svg` | LTX Video 2.0 (ltxv2*) |
| `minimax` | `minimax.svg` | Hailuo 2.3 (hailuo*) |
| `flux` | `flux.svg` | FLUX Pro, FLUX 2 Flex (flux*) |
| `vidu` | `vidu.svg` | Vidu Q2/Q3 (vidu*) |
| `qwen` | `qwen.svg` | Qwen Image (qwen*) |
| `tongyi` | `tongyi.svg` | Z-Image Turbo (z-image*) |
| `reve` | `reve.svg` | Reve Text-to-Image (reve*) |

---

## Subtask 1: Create Provider Logo Mapping Utility

**Time:** ~10 minutes
**Files:**
- `apps/web/src/components/editor/media-panel/views/ai/constants/model-provider-logos.ts` (new)

### Description

Create a utility that maps model IDs to their provider logo path. This is the single source of truth for model → provider → logo mapping.

### Implementation

```typescript
/**
 * Model-to-provider logo mapping.
 * Maps model ID prefixes to their provider logo SVG path.
 */

type ProviderInfo = {
  name: string;
  logo: string; // path relative to /model-logos/
};

const PROVIDER_MAP: Record<string, ProviderInfo> = {
  sora: { name: "OpenAI", logo: "/model-logos/sora.svg" },
  kling: { name: "Kling AI", logo: "/model-logos/kling.svg" },
  veo: { name: "Google", logo: "/model-logos/google.svg" },
  wan: { name: "WAN AI", logo: "/model-logos/wan.svg" },
  ltx: { name: "Lightricks", logo: "/model-logos/lightricks.svg" },
  hailuo: { name: "MiniMax", logo: "/model-logos/minimax.svg" },
  seedance: { name: "ByteDance", logo: "/model-logos/bytedance.svg" },
  seeddream: { name: "ByteDance", logo: "/model-logos/bytedance.svg" },
  vidu: { name: "Vidu", logo: "/model-logos/vidu.svg" },
  // Text2Image models
  flux: { name: "Black Forest Labs", logo: "/model-logos/flux.svg" },
  qwen: { name: "Alibaba", logo: "/model-logos/qwen.svg" },
  reve: { name: "Reve", logo: "/model-logos/reve.svg" },
  "z-image": { name: "Tongyi-MAI", logo: "/model-logos/tongyi.svg" },
  imagen: { name: "Google", logo: "/model-logos/google.svg" },
  gemini: { name: "Google", logo: "/model-logos/google.svg" },
  nano: { name: "Google", logo: "/model-logos/google.svg" },
  gpt: { name: "OpenAI", logo: "/model-logos/openai.svg" },
};

export function getProviderForModel(modelId: string): ProviderInfo | undefined {
  // Check exact prefixes, longest match first
  const sortedKeys = Object.keys(PROVIDER_MAP).sort(
    (a, b) => b.length - a.length
  );
  for (const prefix of sortedKeys) {
    if (modelId.startsWith(prefix)) {
      return PROVIDER_MAP[prefix];
    }
  }
  return undefined;
}

export function getProviderLogo(modelId: string): string | undefined {
  return getProviderForModel(modelId)?.logo;
}

export function getProviderName(modelId: string): string | undefined {
  return getProviderForModel(modelId)?.name;
}
```

### Test Cases

- `getProviderLogo("kling_v3_pro_t2v")` → `"/model-logos/kling.svg"`
- `getProviderLogo("sora2_text_to_video")` → `"/model-logos/sora.svg"`
- `getProviderLogo("veo31_fast_text_to_video")` → `"/model-logos/google.svg"`
- `getProviderLogo("unknown_model")` → `undefined`

---

## Subtask 2: Add Logo to Model Selection Grid

**Time:** ~15 minutes
**Files:**
- `apps/web/src/components/editor/media-panel/views/ai/index.tsx` (edit lines 996-1014)

### Description

Modify the model selection grid buttons to display the provider logo as a small `<img>` before the model name.

### Current Code (lines 996-1014)

```tsx
<Button
  key={model.id}
  type="button"
  size="sm"
  variant={isModelSelected(model.id) ? "default" : "outline"}
  onClick={() => toggleModel(model.id)}
  className={`h-auto min-h-[44px] py-2 px-2 text-xs justify-start items-start ${isCompact ? "flex-col" : "flex-row"}`}
>
  <span className="text-left leading-tight flex-1">
    {model.name}
  </span>
  {!isCompact && (
    <span className="ml-2 text-muted-foreground whitespace-nowrap shrink-0">
      ${model.price}
    </span>
  )}
</Button>
```

### New Code

```tsx
import { getProviderLogo } from "./constants/model-provider-logos";

// Inside the .map() callback:
<Button
  key={model.id}
  type="button"
  size="sm"
  variant={isModelSelected(model.id) ? "default" : "outline"}
  onClick={() => toggleModel(model.id)}
  className={`h-auto min-h-[44px] py-2 px-2 text-xs justify-start items-start ${isCompact ? "flex-col" : "flex-row"}`}
>
  <div className="flex items-center gap-1.5 text-left leading-tight flex-1 min-w-0">
    {(() => {
      const logo = getProviderLogo(model.id);
      return logo ? (
        <img
          src={logo}
          alt=""
          className="w-4 h-4 shrink-0 rounded-sm"
        />
      ) : null;
    })()}
    <span className="truncate">{model.name}</span>
  </div>
  {!isCompact && (
    <span className="ml-2 text-muted-foreground whitespace-nowrap shrink-0">
      ${model.price}
    </span>
  )}
</Button>
```

### Key Changes

- Wrap model name in a `div` with `flex items-center gap-1.5`
- Add `<img>` for provider logo (16x16px, `w-4 h-4`)
- Add `truncate` to model name `<span>` to prevent overflow
- Logo gracefully hidden if `getProviderLogo` returns `undefined`

---

## Subtask 3: Add Logo to Image Edit Model Selector

**Time:** ~10 minutes
**Files:**
- `apps/web/src/components/editor/adjustment/model-selector.tsx` (edit lines 46-50)

### Description

Add provider logos to the image edit model selector used in the adjustment panel.

### Current Code (lines 46-50)

```tsx
<div className="flex items-center gap-1.5 min-w-0">
  {isSelected && <Check className="w-3 h-3 flex-shrink-0" />}
  <span className="text-xs font-medium truncate">
    {model.name}
  </span>
```

### New Code

```tsx
import { getProviderLogo } from "../media-panel/views/ai/constants/model-provider-logos";

// Inside the button:
<div className="flex items-center gap-1.5 min-w-0">
  {isSelected && <Check className="w-3 h-3 flex-shrink-0" />}
  {(() => {
    const logo = getProviderLogo(model.id);
    return logo ? (
      <img src={logo} alt="" className="w-3 h-3 shrink-0 rounded-sm" />
    ) : null;
  })()}
  <span className="text-xs font-medium truncate">
    {model.name}
  </span>
```

---

## Subtask 4: Write Unit Tests

**Time:** ~10 minutes
**Files:**
- `apps/web/src/components/editor/media-panel/views/ai/constants/__tests__/model-provider-logos.test.ts` (new)

### Description

Test the provider logo mapping utility to ensure all model IDs resolve correctly.

### Test Plan

```typescript
import { describe, it, expect } from "vitest";
import {
  getProviderLogo,
  getProviderName,
  getProviderForModel,
} from "../model-provider-logos";

describe("model-provider-logos", () => {
  describe("getProviderLogo", () => {
    it.each([
      ["kling_v3_pro_t2v", "/model-logos/kling.svg"],
      ["kling_v3_standard_i2v", "/model-logos/kling.svg"],
      ["sora2_text_to_video", "/model-logos/sora.svg"],
      ["veo31_fast_text_to_video", "/model-logos/google.svg"],
      ["wan_26_t2v", "/model-logos/wan.svg"],
      ["ltxv2_pro_t2v", "/model-logos/lightricks.svg"],
      ["hailuo23_pro_t2v", "/model-logos/minimax.svg"],
      ["seedance_pro", "/model-logos/bytedance.svg"],
      ["vidu_q3_t2v", "/model-logos/vidu.svg"],
    ])("maps %s to %s", (modelId, expectedLogo) => {
      expect(getProviderLogo(modelId)).toBe(expectedLogo);
    });

    it("returns undefined for unknown models", () => {
      expect(getProviderLogo("unknown_model")).toBeUndefined();
    });
  });

  describe("getProviderName", () => {
    it("returns provider name for known models", () => {
      expect(getProviderName("kling_v3_pro_t2v")).toBe("Kling AI");
      expect(getProviderName("sora2_text_to_video")).toBe("OpenAI");
      expect(getProviderName("veo31_text_to_video")).toBe("Google");
    });
  });
});
```

---

## File Summary

| File | Action | Purpose |
|---|---|---|
| `apps/web/public/model-logos/*.svg` | Already created | 13 SVG logo files |
| `apps/web/src/.../constants/model-provider-logos.ts` | **Create** | Provider logo mapping utility |
| `apps/web/src/.../constants/__tests__/model-provider-logos.test.ts` | **Create** | Unit tests |
| `apps/web/src/.../ai/index.tsx` | **Edit** | Add logos to model grid |
| `apps/web/src/.../adjustment/model-selector.tsx` | **Edit** | Add logos to image edit selector |

## Notes

- SVG logos are placeholders (letter-based). Replace with official brand assets when available.
- The `getProviderLogo()` approach is extensible — new providers just need a new entry in `PROVIDER_MAP`.
- Logos render as 16x16 (`w-4 h-4`) in the main grid and 12x12 (`w-3 h-3`) in the compact model selector.
- No changes to model config types needed — logo resolution is by ID prefix, not a new field.
