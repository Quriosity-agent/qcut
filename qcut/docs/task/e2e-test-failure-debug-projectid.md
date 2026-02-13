# E2E Test Failure: debug-projectid.e2e.ts

## Test File
`apps/web/src/test/e2e/debug-projectid.e2e.ts`

## Failure
**Error**: `TimeoutError: locator.click: Timeout 30000ms exceeded`
**Element**: `getByTestId('stickers-panel-tab')`
**Line**: 110

## Root Cause
The test tries to click on the stickers tab directly, but the stickers tab is in the "edit" tab group, while the app starts in the "media" tab group by default.

**Tab Group Structure** (from `apps/web/src/components/editor/media-panel/store.ts`):
```typescript
tabGroups = {
  media: { tabs: ["media", "project-folder", "sounds", "audio"] },  // Default
  "ai-create": { tabs: ["ai", "text2image", "adjustment", ...] },
  edit: { tabs: ["text", "captions", "word-timeline", "video-edit", "draw", "stickers"] }, // ← Stickers here
  effects: { tabs: ["filters", "effects", "transitions"] },
  tools: { tabs: ["remotion", "pty"] }
}
```

The default active group is "media" (line 225), so the stickers tab is not visible initially.

## Solution
Before clicking the stickers tab, the test needs to:
1. Switch to the "edit" tab group first
2. Then click on the stickers tab

The tab groups are likely accessed via group bar buttons above the tab bar.

## Fix Implementation
Need to update the test to:
1. Click on the "Edit" group button
2. Wait for the stickers tab to become visible
3. Then click on the stickers tab

## Files to Modify
- `apps/web/src/test/e2e/debug-projectid.e2e.ts` (line ~108-110)

## Test Status
✅ **RESOLVED**

## Resolution
The fix has been implemented in `apps/web/src/test/e2e/debug-projectid.e2e.ts`:
1. Test now switches to edit group using `page.getByTestId("group-edit").click()` (line 111)
2. Then clicks stickers tab (line 113)
3. This ensures stickers panel is accessible before interaction
