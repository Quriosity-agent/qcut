# Implementation Plan: Fix Audio Missing from Video Exports

**Created:** 2026-02-11
**Priority:** High
**Bug Report:** [fix-audio-export-bug.md](./fix-audio-export-bug.md)
**Estimated Subtasks:** 5 (each ≤ 20 minutes)

---

## Summary

Exported videos have no audio due to 3 root causes:
1. `getAudioElements()` ignores audio embedded in video files on `"video"` tracks
2. Mode 1.5 (normalization + concat) explicitly throws on audio
3. `includeAudio` checkbox value is never read by the export engine

---

## Subtask 1: Wire `includeAudio` flag through CLIExportEngine

**Files:**
- `apps/web/src/lib/export-engine-cli.ts` (lines 162-234, 440-582)
- `apps/web/src/lib/audio-export-config.ts` (lines 50-52)

**Problem:** The export dialog sets `audioExportConfig.enabled` via `setAudioExportConfig()` (export-dialog.tsx:191-195) and passes `includeAudio` in the options object (export-dialog.tsx:213), but `CLIExportEngine.prepareAudioFiles()` never checks either value. It always collects audio unconditionally.

**Fix:**
1. In `exportWithCLI()` (~line 451), check the audio config before calling `prepareAudioFiles()`:
   ```typescript
   import { getAudioExportConfig } from "@/lib/audio-export-config";

   // In exportWithCLI():
   const audioConfig = getAudioExportConfig();
   let audioFiles: AudioFileInput[] = [];
   if (audioConfig.enabled) {
     audioFiles = await this.prepareAudioFiles();
   } else {
     debugLog("[CLI] Audio disabled by user, skipping audio preparation");
   }
   ```
2. Keep all existing validation logic (lines 477-582) gated behind the same condition — no need to validate empty arrays.

**Tests:**
- `apps/web/src/lib/__tests__/export-engine-cli-audio.test.ts`
  - Test: `prepareAudioFiles()` is NOT called when `audioConfig.enabled === false`
  - Test: `prepareAudioFiles()` IS called when `audioConfig.enabled === true` (default)
  - Test: exported FFmpeg args contain no `-i audio` entries when audio disabled

**Verification:** Export with "Include Audio" unchecked → no audio preparation logged. Export with it checked → audio prepared normally.

---

## Subtask 2: Fix `getAudioElements()` to include video tracks with audio

**Files:**
- `apps/web/src/stores/timeline-store-operations.ts` (lines 514-540)
- `apps/web/src/types/timeline.ts` (TimelineTrack type definition)

**Problem:** `getAudioElements()` only iterates tracks where `track.type === "audio" || track.type === "media"`. Video elements placed on `"video"` type tracks that contain embedded audio streams are completely skipped. This is the primary reason audio is missing.

**Fix:**
1. Expand the track type filter to also include `"video"` tracks:
   ```typescript
   getAudioElements: (): Array<{...}> => {
     const { tracks } = get();
     const audioElements: Array<{...}> = [];
     for (const track of tracks) {
       // Include video tracks — video files often contain audio streams
       if (
         track.type === "audio" ||
         track.type === "media" ||
         track.type === "video"
       ) {
         for (const element of track.elements) {
           if (element.type === "media") {
             audioElements.push({
               element,
               trackId: track.id,
               absoluteStart: element.startTime,
             });
           }
         }
       }
     }
     return audioElements;
   },
   ```
2. This change is safe because `prepareAudioFiles()` already fetches the media file by `mediaId` and saves it as-is. FFmpeg handles audio extraction from video containers natively.

**Why not probe for audio streams first?** Probing would require an IPC round-trip per video file in the renderer process, adding latency. FFmpeg already handles video files that have no audio stream gracefully (it ignores missing audio). The current approach of "pass all media files, let FFmpeg sort it out" is simpler and more robust.

**Tests:**
- `apps/web/src/stores/__tests__/timeline-store-audio.test.ts`
  - Test: `getAudioElements()` returns elements from `"audio"` tracks
  - Test: `getAudioElements()` returns elements from `"media"` tracks
  - Test: `getAudioElements()` returns elements from `"video"` tracks (NEW)
  - Test: `getAudioElements()` does NOT return elements from `"text"` or `"captions"` tracks
  - Test: `getAudioElements()` only includes `element.type === "media"` elements (skips text overlays on video tracks)

**Verification:** Add a video-with-audio to the timeline on a default video track. Export → audio should be present.

---

## Subtask 3: Fix `hasAudio` detection in export dialog

**Files:**
- `apps/web/src/components/export-dialog.tsx` (lines 72-75)

**Problem:** The `hasAudio` check that controls the "Include Audio" checkbox visibility only looks for `track.type === "audio"` tracks. If the user has video files with embedded audio (on video/media tracks) but no dedicated audio track, the checkbox is hidden. The user can't even see the audio option.

**Fix:**
1. Update `hasAudio` to also check for media elements on video/media tracks:
   ```typescript
   const hasAudio = tracks.some(
     (track) =>
       (track.type === "audio" && track.elements.length > 0) ||
       ((track.type === "media" || track.type === "video") &&
         track.elements.some((el) => el.type === "media"))
   );
   ```
2. This mirrors the logic in the updated `getAudioElements()` from Subtask 2.

**Tests:**
- `apps/web/src/components/__tests__/export-dialog-audio.test.ts`
  - Test: `hasAudio` is `true` when audio track has elements
  - Test: `hasAudio` is `true` when video track has media elements (NEW)
  - Test: `hasAudio` is `false` when only text/caption tracks exist
  - Test: Audio checkbox renders when `hasAudio` is `true`
  - Test: Audio checkbox is hidden when `hasAudio` is `false`

**Verification:** Add video-with-audio on a video track (no separate audio track) → "Audio Export" section should be visible.

---

## Subtask 4: Implement Mode 1.5 audio support

**Files:**
- `electron/ffmpeg-handler.ts` (lines 545-553, and ~460-555 Mode 1.5 block)
- `electron/ffmpeg/utils.ts` (lines 554-630, `probeVideoFile()`)
- `electron/ffmpeg/types.ts` (line 233, `VideoProbeResult`)

**Problem:** Mode 1.5 (video normalization + concat) explicitly throws an error when audio files are present (line 550). This means any export that uses the normalization path silently loses audio or falls back.

**Fix — Two-pass approach:**
1. **Remove the throw** (lines 546-553). Replace with audio handling.
2. **Add `hasAudio` field to `VideoProbeResult`** in `electron/ffmpeg/types.ts`:
   ```typescript
   export interface VideoProbeResult {
     path: string;
     codec: string;
     width: number;
     height: number;
     pix_fmt: string;
     fps: string;
     hasAudio: boolean; // NEW
   }
   ```
3. **Update `probeVideoFile()`** in `electron/ffmpeg/utils.ts` to detect audio streams:
   ```typescript
   const audioStream = probeData.streams?.find(
     (s: any) => s.codec_type === "audio"
   );
   resolve({
     ...existingFields,
     hasAudio: !!audioStream,
   });
   ```
4. **After Mode 1.5 concat**, add audio muxing pass:
   ```typescript
   // After concat completes successfully:
   if (audioFiles && audioFiles.length > 0) {
     // Second FFmpeg pass: mux audio into concatenated video
     const tempConcatOutput = concatOutputPath; // rename to temp
     const finalOutput = outputPath;
     // ffmpeg -i concat.mp4 -i audio1.mp3 [-i audio2.mp3 ...]
     //   -map 0:v -map 1:a [-filter_complex amix] -c:v copy -c:a aac finalOutput
   }
   ```
   The video stream is copied (`-c:v copy`) so there's no re-encoding penalty. Only the audio is encoded.

5. **Alternative simpler approach**: If only source videos contain audio (no separate audio track files), extract audio during normalization by NOT stripping it. The current normalization uses `-an` (audio none) — removing that flag preserves the original audio through concat. This avoids a second pass entirely.

**Recommended approach:** Start with option 5 (remove `-an` from normalization). If separate audio track files also need mixing, add option 4 as a follow-up.

**Tests:**
- `electron/__tests__/ffmpeg-handler-mode15-audio.test.ts`
  - Test: Mode 1.5 does NOT throw when audio files are present
  - Test: `probeVideoFile()` returns `hasAudio: true` for video with audio stream
  - Test: `probeVideoFile()` returns `hasAudio: false` for video-only file
  - Test: Mode 1.5 output contains audio when source videos have audio
  - Test: Mode 1.5 output contains audio when separate audio files provided

**Verification:** Export multiple videos with different resolutions (triggers Mode 1.5 normalization). Verify output has audio track via `ffprobe output.mp4`.

---

## Subtask 5: Add audio stream detection to video normalization

**Files:**
- `electron/ffmpeg/utils.ts` (lines 636-650+, `normalizeVideo()` function)
- `electron/ffmpeg-handler.ts` (Mode 1.5 normalization calls)

**Problem:** The `normalizeVideo()` function may use `-an` flag to strip audio during normalization. When videos are normalized individually and then concatenated, any embedded audio is lost before concatenation even happens.

**Fix:**
1. Check if `normalizeVideo()` uses `-an` flag. If so, conditionally remove it when audio should be preserved:
   ```typescript
   // In normalizeVideo(), only strip audio when explicitly requested:
   if (!preserveAudio) {
     args.push("-an");
   }
   ```
2. In Mode 1.5 handler, pass `preserveAudio: true` when audio files are expected or when any source video has audio (detected via `probeVideoFile()`).
3. When concatenating normalized videos that each have audio, FFmpeg's concat demuxer handles audio concatenation automatically if all audio streams have matching codec/sample rate. If they don't match, add `-c:a aac -b:a 128k` to re-encode during concat.

**Tests:**
- `electron/__tests__/ffmpeg-normalize-audio.test.ts`
  - Test: `normalizeVideo()` preserves audio when `preserveAudio: true`
  - Test: `normalizeVideo()` strips audio when `preserveAudio: false`
  - Test: Normalized videos with audio can be concatenated
  - Test: Mixed audio codecs are re-encoded to AAC during concat

**Verification:** Export 2+ videos with different resolutions and embedded audio → output has continuous audio.

---

## Execution Order

| Order | Subtask | Why This Order |
|-------|---------|----------------|
| 1 | **Subtask 2**: Fix `getAudioElements()` | Highest impact — unblocks audio collection for ALL export modes |
| 2 | **Subtask 3**: Fix `hasAudio` detection | Quick win — makes audio checkbox visible for video-with-audio |
| 3 | **Subtask 1**: Wire `includeAudio` flag | Respects user preference, prevents unnecessary work |
| 4 | **Subtask 4**: Mode 1.5 audio support | Removes the explicit error throw, enables normalization exports |
| 5 | **Subtask 5**: Audio in normalization | Deep fix for Mode 1.5 audio preservation through normalize+concat |

Subtasks 1-3 are frontend-only (renderer process). Subtasks 4-5 are Electron main process.

---

## Integration Test Plan

After all subtasks are complete, run these end-to-end scenarios:

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Single video with embedded audio, "Include Audio" checked | Output has audio |
| 2 | Single video with embedded audio, "Include Audio" unchecked | Output has NO audio |
| 3 | Video + separate audio track on audio track | Output has mixed audio |
| 4 | Multiple videos with same resolution (Mode 1 concat) | Output has audio |
| 5 | Multiple videos with different resolution (Mode 1.5 normalization) | Output has audio |
| 6 | Video + text overlays + audio (Mode 2 filters) | Output has audio |
| 7 | Video without audio stream, no audio track | No audio section in export dialog |
| 8 | Verify with `ffprobe output.mp4` | Audio stream present in scenarios 1, 3-6 |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Video files without audio streams cause FFmpeg errors | Medium | FFmpeg handles missing audio gracefully; `-map 0:a?` (optional) prevents errors |
| Mode 1.5 audio sync drift after normalization | Low | Use `-async 1` or `-af aresample=async=1` to fix sync |
| Large audio files slow down export preparation | Low | Already uses concurrent workers (4 parallel fetches) |
| `getAudioElements()` returns duplicates if video on both media+video tracks | Low | Deduplicate by element ID before sending to FFmpeg |
| Breaking change if audio was intentionally excluded | None | `includeAudio` defaults to `true`, matching previous implicit behavior |
