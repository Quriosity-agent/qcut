# Fix: Audio Missing from Video Exports

**Created:** 2026-02-11
**Priority:** High
**Status:** Not started

## Problem

When exporting video with audio in QCut, the exported video has no audio.

## Root Causes

### 1. `getAudioElements()` — likely NOT the issue (re-evaluated)

**File:** `apps/web/src/stores/timeline-store-operations.ts`

The function collects audio from tracks typed as `"audio"` or `"media"`. Since `TrackType` is `"media" | "text" | "audio" | "sticker" | "captions" | "remotion"` (no `"video"` type exists), video files already live on `"media"` tracks and ARE covered by the filter. This root cause was initially misdiagnosed.

```typescript
if (track.type === "audio" || track.type === "media") {
  if (element.type === "media") {
    // collect audio — already covers video files on media tracks
  }
}
```

**Impact:** If `getAudioElements()` returns empty, the issue is more likely in `prepareAudioFiles()` processing or downstream FFmpeg invocation, not the track type filter.

### 2. Mode 1.5 explicitly blocks audio

**File:** `electron/ffmpeg-handler.ts` (lines ~545-553)

Mode 1.5 (video normalization + concat) throws an error if audio files are present:

```typescript
if (audioFiles && audioFiles.length > 0) {
  console.warn("Audio mixing not yet implemented for Mode 1.5");
  throw new Error("Audio mixing not supported in Mode 1.5");
}
```

**Impact:** Any export using the normalization path silently loses audio or falls back without it.

### 3. `includeAudio` checkbox is never enforced

**File:** `apps/web/src/components/export-dialog.tsx` (lines ~64-75, 690-723)

The export dialog has an `includeAudio` toggle that passes `audioEnabled` to `handleExport`, but the CLI export engine never checks this flag. It's stored in settings but never used to conditionally skip or include audio.

**Impact:** User's audio preference is silently ignored.

## Where Audio Gets Lost (by export mode)

### Path 1: CLI Export (main path)
1. `export-engine-cli.ts` calls `prepareAudioFiles()` (line ~451)
2. `prepareAudioFiles()` calls `useTimelineStore.getState().getAudioElements()` (line ~167)
3. `getAudioElements()` returns empty if no dedicated audio tracks exist or audio is embedded in videos
4. FFmpeg called without audio files
5. **Result:** No audio in output

### Path 2: Mode 1.5 (video normalization)
1. Export determines `optimizationStrategy === "video-normalization"`
2. `buildFFmpegArgs()` receives `audioFiles` parameter
3. If `audioFiles.length > 0`, it throws an error
4. **Result:** Export fails or falls back; audio is lost

### Path 3: Mode 2 (direct video + filters)
1. Audio files ARE properly handled in FFmpeg args (lines ~1110-1148)
2. Audio inputs added with `-i audioFile.path`
3. Audio mixed with `amix` filter
4. BUT: Only works if `prepareAudioFiles()` actually returned audio files
5. **Result:** If `getAudioElements()` returns empty, no audio to add

## Key Files

| File | Concern |
|------|---------|
| `apps/web/src/stores/timeline-store-operations.ts` | `getAudioElements()` implementation |
| `apps/web/src/lib/export-engine-cli.ts` | `prepareAudioFiles()` — line ~167 |
| `electron/ffmpeg-handler.ts` | Mode 1.5 throws on audio (line ~545); Mode 1 audio args (line ~1189); Mode 2 audio args (line ~1110) |
| `apps/web/src/components/export-dialog.tsx` | `includeAudio` flag not enforced (line ~64) |

## Proposed Fix

### Phase 1: Verify audio collection (may not need changes)
1. `getAudioElements()` already filters `track.type === "audio" || track.type === "media"`. Since `TrackType` has no `"video"` — video files live on `"media"` tracks — collection already covers them.
2. Investigate `prepareAudioFiles()` to verify it correctly extracts audio from video containers via FFmpeg.

### Phase 2: Fix Mode 1.5 audio support
1. After video concat in Mode 1.5, add a second FFmpeg pass to mux audio
2. Or: extract audio from source videos before normalization, then mix after concat
3. Remove the `throw new Error("Audio mixing not supported in Mode 1.5")`

### Phase 3: Wire up `includeAudio` flag
1. In `CLIExportEngine`, check `settings.audioEnabled` before calling `prepareAudioFiles()`
2. If `audioEnabled === false`, pass empty audio array to FFmpeg
3. If `audioEnabled === true` (default), collect and include audio as normal

## Verification

1. Add a video with audio to the timeline
2. Export with "Include Audio" checked
3. Verify exported file contains audio track (`ffprobe output.mp4`)
4. Test with: single video, multiple videos, video + separate audio track
5. Test all 3 export modes (Mode 1 direct copy, Mode 1.5 normalization, Mode 2 filters)
