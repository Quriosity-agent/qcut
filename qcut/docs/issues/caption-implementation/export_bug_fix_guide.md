# Export Bug Analysis & Fix Tasks

## Status Overview

### ✅ Fixed Issues
1. **Electron API invocation error** - Debug logging at line 649 now works
   - Added `getPath()` method to `window.electronAPI.ffmpeg`
   - Updated type definitions in `electron.d.ts` and `preload.ts`

2. **Missing duration parameter in FFmpeg export** - Fixed in export-engine-cli.ts:1082
   - **Bug**: `exportOptions` was missing the `duration` field
   - **Impact**: FFmpeg used fallback duration instead of actual timeline duration, resulting in videos with fewer frames than rendered
   - **Fix**: Added `duration: this.totalDuration` to exportOptions object
   - **Files modified**: `apps/web/src/lib/export-engine-cli.ts`

### ✅ Working Correctly
1. **Frame rendering** - All 32 frames render successfully (console_v3.md)
2. **Video seeking** - 100% success rate, zero timeout errors
3. **Canvas drawing** - All frames drawn correctly at 1920x1080
4. **Export session creation** - Temp directories created successfully
5. **Effects processing** - Effects store integration working

### ❓ Needs Verification

#### Task 1: Verify Frame Count Matches in Output Video
**Current Status**: Fixed duration parameter, needs testing

**Issue found (console_v4.md)**:
- User reported: Output video `debugv4.mp4` contains fewer frames than expected
- Console shows: 51 frames rendered (frames 7-51 visible, likely 1-6 also rendered)
- Timeline duration: ~1.67 seconds
- Expected frames at 30fps: 51 frames ✓ (rendered correctly)
- **Problem**: Output video had fewer frames than captured

**Root cause identified**:
- `export-engine-cli.ts:1076` - `exportOptions` object was missing `duration` field
- FFmpeg handler receives `undefined` duration → uses fallback/default duration
- `ffmpeg-handler.ts:240` applies validation but without explicit duration value
- Result: FFmpeg `-t` parameter gets wrong duration, cutting off frames

**Fix applied**:
- Added `duration: this.totalDuration` to exportOptions (line 1082)
- Now passes actual timeline duration to FFmpeg CLI
- FFmpeg will encode all rendered frames instead of cutting them short

#### Task 2: Verify FFmpeg CLI Export Completion
**Current Status**: Previous - Unknown from console_v3.md

**What to check**:
- [ ] Does FFmpeg CLI actually run and create output.mp4?
- [ ] Check temp folder: `C:\Users\zdhpe\AppData\Local\Temp\qcut-export\[sessionId]\output\`
- [ ] Verify output.mp4 file exists and plays correctly
- [ ] Check if export progress reaches 100% in UI

**How to verify**:
1. Run export in dev mode: `bun run electron:dev`
2. Export a 1-second video
3. Check console for FFmpeg CLI output/errors
4. Check if file appears in Downloads or temp folder
5. Try to play the output video

**Expected console output**:
```
✅ FFmpeg CLI started
✅ Video encoding complete
✅ Output file: [path]/output.mp4
✅ Export completed successfully
```

---

## Detailed Analysis (From Console Logs)

### Console v2 Analysis (Before Fix)

**Error Found**:
```
TypeError: window.electronAPI?.invoke is not a function
at export-engine-cli.ts:649:56
```

**Location**: Debug logging code trying to get FFmpeg path
**Impact**: Prevented export from completing

### Console v3 Analysis (After Fix)

**What Works**:
```
✅ CLI EXPORT ENGINE: Initialized with effects support: true
✅ Session ID: 1759979469551
✅ Frame Directory: C:\Users\zdhpe\AppData\Local\Temp\qcut-export\1759979469551\frames
✅ All 32 frames rendered (0.000s to 1.033s)
✅ Video seek success rate: 100%
✅ Opened frames folder in Windows Explorer
```

**What's Unknown**:
- ❓ FFmpeg CLI execution result (not shown in console_v3.md)
- ❓ Final video file creation
- ❓ Export completion status

---

## Next Steps for Complete Fix Verification

### Step 1: Run Full Export Test
```bash
cd qcut
bun run electron:dev
```

Then:
1. Import a video
2. Cut to 1 second
3. Click Export
4. Watch console for:
   - FFmpeg CLI command execution
   - Video encoding progress
   - Final output path
   - Success/error messages

### Step 2: Document Results
Create `console_v4.md` with COMPLETE export log including:
- [ ] Frame rendering (already captured)
- [ ] FFmpeg CLI invocation
- [ ] Encoding progress
- [ ] Final output
- [ ] Any errors

### Step 3: Update This Guide
Based on console_v4.md results:
- If export completes → Move to "✅ Fixed Issues" section
- If export fails → Document the NEW error in "🐛 Active Bugs" section

---

## Technical Details (For Reference)

### Files Modified
1. `electron/preload.ts` - Added `getPath()` method to ffmpeg API
2. `apps/web/src/types/electron.d.ts` - Added TypeScript type for `getPath()`
3. `apps/web/src/lib/export-engine-cli.ts:649` - Updated API call with null check

### API Pattern (Correct)
```typescript
// ✅ CORRECT
if (window.electronAPI?.ffmpeg?.getPath) {
  const ffmpegPath = await window.electronAPI.ffmpeg.getPath();
}

// ❌ WRONG (old code)
const ffmpegPath = await window.electronAPI?.invoke("ffmpeg-path");
```

### Export Flow
```
1. Create export session ✅ VERIFIED
2. Pre-load videos ✅ VERIFIED
3. Render frames to disk ✅ VERIFIED (32/32 frames)
4. Prepare audio files ❓ NEEDS VERIFICATION
5. Execute FFmpeg CLI ❓ NEEDS VERIFICATION
6. Read output file ❓ NEEDS VERIFICATION
7. Return video blob ❓ NEEDS VERIFICATION
```

---

## Verification Checklist

### Frame Rendering ✅
- [x] All frames render without errors
- [x] Video seeking works (100% success)
- [x] Frames saved to temp directory
- [x] No "invoke is not a function" error

### FFmpeg CLI Export ❓
- [ ] FFmpeg command executes
- [ ] No spawn/permission errors
- [ ] Video encoding completes
- [ ] Output file created
- [ ] File size > 0 bytes
- [ ] Video is playable

### User Experience ❓
- [ ] Export progress bar reaches 100%
- [ ] Success message shown
- [ ] Download dialog appears
- [ ] Video file saved to user's chosen location

---

## Debug Commands

### Check temp folder
```bash
# Windows
explorer "%TEMP%\qcut-export"

# Or via Node
ls $env:TEMP\qcut-export
```

### Check FFmpeg availability
```bash
cd qcut/electron
bun x tsc
node dist/ffmpeg-handler.js
```

### Enable verbose FFmpeg logging
In `electron/ffmpeg-handler.ts`, add debug logging for spawn events.
