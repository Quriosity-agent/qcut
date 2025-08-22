# Sticker Overlay Investigation Plan

**Issue**: MediaItemId mismatch causing "Media Missing" placeholder instead of rendered stickers  
**Estimated Total Time**: 60-80 minutes  
**Status**: Ready to Execute

## Phase 1: Data Collection & Diagnosis (20 minutes)

### Task 1.1: Verify Enhanced Debug Output (5 minutes)
**File**: `qcut/apps/web/src/components/editor/stickers-overlay/StickerCanvas.tsx:271-278`

**Action**: Test the enhanced debug logging we added
1. Start the application 
2. Add any media item to the media panel
3. Right-click → "Add as Overlay"
4. Check browser console for detailed error output

**Console Commands to Run**:
```javascript
// Open browser console and run this to see current state
console.log('=== STICKER DEBUG STATE ===');
console.log('Media Store:', useAsyncMediaStore.getState());
console.log('Sticker Store:', useStickersOverlayStore.getState());
console.log('========================');
```

**Expected Console Output**:
```
[StickerCanvas] ⚠️ MEDIA MISSING: Media item not found for sticker sticker-xxx, mediaItemId: abc-123. Available media: 2
{
  stickerMediaId: "abc-123",
  availableMediaIds: [{id: "def-456", name: "image.png"}, {id: "ghi-789", name: "video.mp4"}],
  sticker: {...}
}
=== STICKER DEBUG STATE ===
Media Store: {store: {mediaItems: [...]}, loading: false, error: null}
Sticker Store: {overlayStickers: Map(1), selectedStickerId: null, ...}
========================
```

**Success Criteria**: Console shows detailed mediaItemId mismatch information

---

### Task 1.2: Visual Confirmation of Missing Media Placeholder (3 minutes)
**File**: Visual inspection of preview area

**Action**: Look for the yellow dashed placeholder
1. After adding overlay in Task 1.1
2. Check preview/canvas area for yellow dashed border box
3. Verify text shows "Media Missing"

**Expected Visual**: Yellow dashed box with "Media Missing" text in preview area

**Success Criteria**: Visual placeholder confirms the media lookup is failing

---

### Task 1.3: Compare Media Store vs Sticker Store IDs (5 minutes)
**Files**: 
- `qcut/apps/web/src/stores/media-store.ts`
- `qcut/apps/web/src/stores/stickers-overlay-store.ts`

**Action**: Add temporary logging to compare ID generation
1. In `media-store.ts:288` (before `console.log` removal), temporarily add:
```typescript
console.log(`[MediaStore] Generated ID for ${newItem.name}:`, newItem.id);
```

2. In `stickers-overlay-store.ts:121`, add:
```typescript
console.log(`[StickerStore] Creating overlay with mediaItemId:`, mediaItemId);
```

3. Test add media → add overlay sequence
4. Compare the IDs in console output

**Success Criteria**: Identify if IDs match or differ between stores

---

### Task 1.4: Check ID Generation Method Consistency (7 minutes)
**Files**: 
- `qcut/apps/web/src/stores/media-store.ts:267-281`
- `qcut/apps/web/src/lib/utils.ts` (generateFileBasedId function)

**Action**: Verify ID generation logic
1. Find the `generateFileBasedId` function implementation
2. Check if media store always uses this method consistently
3. Add temporary logging to see the actual ID generation:
```typescript
// In media-store.ts around line 269
console.log(`[MediaStore] ID generation attempt for ${item.name}:`, {
  hasFile: !!item.file,
  providedId: item.id,
  willGenerateNew: !item.id && item.file
});
```

**Success Criteria**: Understand exact ID generation flow and consistency

---

## Phase 2: Root Cause Analysis (15 minutes)

### Task 2.1: Test Media Item Availability Timing (8 minutes)
**File**: `qcut/apps/web/src/components/editor/stickers-overlay/StickerCanvas.tsx`

**Action**: Add timing check for media availability
1. Add temporary state tracking in StickerCanvas:
```typescript
// After line 46, add:
const [debugInfo, setDebugInfo] = useState({});

useEffect(() => {
  if (overlayStickers.size > 0) {
    setDebugInfo({
      stickerCount: overlayStickers.size,
      mediaCount: mediaItems.length,
      timestamp: Date.now()
    });
    console.log(`[StickerCanvas] Media availability check:`, {
      mediaItemsLoaded: mediaItems.length,
      mediaIds: mediaItems.map(m => m.id),
      stickersWaitingForMedia: Array.from(overlayStickers.values()).filter(s => 
        !mediaItems.find(m => m.id === s.mediaItemId)
      ).length
    });
  }
}, [mediaItems.length, overlayStickers.size]);
```

2. Test rapid overlay creation after media upload

**Additional Console Logging**:
```typescript
// Add this to track timing issues
console.log(`[StickerCanvas] Timing Debug:`, {
  timestamp: new Date().toISOString(),
  mediaStoreReady: !mediaStoreLoading,
  mediaCount: mediaItems.length,
  stickerCount: overlayStickers.size,
  currentTime,
  visibleStickersCount: visibleStickers.length
});
```

**Success Criteria**: Determine if timing/race condition causes the mismatch

---

### Task 2.2: Trace Media Item Lifecycle (7 minutes) 
**Files**:
- `qcut/apps/web/src/hooks/use-async-media-store.ts`
- `qcut/apps/web/src/components/editor/media-panel/views/media.tsx`

**Action**: Check if media store hook provides stale data
1. In the media panel context menu (media.tsx:392), add logging:
```typescript
onClick={(e) => {
  e.stopPropagation();
  console.log(`[MediaPanel] Adding overlay for item:`, {
    itemId: item.id,
    itemName: item.name,
    currentMediaStoreItems: useAsyncMediaStore.getState().store?.mediaItems?.length || 0
  });
  // ... existing code
}}
```

2. Check if `useAsyncMediaStore` provides different data than direct store access

**Success Criteria**: Identify if hook vs direct store access causes inconsistency

---

## Phase 3: Quick Fixes & Validation (25 minutes)

### Task 3.1: Implement Retry Mechanism (10 minutes)
**File**: `qcut/apps/web/src/components/editor/stickers-overlay/StickerCanvas.tsx:264-299`

**Action**: Add intelligent retry for missing media items
1. Replace the immediate "Media Missing" rendering with a retry mechanism:
```typescript
// Replace lines 270-290 with:
if (!mediaItem) {
  // Try to retry lookup after a short delay for newly added media
  const [retryCount, setRetryCount] = useState(0);
  
  useEffect(() => {
    const retryTimer = setTimeout(() => {
      if (retryCount < 3) { // Max 3 retries
        console.log(`[StickerCanvas] Retry ${retryCount + 1} for missing media:`, sticker.mediaItemId);
        setRetryCount(prev => prev + 1);
      }
    }, 500 * (retryCount + 1)); // Exponential backoff
    
    return () => clearTimeout(retryTimer);
  }, [retryCount, sticker.mediaItemId]);
  
  // After retries exhausted, show placeholder
  if (retryCount >= 3) {
    console.error(/* existing detailed error */);
    // Show existing yellow placeholder
  } else {
    // Show loading state
    return (
      <div key={sticker.id} className="absolute border-2 border-dashed border-blue-500 bg-blue-500/10 flex items-center justify-center text-xs text-blue-600 pointer-events-none animate-pulse">
        Loading Media...
      </div>
    );
  }
}
```

**Success Criteria**: Stickers wait for media to load instead of immediately failing

---

### Task 3.2: Add Media Store Synchronization Check (8 minutes)
**File**: `qcut/apps/web/src/components/editor/media-panel/views/media.tsx:392-425`

**Action**: Ensure media is available before creating overlay
1. Modify the "Add as Overlay" handler:
```typescript
onClick={(e) => {
  e.stopPropagation();
  
  // Verify media item exists in current store state
  const currentMediaItems = useAsyncMediaStore.getState().store?.mediaItems || [];
  const mediaExists = currentMediaItems.some(m => m.id === item.id);
  
  console.log(`[MediaPanel] Overlay creation check:`, {
    targetItemId: item.id,
    mediaExists,
    totalMediaItems: currentMediaItems.length
  });
  
  if (!mediaExists) {
    console.warn(`[MediaPanel] Media item not found in store, retrying in 100ms`);
    setTimeout(() => {
      // Retry once after brief delay
      const retryMediaItems = useAsyncMediaStore.getState().store?.mediaItems || [];
      const retryExists = retryMediaItems.some(m => m.id === item.id);
      if (retryExists) {
        // Proceed with overlay creation
        const { addOverlaySticker } = useStickersOverlayStore.getState();
        // ... rest of existing code
      } else {
        toast.error(`Media item not ready for overlay. Please try again.`);
      }
    }, 100);
    return;
  }
  
  // Existing overlay creation code...
}}
```

**Success Criteria**: Overlay creation waits for media synchronization

---

### Task 3.3: Validate Fix with Multiple Scenarios (7 minutes)
**Files**: Browser testing

**Action**: Test various scenarios to ensure fix works
1. **Scenario A**: Upload image → immediately add overlay
2. **Scenario B**: Upload multiple images → add overlays to different items  
3. **Scenario C**: Add overlay at different timeline positions
4. **Scenario D**: Add overlay while video is playing

**Expected Results**: All scenarios should show actual sticker content, not placeholder

**Success Criteria**: No "Media Missing" placeholders appear in any scenario

---

## Phase 4: Cleanup & Verification (10 minutes)

### Task 4.1: Remove Debug Logging (5 minutes)
**Files**: All files modified in previous phases

**Action**: Clean up temporary console.log statements
1. Remove temporary logging added in Tasks 1.3, 1.4, 2.1, 2.2
2. Keep the enhanced error logging from StickerCanvas (it's useful for production)
3. Verify no console spam in normal operation

**Success Criteria**: Clean console output during normal usage

---

### Task 4.2: Final Integration Test (5 minutes)
**Files**: Full application test

**Action**: End-to-end workflow validation
1. Upload fresh media items
2. Create overlays using context menu
3. Verify overlays appear immediately
4. Test overlay interaction (drag, resize)
5. Test overlay timing (visibility at correct time ranges)

**Final Console Validation Commands**:
```javascript
// Run these in browser console to verify fix
console.log('=== FINAL VALIDATION ===');
console.log('Total Media Items:', useAsyncMediaStore.getState().store?.mediaItems?.length || 0);
console.log('Total Overlay Stickers:', useStickersOverlayStore.getState().overlayStickers.size);
console.log('Missing Media Count:', 
  Array.from(useStickersOverlayStore.getState().overlayStickers.values())
    .filter(s => !useAsyncMediaStore.getState().store?.mediaItems?.find(m => m.id === s.mediaItemId))
    .length
);
console.log('Success: All stickers have matching media items!');
console.log('======================');
```

**Success Criteria**: Complete overlay workflow functions properly with console showing 0 missing media items

---

## Rollback Plan

If any task breaks existing functionality:

1. **Immediate Rollback**: Revert changes to last working state
2. **Fallback Approach**: Keep current "Media Missing" behavior but improve error messaging
3. **Alternative Solution**: Implement lazy loading in StickerElement instead of StickerCanvas

## Success Metrics

- ✅ No "Media Missing" placeholders for valid media items
- ✅ Overlays appear immediately after context menu selection  
- ✅ Console shows clear diagnostic information for any failures
- ✅ Existing drag/drop and direct overlay functionality unchanged
- ✅ Performance impact < 50ms for overlay creation

## Console Commands Reference

### Quick Debugging Commands
```javascript
// 1. Check current state snapshot
console.log('=== STATE SNAPSHOT ===');
console.log('Media Items:', useAsyncMediaStore.getState().store?.mediaItems?.map(m => ({id: m.id, name: m.name})));
console.log('Overlay Stickers:', Array.from(useStickersOverlayStore.getState().overlayStickers.values()).map(s => ({id: s.id, mediaItemId: s.mediaItemId})));

// 2. Find orphaned stickers (stickers without matching media)
const orphanedStickers = Array.from(useStickersOverlayStore.getState().overlayStickers.values())
  .filter(sticker => !useAsyncMediaStore.getState().store?.mediaItems?.find(media => media.id === sticker.mediaItemId));
console.log('Orphaned Stickers:', orphanedStickers);

// 3. Check timing and visibility
console.log('Current Time:', usePlaybackStore.getState().currentTime);
console.log('Visible Stickers:', useStickersOverlayStore.getState().getVisibleStickersAtTime(usePlaybackStore.getState().currentTime));

// 4. Clear all stickers (emergency reset)
// useStickersOverlayStore.getState().clearAllStickers();
```

### Performance Monitoring
```javascript
// Monitor overlay creation performance
console.time('overlay-creation');
// ... perform overlay creation
console.timeEnd('overlay-creation');

// Monitor media lookup performance
console.time('media-lookup');
const mediaItem = mediaItems.find(item => item.id === targetId);
console.timeEnd('media-lookup');
```

## Notes

- Each task is designed to be non-breaking and easily reversible
- Console logging provides clear diagnostic trail with timestamp tracking
- Progressive enhancement approach - each fix builds on previous understanding
- Focus on timing and synchronization issues rather than major architectural changes
- Use console commands above for quick debugging during investigation