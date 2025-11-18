# LTX Media Store Missing - Complete Analysis & Implementation Guide

## Table of Contents
- [Issue Analysis](#issue-analysis)
- [Implementation Plan](#implementation-plan)
- [Subtask 1: Fix CSP](#subtask-1-fix-csp-content-security-policy---must-do)
- [Subtask 2: Keep Items Visible](#subtask-2-keep-items-visible-on-storage-failure---should-do)
- [Subtask 3: URL-Only Fallback](#subtask-3-url-only-fallback-mode---nice-to-have)
- [Implementation Timeline](#implementation-priority-order)
- [Testing & Validation](#testing-scenarios)

---

# Issue Analysis

## What the latest console shows (`ltx_console_v2.md`)

- LTX Video 2.0 Fast T2V request succeeded with job_id and video URL.
- Media integration block executed: download 200 OK, blob size ~7.9 MB, file created `AI-Video-ltxv2_fast_t2v-...mp4`.
- `addMediaItem` was called and returned an item ID (not shown in this log, but earlier traces did).
- After generation, a CSP error appears when previewing: video blocked by Content Security Policy; message says to add `https://fal.media https://v3.fal.media https://v3b.fal.media` to `media-src`.

## Likely causes of "generated but not visible" given these logs

1. **CSP blocks playback, not storage**: Even if saved, the preview fails unless CSP allows FAL media hosts. The log explicitly asks to add those hosts to `media-src`.
2. **Storage rollback still possible**: If OPFS/IndexedDB writes fail, `addMediaItem` removes the in-memory item after logging a storage error. Check for new console errors emitted by `MediaStore.addMediaItem` (we now log failures with rollback details).
3. **Project mismatch / filters**: Items are stored per `activeProject`. Switching projects or having filters/search applied will hide the item.

## Quick checks

1. **DevTools console**: look for `[MediaStore.addMediaItem] Storage save FAILED` logs or `handleStorageError` right after generation.
2. **Verify CSP**: ensure `media-src` includes `https://fal.media https://v3.fal.media https://v3b.fal.media`; reload and retry.
3. **Confirm `activeProject.id`**: matches the one used during generation (`91792c80-b639-4b2a-bf54-6b7da08e2ff1` in this log) and clear filters/search.
4. **Inspect runtime state**: after generation: `useMediaStore.getState().mediaItems` in console; if empty, persistence likely failed/rolled back.

## Suggested fixes (actionable)

- **Add CSP allowances**: update HTML/Electron CSP to permit `media-src` for `fal.media`, `v3.fal.media`, `v3b.fal.media` so previews work.
- **Soften rollback**: on storage save failure, keep the item in memory and show a toast/banner to inform the user; allow a "URL-only" save mode when OPFS/IndexedDB is blocked.
- **Logging already added**: use the new `[MediaStore.addMediaItem]` logs to pinpoint save failures; add a toast in `use-ai-generation` when `addMediaItem` rejects.

## Should we fix? Yes — recommended prioritization

1. **Unblock playback (must-do):** Add the FAL hosts to CSP `media-src` (and `child-src`/`frame-src` if embedded). Without this, videos appear broken even if stored.
2. **Keep items visible (should-do):** On storage failures, avoid removing the item from local state; mark as unsaved and notify via toast so the user still sees it.
3. **Fallback mode (nice-to-have):** Provide a "URL-only save" path when OPFS/IndexedDB are blocked (incognito/file:///Electron restrictions) so media remains listed and can be re-downloaded when storage is available.

---

# Implementation Plan

## Issue Summary

**Problem**: LTX media is generated successfully but not visible in the media store due to:
1. CSP (Content Security Policy) blocking playback from FAL media hosts
2. Storage rollback when save failures occur
3. Potential project mismatch or filters hiding items

**Priority**: High (must-do for CSP fix, should-do for visibility, nice-to-have for fallback)

### Review notes (what to keep in focus)

- Do CSP first; it unblocks playback even when storage works. Validate in both web/Electron.
- For storage failures, avoid silent rollback. Keep item in state, mark `unsaved/urlOnly`, and surface a toast with retry guidance; add a small feature flag to disable if needed.
- URL-only mode should be gated on storage error detection (OPFS/IndexedDB failure); ensure it doesn't fire on transient network errors.
- Add a lightweight "retry save" helper to keep logic localized to `media-store.ts` rather than scattering calls.
- Keep success path unchanged and test filters/project switching so visibility issues are not mistaken for storage problems.

---

## Subtask 1: Fix CSP (Content Security Policy) - MUST DO

### 1.1 File Paths

**Primary Files:**
- `qcut/apps/web/index.html` - Web app CSP meta tags
- `qcut/apps/desktop/src/main/index.ts` - Electron BrowserWindow CSP configuration
- Any CSP middleware/configuration files in the backend

### 1.2 Code Implementation

#### **File: `qcut/apps/web/index.html`**

**Location**: `<head>` section where CSP meta tags are defined

```html
<!-- Current CSP meta tag (example - find actual tag) -->
<meta http-equiv="Content-Security-Policy" content="...existing rules...">

<!-- UPDATE TO: -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'unsafe-inline' 'unsafe-eval';
               style-src 'self' 'unsafe-inline';
               img-src 'self' data: blob: https:;
               media-src 'self' blob: data: https://fal.media https://v3.fal.media https://v3b.fal.media;
               child-src 'self' blob: https://fal.media https://v3.fal.media https://v3b.fal.media;
               frame-src 'self' blob: https://fal.media https://v3.fal.media https://v3b.fal.media;
               connect-src 'self' https://fal.run https://fal.media https://v3.fal.media https://v3b.fal.media;
               ...other existing rules...">
```

**Key Changes:**
- Add `https://fal.media https://v3.fal.media https://v3b.fal.media` to `media-src`
- Add same hosts to `child-src` and `frame-src` (if embedded video player is used)
- Add FAL hosts to `connect-src` for API calls

#### **File: `qcut/apps/desktop/src/main/index.ts`** (Electron)

**Location**: BrowserWindow creation with webPreferences

```typescript
// Find the BrowserWindow creation code
const mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  webPreferences: {
    // ... existing preferences
    webSecurity: true, // Keep security enabled
  }
});

// ADD CSP to session before loading
mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https:; " +
        "media-src 'self' blob: data: https://fal.media https://v3.fal.media https://v3b.fal.media; " +
        "child-src 'self' blob: https://fal.media https://v3.fal.media https://v3b.fal.media; " +
        "frame-src 'self' blob: https://fal.media https://v3.fal.media https://v3b.fal.media; " +
        "connect-src 'self' https://fal.run https://fal.media https://v3.fal.media https://v3b.fal.media"
      ]
    }
  });
});

// Load the app
mainWindow.loadURL(/* your URL */);
```

**Alternative Electron Approach** (if using webSecurity settings):

```typescript
// In the BrowserWindow options
const mainWindow = new BrowserWindow({
  webPreferences: {
    webSecurity: true,
    contentSecurityPolicy:
      "default-src 'self'; " +
      "media-src 'self' blob: data: https://fal.media https://v3.fal.media https://v3b.fal.media; " +
      "connect-src 'self' https://fal.run https://fal.media https://v3.fal.media https://v3b.fal.media"
  }
});
```

### 1.3 Review Comments

**Testing Checklist:**
- [ ] After changes, generate a new LTX video and verify it plays in the preview
- [ ] Check browser console (F12) - CSP errors should no longer appear
- [ ] Test in both web and Electron (if applicable)
- [ ] Verify existing media still plays correctly
- [ ] Test that security is not compromised (only allow specific FAL hosts)

**Potential Issues:**
- If CSP is set by server headers, update server configuration as well
- Ensure CSP doesn't break other features (fonts, external scripts, etc.)
- Test in production build, not just development

**Security Notes:**
- Only whitelist specific FAL hosts, not all HTTPS
- Keep `'unsafe-inline'` and `'unsafe-eval'` minimal if possible
- Review existing CSP rules before merging

---

## Subtask 2: Keep Items Visible on Storage Failure - SHOULD DO

### 2.1 File Paths

**Primary Files:**
- `qcut/apps/web/src/stores/media-store.ts` - Main media store logic
- `qcut/apps/web/src/hooks/use-ai-generation.ts` - AI generation hook that calls addMediaItem
- `qcut/apps/web/src/components/ui/toast.tsx` or toast service - For user notifications

### 2.2 Code Implementation

#### **File: `qcut/apps/web/src/stores/media-store.ts`**

**Location**: `addMediaItem` method - error handling section

**Current Code (approximate):**
```typescript
async addMediaItem(item: MediaItem) {
  try {
    // Add to state
    set((state) => ({
      mediaItems: [...state.mediaItems, item]
    }));

    // Save to storage
    await storageService.saveMediaItem(item);

  } catch (error) {
    console.error('[MediaStore.addMediaItem] Storage save FAILED', error);

    // CURRENT BEHAVIOR: Remove from state (rollback)
    set((state) => ({
      mediaItems: state.mediaItems.filter(i => i.id !== item.id)
    }));

    throw error;
  }
}
```

**UPDATED Code:**
```typescript
async addMediaItem(item: MediaItem) {
  try {
    // Add to state FIRST (optimistic update)
    set((state) => ({
      mediaItems: [...state.mediaItems, item]
    }));

    console.log('[MediaStore.addMediaItem] Item added to state:', item.id);

    // Attempt to save to persistent storage
    await storageService.saveMediaItem(item);

    console.log('[MediaStore.addMediaItem] Successfully saved to storage:', item.id);

  } catch (error) {
    console.error('[MediaStore.addMediaItem] Storage save FAILED', error);
    console.error('  - Item ID:', item.id);
    console.error('  - Error type:', error.constructor.name);
    console.error('  - Error message:', error.message);

    // NEW BEHAVIOR: Keep item in state, mark as unsaved
    set((state) => ({
      mediaItems: state.mediaItems.map(i =>
        i.id === item.id
          ? {
              ...i,
              metadata: {
                ...i.metadata,
                unsaved: true,
                storageError: {
                  message: error.message,
                  timestamp: new Date().toISOString(),
                  errorType: error.constructor.name
                }
              }
            }
          : i
      )
    }));

    console.log('[MediaStore.addMediaItem] Item marked as unsaved:', item.id);

    // Emit toast notification
    this.handleStorageError(item.id, error);

    // DON'T throw - allow the generation to complete successfully
    // The item is still visible, just not persisted
    return item.id; // Return the ID so caller knows it succeeded in-memory
  }
}

// New method: Handle storage errors with user notification
private handleStorageError(itemId: string, error: Error) {
  // Import toast service at top of file
  // import { toast } from '@/components/ui/use-toast';

  toast({
    title: "⚠️ Media saved locally only",
    description: "Persistent storage failed. Item is visible but not saved to disk. Retry later.",
    variant: "warning",
    duration: 5000,
    action: {
      label: "Retry",
      onClick: () => this.retrySaveItem(itemId)
    }
  });
}

// New method: Retry saving an unsaved item
async retrySaveItem(itemId: string) {
  const state = get();
  const item = state.mediaItems.find(i => i.id === itemId);

  if (!item) {
    console.error('[MediaStore.retrySaveItem] Item not found:', itemId);
    return;
  }

  if (!item.metadata?.unsaved) {
    console.log('[MediaStore.retrySaveItem] Item already saved:', itemId);
    return;
  }

  try {
    console.log('[MediaStore.retrySaveItem] Retrying save for:', itemId);
    await storageService.saveMediaItem(item);

    // Success - remove unsaved flag
    set((state) => ({
      mediaItems: state.mediaItems.map(i =>
        i.id === itemId
          ? {
              ...i,
              metadata: {
                ...i.metadata,
                unsaved: false,
                storageError: undefined
              }
            }
          : i
      )
    }));

    toast({
      title: "✅ Media saved successfully",
      description: "Item has been saved to persistent storage.",
      variant: "success"
    });

    console.log('[MediaStore.retrySaveItem] Successfully saved:', itemId);

  } catch (error) {
    console.error('[MediaStore.retrySaveItem] Retry failed:', error);
    this.handleStorageError(itemId, error);
  }
}
```

#### **File: `qcut/apps/web/src/hooks/use-ai-generation.ts`**

**Location**: After calling `addMediaItem` - around line 902+

**Add console logging and error handling:**
```typescript
// use-ai-generation.ts - after video generation completes

try {
  // Download and create media item
  const mediaItem = await createMediaItem(videoUrl, metadata);

  console.log('🎬 [AI Generation] Media item created:', mediaItem.id);
  console.log('  - File size:', mediaItem.file?.size);
  console.log('  - URL:', mediaItem.url);

  // Add to media store
  const itemId = await addMediaItem(mediaItem);

  if (mediaItem.metadata?.unsaved) {
    console.warn('⚠️ [AI Generation] Media saved locally only (storage failed)');
    console.warn('  - Item ID:', itemId);
    console.warn('  - Error:', mediaItem.metadata?.storageError);
  } else {
    console.log('✅ [AI Generation] Media saved successfully');
    console.log('  - Item ID:', itemId);
  }

  // Update progress
  setProgress({
    status: 'completed',
    progress: 100,
    message: 'Video generated successfully',
    elapsedTime: Date.now() - startTime
  });

} catch (error) {
  console.error('❌ [AI Generation] Failed to add media item:', error);

  // Don't fail the whole generation if just storage failed
  // The video was generated successfully
  setProgress({
    status: 'completed',
    progress: 100,
    message: 'Video generated (storage may have failed)',
    elapsedTime: Date.now() - startTime
  });
}
```

### 2.3 Review Comments

**Testing Checklist:**
- [ ] Generate a video and verify it appears in media store
- [ ] Simulate storage failure (disable IndexedDB in DevTools) and verify item stays visible
- [ ] Check that unsaved items show a warning indicator in the UI
- [ ] Test the retry functionality works
- [ ] Verify toast notifications appear correctly
- [ ] Check console logs show proper error details

**Potential Issues:**
- Need to add UI indicator for unsaved items (badge, icon, etc.)
- Unsaved items will be lost on app restart
- Need to handle retry queue for multiple unsaved items
- Consider auto-retry on app restart

**UI Changes Needed:**
- Add visual indicator (e.g., yellow warning icon) for unsaved items
- Show storage error details on hover
- Add "Retry Save" button in media item actions
- Consider a banner: "You have X unsaved items. [Retry All]"

---

## Subtask 3: URL-Only Fallback Mode - NICE TO HAVE

### 3.1 File Paths

**Primary Files:**
- `qcut/apps/web/src/stores/media-store.ts` - Media store implementation
- `qcut/apps/web/src/services/storage-service.ts` - Storage service (OPFS/IndexedDB)
- `qcut/apps/web/src/components/media/media-item.tsx` - Media item component

### 3.2 Code Implementation

#### **File: `qcut/apps/web/src/stores/media-store.ts`**

**Location**: `addMediaItem` method - enhance error handling

```typescript
async addMediaItem(item: MediaItem) {
  try {
    // Add to state FIRST (optimistic update)
    set((state) => ({
      mediaItems: [...state.mediaItems, item]
    }));

    console.log('[MediaStore.addMediaItem] Item added to state:', item.id);

    // Attempt to save to persistent storage
    await storageService.saveMediaItem(item);

    console.log('[MediaStore.addMediaItem] Successfully saved to storage:', item.id);

  } catch (error) {
    console.error('[MediaStore.addMediaItem] Storage save FAILED', error);

    // Check if storage is completely blocked (incognito, file://, etc.)
    const isStorageBlocked = this.isStorageBlocked(error);

    if (isStorageBlocked) {
      console.warn('[MediaStore.addMediaItem] Storage blocked - using URL-only mode');

      // URL-only fallback: keep item with remote URL, no local file
      set((state) => ({
        mediaItems: state.mediaItems.map(i =>
          i.id === item.id
            ? {
                ...i,
                file: new File([], 'placeholder.mp4', { type: 'video/mp4' }), // Placeholder
                metadata: {
                  ...i.metadata,
                  urlOnly: true,
                  unsaved: true,
                  storageError: {
                    message: 'Persistent storage blocked (incognito/restricted mode)',
                    timestamp: new Date().toISOString(),
                    errorType: 'StorageBlocked'
                  }
                }
              }
            : i
        )
      }));

      toast({
        title: "⚠️ Saved as URL-only",
        description: "Persistent storage blocked. Media will play from remote URL only.",
        variant: "warning",
        duration: 7000,
        action: {
          label: "Learn More",
          onClick: () => window.open('/docs/storage-limitations', '_blank')
        }
      });

    } else {
      // Regular storage error - mark as unsaved but keep file
      set((state) => ({
        mediaItems: state.mediaItems.map(i =>
          i.id === item.id
            ? {
                ...i,
                metadata: {
                  ...i.metadata,
                  unsaved: true,
                  storageError: {
                    message: error.message,
                    timestamp: new Date().toISOString(),
                    errorType: error.constructor.name
                  }
                }
              }
            : i
        )
      }));

      this.handleStorageError(item.id, error);
    }

    return item.id;
  }
}

// New method: Detect if storage is completely blocked
private isStorageBlocked(error: Error): boolean {
  const blockedErrors = [
    'QuotaExceededError',
    'SecurityError',
    'NotSupportedError',
    'Storage is disabled',
    'OPFS not available',
    'IndexedDB not available',
    'Incognito mode'
  ];

  return blockedErrors.some(msg =>
    error.message?.includes(msg) ||
    error.name?.includes(msg)
  );
}

// New method: Download URL-only item to local storage
async downloadUrlOnlyItem(itemId: string) {
  const state = get();
  const item = state.mediaItems.find(i => i.id === itemId);

  if (!item || !item.metadata?.urlOnly) {
    console.error('[MediaStore.downloadUrlOnlyItem] Item not found or not URL-only:', itemId);
    return;
  }

  try {
    console.log('[MediaStore.downloadUrlOnlyItem] Downloading from URL:', item.url);

    // Re-download from URL
    const response = await fetch(item.url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const file = new File([blob], item.filename, { type: item.type });

    console.log('[MediaStore.downloadUrlOnlyItem] Downloaded:', file.size, 'bytes');

    // Update item with actual file
    set((state) => ({
      mediaItems: state.mediaItems.map(i =>
        i.id === itemId
          ? { ...i, file }
          : i
      )
    }));

    // Retry save to storage
    await this.retrySaveItem(itemId);

  } catch (error) {
    console.error('[MediaStore.downloadUrlOnlyItem] Download failed:', error);

    toast({
      title: "❌ Download failed",
      description: `Could not download media: ${error.message}`,
      variant: "destructive"
    });
  }
}
```

#### **File: `qcut/apps/web/src/components/media/media-item.tsx`**

**Add UI indicators for URL-only items:**

```typescript
// In the MediaItem component

export function MediaItem({ item }: { item: MediaItem }) {
  const { downloadUrlOnlyItem, retrySaveItem } = useMediaStore();

  const isUrlOnly = item.metadata?.urlOnly;
  const isUnsaved = item.metadata?.unsaved;

  return (
    <div className="media-item">
      {/* Media preview */}
      <video src={item.url} controls />

      {/* Status badges */}
      <div className="status-badges">
        {isUrlOnly && (
          <Badge variant="warning" className="flex items-center gap-1">
            <CloudIcon className="h-3 w-3" />
            URL Only
          </Badge>
        )}

        {isUnsaved && !isUrlOnly && (
          <Badge variant="outline" className="flex items-center gap-1">
            <AlertTriangleIcon className="h-3 w-3" />
            Unsaved
          </Badge>
        )}
      </div>

      {/* Action buttons */}
      <div className="actions">
        {isUrlOnly && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => downloadUrlOnlyItem(item.id)}
          >
            <DownloadIcon className="h-4 w-4 mr-2" />
            Download Locally
          </Button>
        )}

        {isUnsaved && !isUrlOnly && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => retrySaveItem(item.id)}
          >
            <RefreshIcon className="h-4 w-4 mr-2" />
            Retry Save
          </Button>
        )}
      </div>

      {/* Storage error tooltip */}
      {item.metadata?.storageError && (
        <Tooltip>
          <TooltipTrigger>
            <InfoIcon className="h-4 w-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              <strong>Storage Error:</strong><br />
              {item.metadata.storageError.message}<br />
              <span className="text-muted-foreground">
                {new Date(item.metadata.storageError.timestamp).toLocaleString()}
              </span>
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
```

### 3.3 Review Comments

**Testing Checklist:**
- [ ] Test in incognito mode - items should save as URL-only
- [ ] Test in file:// protocol (Electron) - verify fallback works
- [ ] Test "Download Locally" button for URL-only items
- [ ] Verify remote URLs still work when storage is blocked
- [ ] Test that URL-only items survive app restart (if stored in localStorage)
- [ ] Check that downloads work and convert URL-only to persisted items

**Potential Issues:**
- URL-only items will break if FAL.ai URLs expire
- Need to handle URL expiration gracefully
- Consider storing URL expiration timestamp
- May need to refresh expired URLs via FAL API

**Future Enhancements:**
- Add URL expiration detection and auto-refresh
- Allow bulk download of all URL-only items
- Add setting to prefer URL-only mode (save bandwidth)
- Implement smart caching strategy for frequently accessed items

---

## Implementation Priority Order

### Phase 1: Critical (Week 1)
1. ✅ **Subtask 1.2 - CSP Fix (Web)** - 1-2 hours
2. ✅ **Subtask 1.2 - CSP Fix (Electron)** - 1-2 hours
3. ✅ **Testing CSP changes** - 1 hour

### Phase 2: Important (Week 1-2)
4. ✅ **Subtask 2.2 - Media Store Changes** - 3-4 hours
5. ✅ **Subtask 2.2 - Toast Notifications** - 1-2 hours
6. ✅ **UI Indicators for unsaved items** - 2-3 hours
7. ✅ **Testing storage failure handling** - 2 hours

### Phase 3: Nice-to-Have (Week 2-3)
8. ⭕ **Subtask 3.2 - URL-only mode** - 4-5 hours
9. ⭕ **UI for URL-only items** - 2-3 hours
10. ⭕ **Download locally feature** - 2-3 hours
11. ⭕ **Comprehensive testing** - 3-4 hours

**Total Estimated Time:**
- Phase 1 (Must-do): ~4 hours
- Phase 2 (Should-do): ~10 hours
- Phase 3 (Nice-to-have): ~12 hours
- **Grand Total: ~26 hours**

---

## Testing Scenarios

### Scenario 1: Normal Flow (Happy Path)
1. Generate LTX video
2. Video downloads successfully
3. Storage save succeeds
4. Video appears in media store
5. Video plays correctly with CSP fix

**Expected Console Output:**
```
🎬 Generating video with FAL AI: fal-ai/ltx-video-2-fast/text-to-video
✅ Generation successful
[MediaStore.addMediaItem] Item added to state: abc-123
[MediaStore.addMediaItem] Successfully saved to storage: abc-123
✅ [AI Generation] Media saved successfully
  - Item ID: abc-123
```

### Scenario 2: Storage Failure
1. Generate LTX video
2. Video downloads successfully
3. Storage save fails (simulate by disabling IndexedDB)
4. Item stays visible with "unsaved" badge
5. Toast notification appears
6. User clicks "Retry" and save succeeds

**Expected Console Output:**
```
[MediaStore.addMediaItem] Item added to state: abc-123
[MediaStore.addMediaItem] Storage save FAILED Error: IndexedDB not available
  - Item ID: abc-123
  - Error type: Error
  - Error message: IndexedDB not available
[MediaStore.addMediaItem] Item marked as unsaved: abc-123
⚠️ [AI Generation] Media saved locally only (storage failed)
  - Item ID: abc-123
```

### Scenario 3: Incognito/Blocked Storage
1. Open app in incognito mode
2. Generate LTX video
3. Storage is completely blocked
4. Item saves as URL-only
5. Video plays from remote URL
6. User clicks "Download Locally" (should work if storage becomes available)

**Expected Console Output:**
```
[MediaStore.addMediaItem] Storage save FAILED SecurityError: Storage disabled
[MediaStore.addMediaItem] Storage blocked - using URL-only mode
⚠️ Saved as URL-only
```

### Scenario 4: CSP Blocking (Before Fix)
1. Generate LTX video without CSP fix
2. Video downloads and saves
3. Playback fails with CSP error in console
4. Apply CSP fix
5. Video now plays correctly

**Expected Console Errors (Before Fix):**
```
Refused to load media from 'https://v3.fal.media/files/...' because it violates the following Content Security Policy directive: "media-src 'self'"
```

**Expected Result (After Fix):**
- No CSP errors
- Video plays successfully

---

## Success Metrics

- [ ] **CSP Errors**: Zero CSP errors for FAL media URLs in console
- [ ] **Media Visibility**: 100% of successfully generated videos appear in media store
- [ ] **Storage Failures**: Items remain visible even when storage fails
- [ ] **User Notifications**: Toast appears for all storage errors with retry option
- [ ] **Incognito Mode**: URL-only mode works in restricted environments
- [ ] **User Experience**: No confusion about "disappeared" media

---

## Rollback Plan

If issues occur after deployment:

1. **CSP Issues**: Revert CSP changes, use more permissive temporary CSP
2. **Storage Errors**: Revert to original rollback behavior (remove on fail)
3. **UI Bugs**: Hide unsaved badges, disable retry buttons
4. **Critical Failures**: Deploy hotfix with feature flag to disable new behavior

**Feature Flag Implementation:**
```typescript
// In media-store.ts
const ENABLE_UNSAVED_ITEMS = import.meta.env.VITE_ENABLE_UNSAVED_ITEMS !== 'false';

if (ENABLE_UNSAVED_ITEMS) {
  // New behavior: keep items
} else {
  // Old behavior: rollback
}
```

---

## Additional Console Debugging Commands

For manual testing and debugging, use these commands in browser console:

### Check Media Store State
```javascript
// Get all media items
useMediaStore.getState().mediaItems

// Get unsaved items
useMediaStore.getState().mediaItems.filter(i => i.metadata?.unsaved)

// Get URL-only items
useMediaStore.getState().mediaItems.filter(i => i.metadata?.urlOnly)

// Get current project ID
useProjectStore.getState().activeProject?.id
```

### Test Storage Manually
```javascript
// Disable IndexedDB (in console before generating)
indexedDB.open = () => { throw new Error('IndexedDB disabled for testing') }

// Check if storage is available
navigator.storage?.estimate().then(console.log)
```

### Retry Failed Items
```javascript
// Retry specific item
useMediaStore.getState().retrySaveItem('item-id-here')

// Download URL-only item
useMediaStore.getState().downloadUrlOnlyItem('item-id-here')
```

---

## Documentation Updates Needed

After implementation, update these documentation files:

1. **User Documentation**
   - Explain "unsaved" and "URL-only" badges
   - How to retry saving failed items
   - Storage limitations in incognito mode
   - CSP requirements for video playback

2. **Developer Documentation**
   - Media store architecture
   - Error handling patterns
   - Feature flag configuration
   - Testing procedures for storage failures

3. **Troubleshooting Guide**
   - Common CSP errors and fixes
   - Storage failure scenarios
   - Project mismatch issues
   - Filter/search affecting visibility

---

## Related Issues & References

- Original issue: LTX media missing after successful generation
- CSP error documentation: [MDN CSP media-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/media-src)
- FAL AI documentation: [https://fal.ai/docs](https://fal.ai/docs)
- Storage API: [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) / [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

---

# Appendix A: FAL Video Download-to-Local Flow

## When to use
- For generated videos (e.g., FAL LTX/Sora) we must download the remote URL to a local File, then add to media store to avoid CSP/load issues and to persist in storage.
- Use this flow whenever `response.video_url` is remote (fal.media / v3*.fal.media).

## Implementation Steps

### 1) Download the video
```ts
const response = await fetch(videoUrl);
if (!response.ok) throw new Error(`Video download failed: ${response.status}`);
const blob = await response.blob();
const file = new File([blob], `AI-Video-${modelId}-${Date.now()}.mp4`, { type: "video/mp4" });
```

### 2) Add to media store
```ts
const newItemId = await addMediaItem(activeProject.id, {
  name: `AI: ${prompt.substring(0, 30)}...`,
  type: "video",
  file,
  url: videoUrl, // keep remote URL as well
  duration: videoMetaDuration ?? 0,
  width: videoMetaWidth ?? 1920,
  height: videoMetaHeight ?? 1080,
});
```

### 3) Handle failures gracefully
- If download fails: surface a toast with the HTTP status.
- If `addMediaItem` fails (storage blocked): keep the item in state as URL-only (unsaved) and show a toast; allow retry.

## Where to put the logic
- Primary: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` inside the media integration block after a successful generation response.
- Uses: `addMediaItem` from media store and `activeProject.id` to scope the media.

## Implementation Notes
- Preserve both the local `file` (for persistence) and the remote `url` for reference/playback.
- File naming: include modelId + timestamp for uniqueness.
- Validate `response.ok` before reading the blob to avoid silent partials.
- Ensure CSP allows FAL hosts (media/child/frame-src) so playback works even before download.

---

# Appendix B: Console Logs - Successful Generation

## Example 1: LTX Video 2.0 Fast T2V - Success (No CSP Error)

```
🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀
use-ai-generation.ts:679 Input parameters:
  - activeTab: text
  - prompt: Elevator door opens, 5th floor hallway has dark wooden floor, walls displaying Venetian mask artwork
  - selectedModels: Array(1)
  - hasSelectedImage: false
  - activeProject: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
  - addMediaItem available: true

use-ai-generation.ts:743 ✅ Validation passed, starting generation...

🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
ai-video-client.ts:1840 🎬 Starting LTX Video 2.0 generation with FAL AI
ai-video-client.ts:1841 📝 Prompt: Elevator door opens, 5th floor hallway...
ai-video-client.ts:1842 📐 Resolution: 1080p

use-ai-generation.ts:987 ✅ Text-to-video response: Object
use-ai-generation.ts:1487 - response.video_url: https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4
use-ai-generation.ts:1489 - Full response: {
  "job_id": "job_8hqqqclqc_1763435992707",
  "status": "completed",
  "video_url": "https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4",
  "video_data": {
    "video": {
      "width": 1920,
      "height": 1080,
      "fps": 25,
      "duration": 6.12,
      "num_frames": 153
    }
  }
}

use-ai-generation.ts:1569 📥 Downloading video from URL
use-ai-generation.ts:1575 🔍 DEBUG STEP 5: Video Download Progress
  - videoResponse.ok: true
  - videoResponse.status: 200
  - videoResponse.headers content-type: video/mp4

use-ai-generation.ts:1590 ✅ Downloaded video blob, size: 2817575
use-ai-generation.ts:1594 📄 Created file: AI-Video-ltxv2_fast_t2v-1763436029098.mp4

media-store.ts:326 [MediaStore.addMediaItem] Called with projectId: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:1631 🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED
  - newItemId: 23f4be8d-76d1-1928-ad33-dc7feaf7675e
  - SUCCESS: Video added to media store!

✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
```

**Analysis**: This log shows a completely successful flow with no CSP errors. Video was downloaded, saved, and added to media store successfully.

---

## Example 2: LTX Video 2.0 Fast T2V - CSP Error (Before Fix)

```
🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
ai-video-client.ts:1840 🎬 Starting LTX Video 2.0 generation with FAL AI
ai-video-client.ts:1841 📝 Prompt: Camera slowly descends from ceiling through crystal chandeliers...
ai-video-client.ts:1842 📐 Resolution: 1080p

use-ai-generation.ts:1014 ✅ Text-to-video response: {
  "job_id": "job_mvpcq6pys_1763437652856",
  "status": "completed",
  "video_url": "https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4",
  "video_data": {
    "video": {
      "width": 1920,
      "height": 1080,
      "fps": 25,
      "duration": 6.12
    }
  }
}

use-ai-generation.ts:1596 📥 Downloading video from URL: https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4
use-ai-generation.ts:1617 ✅ Downloaded video blob, size: 7933788
use-ai-generation.ts:1621 📄 Created file: AI-Video-ltxv2_fast_t2v-1763437690677.mp4

media-store.ts:326 [MediaStore.addMediaItem] Called with projectId: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
media-store.ts:353 [MediaStore.addMediaItem] Saving media item
media-store.ts:379 [MediaStore.addMediaItem] Saved to storage

use-ai-generation.ts:1658 ✅ addMediaItem COMPLETED
  - newItemId: d404373d-7569-390a-bc34-eff725c74211
  - SUCCESS: Video added to media store!

✅✅✅ GENERATION LOOP COMPLETE ✅✅✅

# USER TRIES TO PLAY VIDEO - CSP ERROR OCCURS:

hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4:1
  GET https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4
  net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep

[VideoPlayer] Video error: onError event
  src: https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4

🚨 CSP FIX NEEDED: FAL.ai video blocked by Content Security Policy
  - Add https://fal.media https://v3.fal.media https://v3b.fal.media to media-src CSP directive
```

**Analysis**:
- Video generation and storage succeeded completely
- Video added to media store successfully
- **BUT**: When user tries to play the video, CSP blocks it
- Error: `ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`
- This is why the CSP fix is marked as **MUST-DO** priority
- Without CSP fix, videos appear saved but cannot play

**Key Insight**: The media store integration works correctly. The issue is CSP blocking playback, not storage failures. This validates that the CSP fix is the critical first step.
