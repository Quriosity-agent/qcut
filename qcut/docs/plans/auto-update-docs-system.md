# Auto-Update Documentation System

**Status: IMPLEMENTED WITH FIXES VERIFIED** (2026-02-10)

## Goal

Create a documentation-driven auto-update system where Markdown files under `docs/` serve as the source of truth for release notes, changelogs, and "What's New" content. When a new version is released, the client automatically fetches and displays this content to users.

## Fix Verification (2026-02-10)

Two post-implementation bugs were fixed and verified:

1. **Release script `[Unreleased]` parsing bug fixed** (`scripts/release.ts`)
   - Hardened regex for extracting and replacing the `[Unreleased]` section so an empty section no longer consumes the next version header.
   - Prevents malformed `docs/releases/v*.md` content like nested previous-version headers.

2. **Update notification fallback bug fixed** (`electron/main.ts`, `apps/web/src/components/update-notification.tsx`)
   - Main process now normalizes auto-updater `releaseNotes` payloads to a renderer-safe string.
   - Renderer now falls back to updater-provided release notes when local `docs/releases/v{newVersion}.md` is not available in the currently installed app.

**Verification run:**
- `bun x tsc -p electron/tsconfig.json --noEmit` → PASS
- `bun x tsc --noEmit` (in `apps/web`) → PASS
- Regex sanity check on current `CHANGELOG.md` confirmed empty `[Unreleased]` parses as empty content, not the next version section.

## Current State Analysis

### What Exists
- **Electron auto-updater** (`electron/main.ts:138-229`): Channel-aware (`alpha/beta/rc/latest`), checks hourly, downloads updates via GitHub Releases + `electron-updater`
- **IPC handlers + preload bridge** (`electron/main.ts`, `electron/preload.ts`): `check-for-updates` and `install-update` are exposed to renderer via `window.electronAPI.updates`
- **CHANGELOG.md** (root): Keep a Changelog format with version history
- **Release script** (`scripts/release.ts`): Generates `RELEASE_NOTES.md` template per build
- **Blog system** (`routes/blog.tsx`, `routes/blog.$slug.tsx`): Uses MarbleCMS external API — not local docs
- **Roadmap page** (`routes/roadmap.tsx`): Placeholder page with no content

### What Was Missing (now resolved)
1. ~~No way for renderer to trigger manual update checks (preload gap)~~ → `electron/preload.ts:1527-1545`
2. ~~No in-app UI showing release notes / "What's New"~~ → `apps/web/src/components/update-notification.tsx`
3. ~~No mechanism to read local `docs/` Markdown and display it~~ → `electron/release-notes-utils.ts`
4. ~~Release notes are generated as a template but not consumed by the app~~ → `scripts/release.ts:153-222`
5. ~~No structured docs for per-version release notes~~ → `docs/releases/`

## Architecture

```
docs/releases/                    ← NEW: version-specific release notes
  ├── latest.md                   ← Symlink/copy of most recent version
  ├── v0.3.53.md
  ├── v0.3.52.md
  └── ...
scripts/release.ts                ← MODIFIED: auto-generate release doc
electron/main.ts                  ← MODIFIED: serve release docs to renderer
electron/preload.ts               ← MODIFIED: expose update + release notes API
apps/web/src/
  ├── components/
  │   └── update-notification.tsx  ← NEW: toast/banner for available updates
  ├── lib/
  │   └── release-notes.ts         ← NEW: parse & render Markdown release notes
  └── routes/
      └── changelog.tsx            ← NEW: full changelog viewer page
```

## Implementation Plan

### Subtask 1: Create `docs/releases/` structure with version Markdown files — DONE

Create a structured `docs/releases/` directory with per-version release notes.

**Files:**
- `docs/releases/README.md` — explains the format and conventions
- `docs/releases/v0.3.52.md` — backfill from CHANGELOG.md
- `docs/releases/v0.3.53-alpha.1.md` — current unreleased notes

**Format per file:**
```markdown
---
version: "0.3.53-alpha.1"
date: "2026-02-08"
channel: "alpha"
---

# QCut v0.3.53-alpha.1

## What's New
- AI content pipeline skill with 51 models across 8 categories
- Speech-to-text transcription with ElevenLabs Scribe v2

## Improvements
- Improved media import with symlink support

## Bug Fixes
- Media import error handling for unexpected symlink failures
```

### Subtask 2: Expose update + release notes IPC in preload.ts — DONE

Bridge the existing `check-for-updates` and `install-update` IPC handlers to the renderer, plus add a new handler to read release notes from bundled docs.

**Files:**
- `electron/preload.ts` — add `updates` namespace to `electronAPI`
- `electron/main.ts` — add `get-release-notes` IPC handler that reads from `docs/releases/`

**New preload API:**
```typescript
window.electronAPI.updates = {
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  getReleaseNotes: (version?: string) => ipcRenderer.invoke("get-release-notes", version),
  getChangelog: () => ipcRenderer.invoke("get-changelog"),
  onUpdateAvailable: (callback) => { /* listener */ },
  onDownloadProgress: (callback) => { /* listener */ },
  onUpdateDownloaded: (callback) => { /* listener */ },
}
```

**New IPC handler in main.ts:**
```typescript
ipcMain.handle("get-release-notes", async (_, version?: string) => {
  // Read from docs/releases/<version>.md or docs/releases/latest.md
  // Parse frontmatter + markdown content
  // Return { version, date, channel, content }
});

ipcMain.handle("get-changelog", async () => {
  // Read CHANGELOG.md, return full content
});
```

**Actual implementation locations:**
- `electron/preload.ts:1527-1545` — `updates` namespace with 7 methods/listeners
- `electron/main.ts:1446-1474` — `get-release-notes` and `get-changelog` IPC handlers
- `apps/web/src/types/electron.d.ts:968-985` — `updates` property on `ElectronAPI`
- `apps/web/src/types/electron.d.ts:1012-1021` — `ReleaseNote` interface

### Subtask 3: Create update notification component — DONE

A toast/banner that appears when `update-available` IPC event fires, showing the new version and release highlights.

**Files:**
- `apps/web/src/components/update-notification.tsx` — React component
- `apps/web/src/lib/release-notes.ts` — Markdown parsing utility

**Behavior:**
1. On app launch, listens for `update-available` event from main process
2. When update is available, fetches release notes for that version via `getReleaseNotes(version)`
3. Shows a non-intrusive banner/toast with:
   - New version number
   - Top 3 highlights from "What's New"
   - "View Details" button → opens changelog page
   - "Update Now" / "Later" buttons
4. When update is downloaded, shows "Restart to Update" prompt
5. Persists dismissal in localStorage so it doesn't re-show until next version

**Actual implementation locations:**
- `apps/web/src/components/update-notification.tsx` — `UpdateNotification` component
- `apps/web/src/lib/release-notes.ts` — `extractHighlights()`, `getChannelColor()`, `isVersionDismissed()`, `dismissVersion()`, `fetchReleaseNotes()`, `fetchChangelog()`
- `apps/web/src/routes/__root.tsx:7` — imports `UpdateNotification`
- `apps/web/src/routes/__root.tsx:39` — mounts `<UpdateNotification />`

### Subtask 4: Create changelog route page — DONE

A full in-app changelog page that renders all release notes.

**Files:**
- `apps/web/src/routes/changelog.tsx` — TanStack Router page

**Behavior:**
1. Reads all release notes from `docs/releases/` via IPC
2. Renders them in reverse chronological order
3. Each version is collapsible, with the latest expanded by default
4. Shows version badge (alpha/beta/rc/stable) with color coding
5. Falls back to reading `CHANGELOG.md` if per-version files aren't available

**Actual implementation location:**
- `apps/web/src/routes/changelog.tsx` — `/changelog` route with `ChannelBadge` and `MarkdownContent` components

### Subtask 5: Integrate release doc generation into release script — DONE

Modify `scripts/release.ts` to automatically create/update `docs/releases/v{version}.md` during the release process.

**Files:**
- `scripts/release.ts` — add step between version bump and build

**Behavior:**
1. After version bump, create `docs/releases/v{newVersion}.md` from template
2. Pull content from `CHANGELOG.md` [Unreleased] section
3. Move [Unreleased] items into the new version section in CHANGELOG.md
4. Copy to `docs/releases/latest.md`
5. Add `docs/releases/` files to git staging

**Actual implementation locations:**
- `scripts/release.ts:109` — calls `generateReleaseDoc(newVersion, releaseType)`
- `scripts/release.ts:153-222` — `generateReleaseDoc()` function implementation

### Subtask 6: Add unit tests — DONE (45 tests, all passing)

**Test files:**
- `apps/web/src/lib/__tests__/release-notes.test.ts` — 14 client-side tests (extractHighlights, getChannelColor, isVersionDismissed, dismissVersion)
- `electron/__tests__/release-notes-handler.test.ts` — 31 Electron-side tests (parseReleaseNote, compareSemver, parseChangelog, readReleaseNotesFromDir)

**Test cases covered:**
- Parse frontmatter from release note Markdown
- Handle missing/malformed release note files
- Version sorting (semver-aware)
- Channel detection from version string
- Fallback to CHANGELOG.md when per-version files missing
- Highlight extraction from release note content
- localStorage-based version dismissal

**Verification (2026-02-08):**
```
vitest run electron/__tests__/release-notes-handler.test.ts  → 31 passed
vitest run apps/web/src/lib/__tests__/release-notes.test.ts  → 14 passed
```

## Implementation Order (all complete)

```
Subtask 1 (docs structure)        ✅
    ↓
Subtask 2 (IPC bridge)            ✅
    ↓
Subtask 3 (notification component)✅
Subtask 4 (changelog page)        ✅
    ↓
Subtask 5 (release script)        ✅
    ↓
Subtask 6 (tests)                 ✅  45/45 passing
```

## Key Design Decisions

1. **Local docs, not remote API**: Release notes are bundled with the app in `docs/releases/`, not fetched from a server. This works offline and is versioned with git.
2. **Frontmatter metadata**: Each release note has YAML frontmatter for structured data (version, date, channel) so the UI can filter/sort without parsing Markdown.
3. **Graceful degradation**: If per-version files don't exist, falls back to `CHANGELOG.md`. If running in browser (not Electron), the changelog page reads from a bundled JSON.
4. **Channel-aware display**: Alpha/beta/rc badges help users understand their update channel.

## Implementation Files

### New Files
| File | Purpose |
|------|---------|
| `docs/releases/README.md` | Format documentation and conventions |
| `docs/releases/v0.1.0.md` | Release notes for v0.1.0 |
| `docs/releases/v0.2.0.md` | Release notes for v0.2.0 |
| `docs/releases/v0.3.0.md` | Release notes for v0.3.0 |
| `docs/releases/v0.3.52.md` | Release notes for v0.3.52 |
| `docs/releases/v0.3.53-alpha.1.md` | Release notes for v0.3.53-alpha.1 |
| `docs/releases/latest.md` | Copy of most recent stable release |
| `electron/release-notes-utils.ts` | Pure functions: `parseReleaseNote`, `compareSemver`, `parseChangelog`, `readReleaseNotesFromDir` |
| `apps/web/src/lib/release-notes.ts` | Client-side utilities: highlight extraction, version dismissal, IPC wrappers |
| `apps/web/src/components/update-notification.tsx` | Toast/banner for update events |
| `apps/web/src/routes/changelog.tsx` | In-app changelog page at `/changelog` |
| `apps/web/src/lib/__tests__/release-notes.test.ts` | 14 client-side unit tests |
| `electron/__tests__/release-notes-handler.test.ts` | 31 Electron-side unit tests |

### Modified Files
| File | Change |
|------|--------|
| `electron/main.ts` | Imports from `release-notes-utils.ts`, added `get-release-notes` and `get-changelog` IPC handlers |
| `electron/preload.ts` | Added `updates` namespace with 7 methods/listeners |
| `apps/web/src/types/electron.d.ts` | Added `ReleaseNote` interface and `updates` property on `ElectronAPI` |
| `apps/web/src/routes/__root.tsx` | Mounted `<UpdateNotification />` globally |
| `package.json` | Added `docs/releases/` and `CHANGELOG.md` to `extraResources` |
| `scripts/release.ts` | Added `generateReleaseDoc()` step in release flow |

## Post-Implementation Verification (2026-02-08)

All 19 files (13 new + 6 modified) verified present with correct content.

| Check | Result |
|-------|--------|
| All 7 release note Markdown files exist with YAML frontmatter | PASS |
| `electron/release-notes-utils.ts` exports 4 pure functions | PASS |
| `electron/main.ts` imports utils and has IPC handlers at L1446-1474 | PASS |
| `electron/preload.ts` has `updates` namespace at L1527-1545 | PASS |
| `apps/web/src/types/electron.d.ts` has `ReleaseNote` + `updates` types | PASS |
| `apps/web/src/components/update-notification.tsx` exists | PASS |
| `apps/web/src/routes/changelog.tsx` exists at `/changelog` | PASS |
| `apps/web/src/routes/__root.tsx` mounts `<UpdateNotification />` | PASS |
| `scripts/release.ts` calls `generateReleaseDoc()` at L109 | PASS |
| `package.json` has `docs/releases/` in `extraResources` | PASS |
| 31 Electron-side tests pass | PASS |
| 14 client-side tests pass | PASS |
| No existing features broken (working tree clean) | PASS |
