# Export Performance & Audio Issues

## Issue 1: "No Cut" Videos Export Very Slowly

### Problem Summary

**Symptom:** Videos with no cuts, edits, or overlays still take 30-60 seconds to export when they should be nearly instant.

**Root Cause:** Videos without filesystem paths (`localPath`) cannot use FFmpeg's direct copy optimization, forcing the system to render every single frame.

### Why This Happens

When you import a video from a URL or use generated/processed videos:
1. The video is stored as a `blob://` URL in memory
2. The `localPath` property remains `null` or `undefined`
3. FFmpeg's direct copy feature requires filesystem access
4. Without `localPath`, the system falls back to frame-by-frame rendering

### Performance Impact

| Video Length | With Direct Copy | Without Direct Copy (Current) |
|--------------|------------------|-------------------------------|
| 5 seconds | ~1 second | ~15-20 seconds |
| 10 seconds | ~2 seconds | ~30-40 seconds |
| 30 seconds | ~3 seconds | ~90-120 seconds |
| 60 seconds | ~5 seconds | ~180-240 seconds |

**Why it's slow:**
- Rendering creates 30 PNG frames per second
- Each frame is ~500KB-2MB
- Canvas drawing + encoding overhead
- Disk I/O for each frame

### Console Indicators

Look for these messages during export:

```
⚠️ [EXPORT ANALYSIS] Some videos lack localPath - direct copy disabled
📝 [EXPORT ANALYSIS] Videos without localPath: Array(1)
📝 [EXPORT OPTIMIZATION] Strategy: image-pipeline
🎨 [EXPORT OPTIMIZATION] Cannot use direct copy - RENDERING FRAMES
📝 [EXPORT OPTIMIZATION] Reason: Image processing required due to: videos without filesystem paths
[CLI] Rendering 300 frames to disk...  ← SLOW!
```

If you see direct copy being used:
```
✅ [EXPORT ANALYSIS] All videos have localPath - direct copy available
📝 [EXPORT OPTIMIZATION] Strategy: direct-copy
⚡ [EXPORT OPTIMIZATION] Using direct video copy - skipping frame rendering
```

### Solution Options

#### Option A: Save Videos to Temp Files on Import (BEST)

Automatically save imported videos to temporary filesystem locations:

**Benefits:**
- Fast exports every time
- Works with all video sources
- FFmpeg can access original video quality

**Implementation needed in:**
- Media import handlers
- Electron IPC handlers for temp file management

#### Option B: Convert Blob to Temp File During Export

Save blob videos to temp files just before export:

**Benefits:**
- Doesn't change import behavior
- Only creates temp files when needed

**Drawbacks:**
- Adds time to export process
- Extra disk I/O

#### Option C: Import from Local Files

**Workaround (available now):**
- Don't import from URLs
- Use "Import Video" to select local files
- Videos imported from filesystem have `localPath` automatically

### What Needs to Be Fixed

1. **Add temp file creation for blob videos**
2. **Store localPath alongside blob URL**
3. **Clean up temp files after export**
4. **Handle temp file lifecycle properly**

---

## Issue 2: Audio Missing from Exported Videos

### Problem Summary

**Symptom:** Exported video has no audio, even though the timeline shows audio tracks and preview plays audio correctly.

**Potential Causes:** Multiple issues can cause audio loss.

### Diagnostic Console Messages

The following console messages help identify the audio issue:

#### Audio File Preparation
```
[CLI Export] Initial audio files count: X
[CLI Export] Audio file 0: { path: "...", startTime: X, volume: X }
```

#### Audio Validation
```
[CLI Export] Validating audio file 0: path/to/audio.mp3
[CLI Export] Audio file 0 exists: true/false
[CLI Export] Audio file 0 size: X bytes
[CLI Export] Audio file 0 validation result: { valid: true, hasAudio: true }
```

#### FFmpeg Audio Mixing
```
🎬 [EXPORT OPTIMIZATION] Export options: { hasAudio: true/false }
[CLI Export] Starting FFmpeg export with options: { audioFiles: [...] }
```

### Common Root Causes

#### Cause 1: Audio Files Not Prepared

**Symptoms:**
```
[CLI Export] Initial audio files count: 0  ← NO AUDIO!
```

**Reason:** Audio elements not found on timeline or not processed correctly.

**Check:**
- Are audio tracks visible in the timeline?
- Are audio elements marked as hidden?
- Is the audio element's `mediaId` valid?

#### Cause 2: Audio File Paths Are Invalid

**Symptoms:**
```
[CLI Export] Audio file 0 exists: false  ← FILE NOT FOUND!
❌ [CLI Export] Audio file does not exist: path/to/audio.mp3
```

**Reason:**
- Audio was stored as blob URL but not saved to temp file
- Temp file was deleted prematurely
- Path is incorrect

#### Cause 3: Audio Format Invalid

**Symptoms:**
```
❌ [CLI Export] Invalid audio file format: path/to/audio.mp3 - Invalid data found
[CLI Export] File has no audio streams: path/to/audio.mp3
```

**Reason:**
- Corrupted audio file
- Unsupported format
- File is not actually audio

#### Cause 4: FFmpeg Not Receiving Audio Files

**Symptoms:**
```
🎬 [EXPORT OPTIMIZATION] Export options: { hasAudio: false }  ← WRONG!
[CLI Export] Validation complete. 0 valid audio files.
```

**Reason:** All audio files failed validation and were filtered out.

#### Cause 5: FFmpeg Command Missing Audio Input

**Symptoms:**
```
✅ [EXPORT OPTIMIZATION] FFmpeg export completed successfully!
(But video has no audio)
```

**Reason:**
- Audio files passed to FFmpeg but not included in command
- FFmpeg command syntax error
- Audio mixing filters not applied

### Debug Checklist

Run through these checks when audio is missing:

```
1. Timeline Audio Elements
   ☐ Check: Are audio tracks present in timeline?
   ☐ Check: Are audio elements visible (not hidden)?
   ☐ Check: Do audio elements have valid mediaId?

2. Audio Preparation Phase
   ☐ Check console: "Initial audio files count: X" (should be > 0)
   ☐ Check: Audio file paths are absolute, not blob://
   ☐ Check: Audio files saved to temp directory

3. Audio Validation Phase
   ☐ Check: "Audio file X exists: true"
   ☐ Check: "Audio file X size: X bytes" (should be > 0)
   ☐ Check: "Audio file X validation result: { valid: true }"
   ☐ Check: "Validation complete. X valid audio files" (should match count)

4. FFmpeg Export Phase
   ☐ Check: "Export options: { hasAudio: true }"
   ☐ Check: audioFiles array is not empty
   ☐ Check: No errors during FFmpeg execution

5. Output Verification
   ☐ Check: Play exported video in media player
   ☐ Check: Audio track present in video properties
   ☐ Check: Audio is not muted or volume is not 0
```

### Solutions by Root Cause

#### If Audio Files Count is 0

**File:** `apps/web/src/lib/export-engine-cli.ts` → `prepareAudioFiles()`

Check:
1. `useTimelineStore.getState().getAudioElements()` returns elements
2. Audio elements have valid `mediaId`
3. Media store has matching media items

#### If Audio Files Don't Exist

**File:** `electron/main.ts` → `save-audio-for-export` handler

Ensure:
1. Blob URLs are converted to filesystem paths
2. Audio is saved to temp directory correctly
3. Temp directory is not cleaned up prematurely

#### If Audio Format is Invalid

**File:** Audio import logic

Ensure:
1. Only valid audio formats are imported (mp3, wav, ogg, m4a)
2. Files are validated after import
3. Corrupted files are rejected

#### If FFmpeg Doesn't Mix Audio

**File:** `electron/ffmpeg-handler.ts` → FFmpeg command construction

Ensure:
1. Audio inputs are added: `-i audio1.mp3 -i audio2.mp3`
2. Audio filters are applied: `[1:a]adelay=...[a1]; [2:a]adelay=...[a2]; [a1][a2]amix`
3. Audio codec is specified: `-c:a aac -b:a 192k`

---

## Enhanced Console Logging

### New Console Messages to Add

#### In export-engine-cli.ts → prepareAudioFiles()

```typescript
// Add at start of prepareAudioFiles()
console.log('🎵 [AUDIO PREP] Starting audio file preparation...');
console.log('🎵 [AUDIO PREP] Timeline audio elements:', audioElements.length);

// After finding each media item
console.log('🎵 [AUDIO PREP] Found audio media item:', {
  id: mediaItem.id,
  name: mediaItem.name,
  hasUrl: !!mediaItem.url,
  urlType: mediaItem.url?.substring(0, 20),
  size: mediaItem.file?.size
});

// After saving to temp file
console.log('✅ [AUDIO PREP] Saved temp audio file:', {
  originalName: mediaItem.name,
  tempPath: result.path,
  startTime: audioElement.absoluteStart,
  volume: audioElement.element.volume
});

// At end
console.log('🎵 [AUDIO PREP] Preparation complete:', {
  totalElements: audioElements.length,
  successfullyPrepared: results.length,
  failed: audioElements.length - results.length
});
```

#### In export-engine-cli.ts → exportWithCLI()

```typescript
// Before sending to FFmpeg
console.log('📦 [FFMPEG AUDIO] Sending audio files to FFmpeg:', {
  count: audioFiles.length,
  files: audioFiles.map(f => ({
    path: f.path.substring(f.path.lastIndexOf('\\') + 1), // filename only
    startTime: f.startTime,
    volume: f.volume
  }))
});

// After FFmpeg completes
if (audioFiles.length > 0) {
  console.log('✅ [FFMPEG AUDIO] Audio should be mixed into output');
} else {
  console.log('⚠️ [FFMPEG AUDIO] No audio files - output will be silent');
}
```

#### In electron/ffmpeg-handler.ts → exportVideoCLI()

```typescript
// When constructing audio inputs
if (options.audioFiles?.length > 0) {
  console.log('🎵 [FFMPEG CMD] Adding audio inputs:', options.audioFiles.length);
  options.audioFiles.forEach((audio, i) => {
    console.log(`  [${i}] ${audio.path} @ ${audio.startTime}s (vol: ${audio.volume})`);
  });
} else {
  console.log('⚠️ [FFMPEG CMD] No audio inputs - video will be silent');
}

// Show the complete FFmpeg command
console.log('🎬 [FFMPEG CMD] Executing command:', ffmpegCommand);

// After FFmpeg execution
console.log('✅ [FFMPEG RESULT] Export completed, checking output...');
console.log('📊 [FFMPEG RESULT] Output file size:', outputStats.size, 'bytes');
```

### How to Use Console Logs for Debugging

1. **Open DevTools Console** (F12)
2. **Clear Console** before export
3. **Start Export** and watch messages
4. **Look for** ⚠️ warning or ❌ error icons
5. **Trace the flow:**
   ```
   🎵 [AUDIO PREP] → 📦 [FFMPEG AUDIO] → 🎵 [FFMPEG CMD] → ✅ [FFMPEG RESULT]
   ```
6. **Identify where audio is lost** in the chain

---

## Quick Reference: Expected vs Problem Logs

### ✅ CORRECT: Fast Export with Audio

```
✅ [EXPORT ANALYSIS] All videos have localPath
⚡ [EXPORT OPTIMIZATION] Using direct video copy - skipping frame rendering
🎵 [AUDIO PREP] Preparation complete: { successfullyPrepared: 2 }
📦 [FFMPEG AUDIO] Sending audio files to FFmpeg: { count: 2 }
🎵 [FFMPEG CMD] Adding audio inputs: 2
✅ [FFMPEG RESULT] Export completed
```
**Result:** Fast export (~2 seconds), audio present

---

### ⚠️ PROBLEM: Slow Export (No Direct Copy)

```
⚠️ [EXPORT ANALYSIS] Some videos lack localPath
🎨 [EXPORT OPTIMIZATION] Cannot use direct copy - RENDERING FRAMES
[CLI] Rendering 300 frames to disk...
🎵 [AUDIO PREP] Preparation complete: { successfullyPrepared: 2 }
✅ [FFMPEG RESULT] Export completed
```
**Result:** Slow export (~45 seconds), audio present
**Fix needed:** Implement temp file creation for blob videos

---

### ❌ PROBLEM: No Audio in Output

```
✅ [EXPORT ANALYSIS] All videos have localPath
⚡ [EXPORT OPTIMIZATION] Using direct video copy
🎵 [AUDIO PREP] Preparation complete: { successfullyPrepared: 0 }  ← PROBLEM!
⚠️ [FFMPEG AUDIO] No audio files - output will be silent  ← PROBLEM!
⚠️ [FFMPEG CMD] No audio inputs - video will be silent  ← PROBLEM!
✅ [FFMPEG RESULT] Export completed
```
**Result:** Fast export, but NO AUDIO
**Fix needed:** Debug why audio file preparation failed

---

## Action Items

### For Performance Issue

- [ ] Implement temp file creation for imported videos
- [ ] Add `localPath` to all video imports
- [ ] Test direct copy optimization with temp files
- [ ] Add cleanup logic for temp video files

### For Audio Issue

- [ ] Add comprehensive audio console logging
- [ ] Test audio export with various audio formats
- [ ] Verify audio file paths are valid
- [ ] Check FFmpeg audio mixing command
- [ ] Validate audio element detection on timeline

### For Both Issues

- [ ] Create automated tests for export scenarios
- [ ] Add export diagnostics panel in UI
- [ ] Document expected console output
- [ ] Add export performance metrics

---

## Related Files

- Export engine: `apps/web/src/lib/export-engine-cli.ts`
- Export analysis: `apps/web/src/lib/export-analysis.ts`
- FFmpeg handler: `electron/ffmpeg-handler.ts`
- Timeline store: `apps/web/src/stores/timeline-store.ts`
- Media store: `apps/web/src/stores/media-store.ts`
