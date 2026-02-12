# Fix: FFprobe macOS arm64 Binary Issue

## Problem
**Error**: `spawn Unknown system error -86` when trying to use ffprobe on macOS arm64 (Apple Silicon)

**Root Cause**: The `ffprobe-static@3.1.0` npm package has a bug where the `bin/darwin/arm64/ffprobe` binary is actually an x86_64 (Intel) binary, not arm64. This causes execution failures on Apple Silicon Macs.

## Evidence
```bash
$ file node_modules/.bun/ffprobe-static@3.1.0/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe
Mach-O 64-bit executable x86_64  # Should be arm64!
```

## Solution Implemented

### 1. Installed Homebrew FFmpeg/FFprobe
```bash
brew install ffmpeg
```
- Provides native arm64 binaries
- FFprobe version 8.0.1 (native arm64)
- Location: `/opt/homebrew/bin/ffprobe`

### 2. Updated `electron/ffmpeg/utils.ts`

**Added binary validation** in `getFFprobePath()`:
- Tests if ffprobe-static binary is actually executable before using it
- Falls back to system paths if execution test fails
- Prevents silent failures from broken binaries

**Improved fallback logic**:
- Now checks system paths (including Homebrew) before giving up
- Properly handles macOS Homebrew paths (`/opt/homebrew/bin`)
- Maintains compatibility with Windows and Linux

## Files Modified
- `electron/ffmpeg/utils.ts` - Added execution validation and improved fallbacks

## Testing
To verify the fix works:
1. Start the app: `bun run electron:dev`
2. Check console for: `[FFmpeg] Found ffprobe at system path: /opt/homebrew/bin/ffprobe`
3. Verify video export works without errors

## Related Issues
- Unit test failure: `ffprobe-health-check.test.ts` (same root cause)
- This fix resolves both the production app issue and test failures

## Long-term Solution
Consider switching from `ffprobe-static` to either:
1. Homebrew/system FFmpeg (current fix)
2. A different npm package with proper arm64 binaries
3. Building our own universal binaries

## Status
✅ **FIXED** - Homebrew ffprobe used as fallback when ffprobe-static fails
