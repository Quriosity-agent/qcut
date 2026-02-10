# SHOTS — Cinematic Angles Tab Integration

> **Goal**: Add a 5th AI tab ("Angles") that generates 9 cinematic camera perspectives from a single image, with optional 4K upscaling via existing upscale infrastructure.

## Source Reference

- **Repository**: [donghaozhang/shots-app](https://github.com/donghaozhang/shots-app)
- **Concept**: Upload one image → generate 9 camera angles (Front, Front-Left 45°, Left 90°, Back-Left 135°, Back 180°, Back-Right 225°, Right 270°, Front-Right 315°, Top-Down) → select favorites → upscale to 4K

## Current Architecture Context

The AI panel (`apps/web/src/components/editor/media-panel/views/ai/index.tsx`) uses a 4-tab layout:

| Tab | Purpose | Tab Type |
|-----|---------|----------|
| Text | Text-to-video | `text` |
| Image | Image-to-video | `image` |
| Avatar | Character animation | `avatar` |
| Upscale | Video upscaling | `upscale` |

Tabs are driven by `AIActiveTab` in `types/ai-types.ts` and stored in `useMediaPanelStore` (`store.ts`). Models are registered in `constants/ai-constants.ts` with per-category filtering. Generation is routed through `hooks/generation/model-handlers.ts`.

---

## Implementation Plan

**Estimated total time**: ~45 minutes (5 subtasks)

---

### Subtask 1: Extend Tab Type System & Store (5 min)

Add `"angles"` to the tab union and update the store + grid layout.

**Files to modify**:

1. **`apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts:385`**
   - Change `AIActiveTab` from `"text" | "image" | "avatar" | "upscale"` to include `"angles"`:
     ```ts
     export type AIActiveTab = "text" | "image" | "avatar" | "upscale" | "angles";
     ```

2. **`apps/web/src/components/editor/media-panel/store.ts:210-211`**
   - Update `aiActiveTab` type in the store interface:
     ```ts
     aiActiveTab: "text" | "image" | "avatar" | "upscale" | "angles";
     setAiActiveTab: (tab: "text" | "image" | "avatar" | "upscale" | "angles") => void;
     ```

3. **`apps/web/src/components/editor/media-panel/views/ai/index.tsx:567`**
   - Change `grid-cols-4` → `grid-cols-5` in the `TabsList`
   - Add 5th `TabsTrigger` for `"angles"` with `Focus` or `Aperture` icon from lucide-react

4. **`apps/web/src/components/editor/media-panel/views/ai/index.tsx:950-969`**
   - Add filter case for `activeTab === "angles"` to show angle-category models in the model selection grid

**Tests**:
- `apps/web/src/components/editor/media-panel/views/ai/__tests__/ai-tab-types.test.ts` — verify `"angles"` is a valid `AIActiveTab`
- Verify store accepts and persists `"angles"` tab state

---

### Subtask 2: Register Angle Generation Models (10 min)

Define the model configuration for cinematic angle generation. Since shots-app is currently a UI prototype, we need to back it with an actual FAL.ai model. The best fit is **Seeddream 4.5** for multi-angle image generation (9 images from 1 prompt) or a dedicated image-variation model.

**Approach**: Use FAL.ai's image generation endpoint with angle-specific prompts derived from the source image. Each angle is generated as a separate image generation call with a perspective-modified prompt.

**Files to modify / create**:

1. **`apps/web/src/components/editor/media-panel/views/ai/constants/angles-config.ts`** (new)
   ```ts
   export const CINEMATIC_ANGLES = [
     { id: "front", label: "Front", angle: 0, prompt_suffix: "front view, direct frontal perspective" },
     { id: "front_left_45", label: "Front-Left 45°", angle: 45, prompt_suffix: "45-degree left angle view" },
     { id: "left_90", label: "Left 90°", angle: 90, prompt_suffix: "left side profile view" },
     { id: "back_left_135", label: "Back-Left 135°", angle: 135, prompt_suffix: "back-left diagonal view" },
     { id: "back_180", label: "Back 180°", angle: 180, prompt_suffix: "rear view, from behind" },
     { id: "back_right_225", label: "Back-Right 225°", angle: 225, prompt_suffix: "back-right diagonal view" },
     { id: "right_270", label: "Right 270°", angle: 270, prompt_suffix: "right side profile view" },
     { id: "front_right_315", label: "Front-Right 315°", angle: 315, prompt_suffix: "front-right diagonal view" },
     { id: "top_down", label: "Top-Down", angle: -1, prompt_suffix: "overhead aerial top-down view" },
   ] as const;

   export type CinematicAngleId = typeof CINEMATIC_ANGLES[number]["id"];
   ```

2. **`apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`**
   - Add angle-category model entries to `AI_MODELS` array:
     ```ts
     {
       id: "shots_cinematic_angles",
       name: "SHOTS Cinematic Angles",
       description: "Generate 9 cinematic camera angles from a single image",
       price: "0.40",
       resolution: "1080p",
       max_duration: 0,
       category: "angles",
       endpoints: { text_to_video: "fal-ai/seeddream-4.5" },
       default_params: {},
       requiredInputs: ["sourceImage"],
     }
     ```

3. **`apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts:84`**
   - Add `"angles"` to `ModelCategory`:
     ```ts
     export type ModelCategory = "text" | "image" | "video" | "avatar" | "upscale" | "angles";
     ```

**Tests**:
- `apps/web/src/components/editor/media-panel/views/ai/__tests__/angles-config.test.ts` — validate all 9 angles have unique IDs, labels, and prompt suffixes

---

### Subtask 3: Build the Angles Tab UI Component (15 min)

Create the tab component with image upload, angle grid, selection, and upscale controls.

**Files to create**:

1. **`apps/web/src/components/editor/media-panel/views/ai/tabs/ai-angles-tab.tsx`** (new)

   **UI Structure**:
   ```
   AIAnglesTab
   ├── Source Image Upload (reuse AIImageUpload component)
   ├── Optional Prompt (for describing the subject)
   ├── Generate All Angles Button
   ├── 3×3 Angle Grid (9 cells)
   │   ├── Each cell: thumbnail + angle label + checkbox for selection
   │   └── Loading spinner per-cell during generation
   ├── Selected Count Badge
   └── Upscale Selected Button (routes to existing upscale pipeline)
   ```

   **Props**:
   ```ts
   interface AIAnglesTabProps {
     sourceImage: File | null;
     sourceImagePreview: string | null;
     onSourceImageChange: (file: File | null, preview: string | null) => void;
     prompt: string;
     onPromptChange: (prompt: string) => void;
     selectedModels: string[];
     isCompact: boolean;
     onError: (error: string | null) => void;
   }
   ```

   **Key behaviors**:
   - Upload source image via existing `AIImageUpload` component
   - Optional text prompt describing the subject
   - "Generate All Angles" dispatches 9 parallel image generation calls
   - 3×3 CSS grid displays results with click-to-toggle selection
   - Selected images can be exported or sent to the upscale tab
   - Generation progress shown per-angle (independent progress bars)

2. **`apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-angles-tab-state.ts`** (new)

   **State managed**:
   ```ts
   interface AnglesTabState {
     sourceImage: File | null;
     sourceImagePreview: string | null;
     generatedAngles: Record<CinematicAngleId, { url: string; selected: boolean } | null>;
     isGenerating: boolean;
     generatingAngles: Set<CinematicAngleId>;  // which angles are currently generating
     prompt: string;
   }
   ```

**Files to modify**:

3. **`apps/web/src/components/editor/media-panel/views/ai/index.tsx`**
   - Import and render `AIAnglesTab` inside a new `<TabsContent value="angles">`
   - Import and use `useAnglesTabState` hook
   - Wire source image and generation state

**Tests**:
- `apps/web/src/components/editor/media-panel/views/ai/__tests__/ai-angles-tab.test.tsx`
  - Renders upload area when no image selected
  - Shows 3×3 grid after generation
  - Toggles selection on click
  - Disables generate button when no image uploaded
  - Shows per-angle loading states

---

### Subtask 4: Implement Angle Generation Logic (10 min)

Create the generator function that takes a source image + prompt and produces 9 angle variations using FAL.ai's image generation API.

**Files to create**:

1. **`apps/web/src/lib/ai-video/generators/angles.ts`** (new)

   **Core function**:
   ```ts
   export async function generateCinematicAngles(
     request: {
       sourceImageUrl: string;
       prompt: string;
       angles: CinematicAngleId[];
     },
     onProgress?: (angleId: CinematicAngleId, status: "generating" | "complete" | "error") => void,
   ): Promise<Record<CinematicAngleId, string>>
   ```

   **Implementation approach**:
   - Upload source image to FAL via `uploadImageToFal()` from `core/fal-upload.ts`
   - For each selected angle, construct a prompt: `"${userPrompt}, ${angle.prompt_suffix}, consistent style and subject"`
   - Call FAL.ai Seeddream 4.5 endpoint (or image-variation endpoint) for each angle
   - Run up to 3 calls concurrently (batched with `Promise.allSettled`)
   - Report per-angle progress via callback
   - Return map of angle ID → generated image URL

2. **`apps/web/src/components/editor/media-panel/views/ai/hooks/generation/angle-handlers.ts`** (new)
   - `handleShotsCinematicAngles(ctx, settings)` — model handler following existing pattern
   - Integrates with model-handlers.ts dispatch

**Files to modify**:

3. **`apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`**
   - Add import and case for `shots_cinematic_angles` model ID
   - Route to `handleShotsCinematicAngles`

4. **`apps/web/src/lib/ai-video/index.ts`**
   - Export `generateCinematicAngles` from barrel

**Tests**:
- `apps/web/src/lib/ai-video/generators/__tests__/angles.test.ts`
  - Mocks FAL request, verifies 9 calls made with correct prompts
  - Verifies progress callback called for each angle
  - Handles partial failures gracefully (some angles fail, others succeed)

---

### Subtask 5: Upscale Integration & Download (5 min)

Allow selected angle images to be upscaled via the existing upscale pipeline or downloaded directly.

**Files to modify**:

1. **`apps/web/src/components/editor/media-panel/views/ai/tabs/ai-angles-tab.tsx`**
   - Add "Download Selected" button that creates a zip or downloads individual images
   - Add "Upscale Selected" button that:
     - Switches to the upscale tab via `setAiActiveTab("upscale")`
     - Passes selected image URLs to the upscale workflow
   - Add "Add to Media" button that imports selected images into the project media store

2. **`apps/web/src/components/editor/media-panel/views/ai/index.tsx`**
   - Wire angle tab's upscale action to switch tabs and pre-populate upscale inputs

**Tests**:
- `apps/web/src/components/editor/media-panel/views/ai/__tests__/ai-angles-tab-actions.test.ts`
  - Download triggers for each selected angle
  - Upscale navigation switches to upscale tab
  - Add to Media calls the media store import function

---

## File Summary

### New Files (6)
| File | Purpose |
|------|---------|
| `views/ai/constants/angles-config.ts` | 9 angle definitions with prompt suffixes |
| `views/ai/tabs/ai-angles-tab.tsx` | Angles tab UI component |
| `views/ai/hooks/use-ai-angles-tab-state.ts` | Angles tab state hook |
| `views/ai/hooks/generation/angle-handlers.ts` | Model handler for angle generation |
| `lib/ai-video/generators/angles.ts` | Core generation logic (FAL.ai calls) |
| `views/ai/__tests__/ai-angles-tab.test.tsx` | Tab component tests |

### Modified Files (7)
| File | Change |
|------|--------|
| `views/ai/types/ai-types.ts` | Add `"angles"` to `AIActiveTab` and `ModelCategory` |
| `media-panel/store.ts` | Add `"angles"` to `aiActiveTab` type |
| `views/ai/index.tsx` | Add 5th tab trigger, content, model filter case |
| `views/ai/constants/ai-constants.ts` | Register angle model in `AI_MODELS` |
| `views/ai/hooks/generation/model-handlers.ts` | Add angle handler dispatch |
| `lib/ai-video/index.ts` | Export angle generator |
| `lib/ai-video/generators/__tests__/angles.test.ts` | Generator unit tests |

---

## Architecture Decisions

1. **Image generation, not CSS transforms**: Unlike the prototype shots-app which uses CSS filters, QCut integrates with FAL.ai for real AI-powered perspective generation. This produces genuinely different viewpoints rather than visual approximations.

2. **Parallel batch generation**: 9 angles are generated concurrently (3 at a time to respect rate limits) rather than sequentially, reducing total wait time from ~18s to ~6s.

3. **Reuse existing components**: `AIImageUpload` for the source image, existing FAL upload/polling infrastructure, and the upscale pipeline for 4K enhancement. No new infrastructure needed.

4. **Per-angle progress tracking**: Unlike other tabs that show a single progress bar, the angles tab shows 9 individual progress indicators in the grid, giving users immediate feedback as each angle completes.

5. **Flat pricing model**: Single flat price for all 9 angles, consistent with how other non-per-second models (Kling v3, etc.) are priced in QCut.

---

## Future Considerations

- **Custom angle selection**: Allow users to generate only specific angles instead of all 9
- **Consistency mode**: Use image-to-image with ControlNet for better subject consistency across angles
- **Video from angles**: Select multiple angles and generate a rotating camera video using I2V models
- **Batch export**: Export all angles as a contact sheet or zip file
