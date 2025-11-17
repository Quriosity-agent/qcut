# Sora 2 Video Playback CSP Fix

## Issue Summary
**Date**: 2025-11-17
**Component**: Sora 2 Text-to-Video Integration
**Error**: `ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`
**Severity**: High (Feature-Breaking)
**Status**: Documented - Awaiting Implementation

## Problem Description

Sora 2 text-to-video generation **completes successfully** but videos **fail to play** in the editor due to Content Security Policy (CSP) restrictions blocking FAL.ai video domains.

### User Impact

**What Works:**
- ✅ Video generation request succeeds
- ✅ Video downloads from FAL.ai (1.04 MB MP4)
- ✅ Video appears in Media Panel
- ✅ Video can be dragged to Timeline
- ✅ Timeline element is created

**What Fails:**
- ❌ **Video playback shows black screen**
- ❌ Browser console shows CSP error
- ❌ Video preview doesn't load
- ❌ Timeline preview doesn't render
- ❌ Export may fail or produce black video

### Error Message

```
Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
URL: https://v3b.fal.media/files/b/elephant/XbRoW4rfiNpDjyAIdHZ0I_f4YW0UnN.mp4

🚨 CSP FIX NEEDED: FAL.ai video blocked by Content Security Policy
   - Add https://fal.media https://v3.fal.media https://v3b.fal.media to media-src CSP directive
```

## Root Cause Analysis

### Content Security Policy (CSP)

**What is CSP?**
- Browser security mechanism that controls which external resources can load
- Prevents malicious content injection (XSS attacks)
- Configured via HTTP headers or HTML meta tags

**Current CSP Configuration:**
```
Content-Security-Policy:
  media-src 'self' blob: data:;
```

**Problem:**
- Only allows media from same origin (`'self'`), blob URLs, and data URLs
- **Does NOT include FAL.ai domains** where Sora 2 videos are hosted
- Browser blocks video playback from `v3b.fal.media`

### Why Generation Works But Playback Fails

1. **Generation Phase**: Uses FAL API via HTTPS requests
   - Allowed by `connect-src` CSP directive
   - No video loading involved yet

2. **Download Phase**: Fetches video as blob
   - Allowed by `connect-src` directive
   - Video stored temporarily in browser memory

3. **Playback Phase**: `<video>` element tries to load from FAL URL
   - **BLOCKED by `media-src` directive**
   - Browser refuses to load external video

### Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ 1. User generates video with Sora 2                    │
│    ✅ API Request → FAL.ai (connect-src: allowed)      │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 2. FAL returns video URL                               │
│    ✅ Response received successfully                    │
│    URL: https://v3b.fal.media/files/.../video.mp4      │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Video added to Media Panel & Timeline               │
│    ✅ Media item created                                │
│    ✅ Timeline element added                            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Video player tries to load FAL URL                  │
│    <video src="https://v3b.fal.media/...">             │
│    ❌ BLOCKED by CSP media-src directive               │
│    ❌ Browser shows: ERR_BLOCKED_BY_RESPONSE            │
└─────────────────────────────────────────────────────────┘
```

## Solution Design

### Option 1: Update CSP to Allow FAL.ai Domains (Recommended)

**Approach:** Add FAL.ai video domains to the `media-src` CSP directive.

**Pros:**
- ✅ Simple implementation
- ✅ Videos load directly from FAL CDN (fast)
- ✅ No additional server resources needed
- ✅ Maintains FAL's CDN caching benefits

**Cons:**
- ⚠️ Relies on external domain availability
- ⚠️ Videos expire after FAL's retention period (~24 hours)

**Implementation:**

Update CSP configuration to include:
```
media-src 'self' blob: data:
          https://fal.media
          https://v3.fal.media
          https://v3b.fal.media
          https://*.fal.media;
```

### Option 2: Download and Convert to Blob URLs

**Approach:** Download videos from FAL and serve via blob URLs.

**Pros:**
- ✅ No external domain dependency
- ✅ Works offline after download
- ✅ More secure (no external requests during playback)

**Cons:**
- ❌ Increases download time
- ❌ Uses more browser memory/storage
- ❌ Already partially implemented but still hitting CSP

**Note:** The current implementation **already downloads videos** (line 192 in error log: "Downloaded video blob, size: 1093787"), but the video player is still trying to use the FAL URL instead of the blob URL.

### Option 3: Proxy Videos Through Electron Backend

**Approach:** Create local server in Electron to proxy FAL videos.

**Pros:**
- ✅ Complete control over video delivery
- ✅ Can cache videos locally
- ✅ No CSP issues with `'self'` origin

**Cons:**
- ❌ Complex implementation
- ❌ Requires Electron IPC setup
- ❌ Overkill for this issue

---

## Recommended Solution: Option 1 (CSP Update)

### Implementation Steps

#### Step 1: Locate CSP Configuration Files

**Electron App:**
- `electron/main.ts` - Main process CSP headers
- `electron/preload.ts` - Preload script CSP

**Web App:**
- `apps/web/index.html` - HTML meta tag CSP
- `apps/web/vite.config.ts` - Development server CSP

#### Step 2: Update Electron CSP Headers

**File**: `electron/main.ts`

Find the CSP configuration (likely in window creation or session setup):

```typescript
// BEFORE (Current)
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self';" +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval';" +
        "style-src 'self' 'unsafe-inline';" +
        "img-src 'self' blob: data: https:;" +
        "media-src 'self' blob: data:;" +  // ❌ Missing FAL domains
        "connect-src 'self' https://fal.run https://fal.ai;"
      ]
    }
  });
});

// AFTER (Fixed)
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self';" +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval';" +
        "style-src 'self' 'unsafe-inline';" +
        "img-src 'self' blob: data: https:;" +
        "media-src 'self' blob: data: " +
        "  https://fal.media " +              // ✅ Added
        "  https://v3.fal.media " +           // ✅ Added
        "  https://v3b.fal.media " +          // ✅ Added
        "  https://*.fal.media;" +            // ✅ Wildcard for all subdomains
        "connect-src 'self' https://fal.run https://fal.ai;"
      ]
    }
  });
});
```

#### Step 3: Update HTML Meta Tag CSP

**File**: `apps/web/index.html`

```html
<!-- BEFORE (Current) -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'unsafe-inline' 'unsafe-eval';
               style-src 'self' 'unsafe-inline';
               img-src 'self' blob: data: https:;
               media-src 'self' blob: data:;
               connect-src 'self' https://fal.run https://fal.ai;">

<!-- AFTER (Fixed) -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'unsafe-inline' 'unsafe-eval';
               style-src 'self' 'unsafe-inline';
               img-src 'self' blob: data: https:;
               media-src 'self' blob: data:
                         https://fal.media
                         https://v3.fal.media
                         https://v3b.fal.media
                         https://*.fal.media;
               connect-src 'self' https://fal.run https://fal.ai;">
```

#### Step 4: Update Vite Development Server CSP

**File**: `apps/web/vite.config.ts`

```typescript
// BEFORE (Current)
export default defineConfig({
  server: {
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; " +
        "media-src 'self' blob: data:;"
    }
  }
});

// AFTER (Fixed)
export default defineConfig({
  server: {
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; " +
        "media-src 'self' blob: data: " +
        "https://fal.media " +
        "https://v3.fal.media " +
        "https://v3b.fal.media " +
        "https://*.fal.media;"
    }
  }
});
```

#### Step 5: Add CSP Constants File (Best Practice)

**File**: `apps/web/src/config/csp.ts` (New file)

```typescript
/**
 * Content Security Policy Configuration
 *
 * Centralized CSP directives for consistent security policy
 * across development and production environments.
 */

export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],

  scriptSrc: [
    "'self'",
    "'unsafe-inline'", // Required for React inline scripts
    "'unsafe-eval'",   // Required for some build tools
  ],

  styleSrc: [
    "'self'",
    "'unsafe-inline'", // Required for CSS-in-JS
  ],

  imgSrc: [
    "'self'",
    "blob:",
    "data:",
    "https:",
  ],

  mediaSrc: [
    "'self'",
    "blob:",
    "data:",
    // FAL.ai video hosting domains
    "https://fal.media",
    "https://v3.fal.media",
    "https://v3b.fal.media",
    "https://*.fal.media",
  ],

  connectSrc: [
    "'self'",
    "https://fal.run",    // FAL API endpoint
    "https://fal.ai",     // FAL AI services
    "https://*.fal.ai",   // FAL AI subdomains
  ],

  fontSrc: [
    "'self'",
    "data:",
  ],

  objectSrc: ["'none'"],

  frameSrc: ["'none'"],
};

/**
 * Generate CSP header string from directives
 */
export function generateCSP(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, sources]) => {
      // Convert camelCase to kebab-case
      const kebabDirective = directive.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${kebabDirective} ${sources.join(' ')}`;
    })
    .join('; ');
}

/**
 * Get CSP for development environment
 * (may have relaxed rules for hot reload, etc.)
 */
export function getDevCSP(): string {
  return generateCSP();
}

/**
 * Get CSP for production environment
 * (stricter rules for security)
 */
export function getProdCSP(): string {
  return generateCSP();
}
```

**Usage in `electron/main.ts`:**

```typescript
import { getProdCSP } from '../apps/web/src/config/csp';

session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [getProdCSP()]
    }
  });
});
```

**Usage in `vite.config.ts`:**

```typescript
import { getDevCSP } from './src/config/csp';

export default defineConfig({
  server: {
    headers: {
      'Content-Security-Policy': getDevCSP()
    }
  }
});
```

---

## Alternative Fix: Use Blob URLs (If CSP Can't Be Changed)

If CSP policy cannot be modified, ensure videos use blob URLs instead of FAL URLs.

### Current Code Issue

**File**: `apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Problem** (Line 204 in error log):
```typescript
const mediaItem = {
  name: "AI: Car door opens...",
  type: "video",
  file: videoFile,  // ✅ Has file
  url: response.video_url,  // ❌ Still using FAL URL
  duration: 4.1,
  width: 1920,
  height: 1080
};
```

### Fix: Use Blob URL Instead

```typescript
// BEFORE (Current)
const videoFile = new File([blob], filename, { type: 'video/mp4' });

const mediaItem = {
  name: `AI: ${prompt.slice(0, 30)}...`,
  type: "video" as const,
  file: videoFile,
  url: response.video_url,  // ❌ External URL
  duration: response.video_data?.video?.duration || 0,
  width: 1920,
  height: 1080
};

// AFTER (Fixed)
const videoFile = new File([blob], filename, { type: 'video/mp4' });
const blobUrl = URL.createObjectURL(videoFile);  // ✅ Create blob URL

const mediaItem = {
  name: `AI: ${prompt.slice(0, 30)}...`,
  type: "video" as const,
  file: videoFile,
  url: blobUrl,  // ✅ Use blob URL instead
  duration: response.video_data?.video?.duration || 0,
  width: 1920,
  height: 1080,
  metadata: {
    originalUrl: response.video_url,  // ✅ Keep original URL for reference
    source: 'sora2-text-to-video',
  }
};

// Don't forget to revoke blob URL when media item is deleted
// (implement in media-store cleanup logic)
```

**Important:** Add blob URL cleanup when media items are deleted:

```typescript
// In media-store.ts
export const useMediaStore = create<MediaStore>((set, get) => ({
  removeMediaItem: (projectId: string, itemId: string) => {
    const item = get().getMediaItem(projectId, itemId);

    // Clean up blob URL if it exists
    if (item?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(item.url);
    }

    // ... rest of removal logic
  },
}));
```

---

## Testing Checklist

### Pre-Implementation Testing

- [ ] Verify current CSP configuration in DevTools
  - Open browser DevTools → Console
  - Check for CSP violation errors
  - Note blocked domains

- [ ] Document current behavior
  - Generate Sora 2 video
  - Attempt playback
  - Screenshot error messages
  - Record network requests

### Post-Implementation Testing

#### Development Environment

- [ ] **Test 1: Basic Video Playback**
  ```bash
  cd qcut
  bun run dev
  ```
  1. Navigate to AI Images panel
  2. Select "Sora 2 Text-to-Video"
  3. Enter test prompt
  4. Generate video
  5. Verify video appears in Media Panel
  6. Drag to Timeline
  7. **✅ Video should play in preview**

- [ ] **Test 2: Console Errors**
  - Open DevTools → Console
  - **✅ No CSP errors**
  - **✅ No ERR_BLOCKED_BY_RESPONSE**
  - **✅ Video loads successfully**

- [ ] **Test 3: Network Requests**
  - Open DevTools → Network tab
  - Filter by "Media"
  - **✅ FAL.ai domain requests succeed (200 OK)**
  - **✅ Video streams without errors**

#### Production Environment (Electron)

- [ ] **Test 4: Electron Build**
  ```bash
  bun run electron
  ```
  1. Generate Sora 2 video
  2. **✅ Video plays in Electron app**
  3. **✅ No console errors**

- [ ] **Test 5: Timeline Playback**
  - Add video to timeline
  - Play timeline
  - **✅ Video preview renders**
  - **✅ Audio plays (if present)**
  - Seek through video
  - **✅ Seeking works smoothly**

- [ ] **Test 6: Video Export**
  - Create project with Sora 2 video
  - Export to MP4
  - **✅ Export completes without errors**
  - **✅ Exported video contains Sora 2 content**
  - **✅ No black frames**

### Edge Cases

- [ ] **Test 7: Multiple Videos**
  - Generate 3+ Sora 2 videos
  - Add all to timeline
  - **✅ All videos play**
  - **✅ No performance degradation**

- [ ] **Test 8: Expired FAL URLs**
  - Generate video
  - Wait 24+ hours (FAL URL expires)
  - Attempt playback
  - **Expected:** Video fails (FAL URLs are temporary)
  - **Solution:** Implement local caching if needed

- [ ] **Test 9: Offline Mode**
  - Generate video while online
  - Disconnect internet
  - Attempt playback
  - **Expected:** Fails if using FAL URL
  - **✅ Works if using blob URL approach**

### Cross-Browser Testing

- [ ] Chrome/Chromium (Electron uses Chromium)
- [ ] Firefox (if web version exists)
- [ ] Edge (if web version exists)
- [ ] Safari (if macOS build exists)

---

## Security Considerations

### CSP Relaxation Risks

**Question:** Is it safe to add FAL.ai domains to CSP?

**Answer:** Yes, with caveats:

✅ **Safe because:**
- FAL.ai is a legitimate AI service provider
- Only `media-src` is relaxed (not `script-src` or other critical directives)
- Videos cannot execute code
- FAL uses HTTPS (secure transport)

⚠️ **Risks to mitigate:**
- FAL.ai could serve malicious content (very unlikely)
- Domain could be compromised (very unlikely)
- User data leakage via video URLs (URLs contain random IDs, not user data)

### Best Practices

1. **Use Specific Domains:** Prefer `https://v3b.fal.media` over `https://*.fal.media`
2. **Monitor CSP Reports:** Set up CSP reporting to catch violations
3. **Validate Video Content:** Implement virus scanning for downloaded videos (if paranoid)
4. **Implement Fallbacks:** If FAL domain is blocked, fall back to blob URLs

### CSP Reporting (Optional Enhancement)

```typescript
// Add to CSP header
"report-uri /csp-violation-report;"

// Create endpoint to log violations
app.post('/csp-violation-report', (req, res) => {
  console.error('CSP Violation:', req.body);
  // Log to monitoring service
  res.status(204).end();
});
```

---

## Alternative: Hybrid Approach (Best of Both Worlds)

Combine CSP update with blob URL caching for best user experience:

### Implementation Strategy

1. **Allow FAL domains in CSP** (for immediate playback)
2. **Download to blob URLs** (for offline access)
3. **Cache videos locally** (for persistence)

**Benefits:**
- ✅ Fast initial playback (stream from FAL)
- ✅ Offline access (blob URLs)
- ✅ Persistence (local storage/IndexedDB)

**Code Example:**

```typescript
async function handleVideoGeneration(response) {
  // 1. Add to media with FAL URL (immediate playback)
  const tempMediaItem = {
    url: response.video_url,  // FAL URL for immediate streaming
    type: 'video',
    // ...
  };
  addMediaItem(tempMediaItem);

  // 2. Download in background
  const blob = await downloadVideo(response.video_url);
  const blobUrl = URL.createObjectURL(blob);

  // 3. Update media item with blob URL
  updateMediaItem(tempMediaItem.id, {
    url: blobUrl,  // Replace with blob URL
    cached: true,
  });

  // 4. Optionally save to IndexedDB for persistence
  await saveVideoToCache(tempMediaItem.id, blob);
}
```

---

## Rollback Plan

If CSP changes cause issues:

### Quick Rollback

1. **Revert CSP changes** in all modified files
2. **Clear browser cache** and restart Electron
3. **Test without FAL domains** to confirm rollback

### Gradual Rollout

1. **Phase 1:** Enable CSP fix in development only
2. **Phase 2:** Beta test with select users
3. **Phase 3:** Roll out to all users
4. Monitor error rates at each phase

---

## Documentation Updates

After implementing fix:

### User-Facing Documentation

**File**: `docs/features/ai-video-generation.md`

```markdown
## Sora 2 Text-to-Video

### Known Limitations

- Videos are hosted on FAL.ai CDN
- Video URLs expire after 24 hours
- Videos require internet connection for initial playback
- Download videos for offline use (right-click → Save Video)

### Troubleshooting

**Video shows black screen:**
1. Check internet connection
2. Check browser console for CSP errors
3. Ensure FAL.ai domains are not blocked by firewall
4. Try regenerating the video
```

### Developer Documentation

**File**: `docs/development/csp-configuration.md`

```markdown
## Content Security Policy

### Media Source Domains

The following external domains are whitelisted for video/audio:

- `https://fal.media` - FAL.ai CDN
- `https://v3.fal.media` - FAL.ai CDN v3
- `https://v3b.fal.media` - FAL.ai CDN v3b
- `https://*.fal.media` - All FAL.ai subdomains

### Modifying CSP

To add new external media domains:

1. Update `apps/web/src/config/csp.ts`
2. Add domain to `mediaSrc` array
3. Test in development
4. Update this documentation
```

---

## Monitoring & Metrics

### Success Metrics

Track these metrics to verify fix:

1. **Video Playback Success Rate**
   - Before fix: ~0% (blocked by CSP)
   - After fix: >95% (accounting for network failures)

2. **CSP Violation Count**
   - Before fix: ~1 per video generation
   - After fix: 0

3. **User-Reported Issues**
   - Search for "black screen", "won't play", "video error"
   - Should decrease significantly

### Error Tracking

Add logging to catch CSP-related errors:

```typescript
// In video player component
const handleVideoError = (error) => {
  console.error('[VideoPlayer] Error:', {
    src: videoElement.src,
    error: error.message,
    networkState: videoElement.networkState,
    readyState: videoElement.readyState,
    cspBlocked: error.message.includes('CSP'),
  });

  // Send to monitoring service
  trackError('video_playback_error', {
    videoSrc: videoElement.src,
    errorType: error.message.includes('CSP') ? 'csp_violation' : 'other',
  });
};
```

---

## Related Issues

- **FAL API Integration**: Ensure all FAL.ai endpoints are properly whitelisted
- **Video Caching**: Implement proper video caching strategy
- **Error Handling**: Improve error messages for CSP violations
- **User Experience**: Add loading states and retry mechanisms

---

## References

- **CSP Specification**: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- **FAL.ai Documentation**: https://fal.ai/docs
- **Electron CSP Guide**: https://www.electronjs.org/docs/latest/tutorial/security
- **Original Error Log**: `sora2_text_to_video_error.md`

---

## Conclusion

The Sora 2 video playback issue is caused by **Content Security Policy blocking FAL.ai video domains**. The fix is straightforward:

### Immediate Action Required

1. ✅ **Update `media-src` CSP directive** to include FAL.ai domains
2. ✅ **Test in development environment**
3. ✅ **Deploy to production**
4. ✅ **Monitor for CSP violations**

### Expected Outcome

After implementation:
- ✅ Sora 2 videos play immediately after generation
- ✅ No CSP console errors
- ✅ Timeline preview works correctly
- ✅ Video export includes generated content
- ✅ User experience is seamless

### Timeline

- **Implementation**: 15-30 minutes
- **Testing**: 1-2 hours
- **Deployment**: Immediate (low risk)
- **Verification**: 24-48 hours of monitoring

This is a **high-priority fix** that unblocks a core feature. The implementation is low-risk and straightforward.
