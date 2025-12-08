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

## Phase 2: Extract State Management Hooks (In Progress)

### Subtask 2.1: Create Base State Hook Pattern
**File**: `use-ai-tab-state-base.ts` (~50 lines)
**Priority**: High (enables code reuse across all tab state hooks)

Create a reusable base pattern for tab state management:

```typescript
// Shared utilities for all tab state hooks
export interface TabStateConfig<T> {
  initialState: T;
  resetDependencies?: unknown[];
}

export function createTabStateReset<T>(
  setState: React.Dispatch<React.SetStateAction<T>>,
  initialState: T
): () => void {
  return () => setState(initialState);
}

// Shared file upload handling pattern
export function useFileWithPreview(initialFile: File | null = null) {
  const [file, setFile] = useState<File | null>(initialFile);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFileChange = useCallback((newFile: File | null) => {
    setFile(newFile);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(newFile ? URL.createObjectURL(newFile) : null);
  }, [preview]);

  const reset = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
  }, [preview]);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  return { file, preview, setFile: handleFileChange, reset };
}
```

**Reuse opportunity**: This pattern is duplicated 10+ times in ai.tsx for firstFrame, lastFrame, avatarImage, etc.

---

### Subtask 2.2: Extract Image Tab State Hook
**File**: `use-ai-image-tab-state.ts` (~200 lines)
**Depends on**: Subtask 2.1

| State Variable | Current Location | Reuse Pattern |
|---------------|------------------|---------------|
| `firstFrame`, `firstFramePreview` | Lines 126-131 | `useFileWithPreview()` |
| `lastFrame`, `lastFramePreview` | Lines 130-131 | `useFileWithPreview()` |
| `imageTabSourceVideo` | Line 134-136 | Single file state |
| `viduQ2*` settings | Lines 240-255 | Grouped model settings |
| `ltxv2I2V*` settings | Lines 260-280 | Grouped model settings |
| `seedance*` settings | Lines 285-320 | Grouped model settings |
| `kling*` settings | Lines 325-360 | Grouped model settings |
| `kling26*` settings | Lines 365-400 | Grouped model settings |
| `wan25*` settings | Lines 405-440 | Grouped model settings |
| `imageSeed` | Line ~450 | Simple state |

**Subtasks:**
- [ ] 2.2.1: Extract file upload state (firstFrame, lastFrame, endFrame) using `useFileWithPreview`
- [ ] 2.2.2: Extract Vidu Q2 settings into grouped state object
- [ ] 2.2.3: Extract LTX Video I2V settings into grouped state object
- [ ] 2.2.4: Extract Seedance settings into grouped state object
- [ ] 2.2.5: Extract Kling v2.5 settings into grouped state object
- [ ] 2.2.6: Extract Kling v2.6 settings into grouped state object
- [ ] 2.2.7: Extract WAN 2.5 settings into grouped state object
- [ ] 2.2.8: Create unified `useImageTabState` hook that composes all above

---

### Subtask 2.3: Extract Text Tab State Hook
**File**: `use-ai-text-tab-state.ts` (~120 lines)
**Depends on**: Subtask 2.1

| State Variable | Current Location | Reuse Pattern |
|---------------|------------------|---------------|
| `t2vAspectRatio` | Line ~210 | Simple state |
| `t2vResolution` | Line ~212 | Simple state |
| `t2vDuration` | Line ~214 | Simple state |
| `t2vNegativePrompt` | Line ~216 | Simple state |
| `t2vPromptExpansion` | Line ~218 | Simple state |
| `t2vSeed` | Line ~220 | Simple state |
| `t2vSafetyChecker` | Line ~222 | Simple state |
| `t2vSettingsExpanded` | Line ~224 | Simple state |
| `hailuoT2VDuration` | Line ~226 | Simple state |
| `ltxv2*` settings | Lines ~228-238 | Grouped model settings |

**Subtasks:**
- [ ] 2.3.1: Extract common T2V settings into grouped state object
- [ ] 2.3.2: Extract Hailuo-specific settings
- [ ] 2.3.3: Extract LTX Video Pro/Fast settings (T2V variant)
- [ ] 2.3.4: Create unified `useTextTabState` hook

---

### Subtask 2.4: Extract Avatar Tab State Hook
**File**: `use-ai-avatar-tab-state.ts` (~80 lines)
**Depends on**: Subtask 2.1

| State Variable | Reuse Pattern |
|---------------|---------------|
| `avatarImage`, `avatarImagePreview` | `useFileWithPreview()` |
| `avatarLastFrame`, `avatarLastFramePreview` | `useFileWithPreview()` |
| `referenceImages[6]`, `referenceImagePreviews[6]` | Array of `useFileWithPreview()` |
| `audioFile`, `audioPreview` | `useFileWithPreview()` |
| `sourceVideo`, `sourceVideoPreview` | `useFileWithPreview()` |
| `klingAvatarV2Prompt` | Simple state |
| `audioDuration` | Derived from audioFile |

**Subtasks:**
- [ ] 2.4.1: Extract avatar image uploads using `useFileWithPreview`
- [ ] 2.4.2: Create `useReferenceImages(count: number)` hook for reference image array
- [ ] 2.4.3: Extract audio handling with duration extraction
- [ ] 2.4.4: Create unified `useAvatarTabState` hook

---

### Subtask 2.5: Extract Upscale Tab State Hook
**File**: `use-ai-upscale-tab-state.ts` (~100 lines)
**Depends on**: Subtask 2.1

| State Variable | Current Location |
|---------------|------------------|
| `sourceVideoFile`, `sourceVideoUrl` | Lines 169-170 |
| `videoMetadata` | Line 171-173 |
| `bytedance*` settings | Lines 175-180 |
| `flashvsr*` settings | Lines 182-198 |
| `topaz*` settings | Lines 200-203 |

**Subtasks:**
- [ ] 2.5.1: Extract video source handling (file + URL + metadata extraction)
- [ ] 2.5.2: Extract ByteDance upscaler settings
- [ ] 2.5.3: Extract FlashVSR upscaler settings
- [ ] 2.5.4: Extract Topaz upscaler settings
- [ ] 2.5.5: Create unified `useUpscaleTabState` hook with cost calculation integration

---

## Phase 3: Extract UI Components

### Subtask 3.1: Create Reusable Settings Panel Component
**File**: `ai-settings-panel.tsx` (~80 lines)
**Priority**: High (reused by all model-specific settings)

```typescript
interface AISettingsPanelProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  isCollapsible?: boolean;
  defaultExpanded?: boolean;
}

// Reuse: Sora2, Veo3.1, Reve, and all model-specific settings panels
```

---

### Subtask 3.2: Create Reusable Select Component Wrappers
**File**: `ai-select-fields.tsx` (~150 lines)

```typescript
// Duration selector (reused by 8+ models)
export function DurationSelect({
  options, value, onChange, pricePerSecond?
}: DurationSelectProps)

// Resolution selector (reused by 6+ models)
export function ResolutionSelect({
  options, value, onChange, priceMapping?
}: ResolutionSelectProps)

// Aspect ratio selector (reused by 5+ models)
export function AspectRatioSelect({
  options, value, onChange
}: AspectRatioSelectProps)

// FPS selector (reused by 3+ models)
export function FPSSelect({
  options, value, onChange
}: FPSSelectProps)
```

---

### Subtask 3.3: Extract Text Tab UI Component
**File**: `ai-text-tab.tsx` (~500 lines)
**Depends on**: Subtask 2.3, 3.1, 3.2

**Subtasks:**
- [ ] 3.3.1: Extract prompt textarea with character count
- [ ] 3.3.2: Extract collapsible additional settings section
- [ ] 3.3.3: Extract model-specific settings (Hailuo, LTX Pro, LTX Fast)
- [ ] 3.3.4: Create unified `AITextTab` component

---

### Subtask 3.4: Extract Image Tab UI Component
**File**: `ai-image-tab.tsx` (~900 lines)
**Depends on**: Subtask 2.2, 3.1, 3.2

**Subtasks:**
- [ ] 3.4.1: Extract frame upload grid section
- [ ] 3.4.2: Extract motion prompt section
- [ ] 3.4.3: Extract Vidu Q2 settings panel
- [ ] 3.4.4: Extract LTX I2V settings panel
- [ ] 3.4.5: Extract Seedance settings panel
- [ ] 3.4.6: Extract Kling v2.5 settings panel
- [ ] 3.4.7: Extract Kling v2.6 settings panel
- [ ] 3.4.8: Extract WAN 2.5 settings panel
- [ ] 3.4.9: Create unified `AIImageTab` component

---

### Subtask 3.5: Extract Avatar Tab UI Component
**File**: `ai-avatar-tab.tsx` (~400 lines)
**Depends on**: Subtask 2.4, 3.1

**Subtasks:**
- [ ] 3.5.1: Extract avatar image upload grid
- [ ] 3.5.2: Extract reference images grid (6 slots)
- [ ] 3.5.3: Extract audio input section
- [ ] 3.5.4: Extract source video section
- [ ] 3.5.5: Create unified `AIAvatarTab` component

---

### Subtask 3.6: Extract Upscale Tab UI Component
**File**: `ai-upscale-tab.tsx` (~450 lines)
**Depends on**: Subtask 2.5, 3.1, 3.2

**Subtasks:**
- [ ] 3.6.1: Extract video source input (file upload + URL)
- [ ] 3.6.2: Extract video metadata display
- [ ] 3.6.3: Extract ByteDance upscaler card
- [ ] 3.6.4: Extract FlashVSR upscaler card
- [ ] 3.6.5: Extract Topaz upscaler card
- [ ] 3.6.6: Create unified `AIUpscaleTab` component

---

## Phase 4: Extract Model-Specific Settings Panels

### Subtask 4.1: Extract Sora 2 Settings
**File**: `ai-sora-settings.tsx` (~100 lines)
**Depends on**: Subtask 3.1, 3.2

---

### Subtask 4.2: Extract Veo 3.1 Settings
**File**: `ai-veo-settings.tsx` (~150 lines)
**Depends on**: Subtask 3.1, 3.2

---

### Subtask 4.3: Extract Reve Settings (T2I + Edit)
**File**: `ai-reve-settings.tsx` (~200 lines)
**Depends on**: Subtask 3.1, 3.2

---

## Phase 5: Compose Main Component

### Subtask 5.1: Refactor Main ai.tsx
**Target**: ~400-500 lines (down from 4072)
**Depends on**: All Phase 2, 3, 4 subtasks

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
│── ## Phase 2: State Management Hooks
├── use-ai-generation.ts          # Generation hook (existing)
├── use-ai-history.ts             # History hook (existing)
├── use-ai-tab-state-base.ts      # PENDING: Shared hooks (useFileWithPreview) (~50 lines)
├── use-ai-text-tab-state.ts      # PENDING: Text tab state (~120 lines)
├── use-ai-image-tab-state.ts     # PENDING: Image tab state (~200 lines)
├── use-ai-avatar-tab-state.ts    # PENDING: Avatar tab state (~80 lines)
├── use-ai-upscale-tab-state.ts   # PENDING: Upscale tab state (~100 lines)
│
│── ## Phase 3: Reusable UI Components
├── ai-settings-panel.tsx         # PENDING: Reusable settings container (~80 lines)
├── ai-select-fields.tsx          # PENDING: Duration/Resolution/AspectRatio selects (~150 lines)
│
│── ## Phase 3: Tab UI Components
├── ai-text-tab.tsx               # PENDING: Text tab UI (~500 lines)
├── ai-image-tab.tsx              # PENDING: Image tab UI (~900 lines)
├── ai-avatar-tab.tsx             # PENDING: Avatar tab UI (~400 lines)
├── ai-upscale-tab.tsx            # PENDING: Upscale tab UI (~450 lines)
│
│── ## Phase 4: Model Settings Panels
├── ai-sora-settings.tsx          # PENDING: Sora 2 settings (~100 lines)
├── ai-veo-settings.tsx           # PENDING: Veo 3.1 settings (~150 lines)
├── ai-reve-settings.tsx          # PENDING: Reve settings (~200 lines)
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
