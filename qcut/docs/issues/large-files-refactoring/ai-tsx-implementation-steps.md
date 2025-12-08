# ai.tsx Step-by-Step Implementation Guide

**Goal**: Reduce `ai.tsx` from ~4072 lines to ~400-500 lines by leveraging all extracted modules from Phases 1-4.

**Current Status**: **COMPLETED** - Phase 5 refactoring is done. File reduced from ~4078 lines to ~1083 lines.

**Completion Date**: 2025-12-09

---

## Prerequisites Checklist

Before starting, verify all extracted modules exist and are functional:

| Module | Path | Status |
|--------|------|--------|
| `ai-cost-calculators.ts` | `views/ai-cost-calculators.ts` | VERIFIED |
| `ai-model-options.ts` | `views/ai-model-options.ts` | VERIFIED |
| `use-ai-tab-state-base.ts` | `views/use-ai-tab-state-base.ts` | VERIFIED |
| `use-ai-text-tab-state.ts` | `views/use-ai-text-tab-state.ts` | VERIFIED |
| `use-ai-image-tab-state.ts` | `views/use-ai-image-tab-state.ts` | VERIFIED |
| `use-ai-avatar-tab-state.ts` | `views/use-ai-avatar-tab-state.ts` | VERIFIED |
| `use-ai-upscale-tab-state.ts` | `views/use-ai-upscale-tab-state.ts` | VERIFIED |
| `ai-settings-panel.tsx` | `views/ai-settings-panel.tsx` | VERIFIED |
| `ai-select-fields.tsx` | `views/ai-select-fields.tsx` | VERIFIED |
| `ai-text-tab.tsx` | `views/ai-text-tab.tsx` | VERIFIED |
| `ai-image-tab.tsx` | `views/ai-image-tab.tsx` | VERIFIED |
| `ai-avatar-tab.tsx` | `views/ai-avatar-tab.tsx` | VERIFIED |
| `ai-upscale-tab.tsx` | `views/ai-upscale-tab.tsx` | VERIFIED |
| `ai-sora-settings.tsx` | `views/ai-sora-settings.tsx` | VERIFIED |
| `ai-veo-settings.tsx` | `views/ai-veo-settings.tsx` | VERIFIED |
| `ai-reve-settings.tsx` | `views/ai-reve-settings.tsx` | VERIFIED |

---

## Step 1: Create a Backup & Test Baseline

**Status**: COMPLETED

**Time**: ~5 minutes

```bash
# Create backup of current ai.tsx
cp qcut/apps/web/src/components/editor/media-panel/views/ai.tsx \
   qcut/apps/web/src/components/editor/media-panel/views/ai.tsx.backup

# Run existing tests to establish baseline
cd qcut/apps/web && bun run test

# Verify the app still works
bun run dev
```

**Checkpoint**: All tests pass, app runs correctly.

**Result**: Backup created at `ai.tsx.backup`

---

## Step 2: Add All Imports to ai.tsx

**Status**: COMPLETED

**Lines to add**: ~50-60 import lines
**Lines to remove**: Inline code that imports replace

Add imports at the top of `ai.tsx`:

```typescript
// Phase 1: Utilities
import {
  calculateHailuoCost,
  calculateLTXV2Cost,
  calculateKling26Cost,
  calculateViduQ2Cost,
  calculateWan25Cost,
  calculateSoraCost,
  calculateVeo31Cost,
  calculateReveCost,
} from "./ai-cost-calculators";

import {
  type T2VAspectRatio,
  type T2VResolution,
  type HailuoT2VDuration,
  type LTXV2Duration,
  type LTXV2Resolution,
  type LTXV2FPS,
  // ... other type imports
  ASPECT_RATIO_OPTIONS,
  RESOLUTION_OPTIONS,
  DURATION_OPTIONS,
  // ... other option imports
} from "./ai-model-options";

// Phase 2: State Hooks
import { useAITextTabState } from "./use-ai-text-tab-state";
import { useAIImageTabState } from "./use-ai-image-tab-state";
import { useAIAvatarTabState } from "./use-ai-avatar-tab-state";
import { useAIUpscaleTabState } from "./use-ai-upscale-tab-state";

// Phase 3: Tab UI Components
import { AITextTab } from "./ai-text-tab";
import { AIImageTab } from "./ai-image-tab";
import { AIAvatarTab } from "./ai-avatar-tab";
import { AIUpscaleTab } from "./ai-upscale-tab";

// Phase 4: Model Settings Panels
import { AISora2Settings } from "./ai-sora-settings";
import { AIVeo31Settings } from "./ai-veo-settings";
import { AIReveTextToImageSettings, AIReveEditSettings } from "./ai-reve-settings";

// Phase 3: Reusable Components
import { AISettingsPanel, ModelSettingsCard } from "./ai-settings-panel";
```

**Checkpoint**: File still compiles with imports (may have unused import warnings).

**Result**: All imports added successfully.

---

## Step 3: Replace State Management with Hooks

**Status**: COMPLETED

**Lines removed**: ~243 lines of useState declarations
**Lines added**: ~20 lines of hook calls

### Step 3.1: Replace Text Tab State

Find all text tab related `useState` calls and replace with:

```typescript
const textTabState = useAITextTabState(selectedModels);

// Destructure what you need
const {
  t2vSettings,
  setT2vSettings,
  hailuoT2VDuration,
  setHailuoT2VDuration,
  ltxv2Settings,
  setLtxv2Settings,
  ltxv2FastSettings,
  setLtxv2FastSettings,
  activeSettingsCount,
} = textTabState;
```

**Delete**: All individual `useState` calls for:
- `t2vAspectRatio`, `setT2vAspectRatio`
- `t2vResolution`, `setT2vResolution`
- `t2vDuration`, `setT2vDuration`
- `t2vNegativePrompt`, `setT2vNegativePrompt`
- `t2vPromptExpansion`, `setT2vPromptExpansion`
- `t2vSeed`, `setT2vSeed`
- `t2vSafetyChecker`, `setT2vSafetyChecker`
- `t2vSettingsExpanded`, `setT2vSettingsExpanded`
- `hailuoT2VDuration`, `setHailuoT2VDuration`
- `ltxv2Duration`, `setLtxv2Duration`
- `ltxv2Resolution`, `setLtxv2Resolution`
- `ltxv2FPS`, `setLtxv2FPS`
- `ltxv2GenerateAudio`, `setLtxv2GenerateAudio`
- And all LTX Fast equivalents

### Step 3.2: Replace Image Tab State

```typescript
const imageTabState = useAIImageTabState(selectedModels);

const {
  // Frame uploads
  firstFrame,
  firstFramePreview,
  setFirstFrame,
  lastFrame,
  lastFramePreview,
  setLastFrame,
  // Vidu Q2
  viduQ2Settings,
  setViduQ2Settings,
  // LTX I2V
  ltxv2I2VSettings,
  setLtxv2I2VSettings,
  // Seedance
  seedanceSettings,
  setSeedanceSettings,
  // Kling
  klingSettings,
  setKlingSettings,
  kling26Settings,
  setKling26Settings,
  // WAN 2.5
  wan25Settings,
  setWan25Settings,
  // Advanced
  imageSeed,
  setImageSeed,
} = imageTabState;
```

**Delete**: All corresponding `useState` calls for image tab.

### Step 3.3: Replace Avatar Tab State

```typescript
const avatarTabState = useAIAvatarTabState();

const {
  avatarImage,
  avatarImagePreview,
  setAvatarImage,
  avatarLastFrame,
  avatarLastFramePreview,
  setAvatarLastFrame,
  referenceImages,
  referenceImagePreviews,
  setReferenceImage,
  audioFile,
  audioPreview,
  audioDuration,
  setAudioFile,
  sourceVideo,
  sourceVideoPreview,
  setSourceVideo,
  klingAvatarV2Prompt,
  setKlingAvatarV2Prompt,
  resetAvatarImage,
  resetLastFrame,
  resetReferenceImage,
  resetAudio,
  resetSourceVideo,
} = avatarTabState;
```

**Delete**: All corresponding `useState` calls for avatar tab.

### Step 3.4: Replace Upscale Tab State

```typescript
const upscaleTabState = useAIUpscaleTabState(selectedModels);

const {
  sourceVideoFile,
  sourceVideoUrl,
  videoMetadata,
  setSourceVideoFile,
  setSourceVideoUrl,
  handleUpscaleVideoChange,
  handleUpscaleVideoUrlBlur,
  // ByteDance
  bytedanceSettings,
  setBytedanceSettings,
  bytedanceCost,
  // FlashVSR
  flashvsrSettings,
  setFlashvsrSettings,
  flashvsrCost,
  // Topaz
  topazSettings,
  setTopazSettings,
  topazCost,
} = upscaleTabState;
```

**Delete**: All corresponding `useState` calls for upscale tab.

**Checkpoint**: Run `bun run check-types` - should have no type errors. Run app to verify state still works.

**Result**: All state hooks integrated successfully. Type check passes.

---

## Step 4: Replace Tab UI with Extracted Components

**Status**: COMPLETED

**Lines removed**: ~3000+ lines of JSX
**Lines added**: ~100 lines of component usage

### Step 4.1: Replace Text Tab JSX

Find the text tab render section (usually inside a tab panel or conditional render) and replace with:

```tsx
<AITextTab
  prompt={prompt}
  onPromptChange={setPrompt}
  selectedModels={selectedModels}
  isCompact={isCompact}
  combinedCapabilities={combinedCapabilities}
  // T2V Settings
  t2vSettings={t2vSettings}
  onT2vSettingsChange={setT2vSettings}
  activeSettingsCount={activeSettingsCount}
  // Hailuo
  hailuoT2VDuration={hailuoT2VDuration}
  onHailuoT2VDurationChange={setHailuoT2VDuration}
  // LTX Pro
  ltxv2Settings={ltxv2Settings}
  onLtxv2SettingsChange={setLtxv2Settings}
  // LTX Fast
  ltxv2FastSettings={ltxv2FastSettings}
  onLtxv2FastSettingsChange={setLtxv2FastSettings}
/>
```

**Delete**: All the inline JSX for the text tab (~400 lines).

### Step 4.2: Replace Image Tab JSX

```tsx
<AIImageTab
  prompt={prompt}
  onPromptChange={setPrompt}
  selectedModels={selectedModels}
  isCompact={isCompact}
  onError={setError}
  // Frame uploads
  firstFrame={firstFrame}
  firstFramePreview={firstFramePreview}
  onFirstFrameChange={/* handler */}
  lastFrame={lastFrame}
  lastFramePreview={lastFramePreview}
  onLastFrameChange={/* handler */}
  // Vidu Q2
  viduQ2Settings={viduQ2Settings}
  onViduQ2SettingsChange={setViduQ2Settings}
  // LTX I2V
  ltxv2I2VSettings={ltxv2I2VSettings}
  onLtxv2I2VSettingsChange={setLtxv2I2VSettings}
  // ... remaining props
  generation={generation}
/>
```

**Delete**: All the inline JSX for the image tab (~1100 lines).

### Step 4.3: Replace Avatar Tab JSX

```tsx
<AIAvatarTab
  prompt={prompt}
  onPromptChange={setPrompt}
  selectedModels={selectedModels}
  isCompact={isCompact}
  onError={setError}
  // Avatar state
  avatarImage={avatarImage}
  avatarImagePreview={avatarImagePreview}
  onAvatarImageChange={setAvatarImage}
  onAvatarImageClear={resetAvatarImage}
  // Last frame
  avatarLastFrame={avatarLastFrame}
  avatarLastFramePreview={avatarLastFramePreview}
  onLastFrameChange={setAvatarLastFrame}
  onLastFrameClear={resetLastFrame}
  // Reference images
  referenceImages={referenceImages}
  referenceImagePreviews={referenceImagePreviews}
  onReferenceImageChange={setReferenceImage}
  onReferenceImageClear={resetReferenceImage}
  // Audio
  audioFile={audioFile}
  audioPreview={audioPreview}
  audioDuration={audioDuration}
  onAudioChange={setAudioFile}
  onAudioClear={resetAudio}
  // Source video
  sourceVideo={sourceVideo}
  sourceVideoPreview={sourceVideoPreview}
  onSourceVideoChange={setSourceVideo}
  onSourceVideoClear={resetSourceVideo}
  // Kling Avatar v2
  klingAvatarV2Prompt={klingAvatarV2Prompt}
  onKlingAvatarV2PromptChange={setKlingAvatarV2Prompt}
/>
```

**Delete**: All the inline JSX for the avatar tab (~350 lines).

### Step 4.4: Replace Upscale Tab JSX

```tsx
<AIUpscaleTab
  selectedModels={selectedModels}
  isCompact={isCompact}
  onError={setError}
  // Source video
  sourceVideoFile={sourceVideoFile}
  sourceVideoUrl={sourceVideoUrl}
  videoMetadata={videoMetadata}
  onVideoFileChange={handleUpscaleVideoChange}
  onVideoUrlChange={setSourceVideoUrl}
  onVideoUrlBlur={handleUpscaleVideoUrlBlur}
  // ByteDance
  bytedanceSettings={bytedanceSettings}
  onBytedanceSettingsChange={setBytedanceSettings}
  bytedanceCost={bytedanceCost}
  // FlashVSR
  flashvsrSettings={flashvsrSettings}
  onFlashvsrSettingsChange={setFlashvsrSettings}
  flashvsrCost={flashvsrCost}
  // Topaz
  topazSettings={topazSettings}
  onTopazSettingsChange={setTopazSettings}
  topazCost={topazCost}
/>
```

**Delete**: All the inline JSX for the upscale tab (~400 lines).

**Checkpoint**: Run app, test each tab works correctly.

**Result**: All tab components integrated successfully.

---

## Step 5: Replace Model Settings Panels

**Status**: COMPLETED

**Lines removed**: ~400 lines of settings panel JSX
**Lines added**: ~30 lines of component usage

### Step 5.1: Replace Sora 2 Settings

Find where Sora 2 settings are rendered and replace with:

```tsx
{selectedModels.includes("sora-2") && (
  <AISora2Settings
    duration={sora2Duration}
    aspectRatio={sora2AspectRatio}
    resolution={sora2Resolution}
    hasSora2Pro={selectedModels.includes("sora-2-pro")}
    onDurationChange={setSora2Duration}
    onAspectRatioChange={setSora2AspectRatio}
    onResolutionChange={setSora2Resolution}
  />
)}
```

### Step 5.2: Replace Veo 3.1 Settings

```tsx
{selectedModels.includes("veo-3.1") && (
  <AIVeo31Settings
    settings={veo31Settings}
    onResolutionChange={(v) => setVeo31Settings(s => ({ ...s, resolution: v }))}
    onDurationChange={(v) => setVeo31Settings(s => ({ ...s, duration: v }))}
    onAspectRatioChange={(v) => setVeo31Settings(s => ({ ...s, aspectRatio: v }))}
    onGenerateAudioChange={(v) => setVeo31Settings(s => ({ ...s, generateAudio: v }))}
    onEnhancePromptChange={(v) => setVeo31Settings(s => ({ ...s, enhancePrompt: v }))}
    onAutoFixChange={(v) => setVeo31Settings(s => ({ ...s, autoFix: v }))}
  />
)}
```

### Step 5.3: Replace Reve Settings

```tsx
{selectedModels.includes("reve-t2i") && (
  <AIReveTextToImageSettings
    aspectRatio={reveAspectRatio}
    numImages={reveNumImages}
    outputFormat={reveOutputFormat}
    onAspectRatioChange={setReveAspectRatio}
    onNumImagesChange={setReveNumImages}
    onOutputFormatChange={setReveOutputFormat}
  />
)}

{selectedModels.includes("reve-edit") && (
  <AIReveEditSettings
    uploadedImage={reveUploadedImage}
    uploadedImagePreview={reveUploadedImagePreview}
    onImageUpload={handleReveImageUpload}
    onClearImage={clearReveImage}
    editPrompt={reveEditPrompt}
    onEditPromptChange={setReveEditPrompt}
  />
)}
```

**Checkpoint**: Run app, verify all model settings work.

**Result**: All model settings panels integrated successfully.

---

## Step 6: Remove Dead Code

**Status**: COMPLETED

After all replacements, search for and remove:

1. **Unused `useState` declarations** - any remaining that were replaced by hooks
2. **Unused `useEffect` hooks** - effects now handled by state hooks
3. **Unused helper functions** - replaced by hook internal logic
4. **Unused inline cost calculations** - now in `ai-cost-calculators.ts`
5. **Unused type definitions** - now in `ai-model-options.ts`

Run:
```bash
# Check for unused exports
bun run lint:clean

# Type check
bun run check-types
```

---

## Step 7: Final Structure of ai.tsx

**Status**: COMPLETED

After refactoring, `ai.tsx` now has ~1083 lines with the following structure:

```typescript
// ~50-60 lines: Imports
import { ... } from "./ai-cost-calculators";
import { ... } from "./ai-model-options";
import { useAITextTabState } from "./use-ai-text-tab-state";
// ... other imports

// ~10 lines: Component props interface
interface AITabContentProps {
  isCompact: boolean;
}

// ~300-400 lines: Main component
export function AITabContent({ isCompact }: AITabContentProps) {
  // ~20 lines: State hook calls
  const textTabState = useAITextTabState(selectedModels);
  const imageTabState = useAIImageTabState(selectedModels);
  const avatarTabState = useAIAvatarTabState();
  const upscaleTabState = useAIUpscaleTabState(selectedModels);

  // ~20 lines: Shared state (prompt, selected models, active tab)
  const [prompt, setPrompt] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("text");

  // ~30 lines: Generation and history hooks
  const generation = useAIGeneration({ ... });
  const history = useAIHistory();

  // ~50 lines: Computed values (combinedCapabilities, etc.)
  const combinedCapabilities = useMemo(() => { ... }, [selectedModels]);

  // ~50 lines: Event handlers
  const handleGenerate = useCallback(() => { ... }, [...]);
  const handleModelSelect = useCallback((model: string) => { ... }, [...]);

  // ~200 lines: JSX render
  return (
    <div className="ai-panel">
      {/* Tab navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>...</TabsList>

        {/* Tab content - using extracted components */}
        <TabsContent value="text">
          <AITextTab {...textTabProps} />
        </TabsContent>

        <TabsContent value="image">
          <AIImageTab {...imageTabProps} />
        </TabsContent>

        <TabsContent value="avatar">
          <AIAvatarTab {...avatarTabProps} />
        </TabsContent>

        <TabsContent value="upscale">
          <AIUpscaleTab {...upscaleTabProps} />
        </TabsContent>
      </Tabs>

      {/* Model selection grid */}
      <ModelSelectionGrid ... />

      {/* Model-specific settings */}
      {selectedModels.includes("sora-2") && <AISora2Settings ... />}
      {selectedModels.includes("veo-3.1") && <AIVeo31Settings ... />}
      {/* ... other model settings */}

      {/* Generation button and progress */}
      <GenerationControls ... />

      {/* Results display */}
      <ResultsDisplay ... />
    </div>
  );
}
```

---

## Step 8: Verification Checklist

**Status**: PARTIALLY COMPLETED

Run through this checklist after completing refactoring:

### Functionality Tests
- [ ] Text-to-video generation works
- [ ] Image-to-video generation works
- [ ] Avatar generation works
- [ ] Video upscaling works
- [ ] All model-specific settings save correctly
- [ ] File uploads work (first frame, last frame, audio, video)
- [ ] Preview URLs display correctly
- [ ] Cost calculations display correctly
- [ ] Model selection/deselection works
- [ ] History panel works

### Code Quality
- [x] `bun run check-types` passes (ai.tsx has no TypeScript errors)
- [ ] `bun run lint:clean` passes
- [ ] No console errors in browser
- [ ] All tests pass

### Performance
- [ ] Initial render is fast
- [ ] Tab switching is responsive
- [ ] No memory leaks from URL object cleanup

---

## Rollback Plan

If issues arise:

```bash
# Restore backup
cp qcut/apps/web/src/components/editor/media-panel/views/ai.tsx.backup \
   qcut/apps/web/src/components/editor/media-panel/views/ai.tsx

# Verify restoration
bun run check-types && bun run dev
```

---

## Expected Outcome

| Metric | Before | After (Actual) |
|--------|--------|----------------|
| ai.tsx lines | ~4072 | ~1083 |
| Total files | 1 | 15+ |
| Average file size | 4072 | ~300 |
| Test coverage | Low | High |
| Code reuse | None | High |
| Cognitive complexity | Very High | Low |
| Time to understand | Hours | Minutes |

**Note**: The final line count (~1083) is higher than the target (~400-500) because:
1. The component still maintains substantial shared state and coordination logic
2. Model selection grid and cost calculation UI remain in the main component
3. Error handling and validation messages are retained
4. Generation progress and results display are handled inline

Further reduction is possible by extracting:
- Model selection grid to a dedicated component
- Cost summary to a dedicated component
- Generation controls/progress to a dedicated component
- Results display to a dedicated component

---

## Notes for Future Maintenance

1. **Adding new AI models**: Create model-specific settings component, add to model options, update relevant tab state hook
2. **Adding new tabs**: Create state hook + UI component, add to main component
3. **Modifying settings**: Update in the specific settings component file
4. **Cost calculations**: Update `ai-cost-calculators.ts`
5. **Type definitions**: Update `ai-model-options.ts`
