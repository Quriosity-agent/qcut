# Media Panel Grouped Tabs

## Overview

The media panel currently has 21 flat tabs rendered as a horizontal scrollable list. Users must scroll through all tabs to find what they need, which causes confusion and slows down workflows. This task introduces **tab grouping** — organizing the 21 existing tabs into 5 logical categories with a two-level navigation (group bar → tab bar).

## Architecture Summary

### Current State
- **Tab type**: Union of 21 string literals (`store.ts:27-48`)
- **Tab metadata**: Only `icon` and `label` per tab (`store.ts:50-136`)
- **Tab bar**: Flat horizontal scroll with prev/next nav buttons (`tabbar.tsx`)
- **Media panel**: 1:1 `viewMap` mapping each Tab to its React component (`index.tsx:38-76`)
- **Store**: Zustand with `activeTab` and `setActiveTab` (`store.ts:138-154`)
- **No grouping, no categories, no favorites**

### Target State
- 5 group buttons always visible (no scrolling needed)
- Selecting a group shows its 3-6 child tabs below
- All 21 existing tab views remain unchanged
- Store tracks both `activeGroup` and `activeTab`
- Last-used tab per group is remembered

## Tab Grouping

| Group | Icon | Tabs (existing IDs) |
|-------|------|---------------------|
| **Media** | `FolderOpen` | `media`, `project-folder`, `sounds`, `audio` |
| **AI Create** | `Sparkles` | `ai`, `text2image`, `adjustment`, `nano-edit`, `camera-selector`, `segmentation` |
| **Edit** | `Scissors` | `text`, `captions`, `word-timeline`, `video-edit`, `draw`, `stickers` |
| **Effects** | `Blend` | `filters`, `effects`, `transitions` |
| **Tools** | `Wrench` | `remotion`, `pty` |

**Total**: 5 groups, 21 tabs (all reused, zero new tab views)

---

## Implementation Plan

**Estimated Total Time**: ~2 hours
**Subtask Count**: 5

---

## Subtask 1: Add Group Config to Store

**Time Estimate**: 20 minutes
**Priority**: High (foundational — everything depends on this)

### Description
Extend the media panel store with a `TabGroup` type, a `tabGroups` config object that maps groups to their child tabs, and new state fields for `activeGroup`.

### Relevant Files
- `apps/web/src/components/editor/media-panel/store.ts` — add `TabGroup` type, `tabGroups` config, extend `MediaPanelStore`

### Changes

1. **Add `TabGroup` type** (new union type):
   ```
   "media" | "ai-create" | "edit" | "effects" | "tools"
   ```

2. **Add `tabGroups` config object** mapping each `TabGroup` to:
   ```typescript
   { icon: LucideIcon; label: string; tabs: Tab[] }
   ```
   Using the grouping table above.

3. **Add helper**: `getGroupForTab(tab: Tab): TabGroup` — reverse lookup so we can derive group from any tab.

4. **Extend `MediaPanelStore`**:
   - `activeGroup: TabGroup` — defaults to `"media"`
   - `setActiveGroup: (group: TabGroup) => void` — also sets `activeTab` to the group's first tab (or last-remembered tab)
   - `lastTabPerGroup: Record<TabGroup, Tab>` — remembers last active tab per group
   - Update `setActiveTab` to also update `lastTabPerGroup` and `activeGroup`

### Tests
- `apps/web/src/components/editor/media-panel/__tests__/store.test.ts`
  - Every tab appears in exactly one group
  - `getGroupForTab` returns correct group for each tab
  - `setActiveGroup` sets both group and default tab
  - `setActiveTab` updates `lastTabPerGroup`
  - Switching back to a group restores last-used tab

---

## Subtask 2: Create GroupBar Component

**Time Estimate**: 25 minutes
**Priority**: High

### Description
Create a new `GroupBar` component that renders 5 group buttons horizontally. Clicking a group sets `activeGroup` in the store. The active group is visually highlighted.

### Relevant Files
- `apps/web/src/components/editor/media-panel/group-bar.tsx` — NEW component
- `apps/web/src/components/editor/media-panel/store.ts` — imports `tabGroups`, `useMediaPanelStore`

### Design
- Horizontal row of 5 buttons, each showing group icon + label
- Active group: `text-primary` + subtle bottom border or background highlight
- Fixed height, no scrolling needed (5 items always fit)
- Each button calls `setActiveGroup(groupKey)`

### Tests
- `apps/web/src/components/editor/media-panel/__tests__/group-bar.test.tsx`
  - Renders all 5 groups
  - Click on group calls `setActiveGroup`
  - Active group has distinct styling class

---

## Subtask 3: Refactor TabBar to Show Only Active Group's Tabs

**Time Estimate**: 20 minutes
**Priority**: High

### Description
Modify the existing `TabBar` to filter tabs based on `activeGroup` instead of rendering all 21.

### Relevant Files
- `apps/web/src/components/editor/media-panel/tabbar.tsx` — filter `tabKeys` by active group

### Changes

1. Import `tabGroups` and `activeGroup` from store
2. Replace `const tabKeys = Object.keys(tabs) as Tab[]` with:
   ```typescript
   const tabKeys = tabGroups[activeGroup].tabs
   ```
3. Remove or simplify prev/next nav buttons — with 3-6 tabs per group, horizontal scrolling is unlikely needed. Keep the buttons but they'll rarely appear.
4. The rest of the `TabBar` (rendering individual tabs, scroll-into-view, click handling) stays the same.

### Tests
- `apps/web/src/components/editor/media-panel/__tests__/tabbar.test.tsx`
  - Only renders tabs belonging to active group
  - Switching groups updates visible tabs
  - Click on tab still calls `setActiveTab`

---

## Subtask 4: Compose GroupBar + TabBar in MediaPanel

**Time Estimate**: 15 minutes
**Priority**: High

### Description
Update `MediaPanel` to render `GroupBar` above `TabBar`, creating the two-level navigation.

### Relevant Files
- `apps/web/src/components/editor/media-panel/index.tsx` — add `GroupBar` import and render

### Changes

1. Import `GroupBar` from `./group-bar`
2. Update the JSX layout:
   ```
   <div>
     <GroupBar />      ← NEW: 5 group buttons
     <TabBar />        ← EXISTING: now shows only active group's tabs
     <div>{viewMap[activeTab]}</div>  ← UNCHANGED
   </div>
   ```
3. The `viewMap` stays exactly the same — all 21 tab-to-component mappings are untouched.

### Tests
- `apps/web/src/components/editor/media-panel/__tests__/media-panel.test.tsx`
  - Both `GroupBar` and `TabBar` render
  - Selecting a group → then selecting a tab → correct view renders
  - View content is unchanged

---

## Subtask 5: Unit Tests and Biome Check

**Time Estimate**: 20 minutes
**Priority**: Medium

### Description
Run all new tests, verify Biome formatting passes, and ensure no regressions.

### Relevant Files
- All test files from subtasks 1-4
- `apps/web/src/components/editor/media-panel/store.ts` — biome check
- `apps/web/src/components/editor/media-panel/group-bar.tsx` — biome check
- `apps/web/src/components/editor/media-panel/tabbar.tsx` — biome check
- `apps/web/src/components/editor/media-panel/index.tsx` — biome check

### Checklist
- [ ] `bun run test` passes
- [ ] `bunx @biomejs/biome check --skip-parse-errors apps/web/src/components/editor/media-panel/` passes
- [ ] `bun check-types` passes
- [ ] Manual smoke test: click through all 5 groups, verify all 21 tabs still load their views
- [ ] Verify "last tab per group" memory works across group switches

---

## Summary

| Subtask | Time | Priority | Files |
|---------|------|----------|-------|
| 1. Add Group Config to Store | 20m | High | `store.ts` |
| 2. Create GroupBar Component | 25m | High | `group-bar.tsx` (new) |
| 3. Refactor TabBar Filtering | 20m | High | `tabbar.tsx` |
| 4. Compose in MediaPanel | 15m | High | `index.tsx` |
| 5. Tests and Biome Check | 20m | Medium | test files |

**Total Estimated Time**: ~2 hours

## What Does NOT Change

- All 21 tab view components (MediaView, AiView, etc.) — zero changes
- The `viewMap` in `index.tsx` — same 21 entries
- The `Tab` union type — same 21 values
- The `tabs` config object — same 21 entries with icons/labels
- Any store logic outside `media-panel/store.ts`

## Dependencies

- Existing `tabs` config and `Tab` type (reused as-is)
- Existing `TabBar` component (refactored, not replaced)
- Lucide React icons for group icons (already a dependency)

## Future Enhancements (Out of Scope)

1. **Favorites/Pinned Tabs**: Let users pin frequently used tabs to a quick-access row
2. **Search**: Filter tabs by typing (useful as tab count grows beyond 25)
3. **Contextual Groups**: Show relevant group based on timeline selection
4. **Collapsible GroupBar**: Let users hide group bar if they prefer the flat scroll
5. **Drag Reorder**: Let users customize tab order within groups
