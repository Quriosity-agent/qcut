# Screen Recording for E2E Tests & Demos

## Goal

Record QCut's screen while running E2E tests or demos, producing video files that can be used for documentation, bug reports, or marketing.

## Difficulty Assessment: **Low-Medium**

Most of the infrastructure already exists. Electron provides `desktopCapturer` natively, Playwright has built-in video recording, and QCut already has FFmpeg binaries bundled. The main work is wiring things together and deciding which approach fits each use case.

---

## Two Approaches

### Approach A: Playwright Built-in Video (E2E only, easiest)

**Effort: ~1-2 hours**

Playwright already supports video recording per test. QCut's `playwright.config.ts` already has `video: "retain-on-failure"` — changing it to `"on"` records every test.

**What to change:**

1. **`playwright.config.ts`** — Set `video: "on"` and configure output dir
2. **Optional: test helpers** — Add a wrapper to name videos by test name

**Pros:**
- Zero new code in QCut itself
- Records exactly what the test sees
- Videos saved per-test automatically

**Cons:**
- Only works during Playwright E2E runs
- Cannot record ad-hoc demos
- Limited to browser viewport (no system UI)

---

### Approach B: Electron `desktopCapturer` Integration (Full feature)

**Effort: ~1-2 days**

Add a screen recording capability to QCut itself using Electron's `desktopCapturer` API. This lets QCut record its own window on demand — triggered by a button, keyboard shortcut, or IPC command.

**What to build:**

#### 1. New IPC handler: `electron/screen-recording-handler.ts` (~200-300 lines)

```text
Handlers:
- "screen:getSources"    → list available screens/windows via desktopCapturer
- "screen:startRecording" → begin capture (returns stream ID)
- "screen:stopRecording"  → stop + save file, return path
- "screen:getStatus"      → is recording active?
```

**Recording flow:**
- `desktopCapturer.getSources({ types: ["window"] })` to get QCut's own window
- Pass source ID to renderer via IPC
- Renderer uses `navigator.mediaDevices.getUserMedia()` with the chromeMediaSourceId
- `MediaRecorder` captures to WebM blobs
- On stop, send blobs to main process → save to disk
- Optionally, post-process with FFmpeg to convert WebM → MP4

#### 2. Preload API: add to `electron/preload.ts`

```typescript
screenRecording: {
  getSources: () => ipcRenderer.invoke("screen:getSources"),
  start: (sourceId: string, outputPath: string) => ...,
  stop: () => ...,
  getStatus: () => ...,
}
```

#### 3. Type definitions: add to `apps/web/src/types/electron.d.ts`

```typescript
screenRecording: {
  getSources(): Promise<Array<{ id: string; name: string; thumbnail: string }>>;
  start(sourceId: string, outputPath: string): Promise<void>;
  stop(): Promise<string>; // returns file path
  getStatus(): Promise<{ recording: boolean; duration: number }>;
}
```

#### 4. Registration in `electron/main.ts`

```typescript
const { setupScreenRecordingIPC } = require("./screen-recording-handler.js");
// Add to handlers array
["ScreenRecordingIPC", setupScreenRecordingIPC],
```

#### 5. Optional UI: Recording indicator component

- Small red dot overlay in the editor when recording
- Start/stop button in a toolbar or via keyboard shortcut (e.g., `Ctrl+Shift+R`)
- Timer showing elapsed recording time

#### 6. Optional: E2E test integration

- Tests can call `window.electronAPI.screenRecording.start()` in `beforeAll`
- Call `stop()` in `afterAll` to save the video
- Or wrap in a Playwright fixture for automatic per-test recording

**Pros:**
- Works for E2E tests AND ad-hoc demos
- Records the actual application window
- Can be triggered programmatically or manually
- Output can be post-processed with QCut's own FFmpeg

**Cons:**
- More code to write and maintain
- Requires `desktopCapturer` permission handling
- WebM output needs FFmpeg conversion for wider compatibility

---

## Recommended Path

| Use case | Approach |
|----------|----------|
| Just want E2E test videos | **A** — flip one config line |
| Want demo recording for docs/marketing | **B** — build the feature |
| Want both | Start with **A** now, build **B** later |

## Existing Infrastructure to Leverage

| What | Where | How it helps |
|------|-------|-------------|
| FFmpeg binaries | `ffmpeg-static`, `ffmpeg-ffprobe-static` | WebM → MP4 conversion |
| Canvas MediaRecorder | `lib/export-engine-recorder.ts` | Pattern reference for MediaRecorder usage |
| Playwright screenshots | `test/e2e/utils/screenshot-helper.ts` | Integration pattern for E2E |
| IPC handler pattern | `electron/theme-handler.ts` (62 lines) | Clean, minimal handler template |
| Preload pattern | `electron/preload.ts` | API exposure pattern |

## Key Technical Notes

- **No new dependencies needed** — Electron's `desktopCapturer` and browser `MediaRecorder` are built-in
- **Security**: `desktopCapturer` works with `contextIsolation: true` (QCut's current setting)
- **File size**: keep handler under 800 lines per CLAUDE.md rules (estimated ~200-300 lines)
- **Output format**: `MediaRecorder` produces WebM natively; use FFmpeg for MP4 if needed
- **Electron v37.4.0**: `desktopCapturer` is stable and fully supported

## Files That Would Be Modified/Created

**Approach A (minimal):**
- `playwright.config.ts` — 1 line change

**Approach B (full):**
- `electron/screen-recording-handler.ts` — new (~200-300 lines)
- `electron/preload.ts` — add screenRecording API (~15 lines)
- `electron/main.ts` — register handler (~3 lines)
- `apps/web/src/types/electron.d.ts` — add types (~10 lines)
- `apps/web/src/components/screen-recording-indicator.tsx` — optional UI (~80 lines)

---

## Review (2026-02-19)

### Verdict

Partially true.

### Confirmed as accurate in this repo

- `playwright.config.ts` currently has `video: "retain-on-failure"` (`playwright.config.ts:19`)
- Electron is `^37.4.0` (`package.json:31`)
- `contextIsolation: true` is enabled (`electron/main.ts:434`)
- FFmpeg binaries and staging are present (`package.json:353`, `package.json:354`, `package.json:179`)
- Referenced files exist:
  - `apps/web/src/lib/export-engine-recorder.ts`
  - `apps/web/src/test/e2e/utils/screenshot-helper.ts`
  - `electron/theme-handler.ts` (62 lines)
  - `electron/preload.ts`

### Corrections needed

1. Approach A is not a strict one-line change in this codebase.
The E2E suite uses a custom Electron fixture (`apps/web/src/test/e2e/helpers/electron-helpers.ts`) with `_electron.launch(...)` and does not pass `recordVideo`. So changing `use.video` in `playwright.config.ts` alone is likely insufficient for reliable Electron-window video capture.

2. The doc says "configure output dir" for Approach A, but `outputDir` is already set (`playwright.config.ts:11`).

3. A few file paths are shorthand; for consistency with this repo structure use full paths such as `apps/web/src/test/e2e/utils/screenshot-helper.ts`.

4. In E2E tests, calling `window.electronAPI.screenRecording.start()` must happen in renderer context (for example via `page.evaluate(...)`), not directly in Node test scope.

### Recommendation update

- Keep Approach B estimate as-is.
- Adjust Approach A estimate to include fixture wiring (for example, adding `recordVideo` in `_electron.launch(...)`), not only config changes.

---

## Testing Plan

### Approach A: Playwright Video Recording

**Manual verification only** — no new test code needed.

1. Set `video: "on"` in `playwright.config.ts` and add `recordVideo` to the Electron launch fixture in `apps/web/src/test/e2e/helpers/electron-helpers.ts`:
   ```typescript
   const electronApp = await electron.launch({
     args: ["dist/electron/main.js"],
     recordVideo: { dir: "test-results/videos" },
     env: { NODE_ENV: "test", ELECTRON_DISABLE_GPU: "1" },
   });
   ```
2. Run `bun run test:e2e` and confirm `.webm` files appear in `test-results/videos/`
3. Open a video and confirm it shows the actual test interaction (not a blank frame)

### Approach B: Electron `desktopCapturer` — Unit Tests

Create `electron/__tests__/screen-recording-handler.test.ts` following the existing IPC handler test pattern (see `electron/__tests__/ffmpeg-basic-handlers.test.ts`).

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Electron before importing handler
const mockHandle = vi.fn();
vi.mock("electron", () => ({
  ipcMain: { handle: mockHandle },
  desktopCapturer: { getSources: vi.fn() },
}));

import { setupScreenRecordingIPC } from "../screen-recording-handler.js";

function getHandler(channel: string) {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel);
  return call?.[1] as (...args: unknown[]) => unknown;
}
```

**Test cases:**

| Test | What it verifies |
|------|-----------------|
| Registers all expected IPC channels | `screen:getSources`, `screen:startRecording`, `screen:stopRecording`, `screen:getStatus` are all registered via `ipcMain.handle` |
| `screen:getSources` returns source list | Calls `desktopCapturer.getSources()` and returns `{ id, name, thumbnail }[]` |
| `screen:startRecording` sets status to recording | After calling start, `screen:getStatus` returns `{ recording: true }` |
| `screen:startRecording` rejects if already recording | Returns error when called while a recording is active |
| `screen:stopRecording` returns file path | Returns the saved file path and resets status |
| `screen:stopRecording` rejects if not recording | Returns error when no recording is active |
| `screen:getStatus` returns idle by default | Returns `{ recording: false, duration: 0 }` before any recording starts |
| File write errors are handled | Mock `fs.writeFile` to throw, confirm handler returns an error instead of crashing |

### Approach B: Electron `desktopCapturer` — E2E Tests

Create `apps/web/src/test/e2e/screen-recording.e2e.ts` using the existing Electron fixture.

The helpers `startScreenRecordingForE2E()` and `stopScreenRecordingForE2E()` already exist in `electron-helpers.ts` — wire them to the new IPC API.

```typescript
import { test, expect } from "./helpers/electron-helpers";

test("screen recording produces a video file", async ({ page }) => {
  // Start recording via renderer bridge
  await page.evaluate(() =>
    window.electronAPI.screenRecording.start("screen:0:0", "/tmp/test-recording.webm")
  );

  // Perform some actions so the recording has content
  await page.waitForTimeout(2000);

  // Stop and get the output path
  const filePath = await page.evaluate(() =>
    window.electronAPI.screenRecording.stop()
  );

  expect(filePath).toContain(".webm");
});

test("screen recording status reflects state", async ({ page }) => {
  const before = await page.evaluate(() =>
    window.electronAPI.screenRecording.getStatus()
  );
  expect(before.recording).toBe(false);

  await page.evaluate(() =>
    window.electronAPI.screenRecording.start("screen:0:0", "/tmp/test-status.webm")
  );

  const during = await page.evaluate(() =>
    window.electronAPI.screenRecording.getStatus()
  );
  expect(during.recording).toBe(true);

  await page.evaluate(() =>
    window.electronAPI.screenRecording.stop()
  );

  const after = await page.evaluate(() =>
    window.electronAPI.screenRecording.getStatus()
  );
  expect(after.recording).toBe(false);
});
```

### Optional: UI Component Tests

If the recording indicator component is built, add a Vitest unit test at `apps/web/src/components/__tests__/screen-recording-indicator.test.tsx`:

- Mock `window.electronAPI.screenRecording` with `vi.fn()`
- Render the component with `@testing-library/react`
- Test that the red dot appears when recording is active
- Test that clicking stop calls `screenRecording.stop()`
- Test that elapsed time displays and increments

### How to Run

```bash
# Unit tests (includes IPC handler tests)
bun run test

# E2E tests (full Electron app)
bun run test:e2e

# E2E with visible window (useful for debugging recording)
bun run test:e2e:headed
```
