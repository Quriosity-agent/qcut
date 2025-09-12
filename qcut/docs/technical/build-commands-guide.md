# QCut Build Commands Guide

**Last Updated:** 2025-01-12

## Prerequisites
```bash
git clone https://github.com/donghaozhang/qcut.git
cd qcut
bun install
bun run build  # Required before Electron builds
```

## Quick Reference

### Development
```bash
bun dev                 # Start dev servers
bun run electron:dev    # Electron with hot reload
bun run electron        # Electron production mode
```

### Build Windows EXE
```bash
bun run dist:dir          # Fast - unpacked app (2-3min)
bun run dist:win:fast     # Fast - installer (5-7min) 
bun run dist:win:release  # Production - installer (10-15min)
bun run build:exe         # Alternative packaging (5-8min)
```

### Code Quality
```bash
bun lint:clean    # Clean linting (recommended)
bun format        # Auto-fix formatting
```

### Release Management
```bash
bun run release:patch    # 0.2.0 → 0.2.1
bun run release:minor    # 0.2.0 → 0.3.0
bun run release:major    # 0.2.0 → 1.0.0
```

## Build Commands Details

| Command | Time | Output | Size | Use Case |
|---------|------|--------|------|----------|
| `dist:dir` | 2-3min | Unpacked app | ~300MB | Quick testing |
| `dist:win:fast` | 5-7min | Installer | ~200MB | Fast installer |
| `dist:win:release` | 10-15min | Installer + metadata | ~150MB | Production |
| `build:exe` | 5-8min | Alternative exe | ~300MB | Electron-packager |

## Output Locations
- **Electron-builder**: `d:/AI_play/AI_Code/build_qcut/`
  - Executable: `win-unpacked/QCut Video Editor.exe`
  - Installer: `QCut-Video-Editor-Setup-0.2.0.exe`
- **Alternative**: `dist-packager-new/QCut-win32-x64/QCut.exe`

## Common Issues

**Build fails**: Ensure `bun run build` completed successfully first

**Out of memory**: Use `bun run dist:win:fast` (less compression)

**App won't start**: Check antivirus, try unpacked version first

**FFmpeg errors**: Known issue in packaged builds, most features still work

## Recommended Workflow
1. **Development**: `bun run electron:dev`
2. **Test packaging**: `bun run dist:dir` 
3. **Test installer**: `bun run dist:win:fast`
4. **Production**: `bun run dist:win:release`

## Environment Variables (Optional)
```env
ELECTRON_BUILDER_OUTPUT_DIR=custom/path    # Custom output directory
DISABLE_AUTO_UPDATER=true                  # Disable auto-updater
DEBUG=electron-builder                     # Debug builds
```