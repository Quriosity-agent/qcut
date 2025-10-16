# CSP Blocking FAL Storage Upload Issue

## Issue Summary
**Date**: 2025-01-16
**Status**: Active
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

## 4. Testing After Fix

After applying the CSP fixes:

1. **Clear browser cache** (important for CSP updates)
2. **Restart the development server**: `bun dev`
3. **For Electron**: Rebuild with `bun run build` and restart
4. **Test video upload** in any of the three video edit tabs:
   - Audio Generation (Kling)
   - Audio Sync (MMAudio V2)
   - Upscale (Topaz)

### Expected Behavior
- Video should upload successfully to FAL storage
- Console should show: `"Video uploaded. URL: https://v3.fal.media/..."`
- No CSP errors in the console

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

## 6. References

- [FAL Storage Documentation](https://docs.fal.ai/model-endpoints/file-uploads)
- [Content Security Policy MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [FAL JS Client GitHub](https://github.com/fal-ai/fal-js)