# Timeline Clip Operations API

> Expose split/cut, select, and move clip operations through the Claude HTTP API

**Status:** Implemented
**Priority:** High
**Estimated effort:** ~30 minutes (3 subtasks)

---

## Problem

The Claude API supports basic timeline CRUD (`addElement`, `updateElement`, `removeElement`) but lacks three operations that already exist internally in the timeline store:

| Operation | Store Method Exists? | API Endpoint Exists? |
|-----------|---------------------|---------------------|
| Split/cut clip | `splitElement()` | No |
| Select clip | `selectElement()` | No |
| Move clip to track | `moveElementToTrack()` | No |

## Goal

Expose these existing store operations as new HTTP endpoints and IPC channels, following the established architecture pattern.

---

## Architecture Overview

```
HTTP (claude-http-server.ts)
  → IPC invoke (claude-timeline-handler.ts)
    → webContents.send() event to renderer
      → claude-timeline-bridge.ts listener
        → timeline-store.ts / split-operations.ts / element-operations.ts
```

---

## Subtask 1: Split/Cut Clip Endpoint

**Estimated:** ~15 minutes

### New Endpoint

```
POST /api/claude/timeline/:projectId/elements/:elementId/split
Body: { "splitTime": 3.5 }
Response: { "success": true, "data": { "secondElementId": "element_xyz" } }
```

### New IPC Channel

`claude:timeline:splitElement`

### Files to Modify

| File | Change |
|------|--------|
| `electron/claude/claude-http-server.ts` | Add POST route for split |
| `electron/claude/claude-timeline-handler.ts` | Add `claude:timeline:splitElement` IPC handler |
| `apps/web/src/lib/claude-timeline-bridge.ts` | Add `onSplitElement` listener that calls `splitElement()` from store |
| `electron/preload-integrations.ts` | Add `splitElement` to claude.timeline API surface |
| `apps/web/src/types/cli-provider.ts` | Add splitElement type to ClaudeTimeline interface |

### Implementation Details

**HTTP handler** (`claude-http-server.ts`):
```typescript
// POST /api/claude/timeline/:projectId/elements/:elementId/split
router.post("/api/claude/timeline/:projectId/elements/:elementId/split", async (req) => {
  const { projectId, elementId } = req.params;
  const { splitTime } = req.body;
  // Validate splitTime is a positive number
  // Send IPC event to renderer, wait for response
});
```

**Bridge listener** (`claude-timeline-bridge.ts`):
```typescript
window.electronAPI.claude.timeline.onSplitElement((data) => {
  const { elementId, splitTime } = data;
  // Find trackId by scanning tracks for elementId
  // Call splitElement(trackId, elementId, splitTime)
  // Return secondElementId via IPC response
});
```

**Store method already exists** (`split-operations.ts:34-88`):
- `splitElementOperation(ctx, trackId, elementId, splitTime)`
- Returns `secondElementId` or `null`
- Validates split time is within element bounds
- Creates two elements with adjusted `trimStart`/`trimEnd`
- Pushes undo history

### Variants to Support

| Operation | Description | Implementation |
|-----------|-------------|----------------|
| `split` | Split into two clips | `splitElement()` |
| `keepLeft` | Trim from right | `splitAndKeepLeft()` |
| `keepRight` | Trim from left | `splitAndKeepRight()` |

Expose via body param: `{ "splitTime": 3.5, "mode": "split" | "keepLeft" | "keepRight" }`

### Tests

- `electron/claude/__tests__/timeline-split.test.ts`
  - Split at valid time returns secondElementId
  - Split at out-of-bounds time returns error
  - keepLeft/keepRight modes work correctly
  - Split on non-existent element returns 404

---

## Subtask 2: Select Clip Endpoint

**Estimated:** ~10 minutes

### New Endpoints

```
POST /api/claude/timeline/:projectId/selection
Body: { "elements": [{"trackId": "track_1", "elementId": "element_abc"}] }
Response: { "success": true, "data": { "selected": 1 } }

GET /api/claude/timeline/:projectId/selection
Response: { "success": true, "data": { "elements": [...] } }

DELETE /api/claude/timeline/:projectId/selection
Response: { "success": true, "data": { "cleared": true } }
```

### New IPC Channel

`claude:timeline:selectElements`
`claude:timeline:getSelection`
`claude:timeline:clearSelection`

### Files to Modify

| File | Change |
|------|--------|
| `electron/claude/claude-http-server.ts` | Add POST/GET/DELETE routes for selection |
| `electron/claude/claude-timeline-handler.ts` | Add selection IPC handlers |
| `apps/web/src/lib/claude-timeline-bridge.ts` | Add selection listeners using `selectElement()`, `clearSelectedElements()` |
| `electron/preload-integrations.ts` | Add selection methods to claude.timeline |
| `apps/web/src/types/cli-provider.ts` | Add selection types to ClaudeTimeline interface |

### Implementation Details

**Bridge listener** (`claude-timeline-bridge.ts`):
```typescript
window.electronAPI.claude.timeline.onSelectElements((data) => {
  const store = useTimelineStore.getState();
  store.clearSelectedElements();
  for (const el of data.elements) {
    store.selectElement(el.trackId, el.elementId, true); // multi=true
  }
});
```

**Store methods already exist** (`timeline-store.ts:247-282`):
- `selectElement(trackId, elementId, multi?)` — single or multi-select
- `deselectElement(trackId, elementId)`
- `clearSelectedElements()`
- `setSelectedElements(elements)`
- Selection state: `selectedElements: SelectedElement[]`

### Tests

- `electron/claude/__tests__/timeline-selection.test.ts`
  - Select single element
  - Multi-select multiple elements
  - Get current selection
  - Clear selection
  - Select non-existent element returns error

---

## Subtask 3: Move Clip Endpoint

**Estimated:** ~10 minutes

### New Endpoint

```
POST /api/claude/timeline/:projectId/elements/:elementId/move
Body: { "toTrackId": "track_2", "newStartTime": 5.0 }
Response: { "success": true, "data": { "moved": true } }
```

### New IPC Channel

`claude:timeline:moveElement`

### Files to Modify

| File | Change |
|------|--------|
| `electron/claude/claude-http-server.ts` | Add POST route for move |
| `electron/claude/claude-timeline-handler.ts` | Add `claude:timeline:moveElement` IPC handler |
| `apps/web/src/lib/claude-timeline-bridge.ts` | Add `onMoveElement` listener |
| `electron/preload-integrations.ts` | Add `moveElement` to claude.timeline |
| `apps/web/src/types/cli-provider.ts` | Add moveElement type to ClaudeTimeline interface |

### Implementation Details

**Bridge listener** (`claude-timeline-bridge.ts`):
```typescript
window.electronAPI.claude.timeline.onMoveElement((data) => {
  const { elementId, toTrackId, newStartTime } = data;
  const store = useTimelineStore.getState();
  // Find source trackId by scanning tracks
  const fromTrackId = findTrackContainingElement(elementId);
  if (fromTrackId) {
    store.moveElementToTrack(fromTrackId, toTrackId, elementId);
    if (newStartTime !== undefined) {
      store.updateElementStartTime(toTrackId, elementId, newStartTime);
    }
  }
});
```

**Store method already exists** (`element-operations.ts:149-208`):
- `moveElementToTrackOperation(ctx, fromTrackId, toTrackId, elementId)`
- Validates element-track type compatibility
- Removes from source track, adds to destination
- Cleans up empty non-main tracks
- Pushes undo history

### Tests

- `electron/claude/__tests__/timeline-move.test.ts`
  - Move element between compatible tracks
  - Move to incompatible track returns error
  - Move with newStartTime updates position
  - Move non-existent element returns 404

---

## Shared Utilities Needed

### `findTrackContainingElement(elementId)` helper

Both split and move need to find which track contains an element (since HTTP API only knows elementId, not trackId). Add to `claude-timeline-bridge.ts`:

```typescript
function findTrackContainingElement(elementId: string): string | null {
  const tracks = useTimelineStore.getState().tracks;
  for (const track of tracks) {
    if (track.elements.some(el => el.id === elementId)) {
      return track.id;
    }
  }
  return null;
}
```

---

## Response Pattern for New Endpoints

All new endpoints use request-response IPC (not fire-and-forget) so HTTP callers get confirmation:

```
HTTP POST → main process → webContents.send("claude:timeline:splitElement", data)
                            renderer responds via ipcRenderer.send("claude:timeline:splitElement:response", result)
                          ← main process resolves promise, returns HTTP response
```

This matches the existing `requestTimelineFromRenderer()` pattern with a 5-second timeout.

---

## Updated Route Map (After Implementation)

| Method | Route | Description | **New?** |
|--------|-------|-------------|----------|
| POST | `/api/claude/timeline/:projectId/elements/:elementId/split` | Split clip at time | Yes |
| POST | `/api/claude/timeline/:projectId/elements/:elementId/move` | Move clip to track | Yes |
| POST | `/api/claude/timeline/:projectId/selection` | Set selection | Yes |
| GET | `/api/claude/timeline/:projectId/selection` | Get selection | Yes |
| DELETE | `/api/claude/timeline/:projectId/selection` | Clear selection | Yes |

---

## Updated API Type Additions

```typescript
// electron/types/claude-api.ts

interface ClaudeSplitRequest {
  splitTime: number;
  mode?: "split" | "keepLeft" | "keepRight";  // default: "split"
}

interface ClaudeSplitResponse {
  secondElementId: string | null;
}

interface ClaudeMoveRequest {
  toTrackId: string;
  newStartTime?: number;
}

interface ClaudeSelectionRequest {
  elements: Array<{ trackId: string; elementId: string }>;
}
```

---

## Relevant File Paths

| File | Role |
|------|------|
| `electron/claude/claude-http-server.ts` | HTTP route registration |
| `electron/claude/claude-timeline-handler.ts` | IPC handler registration |
| `apps/web/src/lib/claude-timeline-bridge.ts` | Renderer-side IPC listeners → store |
| `electron/preload-integrations.ts` | IPC API surface exposed to renderer |
| `apps/web/src/types/cli-provider.ts` | TypeScript types for renderer API |
| `electron/types/claude-api.ts` | Shared API type definitions |
| `apps/web/src/stores/timeline-store.ts` | Core Zustand store (selectElement, moveElementToTrack) |
| `apps/web/src/stores/timeline/split-operations.ts` | splitElement, splitAndKeepLeft, splitAndKeepRight |
| `apps/web/src/stores/timeline/element-operations.ts` | moveElementToTrackOperation |
| `docs/task/claude-api-usage-guide.md` | API documentation to update |

---

*Created: 2026-02-17*
