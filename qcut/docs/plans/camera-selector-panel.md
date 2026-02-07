# Camera Selector Panel — Implementation Plan

## Overview

Integrate the [camera-selector](https://github.com/donghaozhang/camera-selector) project as a new **"Camera"** panel in QCut's media panel system. This panel provides a virtual cinema camera configurator — letting users select camera body, lens, focal length, and aperture for AI video generation workflows.

The original project is vanilla HTML/CSS/JS. We will rewrite it as a React component following QCut's existing panel patterns: Zustand store, Tailwind CSS, TypeScript, horizontal scroll tracks with snap scrolling.

**Estimated effort**: ~45 minutes → broken into 6 subtasks.

---

## Subtask 1: Copy image assets into the project

**Time**: ~2 min

Copy the 20 `.webp` image files from the cloned camera-selector repo into QCut's public assets directory.

### Files to create

| File | Description |
|------|-------------|
| `apps/web/public/images/camera-selector/*.webp` | All 20 image assets (cameras, lenses, apertures) |

### Steps

1. Create directory `apps/web/public/images/camera-selector/`
2. Copy all `.webp` files from the cloned repo's `images/` folder

---

## Subtask 2: Create the camera selector Zustand store

**Time**: ~5 min

Create a dedicated store for camera selector state, holding the selected indices for camera, lens, focal length, and aperture. Also export the static data arrays as typed constants.

### Files to create

| File | Description |
|------|-------------|
| `apps/web/src/stores/camera-selector-store.ts` | Zustand store + static data constants |

### Data model

```typescript
// Camera body
interface CameraBody {
  name: string;
  type: "DIGITAL" | "FILM";
  img: string;
}

// Lens
interface Lens {
  name: string;
  type: "SPHERICAL" | "ANAMORPHIC" | "SPECIAL";
  img: string;
}

// Aperture
interface ApertureOption {
  label: string;
  img: string;
}

// Store state
interface CameraSelectorState {
  cameraIndex: number;
  lensIndex: number;
  focalIndex: number;
  apertureIndex: number;
  setCameraIndex: (i: number) => void;
  setLensIndex: (i: number) => void;
  setFocalIndex: (i: number) => void;
  setApertureIndex: (i: number) => void;
}
```

### Static data

Export `CAMERAS`, `LENSES`, `FOCAL_LENGTHS`, `APERTURE_OPTIONS` arrays with image paths pointing to `/images/camera-selector/`.

---

## Subtask 3: Create the CameraSelectorView panel component

**Time**: ~15 min

Build the main panel view as a React component with 4 horizontal scroll tracks matching the original UI. Use Tailwind CSS (no custom CSS file needed — the original styles map cleanly to Tailwind utilities).

### Files to create

| File | Description |
|------|-------------|
| `apps/web/src/components/editor/media-panel/views/camera-selector/index.tsx` | Re-export |
| `apps/web/src/components/editor/media-panel/views/camera-selector/camera-selector-view.tsx` | Main panel component |
| `apps/web/src/components/editor/media-panel/views/camera-selector/scroll-track.tsx` | Reusable horizontal scroll track component |

### Component architecture

```
CameraSelectorView
├── CurrentSetupDisplay (header: selected camera image + focal length)
├── ScrollTrack — CAMERA (6 items)
├── ScrollTrack — LENS (11 items)
├── ScrollTrack — FOCAL LENGTH (4 items)
└── ScrollTrack — APERTURE (3 items)
```

### Key implementation details

- **ScrollTrack** — generic component: horizontal flex with `overflow-x-auto`, `scroll-snap-type: x mandatory`, `scroll-snap-align: center` on items. Converts vertical wheel to horizontal scroll. Accepts `items`, `selectedIndex`, `onSelect`, and a `renderItem` prop.
- **Selected state** — green border (`border-emerald-500/60`), darker green background, slight scale-up.
- **Current setup display** — shows selected camera thumbnail + focal length number in a rounded card at the top.
- **No "Save setup" button** — the state is already persisted in the Zustand store. We may add saved presets in a future iteration.
- **No tabs** (All/Recommended/Saved) — the original tabs were non-functional; skip them for now.

---

## Subtask 4: Register the panel in the media panel system

**Time**: ~5 min

Wire the new panel into QCut's 3-file panel registration system.

### Files to modify

| File | Change |
|------|--------|
| `apps/web/src/components/editor/media-panel/store.ts` | Add `"camera-selector"` to `Tab` union type + add entry in `tabs` record with `CameraIcon` from lucide-react |
| `apps/web/src/components/editor/media-panel/index.tsx` | Import `CameraSelectorView` and add to `viewMap` |

### Tab config

```typescript
"camera-selector": {
  icon: CameraIcon,  // from lucide-react
  label: "Camera",
},
```

Position: after `"ai"` (AI Video) since camera settings are related to AI video generation.

---

## Subtask 5: Write unit tests

**Time**: ~10 min

### Files to create

| File | Description |
|------|-------------|
| `apps/web/src/components/editor/media-panel/views/camera-selector/__tests__/camera-selector.test.tsx` | Component render + interaction tests |
| `apps/web/src/stores/__tests__/camera-selector-store.test.ts` | Store state management tests |

### Store tests (`camera-selector-store.test.ts`)

1. **Initial state** — verify default indices (camera=0, lens=0, focal=3, aperture=0)
2. **setCameraIndex** — updates camera index
3. **setLensIndex** — updates lens index
4. **setFocalIndex** — updates focal index
5. **setApertureIndex** — updates aperture index
6. **Data constants** — verify CAMERAS has 6 entries, LENSES has 11, FOCAL_LENGTHS has 4, APERTURE_OPTIONS has 3

### Component tests (`camera-selector.test.tsx`)

1. **Renders panel** — `data-testid="camera-selector-panel"` is in the document
2. **Renders all 4 section labels** — CAMERA, LENS, FOCAL LENGTH, APERTURE
3. **Renders correct number of items** — 6 cameras, 11 lenses, 4 focal lengths, 3 apertures
4. **Selection updates on click** — clicking a camera item updates the selected state
5. **Current setup display** — shows the selected camera image and focal length

---

## Subtask 6: Update documentation

**Time**: ~3 min

### Files to modify

| File | Change |
|------|--------|
| `docs/technical/media-panel-reference.md` | Add Camera Selector panel entry (panel #21) |

### Documentation content

- Panel name, tab key, icon
- Purpose: Virtual cinema camera configuration for AI video workflows
- Components: CameraSelectorView, ScrollTrack
- Store: useCameraSelectorStore
- Data: 6 cameras, 11 lenses, 4 focal lengths, 3 apertures

---

## File Summary

### New files (8)

| # | File | Subtask |
|---|------|---------|
| 1 | `apps/web/public/images/camera-selector/*.webp` (20 images) | 1 |
| 2 | `apps/web/src/stores/camera-selector-store.ts` | 2 |
| 3 | `apps/web/src/components/editor/media-panel/views/camera-selector/index.tsx` | 3 |
| 4 | `apps/web/src/components/editor/media-panel/views/camera-selector/camera-selector-view.tsx` | 3 |
| 5 | `apps/web/src/components/editor/media-panel/views/camera-selector/scroll-track.tsx` | 3 |
| 6 | `apps/web/src/components/editor/media-panel/views/camera-selector/__tests__/camera-selector.test.tsx` | 5 |
| 7 | `apps/web/src/stores/__tests__/camera-selector-store.test.ts` | 5 |

### Modified files (3)

| # | File | Subtask |
|---|------|---------|
| 1 | `apps/web/src/components/editor/media-panel/store.ts` | 4 |
| 2 | `apps/web/src/components/editor/media-panel/index.tsx` | 4 |
| 3 | `docs/technical/media-panel-reference.md` | 6 |

---

## Future considerations

- **Integration with AI video generation** — The camera/lens/focal/aperture settings could feed into AI video model prompts (e.g., "Shot on Red V-Raptor with Cooke S4 lens at 35mm f/4"). This would require wiring the store into the AI generation pipeline.
- **Saved presets** — Allow users to save and recall camera setups (the original had a cosmetic "Save" button).
- **Custom entries** — Let users add custom camera/lens configurations.
- **Keyboard navigation** — Add arrow key support for scroll tracks (accessibility).
