# Fix: Timeline Bridge Stubs Implemented

**Date:** 2026-02-13 (updated 2026-02-15)
**File:** `apps/web/src/lib/claude-timeline-bridge.ts`
**Status:** All handlers implemented

## What Happened

When importing 10 videos from `~/Downloads` via the Claude API:

1. **Media import worked** — all 10 files were copied to the project's `media/` folder and appeared in QCut's media panel.
2. **Timeline add failed silently** — the API returned `success: true` with generated element IDs for each clip, but nothing appeared on the timeline.

## Root Cause

The `addElement` flow has three stages:

```
Claude API (HTTP) → Electron Main Process (IPC) → Renderer Bridge → Zustand Store
```

The **renderer bridge handler** (`onAddElement`) was an intentional stub. It logged the incoming element but never called the timeline store. The main process handler generated an element ID and returned it immediately — making the HTTP response look successful — but the renderer discarded the actual element data.

The same issue affected `applyTimelineToStore` and `onUpdateElement`.

## Fixes Applied

### onAddElement

Replaced the stub with a working implementation that:

1. Resolves media via `sourceName`, `sourceId`, or deterministic media ID (base64-encoded name)
2. Syncs project folder if media not found initially
3. Finds or creates a track via `timelineStore.findOrCreateTrack("media")`
4. Calculates duration from `endTime - startTime` (falls back to media duration)
5. Calls `timelineStore.addElementToTrack()` with a proper `CreateMediaElement`
6. Supports `type: "text"` elements with default styling

### onUpdateElement

Maps `Partial<ClaudeElement>` changes to timeline store update methods:

- `startTime` → `updateElementStartTime()`
- `duration` / `endTime` → `updateElementDuration()`
- `content` + `style` on text elements → `updateTextElement()`
- `style.volume` on media elements → `updateMediaElement()`

### onApply (timeline import)

Iterates all tracks/elements in the imported `ClaudeTimeline` and appends them to the existing timeline using the same `addClaudeMediaElement` and `addClaudeTextElement` helpers used by `onAddElement`.

## Handler Status

| Handler | Channel | Status |
|---------|---------|--------|
| `onAddElement` | `claude:timeline:addElement` | **Implemented** |
| `onUpdateElement` | `claude:timeline:updateElement` | **Implemented** |
| `onApply` (timeline import) | `claude:timeline:apply` | **Implemented** |
| `onRemoveElement` | `claude:timeline:removeElement` | **Implemented** |
| `onRequest` (timeline export) | `claude:timeline:request` | **Implemented** |
