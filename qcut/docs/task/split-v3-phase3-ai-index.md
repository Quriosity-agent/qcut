# Phase 3: Split `ai/index.tsx`

**Source:** `apps/web/src/components/editor/media-panel/views/ai/index.tsx` (1281 lines → ~400 + 2 hooks + 3 components)
**Risk Level:** Medium
**Estimated Time:** ~30 min
**Predecessor:** Phase 2 (builds on same directory structure)

---

## Objective

Extract two custom hooks (cost calculation, panel effects) and three UI sub-components (model grid, generation feedback, validation messages) from the main AI panel view. The parent orchestrator retains state init, tab logic, and layout composition.

---

## Subtasks

### 3.1 Extract `use-cost-calculation.ts` hook (~89 lines)
**~7 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/hooks/use-cost-calculation.ts`

Move from `ai/index.tsx` (lines 395–483):
- `useCostCalculation()` — computes `totalCost`, `bytedanceEstimatedCost`, `flashvsrEstimatedCost`, `hasRemixSelected`

**Input interface:**
```ts
interface CostCalculationInput {
  selectedModels: string[];
  imageTabState: ImageTabState;
  textTabState: TextTabState;
  avatarTabState: AvatarTabState;
  upscaleTabState: UpscaleTabState;
  anglesTabState: AnglesTabState;
  generationState: GenerationState;
  reveEditState: ReveEditState;
}
```

**Returns:** `{ totalCost: number, bytedanceEstimatedCost: number, flashvsrEstimatedCost: number, hasRemixSelected: boolean }`

**Why structured input:** Avoids passing 15+ individual parameters. The object keeps the hook signature stable when internal dependencies change.

### 3.2 Extract `use-ai-panel-effects.ts` hook (~66 lines)
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-panel-effects.ts`

Move from `ai/index.tsx` (lines 175–240):
- `useAIPanelEffects()` — capability clamping, Reve state reset, frame sync

**Input interface:**
```ts
interface PanelEffectsInput {
  capabilities: ModelCapabilities;
  selectedModels: string[];
  imageState: ImageState;
  setters: {
    setDuration: (v: string) => void;
    setResolution: (v: string) => void;
    setSelectedImage: (v: string | null) => void;
    // ... other tab setters
  };
}
```

**Returns:** `void` (side-effect only hook)

**Existing hooks directory** already has 13 hooks — this follows the established pattern.

### 3.3 Extract `AIModelSelectionGrid` component (~58 lines)
**~4 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/ai-model-selection-grid.tsx`

Move from `ai/index.tsx` (lines 970–1027):
- Grid of model toggle buttons with logo, name, price badge

**Props:**
```ts
interface AIModelSelectionGridProps {
  activeTab: string;
  selectedModels: string[];
  isCompact: boolean;
  onToggleModel: (modelId: string) => void;
}
```

Imports `AI_MODELS` constant directly — no prop drilling for static data.

### 3.4 Extract `AIGenerationFeedback` component (~96 lines)
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/ai-generation-feedback.tsx`

Move from `ai/index.tsx` (lines 1094–1196):
- Error display, progress bar with timer, generated video results list with download

**Props:**
```ts
interface AIGenerationFeedbackProps {
  generationState: GenerationState;
  error: string | null;
  onDownload: (url: string, filename: string) => void;
}
```

### 3.5 Extract `AIValidationMessages` component (~49 lines)
**~4 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/ai-validation-messages.tsx`

Move from `ai/index.tsx` (lines 1198–1246):
- Tab-specific validation banners (missing image, missing prompt, model constraints)

**Props:**
```ts
interface AIValidationMessagesProps {
  activeTab: string;
  selectedModels: string[];
  prompt: string;
  selectedImage: string | null;
  avatarState: AvatarTabState;
  imageState: ImageTabState;
}
```

### 3.6 Update `ai/index.tsx` to use extracted hooks and components
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/index.tsx` (~400 lines remaining)

Changes:
- Import 2 hooks from `./hooks/`
- Import 3 components from `./components/`
- Replace inline code with hook calls and component renders
- Keep: state initialization, tab hook setup, generation hook config, layout JSX

---

## Existing Files in Target Directories

**`ai/hooks/`** (13 files already):
- `use-ai-history.ts`, `use-ai-text-tab-state.ts`, `use-ai-upscale-tab-state.ts`, `use-ai-avatar-tab-state.ts`, `use-ai-image-tab-state.ts`, `use-ai-tab-state-base.ts`, `use-ai-angles-tab-state.ts`, `use-ai-generation-helpers.ts`, `use-ai-generation.ts`, `use-ai-mock-generation.ts`, `use-ai-polling.ts`, `use-reve-edit-state.ts`, `use-veo31-state.ts`

**`ai/components/`** (4 existing + 7 from Phase 2):
- `ai-history-panel.tsx`, `ai-image-upload.tsx`, `ai-settings-panel.tsx`, `ai-select-fields.tsx`
- Plus 7 model settings components added in Phase 2

---

## Unit Tests

### New tests

**File:** `apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-cost-calculation.test.ts`

| Test Case | Description |
|-----------|-------------|
| `returns zero cost when no models selected` | Empty `selectedModels` → `totalCost: 0` |
| `calculates cost for single model` | One model selected → correct pricing |
| `sums cost for multiple models` | Multiple models → sum of individual prices |
| `computes bytedance estimated cost` | ByteDance model selected → non-zero estimate |
| `detects remix selection` | Remix model in list → `hasRemixSelected: true` |

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/__tests__/ai-generation-feedback.test.tsx`

| Test Case | Description |
|-----------|-------------|
| `shows error message when error prop set` | Assert error banner visible |
| `shows progress bar during generation` | In-progress state → progress bar rendered |
| `shows download buttons for completed videos` | Completed state → download links present |
| `hides feedback when idle` | Idle state → no feedback UI rendered |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Cost hook depends on 15+ state values | Structured config object — single parameter, stable signature |
| Effects hook has side effects on multiple setters | Pass setters as callback object — clear ownership |
| Model grid needs `AI_MODELS` constant | Import directly in component — no prop drilling needed |
| Generated video download uses blob URL logic | Pass `onDownload` callback from parent |

---

## Verification Checklist

- [ ] `bun run check-types` — no new type errors
- [ ] `bun lint:clean` — no lint violations
- [ ] `bun run test` — new tests pass
- [ ] Smoke test: `bun run electron:dev` → AI panel → model grid, cost display, generation feedback all work
- [ ] No circular imports between hooks and components
