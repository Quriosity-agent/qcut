# Mode 2 FFmpeg Optimization - Manual Test Plan

**Feature**: Direct video input with FFmpeg filters (text/stickers)
**Expected Performance**: 3-5x faster than frame rendering for single video + text/stickers
**Date**: 2025-01-17
**Status**: Ready for Testing

## Prerequisites

- QCut application built and running (`bun run electron:dev` or `bun run electron`)
- Sample video files (MP4 format recommended)
- Console access to view debug logs

## Test Scenarios

### ✅ Test 1: Mode 2 - Single Video + Text Overlay

**Objective**: Verify Mode 2 optimization activates for single video with text

**Steps**:
1. Launch QCut application
2. Create new project
3. Import a single video file (e.g., 2-5 seconds duration)
4. Add the video to the timeline
5. Add a text overlay on top of the video
6. Configure text properties (content, position, styling)
7. Click "Export" and start the export process
8. Monitor console logs during export

**Expected Logs**:
```
⚡ [MODE 2 EXPORT] ============================================
⚡ [MODE 2 EXPORT] Mode 2 optimization enabled!
⚡ [MODE 2 EXPORT] Video input: [path to video]
⚡ [MODE 2 EXPORT] Text filters: YES
⚡ [MODE 2 EXPORT] Sticker filters: NO
⚡ [MODE 2 EXPORT] Frame rendering: SKIPPED (using direct video)
⚡ [MODE 2 EXPORT] Expected speedup: 3-5x faster than frame rendering
⚡ [MODE 2 EXPORT] ============================================

⚡ [MODE 2] ============================================
⚡ [MODE 2] Entering Mode 2: Direct video input with filters
⚡ [MODE 2] Video input path: [path]
⚡ [MODE 2] Text filter chain: [filter details]
⚡ [MODE 2] ✅ FFmpeg args built successfully
```

**Expected Results**:
- ✅ Export completes successfully
- ✅ Output video contains text overlay correctly positioned
- ✅ Export time: ~1-2 seconds (for 2s video)
- ✅ No frame rendering progress shown
- ✅ Console shows Mode 2 activation logs

**Performance Benchmark**:
- Record export time
- Compare with Mode 3 (frame rendering) if available

---

### ✅ Test 2: Mode 2 - Single Video + Text + Stickers

**Objective**: Verify Mode 2 handles multiple filter types (text + stickers)

**Steps**:
1. Launch QCut application
2. Create new project
3. Import a single video file
4. Add the video to the timeline
5. Add a text overlay
6. Add one or more sticker overlays
7. Click "Export" and start the export process
8. Monitor console logs during export

**Expected Logs**:
```
⚡ [MODE 2 EXPORT] Mode 2 optimization enabled!
⚡ [MODE 2 EXPORT] Text filters: YES
⚡ [MODE 2 EXPORT] Sticker filters: YES
⚡ [MODE 2 EXPORT] Frame rendering: SKIPPED

⚡ [MODE 2] Sticker overlay configuration:
⚡ [MODE 2] - Sticker count: [N]
⚡ [MODE 2] - Sticker sources validated: [N]
⚡ [MODE 2] Sticker filter chain: [filter details]
⚡ [MODE 2] Text filter chain: [filter details]
```

**Expected Results**:
- ✅ Export completes successfully
- ✅ Output video contains both text and stickers correctly positioned
- ✅ Sticker timing and opacity work correctly
- ✅ Export time: ~1-2 seconds
- ✅ Console shows Mode 2 with sticker handling

---

### ✅ Test 3: Mode 3 Fallback - Single Video + Image Element

**Objective**: Verify Mode 2 does NOT activate when images are present (requires canvas compositing)

**Steps**:
1. Launch QCut application
2. Create new project
3. Import a single video file
4. Add the video to the timeline
5. Add an image element (not a sticker)
6. Click "Export" and start the export process
7. Monitor console logs during export

**Expected Logs**:
```
🎨 [MODE 3] Frame rendering required
🎨 [MODE 3] Reason: Image processing required due to: image elements
```

**Expected Results**:
- ✅ Export completes successfully (using Mode 3)
- ✅ Output video contains image element correctly
- ✅ Frame rendering progress shown
- ✅ Export time: ~5-10 seconds (slower than Mode 2)
- ✅ Console shows Mode 3 activation (NOT Mode 2)

---

### ✅ Test 4: Mode 1 - Single Video, No Overlays

**Objective**: Verify Mode 1 (direct copy) is used when no processing is needed

**Steps**:
1. Launch QCut application
2. Create new project
3. Import a single video file
4. Add the video to the timeline (no trimming)
5. Do NOT add any overlays (text, stickers, images, effects)
6. Click "Export" and start the export process
7. Monitor console logs during export

**Expected Logs**:
```
⚡ [MODE 1] Using direct video copy
⚡ [MODE 1] Optimization: direct-copy
```

**Expected Results**:
- ✅ Export completes successfully (using Mode 1)
- ✅ Output video is identical to input video
- ✅ Export time: ~0.1-0.5 seconds (fastest mode)
- ✅ No frame rendering or filter encoding
- ✅ Console shows Mode 1 activation

---

### ✅ Test 5: Mode 2 with Trimmed Video

**Objective**: Verify Mode 2 correctly handles trimmed video input

**Steps**:
1. Launch QCut application
2. Create new project
3. Import a video file (at least 5 seconds)
4. Add the video to the timeline
5. **Trim the video** (e.g., trim first 1 second and last 1 second)
6. Add a text overlay
7. Click "Export" and start the export process
8. Monitor console logs during export

**Expected Logs**:
```
⚡ [MODE 2 EXPORT] Mode 2 optimization enabled!
⚡ [MODE 2 EXPORT] Trim start: [N]s
⚡ [MODE 2 EXPORT] Trim end: [N]s

⚡ [MODE 2] Trim settings: start=[N]s, end=[N]s
⚡ [MODE 2] Duration: [trimmed duration]s
```

**Expected Results**:
- ✅ Export completes successfully
- ✅ Output video duration matches trimmed duration
- ✅ Text overlay appears at correct times relative to trimmed video
- ✅ Export time: ~1-2 seconds
- ✅ Console shows Mode 2 with trim handling

---

### ✅ Test 6: Multiple Videos + Text (Mode 2 NOT Applicable)

**Objective**: Verify Mode 2 does NOT activate for multiple videos

**Steps**:
1. Launch QCut application
2. Create new project
3. Import TWO video files
4. Add both videos to the timeline (either overlapping or sequential)
5. Add a text overlay
6. Click "Export" and start the export process
7. Monitor console logs during export

**Expected Logs**:
```
🎨 [MODE 3] Frame rendering required
🎨 [MODE 3] Reason: Image processing required due to: overlapping videos
```
OR
```
⚡ [MODE 1] Using direct video copy (for sequential videos without text)
```

**Expected Results**:
- ✅ Export completes successfully (using Mode 1 or Mode 3, NOT Mode 2)
- ✅ Output video contains both videos and text correctly
- ✅ Console does NOT show Mode 2 activation
- ✅ Export uses appropriate mode based on video arrangement

---

## Performance Benchmarks

Record export times for each test scenario:

| Test | Mode | Video Duration | Export Time | Notes |
|------|------|----------------|-------------|-------|
| Test 1 | Mode 2 | ___s | ___s | Single video + text |
| Test 2 | Mode 2 | ___s | ___s | Single video + text + stickers |
| Test 3 | Mode 3 | ___s | ___s | Single video + image (fallback) |
| Test 4 | Mode 1 | ___s | ___s | Single video, no overlays |
| Test 5 | Mode 2 | ___s | ___s | Trimmed video + text |
| Test 6 | Mode 3 | ___s | ___s | Multiple videos + text |

**Expected Performance**:
- **Mode 1** (direct copy): ~0.1-0.5s
- **Mode 2** (direct video with filters): ~1-2s
- **Mode 3** (frame rendering): ~5-10s

**Target Verification**: Mode 2 should be **3-5x faster** than Mode 3

---

## Debug Log Checklist

For each test, verify these logs appear in the correct mode:

### Mode 1 Logs
- [ ] `⚡ [MODE 1] Using direct video copy`
- [ ] `⚡ [MODE 1] Optimization: direct-copy`

### Mode 2 Logs
- [ ] `⚡ [MODE 2 EXPORT] Mode 2 optimization enabled!`
- [ ] `⚡ [MODE 2 EXPORT] Video input: [path]`
- [ ] `⚡ [MODE 2 EXPORT] Frame rendering: SKIPPED (using direct video)`
- [ ] `⚡ [MODE 2 EXPORT] Expected speedup: 3-5x faster than frame rendering`
- [ ] `⚡ [MODE 2] Entering Mode 2: Direct video input with filters`
- [ ] `⚡ [MODE 2] Video input path: [path]`
- [ ] `⚡ [MODE 2] ✅ FFmpeg args built successfully`

### Mode 3 Logs
- [ ] `🎨 [MODE 3] Frame rendering required`
- [ ] `🎨 [MODE 3] Reason: [reason]`

---

## Known Issues / Edge Cases

1. **Sticker File Not Found**: If sticker files are missing, Mode 2 should skip the sticker or fall back gracefully
2. **Audio Mixing**: Verify audio timing is correct with sticker inputs (audio index calculation)
3. **Filter Chain Errors**: If FFmpeg filter chain is invalid, export should fail with clear error message
4. **Video File Path Spaces**: Verify Mode 2 works with video paths containing spaces

---

## Regression Testing

After completing Mode 2 tests, verify existing functionality still works:

- [ ] Mode 1 (direct copy) still works for simple video exports
- [ ] Mode 3 (frame rendering) still works for complex compositions
- [ ] Audio mixing works correctly in all modes
- [ ] Export quality settings work correctly
- [ ] Export cancellation works correctly

---

## Test Results Summary

**Date Tested**: ___________
**Tested By**: ___________
**Application Version**: ___________

### Overall Status
- [ ] All tests passed
- [ ] Some tests failed (see details below)
- [ ] Ready for production
- [ ] Requires fixes before release

### Failed Tests
List any failed tests and issues encountered:

1. ___________________________________________
2. ___________________________________________
3. ___________________________________________

### Performance Notes
___________________________________________
___________________________________________

### Additional Comments
___________________________________________
___________________________________________

---

## Next Steps After Testing

1. **If all tests pass**: Update documentation and prepare for merge
2. **If performance is slower than expected**: Profile FFmpeg execution and optimize filter chains
3. **If tests fail**: Create bug reports with detailed logs and reproduction steps
4. **If Mode 2 doesn't activate when expected**: Check export analysis logic and video input extraction

---

## Contact & Support

For issues or questions about this test plan:
- Check implementation documentation: `text_export_debug_analysis.md`
- Review debug logs in console for detailed error messages
- Verify FFmpeg is properly installed and accessible
