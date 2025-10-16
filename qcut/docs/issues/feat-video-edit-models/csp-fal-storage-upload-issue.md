# CSP Blocking FAL Storage Upload Issue

## Issue Summary
**Date**: 2025-01-16
**Status**: Fixed (Requires Browser Cache Clear)
**Severity**: High
**Component**: Video Edit Models - FAL Storage Upload

## 1. What's Happening

The Content Security Policy (CSP) is blocking video uploads to FAL's storage service. When the application attempts to upload videos to FAL storage before processing, the browser blocks the request with the following error:

```
Refused to connect to 'https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3'
because it violates the following Content Security Policy directive: "connect-src ..."
```

### Root Cause
The FAL SDK uses `https://rest.alpha.fal.ai` for file uploads, but this domain is not included in the application's CSP `connect-src` directive.

### Current CSP connect-src Directive
```
connect-src 'self' blob: app: http://localhost:8080 ws: wss:
  https://fonts.googleapis.com
  https://fonts.gstatic.com
  https://api.github.com
  https://fal.run
  https://queue.fal.run
  https://fal.media
  https://v3.fal.media
  https://v3b.fal.media
  https://api.iconify.design
  https://api.simplesvg.com
  https://api.unisvg.com
  https://freesound.org
  https://cdn.freesound.org
```

**Missing**: `https://rest.alpha.fal.ai`

## 2. How to Fix

### Solution: Add FAL Storage Domain to CSP

Add `https://rest.alpha.fal.ai` to the `connect-src` directive in both configuration files.

#### Fix 1: Update Web Development CSP
File: `apps/web/index.html`

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self' blob: data: app:;
  script-src 'self' 'unsafe-inline' blob: app:;
  worker-src 'self' blob: app:;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' blob: app: http://localhost:8080 ws: wss:
    https://fonts.googleapis.com
    https://fonts.gstatic.com
    https://api.github.com
    https://fal.run
    https://queue.fal.run
    https://rest.alpha.fal.ai
    https://fal.media
    https://v3.fal.media
    https://v3b.fal.media
    https://api.iconify.design
    https://api.simplesvg.com
    https://api.unisvg.com
    https://freesound.org
    https://cdn.freesound.org;
  media-src 'self' blob: data: app:
    https://freesound.org
    https://cdn.freesound.org
    https://fal.media
    https://v3.fal.media
    https://v3b.fal.media;
  img-src 'self' blob: data: app:
    https://fal.run
    https://fal.media
    https://v3.fal.media
    https://v3b.fal.media
    https://api.iconify.design
    https://api.simplesvg.com
    https://api.unisvg.com
    https://avatars.githubusercontent.com;
">
```

#### Fix 2: Update Electron CSP
File: `electron/main.ts` (around line 253)

```typescript
"connect-src 'self' blob: app: http://localhost:8080 ws: wss: " +
  "https://fonts.googleapis.com " +
  "https://fonts.gstatic.com " +
  "https://api.github.com " +
  "https://fal.run " +
  "https://queue.fal.run " +
  "https://rest.alpha.fal.ai " +  // Add this line
  "https://fal.media " +
  "https://v3.fal.media " +
  "https://v3b.fal.media " +
  "https://api.iconify.design " +
  "https://api.simplesvg.com " +
  "https://api.unisvg.com " +
  "https://freesound.org " +
  "https://cdn.freesound.org; "
```

## 3. Relevant File Paths

### Files That Need Modification
1. **Web CSP Configuration**: `apps/web/index.html:6`
2. **Electron CSP Configuration**: `electron/main.ts:253`

### Related Implementation Files
- **Video Edit Client**: `apps/web/src/lib/video-edit-client.ts`
  - Contains `uploadVideo()` method at line 175
  - Uses `fal.storage.upload()` which requires `https://rest.alpha.fal.ai`

- **Processing Hook**: `apps/web/src/components/editor/media-panel/views/use-video-edit-processing.ts`
  - Calls `videoEditClient.uploadVideo()` at lines 186, 238, 287

### FAL API Endpoints Used
- **Storage Upload**: `https://rest.alpha.fal.ai/storage/upload/initiate`
- **Queue Processing**: `https://queue.fal.run/fal-ai/*`
- **Media CDN**: `https://fal.media`, `https://v3.fal.media`, `https://v3b.fal.media`

## 4. Testing After Fix - IMPORTANT STEPS

### ⚠️ Browser Cache Issue
**The browser caches CSP headers aggressively.** Even after fixing the files, you may still see the error until the cache is cleared.

### Required Steps to Apply Fix:

#### For Web Development (localhost:5173)
1. **Stop the development server** (Ctrl+C)
2. **Clear ALL browser data for localhost:5173**:
   - Open Chrome DevTools (F12)
   - Go to Application tab
   - Click "Clear site data" button
   - OR: Settings > Privacy > Clear browsing data > Select "Cached images and files"
3. **Restart the development server**:
   ```bash
   cd qcut
   bun dev
   ```
4. **Hard refresh the page**:
   - Windows/Linux: `Ctrl + Shift + R`
   - Mac: `Cmd + Shift + R`
   - OR: Open DevTools, right-click refresh button, select "Empty Cache and Hard Reload"

#### Alternative Method - Incognito Mode
1. Close all incognito windows
2. Open a new incognito window (Ctrl+Shift+N)
3. Navigate to `http://localhost:5173`
4. Test the video upload

#### For Electron App
1. **Rebuild the application**:
   ```bash
   cd qcut
   bun run build
   ```
2. **Run the Electron app**:
   ```bash
   bun run electron
   ```

### Console Messages for Debugging

#### Error Message (Before Fix Applied):
```
Refused to connect to 'https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3'
because it violates the following Content Security Policy directive: "connect-src 'self' blob: app:
http://localhost:8080 ws: wss: https://fonts.googleapis.com https://fonts.gstatic.com
https://api.github.com https://fal.run https://queue.fal.run https://fal.media https://v3.fal.media
https://v3b.fal.media https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com
https://freesound.org https://cdn.freesound.org"
```
**Note**: Missing `https://rest.alpha.fal.ai` in the list

#### Success Messages (After Fix Applied):
```
Uploading video to FAL storage...
Video uploaded. URL: https://v3.fal.media/files/...
Calling videoEditClient.generateKlingAudio with params: {video_url: "https://v3.fal.media/files/..."}
Queue update received: {status: "IN_PROGRESS", request_id: "..."}
```

### Verify CSP is Updated

Open DevTools Console and run:
```javascript
// Check current CSP
const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
console.log(meta.content.includes('https://rest.alpha.fal.ai') ? '✅ CSP Updated' : '❌ CSP Not Updated');
```

If it shows "❌ CSP Not Updated", the browser is still using cached headers.

## 5. Additional Context

### Why This Happened
The FAL SDK recently updated their storage infrastructure to use `rest.alpha.fal.ai` for file uploads. Our CSP was configured for the older endpoints but not the new storage upload endpoint.

### Security Consideration
Adding `https://rest.alpha.fal.ai` to the CSP is safe because:
- It's an official FAL AI domain
- It's only used for uploading user videos to process
- The domain is HTTPS-only
- FAL is a trusted AI service provider

### Alternative Solution (Not Recommended)
If CSP modification is not possible, you could proxy the uploads through your backend, but this would:
- Add latency (500ms+)
- Increase server load
- Complicate the architecture

## 6. Troubleshooting

### Issue: Still Seeing CSP Error After Fix

**Symptoms**:
- CSP error persists even after updating `index.html`
- Console shows old CSP without `https://rest.alpha.fal.ai`

**Solutions**:
1. **Force Refresh**: Hold Shift while clicking refresh
2. **Clear Site Data**: DevTools > Application > Clear Site Data
3. **Use Incognito Mode**: Test in a fresh incognito window
4. **Restart Dev Server**: Stop with Ctrl+C and restart with `bun dev`
5. **Check File Saved**: Verify `index.html` line 6 includes `https://rest.alpha.fal.ai`

### Issue: Network Tab Shows 422 Error

**Symptoms**:
- CSP passes but API returns 422 Unprocessable Entity
- Error body contains validation details

**Solutions**:
1. Check video format (must be `.mp4` or `.mov`)
2. Verify video duration (3-20 seconds for Kling)
3. Ensure video file size is under 100MB
4. Check prompts are under 200 characters

### Issue: Upload Succeeds but Processing Fails

**Symptoms**:
- Video uploads to FAL storage successfully
- Processing starts but fails with error

**Solutions**:
1. Check FAL API key is valid
2. Verify you have sufficient credits
3. Check video meets model requirements
4. Review error details in console

## 7. References

- [FAL Storage Documentation](https://docs.fal.ai/model-endpoints/file-uploads)
- [Content Security Policy MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [FAL JS Client GitHub](https://github.com/fal-ai/fal-js)
- [Chrome DevTools - Clear Cache](https://developer.chrome.com/docs/devtools/network/reference#clear-cache)