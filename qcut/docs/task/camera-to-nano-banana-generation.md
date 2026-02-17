# Plan: Camera Selector → Prompt → Nano Banana Pro Image Generation

Connect the existing Camera Equipment Selector UI to a prompt builder that generates cinematic camera descriptions, then sends them to Nano Banana Pro for text-to-image generation.

## Current State

- **Camera Selector**: Fully built UI + Zustand store (`useCameraSelectorStore`), but not connected to any generation pipeline.
- **Nano Banana Pro**: Working text-to-image (`FalAiService.generateImage`) and image-to-image (`FalAiService.editImages`) via `fal-ai/nano-banana`.
- **Gap**: No bridge between camera selection → prompt string → Nano Banana generation.

---

## Architecture

```
Camera Selector UI (existing)
  → useCameraSelectorStore (existing)
    → buildCameraPrompt() (NEW)
      → "Generate" button in Camera Selector panel (NEW)
        → FalAiService.generateImage(prompt) (existing)
          → Result display + add to media library (NEW)
```

---

## Subtasks

### Subtask 1: Create Camera Prompt Builder Utility

**~5 min** | Pure function, no side effects.

Create a utility that reads current camera store selections and produces a cinematic prompt string.

**Example output:**
> "Cinematic shot on Red V-Raptor with Cooke S4 spherical lens at 35mm f/1.4, shallow depth of field, digital cinema look, professional cinematography"

**Prompt composition rules:**
- Camera body → `"shot on {name}"` + type flavor (`"digital cinema look"` / `"organic film grain"`)
- Lens → `"with {name} {type} lens"` + lens character (e.g. anamorphic → `"horizontal lens flare, oval bokeh"`)
- Focal length → `"{N}mm"` + perspective description (`8mm` = ultra-wide, `50mm` = natural perspective)
- Aperture → `"f/{N}"` + depth description (`f/1.4` = shallow DoF, `f/11` = deep focus)

**Files:**
| Action | File |
|--------|------|
| CREATE | `apps/web/src/lib/camera-prompt-builder.ts` |

**Interface:**
```typescript
export interface CameraPromptOptions {
  cameraIndex: number;
  lensIndex: number;
  focalIndex: number;
  apertureIndex: number;
  /** Optional user subject/scene appended to the camera prompt */
  subject?: string;
}

export function buildCameraPrompt(options: CameraPromptOptions): string;
```

---

### Subtask 2: Add Generate Button and Result Display to Camera Selector View

**~15 min** | Wire the prompt builder + FalAiService into the existing camera selector panel.

Add to the bottom of the existing `CameraSelectorView`:
1. An optional subject/scene text input (e.g. "a woman walking through rain")
2. A "Generate with Camera" button
3. A loading state while generating
4. Result image display with "Add to Media" action

**Files:**
| Action | File |
|--------|------|
| EDIT | `apps/web/src/components/editor/media-panel/views/camera-selector/camera-selector-view.tsx` |

**Key integration points:**
- Read store: `useCameraSelectorStore()` (existing, line 98 of store)
- Build prompt: `buildCameraPrompt()` (from Subtask 1)
- Generate: `FalAiService.generateImage(prompt)` (existing, `services/ai/fal-ai-service.ts:136`)
- Add to library: `useAsyncMediaStoreActions().addMediaItem()` (existing pattern from `NanoEditMain.tsx`)

**UX flow:**
1. User selects camera body, lens, focal length, aperture (existing)
2. User optionally types a scene description
3. User clicks "Generate"
4. Prompt is built: camera settings + subject
5. Nano Banana Pro generates the image
6. Result shown inline; user can add to project media

---

### Subtask 3: Add `getCameraPrompt` Selector to Camera Store

**~3 min** | Expose a derived prompt string directly from the store.

Add a convenience selector so any component can get the current camera prompt without importing the builder separately.

**Files:**
| Action | File |
|--------|------|
| EDIT | `apps/web/src/stores/camera-selector-store.ts` |

**Changes:**
- Import `buildCameraPrompt` from Subtask 1
- Add `getCameraPrompt(subject?: string): string` as a derived method on the store
- Keep the store under 120 lines

---

### Subtask 4: Unit Tests for Camera Prompt Builder

**~10 min** | Test all prompt generation paths.

**Files:**
| Action | File |
|--------|------|
| CREATE | `apps/web/src/lib/__tests__/camera-prompt-builder.test.ts` |

**Test cases:**
- Default selections produce a valid prompt string containing camera name, lens name, focal length, aperture
- Each camera body type produces correct flavor text (DIGITAL vs FILM)
- Each lens type produces correct characteristics (SPHERICAL vs ANAMORPHIC vs SPECIAL)
- Each focal length produces correct perspective description
- Each aperture produces correct depth-of-field description
- Subject is appended when provided
- Subject is omitted cleanly when empty/undefined
- All index boundary values (first/last camera, lens, etc.)

---

### Subtask 5: Unit Tests for Camera Selector Generate Flow

**~10 min** | Test the new generation integration in the view.

**Files:**
| Action | File |
|--------|------|
| EDIT | `apps/web/src/components/editor/media-panel/views/camera-selector/__tests__/camera-selector.test.tsx` |

**Test cases:**
- Generate button renders and is enabled
- Subject input accepts text
- Clicking generate calls `FalAiService.generateImage` with correct prompt
- Loading state shows during generation
- Result image displays after generation
- Error state renders on failure
- "Add to Media" button works after generation

---

## File Summary

| File | Action | Subtask |
|------|--------|---------|
| `apps/web/src/lib/camera-prompt-builder.ts` | CREATE | 1 |
| `apps/web/src/stores/camera-selector-store.ts` | EDIT | 3 |
| `apps/web/src/components/editor/media-panel/views/camera-selector/camera-selector-view.tsx` | EDIT | 2 |
| `apps/web/src/lib/__tests__/camera-prompt-builder.test.ts` | CREATE | 4 |
| `apps/web/src/components/editor/media-panel/views/camera-selector/__tests__/camera-selector.test.tsx` | EDIT | 5 |

## Dependencies

```
Subtask 1 (prompt builder)
  ↓
Subtask 3 (store selector) ←── depends on 1
  ↓
Subtask 2 (UI integration) ←── depends on 1, 3
  ↓
Subtask 4 (builder tests) ←── depends on 1
  ↓
Subtask 5 (view tests) ←── depends on 2
```

## Design Decisions

1. **Pure function over store logic** — `buildCameraPrompt()` is a stateless utility, not baked into the store. Easier to test and reuse (e.g. AI video prompt injection later).
2. **Inline result in Camera Selector panel** — No new route or modal. Keeps the feature self-contained within the existing panel.
3. **Optional subject field** — Camera-only prompts work standalone ("cinematic shot on..."), but users can add a scene for more control.
4. **Nano Banana text-to-image** — Uses existing `FalAiService.generateImage()` endpoint. No new API integration needed.
5. **No new store** — Reuses `useCameraSelectorStore` + `useAsyncMediaStoreActions`. Minimal state surface.
