# Build Commands Guide for QCut Video Editor

## Overview
This guide covers all available build commands for QCut, from development to production releases.

**Last Updated:** 2025-08-20  
**QCut Version:** 0.2.0

## Prerequisites

### System Requirements
- **Node.js**: 18+ (recommended: 20+)
- **Bun**: Latest version (package manager)
- **Windows**: For Windows builds (cross-platform builds not configured)
- **Git**: For version control and releases

### Initial Setup
```bash
# Clone the repository
git clone https://github.com/donghaozhang/qcut.git
cd qcut

# Install dependencies
bun install

# Build web application first (required before Electron builds)
bun run build
```

## Available Build Commands

### Development Commands

#### `bun dev`
**Purpose**: Start development servers
**Time**: ~10 seconds
**Output**: Development servers running
```bash
bun dev
# Starts all apps in development mode
# - Web app: http://localhost:5173
# - Electron: Separate process
```

#### `bun run electron:dev`
**Purpose**: Run Electron in development mode
**Time**: ~5 seconds
**Output**: Electron app with hot reload
```bash
bun run electron:dev
# - Loads from localhost:5173
# - DevTools enabled
# - Hot reload for web content
# - No auto-updater
```

#### `bun run electron`
**Purpose**: Run Electron in production mode (from built files)
**Time**: ~3 seconds
**Output**: Production-like Electron app
```bash
bun run electron
# - Loads from dist files
# - Production optimizations
# - Auto-updater disabled (not packaged)
```

### Build Commands (Web Only)

#### `bun run build`
**Purpose**: Build web application only
**Time**: ~30-60 seconds
**Output**: `apps/web/dist/` directory
```bash
bun run build
# Required before any Electron builds
# Creates optimized web bundle
```

### Electron Build Commands

#### `bun run dist:dir`
**Purpose**: Create unpacked Electron app (testing)
**Time**: ~2-3 minutes
**Output**: `d:/AI_play/AI_Code/build_qcut/win-unpacked/`
```bash
bun run dist:dir
# electron-builder --dir
# - No installer created
# - Fastest Electron build
# - Good for testing packaging
# - Output: QCut Video Editor.exe in win-unpacked/
```

#### `bun run dist:win`
**Purpose**: Windows build with code signing disabled
**Time**: ~8-10 minutes
**Output**: Full installer
```bash
bun run dist:win
# electron-builder --win -c.win.forceCodeSigning=false
# - Creates Windows NSIS installer
# - Code signing disabled
# - Standard compression
```

#### `bun run dist:win:fast`
**Purpose**: Fast Windows installer (no compression)
**Time**: ~5-7 minutes
**Output**: Installer + unpacked app
```bash
bun run dist:win:fast
# electron-builder --win --config.win.forceCodeSigning=false --config.compression=store --config.nsis.differentialPackage=false
# - Creates Windows installer
# - No compression (store mode - larger file)
# - Differential package disabled
# - Faster build time
# - Good for testing installer
```

#### `bun run dist:win:unsigned`
**Purpose**: Standard development Windows build
**Time**: ~8-12 minutes
**Output**: Full installer with optimizations
```bash
bun run dist:win:unsigned
# electron-builder --win --config.win.forceCodeSigning=false --config.win.verifyUpdateCodeSignature=false
# - Full compression and optimizations
# - Complete NSIS installer
# - File associations included
# - No code signing or signature verification
# - Good for final testing
```

#### `bun run dist:win:release`
**Purpose**: Production release build
**Time**: ~10-15 minutes
**Output**: Production installer with auto-updater metadata
```bash
bun run dist:win:release
# electron-builder --win --config.win.forceCodeSigning=false --config.win.verifyUpdateCodeSignature=false
# - Maximum optimizations
# - Auto-updater metadata (latest.yml)
# - All production features
# - Ready for GitHub releases
# Note: Same command as dist:win:unsigned (may need differentiation)
```

### Alternative Packaging Commands

#### `bun run package:win`
**Purpose**: electron-packager alternative build
**Time**: ~3-5 minutes
**Output**: `dist-packager-new/QCut-win32-x64/`
```bash
bun run package:win
# electron-packager . QCut --platform=win32 --arch=x64 --out=dist-packager-new --overwrite
# - Uses electron-packager instead of electron-builder
# - Different output location (dist-packager-new)
# - Simpler packaging
# - No installer, just executable
# - Includes PowerShell script to copy FFmpeg resources
```

#### `bun run build:exe`
**Purpose**: Combined web build + electron-packager
**Time**: ~5-8 minutes
**Output**: Complete packaged app
```bash
bun run build:exe
# npm run build && npm run package:win
# - Builds web app first
# - Then packages with electron-packager
# - Ensures fresh build before packaging
```

### Version Management Commands

#### `bun run version:patch`
**Purpose**: Increment patch version (0.2.0 → 0.2.1)
```bash
bun run version:patch
# npm version patch --no-git-tag-version
```

#### `bun run version:minor`
**Purpose**: Increment minor version (0.2.0 → 0.3.0)
```bash
bun run version:minor
# npm version minor --no-git-tag-version
```

#### `bun run version:major`
**Purpose**: Increment major version (0.2.0 → 1.0.0)
```bash
bun run version:major
# npm version major --no-git-tag-version
```

### Release Commands

#### `bun run release:patch`
**Purpose**: Create patch release with version bump
```bash
bun run release:patch
# node scripts/release.js patch
```

#### `bun run release:minor`
**Purpose**: Create minor release with version bump
```bash
bun run release:minor
# node scripts/release.js minor
```

#### `bun run release:major`
**Purpose**: Create major release with version bump
```bash
bun run release:major
# node scripts/release.js major
```

## Build Outputs

### File Locations

**Electron-builder outputs:** `d:/AI_play/AI_Code/build_qcut/`
**Electron-packager outputs:** `dist-packager-new/`

```
d:/AI_play/AI_Code/build_qcut/
├── win-unpacked/                          # Unpacked application
│   ├── QCut Video Editor.exe              # Main executable
│   ├── resources/                         # App resources
│   │   ├── app.asar                       # Packed app files
│   │   ├── ffmpeg.exe                     # FFmpeg binary
│   │   ├── ffplay.exe                     # FFplay binary
│   │   ├── ffprobe.exe                    # FFprobe binary
│   │   └── *.dll                          # FFmpeg DLL files
│   └── [electron files]                   # Electron runtime
├── QCut-Video-Editor-Setup-0.2.0.exe      # Windows installer (name format changed)
├── QCut-Video-Editor-Setup-0.2.0.exe.blockmap  # Update metadata
├── latest.yml                             # Auto-updater metadata
└── builder-debug.yml                      # Build debug info

dist-packager-new/                         # Electron-packager output
└── QCut-win32-x64/
    ├── QCut.exe                           # Main executable
    └── resources/                         # FFmpeg resources (copied via PowerShell)
```

### File Sizes (Approximate)
- **Unpacked app**: ~300-400MB
- **Installer**: ~150-180MB (compressed)
- **Fast build installer**: ~200-250MB (less compression)

## Build Process Explained

### Step-by-Step Process
1. **Dependency Installation** (~30s)
   - Installs native dependencies
   - Rebuilds for Electron
   
2. **Web Bundle** (if not built)
   - Vite builds React app
   - Optimizes assets
   
3. **Electron Packaging** (~2-5min)
   - Copies web dist
   - Includes Electron runtime
   - Applies file exclusions
   - Creates ASAR archive
   
4. **Installer Creation** (~3-8min)
   - NSIS installer generation
   - Compression (varies by command)
   - File associations setup
   - Shortcut creation
   
5. **Metadata Generation**
   - Auto-updater files
   - Checksums
   - Debug information

## Performance Tips

### Speed Up Builds
```bash
# 1. Use fast build for testing
bun run dist:win:fast

# 2. Use dir-only for quick packaging tests
bun run dist:dir

# 3. Keep web build updated
bun run build  # Run before Electron builds
```

### Reduce Build Time
- **Clean old builds**: Delete old dist folders
- **Close other apps**: Free up system resources  
- **Use SSD**: Faster disk I/O
- **More RAM**: Helps with compression

### Troubleshooting Slow Builds

**If builds take >15 minutes:**
```bash
# Check disk space
dir "d:/AI_play/AI_Code/build_qcut"

# Clean old builds
rmdir /s "d:/AI_play/AI_Code/build_qcut/win-unpacked"

# Use faster build
bun run dist:win:fast
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Build Release
on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install
        
      - name: Build web app
        run: bun run build
        
      - name: Lint code
        run: bun lint:clean
        
      - name: Build Electron app
        run: bun run dist:win:release
        
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: QCut-Windows
          path: |
            d:/AI_play/AI_Code/build_qcut/*.exe
            d:/AI_play/AI_Code/build_qcut/latest.yml
```

## Environment Variables

### Optional Configuration
```env
# Build output directory (default: d:/AI_play/AI_Code/build_qcut)
ELECTRON_BUILDER_OUTPUT_DIR=custom/output/path

# Enable/disable auto-updater (default: enabled in packaged builds)
DISABLE_AUTO_UPDATER=true

# Build compression level (store|normal|maximum)
COMPRESSION_LEVEL=maximum

# Debug electron-builder
DEBUG=electron-builder
```

## Common Issues & Solutions

### Build Fails

**"FFmpeg not found"**
```bash
# Ensure web build is current
bun run build

# Check FFmpeg resources exist
ls apps/web/dist/ffmpeg/
```

**"Out of memory"**
```bash
# Use fast build (less compression)
bun run dist:win:fast

# Close other applications
# Add more RAM if possible
```

**"Permission denied"**
```bash
# Run as Administrator
# Check antivirus isn't blocking
# Ensure output directory is writable
```

### Build Succeeds but App Won't Run

**"Application failed to start"**
- Check antivirus quarantine
- Run from unpacked folder first: `win-unpacked/QCut Video Editor.exe`
- Check Windows event logs

**"FFmpeg errors in built app"**
- This is a known issue (documented)
- FFmpeg paths need adjustment for installed version
- App still functions for most features

### Linting and Code Quality Commands

#### `bun lint`
**Purpose**: Run Ultracite linting (shows all errors)
```bash
bun lint
# npx ultracite@latest lint
# Shows all errors including unfixable FFmpeg files
```

#### `bun lint:clean`
**Purpose**: Run clean linting (recommended)
```bash
bun lint:clean
# npx @biomejs/biome check --skip-parse-errors .
# Skips parse errors from FFmpeg WebAssembly files
```

#### `bun format`
**Purpose**: Auto-fix formatting issues
```bash
bun format
# npx ultracite@latest format
```

## Quick Reference

### Most Common Commands
```bash
# Daily development
bun run electron:dev

# Test packaging
bun run dist:dir

# Test installer  
bun run dist:win:fast

# Production release
bun run dist:win:release

# Linting (clean)
bun lint:clean

# Format code
bun format
```

### File Sizes
| Command | Time | Installer Size | Use Case |
|---------|------|----------------|----------|
| `dist:dir` | 2-3min | No installer | Testing |
| `dist:win` | 8-10min | ~150MB | Standard build |
| `dist:win:fast` | 5-7min | ~200-250MB | Quick testing |
| `dist:win:unsigned` | 8-12min | ~150MB | Full testing |
| `dist:win:release` | 10-15min | ~150MB | Production |
| `package:win` | 3-5min | No installer | Alternative packaging |

### Output Locations
- **Development**: `apps/web/dist/` (web build)
- **Electron-builder**: `d:/AI_play/AI_Code/build_qcut/`
- **Electron-packager**: `dist-packager-new/QCut-win32-x64/`
- **Executables**: `win-unpacked/QCut Video Editor.exe` or `QCut.exe`
- **Installers**: `QCut-Video-Editor-Setup-0.2.0.exe`

---

**💡 Pro Tips:**
- Always run `bun run build` before Electron builds
- Use `dist:win:fast` for iterative testing
- Use `dist:dir` for quick packaging verification  
- Reserve `dist:win:release` for actual releases
- Keep output directory clean for faster builds