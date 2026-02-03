# Cross-Platform Support Plan (Windows, macOS, Linux)

## Overview

This document outlines the implementation plan to ensure QCut works consistently across Windows, macOS, and Linux. The focus is on long-term maintainability and proper cross-platform patterns.

## Current State Analysis

### Critical Issues

| Priority | Issue | Location | Impact |
|----------|-------|----------|--------|
| CRITICAL | Hardcoded Windows build path `d:/` | `package.json:79` | macOS/Linux builds fail |
| CRITICAL | No macOS/Linux electron-builder configs | `package.json:167-199` | Cannot package for macOS/Linux |
| HIGH | FFmpeg binary detection Windows-only | `electron/ffmpeg/utils.ts:77-132` | FFmpeg unavailable on macOS/Linux |
| HIGH | Windows-only FFmpeg copy script | `scripts/copy-ffmpeg.ts:15-18` | Build skipped on macOS/Linux |
| HIGH | extraResources filter only .exe/.dll | `package.json:136-139` | macOS/Linux binaries excluded |
| MEDIUM | Missing macOS icon (.icns) | `build/` directory | macOS packaging fails |
| MEDIUM | Missing Linux icons (PNG) | `build/` directory | Linux packaging incomplete |

### What's Already Cross-Platform (No Changes Needed)

| Component | Location | Status |
|-----------|----------|--------|
| PTY shell detection | `electron/pty-handler.ts:65-77` | Handles Win/Unix shells correctly |
| PTY command execution | `electron/pty-handler.ts:133-139` | Uses `/c` on Windows, `-c` on Unix |
| FFprobe path resolution | `electron/ffmpeg/utils.ts:201` | Has `process.platform` check |
| App quit behavior | `electron/main.ts:1289` | Darwin-specific handling exists |
| Path operations | Multiple files | Uses `path.join()` consistently |
| Electron app paths | Multiple handlers | Uses `app.getPath()` API |

---

## Implementation Tasks

### Task 1: Fix Electron Builder Configuration
**Complexity: Medium**
**Files to modify:** `package.json`

#### Subtask 1.1: Replace Hardcoded Build Output Path
**Location:** `package.json:79`

```json
// Current (BROKEN - Windows-only absolute path)
"output": "d:/AI_play/AI_Code/build_qcut"

// Fixed (cross-platform relative path)
"output": "dist-electron"
```

#### Subtask 1.2: Fix extraResources Filter
**Location:** `package.json:132-139`

```json
// Current (Windows-only extensions)
"extraResources": [
  {
    "from": "electron/resources/",
    "to": "./",
    "filter": ["**/*.exe", "**/*.dll"]
  }
]

// Fixed (platform-aware with conditional resources)
"extraResources": [
  {
    "from": "electron/resources/",
    "to": "./",
    "filter": ["**/*"]
  }
]
```

#### Subtask 1.3: Add macOS Configuration
**Location:** After `package.json:176` (after `win` block)

```json
"mac": {
  "category": "public.app-category.video",
  "icon": "build/icon.icns",
  "target": [
    {
      "target": "dmg",
      "arch": ["x64", "arm64"]
    },
    {
      "target": "zip",
      "arch": ["x64", "arm64"]
    }
  ],
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist"
}
```

#### Subtask 1.4: Add Linux Configuration
**Location:** After macOS block

```json
"linux": {
  "icon": "build/icons",
  "category": "Video",
  "target": [
    {
      "target": "AppImage",
      "arch": ["x64"]
    },
    {
      "target": "deb",
      "arch": ["x64"]
    }
  ],
  "desktop": {
    "Name": "QCut AI Video Editor",
    "Comment": "Open-source AI video editor",
    "Categories": "AudioVideo;Video;AudioVideoEditing"
  }
}
```

#### Subtask 1.5: Add Platform Build Scripts
**Location:** `package.json` scripts section (after line 57)

```json
"dist:mac": "electron-builder --mac",
"dist:linux": "electron-builder --linux",
"dist:all": "electron-builder --win --mac --linux"
```

---

### Task 2: Cross-Platform FFmpeg Binary Detection
**Complexity: High**
**Files to modify:** `electron/ffmpeg/utils.ts`

#### Subtask 2.1: Update `getFFmpegPath()` Function
**Location:** `electron/ffmpeg/utils.ts:77-132`

The current implementation only searches Windows-specific paths (WinGet, `.exe` extension). Need to add macOS and Linux support.

```typescript
export function getFFmpegPath(): string {
  const platform = process.platform;
  const binaryName = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  if (app.isPackaged) {
    // Production: FFmpeg is in the app's resources folder
    const resourcePath = path.join(process.resourcesPath, binaryName);
    if (fs.existsSync(resourcePath)) {
      return resourcePath;
    }
    throw new Error(`FFmpeg not found at: ${resourcePath}`);
  }

  // Development: try bundled FFmpeg first
  const devPath = path.join(__dirname, "..", "resources", binaryName);
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  // Platform-specific system paths
  const systemPaths = getSystemFFmpegPaths(platform);
  for (const searchPath of systemPaths) {
    if (fs.existsSync(searchPath)) {
      debugLog("Found FFmpeg at:", searchPath);
      return searchPath;
    }
  }

  // Fallback to system PATH
  return platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function getSystemFFmpegPaths(platform: string): string[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";

  switch (platform) {
    case "win32":
      return [
        // WinGet installation
        ...findFFmpegInWingetPaths(homeDir),
        // Chocolatey
        "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
        // Scoop
        path.join(homeDir, "scoop", "shims", "ffmpeg.exe"),
      ];

    case "darwin":
      return [
        // Homebrew (Apple Silicon)
        "/opt/homebrew/bin/ffmpeg",
        // Homebrew (Intel)
        "/usr/local/bin/ffmpeg",
        // MacPorts
        "/opt/local/bin/ffmpeg",
      ];

    case "linux":
      return [
        "/usr/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        // Snap
        "/snap/bin/ffmpeg",
        // Flatpak user bin
        path.join(homeDir, ".local", "bin", "ffmpeg"),
      ];

    default:
      return [];
  }
}

function findFFmpegInWingetPaths(homeDir: string): string[] {
  const wingetBasePath = path.join(
    homeDir,
    "AppData",
    "Local",
    "Microsoft",
    "WinGet",
    "Packages"
  );

  if (!fs.existsSync(wingetBasePath)) {
    return [];
  }

  const ffmpegPath = findFFmpegInWinget(wingetBasePath);
  return ffmpegPath ? [ffmpegPath] : [];
}
```

---

### Task 3: Cross-Platform Build Scripts
**Complexity: Medium**
**Files to modify:** `scripts/copy-ffmpeg.ts`

#### Subtask 3.1: Update FFmpeg Copy Script
**Location:** `scripts/copy-ffmpeg.ts:15-18`

Current code exits immediately on non-Windows:
```typescript
if (platform() !== "win32") {
  console.log("Skipping FFmpeg copy on non-Windows platform");
  process.exit(0);
}
```

Replace with platform-aware logic:

```typescript
const currentPlatform = platform();
const binaryExtension = currentPlatform === "win32" ? ".exe" : "";

// Platform-specific target directories
const targetDirs: Record<string, string> = {
  win32: "dist-packager-new/QCut-win32-x64/resources",
  darwin: "dist-packager-new/QCut-darwin-x64/resources",
  linux: "dist-packager-new/QCut-linux-x64/resources",
};

const targetDir = targetDirs[currentPlatform];
if (!targetDir) {
  console.log(`Unsupported platform: ${currentPlatform}`);
  process.exit(0);
}

// Platform-specific allowed extensions
const allowedExtensions = currentPlatform === "win32"
  ? [".exe", ".dll"]
  : [""];  // Unix binaries have no extension
```

---

### Task 4: Create macOS Entitlements File
**Complexity: Low**
**Files to create:** `build/entitlements.mac.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Allow JIT compilation (needed for V8/Node.js) -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <!-- Allow unsigned executable memory (needed for node-pty) -->
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <!-- Disable library validation (needed for native modules) -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <!-- Microphone access for audio recording -->
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <!-- Camera access (future feature) -->
    <key>com.apple.security.device.camera</key>
    <true/>
    <!-- File access for video editing -->
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

---

### Task 5: Create Platform-Specific Icons
**Complexity: Low**
**Current state:** Only `build/icon.ico` exists (277KB)

#### Subtask 5.1: Create macOS Icon
**File to create:** `build/icon.icns`

Generate from existing icon.ico using:
```bash
# On macOS with iconutil
mkdir icon.iconset
sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
```

Or use cross-platform tool:
```bash
# Using png2icns (cross-platform)
npx png2icns build/icon.png build/icon.icns
```

#### Subtask 5.2: Create Linux Icons
**Directory to create:** `build/icons/`

Required PNG sizes:
- `16x16.png`
- `32x32.png`
- `48x48.png`
- `64x64.png`
- `128x128.png`
- `256x256.png`
- `512x512.png`

Generate using ImageMagick:
```bash
for size in 16 32 48 64 128 256 512; do
  convert icon.png -resize ${size}x${size} build/icons/${size}x${size}.png
done
```

---

### Task 6: Add CI/CD for Multi-Platform Builds
**Complexity: Medium**
**Files to create:** `.github/workflows/build-multiplatform.yml`

```yaml
name: Build Multi-Platform

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run build
      - run: bun run dist:win
      - uses: actions/upload-artifact@v4
        with:
          name: windows-build
          path: dist-electron/*.exe

  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run build
      - run: bun run dist:mac
      - uses: actions/upload-artifact@v4
        with:
          name: macos-build
          path: dist-electron/*.dmg

  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run build
      - run: bun run dist:linux
      - uses: actions/upload-artifact@v4
        with:
          name: linux-build
          path: dist-electron/*.AppImage
```

---

## Testing Checklist

### Windows (Current - Working)
- [x] `bun run dev` starts correctly
- [x] `bun run electron:dev` launches Electron
- [x] FFmpeg operations work
- [x] PTY terminal works (cmd.exe)
- [x] `bun run dist:win` produces working installer

### macOS (Needs Implementation)
- [ ] `bun run dev` starts correctly
- [ ] `bun run electron:dev` launches Electron
- [ ] FFmpeg operations work (requires Homebrew: `brew install ffmpeg`)
- [ ] PTY terminal works with zsh/bash
- [ ] `bun run dist:mac` produces working .dmg
- [ ] Code signing works (requires Apple Developer account)
- [ ] App notarization works

### Linux (Needs Implementation)
- [ ] `bun run dev` starts correctly
- [ ] `bun run electron:dev` launches Electron
- [ ] FFmpeg operations work (requires: `apt install ffmpeg` or equivalent)
- [ ] PTY terminal works with bash
- [ ] `bun run dist:linux` produces working AppImage
- [ ] .deb package installs correctly

---

## Implementation Order

| Order | Task | Reason |
|-------|------|--------|
| 1 | Task 1.1 | Fix output path - unblocks all builds |
| 2 | Task 1.2 | Fix extraResources - required for packaging |
| 3 | Task 2 | FFmpeg detection - critical for video editing |
| 4 | Task 5 | Platform icons - required before packaging |
| 5 | Task 4 | macOS entitlements - required for macOS builds |
| 6 | Task 1.3-1.5 | Add platform configs and scripts |
| 7 | Task 3 | Update copy script (optional - mainly for electron-packager) |
| 8 | Task 6 | CI/CD automation (optional - for release workflow) |

---

## Files Summary

### Files to Modify
| File | Line(s) | Change |
|------|---------|--------|
| `package.json` | 79 | Change output path to `dist-electron` |
| `package.json` | 136-139 | Change filter to `["**/*"]` |
| `package.json` | after 176 | Add `mac` config block |
| `package.json` | after mac | Add `linux` config block |
| `package.json` | scripts | Add `dist:mac`, `dist:linux`, `dist:all` |
| `electron/ffmpeg/utils.ts` | 77-132 | Add macOS/Linux FFmpeg paths |
| `scripts/copy-ffmpeg.ts` | 15-24 | Make platform-aware |

### Files to Create
| File | Purpose |
|------|---------|
| `build/icon.icns` | macOS app icon |
| `build/icons/*.png` | Linux app icons (7 sizes) |
| `build/entitlements.mac.plist` | macOS code signing entitlements |
| `.github/workflows/build-multiplatform.yml` | CI/CD for all platforms |

---

## Native Module Considerations

### node-pty
- **Current handling:** Already loads from `process.resourcesPath` in packaged app
- **Requirement:** Must be compiled separately for each platform during `npm install`
- **CI/CD:** Each platform runner compiles its own native modules

### FFmpeg WebAssembly (@ffmpeg/ffmpeg)
- **Status:** Cross-platform by design (WebAssembly)
- **No changes needed:** Works on all platforms

---

## Long-Term Maintenance Guidelines

1. **Always use `path.join()`** for file paths - never string concatenation
2. **Always use `process.platform`** for platform detection
3. **Use Electron's `app.getPath()`** for system directories (temp, documents, userData)
4. **Test on all platforms** before releases
5. **Avoid hardcoded paths** - use environment variables or relative paths
6. **Document platform-specific quirks** in code comments
7. **Use conditional logic** for platform-specific binaries:
   ```typescript
   const binaryName = process.platform === "win32" ? "tool.exe" : "tool";
   ```
