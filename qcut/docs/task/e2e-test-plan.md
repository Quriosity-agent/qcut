# QCut E2E Test Plan

This document provides a comprehensive overview of all End-to-End (E2E) tests in the QCut project.

## Overview

- **Test Framework**: Playwright with Electron
- **Location**: `apps/web/src/test/e2e/`
- **Run Command**: `bun run test:e2e`
- **Total Test Files**: 17
- **Total Test Cases**: ~80+

### Latest Test Run Summary (2026-02-05)

| Status | Count |
|--------|-------|
| ✅ Passed | 75 |
| ❌ Failed | 1 |
| ⏭️ Skipped | 7 |
| **Total** | **83** |

**Pass Rate**: 98.7% (excluding skipped)

**Failed Tests**:
1. AI Enhancement: `4B.4 - Preview enhanced media with effects` (timeout on pause button)

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
| 10 | `ai-transcription-caption-generation.e2e.ts` | AI transcription & captions | 6 | ✅ 4/6 (2 skip) |
| 11 | `ai-enhancement-export-integration.e2e.ts` | AI enhancement & export | 8 | ⚠️ 6/8 (1 fail, 1 skip) |
| 12 | `file-operations-storage-management.e2e.ts` | File operations & storage | 8 | ✅ 8/8 |
| 13 | `auto-save-export-file-management.e2e.ts` | Auto-save & export management | 6 | ✅ 6/6 |
| 14 | `terminal-paste.e2e.ts` | Terminal UI & paste functionality | 4 | ✅ 2/4 (2 skip) |
| 15 | `remotion-panel-stability.e2e.ts` | Remotion panel stability | 3 | ✅ 3/3 |
| 16 | `project-folder-sync.e2e.ts` | Project folder sync feature | 24 | ✅ 24/24 |
| 17 | `debug-projectid.e2e.ts` | Debug test for database issues | 1 | ✅ 1/1 |

---

## Detailed Test Breakdown

### 1. Simple Navigation (`simple-navigation.e2e.ts`) ✅ ALL PASSED

Basic navigation tests to verify app loads correctly.

| Test | Description | Status |
|------|-------------|--------|
| `should navigate to projects page successfully` | Verifies projects page loads with proper elements | ✅ PASS |
| `should be able to detect project creation button` | Tests header and empty state buttons | ✅ PASS |
| `should handle project creation button click without crash` | Tests button click without navigation crash | ✅ PASS |

**Run Time**: 10.6s | **Last Run**: 2026-02-05

---

### 2. Editor Navigation (`editor-navigation.e2e.ts`) ✅ 2 PASSED, 1 SKIPPED

Tests navigation to the editor page to isolate crash issues.

| Test | Description | Status |
|------|-------------|--------|
| `should detect existing project on projects page` | Detects existing projects on projects page | ✅ PASS |
| `should attempt to open existing project without crash` | Opens project and verifies no crash | ⏭️ SKIP |
| `should check if direct navigation to editor works` | Tests direct navigation to editor route | ✅ PASS |

**Run Time**: 11.3s | **Last Run**: 2026-02-05 | **Note**: Test 2 skipped (no existing projects)

---

### 3. Project Workflow Part 1 - Creation & Media Import (`project-workflow-part1.e2e.ts`) ✅ ALL PASSED

Tests fundamental project workflow including project creation and media import.

| Test | Description | Status |
|------|-------------|--------|
| `should create project and import media` | Creates project (1080p, 30fps) and imports video | ✅ PASS |
| `should handle file upload process` | Tests file upload UI feedback | ✅ PASS |

**Run Time**: 10.4s | **Last Run**: 2026-02-05

---

### 4. Project Workflow Part 2 - Timeline Operations (`project-workflow-part2.e2e.ts`) ✅ ALL PASSED

Tests timeline operations and media integration.

| Test | Description | Status |
|------|-------------|--------|
| `should add media to timeline and perform basic edits` | Adds media to timeline, tests interactions | ✅ PASS |
| `should handle timeline element operations` | Tests timeline element interactions | ✅ PASS |
| `should support timeline element manipulation` | Tests element selection and manipulation | ✅ PASS |

**Run Time**: 14.4s | **Last Run**: 2026-02-05

---

### 5. Project Workflow Part 3 - Persistence & Export (`project-workflow-part3.e2e.ts`) ✅ ALL PASSED

Tests project persistence and export functionality.

| Test | Description | Status |
|------|-------------|--------|
| `should handle project persistence` | Tests project state persistence across navigation | ✅ PASS |
| `should access export functionality` | Verifies export button accessibility | ✅ PASS |
| `should maintain project state across sessions` | Tests state persistence after navigation | ✅ PASS |
| `should handle export configuration` | Tests export configuration UI | ✅ PASS |

**Run Time**: 19.8s | **Last Run**: 2026-02-05

---

### 6. Multi-Media Management Part 1 (`multi-media-management-part1.e2e.ts`) ✅ ALL PASSED

Tests multi-media import and track management.

| Test | Description | Status |
|------|-------------|--------|
| `should import multiple media types and manage tracks` | Imports video, audio, image; manages tracks | ✅ PASS |
| `should handle drag and drop to timeline` | Tests drag-and-drop from media panel | ✅ PASS |
| `should support multiple track types` | Verifies track type attributes | ✅ PASS |
| `should maintain timeline state across operations` | Tests timeline state persistence | ✅ PASS |
| `should display media items correctly` | Verifies media panel structure | ✅ PASS |

**Run Time**: 22.3s | **Last Run**: 2026-02-05

---

### 7. Multi-Media Management Part 2 - Timeline Controls (`multi-media-management-part2.e2e.ts`) ✅ ALL PASSED

Tests timeline controls and editing operations.

| Test | Description | Status |
|------|-------------|--------|
| `should control playback with play/pause buttons` | Tests play/pause functionality | ✅ PASS |
| `should handle zoom controls` | Tests zoom in/out buttons | ✅ PASS |
| `should display current time and duration` | Verifies time display format | ✅ PASS |
| `should handle split clip functionality` | Tests split button availability | ✅ PASS |
| `should handle timeline element selection and editing` | Tests element selection and trim handles | ✅ PASS |
| `should maintain playback state` | Tests playback state persistence | ✅ PASS |
| `should handle timeline scrolling and navigation` | Tests timeline dimensions and scrolling | ✅ PASS |

**Run Time**: 29.6s | **Last Run**: 2026-02-05

---

### 8. Text Overlay Testing (`text-overlay-testing.e2e.ts`)

Tests text overlay functionality in the editor.

| Test | Description |
|------|-------------|
| `should access text panel and interact with text overlay button` | Opens text panel, tests button interactions |
| `should support text drag and drop to timeline` | Tests drag-and-drop to timeline |
| `should handle text panel state and functionality` | Tests panel structure and styling |
| `should support text overlay interactions with timeline` | Tests plus button and element creation |
| `should maintain text overlay state across panel switches` | Tests state persistence across tabs |
| `should handle text overlay rendering in preview canvas` | Tests canvas positioning and z-index |

---

### 9. Sticker Overlay Testing (`sticker-overlay-testing.e2e.ts`) ✅ ALL PASSED

Tests sticker overlay functionality in the editor.

| Test | Description | Status |
|------|-------------|--------|
| `should access stickers panel and interact with sticker items` | Opens sticker panel, tests selection | ✅ PASS |
| `should support sticker drag and drop to canvas` | Tests drag-and-drop to sticker canvas | ✅ PASS |
| `should manipulate stickers on canvas after placement` | Tests selection, repositioning, resizing, deletion | ✅ PASS |
| `should handle sticker panel categories and search` | Tests search and category navigation | ✅ PASS |
| `should handle sticker overlay rendering` | Tests canvas positioning and z-index | ✅ PASS |
| `should maintain sticker panel state across interactions` | Tests state persistence across tabs | ✅ PASS |

**Run Time**: 47.7s | **Last Run**: 2026-02-05

---

### 10. AI Transcription & Caption Generation (`ai-transcription-caption-generation.e2e.ts`) ✅ 4 PASSED, 2 SKIPPED

Tests AI-powered transcription and caption generation workflow.

| Test | Description | Status |
|------|-------------|--------|
| `4A.1 - Upload media file and access AI transcription` | Uploads media, accesses transcription panel | ✅ PASS |
| `4A.2 - Generate transcription with AI service` | Generates transcription with AI | ✅ PASS |
| `4A.3 - Edit and customize generated captions` | Edits AI-generated captions | ✅ PASS |
| `4A.4 - Apply captions to timeline` | Applies captions to timeline tracks | ✅ PASS |
| `4A.5 - Preview captions in video preview` | Tests caption display during playback | ⏭️ SKIP |
| `4A.6 - Export project with embedded captions` | Exports with embedded captions | ⏭️ SKIP |

**Run Time**: 32.2s | **Last Run**: 2026-02-05 | **Note**: Tests 5-6 skipped (marked skip in test file)

---

### 11. AI Enhancement & Export Integration (`ai-enhancement-export-integration.e2e.ts`) ⚠️ 6 PASSED, 1 FAILED, 1 SKIPPED

Tests AI-powered video enhancement and export integration.

| Test | Description | Status |
|------|-------------|--------|
| `4B.1 - Access AI enhancement tools` | Accesses AI enhancement panel | ✅ PASS |
| `4B.2 - Apply AI enhancement effects to media` | Applies AI effects to media | ✅ PASS |
| `4B.3 - Use enhanced media in timeline` | Drags enhanced media to timeline | ✅ PASS |
| `4B.4 - Preview enhanced media with effects` | Tests playback preview with enhancements | ❌ FAIL |
| `4B.5 - Export enhanced project with AI effects` | Exports with AI enhancements | ✅ PASS |
| `4B.6 - Batch apply AI enhancements to multiple assets` | Tests bulk enhancement processing | ✅ PASS |
| `4B.7 - Integration with project export workflow` | Tests end-to-end export workflow | ✅ PASS |
| `upscale image workflow` | Tests image upscaling with FAL API | ⏭️ SKIP |

**Run Time**: 2.0m | **Last Run**: 2026-02-05 | **Note**: 4B.4 failed (timeout waiting for pause button); upscale skipped

---

### 12. File Operations & Storage Management (`file-operations-storage-management.e2e.ts`) ✅ ALL PASSED

Tests comprehensive file operations and storage management.

| Test | Description | Status |
|------|-------------|--------|
| `5A.1 - Import media files with progress tracking` | Tests import with progress indicators | ✅ PASS |
| `5A.2 - Handle large file imports` | Tests large file handling and memory | ✅ PASS |
| `5A.3 - Test storage quota and fallback system` | Tests storage quota monitoring | ✅ PASS |
| `5A.4 - Verify thumbnail generation for media` | Tests automatic thumbnail generation | ✅ PASS |
| `5A.5 - Test drag and drop file operations` | Tests drag-and-drop file operations | ✅ PASS |
| `5A.6 - Test file format support and validation` | Tests various file format handling | ✅ PASS |
| `5A.7 - Test storage service integration` | Tests project persistence and retrieval | ✅ PASS |
| `5A.8 - Test cross-platform file path handling` | Tests platform-specific file paths | ✅ PASS |

**Run Time**: 55.9s | **Last Run**: 2026-02-05

---

### 13. Auto-Save & Export File Management (`auto-save-export-file-management.e2e.ts`) ✅ ALL PASSED

Tests auto-save and export file management functionality.

| Test | Description | Status |
|------|-------------|--------|
| `5B.1 - Configure and test auto-save functionality` | Tests auto-save configuration and triggering | ✅ PASS |
| `5B.2 - Test project recovery after crash simulation` | Tests crash recovery workflow | ✅ PASS |
| `5B.3 - Test export to custom directories` | Tests custom export location selection | ✅ PASS |
| `5B.4 - Test export file format and quality options` | Tests format and quality configuration | ✅ PASS |
| `5B.5 - Test file permissions and cross-platform compatibility` | Tests cross-platform file operations | ✅ PASS |
| `5B.6 - Test comprehensive export workflow with all features` | Tests end-to-end export with all options | ✅ PASS |

**Run Time**: 1.8m | **Last Run**: 2026-02-05

---

### 14. Terminal Paste Functionality (`terminal-paste.e2e.ts`) ✅ 2 PASSED, 2 SKIPPED

Tests terminal UI and paste functionality (fixes double-paste bug).

| Test | Description | Status |
|------|-------------|--------|
| `should navigate to terminal tab` | Navigates to terminal tab, verifies UI | ✅ PASS |
| `should display terminal UI elements correctly` | Verifies terminal UI elements | ✅ PASS |
| `should start and stop shell terminal session` (PTY) | Starts/stops shell session | ⏭️ SKIP |
| `should paste text only once in terminal` (PTY) | Verifies no double-paste bug | ⏭️ SKIP |

**Run Time**: 8.1s | **Last Run**: 2026-02-05 | **Note**: PTY-dependent tests require `PTY_AVAILABLE=true` env variable

---

### 15. Remotion Panel Stability (`remotion-panel-stability.e2e.ts`) ✅ ALL PASSED

Tests that Remotion panel doesn't cause infinite render loops (React Error #185).

| Test | Description | Status |
|------|-------------|--------|
| `should not cause infinite render loops when opening editor` | Detects React Error #185 | ✅ PASS |
| `should render Remotion panel without infinite loops` | Opens Remotion panel, checks for errors | ✅ PASS |
| `should load editor without errors` | General editor load test | ✅ PASS |

**Run Time**: 20.0s | **Last Run**: 2026-02-05

---

### 16. Project Folder Sync (`project-folder-sync.e2e.ts`) ✅ ALL PASSED

Tests the project folder sync feature with IPC handlers, UI, and integration.

#### Subtask 1: Directory Scanning IPC Handlers

| Test | Description | Status |
|------|-------------|--------|
| `should ensure project folder structure exists` | Creates project folder structure | ✅ PASS |
| `should list directory contents via IPC` | Lists directory via IPC | ✅ PASS |
| `should scan directory for media files recursively` | Recursive media file scan | ✅ PASS |
| `should get project root path via IPC` | Gets project root path | ✅ PASS |
| `should prevent path traversal attacks` | Tests security against path traversal | ✅ PASS |

#### Subtask 2: Project Folder Browser UI

| Test | Description | Status |
|------|-------------|--------|
| `should display Project Folder tab in Media Panel` | Verifies tab existence | ✅ PASS |
| `should show empty state when project folder is empty` | Tests empty state UI | ✅ PASS |
| `should display breadcrumb navigation` | Tests breadcrumb display | ✅ PASS |
| `should refresh directory listing on button click` | Tests refresh functionality | ✅ PASS |
| `should disable up navigation at root level` | Tests navigation constraints | ✅ PASS |

#### Subtask 3: Bulk Import Functionality

| Test | Description | Status |
|------|-------------|--------|
| `should select all media files with Select All button` | Tests Select All functionality | ✅ PASS |
| `should clear selection with Clear button` | Tests Clear selection | ✅ PASS |
| `should show Import button when files are selected` | Tests Import button visibility | ✅ PASS |
| `should toggle individual file selection via checkbox` | Tests individual selection | ✅ PASS |

#### Subtask 4: Media Panel Integration

| Test | Description | Status |
|------|-------------|--------|
| `should integrate project folder view with media panel` | Tests media panel integration | ✅ PASS |
| `should switch between different media panel views` | Tests view switching | ✅ PASS |
| `should maintain project folder state across tab switches` | Tests state persistence | ✅ PASS |
| `should display correct icons for different file types` | Tests file type icons | ✅ PASS |

#### Subtask 5: File Type Detection

| Test | Description | Status |
|------|-------------|--------|
| `should detect video file types correctly` | Tests video extension detection | ✅ PASS |
| `should detect audio file types correctly` | Tests audio extension detection | ✅ PASS |
| `should detect image file types correctly` | Tests image extension detection | ✅ PASS |
| `should mark non-media files as unknown` | Tests unknown type handling | ✅ PASS |

#### Subtask 6: Error Handling

| Test | Description | Status |
|------|-------------|--------|
| `should handle missing electronAPI gracefully` | Tests graceful API absence handling | ✅ PASS |
| `should display error state in UI` | Tests error state display | ✅ PASS |

**Run Time**: 1.8m | **Last Run**: 2026-02-05

---

### 17. Debug ProjectId (`debug-projectid.e2e.ts`) ✅ ALL PASSED

Debug test to identify database issues (300+ databases being created).

| Test | Description | Status |
|------|-------------|--------|
| `track projectId during sticker selection` | Tracks projectId during sticker flow | ✅ PASS |

**Run Time**: 11.3s | **Last Run**: 2026-02-05

---

## Running Tests

### Run All E2E Tests
```bash
bun run test:e2e
```

### Run Specific Test File
```bash
bun run test:e2e -- --grep "Project Folder Sync"
```

### Run Specific Test
```bash
bun run test:e2e -- --grep "should ensure project folder structure"
```

### Run with Verbose Output
```bash
bun run test:e2e -- --reporter=list
```

### Run with Headed Browser
```bash
bun run test:e2e -- --headed
```

---

## Test Fixtures

Media fixtures are located at:
```text
apps/web/src/test/e2e/fixtures/media/
├── sample-video.mp4
├── sample-audio.mp3
└── sample-image.png
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
- `navigateToProjects()` - Navigates to projects page
- `cleanupDatabase()` - Cleans up test data
- `waitForProjectLoad()` - Waits for project to load

---

## Test Categories by Priority

### High Priority (Core Functionality)
1. Simple Navigation
2. Project Workflow (Parts 1-3)
3. Multi-Media Management (Parts 1-2)
4. File Operations & Storage

### Medium Priority (Feature Testing)
5. Text Overlay Testing
6. Sticker Overlay Testing
7. AI Transcription & Captions
8. AI Enhancement & Export
9. Auto-Save & Export Management

### Lower Priority (Stability & Debug)
10. Terminal Paste
11. Remotion Panel Stability
12. Project Folder Sync
13. Debug ProjectId

---

*Last Updated: 2026-02-05*
