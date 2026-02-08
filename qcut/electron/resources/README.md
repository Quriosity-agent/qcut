# FFmpeg Resources

## CLI Binary

FFmpeg and FFprobe CLI binaries are provided by the `ffmpeg-static` and
`ffprobe-static` npm packages. They are downloaded automatically during
`bun install`.

Manual download is no longer required.

### How It Works

- `bun install` downloads the platform-specific static binary into `node_modules/`
- `electron-builder` unpacks it from ASAR via the `asarUnpack` config
- At runtime, `require('ffmpeg-static')` returns the binary path
- In packaged apps, the path is rewritten from `app.asar` to `app.asar.unpacked`

### Path Resolution (electron/ffmpeg/utils.ts)

1. `ffmpeg-static` / `ffprobe-static` npm package (primary)
2. `electron/resources/ffmpeg(.exe)` (legacy fallback)
3. System paths: WinGet, Homebrew, apt, etc. (dev only)
4. System PATH (dev only)

## WebAssembly Files

WASM files (`ffmpeg-core.js`, `ffmpeg-core.wasm`) are copied from
`@ffmpeg/core` by `scripts/setup-ffmpeg.ts` during postinstall.
These are used for in-browser previews and thumbnails.

## Legacy

The DLL files previously committed here have been removed. `ffmpeg-static`
provides statically linked binaries that don't require separate shared libraries.

## Hardware Acceleration

FFmpeg CLI supports hardware acceleration for even faster encoding:
- NVENC (NVIDIA GPUs): `-c:v h264_nvenc`
- Quick Sync (Intel): `-c:v h264_qsv`
- AMD VCE: `-c:v h264_amf`

The current implementation uses software encoding for maximum compatibility.
