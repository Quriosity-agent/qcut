# ai.tsx Refactoring Plan (4072 lines)

**Path**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Priority**: Long-term maintainability > scalability > performance > short-term gains

---

## Refactoring Progress

### ✅ Phase 1 Complete: Extract Shared Utilities (Foundation Layer)

| File | Purpose | Lines | Status |
|------|---------|-------|--------|
| `ai-cost-calculators.ts` | Pricing functions for all AI models | ~180 | **✅ Complete** |
| `ai-model-options.ts` | Type definitions and option arrays | ~100 | **✅ Complete** |

**Changes made:**
- Extracted 5 cost calculator functions from ai.tsx
- Added 3 new cost calculators: `calculateKling26Cost`, `calculateViduQ2Cost`, `calculateLTXV2Cost`, `calculateWan25Cost`
- Extracted 12 type aliases and 10 option arrays/label mappings
- Updated ai.tsx imports to use new modules
- **Line reduction: ~175 lines removed from ai.tsx (4246 → 4072)**

---

### ✅ Priority 1 Foundation Complete: Base Hooks & Reusable Components

| File | Purpose | Lines | Status |
|------|---------|-------|--------|
| `use-ai-tab-state-base.ts` | Base state hooks (useFileWithPreview, useMultipleFilesWithPreview, useAudioFileWithDuration, useVideoWithMetadata) | ~342 | **✅ Complete** |
| `ai-settings-panel.tsx` | Reusable collapsible settings panel (AISettingsPanel, AISettingsPanelSimple, ModelSettingsCard) | ~304 | **✅ Complete** |
| `ai-select-fields.tsx` | Reusable select components (DurationSelect, ResolutionSelect, AspectRatioSelect, FPSSelect, GenericSelect, UpscaleFactorSelect, MovementAmplitudeSelect) | ~530 | **✅ Complete** |

**Hooks provided in `use-ai-tab-state-base.ts`:**
- `useFileWithPreview()` - Single file with URL preview and cleanup
- `useMultipleFilesWithPreview(count)` - Array of files with previews (for reference images)
- `useAudioFileWithDuration()` - Audio file with automatic duration extraction
- `useVideoWithMetadata()` - Video file/URL with metadata extraction

**Components provided in `ai-settings-panel.tsx`:**
- `AISettingsPanel` - Collapsible settings container with active count badge
- `AISettingsPanelSimple` - Simpler version without render props
- `ModelSettingsCard` - Card for model-specific settings with cost display

**Select components in `ai-select-fields.tsx`:**
- `DurationSelect` - Duration selector (reused by 8+ models)
- `ResolutionSelect` - Resolution selector with labels and price suffix
- `AspectRatioSelect` - Aspect ratio selector
- `FPSSelect` - Frame rate selector
- `GenericSelect` - Generic select for custom options
- `UpscaleFactorSelect` - Upscale factor selector (2x, 4x, etc.)
- `MovementAmplitudeSelect` - Vidu Q2 movement amplitude selector

---

## Phase 2: Extract State Management Hooks (✅ COMPLETE)

### ✅ Subtask 2.1: Create Base State Hook Pattern - COMPLETE
**File**: `use-ai-tab-state-base.ts` (~342 lines)
**Status**: ✅ Complete

Implemented hooks:
- `useFileWithPreview()` - Handles file + preview URL with proper cleanup
- `useMultipleFilesWithPreview(count)` - For arrays like 6 reference images
- `useAudioFileWithDuration()` - Audio with automatic duration extraction
- `useVideoWithMetadata()` - Video with metadata extraction from file/URL

**Reuse opportunity**: These hooks replace 10+ duplicated file/preview state patterns in ai.tsx.

---

### ✅ Subtask 2.2: Extract Image Tab State Hook - COMPLETE
**File**: `use-ai-image-tab-state.ts` (~450 lines)
**Status**: ✅ Complete

Implemented state groups:
- `ViduQ2Settings` - Duration, resolution, movement amplitude, BGM
- `LTXV2I2VSettings` - Duration, resolution, FPS, generate audio
- `LTXV2ImageSettings` - LTX Fast I2V settings
- `SeedanceSettings` - Duration, resolution, aspect ratio, camera fixed, end frame
- `KlingSettings` - Kling v2.5 duration, cfg scale, aspect ratio, prompts
- `Kling26Settings` - Kling v2.6 duration, cfg scale, aspect ratio, audio, prompts
- `Wan25Settings` - Duration, resolution, audio URL/file, prompts

**Features:**
- Uses `useFileWithPreview` for first/last frame uploads
- Auto-reset effects when models are deselected
- Cleaned/trimmed helper values for API calls

---

### ✅ Subtask 2.3: Extract Text Tab State Hook - COMPLETE
**File**: `use-ai-text-tab-state.ts` (~260 lines)
**Status**: ✅ Complete

Implemented state:
- Unified T2V settings (aspect ratio, resolution, duration, negative prompt, etc.)
- Hailuo T2V duration
- LTX Video Pro settings (duration, resolution, FPS, audio)
- LTX Video Fast settings

**Features:**
- `T2V_DEFAULTS` constant for easy reset
- `activeSettingsCount` helper for badge display
- Auto-reset effects when models are deselected

---

### ✅ Subtask 2.4: Extract Avatar Tab State Hook - COMPLETE
**File**: `use-ai-avatar-tab-state.ts` (~180 lines)
**Status**: ✅ Complete

Implemented state:
- Avatar image with preview
- Last frame (end pose) with preview
- Reference images (6 slots) with previews
- Audio file with automatic duration extraction
- Source video with preview
- Kling Avatar v2 prompt

**Features:**
- Uses `useFileWithPreview` for single uploads
- Uses `useMultipleFilesWithPreview` for 6 reference images
- Uses `useAudioFileWithDuration` for audio with duration
- Reset helpers for each section

| State Variable | Reuse Pattern |
|---------------|---------------|
| `avatarImage`, `avatarImagePreview` | `useFileWithPreview()` |
| `avatarLastFrame`, `avatarLastFramePreview` | `useFileWithPreview()` |
| `referenceImages[6]`, `referenceImagePreviews[6]` | Array of `useFileWithPreview()` |
| `audioFile`, `audioPreview` | `useFileWithPreview()` |
| `sourceVideo`, `sourceVideoPreview` | `useFileWithPreview()` |
| `klingAvatarV2Prompt` | Simple state |
| `audioDuration` | Derived from audioFile |

---

### ✅ Subtask 2.5: Extract Upscale Tab State Hook - COMPLETE
**File**: `use-ai-upscale-tab-state.ts` (~380 lines)
**Status**: ✅ Complete

Implemented state groups:
- `ByteDanceSettings` - Target resolution, target FPS
- `FlashVSRSettings` - Upscale factor, acceleration, quality, color fix, audio, format, write mode, seed
- `TopazSettings` - Upscale factor, target FPS, H.264 output

**Features:**
- Video source handling (file + URL with auto metadata extraction)
- Automatic cost calculation (ByteDance, FlashVSR, Topaz)
- `UPSCALE_DEFAULTS` constant for easy reset
- `handleUpscaleVideoChange` and `handleUpscaleVideoUrlBlur` handlers

---

## Phase 3: Extract UI Components (✅ COMPLETE)

### ✅ Subtask 3.1: Create Reusable Settings Panel Component - COMPLETE
**File**: `ai-settings-panel.tsx` (~304 lines)
**Status**: ✅ Complete

Implemented components:
- `AISettingsPanel` - Collapsible settings container with active count badge (render props version)
- `AISettingsPanelSimple` - Simpler version without render props
- `ModelSettingsCard` - Card for model-specific settings with cost display

---

### ✅ Subtask 3.2: Create Reusable Select Component Wrappers - COMPLETE
**File**: `ai-select-fields.tsx` (~530 lines)
**Status**: ✅ Complete

Implemented components:
- `DurationSelect` - Duration selector (reused by 8+ models)
- `ResolutionSelect` - Resolution selector with labels and price suffix
- `AspectRatioSelect` - Aspect ratio selector
- `FPSSelect` - Frame rate selector
- `GenericSelect` - Generic select for custom options
- `UpscaleFactorSelect` - Upscale factor selector (2x, 4x, etc.)
- `MovementAmplitudeSelect` - Vidu Q2 movement amplitude selector

---

### ✅ Subtask 3.3: Extract Text Tab UI Component - COMPLETE
**File**: `ai-text-tab.tsx` (~570 lines)
**Status**: ✅ Complete

Implemented features:
- [x] 3.3.1: Prompt textarea with character count and remaining chars display
- [x] 3.3.2: Collapsible additional settings section with active count badge
- [x] 3.3.3: Model-specific settings (Hailuo Standard/Pro, LTX Pro, LTX Fast)
- [x] 3.3.4: Unified `AITextTab` component with full props interface

**Component props include:**
- Prompt and character limit
- Unified T2V settings (aspect ratio, resolution, duration, negative prompt, etc.)
- Hailuo T2V duration settings
- LTX Video Pro settings (duration, resolution, FPS, audio)
- LTX Video Fast settings with extended duration constraints

---

### ✅ Subtask 3.4: Extract Image Tab UI Component - COMPLETE
**File**: `ai-image-tab.tsx` (~950 lines)
**Status**: ✅ Complete

Implemented features:
- [x] 3.4.1: Frame upload grid section (via AIImageUploadSection)
- [x] 3.4.2: Motion prompt section
- [x] 3.4.3: Vidu Q2 settings panel (duration, resolution, movement, BGM)
- [x] 3.4.4: LTX I2V settings panel (duration, resolution, FPS, audio)
- [x] 3.4.5: Seedance settings panel (duration, resolution, aspect ratio, camera fixed, end frame)
- [x] 3.4.6: Kling v2.5 settings panel (duration, aspect ratio, cfg scale, enhance prompt, negative prompt)
- [x] 3.4.7: Kling v2.6 settings panel (duration, aspect ratio, cfg scale, audio, negative prompt)
- [x] 3.4.8: WAN 2.5 settings panel (duration, resolution, prompt expansion, negative prompt, audio)
- [x] 3.4.9: Unified `AIImageTab` component with advanced seed options

---

### ✅ Subtask 3.5: Extract Avatar Tab UI Component - COMPLETE
**File**: `ai-avatar-tab.tsx` (~240 lines)
**Status**: ✅ Complete

Implemented features:
- [x] 3.5.1: First/Last frame upload grid (side by side)
- [x] 3.5.2: Reference images grid (6 slots in 3x2 layout)
- [x] 3.5.3: Audio input section
- [x] 3.5.4: Source video section
- [x] 3.5.5: Unified `AIAvatarTab` component with Kling Avatar v2 options

---

### ✅ Subtask 3.6: Extract Upscale Tab UI Component - COMPLETE
**File**: `ai-upscale-tab.tsx` (~400 lines)
**Status**: ✅ Complete

Implemented features:
- [x] 3.6.1: Video source input (file upload + URL with auto metadata extraction)
- [x] 3.6.2: Video metadata display (resolution, duration, FPS)
- [x] 3.6.3: ByteDance upscaler card (target resolution, target FPS, cost estimate)
- [x] 3.6.4: FlashVSR upscaler card (upscale factor, acceleration, quality, format, seed)
- [x] 3.6.5: Topaz upscaler card (upscale factor, frame interpolation, H.264 output)
- [x] 3.6.6: Unified `AIUpscaleTab` component with all upscaler settings

---

## Phase 4: Extract Model-Specific Settings Panels (✅ COMPLETE)

### ✅ Subtask 4.1: Extract Sora 2 Settings - COMPLETE
**File**: `ai-sora-settings.tsx` (~160 lines)
**Status**: ✅ Complete

Implemented features:
- [x] Duration selector (4, 8, 12 seconds) with dynamic pricing
- [x] Aspect ratio selector (16:9 Landscape, 9:16 Portrait)
- [x] Resolution selector (Pro only: auto, 720p, 1080p)
- [x] Helper function for price calculation based on model/resolution

**Exported types:**
- `Sora2Duration` - 4 | 8 | 12
- `Sora2AspectRatio` - "16:9" | "9:16"
- `Sora2Resolution` - "auto" | "720p" | "1080p"

---

### ✅ Subtask 4.2: Extract Veo 3.1 Settings - COMPLETE
**File**: `ai-veo-settings.tsx` (~220 lines)
**Status**: ✅ Complete

Implemented features:
- [x] Resolution selector (720p, 1080p)
- [x] Duration selector (4s, 6s, 8s) with dynamic pricing based on audio toggle
- [x] Aspect ratio selector (16:9, 9:16, 1:1, auto)
- [x] Generate audio toggle (affects pricing display)
- [x] Enhance prompt toggle
- [x] Auto-fix toggle (policy compliance)

**Exported types:**
- `Veo31Resolution` - "720p" | "1080p"
- `Veo31Duration` - "4s" | "6s" | "8s"
- `Veo31AspectRatio` - "9:16" | "16:9" | "1:1" | "auto"
- `Veo31Settings` - Full settings interface

---

### ✅ Subtask 4.3: Extract Reve Settings (T2I + Edit) - COMPLETE
**File**: `ai-reve-settings.tsx` (~280 lines)
**Status**: ✅ Complete

Implemented components:
- [x] `AIReveTextToImageSettings` - Aspect ratio, num images, output format
- [x] `AIReveEditSettings` - Image upload with edit instructions

**Features:**
- Aspect ratio selector with all Reve-supported ratios
- Number of images selector with dynamic pricing
- Output format selector (PNG, JPEG, WebP)
- Image upload with drag-and-drop style UI
- Edit instructions textarea (2560 char limit)
- Image preview with remove button

---

## Phase 5: Compose Main Component

### Subtask 5.1: Refactor Main ai.tsx
**Target**: ~400-500 lines (down from 4072)
**Depends on**: All Phase 2, 3, 4 subtasks
**Status**: PENDING (all dependencies now complete)

The refactored component will:
1. Import all extracted hooks and components
2. Compose tab state hooks
3. Handle tab switching and model selection
4. Render composed UI using extracted components

---

## Current Architecture Analysis

### Existing Extracted Modules (Already Reusable)
The codebase already has a solid foundation for refactoring:

| File | Purpose | Lines | Status |
|------|---------|-------|--------|
| `ai-types.ts` | TypeScript interfaces and types | ~420 | **Stable** |
| `ai-constants.ts` | AI model configs, API settings | ~800 | **Stable** |
| `ai-cost-calculators.ts` | Pricing logic for all models | ~180 | **✅ New** |
| `ai-model-options.ts` | Type aliases and option arrays | ~100 | **✅ New** |
| `use-ai-generation.ts` | Core generation hook | ~600 | **Stable** |
| `use-ai-history.ts` | History management hook | ~150 | **Stable** |
| `ai-image-upload.tsx` | Image upload component | ~300 | **Stable** |
| `ai-history-panel.tsx` | History panel component | ~250 | **Stable** |
| `text2video-models-config.ts` | T2V model capabilities | ~200 | **Stable** |

### What Remains in ai.tsx (~4072 lines)

1. ~~**Local Type Definitions** (Lines 72-146) - ~75 lines~~ → ✅ Extracted to `ai-model-options.ts`

2. **Massive State Management** (Lines 107-350) - ~243 lines
   - 60+ `useState` hooks
   - Tab-specific state (text, image, avatar, upscale)
   - Model-specific settings state

3. **Computed Values & Effects** (Lines 350-900) - ~550 lines
   - `combinedCapabilities` memoization
   - 15+ `useEffect` hooks for state sync/reset
   - Model selection helpers

4. **Event Handlers** (Lines 420-920) - ~100 lines
   - `handleUpscaleVideoChange`
   - `handleUpscaleVideoUrlBlur`
   - `resetGenerationState`

5. ~~**Cost Calculation Functions** (Lines 4113-4246) - ~133 lines~~ → ✅ Extracted to `ai-cost-calculators.ts`

6. **UI Components - Main Render** (Lines 1060-4070) - ~3000 lines
   - Tab navigation and container
   - Text tab content (~400 lines)
   - Image tab content (~1100 lines)
   - Avatar tab content (~350 lines)
   - Upscale tab content (~400 lines)
   - Model selection grid (~200 lines)
   - Settings panels (Sora 2, Veo 3.1, Reve) (~400 lines)
   - Progress/results display (~150 lines)

---

## Code Reuse Opportunities Summary

### High-Impact Reuse Patterns

| Pattern | Current Occurrences | Reuse Strategy | Line Savings |
|---------|---------------------|----------------|--------------|
| File + Preview State | 10+ pairs | `useFileWithPreview()` hook | ~150 lines |
| Duration Selector UI | 8 models | `DurationSelect` component | ~120 lines |
| Resolution Selector UI | 6 models | `ResolutionSelect` component | ~90 lines |
| Aspect Ratio Selector | 5 models | `AspectRatioSelect` component | ~75 lines |
| Settings Panel Container | 12+ panels | `AISettingsPanel` component | ~100 lines |
| Model Settings Group | 10+ groups | Grouped state objects | ~200 lines |

**Total estimated savings from code reuse: ~735 lines**

---

## Recommended Implementation Order

### Priority 1: Foundation (Enables All Other Work)
1. **Subtask 2.1**: Create `use-ai-tab-state-base.ts` with `useFileWithPreview` hook
2. **Subtask 3.1**: Create `AISettingsPanel` reusable component
3. **Subtask 3.2**: Create reusable select field components

### Priority 2: Largest Tab First (Maximum Impact)
4. **Subtask 2.2**: Extract Image Tab State Hook (most complex, most reuse)
5. **Subtask 3.4**: Extract Image Tab UI Component

### Priority 3: Remaining Tabs
6. **Subtask 2.3**: Extract Text Tab State Hook
7. **Subtask 3.3**: Extract Text Tab UI Component
8. **Subtask 2.5**: Extract Upscale Tab State Hook
9. **Subtask 3.6**: Extract Upscale Tab UI Component
10. **Subtask 2.4**: Extract Avatar Tab State Hook
11. **Subtask 3.5**: Extract Avatar Tab UI Component

### Priority 4: Model-Specific Settings
12. **Subtask 4.1-4.3**: Extract Sora 2, Veo 3.1, Reve settings

### Priority 5: Final Composition
13. **Subtask 5.1**: Refactor main ai.tsx to use all extracted modules

---

## Appendix: Original Detailed Interface Designs

<details>
<summary>Click to expand detailed interface designs (preserved for reference)</summary>

### Text Tab State Interface
```typescript
export interface TextTabState {
  // Unified T2V settings
  t2vAspectRatio: string;
  t2vResolution: string;
  t2vDuration: number;
  t2vNegativePrompt: string;
  t2vPromptExpansion: boolean;
  t2vSeed: number;
  t2vSafetyChecker: boolean;
  t2vSettingsExpanded: boolean;

  // Hailuo settings
  hailuoT2VDuration: 6 | 10;

  // LTX Video Pro settings
  ltxv2Duration: 6 | 8 | 10;
  ltxv2Resolution: string;
  ltxv2FPS: 25 | 50;
  ltxv2GenerateAudio: boolean;

  // LTX Video Fast settings
  ltxv2FastDuration: number;
  ltxv2FastResolution: string;
  ltxv2FastFPS: number;
  ltxv2FastGenerateAudio: boolean;
}
```

### Image Tab State Interface
```typescript
export interface ImageTabState {
  // Frame uploads
  firstFrame: File | null;
  firstFramePreview: string | null;
  lastFrame: File | null;
  lastFramePreview: string | null;
  imageTabSourceVideo: File | null;

  // Vidu Q2 settings
  viduQ2Duration: number;
  viduQ2Resolution: string;
  viduQ2MovementAmplitude: string;
  viduQ2EnableBGM: boolean;

  // LTX Video I2V settings
  ltxv2I2VDuration: number;
  ltxv2I2VResolution: string;
  ltxv2I2VFPS: number;
  ltxv2I2VGenerateAudio: boolean;

  // Seedance settings
  seedanceDuration: number;
  seedanceResolution: string;
  seedanceAspectRatio: string;
  seedanceCameraFixed: boolean;
  seedanceEndFrameUrl: string | undefined;
  seedanceEndFrameFile: File | null;
  seedanceEndFramePreview: string | null;

  // Kling settings
  klingDuration: number;
  klingCfgScale: number;
  klingAspectRatio: string;
  klingEnhancePrompt: boolean;
  klingNegativePrompt: string;

  // Kling v2.6 settings
  kling26Duration: number;
  kling26CfgScale: number;
  kling26AspectRatio: string;
  kling26GenerateAudio: boolean;
  kling26NegativePrompt: string;

  // WAN 2.5 settings
  wan25Duration: number;
  wan25Resolution: string;
  wan25AudioUrl: string | undefined;
  wan25AudioFile: File | null;
  wan25AudioPreview: string | null;
  wan25NegativePrompt: string;
  wan25EnablePromptExpansion: boolean;

  // Advanced
  imageSeed: number | undefined;
}
```

### Avatar Tab State Interface
```typescript
export interface AvatarTabState {
  avatarImage: File | null;
  avatarImagePreview: string | null;
  avatarLastFrame: File | null;
  avatarLastFramePreview: string | null;
  referenceImages: (File | null)[];
  referenceImagePreviews: (string | null)[];
  audioFile: File | null;
  audioPreview: string | null;
  sourceVideo: File | null;
  sourceVideoPreview: string | null;
  klingAvatarV2Prompt: string;
  audioDuration: number | null;
}
```

### Upscale Tab State Interface
```typescript
export interface UpscaleTabState {
  sourceVideoFile: File | null;
  sourceVideoUrl: string;
  videoMetadata: VideoMetadata | null;

  // ByteDance settings
  bytedanceTargetResolution: string;
  bytedanceTargetFPS: string;

  // FlashVSR settings
  flashvsrUpscaleFactor: number;
  flashvsrAcceleration: string;
  flashvsrQuality: number;
  flashvsrColorFix: boolean;
  flashvsrPreserveAudio: boolean;
  flashvsrOutputFormat: string;
  flashvsrOutputQuality: string;
  flashvsrOutputWriteMode: string;
  flashvsrSeed: number | undefined;

  // Topaz settings
  topazUpscaleFactor: number;
  topazTargetFPS: string;
  topazH264Output: boolean;
}
```

</details>

---

## Legacy Documentation (Tab UI Component Props)

<details>
<summary>Click to expand original tab component prop designs</summary>

### Text Tab Props
```typescript
interface TextTabProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  selectedModels: string[];
  isCompact: boolean;
  combinedCapabilities: CombinedCapabilities;
  textState: TextTabState;
  textSetters: TextTabSetters;
}
```

### Image Tab Props
```typescript
interface ImageTabProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  selectedModels: string[];
  isCompact: boolean;
  onError: (error: string | null) => void;
  imageState: ImageTabState;
  imageSetters: ImageTabSetters;
  generation: ReturnType<typeof useAIGeneration>;
}
```

### Avatar Tab Props
```typescript
interface AvatarTabProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  selectedModels: string[];
  isCompact: boolean;
  onError: (error: string | null) => void;
  avatarState: AvatarTabState;
  avatarSetters: AvatarTabSetters;
}
```

### Upscale Tab Props
```typescript
interface UpscaleTabProps {
  selectedModels: string[];
  isCompact: boolean;
  onError: (error: string | null) => void;
  upscaleState: UpscaleTabState;
  upscaleSetters: UpscaleTabSetters;
  upscaleHandlers: UpscaleHandlers;
}
```

### Model Settings Panel Props
```typescript
// Sora 2
interface Sora2SettingsProps {
  duration: number;
  aspectRatio: string;
  resolution: string;
  hasSora2Pro: boolean;
  onDurationChange: (v: number) => void;
  onAspectRatioChange: (v: string) => void;
  onResolutionChange: (v: string) => void;
}

// Veo 3.1
interface Veo31SettingsProps {
  settings: Veo31Settings;
  onResolutionChange: (v: string) => void;
  onDurationChange: (v: string) => void;
  onAspectRatioChange: (v: string) => void;
  onGenerateAudioChange: (v: boolean) => void;
  onEnhancePromptChange: (v: boolean) => void;
  onAutoFixChange: (v: boolean) => void;
}

// Reve
interface ReveSettingsProps {
  aspectRatio: string;
  numImages: number;
  outputFormat: string;
  onAspectRatioChange: (v: string) => void;
  onNumImagesChange: (v: number) => void;
  onOutputFormatChange: (v: string) => void;
  uploadedImage: File | null;
  uploadedImagePreview: string | null;
  onImageUpload: (file: File) => Promise<void>;
  onClearImage: () => void;
  editPrompt: string;
  onEditPromptChange: (v: string) => void;
}
```

</details>

---

## Final File Structure

```
media-panel/views/
├── ai.tsx                        # Main component (~4072 lines → target ~400 lines)
├── ai-types.ts                   # Types (existing, stable)
├── ai-constants.ts               # Constants (existing, stable)
│
│── ## Phase 1: Shared Utilities (✅ COMPLETE)
├── ai-cost-calculators.ts        # ✅ COMPLETE: Pricing functions (~180 lines)
├── ai-model-options.ts           # ✅ COMPLETE: Option arrays (~100 lines)
│
│── ## Phase 2: State Management Hooks (✅ COMPLETE)
├── use-ai-generation.ts          # Generation hook (existing)
├── use-ai-history.ts             # History hook (existing)
├── use-ai-tab-state-base.ts      # ✅ COMPLETE: Shared hooks (useFileWithPreview, useMultipleFilesWithPreview, useAudioFileWithDuration, useVideoWithMetadata) (~342 lines)
├── use-ai-text-tab-state.ts      # ✅ COMPLETE: Text tab state (~260 lines)
├── use-ai-image-tab-state.ts     # ✅ COMPLETE: Image tab state (~450 lines)
├── use-ai-avatar-tab-state.ts    # ✅ COMPLETE: Avatar tab state (~180 lines)
├── use-ai-upscale-tab-state.ts   # ✅ COMPLETE: Upscale tab state (~380 lines)
│
│── ## Phase 2.5: Reusable UI Components (✅ COMPLETE)
├── ai-settings-panel.tsx         # ✅ COMPLETE: Reusable settings container (AISettingsPanel, AISettingsPanelSimple, ModelSettingsCard) (~304 lines)
├── ai-select-fields.tsx          # ✅ COMPLETE: Duration/Resolution/AspectRatio/FPS/Upscale selects (~530 lines)
│
│── ## Phase 3: Tab UI Components (✅ COMPLETE)
├── ai-text-tab.tsx               # ✅ COMPLETE: Text tab UI (~570 lines)
├── ai-image-tab.tsx              # ✅ COMPLETE: Image tab UI (~950 lines)
├── ai-avatar-tab.tsx             # ✅ COMPLETE: Avatar tab UI (~240 lines)
├── ai-upscale-tab.tsx            # ✅ COMPLETE: Upscale tab UI (~400 lines)
│
│── ## Phase 4: Model Settings Panels (✅ COMPLETE)
├── ai-sora-settings.tsx          # ✅ COMPLETE: Sora 2 settings (~160 lines)
├── ai-veo-settings.tsx           # ✅ COMPLETE: Veo 3.1 settings (~220 lines)
├── ai-reve-settings.tsx          # ✅ COMPLETE: Reve T2I + Edit settings (~280 lines)
│
│── ## Existing Components (stable)
├── ai-image-upload.tsx           # Image upload (existing)
├── ai-history-panel.tsx          # History panel (existing)
└── text2video-models-config.ts   # T2V config (existing)
```

---

## Implementation Guidelines

### 1. Incremental Migration
- Extract one module at a time
- Run tests after each extraction
- Keep backward compatibility during transition

### 2. Type Safety First
- Define interfaces before implementation
- Use discriminated unions for model-specific settings
- Export all types for external consumption

### 3. Testability
- Each hook should be unit testable
- Each component should have storybook stories
- Cost calculators should have comprehensive test coverage

### 4. Code Reuse Patterns
- Use composition over configuration
- Prefer props over context for explicit dependencies
- Extract common UI patterns (settings panel, file upload, cost display)

### 5. Performance Considerations
- Memoize expensive computations with `useMemo`
- Use callbacks with `useCallback` for handlers passed as props
- Consider lazy loading for tab content

---

## Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| Main file size | 4246 lines | ~400 lines |
| Number of files | 1 | 14 |
| Average file size | 4246 | ~300 lines |
| Test coverage potential | Low | High |
| Code reuse | None | High |
| Onboarding complexity | High | Low |

---

## Dependencies to Maintain

- `useMediaPanelStore` for global AI tab state
- `useProjectStore` for active project context
- `usePanelStore` for responsive layout calculations
- Existing UI components (`FileUpload`, `Select`, `Slider`, etc.)
- Existing hooks (`useAIGeneration`, `useAIHistory`)
