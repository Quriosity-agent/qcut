# Phase 2: Split `ai-image-tab.tsx`

**Source:** `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-image-tab.tsx` (1283 lines → ~400 + 7 model components)
**Risk Level:** Low-Medium
**Estimated Time:** ~35 min
**Predecessor:** Phase 1 (independent, but follow execution order)

---

## Objective

Extract 7 model-specific settings sections into individual components. Each model's UI block is conditionally rendered and fully independent — no shared state between them.

---

## Subtasks

### 2.1 Create `ai-vidu-q2-settings.tsx` (~97 lines)
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/ai-vidu-q2-settings.tsx`

Extract: Vidu Q2 model settings block — duration, resolution, movement amplitude, BGM toggle.

Props interface:
```ts
interface AiViduQ2SettingsProps {
  duration: string;
  setDuration: (v: string) => void;
  resolution: string;
  setResolution: (v: string) => void;
  movementAmplitude: string;
  setMovementAmplitude: (v: string) => void;
  bgm: boolean;
  setBgm: (v: boolean) => void;
  isCompact: boolean;
}
```

### 2.2 Create `ai-ltx-i2v-settings.tsx` (~97 lines)
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/ai-ltx-i2v-settings.tsx`

Extract: LTX I2V model settings — duration, resolution, FPS, audio toggle.

### 2.3 Create `ai-ltx-fast-i2v-settings.tsx` (~140 lines)
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/ai-ltx-fast-i2v-settings.tsx`

Extract: LTX Fast I2V model settings — duration, resolution with extended constraints, FPS, audio toggle.

### 2.4 Create `ai-seedance-settings.tsx` (~139 lines)
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/ai-seedance-settings.tsx`

Extract: Seedance model settings — duration, resolution, aspect ratio, camera lock toggle, end frame upload.

Props include: `onError` callback for FileUpload error handling.

### 2.5 Create `ai-kling-v25-settings.tsx` (~105 lines)
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/ai-kling-v25-settings.tsx`

Extract: Kling v2.5 model settings — duration, aspect ratio, CFG slider, enhance prompt toggle, negative prompt.

### 2.6 Create `ai-kling-v26-settings.tsx` (~114 lines)
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/ai-kling-v26-settings.tsx`

Extract: Kling v2.6 model settings — duration, aspect ratio, CFG slider, audio generation toggle, negative prompt.

### 2.7 Create `ai-wan25-settings.tsx` (~134 lines)
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/ai-wan25-settings.tsx`

Extract: WAN 2.5 model settings — duration, resolution, prompt expansion toggle, negative prompt, audio file upload.

Props include: `onError` callback for FileUpload error handling.

### 2.8 Update `ai-image-tab.tsx` to use new components
**~5 min**

**File:** `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-image-tab.tsx` (~400 lines remaining)

Changes:
- Import 7 new model settings components
- Replace inline JSX blocks with component renders:
  ```tsx
  {isViduQ2Selected && <AiViduQ2Settings duration={duration} ... />}
  ```
- Keep: `AIImageTabProps` interface, model selection booleans, config lookups, image upload, prompt input, advanced options
- Move model-specific cost calculations into respective components

---

## Existing Directory Structure

The `ai/components/` directory already exists with 4 files:
- `ai-history-panel.tsx`
- `ai-image-upload.tsx`
- `ai-settings-panel.tsx`
- `ai-select-fields.tsx`

The 7 new files follow the same naming convention.

---

## Unit Tests

### New tests

**File:** `apps/web/src/components/editor/media-panel/views/ai/components/__tests__/ai-model-settings.test.tsx`

| Test Case | Description |
|-----------|-------------|
| `AiViduQ2Settings renders duration select` | Mount component, assert duration select present |
| `AiViduQ2Settings calls setDuration on change` | Simulate select change, assert callback called |
| `AiKlingV25Settings renders CFG slider` | Mount component, assert slider rendered |
| `AiSeedanceSettings renders end frame upload` | Mount component, assert FileUpload present |
| `AiWan25Settings renders audio upload` | Mount component, assert audio FileUpload present |
| `Each component renders without crash` | Render each component with minimal props, no errors |

**Test approach:** Use `@testing-library/react` with mock props. Each component is pure UI — no store or hook dependencies.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Props interface explosion (7 new interfaces) | Each component uses 8–17 focused props — manageable and type-safe |
| Shared UI patterns duplicated | All common components (Select, Label, Slider) are shadcn imports — no duplication |
| `isCompact` prop threading | Simple boolean prop, same pattern used by existing `ai-settings-panel.tsx` |
| FileUpload `onError` handling (Seedance, WAN) | Pass `onError` as callback prop from parent |

---

## Verification Checklist

- [ ] `bun run check-types` — no new type errors
- [ ] `bun lint:clean` — no lint violations
- [ ] `bun run test` — new tests pass
- [ ] Smoke test: `bun run electron:dev` → AI Image tab → each model's settings render correctly
- [ ] All 7 model conditional renders still gated by same boolean logic
