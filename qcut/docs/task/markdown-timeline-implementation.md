# Markdown Timeline Element — Implementation Plan

## Overview

Add a new **"markdown"** timeline element type that renders rich Markdown content (headings, bold, italic, lists, code blocks, links) directly on the video canvas. Duration is adjustable from **2 minutes (120s) to 2 hours (7,200s)**, enabling long-form content like tutorials, presentations, and educational videos.

This extends the existing timeline architecture by adding a `MarkdownElement` alongside the current `TextElement`, keeping plain-text fast for short overlays while Markdown handles structured, long-duration content.

## Current State

- **TextElement** — plain text, explicit formatting props (`fontSize`, `fontFamily`, etc.), default 5s duration
- **Timeline max export** — 600s (10 min) in `timeline-constants.ts`
- **No markdown parser** in the project today
- **Duration formula** — `element.duration - trimStart - trimEnd`

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Markdown parser | `react-markdown` + `remark-gfm` | React-native rendering, GFM tables/checkboxes, lightweight (~12KB) |
| New element type vs extend Text | New `"markdown"` type | Clean separation — no regression risk on existing text elements |
| Duration range | 120s–7,200s (configurable) | Covers 2 min–2 hr per requirements |
| Canvas rendering | HTML overlay div with `react-markdown` | Matches existing text overlay pattern; avoidscustom canvas drawing |
| Export rendering | Puppeteer/HTML-to-image snapshot per frame range | Consistent Markdown fidelity in final video |

---

## Implementation Subtasks

### Task 1: Add Markdown Element Type (10 min)

**Files to modify:**
- `apps/web/src/types/timeline.ts`

**Changes:**
```typescript
// Add to TimelineElementType union
export type TimelineElementType = "media" | "text" | "audio" | "sticker" | "captions" | "remotion" | "markdown";

// New interface
export interface MarkdownElement extends BaseTimelineElement {
  type: "markdown";
  /** Raw markdown string */
  markdownContent: string;
  /** Rendered style options */
  theme: "light" | "dark" | "transparent";
  fontSize: number;
  fontFamily: string;
  padding: number;
  backgroundColor: string;
  textColor: string;
  /** Scroll behavior for long content */
  scrollMode: "static" | "auto-scroll";
  /** Scroll speed in px/second (only when scrollMode = "auto-scroll") */
  scrollSpeed: number;
}

// Update TimelineElement union
export type TimelineElement = MediaElement | TextElement | StickerElement | CaptionElement | RemotionElement | MarkdownElement;
```

**Acceptance criteria:**
- TypeScript compiles with new type
- Existing element types unaffected

---

### Task 2: Update Timeline Constants for Extended Duration (10 min)

**Files to modify:**
- `apps/web/src/constants/timeline-constants.ts`

**Changes:**
```typescript
// Add markdown-specific constants
MARKDOWN_MIN_DURATION: 120,          // 2 minutes
MARKDOWN_MAX_DURATION: 7200,         // 2 hours
MARKDOWN_DEFAULT_DURATION: 300,      // 5 minutes
DEFAULT_EMPTY_TIMELINE_DURATION: 600, // Bump to 10 min (was 5 min) to accommodate markdown
MAX_EXPORT_DURATION: 7200,           // Bump to 2 hours (was 10 min)
```

Update `TRACK_HEIGHTS`:
```typescript
markdown: 55, // Similar to remotion — needs content preview space
```

Update track ordering in `TRACK_TYPE_ORDER`:
```typescript
markdown: 2.5, // Between captions (2) and remotion (3)
```

**Acceptance criteria:**
- Constants compile and are importable
- Existing duration calculations still work (they use `Math.max` so larger max is safe)

---

### Task 3: Install Markdown Dependencies (5 min)

**Commands:**
```bash
bun add react-markdown remark-gfm
bun add -d @types/react-markdown  # if needed
```

**Acceptance criteria:**
- `react-markdown` and `remark-gfm` importable in `apps/web`

---

### Task 4: Create Markdown Renderer Component (30 min)

**Files to create:**
- `apps/web/src/components/editor/canvas/markdown-overlay.tsx`

**Component:** `MarkdownOverlay`
- Receives `MarkdownElement` props + current playback time
- Renders markdown via `react-markdown` with `remark-gfm`
- Supports `scrollMode: "auto-scroll"` — calculates scroll offset from `(currentTime - element.startTime) * scrollSpeed`
- Applies theme (light/dark/transparent) as CSS class
- Constrains to element `width`/`height` bounds on canvas

```typescript
interface MarkdownOverlayProps {
  element: MarkdownElement;
  currentTime: number;
  canvasScale: number;
}
```

**Acceptance criteria:**
- Renders headings, bold, italic, lists, code blocks, links, tables
- Auto-scroll moves content proportional to playback time
- Respects element positioning (x, y, width, height, rotation)

---

### Task 5: Integrate Markdown Element into Timeline Element Renderer (20 min)

**Files to modify:**
- `apps/web/src/components/editor/timeline/timeline-element.tsx`

**Changes:**
- Add `case "markdown"` to element type rendering switch
- Display truncated markdown preview (first 80 chars, strip markdown syntax) on the timeline strip
- Use a distinct color/icon for markdown track elements (e.g., blue-purple with a `FileText` icon)

**Acceptance criteria:**
- Markdown elements appear on timeline with readable preview
- Resize handles work (trim start/end)
- Duration respects 120s–7,200s bounds during resize

---

### Task 6: Integrate Markdown Element into Canvas Renderer (20 min)

**Files to modify:**
- `apps/web/src/components/editor/canvas/` — canvas overlay rendering file (where text elements are rendered on the video preview)

**Changes:**
- Import `MarkdownOverlay` component
- Add `case "markdown"` alongside existing text overlay rendering
- Pass current playback time for auto-scroll calculation
- Apply element transforms (position, size, rotation, opacity)

**Acceptance criteria:**
- Markdown renders on canvas preview during playback
- Position/size/rotation match element properties
- Auto-scroll works smoothly during playback

---

### Task 7: Create Markdown Editor Panel (30 min)

**Files to create:**
- `apps/web/src/components/editor/panels/markdown-editor-panel.tsx`

**Component:** `MarkdownEditorPanel`
- Textarea for raw markdown input (left side or full panel)
- Live preview of rendered markdown (right side or toggle)
- Theme selector (light/dark/transparent)
- Duration slider: 120s–7,200s with manual input
- Font size, font family, padding, text color controls
- Scroll mode toggle + scroll speed slider
- Background color picker

**Integration:**
- Opens in the properties panel area when a markdown element is selected
- Uses `useTimelineStore` to update element properties

**Acceptance criteria:**
- Editing markdown content updates the element in real-time
- Duration slider enforces 2 min–2 hr range
- Theme/style changes reflect on canvas immediately

---

### Task 8: Add "Add Markdown" Action to Timeline (15 min)

**Files to modify:**
- `apps/web/src/components/editor/timeline/timeline-track.tsx` — drop handler
- `apps/web/src/stores/timeline-store.ts` — `addElementToTrack` (if type-specific defaults needed)
- Timeline toolbar/add menu component (where "Add Text" exists)

**Changes:**
- Add "Add Markdown" button alongside "Add Text" in timeline toolbar
- Create default `MarkdownElement` on click:
  ```typescript
  {
    type: "markdown",
    markdownContent: "# Title\n\nStart writing...",
    duration: 300,  // 5 min default
    theme: "dark",
    fontSize: 16,
    fontFamily: "Inter",
    padding: 24,
    backgroundColor: "rgba(0,0,0,0.85)",
    textColor: "#ffffff",
    scrollMode: "static",
    scrollSpeed: 30,
  }
  ```
- Support drag-and-drop `.md` files from media panel onto timeline (detect by extension)

**Acceptance criteria:**
- New markdown element added to timeline with correct defaults
- Element appears on canvas immediately
- `.md` file drop creates markdown element with file contents

---

### Task 9: Handle Markdown in Timeline Persistence (15 min)

**Files to modify:**
- `apps/web/src/stores/timeline-store.ts` — `saveProjectTimeline()` / `loadProjectTimeline()`
- Electron IPC serialization (if timeline data passes through IPC)

**Changes:**
- Ensure `MarkdownElement` serializes/deserializes correctly (markdown string can contain special chars, newlines)
- Validate loaded markdown elements have required fields (migration safety for existing projects)
- Add default values for missing fields when loading older project files

**Acceptance criteria:**
- Save → reload preserves markdown content exactly
- Old projects without markdown elements load without errors
- Large markdown content (10KB+) serializes correctly

---

### Task 10: Handle Markdown in Video Export (30 min)

**Files to modify:**
- Export pipeline files (where text elements are rendered to final video frames)

**Changes:**
- Add markdown rendering to export frame generation
- For `static` scroll mode: render markdown as a fixed overlay for the element's duration
- For `auto-scroll` mode: calculate scroll position per frame based on `scrollSpeed`
- Ensure long durations (up to 2 hours) export correctly without memory issues
  - Render markdown overlay in chunks/segments rather than pre-rendering all frames

**Acceptance criteria:**
- Exported video includes rendered markdown overlay
- Auto-scroll maintains correct speed in export
- 2-hour export doesn't OOM (stream-based rendering)

---

### Task 11: Unit Tests (20 min)

**Files to create:**
- `apps/web/src/components/editor/canvas/__tests__/markdown-overlay.test.tsx`
- `apps/web/src/components/editor/panels/__tests__/markdown-editor-panel.test.tsx`

**Test cases:**
1. **Type safety** — `MarkdownElement` interface validates correctly
2. **Renderer** — Renders headings, lists, code blocks, links
3. **Auto-scroll** — Scroll offset = `(currentTime - startTime) * scrollSpeed`
4. **Duration bounds** — Enforces 120s min, 7200s max
5. **Theme switching** — Light/dark/transparent apply correct styles
6. **Serialization** — Markdown with special chars round-trips through save/load
7. **Empty content** — Graceful handling of empty markdown string
8. **Editor panel** — Duration slider clamped to valid range

**Acceptance criteria:**
- All tests pass via `bun run test`
- Coverage for core markdown rendering + duration validation

---

## Estimated Total Time: ~3.5 hours

| Task | Time |
|------|------|
| 1. Markdown Element Type | 10 min |
| 2. Timeline Constants | 10 min |
| 3. Install Dependencies | 5 min |
| 4. Markdown Renderer Component | 30 min |
| 5. Timeline Element Integration | 20 min |
| 6. Canvas Renderer Integration | 20 min |
| 7. Markdown Editor Panel | 30 min |
| 8. Add Markdown Action | 15 min |
| 9. Persistence | 15 min |
| 10. Video Export | 30 min |
| 11. Unit Tests | 20 min |

## File Impact Summary

| File | Action |
|------|--------|
| `apps/web/src/types/timeline.ts` | Modify — add `MarkdownElement` type |
| `apps/web/src/constants/timeline-constants.ts` | Modify — add duration constants, bump max export |
| `apps/web/src/components/editor/canvas/markdown-overlay.tsx` | **Create** — Markdown canvas renderer |
| `apps/web/src/components/editor/timeline/timeline-element.tsx` | Modify — add markdown case |
| `apps/web/src/components/editor/canvas/` (overlay render) | Modify — add markdown case |
| `apps/web/src/components/editor/panels/markdown-editor-panel.tsx` | **Create** — Editor UI |
| `apps/web/src/components/editor/timeline/timeline-track.tsx` | Modify — drop handler |
| `apps/web/src/stores/timeline-store.ts` | Modify — persistence, defaults |
| Timeline toolbar component | Modify — "Add Markdown" button |
| Export pipeline files | Modify — markdown frame rendering |
| `apps/web/src/components/editor/canvas/__tests__/markdown-overlay.test.tsx` | **Create** — Tests |
| `apps/web/src/components/editor/panels/__tests__/markdown-editor-panel.test.tsx` | **Create** — Tests |

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Long markdown content causes scroll jank | Use `will-change: transform` + virtualize if content exceeds 500 lines |
| 2-hour export OOM | Stream-based frame rendering; render markdown overlay per-segment |
| Markdown XSS in rendered content | `react-markdown` sanitizes by default; disable `rehype-raw` |
| Breaking existing text elements | Completely separate type — zero overlap with `TextElement` |
