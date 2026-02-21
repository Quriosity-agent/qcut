# Moyin Integration: Storyboard Grid Generator

> **Date:** 2026-02-22
> **Feature:** Port Moyin's storyboard grid generation and image splitting system into QCut
> **Phase:** 2 (UI Integration)
> **Priority:** P2
> **Est. total effort:** ~2 hours (4 subtasks)
> **Depends on:** [moyin-03-cinematography-presets.md](moyin-03-cinematography-presets.md), [moyin-05-moyin-panel-tab.md](moyin-05-moyin-panel-tab.md)
> **Parent:** [moyin-creator-integration-plan.md](moyin-creator-integration-plan.md)

---

## Summary

Port Moyin's storyboard system that generates N×N contact sheet images from scene descriptions, then splits them into individual frames. This enables batch generation of multiple scene images in a single API call (cheaper and more consistent than individual calls), followed by automatic extraction of individual frames.

### How it works

```
Scene descriptions (N scenes)
  → Grid calculator (compute optimal N×N layout)
  → Prompt builder (compose multi-scene prompt)
  → AI image generation (single API call → contact sheet)
  → Image splitter (detect grid lines → extract individual cells)
  → N individual scene images
```

---

## Architecture Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | `apps/web/src/lib/moyin/storyboard/` | Self-contained module with clear boundaries |
| Image splitting | Client-side Canvas API | No Electron IPC needed; runs in renderer process |
| AI generation | QCut's existing `window.electronAPI.aiPipeline.generate()` | Reuse existing image generation infrastructure |
| Output | Individual images added to `media-store` | Standard QCut media pipeline |

---

## Implementation Status

| Subtask | Status | Est. |
|---------|--------|------|
| 1. Port grid calculator | Pending | 20 min |
| 2. Port prompt builder | Pending | 25 min |
| 3. Port image splitter | Pending | 35 min |
| 4. Add unit tests | Pending | 40 min |

---

## Subtask 1: Port Grid Calculator

**Priority:** P1
**Est. time:** 20 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/storyboard/grid-calculator.ts`

### Target files
- `apps/web/src/lib/moyin/storyboard/grid-calculator.ts` (NEW)
- `apps/web/src/lib/moyin/storyboard/index.ts` (NEW — barrel export)

### Key exports to port

```typescript
interface GridCalculatorInput {
  sceneCount: number
  aspectRatio: AspectRatio
  targetResolution?: Resolution
}

interface GridConfig {
  rows: number
  cols: number
  cellWidth: number
  cellHeight: number
  totalWidth: number
  totalHeight: number
}

type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4"
type Resolution = "1K" | "2K" | "4K"

calculateGrid(input: GridCalculatorInput): GridConfig
validateSceneCount(count: number): boolean
getRecommendedResolution(sceneCount: number): Resolution
RESOLUTION_PRESETS: Record<Resolution, { width: number; height: number }>
SCENE_LIMITS: { min: number; max: number }
```

### Adaptation needed
- Remove `category` parameter from `validateSceneCount()` (moyin-specific)
- Keep resolution presets and grid math as-is

---

## Subtask 2: Port Prompt Builder

**Priority:** P1
**Est. time:** 25 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/storyboard/prompt-builder.ts`

### Target files
- `apps/web/src/lib/moyin/storyboard/prompt-builder.ts` (NEW)

### Key exports to port

```typescript
interface CharacterInfo {
  name: string
  appearance: string
  consistencyAnchors?: string  // from character bible
}

interface StoryboardPromptConfig {
  scenes: Array<{
    description: string
    location: string
    characters: string[]
  }>
  characters: CharacterInfo[]
  gridConfig: GridConfig
  styleId: string
  cinematographyProfileId?: string
}

buildStoryboardPrompt(config: StoryboardPromptConfig): string
buildRegenerationPrompt(config: StoryboardPromptConfig): string
getDefaultNegativePrompt(): string
```

### Adaptation needed
- Replace `getStyleTokensFromPreset()` (deprecated in moyin) with `getStylePrompt()` from visual-styles
- Use `buildCinematographyGuidance()` from cinematography-profiles for camera language

---

## Subtask 3: Port Image Splitter

**Priority:** P1
**Est. time:** 35 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/storyboard/image-splitter.ts`

### Target files
- `apps/web/src/lib/moyin/storyboard/image-splitter.ts` (NEW)

### Key exports to port

```typescript
interface SplitOptions {
  gridConfig?: GridConfig       // known grid layout
  autoDetect?: boolean          // auto-detect grid lines
  trimWhitespace?: boolean      // trim empty borders
  minCellSize?: number          // minimum cell size in pixels
}

interface SplitResult {
  cells: Array<{
    index: number
    canvas: HTMLCanvasElement
    dataUrl: string
    x: number
    y: number
    width: number
    height: number
    isEmpty: boolean
  }>
  detectedGrid: GridConfig
}

splitStoryboardImage(imageData: ImageData, options: SplitOptions): Promise<SplitResult>
loadImage(source: string | File | Blob): Promise<HTMLImageElement>
detectGrid(imageData: ImageData): GridConfig
trimCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement
isCellEmpty(imageData: ImageData, x: number, y: number, w: number, h: number): boolean
```

### How auto-detection works
1. `getEnergyProfile()` — compute pixel energy along rows/columns
2. `findSegments()` — find low-energy bands (grid lines) using threshold
3. `detectGrid()` — combine row/column segments into `GridConfig`
4. Split image using detected cell boundaries

### Adaptation needed
- This module uses Canvas API — runs entirely in the browser renderer process
- No IPC or Electron dependency
- Copy as-is; only verify that `HTMLCanvasElement` and `ImageData` types work in QCut's Vite build

---

## Subtask 4: Unit Tests

**Priority:** P2
**Est. time:** 40 min

### Target files
- `apps/web/src/lib/moyin/storyboard/__tests__/grid-calculator.test.ts` (NEW)
- `apps/web/src/lib/moyin/storyboard/__tests__/prompt-builder.test.ts` (NEW)
- `apps/web/src/lib/moyin/storyboard/__tests__/image-splitter.test.ts` (NEW)

### Test coverage

**grid-calculator.test.ts:**
- `calculateGrid({ sceneCount: 4, aspectRatio: "16:9" })` → `{ rows: 2, cols: 2 }`
- `calculateGrid({ sceneCount: 9, aspectRatio: "16:9" })` → `{ rows: 3, cols: 3 }`
- `calculateGrid({ sceneCount: 1, aspectRatio: "16:9" })` → `{ rows: 1, cols: 1 }`
- `validateSceneCount(0)` → `false`
- `validateSceneCount(25)` → boundary test
- `getRecommendedResolution(4)` → `"2K"`

**prompt-builder.test.ts:**
- `buildStoryboardPrompt()` — includes all scene descriptions in output
- `buildStoryboardPrompt()` — includes character appearance info
- `buildStoryboardPrompt()` — includes grid layout instruction (e.g., "2x2 grid")
- `buildStoryboardPrompt()` — includes style tokens from selected style
- `getDefaultNegativePrompt()` — returns non-empty string

**image-splitter.test.ts:**
- `detectGrid()` — detects 2x2 grid from synthetic ImageData
- `isCellEmpty()` — returns true for all-white region
- `isCellEmpty()` — returns false for region with content
- `trimCanvas()` — removes whitespace borders

Note: Canvas-based tests require `jsdom` or a canvas mock. Use `vi.mock` for `HTMLCanvasElement` if needed, or use `@napi-rs/canvas` for Node.js canvas support in tests.

---

## Integration with Moyin Tab (Phase 2)

Once this module is ported, the `GenerateActions` component in the Moyin tab (see [moyin-05-moyin-panel-tab.md](moyin-05-moyin-panel-tab.md)) will:

1. Call `calculateGrid()` with scene count from parsed screenplay
2. Call `buildStoryboardPrompt()` with scenes, characters, and selected style
3. Send prompt to `window.electronAPI.aiPipeline.generate({ command: "generate-image", ... })`
4. On completion, call `splitStoryboardImage()` to extract individual scene images
5. Add each cell to `media-store` via `addMediaItem()`

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| `storyboard-service.ts` | Orchestration layer — belongs in moyin-store, not the library |
| `scene-prompt-generator.ts` | Moyin-specific scene prompt format — use `buildStoryboardPrompt()` instead |
| Video generation from storyboard | Handled by existing AI Video tab in Phase 3 |
