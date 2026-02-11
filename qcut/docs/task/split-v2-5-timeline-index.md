# Subtask V2-5: Split `timeline/index.tsx` (1584 → ~400 + components)

**Parent Plan:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md)
**Phase:** 5 (execute last)
**Estimated Effort:** 30-40 minutes
**Risk Level:** High — shared refs, drag state, complex render tree, 15+ refs

---

## Goal

Extract `TimelineToolbar` (already a separate component) and drag handlers into their own files. Reduce `timeline/index.tsx` from 1584 to ~400 lines while preserving all timeline functionality.

---

## Files Involved

| File | Action |
|------|--------|
| `.../timeline/index.tsx` | **Edit** — keep main Timeline component |
| `.../timeline/timeline-toolbar.tsx` | **Create** — TimelineToolbar component |
| `.../timeline/timeline-drag-handlers.ts` | **Create** — drag/drop hook |
| `.../timeline/track-icon.tsx` | **Create** — TrackIcon utility component |

> Base path: `apps/web/src/components/editor/timeline`

### Consumer File

| File | Import |
|------|--------|
| `apps/web/src/components/editor/panel-layouts.tsx:11` | `import { Timeline } from "./timeline"` |

Only 1 consumer imports the `Timeline` component. All sub-components are internal.

---

## Subtask Breakdown

### Subtask 5a: Extract `timeline-toolbar.tsx` (~20 min)

**New file:** `apps/web/src/components/editor/timeline/timeline-toolbar.tsx` (~480 lines)

Move the entire `TimelineToolbar` component (lines 1106-1584).

**Props interface (shared between Timeline and Toolbar):**

```typescript
// timeline-toolbar.tsx
interface TimelineToolbarProps {
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
}
```

Timeline currently passes these as props (line 654):
```tsx
<TimelineToolbar zoomLevel={zoomLevel} setZoomLevel={setZoomLevel} />
```

**Contents to move:**
| Section | Lines | Description |
|---------|-------|-------------|
| Component declaration | 1106-1112 | Props destructuring |
| Store selectors | 1114-1144 | 30 store hooks (all independent — each file reads from stores directly) |
| Action handlers | 1147-1300 | Split, duplicate, freeze, delete, zoom, bookmark, scene handlers |
| Render | 1301-1583 | Full toolbar JSX (playback, tools, settings, zoom) |

**Imports to add** (from original file's imports):
```typescript
import { useTimelineStore } from "@/stores/timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useProjectStore } from "@/stores/project-store";
import { useSceneStore } from "@/stores/scene-store";
import { ScenesView } from "../scenes-view";
import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "../../ui/tooltip";
import { SplitButton, SplitButtonLeft, SplitButtonRight, SplitButtonSeparator } from "../../ui/split-button";
import { Slider } from "@/components/ui/slider";
import { Scissors, ArrowLeftToLine, ArrowRightToLine, Trash2, Snowflake, Copy,
  SplitSquareHorizontal, Pause, Play, Magnet, Link, ZoomIn, ZoomOut, Bookmark,
  LayersIcon, Sparkles } from "lucide-react";
import { toast } from "sonner";
```

**No shared refs.** TimelineToolbar does not receive any refs from Timeline — it reads directly from Zustand stores.

### Subtask 5b: Extract `timeline-drag-handlers.ts` (~15 min)

**New file:** `apps/web/src/components/editor/timeline/timeline-drag-handlers.ts` (~180 lines)

Extract drag handler functions (lines 365-546) into a custom hook.

**Functions to extract:**
| Function | Lines | Description |
|----------|-------|-------------|
| `handleDragEnter` | 365-376 | Increment counter, set `isDragOver` |
| `handleDragOver` | 378-380 | Prevent default |
| `handleDragLeave` | 382-394 | Decrement counter, clear `isDragOver` |
| `handleDrop` | 396-539 | Process dropped media/stickers/files |
| `dragProps` | 541-546 | Object consolidating all handlers |

**Hook interface:**

```typescript
// timeline-drag-handlers.ts
import type { DragData, TimelineTrack } from "@/types/timeline";

interface UseDragHandlersParams {
  tracks: TimelineTrack[];
  addMediaItem: ((...args: any[]) => Promise<void>) | undefined;
  activeProject: { id: string } | null;
  zoomLevel: number;
  seek: (time: number) => void;
  setDuration: (d: number) => void;
  addTrack?: (type: string) => void;
  addElementToTrack?: (...args: any[]) => void;
}

interface UseDragHandlersReturn {
  isDragOver: boolean;
  isProcessing: boolean;
  progress: number;
  dragProps: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

export function useDragHandlers(params: UseDragHandlersParams): UseDragHandlersReturn {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const dragCounterRef = useRef(0);

  // ... handlers using params instead of closures
}
```

**Refs needed:** `dragCounterRef` (line 127) — moves into the hook. The parent doesn't need this ref.

**Store access inside `handleDrop`:**
- `useTimelineStore.getState()` (line 438) — direct store access, not a hook
- `useAsyncMediaStore` actions — pass via params

### Subtask 5c: Extract `track-icon.tsx` (~5 min)

**New file:** `apps/web/src/components/editor/timeline/track-icon.tsx` (~20 lines)

Move `TrackIcon` (lines 1087-1104) to its own file.

```typescript
// track-icon.tsx
import { Video, TypeIcon, Music, Sticker } from "lucide-react";

interface TrackIconProps {
  type: string;
}

export function TrackIcon({ type }: TrackIconProps) {
  switch (type) {
    case "media": return <Video className="h-3.5 w-3.5" />;
    case "text": return <TypeIcon className="h-3.5 w-3.5" />;
    case "audio": return <Music className="h-3.5 w-3.5" />;
    case "sticker": return <Sticker className="h-3.5 w-3.5" />;
    default: return <Video className="h-3.5 w-3.5" />;
  }
}
```

Used by: Timeline track labels (line 920 area) only. Import in `index.tsx`.

---

## What Stays in `timeline/index.tsx` (~400 lines)

| Section | Lines | Description |
|---------|-------|-------------|
| Imports | 1-81 | Reduced (toolbar imports removed) |
| Store selectors | 92-121 | Timeline, media, playback, project stores |
| Refs | 127-189 | 13 refs (minus `dragCounterRef` moved to drag hook) |
| Computed values | 148-209 | `dynamicBuffer`, `dynamicTimelineWidth`, frame cache, playhead, selection box, snap |
| `handleSnapPointChange` | 212-214 | Snap callback |
| `handleTimelineMouseDown` | 217-233 | Mouse tracking for click detection |
| `handleTimelineContentClick` | 236-354 | Timeline click → seek |
| Composed hooks | — | `useDragHandlers(...)`, `useTimelineZoom(...)`, etc. |
| Duration effect | 358-361 | Update timeline duration |
| Scroll sync effect | 549-625 | Ruler/tracks/labels sync |
| Render | 628-1084 | Main JSX (imports `TimelineToolbar`, `TrackIcon`) |

---

## Implementation Steps

1. **Create `track-icon.tsx`** — simplest, zero dependencies.
2. **Create `timeline-toolbar.tsx`** — already a separate component, just move + add imports.
3. **Create `timeline-drag-handlers.ts`** — extract `useDragHandlers` hook.
4. **Update `timeline/index.tsx`**:
   - Remove `TimelineToolbar` component code (lines 1106-1584)
   - Remove `TrackIcon` component code (lines 1087-1104)
   - Remove drag handler code (lines 365-546)
   - Add imports: `import { TimelineToolbar } from "./timeline-toolbar"`
   - Add imports: `import { TrackIcon } from "./track-icon"`
   - Add imports: `import { useDragHandlers } from "./timeline-drag-handlers"`
   - Compose `useDragHandlers` hook and use returned `dragProps`
5. **Clean up unused imports** from `index.tsx` (icons, UI components only used by toolbar).

---

## Verification

```bash
# Type check
bun run check-types

# Lint
bun lint:clean

# Smoke test: full timeline interaction
bun run electron:dev
# Test: drag & drop media, toolbar buttons, split/delete, zoom, scroll sync
```

---

## Unit Tests

### `__tests__/timeline-toolbar.test.tsx`

| Test Case | What It Validates |
|-----------|-------------------|
| `TimelineToolbar renders with play button` | Basic render |
| `TimelineToolbar shows zoom controls` | Zoom UI |
| `TimelineToolbar split button calls splitElement` | Split action |

### `__tests__/timeline-drag-handlers.test.ts`

| Test Case | What It Validates |
|-----------|-------------------|
| `useDragHandlers returns dragProps object with 4 handlers` | Hook shape |
| `handleDragEnter sets isDragOver to true` | Drag enter |
| `handleDragLeave with counter=0 clears isDragOver` | Drag leave logic |
| `handleDrop processes media drag data` | Drop handler |

### `__tests__/track-icon.test.tsx`

| Test Case | What It Validates |
|-----------|-------------------|
| `TrackIcon renders Video for "media" type` | Icon mapping |
| `TrackIcon renders Music for "audio" type` | Icon mapping |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Shared refs between Timeline and Toolbar | No refs are shared — toolbar reads from stores directly |
| Drag handlers use `useTimelineStore.getState()` | Direct store access works in extracted hook; no props needed |
| Scroll sync effect references `rulerScrollRef`, `tracksScrollRef` | These refs stay in Timeline; not used by extracted components |
| `TrackIcon` used in track labels area only | Import from `./track-icon` in `index.tsx` |
| `handleDrop` calls `createObjectURL`, `generateUUID` | Import these utilities directly in `timeline-drag-handlers.ts` |
| `handleDrop` accesses `addMediaItem` from async media store | Pass via hook params; already destructured in Timeline |
| 30+ imports in `index.tsx` become split across files | Each file imports only what it needs; cleaner dependency tree |
