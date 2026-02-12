# FFprobe Production Solution Investigation

## Problem Summary

### Original Issue
- **Error**: `spawn Unknown system error -86` when using ffprobe on macOS arm64 (Apple Silicon)
- **User Impact**: Video export functionality completely broken on macOS
- **Location**: Shown in app error dialog: "Video export may not work - FFprobe binary not found or not executable"

### Root Cause Discovery
The `ffprobe-static@3.1.0` npm package has a **critical packaging bug**:

```bash
$ file node_modules/ffprobe-static/bin/darwin/arm64/ffprobe
Mach-O 64-bit executable x86_64  # ❌ Should be arm64!

$ file node_modules/ffprobe-static/bin/darwin/x64/ffprobe
Mach-O 64-bit executable x86_64  # Both are x86_64!
```

**Both the `arm64` and `x64` folders contain x86_64 (Intel) binaries, not arm64 binaries.**

System error -86 on macOS means: "Bad CPU type in executable" - trying to run x86_64 on arm64 without Rosetta.

## Temporary Fix (NOT Production Ready)

### What We Did
1. Installed FFmpeg via Homebrew: `brew install ffmpeg`
2. Modified `electron/ffmpeg/utils.ts` to:
   - Test if ffprobe-static binary is executable before using it
   - Fallback to system paths (Homebrew: `/opt/homebrew/bin/ffprobe`)
3. Verified Homebrew's ffprobe works (native arm64 binary)

### Why This Isn't Acceptable for Production
- ❌ **Bad UX**: Requires users to install Homebrew and FFmpeg manually
- ❌ **Not cross-platform**: Different setup on every OS
- ❌ **Unreliable**: Users may have different versions or no installation
- ❌ **Support nightmare**: Can't guarantee consistent behavior

**User's feedback**: "I don't think asking the user to install FFmpeg using Homebrew is a good idea."

## Production Solution Investigation

### Alternative Package: `ffmpeg-ffprobe-static`

**Package Info**:
- Name: `ffmpeg-ffprobe-static`
- Version: `6.1.2-rc.1` (latest)
- Description: "ffmpeg and ffprobe static binaries for Mac OSX, Linux, and Windows"
- Publisher: `descript-ci`
- Supports: `darwin: ['x64', 'arm64']` ✅

**Installation**:
```bash
bun add ffmpeg-ffprobe-static
```

**API**:
```javascript
const { ffmpegPath, ffprobePath } = require('ffmpeg-ffprobe-static');
// Different from ffmpeg-static which exports: require('ffprobe-static').path
```

**Current Status**:
- ✅ Package installed
- ❌ Binaries not found in expected location (may need postinstall script to download)
- 🔍 **INVESTIGATING**: Package structure shows binaries should be downloaded during install

Expected paths:
```
node_modules/ffmpeg-ffprobe-static/ffmpeg
node_modules/ffmpeg-ffprobe-static/ffprobe
```

Actual status: Files don't exist yet (postinstall may have failed or binaries are platform-downloaded)

### Investigation Steps

1. ✅ Found alternative package with proper arm64 support
2. ✅ Installed `ffmpeg-ffprobe-static@6.1.2-rc.1`
3. ❓ **CURRENT**: Checking if binaries are downloaded correctly
4. **NEXT**: Test if binaries work on arm64 macOS
5. **NEXT**: Update code to use new package
6. **NEXT**: Test on all platforms (macOS arm64, macOS x64, Windows, Linux)

### Other Options to Consider

#### Option A: Bundle Our Own Binaries
- Download official FFmpeg builds for each platform
- Include in `electron/resources/`
- Configure `electron-builder` to bundle them
- **Pros**: Full control, guaranteed to work
- **Cons**: Large binary sizes, need to maintain updates

#### Option B: Use `@ffmpeg/ffmpeg` (WebAssembly)
- Already in project as dependency
- Cross-platform by nature
- **Pros**: No native binaries needed
- **Cons**: Slower performance, limited features vs native

#### Option C: Different Static Binary Package
- `fluent-ffmpeg` with bundled binaries
- `ffmpeg-installer` packages
- **Need to verify**: arm64 macOS support

## Files Modified So Far

### Code Changes
- `electron/ffmpeg/utils.ts` - Added validation and Homebrew fallback
  - Location: `getFFprobePath()` function
  - Changes: Binary execution test, system path fallback

### Dependencies
- Installed: `ffmpeg-ffprobe-static@6.1.2-rc.1`
- Still present: `ffprobe-static@3.1.0` (broken package)
- **TODO**: Remove broken package once replacement works

### Documentation
- `docs/task/fix-ffprobe-macos-arm64.md` - Temporary Homebrew fix
- `docs/task/unit-test-failure-ffmpeg-health-check.md` - Test failures
- **THIS FILE**: Production solution investigation

## Next Steps

1. **Investigate** why `ffmpeg-ffprobe-static` binaries aren't present
   - Check `install.js` script in the package
   - May need to trigger postinstall manually
   - Check if bun handles postinstall differently than npm

2. **Test** if binaries work once present:
   ```bash
   file node_modules/ffmpeg-ffprobe-static/ffprobe
   node_modules/ffmpeg-ffprobe-static/ffprobe -version
   ```

3. **Update code** to use `ffmpeg-ffprobe-static`:
   - Modify `electron/ffmpeg/utils.ts`
   - Change from `require('ffprobe-static').path`
   - To: `require('ffmpeg-ffprobe-static').ffprobePath`
   - Same for ffmpeg: `.ffmpegPath`

4. **Remove** Homebrew fallback once proper binaries work

5. **Test** on all platforms before release

6. **Update** `package.json` to remove `ffprobe-static`

## Current State

- **Working**: Homebrew fallback (dev only, not production-ready)
- **In Progress**: Testing `ffmpeg-ffprobe-static` package
- **Blocked**: Need to resolve binary download/install issue
- **Commits**:
  - `3eaa8027` - Homebrew fallback fix (temporary)
  - Branch: `mac-fix`

## Testing Checklist

Once solution is implemented:
- [ ] Test on macOS arm64 (Apple Silicon)
- [ ] Test on macOS x64 (Intel)
- [ ] Test on Windows x64
- [ ] Test on Linux x64
- [ ] Verify video export works
- [ ] Verify FFprobe health check passes
- [ ] Test packaged app (electron-builder)
- [ ] Verify binaries are properly bundled in ASAR

## Related Issues

- Video export broken on macOS arm64
- Unit test `ffprobe-health-check.test.ts` failing (same root cause)
- Need proper cross-platform binary distribution strategy

## Priority

🔴 **HIGH** - Blocking video export on macOS (significant user base)
