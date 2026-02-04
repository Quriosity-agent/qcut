# CLAUDE.md Update To-Do List

**Created**: 2026-02-04
**Status**: Pending
**Priority**: High

This document tracks outdated items in `CLAUDE.md` that need to be updated.

---

## Critical Updates Required

### 1. Package Version Updates

| Dependency | Documented | Actual | Action |
|---|---|---|---|
| Vite | 7.0.6 | 7.1.3 | Update |
| Tailwind CSS | 4.1.11 | 4.1.12 | Update |
| TanStack Router | Not specified | 1.131.28 | Add |
| Zustand | Not specified | 5.0.8 | Add |
| TypeScript | Not specified | 5.9.2 | Add |
| Turbo | Not specified | 2.8.0 | Add |
| Bun | Not specified | 1.2.18 | Add |

**Note**: React (18.3.1), Electron (37.4.0), Vitest (3.2.4), and @testing-library/react (16.3.0) are correct.

- [ ] Update Vite version from 7.0.6 to 7.1.3
- [ ] Update Tailwind CSS version from 4.1.11 to 4.1.12
- [ ] Add missing dependency versions to Tech Stack section

---

### 2. IPC Handler Count Correction

**Current Documentation**: "38 IPC handlers across 6 files"
**Actual**: 26 ipcMain.handle() calls in main.ts, distributed across 21+ handler files

- [ ] Update IPC handler count to reflect actual numbers
- [ ] Update the handler file count from "6 files" to "21+ handler files"

---

### 3. New Electron Handlers Not Documented

The following handler files exist but are not mentioned in CLAUDE.md:

#### Core Handlers (Missing)
- [ ] `electron/ai-pipeline-handler.ts` - AI pipeline orchestration
- [ ] `electron/ai-video-save-handler.ts` - AI video saving
- [ ] `electron/elevenlabs-transcribe-handler.ts` - ElevenLabs transcription
- [ ] `electron/gemini-chat-handler.ts` - Gemini chat integration
- [ ] `electron/gemini-transcribe-handler.ts` - Gemini transcription
- [ ] `electron/media-import-handler.ts` - Media import handling
- [ ] `electron/project-folder-handler.ts` - Project folder management
- [ ] `electron/remotion-folder-handler.ts` - Remotion folder handling
- [ ] `electron/skills-handler.ts` - Skills system handler
- [ ] `electron/theme-handler.ts` - Theme management
- [ ] `electron/audio-temp-handler.ts` - Audio temp file management
- [ ] `electron/video-temp-handler.ts` - Video temp file management

#### Claude Integration (New Feature - Completely Undocumented)
- [ ] Document `electron/claude/` directory (new subsystem)
- [ ] `electron/claude/claude-diagnostics-handler.ts`
- [ ] `electron/claude/claude-export-handler.ts`
- [ ] `electron/claude/claude-media-handler.ts`
- [ ] `electron/claude/claude-project-handler.ts`
- [ ] `electron/claude/claude-timeline-handler.ts`

#### Utility Modules (New)
- [ ] `electron/binary-manager.ts` - Binary management utility
- [ ] `electron/remotion-bundler.ts` - Remotion bundling utility
- [ ] `electron/remotion-composition-parser.ts` - Composition parsing
- [ ] `electron/temp-manager.ts` - Temp file management

---

### 4. AI Video Generation Documentation Gaps

Missing files from the documented AI Video module:

- [ ] Add `generators/base-generator.ts` to documentation
- [ ] Add `generators/image.ts` to documentation
- [ ] Add `core/fal-upload.ts` to documentation

---

### 5. Test Count Update

**Current Documentation**: "All 200+ tests passing successfully"
**Actual**: 236 test files found

- [ ] Update test count to reflect actual number (~236 test files)

---

### 6. Transcribe Handler Discrepancy

**Documented**: `electron/transcribe-handler.ts`
**Actual**: No generic `transcribe-handler.ts` exists. Instead:
- `electron/elevenlabs-transcribe-handler.ts`
- `electron/gemini-transcribe-handler.ts`

- [ ] Remove reference to non-existent `transcribe-handler.ts`
- [ ] Add references to actual transcribe handlers

---

## Structural Improvements

### 7. Handler Organization by Category

Consider reorganizing the Electron Backend section with handlers grouped by category:

- [ ] **Audio**: audio-temp-handler, sound-handler
- [ ] **Video**: video-temp-handler, ffmpeg-handler, ai-video-save-handler
- [ ] **AI Integration**: ai-pipeline-handler, gemini-chat-handler, gemini-transcribe-handler, elevenlabs-transcribe-handler
- [ ] **Claude Integration**: claude/ directory handlers
- [ ] **Project Management**: project-folder-handler, media-import-handler
- [ ] **Remotion**: remotion-folder-handler, remotion-bundler, remotion-composition-parser
- [ ] **System**: theme-handler, skills-handler, api-key-handler

---

### 8. Add Missing Electron Directory Documentation

These directories exist in `electron/` but aren't documented:

- [ ] `electron/claude/` - Claude integration subsystem
- [ ] `electron/ffmpeg/` - FFmpeg utilities and structure
- [ ] `electron/config/` - Configuration files

---

## Low Priority Updates

### 9. Web App Version Clarification

- [ ] Clarify version discrepancy: root package.json shows "0.3.52" vs web app package.json shows "0.2.1"

### 10. Consider Adding Version Table

- [ ] Create a comprehensive version table in the Tech Stack section listing all major dependencies with their current versions

---

## Summary

| Category | Items to Update |
|---|---|
| Version Updates | 7 items |
| Handler Documentation | 16+ handlers |
| New Features | Claude integration (5 handlers) |
| Structural Changes | Handler count, test count |
| AI Video Module | 3 missing files |

**Estimated Effort**: Medium (mostly documentation additions)

---

## Notes

- The documentation structure is sound; most updates are additive
- The Claude integration is a significant new feature that needs dedicated documentation
- Consider creating a separate handler inventory document for detailed IPC documentation
