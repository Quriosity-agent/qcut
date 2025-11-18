# LTX Media Store Missing - Implementation Plan

## Issue Summary

**Problem**: LTX media is generated successfully but not visible in the media store due to:
1. CSP (Content Security Policy) blocking playback from FAL media hosts
2. Storage rollback when save failures occur
3. Potential project mismatch or filters hiding items

**Priority**: High (must-do for CSP fix, should-do for visibility, nice-to-have for fallback)

### Review notes (what to keep in focus)
- Do CSP first; it unblocks playback even when storage works. Validate in both web/Electron.
- For storage failures, avoid silent rollback. Keep item in state, mark `unsaved/urlOnly`, and surface a toast with retry guidance; add a small feature flag to disable if needed.
- URL-only mode should be gated on storage error detection (OPFS/IndexedDB failure); ensure it doesn’t fire on transient network errors.
- Add a lightweight “retry save” helper to keep logic localized to `media-store.ts` rather than scattering calls.
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

### Scenario 2: Storage Failure
1. Generate LTX video
2. Video downloads successfully
3. Storage save fails (simulate by disabling IndexedDB)
4. Item stays visible with "unsaved" badge
5. Toast notification appears
6. User clicks "Retry" and save succeeds

### Scenario 3: Incognito/Blocked Storage
1. Open app in incognito mode
2. Generate LTX video
3. Storage is completely blocked
4. Item saves as URL-only
5. Video plays from remote URL
6. User clicks "Download Locally" (should work if storage becomes available)

### Scenario 4: CSP Blocking (Before Fix)
1. Generate LTX video without CSP fix
2. Video downloads and saves
3. Playback fails with CSP error in console
4. Apply CSP fix
5. Video now plays correctly

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
