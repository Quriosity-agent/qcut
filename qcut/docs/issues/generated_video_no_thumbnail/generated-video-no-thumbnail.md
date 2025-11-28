# AI Generated Video Missing Thumbnail

## Status: OPEN

**Created:** 2025-11-28

## Summary

AI-generated videos added to the media library display a generic video icon instead of an actual thumbnail preview. This makes it difficult to identify and distinguish between different generated videos at a glance.

## Screenshot

![Missing video thumbnails](./electron_ZRc3gtaP0P.png)

## Problem Description

When AI-generated videos are added to the media panel, some videos show:
- A generic camera/video icon
- Duration label (e.g., "0:05", "0:06", "0:10")
- No actual frame preview from the video content

This contrasts with other media items that correctly display thumbnail previews.

## Affected Items (from screenshot)

| Item | Has Thumbnail | Notes |
|------|---------------|-------|
| `kling.mp4...mp4` | Yes | Shows actual video frame |
| `AI: 漂亮小姐姐cospl...` (0:05) | No | Generic video icon |
| `AI: 漂亮小姐姐cospl...` (0:06) | No | Generic video icon |
| `AI: 漂亮小姐姐cospl...` (0:05) | No | Generic video icon |

## Expected Behavior

All video files in the media library should display a thumbnail preview showing an actual frame from the video (typically the first frame or a frame from early in the video).

## Possible Causes

1. **Thumbnail generation not triggered** - The thumbnail extraction process may not be running for AI-generated videos
2. **Video URL vs local file** - AI videos may still be referenced by URL rather than downloaded locally
3. **FFmpeg not processing** - The FFmpeg thumbnail extraction may be failing silently
4. **Async timing issue** - Thumbnail may be generated after the UI renders and not updated
5. **Video format incompatibility** - Certain video codecs may not be supported for thumbnail extraction

## Files to Investigate

- `apps/web/src/components/editor/media-panel/` - Media panel components
- `apps/web/src/lib/ffmpeg-utils.ts` - FFmpeg video processing utilities
- `apps/web/src/stores/media-store.ts` - Media state management
- AI video generation handlers that add videos to media library

## Priority

Medium - Affects user experience and media organization

## Related

- Media panel thumbnail generation
- AI Video generation workflow
- FFmpeg WebAssembly integration
