# Moyin UI Gap Analysis — Round 7: Polish & Accessibility

## Focus: Accessibility, Recovery Flows, Loading States, Empty-State Clarity

Round 7 is a polish pass focused on usability gaps that slow down daily editing work:
- discoverability (unclear icon actions)
- recovery (failed generations with no direct retry path)
- feedback (blank/static UI during async work)
- productivity (duplicate existing structures instead of rebuilding)

This round should improve UX quality without changing the core Moyin data model or introducing new backend APIs.

---

## Task 1: Add Tooltips and Aria Labels

**Problem**: Several icon-only controls and status indicators rely on visual context. This makes the UI harder to learn and less accessible for keyboard/screen-reader users.

**Goal**: Ensure all interactive UI controls have an accessible name and important status indicators expose meaningful labels.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx`

**Detailed Scope**:
- Add `title` to icon-only buttons where hover/focus hints improve discoverability.
- Add `aria-label` for icon-only interactive controls so screen readers can identify the action.
- Add accessible labels for non-text interactive targets (thumbnail buttons, toggle chips, menu triggers).
- Add status labels for visual-only indicators (example: generation status dots, completion badges).
- Review disabled buttons and ensure labels remain present even when disabled.

**Examples of labels to add/improve**:
- `"Open scene actions"`
- `"Switch to grid view"` / `"Switch to list view"`
- `"Generate storyboard"`
- `"Retry failed image generation"`
- `"Shot 12 thumbnail"`
- `"Status: image generation failed"`

**Implementation Notes**:
- Prefer `aria-label` for icon-only controls and keep `title` for discoverability.
- Avoid duplicate noisy announcements when visible text already exists.
- If a status dot is purely decorative next to visible text, mark it decorative instead of labeling it.
- For toggles, expose current state clearly in the label or with `aria-pressed` where appropriate.

**Acceptance Criteria**:
- All icon-only buttons in the listed files expose an accessible name (`aria-label` and/or `title`).
- Keyboard-focusable thumbnail/tile elements expose a descriptive label.
- Status indicators that communicate state without visible text have an accessible name.
- No regressions where screen readers announce redundant duplicate labels for adjacent text.

---

## Task 2: Duplicate Operations in Context Menus

**Problem**: Users can rename/delete items but cannot duplicate existing episodes/scenes/shots, forcing repetitive manual recreation.

**Goal**: Add duplicate actions for episode/scene/shot nodes so users can copy structure and then edit.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/tree-context-menu.tsx`
- `apps/web/src/stores/moyin-store.ts`

**Detailed Scope**:
- Add `"Duplicate"` menu item to:
  - `EpisodeContextMenu`
  - `SceneContextMenu`
  - `ShotContextMenu`
- Implement store actions:
  - `duplicateEpisode`
  - `duplicateScene`
  - `duplicateShot`
- Duplicate should insert the copy immediately after the source item in the same parent list.
- Duplicate should assign fresh IDs to copied entities.
- Duplicate names should be suffixed with `"(copy)"`.

**Expected Behavior**:
- Duplicating an episode copies nested scenes and shots.
- Duplicating a scene copies nested shots.
- Duplicating a shot copies its editable fields (text, prompts, camera notes, etc.).
- Generated asset references should be reviewed case-by-case:
  - safest default is to preserve metadata but clear transient in-progress/error states
  - avoid duplicated loading flags that imply work is still running

**Edge Cases**:
- Repeated duplication should create readable names:
  - `"Scene A (copy)"`
  - `"Scene A (copy 2)"` (preferred) or repeated `"(copy)"` if simpler for this round
- Duplicating while an item is selected should keep selection stable or move to the new copy consistently (define behavior and test it).
- Duplicating an item with missing optional fields should not throw.
- Store action should no-op safely when source ID is not found.

**Implementation Notes**:
- Extract shared copy/ID regeneration helpers to avoid repeating logic across episode/scene/shot duplication.
- Keep duplication logic in the store, not UI components.
- Preserve sort/order semantics already used by the tree.

**Acceptance Criteria**:
- Each tree context menu includes a `Duplicate` action.
- Duplicated items appear directly after the source item.
- Duplicates use unique IDs for all copied nodes.
- Duplicates include a `"(copy)"` name suffix (or numbered copy suffix if implemented).
- No existing delete/rename/context menu actions regress.

---

## Task 3: Retry Buttons for Failed Generations

**Problem**: When generation fails, users see an error state but often need to navigate elsewhere or manually restart the action.

**Goal**: Add local retry actions directly inside failed states for faster recovery.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`

**Detailed Scope**:
- Show a `Retry` button near failed image generation state in shot detail.
- Show a `Retry` button near failed video generation state in shot detail.
- Show a `Retry` button for failed storyboard generation (global or panel-level action where applicable).
- Retrying should clear stale error UI before re-triggering generation.
- Retry should target only the failed item/action, not unintentionally restart unrelated jobs.

**Expected UX Behavior**:
- Retry button is only visible in failed states.
- On click, status changes immediately to loading/pending (optimistic UI) or disabled retry state.
- Error message is cleared (or replaced with pending state) when retry starts.
- If retry fails again, new error message/state is shown cleanly.

**Edge Cases**:
- Prevent duplicate retries from rapid clicking (disable button while request is pending).
- If required data is missing (prompt, image ref, selected shot), show safe no-op or inline error.
- Retry should work after partial failures (example: image success, video failure).
- Retrying a shot should not mutate sibling shot statuses.

**Implementation Notes**:
- Reuse existing generation handlers where possible to avoid diverging logic.
- Keep state transitions explicit: `failed -> pending -> success/failed`.
- If current code stores error strings separately, clear both status and error fields consistently.

**Acceptance Criteria**:
- Failed image/video/storyboard states display a `Retry` action.
- Clicking retry clears the previous error state and re-runs the correct generation path.
- Retry cannot be spam-clicked into duplicate concurrent requests.
- Retry behavior is scoped to the relevant shot/action only.

---

## Task 4: Skeleton Loaders During Async Operations

**Problem**: During AI Enhance/calibration, the UI can look static or empty, which makes the product feel unresponsive.

**Goal**: Replace static placeholders/blank areas with skeletons that match the final layout.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/import-progress.tsx`

**Detailed Scope**:
- Show skeleton card placeholders during AI Enhance / import-calibration phases.
- Skeleton shape should resemble the final card layout (header line, metadata lines, thumbnail blocks if applicable).
- Use a subtle pulse animation consistent with existing app styles.
- Ensure skeleton count is reasonable (enough to imply loading, not so many that layout jumps heavily).

**Expected UX Behavior**:
- Skeletons appear only while async state is pending/calibrating.
- Skeletons are replaced by real data immediately after completion.
- Empty states remain visible only when the operation is complete and no data exists.
- Loading UI should not be confused with an error state.

**Edge Cases**:
- If cached data exists and a refresh is happening, decide whether to keep old data visible or show skeletons (document per component and keep consistent).
- Avoid layout shift by matching approximate height/spacing of real cards.
- If calibration completes with zero items, transition from skeletons to explicit empty-state copy (not blank area).

**Implementation Notes**:
- Prefer a shared lightweight skeleton component for Character/Scene cards if markup is repeated.
- Keep loading-state checks close to the data source state to avoid inconsistent rendering branches.
- Use semantic wrappers so tests can reliably query loading state (for example `data-testid` only if necessary).

**Acceptance Criteria**:
- AI Enhance / calibration states render skeleton placeholders instead of static content.
- Skeletons visibly animate (pulse/shimmer if existing pattern is available).
- Skeletons are replaced by real cards when loading completes.
- Empty-state messaging still appears correctly when loading completes with no results.

---

## Task 5: Tests for Round 7 Features

**Goal**: Add regression coverage for all Round 7 UI and store behaviors.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx`
- (Optional) add targeted store tests if `moyin-store.ts` duplication logic becomes complex

**Test Coverage Plan**:
- Accessibility:
  - icon-only buttons expose `aria-label` or `title`
  - thumbnail/tile interactive elements expose accessible names
- Retry flows:
  - failed state renders `Retry`
  - clicking retry clears error UI and calls the correct handler
  - retry button disables during in-flight request (if implemented)
- Duplicate flows:
  - context menu includes `Duplicate`
  - duplicate inserts item after original
  - duplicate uses a distinct ID and suffixed name
  - duplicate nested structures preserve expected child counts
- Skeleton loaders:
  - skeletons appear during calibrating/loading state
  - skeletons disappear when data is ready
  - empty state appears after load with zero results

**Testing Notes**:
- Favor user-visible assertions (text, roles, labels) over implementation details.
- If duplication logic is hard to verify via UI only, add focused store tests rather than over-mocking component internals.
- Keep existing test helpers/fixtures DRY by adding a reusable failed-shot fixture and loading-state fixture.

**Acceptance Criteria**:
- New tests cover duplicate, retry, accessibility, and skeleton behaviors.
- Existing Moyin view tests continue to pass.
- Tests verify at least one negative/edge case per feature (missing item, repeated retry click, empty result after load).

---

## Recommended Implementation Order

1. Task 2 (duplicate store + context menus) because it touches core behavior and may affect tree rendering tests.
2. Task 3 (retry actions) because it depends on existing generation handlers and state transitions.
3. Task 4 (skeleton loaders + empty-state polish) to tighten async UX once behavior is stable.
4. Task 1 (accessibility labels/tooltips) as a sweep across components.
5. Task 5 (tests) throughout, with a final regression pass.

---

## Line Count Budget (Target)

| File | Current (approx) | Target |
|------|-------------------|--------|
| tree-context-menu.tsx | ~150 | <260 |
| moyin-store.ts | varies | +100 to +220 |
| shot-detail.tsx | varies | +40 to +120 |
| generate-actions.tsx | varies | +40 to +120 |
| character-list.tsx | ~372 | <500 |
| scene-list.tsx | ~200 | <350 |
| import-progress.tsx | varies | +30 to +100 |
| moyin-view.test.tsx | ~430+ | <650 |

---

## Definition of Done (Round 7)

- Accessibility labels/tooltips added for listed Moyin controls
- Duplicate actions work for episode/scene/shot with unique IDs
- Retry actions visible and functional for failed generation states
- Skeleton loaders replace static loading gaps and preserve empty-state clarity
- Tests added and passing without regressions
