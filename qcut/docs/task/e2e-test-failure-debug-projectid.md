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
❌ **FAILED** - Needs fix

## Next Steps
1. Find how to switch tab groups (look for group bar component)
2. Update test to switch to edit group before clicking stickers tab
3. Run test again to verify fix
