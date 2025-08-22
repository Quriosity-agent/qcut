# Sticker Timeline Integration Testing Guide

## Overview
This guide explains how to test the sticker overlay to timeline integration feature in QCut.

## Test Setup

### 1. Start the Application
```bash
# Terminal 1: Start Vite dev server
cd qcut/apps/web
bun run dev

# Terminal 2: Start Electron app
cd qcut
bun run electron:dev
```

### 2. Open Browser DevTools
Press `F12` or `Ctrl+Shift+I` in the Electron app to open DevTools.

## Testing Procedure

### Step 1: Clean Up Any Orphaned Stickers
In the browser console, run:
```javascript
// Clean up any orphaned stickers from previous sessions
stickerTest.cleanup()
```

### Step 2: Add Test Media
1. Click "Add Media" button in the media panel
2. Add at least one image file (PNG, JPG, or SVG)
3. Wait for media to load completely

### Step 3: Test Sticker Addition Methods

#### Method A: Context Menu (Primary Test)
1. Right-click on an image in the media panel
2. Select "Add as Overlay" from the context menu
3. **Expected Results:**
   - Sticker appears on the video preview canvas
   - A new "Sticker Track" appears in the timeline
   - The sticker element appears in the sticker track at current playhead position

#### Method B: Drag and Drop
1. Drag an image from the media panel
2. Drop it onto the video preview area
3. **Expected Results:** Same as Method A

#### Method C: Console Test
Run in the browser console:
```javascript
// Automated test that adds a sticker and verifies timeline integration
stickerTest.test()
```

### Step 4: Verify Timeline Integration

Check the console output for:
```
✅ Added sticker: sticker-[timestamp]-[id]
✅ Sticker track found: {id: "track-...", type: "sticker", ...}
✅ Sticker element found in timeline: {id: "element-...", stickerId: "...", ...}
```

### Step 5: Verify Sticker Visibility

1. Move the playhead along the timeline
2. The sticker should:
   - Be visible when playhead is within sticker's time range (default: 5 seconds)
   - Disappear when playhead moves outside the time range
   - Reappear when playhead returns to the time range

### Step 6: Test Persistence

1. Save the project (Ctrl+S or File → Save)
2. Close and reopen the project
3. **Expected:** Stickers should reload in both canvas and timeline

## Console Commands Reference

```javascript
// Clean orphaned stickers
stickerTest.cleanup()

// Run automated test
stickerTest.test()

// Clear all stickers
stickerTest.clearAll()

// Get current state of all stores
stickerTest.getStores()

// Debug sticker overlay (existing utility)
debugStickerOverlay.help()
debugStickerOverlay.showStickers()
debugStickerOverlay.showTimeline()
```

## Common Issues & Solutions

### Issue: "Media Missing" placeholder appears
**Solution:** Run `stickerTest.cleanup()` to remove orphaned stickers

### Issue: Sticker doesn't appear in timeline
**Check:**
1. Console for any error messages
2. Timeline store has tracks: `stickerTest.getStores().timeline.tracks`
3. Sticker track exists: Look for track with `type: "sticker"`

### Issue: Sticker appears in wrong position on timeline
**Check:**
1. Current playhead position when adding sticker
2. Sticker timing values: `stickerTest.getStores().stickers`

## Success Criteria

✅ **Integration Working** if:
1. Stickers appear on canvas when added
2. Sticker track is automatically created in timeline
3. Sticker elements appear in timeline at correct time
4. No console errors during the process
5. Stickers persist after save/reload

## Debug Logging

The following components have enhanced logging:
- `StickerCanvas.tsx` - Media availability and timing
- `stickers-overlay-store.ts` - Timeline integration
- `timeline-sticker-integration.ts` - Track creation and element addition
- `media-store.ts` - ID generation and synchronization

Enable verbose logging:
```javascript
localStorage.setItem('debug', 'true')
location.reload()
```

## Implementation Details

The integration uses a modular approach:
1. **TimelineStickerIntegration** class handles all timeline operations
2. Dynamic imports prevent circular dependencies
3. Defensive programming with validation and retries
4. Proper state synchronization between stores

## Next Steps

If all tests pass:
1. Build the production app: `bun run dist:win:fast`
2. Test in packaged environment
3. Verify no regression in existing features

If tests fail:
1. Check console for specific error messages
2. Use debug commands to inspect state
3. Review the modular integration code in `timeline-sticker-integration.ts`