# Phase 5: Split `preview-panel.tsx` (1228 → ~650)

**Risk Level:** Medium-High — 6 store dependencies, multiple memoized values, render helpers
**Estimated Time:** ~35 minutes

## Overview

`PreviewPanel` is a large React component with three extractable areas:
1. **Sizing/layout hooks** (lines 175-253, ~80 lines) — `ResizeObserver` + dimension calculations
2. **Media source hooks** (lines 570-643, ~75 lines) — caption segments, blur background, video sources
3. **Element renderer** (lines 733-1070, ~340 lines) — `renderElement()` function handling text/markdown/media/remotion

The core component keeps store selectors, drag state, and main JSX.

## Source File

`apps/web/src/components/editor/preview-panel.tsx` — 1228 lines

### Current Structure

| Section | Lines | Description |
|---------|------:|-------------|
| Imports & types | 1-67 | 6 stores, 10+ components, utilities |
| `useEffectsRendering` hook | 70-111 | CSS filter computation |
| Component start + selectors | 114-173 | Store selectors, refs, state |
| **Sizing effect** | **175-253** | **ResizeObserver + dimension calc** |
| Keyboard effect | 255-273 | Escape key handler |
| **Drag handling effect** | 275-345 | **Text element drag (stays)** |
| Event handlers | 347-400 | mouseDown, expand, capture |
| Seek event effect | 402-419 | Custom seek event listener |
| **Active elements memo** | **421-468** | **Time-based element filtering** |
| Timeline elements memo | 471-473 | Flat list |
| Seek detection effect | 475-484 | Seek event flag |
| **Frame cache warming** | **487-531** | **Pre-render nearby frames** |
| Transform handler | 534-567 | Interactive overlay updates |
| **Caption segments memo** | **570-598** | **Captions extraction** |
| **Blur background memo** | **601-643** | **Blur source selection** |
| **Blur background render** | **646-727** | **Background blur layer** |
| Remotion logging ref | 730-751 | Spam prevention |
| **`renderElement()`** | **733-1070** | **Element type rendering (340 lines)** |
| Error/loading states | 1077-1109 | Conditional returns |
| Main render JSX | 1111-1228 | Container + composition |

Bold = extraction targets.

---

## New Files

### 1. `apps/web/src/components/editor/preview-panel/use-preview-sizing.ts` (~90 lines)

**Contents:** Preview dimension calculation hook.

```typescript
export function usePreviewSizing(
  containerRef: React.RefObject<HTMLDivElement>,
  canvasSize: { width: number; height: number },
  isExpanded: boolean
): { width: number; height: number }
```

| Section | Current Lines | Description |
|---------|--------------|-------------|
| ResizeObserver setup | 175-207 | Container size detection |
| Aspect ratio calculation | 209-219 | Fit canvas to container |
| Window resize listener | 221-243 | Fullscreen-only listener |
| Cleanup | 244-253 | Observers and listeners |

**Dependencies:**
- React `useEffect`, `useState`
- No store dependencies — pure DOM measurement

### 2. `apps/web/src/components/editor/preview-panel/use-preview-media.ts` (~160 lines)

**Contents:** Media-related memoized computations.

```typescript
export function usePreviewMedia(
  activeElements: ActiveElement[],
  mediaItems: MediaItem[],
  activeProject: Project | null
): {
  captionSegments: TranscriptionSegment[]
  blurBackgroundElements: ActiveElement[]
  videoSourcesById: Map<string, string>
  activeVideoSource: string | null
  blurBackgroundSource: string | null
  currentMediaElement: ActiveElement | null
}
```

| Function | Current Lines | Description |
|----------|--------------|-------------|
| `captionSegments` memo | 570-598 | Extract caption data from active elements |
| `blurBackgroundElements` memo | 601-609 | Filter eligible blur elements |
| `videoSourcesById` memo | 612-629 | Cache video blob URLs |
| `activeVideoSource` memo | 632-635 | Current video source |
| `blurBackgroundSource` memo | 638-643 | Blur layer source |
| `currentMediaElement` derivation | 459-468 | First active video element |

**Dependencies:**
- `getVideoSource` from `@/lib/media-source`
- `TEST_MEDIA_ID` from `@/constants/timeline-constants`
- Type imports for `ActiveElement`, `MediaItem`, `TranscriptionSegment`

### 3. `apps/web/src/components/editor/preview-panel/preview-element-renderer.tsx` (~350 lines)

**Contents:** The `renderElement()` function as a standalone component or render function.

```typescript
interface ElementRendererProps {
  elementData: ActiveElement
  index: number
  previewDimensions: { width: number; height: number }
  canvasSize: { width: number; height: number }
  currentTime: number
  filterStyle: string
  hasEnabledEffects: boolean
  videoSourcesById: Map<string, string>
  currentMediaElement: ActiveElement | null
  selectedElementId: string | null
  onTextMouseDown: (e: React.MouseEvent, element: ..., trackId: string) => void
  onElementSelect: (elementId: string) => void
}

export function PreviewElementRenderer(props: ElementRendererProps): React.ReactNode | null
```

| Section | Current Lines | Description |
|---------|--------------|-------------|
| Text elements | 754-822 | Positioned text with drag/select |
| Markdown elements | 824-869 | Markdown overlay positioning |
| Media: test/missing | 873-886 | Gradient placeholder |
| Media: video | 888-933 | VideoPlayer with effects filter |
| Media: image (positioned) | 938-998 | Draggable image/sticker |
| Media: image (full-bleed) | 1001-1014 | Background image |
| Media: audio | 1018-1031 | AudioPlayer (invisible) |
| Remotion elements | 1035-1067 | RemotionPreview with frame sync |
| Blur background | 646-727 | Background blur layer (separate render helper) |

**Dependencies:**
- `VideoPlayer`, `AudioPlayer` components
- `MarkdownOverlay` component
- `RemotionPreview` component
- `FONT_CLASS_MAP` from font config
- `debugLog` from debug config

---

## What Stays in `preview-panel.tsx` (~650 lines)

| Section | Lines | Description |
|---------|------:|-------------|
| Imports | ~50 | + imports from new modules |
| `useEffectsRendering` hook | ~42 | CSS filter computation (stays — used by main component) |
| `ActiveElement` interface | ~5 | Type export |
| Component + store selectors | ~60 | 6 store destructurings |
| Refs + local state | ~30 | 5 refs, 4 state vars |
| Keyboard effect | ~20 | Escape handler |
| Drag handling effect | ~70 | Text element drag (tightly coupled to refs) |
| Event handlers | ~55 | mouseDown, expand, capture, transform |
| Seek effects | ~30 | Seek event tracking |
| Active elements memo | ~40 | Time-based filtering (feeds into extracted hooks) |
| Frame cache warming | ~45 | Pre-render effect |
| Remotion logging ref | ~22 | Spam prevention |
| Error/loading states | ~35 | Conditional returns |
| Main render JSX | ~120 | Container + composition using extracted renderer |

The main component calls the extracted hooks and passes results to the renderer:

```typescript
const previewDimensions = usePreviewSizing(containerRef, canvasSize, isExpanded)
const { captionSegments, blurBackgroundElements, videoSourcesById, ... } = usePreviewMedia(
  activeElements, mediaItems, activeProject
)

// In JSX
{activeElements.map((el, i) => (
  <PreviewElementRenderer
    key={el.element.id}
    elementData={el}
    index={i}
    previewDimensions={previewDimensions}
    canvasSize={canvasSize}
    currentTime={currentTime}
    filterStyle={filterStyle}
    videoSourcesById={videoSourcesById}
    ...
  />
))}
```

---

## Implementation Steps

### Step 1: Create `use-preview-sizing.ts`

1. Create `apps/web/src/components/editor/preview-panel/use-preview-sizing.ts`
2. Move the sizing effect (lines 175-253) into a custom hook
3. The hook takes `containerRef`, `canvasSize`, `isExpanded` and returns dimensions
4. Move `previewDimensions` state into the hook
5. Import in main component, replace inline effect

**Files:** `preview-panel/use-preview-sizing.ts`, `preview-panel.tsx`

### Step 2: Create `use-preview-media.ts`

1. Create `apps/web/src/components/editor/preview-panel/use-preview-media.ts`
2. Move memoized computations:
   - `captionSegments` (lines 570-598)
   - `blurBackgroundElements` (lines 601-609)
   - `videoSourcesById` (lines 612-629)
   - `activeVideoSource` (lines 632-635)
   - `blurBackgroundSource` (lines 638-643)
   - `currentMediaElement` derivation (lines 459-468)
3. Bundle into single hook returning all values
4. Import in main component

**Files:** `preview-panel/use-preview-media.ts`, `preview-panel.tsx`

### Step 3: Create `preview-element-renderer.tsx`

1. Create `apps/web/src/components/editor/preview-panel/preview-element-renderer.tsx`
2. Move `renderElement()` function (lines 733-1070)
3. Move `renderBlurBackground()` function (lines 646-727)
4. Convert to a React component with explicit props
5. Import component-level dependencies (`VideoPlayer`, `AudioPlayer`, `MarkdownOverlay`, `RemotionPreview`)
6. Import in main component, replace inline `renderElement` call in JSX

**Files:** `preview-panel/preview-element-renderer.tsx`, `preview-panel.tsx`

### Step 4: Update `preview-panel.tsx`

1. Remove moved code
2. Add imports from 3 new modules
3. Replace inline hooks with extracted hook calls
4. Replace `renderElement` calls with `<PreviewElementRenderer>` component
5. Keep `useEffectsRendering` in main file (it's only 42 lines and exported)

### Step 5: Verify

1. Check that `preview-panel-components.ts` (already exists) doesn't conflict with new directory
2. Verify no circular imports between new hooks and main component
3. Test all element types render correctly

---

## Subtasks

### Subtask 5.1: Extract `usePreviewSizing` hook (~10 min)
**Files:** `preview-panel/use-preview-sizing.ts`, `preview-panel.tsx`
- Move ResizeObserver effect + state
- Hook returns `{ width, height }`
- Verify preview dimensions update on container resize and fullscreen toggle

### Subtask 5.2: Extract `usePreviewMedia` hook (~10 min)
**Files:** `preview-panel/use-preview-media.ts`, `preview-panel.tsx`
- Move 6 memoized values into single hook
- Hook takes `activeElements`, `mediaItems`, `activeProject`
- Returns all media-related computed values

### Subtask 5.3: Extract `PreviewElementRenderer` (~15 min)
**Files:** `preview-panel/preview-element-renderer.tsx`, `preview-panel.tsx`
- Largest extraction (340 lines + 80 lines blur background)
- Convert render function to React component
- Pass all dependencies as props (no store hooks inside)
- Test each element type: text, markdown, video, image, audio, remotion

---

## Risks

| Risk | Mitigation |
|------|------------|
| 6 store hooks in main component | Hooks stay in main component — only computed values extracted |
| `renderElement` uses component-level state | Pass as props to renderer component |
| `handleTextMouseDown` callback in renderer | Pass as `onTextMouseDown` prop |
| `currentMediaElement` used for effects filter | Computed in `usePreviewMedia`, passed to renderer |
| `previewDimensions` used in multiple places | Returned from `usePreviewSizing`, passed as prop |
| ResizeObserver cleanup | Stays within the extracted hook — proper cleanup lifecycle |
| Memoization dependencies change | Same deps, just moved to hook — `useMemo` behavior identical |
| Blur background render | Moved to renderer component — same conditional logic |

## Verification

```bash
bun check-types
bun lint:clean
bun run test
bun run electron:dev
```

## Test Scenarios

- [ ] Video preview plays correctly
- [ ] Image elements display and are draggable
- [ ] Text elements display with correct fonts and are draggable
- [ ] Markdown overlays render
- [ ] Sticker canvas renders on top
- [ ] Captions display during playback
- [ ] Blur background effect works
- [ ] Fullscreen mode works (Expand button + Escape to exit)
- [ ] Preview dimensions update on window resize
- [ ] Effects filter (brightness/contrast) applies to video
- [ ] Remotion elements render with frame sync
- [ ] Audio elements are invisible but functional
- [ ] Interactive element overlay works (if EFFECTS_ENABLED)
