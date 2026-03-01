# QCut E2E Test Plan

This document provides a comprehensive overview of all End-to-End (E2E) tests in the QCut project.

## Overview

- **Test Framework**: Playwright with Electron
- **Location**: `apps/web/src/test/e2e/`
- **Run Command**: `npx playwright test`
- **Total Test Files**: 22
- **Total Test Cases**: 131

### Latest Test Run Summary (2026-03-01)

| Status | Count |
|--------|-------|
| ✅ Passed | 110 |
| ❌ Failed | 3 |
| ⏭️ Skipped | 18 |
| **Total** | **131** |

**Pass Rate**: 97.3% (110/113 non-skipped)

**Failed Tests**:
1. `audio-video-simultaneous-export.e2e.ts` — "exports both streams when timeline has separate video and audio tracks": Export did not complete successfully (timeout 20s exceeded)
2. `project-folder-sync.e2e.ts` — "should handle missing electronAPI gracefully": `apiWasUndefined` expected `true`, got `false` (electronAPI cannot be nullified in Electron context)
3. `remotion-export-pipeline.e2e.ts` — "export dialog shows Remotion engine indicator when timeline has Remotion elements": Remotion engine UI indicator not found

**Skipped Tests (18)**:
- `sticker-overlay-export.e2e.ts`: 12 tests skipped (all tests in file)
- `ai-enhancement-export-integration.e2e.ts`: 1 test skipped (upscale image workflow — requires FAL API)
- `editor-navigation.e2e.ts`: 1 test skipped
- `remotion-folder-import.e2e.ts`: 1 test skipped
- `terminal-paste.e2e.ts`: 2 tests skipped (PTY-dependent, require `PTY_AVAILABLE=true`)
- `remotion-folder-import.e2e.ts`: 1 test skipped

---

## Test Files Summary

| # | File | Description | Tests | Status |
|---|------|-------------|-------|--------|
| 1 | `simple-navigation.e2e.ts` | Basic navigation tests | 3 | ✅ 3/3 |
| 2 | `editor-navigation.e2e.ts` | Editor page navigation | 3 | ✅ 2/3 (1 skip) |
| 3 | `project-workflow-part1.e2e.ts` | Project creation & media import | 2 | ✅ 2/2 |
| 4 | `project-workflow-part2.e2e.ts` | Timeline operations | 3 | ✅ 3/3 |
| 5 | `project-workflow-part3.e2e.ts` | Project persistence & export | 4 | ✅ 4/4 |
| 6 | `multi-media-management-part1.e2e.ts` | Multi-media import & tracks | 5 | ✅ 5/5 |
| 7 | `multi-media-management-part2.e2e.ts` | Timeline controls & editing | 7 | ✅ 7/7 |
| 8 | `text-overlay-testing.e2e.ts` | Text overlay functionality | 6 | ✅ 6/6 |
| 9 | `sticker-overlay-testing.e2e.ts` | Sticker overlay functionality | 6 | ✅ 6/6 |
| 10 | `ai-enhancement-export-integration.e2e.ts` | AI enhancement & export | 8 | ✅ 7/8 (1 skip) |
| 11 | `file-operations-storage-management.e2e.ts` | File operations & storage | 8 | ✅ 8/8 |
| 12 | `auto-save-export-file-management.e2e.ts` | Auto-save & export management | 6 | ✅ 6/6 |
| 13 | `terminal-paste.e2e.ts` | Terminal UI & paste functionality | 4 | ✅ 2/4 (2 skip) |
| 14 | `remotion-panel-stability.e2e.ts` | Remotion panel stability | 3 | ✅ 3/3 |
| 15 | `project-folder-sync.e2e.ts` | Project folder sync feature | 24 | ❌ 23/24 (1 fail) |
| 16 | `debug-projectid.e2e.ts` | Debug test for database issues | 1 | ✅ 1/1 |
| 17 | `audio-video-simultaneous-export.e2e.ts` | Audio + video simultaneous export | 1 | ❌ 0/1 |
| 18 | `remotion-export-pipeline.e2e.ts` | Remotion export pipeline | 4 | ❌ 3/4 (1 fail) |
| 19 | `remotion-folder-import.e2e.ts` | Remotion folder import | 19 | ✅ 18/19 (1 skip) |
| 20 | `screen-recording-repro.e2e.ts` | Screen recording reproduction | 1 | ✅ 1/1 |
| 21 | `sticker-overlay-export.e2e.ts` | Sticker overlay export | 12 | ⏭️ 12 skipped |
| 22 | `timeline-duration-limit.e2e.ts` | Timeline 2-hour duration support | 1 | ✅ 1/1 |

---

## Fixed Test Details (2026-03-01)

### 1. `audio-video-simultaneous-export.e2e.ts:326` — Export timeout (FIXED)
- **Root cause**: Console message mismatch — test waited for `"FFmpeg export completed successfully"` but actual log is `"FFmpeg export completed in Xs"`. Also, `debugLog()` is gated behind `isDebugEnabled()`.
- **Fix**: Enable debug mode via `localStorage.setItem("qcut_debug_mode", "true")` and match the actual log message pattern.

### 2. `project-folder-sync.e2e.ts:890` — Missing electronAPI test (FIXED)
- **Root cause**: `contextBridge.exposeInMainWorld` makes `electronAPI` non-configurable. Simple assignment `window.electronAPI = undefined` silently fails.
- **Fix**: Use `Object.defineProperty(window, "electronAPI", { value: undefined, configurable: true, writable: true })`.

### 3. `remotion-export-pipeline.e2e.ts:154` — Remotion engine indicator (FIXED)
- **Root cause**: Exact text selector `"Remotion Engine"` didn't match `"Remotion Engine (Medium Performance)"`.
- **Fix**: Changed to regex partial match: `page.getByText(/Remotion Engine/)`.

### 4. `sticker-overlay-export.e2e.ts` — 12 tests skipped (FIXED)
- **Root cause**: `addStickerToCanvas()` depends on Iconify API network calls. When unreachable, `fetchCollections()` sets error state preventing the sticker panel from rendering.
- **Fix**: Added Iconify API route mocking in `addStickerToCanvas()` helper — intercepts all 3 API hosts with mock collection and SVG responses.

### 5. `ai-enhancement-export-integration.e2e.ts` — Upscale test skipped (FIXED)
- **Root cause**: `getFalApiKey()` returns null and throws before the mocked `fal.run` route is reached.
- **Fix**: Set a mock FAL API key via `electronAPI.apiKeys.set()` before the upscale button click.

---

## Running Tests

### Run All E2E Tests
```bash
npx playwright test
```

### Run Specific Test File
```bash
npx playwright test apps/web/src/test/e2e/project-workflow-part1.e2e.ts
```

### Run with Headed Browser
```bash
npx playwright test --headed
```

---

## Test Helpers

Common test utilities are in `helpers/electron-helpers.ts`:

- `startElectronApp()` - Starts Electron app
- `getMainWindow()` - Gets main browser window
- `createTestProject()` - Creates a test project
- `importTestVideo()` - Imports test video file
- `importTestAudio()` - Imports test audio file
- `importTestImage()` - Imports test image file
- `ensureMediaTabActive()` - Navigate to Library > Media tab
- `ensureTextTabActive()` - Navigate to Edit > Manual Edit > Text tab
- `ensureStickersTabActive()` - Navigate to Edit > Manual Edit > Stickers tab
- `ensurePanelTabActive()` - Navigate to any group/tab combo
- `navigateToProjects()` - Navigates to projects page
- `cleanupDatabase()` - Cleans up test data
- `waitForProjectLoad()` - Waits for project to load

---

*Last Updated: 2026-03-01*
