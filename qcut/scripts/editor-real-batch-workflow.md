# Real 32-clip desktop acceptance

This opt-in harness uses the built Electron application, source CLI, utility
server, main process, renderer and project storage. It requires a local folder
containing exactly 32 real MP4 clips at 1470×630 / 24 fps, plus `ffmpeg` and
`ffprobe` on PATH. No media or model files belong in Git.

Run from `qcut/` after installing dependencies and building the app:

```sh
bun run build
node --experimental-strip-types scripts/editor-real-batch-workflow.ts \
  --asset-root /path/to/32-real-clips \
  --output-dir .local/real-batch-acceptance \
  --phase prepare

# Rebuild Electron here if testing additional native export changes.
node --experimental-strip-types scripts/editor-real-batch-workflow.ts \
  --asset-root /path/to/32-real-clips \
  --output-dir .local/real-batch-acceptance \
  --phase export

# Verify authenticated project.json auto-sync and save/reopen without re-exporting video.
node --experimental-strip-types scripts/editor-real-batch-workflow.ts \
  --asset-root /path/to/32-real-clips \
  --output-dir .local/real-batch-acceptance \
  --phase sidecar
```

Use Node for the Playwright driver. Bun still runs the source CLI. Ensure the
output directory is locally Git-ignored before running: it contains source
paths, copied runtime profile data, screenshots and exports.

Each phase launches and closes its own Electron instance with a dedicated
profile, XDG state directory, API port and bearer token. It creates a fresh UUID
project in QCut's normal project storage; existing projects and original media
are untouched. The profile/project are retained for inspection and reopening.
The test window uses `showInactive()` and disables background throttling so the
real preview clock runs without requiring foreground focus.

`prepare` imports 20 + 12 files, then adds all 32 in one `batch-add` with
`startTime: "end"` and no CLI timeout override. It checks order, count, unique
IDs, contiguous positions and video stream durations. It records real playback
events, verifies preview images change and checks the public playhead after
pausing. It then calls the same `saveCurrentProject` / `saveImmediate` actions
used by the repository's existing Electron E2Es, closes and reopens the app,
and checks every element ID and position survived. A resumed preparation run
never retries an already populated timeline.

`export` renders the complete timeline twice through the native CLI engine at
1470×630 / 24 fps and +12 dB master gain: limiter disabled, then enabled with a
−1 dB ceiling. It independently verifies full-file decode, dimensions, frame
count, duration, true peak, native limiting metadata, identical video-packet
hashes and unchanged original-source hashes. Frame captures and pixel-difference
images at 1, 16 and 30 seconds are linked from `index.html`.

`sidecar` temporarily changes only the isolated project's name, verifies the
HTTP auto-sync writes that exact name into `project.json`, and restores it in
`finally`. It then saves and reopens, verifies the IPC sidecar writer and exact
timeline preservation, and runs authenticated `editor:project:export-state`.
The result requires both successful write logs and no new `Unauthorized` logs.
This phase writes `sidecar-result.json`, `sidecar-project-export.json` and
`sidecar-reopened.png`; it does not render another video.

The output includes `prepare-result.json`, `batch-result.json`,
`timeline-before-reopen.json`, `timeline-after-reopen.json`, `playback.json`,
`export-pair-result.json`, per-command receipts and per-run Electron logs. A real run
that completes below ten seconds verifies desktop integration; the delayed
utility/client unit tests separately exercise the historical timeout boundaries.

Type-check the opt-in scripts without expanding the normal CI media requirements:

```sh
bunx tsc --noEmit --skipLibCheck --strict --types node --lib ES2022,DOM \
  --target ES2022 --module ESNext --moduleResolution Bundler \
  --allowImportingTsExtensions scripts/editor-real-batch-workflow.ts \
  scripts/editor-real-batch-evidence.ts scripts/editor-real-batch-export.ts \
  scripts/editor-real-batch-sidecar.ts
```
