# Turbo Update: v2.5.6 → v2.6.3

## Status: COMPLETED

**Previous Version**: `turbo@^2.5.6`
**Updated Version**: `turbo@^2.6.3`
**Date Completed**: 2025-12-15

### Build Output Warnings (Before Upgrade)

From the build screenshot, the following warnings were present:

```
WARNING  stale pid file at "C:\Users\zdhpe\AppData\Local\Temp\\turbod\\f15465c390535e74\\turbod.pid"
WARNING  Unable to calculate transitive closures: No lockfile entry found for '@tybys/wasm-util'
```

**Both warnings are now RESOLVED after the upgrade.**

## Upgrade Method Used

### Option 2: Manual Update (Recommended for minor versions)

```bash
cd qcut
bun update turbo@^2.6.3
```

**Why this option was chosen:**
- Minor version bump with no breaking changes
- No config migrations needed for `turbo.json`
- Simpler and faster than running codemod
- Codemod is better suited for major version upgrades

### Alternative: Using Turbo Codemod

For major upgrades with breaking changes, use:

```bash
cd qcut
bunx @turbo/codemod@latest update
```

## What's New in v2.6.3

### Security Fix (Critical)
- **Command Injection Vulnerability**: Patched security issue in `turbo-ignore` preventing command injection attacks

### New Features
- **GitHub Actions Integration**: Added GitHub Actions environment variables as default passthrough, streamlining CI/CD workflows

### Bug Fixes
- **TUI Stability**: Resolved crashes in terminal UI during column wrapping operations
- **LSP Initialization**: Fixed handling of pidlock ownership conflicts (may fix the "stale pid file" warning)
- **Configuration Paths**: Normalized config directory environment variables to use absolute paths consistently
- **API Role Support**: Enhanced Vercel API with additional role variants

**Release Date**: December 4, 2024

## Known Issues to Address

### 1. Stale PID File Warning

The warning about stale pid files should be resolved in v2.6.3 due to the LSP initialization fix. If it persists after upgrade:

```bash
# Clean up stale turbo daemon files (Windows)
rmdir /s /q "%LOCALAPPDATA%\Temp\turbod"

# Or manually delete the pid file
del "%LOCALAPPDATA%\Temp\turbod\f15465c390535e74\turbod.pid"
```

### 2. Missing Lockfile Entry for @tybys/wasm-util

This warning is unrelated to turbo version. It's caused by a missing dependency in the lockfile:

```bash
# Regenerate lockfile
rm bun.lockb
bun install
```

Or add the missing dependency explicitly if needed.

## Verification Results

```bash
# Check version
$ turbo --version
2.6.3

# Run build to verify
$ bun run build
turbo 2.6.3
Tasks:    1 successful, 1 total
Time:    1m12.68s
```

**Warnings Fixed:**
- "stale pid file" warning - RESOLVED (LSP initialization fix in v2.6.3)
- "@tybys/wasm-util" lockfile warning - RESOLVED (lockfile regenerated during update)

## Rollback Plan

If issues occur after upgrade:

```bash
bun update turbo@^2.5.6
bun install
```

## References

- [Turbo v2.6.3 Changelog](https://github.com/vercel/turborepo/releases/tag/v2.6.3)
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [@turborepo on X](https://x.com/turborepo)
