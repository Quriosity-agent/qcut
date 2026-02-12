# FFmpeg macOS Diagnostic

## Issue Report
User reports: "ffmpeg binary not available in mac? windows seem work"

## Investigation Results

### ✅ FFmpeg Binary is Installed

**Location**:
```
/Users/peter/Desktop/code/qcut/qcut/node_modules/.bun/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg
```

**Permissions**: `-rwxr-xr-x` (executable)

**Version**: FFmpeg 6.0 (arm64, Apple Silicon)

**Test**:
```bash
$ node -e "console.log(require('ffmpeg-static'))"
/Users/peter/Desktop/code/qcut/qcut/node_modules/.bun/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg

$ ffmpeg -version
ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers
built with Apple clang version 13.1.6 (clang-1316.0.21.2.5)
```

### ✅ Path Resolution Code is Correct

**File**: `electron/ffmpeg/utils.ts`

**Logic**:
1. Try `require("ffmpeg-static")` → returns correct path on macOS
2. Check if path exists → file exists and is executable
3. Fallback to system paths: `/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, `/opt/local/bin/ffmpeg`
4. Last resort: system PATH

**macOS-specific paths**:
```typescript
case "darwin":
  return [
    "/opt/homebrew/bin/ffmpeg", // Homebrew (Apple Silicon M1/M2/M3)
    "/usr/local/bin/ffmpeg",    // Homebrew (Intel)
    "/opt/local/bin/ffmpeg",    // MacPorts
  ];
```

### Potential Issues

#### 1. **Electron Dev vs Packaged**

The code has different behavior in dev vs packaged:

**Development** (`!app.isPackaged`):
- Tries `electron/resources/ffmpeg`
- Tries system paths
- Falls back to `ffmpeg` in PATH

**Packaged** (`app.isPackaged`):
- Tries `ffmpeg-static` (with `app.asar.unpacked` replacement)
- Tries `process.resourcesPath`
- **Does NOT fall back to system PATH** - throws error

If `require("ffmpeg-static")` fails in dev mode on macOS, it should fall back to system paths.

#### 2. **Bun-specific Module Resolution**

The path returned by `require("ffmpeg-static")` is Bun-specific:
```
node_modules/.bun/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg
```

Standard Node.js would return:
```
node_modules/ffmpeg-static/ffmpeg
```

This might cause issues if Electron uses Node.js require instead of Bun's resolution.

#### 3. **ASAR Unpacking in Packaged App**

The `electron-builder` configuration needs to ensure `ffmpeg-static` is in `asarUnpack`:

**File**: `package.json` (lines 134-144)
```json
"asarUnpack": [
  "node_modules/ffmpeg-static/**/*",
  "node_modules/ffprobe-static/**/*",
  "node_modules/@ffmpeg/core*/**/*",
  "node_modules/@ffmpeg/ffmpeg/**/*",
  "node_modules/@ffmpeg/util/**/*",
  "node_modules/pty.node",
  "node_modules/@napi-rs/canvas-darwin-arm64/skia-canvas.darwin-arm64.node",
  "node_modules/@napi-rs/canvas-darwin-x64/skia-canvas.darwin-x64.node",
  "node_modules/@napi-rs/canvas-win32-x64-msvc/skia-canvas.win32-x64-msvc.node",
  "node_modules/@napi-rs/canvas-linux-x64-gnu/skia-canvas.linux-x64-gnu.node"
],
```

✅ This is correct - `ffmpeg-static/**/*` is included.

### Recommended Diagnostic Steps

1. **Check Electron Console in Dev Mode**

   Run:
   ```bash
   bun run electron:dev
   ```

   Open DevTools Console and look for:
   ```
   [FFmpeg] Found ffmpeg-static: <path>
   ```

   Or errors like:
   ```
   [FFmpeg] ffmpeg-static package not found, falling back
   ```

2. **Test FFmpeg Health Check**

   In the Electron app (DevTools console):
   ```javascript
   await window.electronAPI.ffmpeg.checkHealth()
   ```

   Should return:
   ```javascript
   {
     ffmpegOk: true,
     ffprobeOk: true,
     ffmpegVersion: "6.0",
     ffprobeVersion: "...",
     ffmpegPath: "/path/to/ffmpeg",
     ffprobePath: "/path/to/ffprobe",
     errors: []
   }
   ```

3. **Check Preload Script Loading**

   The recent fix bundled the preload script with esbuild. Verify:
   ```javascript
   window.electronAPI // should be defined
   window.electronAPI.ffmpeg // should exist
   ```

   If `undefined`, the preload script failed to load.

4. **Test Export**

   Try exporting a simple timeline and check the console for:
   ```
   [CLI Export] Starting FFmpeg export...
   ```

   If you see:
   ```
   ❌ [EXPORT VALIDATION] FFmpeg not found
   ```

   Then `getFFmpegPath()` is failing.

### Possible Fixes

#### Fix 1: Add More Detailed Logging

**File**: `electron/ffmpeg/utils.ts`

Add more diagnostic logging to `getFFmpegPath()`:

```typescript
export function getFFmpegPath(): string {
  console.log("[FFmpeg] Starting path resolution...");
  console.log("[FFmpeg] Platform:", process.platform);
  console.log("[FFmpeg] isPackaged:", app.isPackaged);

  // 1. Try ffmpeg-static package
  try {
    let staticPath: string = require("ffmpeg-static");
    console.log("[FFmpeg] ffmpeg-static returned:", staticPath);

    if (app.isPackaged) {
      staticPath = staticPath.replace("app.asar", "app.asar.unpacked");
      console.log("[FFmpeg] Replaced ASAR path:", staticPath);
    }

    if (fs.existsSync(staticPath)) {
      console.log("[FFmpeg] ✅ Found ffmpeg-static:", staticPath);
      return staticPath;
    }
    console.warn("[FFmpeg] ⚠️ Path does not exist:", staticPath);
  } catch (error) {
    console.error("[FFmpeg] ❌ ffmpeg-static require failed:", error);
  }

  // ... rest of function
}
```

#### Fix 2: Verify ffmpeg-static in package.json

Check that `ffmpeg-static` is in `dependencies`, not `devDependencies`:

```json
{
  "dependencies": {
    "ffmpeg-static": "^5.2.0"  // ✅ Should be here
  }
}
```

Current status: **Need to verify** - not visible in the bun pm ls output.

#### Fix 3: Fallback to Homebrew on macOS

If `ffmpeg-static` fails, ensure the system path fallback works:

```bash
# Install via Homebrew (if not already installed)
brew install ffmpeg

# Verify installation
which ffmpeg  # Should show /opt/homebrew/bin/ffmpeg
```

### Windows vs macOS Comparison

| Aspect | Windows | macOS |
|--------|---------|-------|
| ffmpeg-static path | ✅ Works | ✅ Works (Bun-specific path) |
| System fallback | `C:\ProgramData\chocolatey\...` | `/opt/homebrew/bin/ffmpeg` |
| ASAR unpacking | ✅ Configured | ✅ Configured |
| Common issue | - | Preload script sandbox mode |

**Likely Issue**: The preload script bundling fix (commit `d072da09`) resolved the sandbox issue. If FFmpeg still doesn't work, it's a path resolution issue in `getFFmpegPath()`.

### Next Steps

1. Run `bun run electron:dev` and check console logs
2. Test `window.electronAPI.ffmpeg.checkHealth()` in DevTools
3. Try exporting a simple video
4. If fails, add diagnostic logging to `electron/ffmpeg/utils.ts`
5. Report exact error message from console

---

## Quick Test Script

Create `test-ffmpeg.js` in project root:

```javascript
const { app } = require('electron');
const { getFFmpegPath } = require('./dist/electron/ffmpeg/utils.js');

app.whenReady().then(() => {
  try {
    const path = getFFmpegPath();
    console.log('✅ FFmpeg found:', path);
  } catch (error) {
    console.error('❌ FFmpeg not found:', error.message);
  }
  app.quit();
});
```

Run:
```bash
bun run build:electron
electron test-ffmpeg.js
```
