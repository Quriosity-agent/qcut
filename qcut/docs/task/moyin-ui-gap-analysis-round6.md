# Moyin UI Gap Analysis — Round 6

## Focus: Visual Review, Search & Export

Round 6 addresses the most impactful UI gaps for daily production use: shot gallery view, search/filter, and export capabilities.

---

### Task 1: Shot Thumbnail Grid View

**Problem**: Shots are displayed only as a compact text list. No visual overview of generated images.
**Solution**: Add a toggle in `shot-breakdown.tsx` to switch between list view (current) and a thumbnail grid view.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

**Acceptance Criteria**:
- Toggle button (list icon / grid icon) in the shot-breakdown header
- Grid view shows shot images as thumbnails (4 per row, aspect 16:9)
- Each thumbnail shows shot number overlay + status dot
- Clicking a thumbnail selects the shot (same as list click)
- Falls back to placeholder when no image generated
- Persists view preference in local component state

---

### Task 2: Search Filter for Characters and Scenes

**Problem**: No way to search/filter characters or scenes by name.
**Solution**: Add a search input at the top of `character-list.tsx` and `scene-list.tsx`.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

**Acceptance Criteria**:
- Search input at top of each list (compact, with magnifying glass icon)
- Filters characters by name, role, or tags
- Filters scenes by name, location, or time
- Case-insensitive matching
- Clear button when search text present
- Shows "No results" message when nothing matches

---

### Task 3: Export Shot List as Markdown

**Problem**: No way to export shot/scene data for sharing with team or documentation.
**Solution**: Add an "Export" button in `generate-actions.tsx` that copies a formatted Markdown shot list to clipboard.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`

**Acceptance Criteria**:
- "Export" button next to "New Script" button
- Generates Markdown with: title, episode, scenes, shots (action, camera, status)
- Includes character list with roles
- Copies to clipboard with "Copied!" feedback
- Works even without generated images (text-only export)

---

### Task 4: Completeness Checker Badge

**Problem**: No quick way to see which shots still need images or videos.
**Solution**: Add completion stats in the generate-actions summary and episode tree.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

**Acceptance Criteria**:
- Generate panel shows: "Images: 5/12 complete, Videos: 2/12 complete"
- Episode tree shows completion fraction next to each episode
- Color-coded: green when all complete, amber when partial, gray when none
- Updates in real-time as generation progresses

---

### Task 5: Tests for New Features

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx`

**Acceptance Criteria**:
- Tests for search filter rendering and functionality
- Tests for export button rendering
- Tests for completion stats display
- All existing tests still pass

---

## Line Count Budget

| File | Current | Target |
|------|---------|--------|
| shot-breakdown.tsx | 181 | <400 |
| character-list.tsx | 372 | <500 |
| scene-list.tsx | ~200 | <350 |
| generate-actions.tsx | ~250 | <400 |
| episode-tree.tsx | 400 | <500 |
| moyin-view.test.tsx | 430 | <550 |
