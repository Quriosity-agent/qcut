# E2E Testing & Video Recording Guide

Run Playwright E2E tests against the Electron app and produce video recordings of every test.

## Prerequisites

```bash
# 1. Build the app (tests launch from dist/)
bun run build

# 2. Verify Electron starts
bun run electron
# Close the app after it launches successfully
```

## Quick Start

```bash
# Run all E2E tests with video recording + combined highlight reel
bun run test:e2e:record

# Run a single test file
bun run test:e2e:record -- apps/web/src/test/e2e/simple-navigation.e2e.ts

# Run tests matching a keyword
bun run test:e2e:record -- --grep "navigation"
```

## Commands

| Command | What it does |
|---------|-------------|
| `bun run test:e2e` | Run tests only (videos saved in raw output) |
| `bun run test:e2e:record` | Run tests + collect videos + combine into one MP4 |
| `bun run test:e2e:combine` | Re-combine videos from an existing run |
| `bun run test:e2e:ui` | Open Playwright's interactive UI mode |
| `bun run test:e2e:headed` | Run tests in a visible browser window |
| `bun run test:e2e:workflow` | Run only the project-workflow tests |

## How `test:e2e:record` Works

The command runs three steps in sequence:

1. **Playwright tests** — Executes all `*.e2e.ts` files against the Electron app. Each test is recorded as a `.webm` video.
2. **Video collector** (`scripts/collect-e2e-videos.ts`) — Copies `.webm`/`.mp4` files from Playwright's raw output into a timestamped run folder under `docs/completed/e2e-videos/run-<timestamp>/`. Generates a `manifest.json` listing every video with its test name and pass/fail status.
3. **Video combiner** (`scripts/combine-e2e-videos.ts`) — Reads the manifest and stitches all recordings into a single combined MP4 highlight reel using FFmpeg. Each clip gets an intro card showing the test name and status.

## Output Structure

```
docs/completed/
├── test-results-raw/        # Playwright raw artifacts (gitignored)
├── test-results/             # HTML report (gitignored)
└── e2e-videos/               # Video recordings (gitignored)
    ├── latest-run.json       # Pointer to most recent run
    └── run-2026-02-21T10-30-00-000Z/
        ├── manifest.json     # Test metadata + video paths
        ├── test-1-simple-navigation--passed.webm
        ├── test-2-editor-navigation--failed.webm
        └── combined.mp4      # All tests stitched together
```

All output folders are gitignored — nothing gets committed.

## Test Files

22 test files in `apps/web/src/test/e2e/`:

| File | Coverage |
|------|----------|
| `simple-navigation.e2e.ts` | Basic app launch and navigation |
| `editor-navigation.e2e.ts` | Editor-specific navigation |
| `project-workflow-part1.e2e.ts` | Project creation, media import |
| `project-workflow-part2.e2e.ts` | Timeline operations |
| `project-workflow-part3.e2e.ts` | Export, persistence |
| `multi-media-management-part1.e2e.ts` | Multiple media import |
| `multi-media-management-part2.e2e.ts` | Multi-media timeline |
| `ai-enhancement-export-integration.e2e.ts` | AI video enhancement |
| `ai-transcription-caption-generation.e2e.ts` | AI transcription/captions |
| `sticker-overlay-testing.e2e.ts` | Sticker overlays |
| `sticker-overlay-export.e2e.ts` | Sticker overlay export |
| `text-overlay-testing.e2e.ts` | Text overlays |
| `auto-save-export-file-management.e2e.ts` | Auto-save |
| `file-operations-storage-management.e2e.ts` | File operations |
| `audio-video-simultaneous-export.e2e.ts` | Audio/video export |
| `project-folder-sync.e2e.ts` | Project folder sync |
| `remotion-folder-import.e2e.ts` | Remotion folder import |
| `remotion-panel-stability.e2e.ts` | Remotion panel stability |
| `terminal-paste.e2e.ts` | Terminal paste |
| `timeline-duration-limit.e2e.ts` | Timeline duration limits |
| `debug-projectid.e2e.ts` | Debug/utility |

## Configuration

**File:** `playwright.config.ts`

| Setting | Value | Notes |
|---------|-------|-------|
| `video` | `"on"` | Record every test, pass or fail |
| `workers` | `1` | Sequential — Electron uses a fixed port |
| `screenshot` | `"only-on-failure"` | Captures on failure only |
| `trace` | `"on-first-retry"` | Trace on retry (CI has 2 retries) |
| `timeout` | `60000` | 60s per test |
| `expect.timeout` | `10000` | 10s per assertion |

## Combiner Options

Re-combine a previous run or customize the output:

```bash
# Combine from a specific run directory
bun run test:e2e:combine -- --run-dir docs/completed/e2e-videos/run-2026-02-21T10-30-00-000Z

# Custom output path
bun run test:e2e:combine -- --output ./my-highlight-reel.mp4

# Adjust intro card durations
bun run test:e2e:combine -- --intro-seconds 3 --failed-seconds 5
```

Combined video specs: 1280x720, 30fps, H.264, CRF 20.

## Running Individual Steps

```bash
# Just collect videos from the last Playwright run (no re-run)
bun scripts/collect-e2e-videos.ts

# Just combine videos from the latest collected run
bun scripts/combine-e2e-videos.ts
```

## Debugging Failed Tests

```bash
# Run in headed mode to watch the test live
bun run test:e2e:headed -- apps/web/src/test/e2e/simple-navigation.e2e.ts

# Open the Playwright UI for interactive debugging
bun run test:e2e:ui

# Run with Playwright debug mode (step through)
PWDEBUG=1 bunx playwright test apps/web/src/test/e2e/simple-navigation.e2e.ts

# View the HTML test report
bunx playwright show-report docs/completed/test-results
```

## Troubleshooting

**Tests fail to start / port conflict**
- Ensure no other Electron instance is running. Tests use a fixed port.
- Kill stray processes: `pkill -f "electron"` then retry.

**No videos in output**
- Check `docs/completed/test-results-raw/` for `.webm` files — Playwright writes there first.
- Re-run the collector: `bun scripts/collect-e2e-videos.ts`

**Combiner fails / no FFmpeg**
- The combiner requires FFmpeg. Install: `brew install ffmpeg` (macOS) or `apt install ffmpeg` (Linux).

**Tests timeout**
- Build may be stale. Re-run `bun run build` before testing.
- Increase timeout in `playwright.config.ts` if needed for slow machines.

## Key Source Files

| File | Purpose |
|------|---------|
| `playwright.config.ts` | Playwright configuration |
| `apps/web/src/test/e2e/helpers/electron-helpers.ts` | Shared test utilities |
| `scripts/collect-e2e-videos.ts` | Video artifact collector |
| `scripts/combine-e2e-videos.ts` | Video combiner (FFmpeg) |
| `scripts/run-e2e-record.ts` | Orchestrator (test + collect + combine) |
