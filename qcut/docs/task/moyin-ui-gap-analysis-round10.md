# Moyin UI Gap Analysis — Round 10: Media Preview & Audio Fields

## Overview
Round 10 focuses on media preview improvements and exposing audio/dialogue fields
that exist in the Shot type but lack UI. These are production-critical gaps that
block effective review workflows.

## Subtasks

### 10.1 Video Preview Player in Shot Detail
Add inline video playback when a shot has a generated video URL.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

**Changes**:
- Render `<video>` element when `shot.videoUrl` is available
- Add play/pause toggle with progress bar
- Show video duration and current time
- Fallback to image thumbnail when no video

**Tests**:
- Renders video element when videoUrl present
- Hides video element when no videoUrl
- Shows image fallback when only imageUrl

---

### 10.2 Audio & Dialogue Fields in Shot Detail
Expose dialogue, ambient sound, sound effects, and BGM fields in the shot
detail panel for editing.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`
- `apps/web/src/stores/moyin-store.ts` (no changes needed — updateShot covers this)

**Changes**:
- Add "Audio" collapsible section to shot detail
- Text input for `dialogue` field
- Text input for `ambientSound` field
- Text input for `soundEffect` field
- Text input for `bgm` (background music) field
- Toggle for `audioEnabled`

**Tests**:
- Renders audio section in shot detail
- Updates dialogue field via store

---

### 10.3 Character Reference Image Thumbnails
Show character reference images as a small thumbnail strip in the character
detail view.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx`

**Changes**:
- When selected character has `referenceImages`, render thumbnail strip
- Click thumbnail opens media-preview-modal for fullscreen view
- Show placeholder text when no reference images

**Tests**:
- Renders reference image thumbnails when present
- Shows empty state when no images

---

### 10.4 Shot Completion Filter
Add a filter dropdown to shot-breakdown to filter by completion status
(all, has image, has video, incomplete).

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

**Changes**:
- Add filter dropdown next to existing list/grid toggle
- Filter options: All, Has Image, Has Video, Incomplete
- Apply filter to displayed shots
- Show count in filter label

**Tests**:
- Renders filter dropdown
- Filters shots by completion status

---

### 10.5 Round 10 Tests
Write and run tests for all Round 10 features.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx`
- `apps/web/src/stores/__tests__/moyin-store-round10.test.ts` (if needed)

**Verification**:
- All new tests pass
- All existing 73 moyin tests still pass
- Build succeeds
- moyin-store.ts stays ≤ 800 lines

## Estimated Time
~15 minutes per subtask, ~75 minutes total
