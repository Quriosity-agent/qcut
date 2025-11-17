# Text-to-Video Unified Controls Implementation

## Issue Summary
**Date**: 2025-11-17
**Component**: AI Video Generation - Text-to-Video Tab
**Type**: Feature Enhancement
**Priority**: High
**Status**: Implemented - Unified controls added (see ai.tsx & text2video-models-config.ts)

## Implementation Breakdown (Subtasks)

Each subtask is designed to be completed in **under 20 minutes**.

### Subtask 1: Create Model Capabilities Configuration (15 min)

**File**: `apps/web/src/components/editor/media-panel/views/text2video-models-config.ts` (NEW FILE)

**Action**: Create new file with model capability matrix

**Code to Add**: See [Phase 2: Model Capability Matrix](#phase-2-model-capability-matrix) section below

**Lines**: Entire file (~300 lines)

**Comment:** Define capabilities directly from current `AI_MODELS` ids and keep defaults centralized here to avoid drift; add unit-friendly intersection helpers for later subtasks.

---

### Subtask 2: Add State Variables (10 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: Around line 172 (after existing image-to-video state)

**Code to Add**:
```typescript
// Text-to-Video Advanced Settings State
const [t2vAspectRatio, setT2vAspectRatio] = useState<string>("16:9");
const [t2vResolution, setT2vResolution] = useState<string>("1080p");
const [t2vDuration, setT2vDuration] = useState<number>(5);
const [t2vNegativePrompt, setT2vNegativePrompt] = useState<string>(
  "low resolution, error, worst quality, low quality, defects"
);
const [t2vPromptExpansion, setT2vPromptExpansion] = useState<boolean>(false);
const [t2vSeed, setT2vSeed] = useState<number>(-1); // -1 = random
const [t2vSafetyChecker, setT2vSafetyChecker] = useState<boolean>(true);
const [t2vSettingsExpanded, setT2vSettingsExpanded] = useState<boolean>(false);
```

**Comment:** Add these near other AI state with sensible defaults; wire resets/cleanup to existing `resetGenerationState` so toggles don’t persist wrongly across tabs.

---

### Subtask 3: Import Model Configuration (5 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: Top of file (around line 1-20, with other imports)

**Code to Add**:
```typescript
import {
  T2V_MODEL_CAPABILITIES,
  getCombinedCapabilities,
  type T2VModelId,
} from "./text2video-models-config";
```

**Comment:** Keep import grouped with other view-local helpers; ensure path stays relative to ai.tsx to avoid alias issues during build.

---

### Subtask 4: Calculate Combined Capabilities (10 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: After state declarations, before return statement (around line 250)

**Code to Add**:
```typescript
// Calculate combined capabilities for selected text-to-video models
const combinedCapabilities = useMemo(() => {
  const textVideoModelIds = selectedModels
    .filter(modelId => modelId in T2V_MODEL_CAPABILITIES)
    .map(id => id as T2VModelId);

  return getCombinedCapabilities(textVideoModelIds);
}, [selectedModels]);

// Helper to count active settings
const getActiveSettingsCount = () => {
  let count = 0;
  if (t2vAspectRatio !== "16:9") count++;
  if (t2vResolution !== "1080p") count++;
  if (t2vDuration !== 5) count++;
  if (t2vNegativePrompt !== "low resolution, error, worst quality, low quality, defects") count++;
  if (t2vPromptExpansion) count++;
  if (t2vSeed !== -1) count++;
  if (!t2vSafetyChecker) count++;
  return count;
};
```

**Comment:** Memo should return sane defaults when no models selected; guard against empty intersection to keep downstream selectors from breaking.

---

### Subtask 5: Add Aspect Ratio Control (15 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: Inside `<TabsContent value="text">`, after prompt section (around line 900)

**Code to Add**: See [2. Aspect Ratio Selector](#2-aspect-ratio-selector) in Design Specification

**Comment:** Drive options from `combinedCapabilities.supportedAspectRatios`; disable control or show a notice if the intersection is empty.

---

### Subtask 6: Add Resolution Control (15 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: After Aspect Ratio control

**Code to Add**: See [3. Resolution Selector](#3-resolution-selector) in Design Specification

**Comment:** Populate choices via `combinedCapabilities.supportedResolutions` and clamp selection when models change to prevent invalid payloads.

---

### Subtask 7: Add Duration Control (15 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: After Resolution control

**Code to Add**: See [4. Duration Selector](#4-duration-selector) in Design Specification

**Comment:** Use intersection of supported durations and auto-reset to a valid default when the set shrinks; surface validation alongside `generation.canGenerate` messaging.

---

### Subtask 8: Add Negative Prompt Control (10 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: After Duration control

**Code to Add**: See [5. Negative Prompt](#5-negative-prompt) in Design Specification

**Comment:** Keep input optional/trimmed; ensure it is included in active-setting count and cleared on reset to avoid stale values.

---

### Subtask 9: Add Prompt Expansion Toggle (10 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: After Negative Prompt control

**Code to Add**: See [6. Enable Prompt Expansion](#6-enable-prompt-expansion) in Design Specification

**Comment:** Show toggle only when supported; default off to avoid unexpected prompt rewrites and feed its state into the API payload.

---

### Subtask 10: Add Seed Control (15 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: After Prompt Expansion toggle

**Code to Add**: See [7. Seed](#7-seed) in Design Specification

**Comment:** Treat `-1` as random and guard input against NaN; keep UI aligned with whichever models actually support seeds.

---

### Subtask 11: Add Safety Checker Toggle (10 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: After Seed control

**Code to Add**: See [8. Enable Safety Checker](#8-enable-safety-checker) in Design Specification

**Comment:** Mirror product default (currently off in client) and only send when capability exists; clarify this won’t bypass upstream content policy checks.

---

### Subtask 12: Wrap Controls in Collapsible Section (15 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: Wrap all controls from Subtasks 5-11

**Code to Modify**:
```typescript
{/* BEFORE: Just prompt section */}
<div className="space-y-2">
  <Label>Prompt for Video Generation</Label>
  <Textarea ... />
</div>

{/* AFTER: Add collapsible section below prompt */}
<div className="space-y-2">
  <Label>Prompt for Video Generation</Label>
  <Textarea ... />
</div>

{/* ✅ NEW SECTION */}
{selectedModels.length > 0 && (
  <Collapsible
    open={t2vSettingsExpanded}
    onOpenChange={setT2vSettingsExpanded}
  >
    <div className="flex items-center justify-between border-t pt-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="flex items-center gap-2 p-0 h-auto">
          <Label className="text-sm font-semibold cursor-pointer">
            Additional Settings
          </Label>
          <ChevronDown className={cn(
            "h-4 w-4 transition-transform",
            t2vSettingsExpanded && "rotate-180"
          )} />
        </Button>
      </CollapsibleTrigger>

      {!t2vSettingsExpanded && (
        <Badge variant="secondary" className="text-xs">
          {getActiveSettingsCount()} active
        </Badge>
      )}
    </div>

    <CollapsibleContent className="space-y-4 mt-4">
      {/* ALL CONTROLS FROM SUBTASKS 5-11 GO HERE */}
    </CollapsibleContent>
  </Collapsible>
)}
```

**Comment:** Persist `t2vSettingsExpanded` in state; show active-setting badge when collapsed so users see hidden customizations.

---

### Subtask 13: Update API Call to Include Settings (15 min)

**File**: `apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Location**: In `handleGenerate` function, when building request payload (around line 700)

**Code to Modify**:
```typescript
// BEFORE (Current)
const requestPayload = {
  prompt: prompt,
  model: modelKey,
  // ... other params
};

// AFTER (Modified)
const requestPayload = {
  prompt: prompt,
  model: modelKey,
  // ... other params

  // ✅ ADD: Text-to-Video advanced settings
  ...(t2vAspectRatio !== "auto" && t2vAspectRatio !== "16:9" && {
    aspect_ratio: t2vAspectRatio
  }),
  ...(t2vResolution !== "1080p" && {
    resolution: t2vResolution
  }),
  ...(t2vDuration !== 5 && {
    duration: t2vDuration
  }),
  ...(t2vNegativePrompt &&
      t2vNegativePrompt !== "low resolution, error, worst quality, low quality, defects" && {
    negative_prompt: t2vNegativePrompt
  }),
  ...(t2vPromptExpansion && {
    prompt_expansion: true
  }),
  ...(t2vSeed !== -1 && {
    seed: t2vSeed
  }),
  ...(t2vSafetyChecker !== undefined && {
    safety_checker: t2vSafetyChecker
  }),
};
```

**Comment:** Gate each field by combined capabilities before attaching; keep naming aligned with API (`aspect_ratio`, `prompt_expansion`) to avoid payload mismatches.

---

### Subtask 14: Add Import for UI Components (5 min)

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: Top of file with other UI component imports (around line 10-30)

**Code to Add** (if not already imported):
```typescript
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Info, RefreshCw, ChevronDown } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
```

**Comment:** Check for existing imports to prevent duplicates; prefer shared tooltip/badge utilities already used elsewhere in the file.

---

### Subtask 15: Test and Validate (15 min)

**No code changes - Testing only**

**Steps**:
1. Start dev server: `bun run dev`
2. Navigate to AI Video Generation → Text tab
3. Select a model (e.g., Sora 2)
4. Verify "Additional Settings" section appears
5. Expand settings, verify all controls render
6. Change settings, click Generate
7. Check browser console for API payload
8. Verify settings are included in request

**Comment:** Add coverage for multi-model selection intersections and for collapsed state restoring after navigation; verify payloads omit unsupported fields.

---

## Total Time Estimate

- **Subtasks 1-14**: ~3 hours 25 minutes of coding
- **Subtask 15**: 15 minutes of testing
- **Total**: ~3 hours 40 minutes

Each subtask can be completed independently and tested incrementally.

## Problem Description

Currently, text-to-video models in the AI Video Generation panel lack **standardized advanced controls** that would allow users to fine-tune their video generation. The image-to-video tab already has model-specific controls (duration, resolution, aspect ratio), but the text-to-video tab is missing these essential features.

### Missing Controls

Based on industry-standard video generation parameters, text-to-video models should support:

1. **Aspect Ratio** - 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, etc.
2. **Resolution** - 480p, 720p, 1080p, 1440p, 2160p (4K)
3. **Duration** - 2s, 3s, 4s, 5s, 6s, 8s, 10s, etc.
4. **Negative Prompt** - Text describing what to avoid
5. **Enable Prompt Expansion** - AI-enhanced prompt
6. **Seed** - Reproducible generation
7. **Enable Safety Checker** - Content moderation

### Current State

**Text-to-Video Tab:**
```
┌─────────────────────────────────┐
│ Prompt for Video Generation     │
│ [Text Area]                      │
│                                  │
│ Select AI Models (multi-select) │
│ ☐ Sora 2 Text-to-Video          │
│ ☐ WAN v2.5 Preview              │
│ ☐ LTX Video 2.0                 │
│ ...                              │
│                                  │
│ [Generate Button]                │
└─────────────────────────────────┘
```
❌ No advanced controls

**Image-to-Video Tab (Vidu Q2 Example):**
```
┌─────────────────────────────────┐
│ Image Upload                     │
│ Prompt (optional)                │
│                                  │
│ Vidu Q2 Turbo Settings          │
│ Duration:     [5 seconds ▼]     │
│ Resolution:   [1080p ▼]         │
│ Aspect Ratio: [16:9 ▼]          │
│                                  │
│ [Generate Button]                │
└─────────────────────────────────┘
```
✅ Has model-specific controls

### Desired State

**Text-to-Video Tab with Unified Controls:**
```
┌─────────────────────────────────┐
│ Prompt for Video Generation     │
│ [Text Area]                      │
│                                  │
│ [Generate Button]                │
│                                  │
│ Additional Settings [Expand ▼]  │
│ ┌─────────────────────────────┐ │
│ │ Aspect Ratio:   [16:9 ▼]   │ │
│ │ Resolution:     [1080p ▼]  │ │
│ │ Duration:       [5s ▼]     │ │
│ │                             │ │
│ │ Negative Prompt:            │ │
│ │ [Text Area]                 │ │
│ │                             │ │
│ │ ☑ Enable Prompt Expansion   │ │
│ │ Seed:  [random ▼] [🔄]     │ │
│ │ ☑ Enable Safety Checker     │ │
│ └─────────────────────────────┘ │
│                                  │
│ Select AI Models                 │
│ ☑ Sora 2 (supports all)         │
│ ☑ WAN v2.5 (supports subset)    │
└─────────────────────────────────┘
```

## Design Specification

### UI Components Required

#### 1. Additional Settings Section

**Component Structure:**
```tsx
<Collapsible defaultOpen={false}>
  <CollapsibleTrigger className="flex items-center justify-between w-full">
    <Label className="text-sm font-semibold">Additional Settings</Label>
    <Button variant="ghost" size="sm">
      {isOpen ? "Less" : "More"}
      <ChevronDown className={cn("ml-2 h-4 w-4 transition-transform", {
        "rotate-180": isOpen
      })} />
    </Button>
  </CollapsibleTrigger>

  <CollapsibleContent className="space-y-4 mt-4">
    {/* Controls go here */}
  </CollapsibleContent>
</Collapsible>
```

#### 2. Aspect Ratio Selector

**Options:**
- 16:9 (Landscape - Default)
- 9:16 (Portrait)
- 1:1 (Square)
- 4:3 (Classic TV)
- 3:4 (Classic Portrait)
- 21:9 (Ultrawide)
- Auto (Model-specific)

**Component:**
```tsx
<div className="space-y-2">
  <div className="flex items-center gap-2">
    <Label htmlFor="aspect-ratio" className="text-xs">
      Aspect Ratio
    </Label>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Info className="h-3 w-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>
          <p>Video width-to-height ratio</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>

  <Select
    value={aspectRatio}
    onValueChange={setAspectRatio}
  >
    <SelectTrigger id="aspect-ratio" className="h-9 text-xs">
      <SelectValue placeholder="Select aspect ratio" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
      <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
      <SelectItem value="1:1">1:1 (Square)</SelectItem>
      <SelectItem value="4:3">4:3 (Classic TV)</SelectItem>
      <SelectItem value="3:4">3:4 (Classic Portrait)</SelectItem>
      <SelectItem value="21:9">21:9 (Ultrawide)</SelectItem>
      <SelectItem value="auto">Auto</SelectItem>
    </SelectContent>
  </Select>
</div>
```

#### 3. Resolution Selector

**Options:**
- 480p (SD)
- 720p (HD) - Default
- 1080p (Full HD)
- 1440p (QHD)
- 2160p (4K)

**Component:**
```tsx
<div className="space-y-2">
  <div className="flex items-center gap-2">
    <Label htmlFor="resolution" className="text-xs">
      Resolution
    </Label>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Info className="h-3 w-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>
          <p>Video quality (higher = better quality, slower)</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>

  <Select
    value={resolution}
    onValueChange={setResolution}
  >
    <SelectTrigger id="resolution" className="h-9 text-xs">
      <SelectValue placeholder="Select resolution" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="480p">480p (SD)</SelectItem>
      <SelectItem value="720p">720p (HD)</SelectItem>
      <SelectItem value="1080p">1080p (Full HD)</SelectItem>
      <SelectItem value="1440p">1440p (QHD)</SelectItem>
      <SelectItem value="2160p">2160p (4K)</SelectItem>
    </SelectContent>
  </Select>
</div>
```

#### 4. Duration Selector

**Options:**
- 2 seconds
- 3 seconds
- 4 seconds
- 5 seconds (Default)
- 6 seconds
- 8 seconds
- 10 seconds
- 12 seconds (if model supports)

**Component:**
```tsx
<div className="space-y-2">
  <div className="flex items-center gap-2">
    <Label htmlFor="duration" className="text-xs">
      Duration
    </Label>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Info className="h-3 w-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>
          <p>Video length in seconds</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>

  <Select
    value={duration.toString()}
    onValueChange={(val) => setDuration(Number(val))}
  >
    <SelectTrigger id="duration" className="h-9 text-xs">
      <SelectValue placeholder="Select duration" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="2">2 seconds</SelectItem>
      <SelectItem value="3">3 seconds</SelectItem>
      <SelectItem value="4">4 seconds</SelectItem>
      <SelectItem value="5">5 seconds</SelectItem>
      <SelectItem value="6">6 seconds</SelectItem>
      <SelectItem value="8">8 seconds</SelectItem>
      <SelectItem value="10">10 seconds</SelectItem>
      <SelectItem value="12">12 seconds</SelectItem>
    </SelectContent>
  </Select>
</div>
```

#### 5. Negative Prompt

**Component:**
```tsx
<div className="space-y-2">
  <div className="flex items-center gap-2">
    <Label htmlFor="negative-prompt" className="text-xs">
      Negative Prompt
    </Label>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Info className="h-3 w-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>
          <p>Describe what you want to avoid in the video</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>

  <Textarea
    id="negative-prompt"
    placeholder="low resolution, error, worst quality, low quality, defects"
    value={negativePrompt}
    onChange={(e) => setNegativePrompt(e.target.value)}
    className="min-h-[60px] text-xs resize-none"
    maxLength={200}
  />
  <p className="text-xs text-muted-foreground text-right">
    {200 - negativePrompt.length} characters remaining
  </p>
</div>
```

#### 6. Enable Prompt Expansion

**Component:**
```tsx
<div className="flex items-center justify-between rounded-lg border p-3">
  <div className="flex items-center gap-2">
    <Label htmlFor="prompt-expansion" className="text-xs cursor-pointer">
      Enable Prompt Expansion
    </Label>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Info className="h-3 w-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>
          <p>AI will enhance your prompt with additional details</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>

  <Switch
    id="prompt-expansion"
    checked={promptExpansion}
    onCheckedChange={setPromptExpansion}
  />
</div>
```

#### 7. Seed

**Component:**
```tsx
<div className="space-y-2">
  <div className="flex items-center gap-2">
    <Label htmlFor="seed" className="text-xs">
      Seed
    </Label>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Info className="h-3 w-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>
          <p>Use the same seed for reproducible results</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>

  <div className="flex gap-2">
    <Input
      id="seed"
      type="text"
      placeholder="random"
      value={seed === -1 ? "random" : seed}
      onChange={(e) => {
        const val = e.target.value;
        if (val === "random" || val === "") {
          setSeed(-1);
        } else {
          const num = parseInt(val);
          if (!isNaN(num)) setSeed(num);
        }
      }}
      className="h-9 text-xs flex-1"
    />
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-9 w-9"
      onClick={() => setSeed(Math.floor(Math.random() * 1000000))}
    >
      <RefreshCw className="h-4 w-4" />
    </Button>
  </div>
</div>
```

#### 8. Enable Safety Checker

**Component:**
```tsx
<div className="flex items-center justify-between rounded-lg border p-3">
  <div>
    <div className="flex items-center gap-2">
      <Label htmlFor="safety-checker" className="text-xs cursor-pointer">
        Enable Safety Checker
      </Label>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Info className="h-3 w-3 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            <p>Filters inappropriate content</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
    <p className="text-xs text-muted-foreground mt-1">
      May reject some prompts to ensure content safety
    </p>
  </div>

  <Switch
    id="safety-checker"
    checked={safetyChecker}
    onCheckedChange={setSafetyChecker}
  />
</div>
```

## Implementation Plan

### Phase 1: State Management

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Add State Variables:**

```tsx
// Text-to-Video Advanced Settings State
const [t2vAspectRatio, setT2vAspectRatio] = useState<string>("16:9");
const [t2vResolution, setT2vResolution] = useState<string>("1080p");
const [t2vDuration, setT2vDuration] = useState<number>(5);
const [t2vNegativePrompt, setT2vNegativePrompt] = useState<string>(
  "low resolution, error, worst quality, low quality, defects"
);
const [t2vPromptExpansion, setT2vPromptExpansion] = useState<boolean>(false);
const [t2vSeed, setT2vSeed] = useState<number>(-1); // -1 = random
const [t2vSafetyChecker, setT2vSafetyChecker] = useState<boolean>(true);
const [t2vSettingsExpanded, setT2vSettingsExpanded] = useState<boolean>(false);
```

### Phase 2: Model Capability Matrix

**Create Constant File**: `apps/web/src/components/editor/media-panel/views/text2video-models-config.ts`

```typescript
/**
 * Text-to-Video Model Configuration
 * Defines which parameters each model supports
 */

export type T2VModelId =
  | "sora2_text_to_video"
  | "sora2_text_to_video_pro"
  | "wan25_preview"
  | "ltxv2_pro_t2v"
  | "ltxv2_fast_t2v"
  | "veo31_fast"
  | "veo31"
  | "hailuo_v2"
  | "seedance_t2v"
  | "kling1_6_pro"
  | "kling1_6_standard";

export interface T2VModelCapabilities {
  supportsAspectRatio: boolean;
  supportedAspectRatios?: string[];
  supportsResolution: boolean;
  supportedResolutions?: string[];
  supportsDuration: boolean;
  supportedDurations?: number[];
  supportsNegativePrompt: boolean;
  supportsPromptExpansion: boolean;
  supportsSeed: boolean;
  supportsSafetyChecker: boolean;
  defaultAspectRatio?: string;
  defaultResolution?: string;
  defaultDuration?: number;
}

export const T2V_MODEL_CAPABILITIES: Record<T2VModelId, T2VModelCapabilities> = {
  sora2_text_to_video: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5, 6],
    supportsNegativePrompt: true,
    supportsPromptExpansion: true,
    supportsSeed: true,
    supportsSafetyChecker: true,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
  },

  sora2_text_to_video_pro: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5, 6, 8, 10],
    supportsNegativePrompt: true,
    supportsPromptExpansion: true,
    supportsSeed: true,
    supportsSafetyChecker: true,
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    defaultDuration: 5,
  },

  wan25_preview: {
    supportsAspectRatio: false,
    supportsResolution: true,
    supportedResolutions: ["480p", "720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [5, 10],
    supportsNegativePrompt: false,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: true,
    defaultResolution: "1080p",
    defaultDuration: 5,
  },

  ltxv2_pro_t2v: {
    supportsAspectRatio: false,
    supportsResolution: true,
    supportedResolutions: ["1080p", "1440p", "2160p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5, 6, 8, 10],
    supportsNegativePrompt: true,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultResolution: "1080p",
    defaultDuration: 6,
  },

  ltxv2_fast_t2v: {
    supportsAspectRatio: false,
    supportsResolution: true,
    supportedResolutions: ["1080p", "1440p", "2160p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5, 6, 8, 10],
    supportsNegativePrompt: false,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultResolution: "1080p",
    defaultDuration: 6,
  },

  veo31_fast: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [4, 5, 6, 8],
    supportsNegativePrompt: true,
    supportsPromptExpansion: true,
    supportsSeed: true,
    supportsSafetyChecker: true,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 8,
  },

  veo31: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [4, 5, 6, 8],
    supportsNegativePrompt: true,
    supportsPromptExpansion: true,
    supportsSeed: true,
    supportsSafetyChecker: true,
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    defaultDuration: 8,
  },

  hailuo_v2: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5],
    supportsNegativePrompt: false,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
  },

  seedance_t2v: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    supportsResolution: true,
    supportedResolutions: ["480p", "720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    supportsNegativePrompt: false,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
  },

  kling1_6_pro: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [5, 10],
    supportsNegativePrompt: true,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    defaultDuration: 5,
  },

  kling1_6_standard: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [5, 10],
    supportsNegativePrompt: false,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
  },
};

/**
 * Get combined capabilities for selected models
 */
export function getCombinedCapabilities(
  selectedModelIds: T2VModelId[]
): T2VModelCapabilities {
  if (selectedModelIds.length === 0) {
    return {
      supportsAspectRatio: false,
      supportsResolution: false,
      supportsDuration: false,
      supportsNegativePrompt: false,
      supportsPromptExpansion: false,
      supportsSeed: false,
      supportsSafetyChecker: false,
    };
  }

  const capabilities = selectedModelIds.map(
    (id) => T2V_MODEL_CAPABILITIES[id]
  );

  // Find common capabilities (intersection)
  return {
    supportsAspectRatio: capabilities.every((c) => c.supportsAspectRatio),
    supportedAspectRatios: getCommonAspectRatios(capabilities),
    supportsResolution: capabilities.every((c) => c.supportsResolution),
    supportedResolutions: getCommonResolutions(capabilities),
    supportsDuration: capabilities.every((c) => c.supportsDuration),
    supportedDurations: getCommonDurations(capabilities),
    supportsNegativePrompt: capabilities.every((c) => c.supportsNegativePrompt),
    supportsPromptExpansion: capabilities.every((c) => c.supportsPromptExpansion),
    supportsSeed: capabilities.every((c) => c.supportsSeed),
    supportsSafetyChecker: capabilities.every((c) => c.supportsSafetyChecker),
  };
}

function getCommonAspectRatios(
  capabilities: T2VModelCapabilities[]
): string[] | undefined {
  const allRatios = capabilities
    .filter((c) => c.supportsAspectRatio && c.supportedAspectRatios)
    .map((c) => c.supportedAspectRatios!);

  if (allRatios.length === 0) return undefined;

  // Find intersection
  return allRatios.reduce((common, ratios) =>
    common.filter((r) => ratios.includes(r))
  );
}

function getCommonResolutions(
  capabilities: T2VModelCapabilities[]
): string[] | undefined {
  const allResolutions = capabilities
    .filter((c) => c.supportsResolution && c.supportedResolutions)
    .map((c) => c.supportedResolutions!);

  if (allResolutions.length === 0) return undefined;

  return allResolutions.reduce((common, resolutions) =>
    common.filter((r) => resolutions.includes(r))
  );
}

function getCommonDurations(
  capabilities: T2VModelCapabilities[]
): number[] | undefined {
  const allDurations = capabilities
    .filter((c) => c.supportsDuration && c.supportedDurations)
    .map((c) => c.supportedDurations!);

  if (allDurations.length === 0) return undefined;

  return allDurations.reduce((common, durations) =>
    common.filter((d) => durations.includes(d))
  );
}
```

### Phase 3: UI Implementation

**In `ai.tsx`, add the Additional Settings section in the text tab:**

```tsx
<TabsContent value="text" className="space-y-4">
  {/* Existing prompt section */}
  <div className="space-y-2">
    <Label htmlFor="text-prompt" className="text-xs">
      Prompt for Video Generation
    </Label>
    <Textarea
      id="text-prompt"
      placeholder="Describe the video you want to generate..."
      value={prompt}
      onChange={(e) => setPrompt(e.target.value)}
      className="min-h-[80px] text-xs resize-none"
      maxLength={maxChars}
    />
    <p className="text-xs text-muted-foreground text-right">
      {maxChars - prompt.length} characters remaining
    </p>
  </div>

  {/* ✅ NEW: Additional Settings Section */}
  {selectedModels.length > 0 && (
    <Collapsible
      open={t2vSettingsExpanded}
      onOpenChange={setT2vSettingsExpanded}
    >
      <div className="flex items-center justify-between border-t pt-3">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="flex items-center gap-2 p-0 h-auto"
          >
            <Label className="text-sm font-semibold cursor-pointer">
              Additional Settings
            </Label>
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                t2vSettingsExpanded && "rotate-180"
              )}
            />
          </Button>
        </CollapsibleTrigger>

        {!t2vSettingsExpanded && (
          <Badge variant="secondary" className="text-xs">
            {getActiveSettingsCount()} active
          </Badge>
        )}
      </div>

      <CollapsibleContent className="space-y-4 mt-4">
        {/* Aspect Ratio */}
        {combinedCapabilities.supportsAspectRatio && (
          <div className="space-y-2">
            {/* Component from Section 2.2 above */}
          </div>
        )}

        {/* Resolution */}
        {combinedCapabilities.supportsResolution && (
          <div className="space-y-2">
            {/* Component from Section 2.3 above */}
          </div>
        )}

        {/* Duration */}
        {combinedCapabilities.supportsDuration && (
          <div className="space-y-2">
            {/* Component from Section 2.4 above */}
          </div>
        )}

        {/* Negative Prompt */}
        {combinedCapabilities.supportsNegativePrompt && (
          <div className="space-y-2">
            {/* Component from Section 2.5 above */}
          </div>
        )}

        {/* Prompt Expansion */}
        {combinedCapabilities.supportsPromptExpansion && (
          <div>
            {/* Component from Section 2.6 above */}
          </div>
        )}

        {/* Seed */}
        {combinedCapabilities.supportsSeed && (
          <div className="space-y-2">
            {/* Component from Section 2.7 above */}
          </div>
        )}

        {/* Safety Checker */}
        {combinedCapabilities.supportsSafetyChecker && (
          <div>
            {/* Component from Section 2.8 above */}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )}

  {/* Model selection - remains unchanged */}
  <div className="space-y-2">
    <Label className="text-xs">Select AI Models (multi-select)</Label>
    {/* ... existing model checkboxes ... */}
  </div>
</TabsContent>
```

### Phase 4: API Integration

**Update `use-ai-generation.ts` to include advanced settings in API calls:**

```typescript
// In handleGenerate function, when building request payload:

const requestPayload = {
  prompt: prompt,
  // Add advanced settings
  ...(t2vAspectRatio !== "auto" && { aspect_ratio: t2vAspectRatio }),
  ...(t2vResolution && { resolution: t2vResolution }),
  ...(t2vDuration && { duration: t2vDuration }),
  ...(t2vNegativePrompt && { negative_prompt: t2vNegativePrompt }),
  ...(t2vPromptExpansion && { prompt_expansion: true }),
  ...(t2vSeed !== -1 && { seed: t2vSeed }),
  ...(t2vSafetyChecker && { safety_checker: true }),
};
```

## Testing Checklist

### Unit Tests

- [ ] Model capability matrix returns correct values
- [ ] Combined capabilities work for multiple models
- [ ] State management updates correctly
- [ ] Default values are set properly

### Integration Tests

- [ ] Controls appear/disappear based on selected models
- [ ] Controls show correct options for each model
- [ ] Settings persist during model selection changes
- [ ] API payloads include correct parameters

### Visual Tests

- [ ] Collapsible section expands/collapses smoothly
- [ ] All controls render correctly
- [ ] Tooltips display helpful information
- [ ] Mobile/responsive layout works

### Functional Tests

- [ ] **Test 1: Single Model Selection**
  - Select Sora 2
  - All supported controls appear
  - Generate with custom settings
  - Verify API call includes parameters

- [ ] **Test 2: Multiple Compatible Models**
  - Select Sora 2 + WAN v2.5
  - Only common controls appear
  - Settings apply to both generations

- [ ] **Test 3: Incompatible Models**
  - Select models with different capabilities
  - Controls adapt to show only common features
  - Warning shown if no common features

- [ ] **Test 4: Settings Persistence**
  - Set custom values
  - Switch tabs
  - Return to text tab
  - Verify settings preserved

## Edge Cases

### 1. No Models Selected

**Behavior:** Hide Additional Settings section
**Reason:** No model to apply settings to

### 2. Conflicting Capabilities

**Example:** Model A supports 16:9, Model B supports only 9:16

**Solution:** Show intersection or disable conflicting controls
```tsx
{combinedCapabilities.supportedAspectRatios?.length === 0 && (
  <Alert>
    <AlertDescription>
      Selected models don't share common aspect ratios
    </AlertDescription>
  </Alert>
)}
```

### 3. Model-Specific Defaults

**Problem:** Different models have different default durations

**Solution:** Use weighted average or first selected model's default
```tsx
const getDefaultDuration = () => {
  if (selectedModels.length === 0) return 5;
  const firstModel = T2V_MODEL_CAPABILITIES[selectedModels[0]];
  return firstModel.defaultDuration || 5;
};
```

### 4. Invalid Combinations

**Example:** 4K resolution at 12 seconds might be too expensive/slow

**Solution:** Add validation and warnings
```tsx
{t2vResolution === "2160p" && t2vDuration > 6 && (
  <Alert variant="warning">
    <AlertDescription>
      4K videos longer than 6s may take significantly longer to generate
    </AlertDescription>
  </Alert>
)}
```

## Future Enhancements

### Phase 2 Features (Future)

1. **Preset Templates**
   - Social Media presets (9:16, 1080p, 5s)
   - Cinematic presets (21:9, 4K, 10s)
   - Quick presets (16:9, 720p, 3s)

2. **Advanced Controls**
   - FPS selection (24, 30, 60 fps)
   - Motion strength (low, medium, high)
   - Camera movement controls
   - Lighting preferences

3. **Cost Estimation**
   - Real-time cost calculation
   - Budget warnings
   - Cost comparison between settings

4. **Settings Presets**
   - Save custom settings as presets
   - Quick load saved configurations
   - Share presets with team

## Related Files

- **Main Component**: `apps/web/src/components/editor/media-panel/views/ai.tsx`
- **Generation Hook**: `apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Types**: `apps/web/src/components/editor/media-panel/views/ai-types.ts`
- **Constants**: `apps/web/src/components/editor/media-panel/views/ai-constants.ts`
- **New Config**: `apps/web/src/components/editor/media-panel/views/text2video-models-config.ts` (to be created)

## Success Metrics

After implementation:

1. **User Control**: 100% of text-to-video models support advanced settings
2. **Consistency**: Same controls available across all models (where supported)
3. **Flexibility**: Users can fine-tune 7 parameters per generation
4. **Quality**: Higher quality outputs with proper settings
5. **Satisfaction**: Increased user satisfaction with generation control

## Conclusion

Adding unified controls to text-to-video models will:

- ✅ **Empower Users**: Fine-tune every aspect of generation
- ✅ **Improve Quality**: Better control = better results
- ✅ **Match Standards**: Align with industry-standard controls
- ✅ **Enhance UX**: Consistent experience across all models
- ✅ **Increase Flexibility**: Support diverse use cases

**Implementation Effort**: Medium (4-6 hours)
**User Impact**: Very High (major feature addition)
**Risk**: Low (additive feature, doesn't break existing functionality)

**Recommendation**: Implement in next feature release cycle.
