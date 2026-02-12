# FFprobe Production Better Idea

## Summary

Use a deterministic, app-bundled FFmpeg/FFprobe pipeline for production builds instead of relying on runtime `node_modules` binary resolution.

This removes platform/package-manager variability and prevents regressions like macOS arm64 `spawn Unknown system error -86`.

## Key Finding

`ffmpeg-ffprobe-static` appears installed but binaries are missing because Bun blocked lifecycle scripts (`bun pm untrusted`), so the package `install` step did not download `ffmpeg`/`ffprobe`.

## Better Production Approach

1. Build-time binary staging
- Add a script that fetches or copies `ffmpeg` and `ffprobe` for each target OS/arch into:
  - `electron/resources/ffmpeg/<platform>-<arch>/`
- Validate each binary with:
  - `-version`
  - optional checksum verification

2. Package only staged binaries
- In `electron-builder`, include and unpack only:
  - `electron/resources/ffmpeg/**`
- Stop using packaged `node_modules/ffprobe-static` and `node_modules/ffmpeg-static` as runtime production sources.

3. Runtime path resolution contract
- In packaged mode:
  - resolve only from `process.resourcesPath` + staged ffmpeg directory
  - fail fast with explicit diagnostics if missing
- In development mode:
  - allow package/system fallback for local convenience

4. CI release gates by platform
- For each build target, run a smoke check:
  - `ffmpeg -version`
  - `ffprobe -version`
  - architecture validation on macOS (arm64 vs x64)
- Block release when any check fails.

## Why This Is Better

- Predictable: same binary layout in every release.
- User-friendly: no Homebrew/manual installs required.
- Safer: catches architecture/package errors before shipping.
- Simpler runtime: fewer fallbacks in packaged app.

## Short-Term Unblock (If Needed)

If temporarily keeping `ffmpeg-ffprobe-static`:
- add it to `trustedDependencies` in `package.json`
- run Bun trust flow so its install script downloads binaries

This can unblock local/dev validation while the deterministic packaging approach is implemented.

