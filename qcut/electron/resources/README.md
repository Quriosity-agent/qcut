# FFmpeg Resources

## CLI Binary

Production builds use staged binaries under:

`electron/resources/ffmpeg/<platform>-<arch>/`

Examples:
- `electron/resources/ffmpeg/darwin-arm64/ffmpeg`
- `electron/resources/ffmpeg/darwin-arm64/ffprobe`
- `electron/resources/ffmpeg/win32-x64/ffmpeg.exe`
- `electron/resources/ffmpeg/win32-x64/ffprobe.exe`

### How It Works

1. Run `bun run stage-ffmpeg-binaries`
2. The script stages FFmpeg/FFprobe for configured targets into `electron/resources/ffmpeg`
3. `electron-builder` copies that directory to packaged `resources/ffmpeg`
4. In packaged apps, runtime resolves binaries only from `process.resourcesPath/ffmpeg/<platform>-<arch>/`

### Path Resolution (electron/ffmpeg/utils.ts)

Packaged:
1. `process.resourcesPath/ffmpeg/<platform>-<arch>/<binary>`
2. Fail fast if missing

Development:
1. Staged binaries in `electron/resources/ffmpeg/<platform>-<arch>/`
2. `ffmpeg-static` / `ffprobe-static` fallback
3. System install fallback

## WebAssembly Files

WASM files (`ffmpeg-core.js`, `ffmpeg-core.wasm`) are copied from
`@ffmpeg/core` by `scripts/setup-ffmpeg.ts` during postinstall.
These are used for in-browser previews and thumbnails.

## Notes

- Staged native binaries are ignored by git via `.gitignore`.
- `ffmpeg-static`/`ffprobe-static` are still allowed as development fallbacks.

## Hardware Acceleration

FFmpeg CLI supports hardware acceleration for even faster encoding:
- NVENC (NVIDIA GPUs): `-c:v h264_nvenc`
- Quick Sync (Intel): `-c:v h264_qsv`
- AMD VCE: `-c:v h264_amf`

The current implementation uses software encoding for maximum compatibility.
