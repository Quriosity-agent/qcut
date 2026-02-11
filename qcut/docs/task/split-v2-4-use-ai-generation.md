# Subtask V2-4: Continue Split `use-ai-generation.ts` (1428 → ~700 + extracted hooks)

**Parent Plan:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md)
**Phase:** 4
**Estimated Effort:** 30-40 minutes
**Risk Level:** Medium-High — hook state interdependencies, closure-heavy polling logic, and large return-object contract

---

## Goal

Continue the partial extraction from Round 1. Move settings builders, response handlers (already partially done), polling logic, and mock generation out of the main hook. Reduce `use-ai-generation.ts` from 1428 to ~700 lines.

---

## Current State

**Already extracted** to `use-ai-generation-helpers.ts` (583 lines):
- Pure utilities: `getSafeDuration`, `downloadVideoToMemory`, `uploadImageToFal`, `uploadAudioToFal`
- Validation: `validateGenerationInputs`, `validateTextTab`, `validateImageTab`, `validateAvatarTab`
- Settings builders: `buildUnifiedParams`, `getModelCapabilities`
- Response handlers: `processModelResponse`, `handleDirectWithJobResponse`, `handleJobIdOnlyResponse`, `handleDirectVideoResponse`, `classifyResponse`

**Still inline** in main hook (needs extraction):
- `startStatusPolling` (lines 345-523, ~178 lines)
- `handleMockGenerate` (lines 526-662, ~136 lines)
- Veo 3.1 state + setters (lines 216-234, 1172-1197)
- Reve Edit state + handlers (lines 237-243, 1202-1249)

---

## Files Involved

| File | Action |
|------|--------|
| `.../hooks/use-ai-generation.ts` | **Edit** — remove extracted code, import from new files |
| `.../hooks/use-ai-generation-helpers.ts` | **No change** — already has Groups 1-4 |
| `.../hooks/use-ai-polling.ts` | **Create** — polling logic as custom hook |
| `.../hooks/use-ai-mock-generation.ts` | **Create** — mock generation as standalone function |
| `.../hooks/use-veo31-state.ts` | **Create** — Veo 3.1 state + setters as custom hook |
| `.../hooks/use-reve-edit-state.ts` | **Create** — Reve Edit state + handlers as custom hook |

> Base path: `apps/web/src/components/editor/media-panel/views/ai/hooks`

### Consumer File

| File | Import |
|------|--------|
| `.../views/ai/index.tsx:36` | `import { useAIGeneration } from "./hooks/use-ai-generation"` |

The consumer imports `useAIGeneration` which returns a massive object. As long as the return shape is identical, no consumer changes needed.
Also preserve `export type UseAIGenerationReturn = ReturnType<typeof useAIGeneration>` for type-level compatibility.

---

## Subtask Breakdown

### Subtask 4a: Extract `use-ai-polling.ts` (~25 min)

**New file:** `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-polling.ts` (~180 lines)

Extract `startStatusPolling` (lines 345-523) into a custom hook.

**Challenge:** This function uses 10+ state setters as closures:
- `setGenerationProgress`, `setStatusMessage`, `setElapsedTime`
- `setJobId`, `setGeneratedVideo`, `setGeneratedVideos`
- `setPollingInterval`, `setIsGenerating`, `setCurrentModelIndex`
- `setProgressLogs`

**Pattern:** Pass state setters via a callbacks object:

```typescript
// use-ai-polling.ts
import type { Dispatch, SetStateAction } from "react";
import type { GeneratedVideo, GeneratedVideoResult } from "../../types/ai-types";

export interface PollingCallbacks {
  setGenerationProgress: (p: number) => void;
  setStatusMessage: (m: string) => void;
  setProgressLogs: Dispatch<SetStateAction<string[]>>;
  setJobId: (id: string | null) => void;
  setGeneratedVideo: (v: GeneratedVideo | null) => void;
  setGeneratedVideos: Dispatch<SetStateAction<GeneratedVideoResult[]>>;
  setIsGenerating: (g: boolean) => void;
  setPollingInterval: (i: ReturnType<typeof setInterval> | null) => void;
  onError?: (error: string) => void;
  onComplete?: () => void;
}

export interface PollingContext {
  prompt: string;
  selectedModels: string[];
  activeProject: { id: string } | null;
  addMediaItem: ((...args: any[]) => Promise<void>) | undefined;
}

export function createStatusPoller(
  callbacks: PollingCallbacks,
  ctx: PollingContext
) {
  return async function startStatusPolling(jobId: string): Promise<void> {
    // Exact same body from lines 345-523
    // Replace closure refs with callbacks.setX and ctx.Y
  };
}
```

Prefer implementing this as `useAIPolling(...)` that returns `startStatusPolling` and handles cleanup, rather than invoking a factory during render.

**In main hook:**
```typescript
import { createStatusPoller } from "./use-ai-polling";

const startStatusPolling = useCallback(
  createStatusPoller(
    { setGenerationProgress, setStatusMessage, ... },
    { prompt, selectedModels, activeProject, addMediaItem }
  ),
  [prompt, selectedModels, activeProject, addMediaItem]
);
```

### Subtask 4b: Extract `use-ai-mock-generation.ts` (~10 min)

**New file:** `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-mock-generation.ts` (~140 lines)

Extract `handleMockGenerate` (lines 526-662) as a standalone function.

**Pattern:** Takes explicit params instead of closing over hook state:

```typescript
// use-ai-mock-generation.ts
import type { Dispatch, SetStateAction } from "react";

export interface MockGenerationParams {
  prompt: string;
  selectedModels: string[];
  activeTab: string;
  selectedImage: File | null;
  avatarImage: File | null;
  audioFile: File | null;
  sourceVideo: File | null;
  activeProject: { id: string } | null;
}

export interface MockGenerationCallbacks {
  setIsGenerating: (g: boolean) => void;
  setGenerationProgress: (p: number) => void;
  setStatusMessage: (m: string) => void;
  setGeneratedVideo: (v: GeneratedVideo | null) => void;
  setGeneratedVideos: Dispatch<SetStateAction<GeneratedVideoResult[]>>;
  setGenerationStartTime: (t: number | null) => void;
  addMediaItem: ((...args: any[]) => Promise<void>) | undefined;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

export async function handleMockGenerate(
  params: MockGenerationParams,
  callbacks: MockGenerationCallbacks
): Promise<void> { ... }
```

### Subtask 4c: Extract `use-veo31-state.ts` (~10 min)

**New file:** `apps/web/src/components/editor/media-panel/views/ai/hooks/use-veo31-state.ts` (~80 lines)

Extract Veo 3.1 state (lines 216-234) and setters (lines 1172-1197):

```typescript
// use-veo31-state.ts
export interface Veo31Settings {
  resolution: string;
  duration: number;
  aspectRatio: string;
  generateAudio: boolean;
  enhancePrompt: boolean;
  autoFix: boolean;
}

export function useVeo31State() {
  const [veo31Settings, setVeo31Settings] = useState<Veo31Settings>({ ... });
  const [firstFrame, setFirstFrame] = useState<File | null>(null);
  const [lastFrame, setLastFrame] = useState<File | null>(null);

  const setVeo31Resolution = useCallback((r: string) => { ... }, []);
  const setVeo31Duration = useCallback((d: number) => { ... }, []);
  const setVeo31AspectRatio = useCallback((a: string) => { ... }, []);
  const setVeo31GenerateAudio = useCallback((g: boolean) => { ... }, []);
  const setVeo31EnhancePrompt = useCallback((e: boolean) => { ... }, []);
  const setVeo31AutoFix = useCallback((a: boolean) => { ... }, []);

  return {
    veo31Settings, firstFrame, lastFrame,
    setFirstFrame, setLastFrame,
    setVeo31Resolution, setVeo31Duration, setVeo31AspectRatio,
    setVeo31GenerateAudio, setVeo31EnhancePrompt, setVeo31AutoFix,
  };
}
```

### Subtask 4d: Extract `use-reve-edit-state.ts` (~10 min)

**New file:** `apps/web/src/components/editor/media-panel/views/ai/hooks/use-reve-edit-state.ts` (~70 lines)

Extract Reve Edit state (lines 237-243) and handlers (lines 1202-1249):

```typescript
// use-reve-edit-state.ts
export function useReveEditState() {
  const [uploadedImageForEdit, setUploadedImageForEdit] = useState<File | null>(null);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

  const clearUploadedImageForEdit = useCallback(() => { ... }, [uploadedImagePreview]);
  const handleImageUploadForEdit = useCallback(async (file: File) => { ... }, [clearUploadedImageForEdit]);

  return {
    uploadedImageForEdit, uploadedImagePreview, uploadedImageUrl,
    clearUploadedImageForEdit, handleImageUploadForEdit,
  };
}
```

---

## What Stays in `use-ai-generation.ts` (~700 lines)

| Section | Lines | Description |
|---------|-------|-------------|
| Imports | 11-58 | + new imports from extracted hooks |
| Props destructuring | 67-175 | All props (unchanged) |
| Core state (22 useStates → ~12) | 178-213 | Without Veo31/Reve state |
| Composing extracted hooks | — | `useVeo31State()`, `useReveEditState()` |
| Effects (5 useEffects) | 265-330 | Unchanged |
| Stable callback wrappers | 333-343 | Unchanged |
| `handleGenerate` | 665-1136 | Main generation (calls extracted helpers) |
| `resetGenerationState` | 1139-1169 | Simplified (delegates Veo31/Reve resets) |
| Return object | 1252-1425 | Spreads results from extracted hooks |

---

## Implementation Steps

1. Create `use-veo31-state.ts` — simplest, no deps on other state.
2. Create `use-reve-edit-state.ts` — simple, isolated state.
3. Create `use-ai-mock-generation.ts` — standalone function, no hook state.
4. Create `use-ai-polling.ts` — most complex, depends on many setters.
5. Update `use-ai-generation.ts`:
   - Import and compose all extracted hooks
   - Replace inline code with calls to extracted functions
   - Verify return object shape unchanged
6. Add/adjust contract tests to lock public return keys and polling semantics before cleanup.

---

## Verification

```bash
# Type check
bun run check-types

# Existing helper tests
bun x vitest run apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-ai-generation-helpers.test.ts

# Lint
bun lint:clean

# Smoke test: open AI panel, test text/image/avatar generation
bun run electron:dev
```

---

## Unit Tests

### `__tests__/use-veo31-state.test.ts`

| Test Case | What It Validates |
|-----------|-------------------|
| `useVeo31State returns default settings` | Initial state |
| `setVeo31Resolution updates correctly` | Setter function |
| `setFirstFrame/setLastFrame update correctly` | Frame state |

### `__tests__/use-reve-edit-state.test.ts`

| Test Case | What It Validates |
|-----------|-------------------|
| `useReveEditState returns null defaults` | Initial state |
| `clearUploadedImageForEdit resets all 3 fields` | Clear logic |

### `__tests__/use-ai-polling.test.ts`

| Test Case | What It Validates |
|-----------|-------------------|
| `createStatusPoller returns a function` | Factory pattern |
| `startStatusPolling calls setStatusMessage` | Callback wiring |
| `startStatusPolling clears previous interval and resolves once` | Polling lifecycle parity |
| `startStatusPolling polls immediately before interval` | Existing behavior parity |

### `__tests__/use-ai-mock-generation.test.ts`

| Test Case | What It Validates |
|-----------|-------------------|
| `handleMockGenerate validates inputs` | Validation |
| `handleMockGenerate calls onComplete` | Callback wiring |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Polling uses 10+ state setters | Bundle into `PollingCallbacks` interface; pass once |
| Polling lifecycle regression (double intervals, unresolved promise) | Add parity tests for clear-before-start, immediate first poll, and single resolve |
| `handleGenerate` deps array changes | Extracted helpers are stable; deps shrink |
| Composing 4 hooks changes render behavior | Each hook is a simple `useState` wrapper; no extra renders |
| Reset semantics drift during extraction | Keep current behavior exactly unless product intentionally changes UX; lock with tests |
| Return object shape drift | TypeScript enforces return shape; any missing field is a compile error |

---

## Review Comments (LTS + No-Breaking-Change Focus)

1. Keep `use-ai-generation.ts` as the public entrypoint  
Treat `use-ai-polling.ts`, `use-ai-mock-generation.ts`, `use-veo31-state.ts`, and `use-reve-edit-state.ts` as internal modules. Avoid adding direct imports from UI files to internal split modules.

2. Preserve return-object API exactly  
`index.tsx` uses many fields (`handleGenerate`, `canGenerate`, `veo31Settings`, `setVeo31Resolution`, `handleImageUploadForEdit`, etc.). Add a contract test that asserts required keys exist to prevent accidental breaking changes.

3. Preserve polling behavior verbatim  
Current behavior includes immediate first poll, interval polling, clear previous interval before start, clear interval on completion/failure, and resolve-once promise behavior. Keep this unchanged when extracting.

4. Reuse existing validation helpers in mock generation  
`handleMockGenerate` currently duplicates tab validation logic. Prefer calling `validateGenerationInputs` to reduce drift between mock and real flows over time.

5. Preserve Reve Edit object URL lifecycle  
Keep current `clearUploadedImageForEdit` behavior and ensure preview URLs are revoked on cleanup paths to avoid leaks during long editing sessions.
