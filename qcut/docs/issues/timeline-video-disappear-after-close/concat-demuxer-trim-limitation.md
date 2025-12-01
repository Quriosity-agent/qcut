# Concat Demuxer Trim Limitation - Multi-Video Export Fails

## 1. What is the Issue

**Summary**: Export fails when exporting multiple trimmed videos using the FFmpeg CLI concat demuxer in direct copy mode (Mode 1.5).

**Root Cause**: The FFmpeg concat demuxer doesn't support per-video trimming. When multiple videos are concatenated and any of them have trim values (trimStart/trimEnd), the export fails because the concat demuxer processes files sequentially without seeking/trimming support.

**Error Message**:
```
❌ [EXPORT OPTIMIZATION] FFmpeg export FAILED! Error: Error invoking remote method 'export-video-cli':
Error: Video 'video-1764207082446-e6765505bf251b04-jimeng-2025-09-08-5042.mp4' has trim values
(trimStart=0s, trimEnd=25.316667000000002s). The concat demuxer doesn't support per-video trimming
in multi-video mode. Please disable direct copy mode or pre-trim videos before export.
```

---

## 2. Relevant File Paths

| File Path | Purpose |
|-----------|---------|
| `apps/web/src/lib/export-engine-cli.ts` | CLI FFmpeg export engine with concat demuxer |
| `apps/web/src/lib/export-analysis.ts` | Export mode detection (Mode 1, 1.5, 2) |
| `electron/ffmpeg-handler.ts` | Electron IPC handler for FFmpeg CLI operations |

---

## 3. Relevant Code Parts

### 3.1 Export Mode Detection

**File**: `apps/web/src/lib/export-analysis.ts`

The export analyzer detects different modes:
- **Mode 1**: Single video, direct copy (15-48x speedup)
- **Mode 1.5**: Multiple videos with normalization (5-7x speedup) - uses concat demuxer
- **Mode 2**: Complex timeline requiring full re-encoding

```
export-analysis.ts:442 🎯 [MODE DETECTION] Direct copy eligible - 3 video(s), checking requirements...
export-analysis.ts:488 ⚡ [MODE DETECTION] Videos have different properties - using Mode 1.5: Video normalization (5-7x speedup)
```

### 3.2 The Concat Demuxer Limitation

The concat demuxer in FFmpeg concatenates files without re-encoding, which is very fast but has limitations:
- Cannot apply per-file seek/trim operations
- Files must have compatible codecs, resolution, and frame rates
- Each file is processed sequentially from start to end

When a video is trimmed (e.g., trimEnd=25.3s but video is 30s), the concat demuxer cannot skip those frames.

---

## 4. How to Fix

### Option A: Pre-Trim Videos Before Concat (Recommended)

For each trimmed video in multi-video mode, create a pre-trimmed temporary file first:

```typescript
// In export-engine-cli.ts
async function preTrimVideo(
  inputPath: string,
  trimStart: number,
  trimEnd: number,
  outputPath: string
): Promise<string> {
  // Use FFmpeg to create trimmed copy
  // ffmpeg -ss {trimStart} -i {input} -t {duration} -c copy {output}
  await window.electronAPI.ffmpeg.trimVideo({
    inputPath,
    outputPath,
    startTime: trimStart,
    duration: trimEnd - trimStart,
    copyCodec: true  // Use -c copy for fast trimming
  });
  return outputPath;
}

// Before concat, pre-trim all videos with trim values
for (const video of videosWithTrim) {
  const trimmedPath = await preTrimVideo(
    video.localPath,
    video.trimStart,
    video.trimEnd,
    `${tempDir}/trimmed_${video.id}.mp4`
  );
  video.localPath = trimmedPath;  // Use trimmed file for concat
}
```

### Option B: Fall Back to Full Re-encoding

When trimmed videos are detected in multi-video mode, fall back to Mode 2 (full re-encoding):

```typescript
// In export-analysis.ts - detect trimmed videos
const hasTrimmedVideos = videoElements.some(v =>
  v.trimStart > 0 || v.trimEnd < v.duration
);

if (hasTrimmedVideos && videoElements.length > 1) {
  console.log("⚠️ [MODE DETECTION] Trimmed videos in multi-video mode - falling back to Mode 2");
  return ExportMode.FULL_REENCODE;  // Mode 2
}
```

### Option C: Use Filter Complex with Concat Filter

Instead of concat demuxer, use the concat filter with filter_complex which supports trimming:

```bash
# Instead of concat demuxer:
ffmpeg -f concat -i filelist.txt -c copy output.mp4

# Use filter_complex with trim:
ffmpeg \
  -i video1.mp4 -i video2.mp4 -i video3.mp4 \
  -filter_complex "
    [0:v]trim=start=0:end=5,setpts=PTS-STARTPTS[v0];
    [1:v]trim=start=2:end=8,setpts=PTS-STARTPTS[v1];
    [2:v]trim=start=0:end=10,setpts=PTS-STARTPTS[v2];
    [v0][v1][v2]concat=n=3:v=1:a=0[outv]
  " \
  -map "[outv]" output.mp4
```

**Note**: This requires re-encoding, which is slower than direct copy but supports trimming.

---

## 5. Subtasks

### Subtask 1: Add Trim Detection in Export Analysis (5 min)
- [ ] In `export-analysis.ts`, detect videos with non-zero trim values
- [ ] Log warning when trimmed videos detected in multi-video mode
- [ ] Store trim info in analysis result for downstream use

### Subtask 2: Implement Pre-Trim for Multi-Video Export (15 min)
- [ ] Add `trimVideo` IPC handler in `electron/ffmpeg-handler.ts`
- [ ] In CLI export engine, pre-trim videos before concat
- [ ] Store trimmed files in session temp directory
- [ ] Clean up trimmed files after export completes

### Subtask 3: Update Concat File Generation (10 min)
- [ ] Modify concat file generation to use pre-trimmed paths
- [ ] Ensure trimmed videos have correct duration metadata
- [ ] Test with various trim combinations

### Subtask 4: Add Fallback Mode (5 min)
- [ ] If pre-trim fails, fall back to Mode 2 (full re-encode)
- [ ] Log clear message explaining the fallback reason

### Subtask 5: Test and Verify (10 min)
- [ ] Test single trimmed video export (should work - Mode 1)
- [ ] Test multiple untrimmed videos (should work - Mode 1.5)
- [ ] Test multiple trimmed videos (should now work with pre-trim)
- [ ] Test export cancel cleans up temp files

---

## 6. Console Logs (from consolev2.md)

```
export-analysis.ts:442 🎯 [MODE DETECTION] Direct copy eligible - 3 video(s), checking requirements...
export-analysis.ts:448 🔍 [MODE DETECTION] Multiple sequential videos detected - checking properties for Mode 1 vs Mode 1.5...
export-analysis.ts:466 🔍 [MODE DETECTION] Using target: 1248x704 @ 30fps (source: media-fallback)
export-analysis.ts:488 ⚡ [MODE DETECTION] Videos have different properties - using Mode 1.5: Video normalization (5-7x speedup)
export-analysis.ts:491 🎬 [MODE 1.5] Videos will be normalized to match export canvas before concatenation

export-engine-cli.ts:1531 🚀 [FFMPEG EXPORT DEBUG] ============================================
export-engine-cli.ts:1534 🚀 [FFMPEG EXPORT DEBUG] Starting FFmpeg CLI export process
export-engine-cli.ts:1550    - Direct copy mode: ENABLED
export-engine-cli.ts:1553    - Video sources: 3
export-engine-cli.ts:1577 ⏳ [FFMPEG EXPORT DEBUG] Invoking FFmpeg CLI...

❌ [EXPORT OPTIMIZATION] FFmpeg export FAILED! Error: Error invoking remote method 'export-video-cli':
Error: Video 'video-1764207082446-e6765505bf251b04-jimeng-2025-09-08-5042.mp4' has trim values
(trimStart=0s, trimEnd=25.316667000000002s). The concat demuxer doesn't support per-video trimming
in multi-video mode. Please disable direct copy mode or pre-trim videos before export.
```

---

## 7. Impact Assessment

### User Impact
- **Severity**: Medium - Workaround exists (export single videos or don't trim)
- **Frequency**: Medium - Occurs when user trims videos and tries multi-video export
- **Workaround**: Export videos individually, or use full re-encode mode

### Technical Impact
- Mode 1 (single video) works correctly
- Mode 1.5 fails with trimmed videos
- Mode 2 (full re-encode) would work but is slower

### Affected Scenarios
1. ✅ Single video, no trim → Mode 1 works
2. ✅ Single video, trimmed → Mode 1 works (trim applied via -ss/-t)
3. ✅ Multiple videos, no trim → Mode 1.5 works
4. ❌ Multiple videos, any trimmed → Mode 1.5 fails
5. ✅ Complex timeline → Mode 2 works (full re-encode)

---

## 8. Related Issues

- **Blob URL Revoked During Export**: ✅ FIXED (see `blob-url-revoked-during-export.md`)
- This issue was discovered after fixing the blob URL issue

---

## 9. Priority

**Medium** - Export works for most common scenarios (single video, untrimmed multi-video). The failing scenario (trimmed multi-video) has a workaround (use full re-encode).
