# AI Video Storage Migration: AppData → Documents

## Context

AI-generated videos save to `AppData\Roaming\qcut\projects\{id}\ai-videos\` (via `app.getPath("userData")`), while every other project feature uses `Documents\QCut\Projects\{id}\` (via `app.getPath("documents")`). This means:
- Project folder sync can't find AI videos
- Users can't find their generated content in File Explorer
- Content may be lost on app uninstall
- Inconsistent with industry standards (Premiere, DaVinci store user content in Documents)

The fix: change the save path to `Documents\QCut\Projects\{id}\media\generated\videos\` and add a one-time migration to copy existing files.

## Key Finding

Only **one file** has the wrong path: `electron/ai-video-save-handler.ts` in two spots (lines 97-102 and 310-315). Everything else already uses Documents.

No changes needed to: preload.ts, electron.d.ts, project-folder-sync.ts, project-folder-handler.ts, media-integration.ts.

---

## Subtask 1: Extract `getAIVideoDir` helper and update save paths (15 min)

**Priority:** High
**File:** `electron/ai-video-save-handler.ts` (MODIFY)

Add a helper function using the Documents-based path:
```typescript
function getAIVideoDir(projectId: string): string {
  const documentsPath = app.getPath("documents");
  return path.join(documentsPath, "QCut", "Projects",
    sanitizeFilename(projectId), "media", "generated", "videos");
}
```

Replace the two inline `app.getPath("userData")` path constructions:
- **Line 97-102** (`saveAIVideoToDisk` function) → `getAIVideoDir(projectId)`
- **Line 310-315** (`ai-video:get-project-dir` IPC) → `getAIVideoDir(projectId)`

Also add a legacy helper for migration:
```typescript
function getLegacyAIVideoDir(projectId: string): string {
  return path.join(app.getPath("userData"), "projects",
    sanitizeFilename(projectId), "ai-videos");
}
```

**Why this works:** `project-folder-handler.ts` already includes `media/generated/videos` in REQUIRED_FOLDERS (line 112-113), so `project-folder:ensure-structure` creates it automatically. The auto-sync feature already detects files under `media/generated/` and assigns the AI_GENERATED folder.

---

## Subtask 2: Add one-time migration function (30 min)

**Priority:** High
**File:** `electron/ai-video-save-handler.ts` (MODIFY)

Export `migrateAIVideosToDocuments(): Promise<MigrationResult>` that:
1. Checks if `AppData\Roaming\qcut\projects\` exists (early return if not)
2. Enumerates project directories inside it
3. For each project with an `ai-videos\` subfolder, copies files to `Documents\QCut\Projects\{id}\media\generated\videos\`
4. Skips files that already exist at the destination (idempotent)
5. Does NOT delete old files (existing `localPath` refs in IndexedDB still work)
6. Returns `{ copied, skipped, projectsProcessed, errors }`

**Migration strategy: copy, don't move.** Old files stay so existing `localPath` references in media items continue to resolve. New saves go to Documents. Over time the AppData copies become irrelevant.

---

## Subtask 3: Register migration at app startup (10 min)

**Priority:** High
**File:** `electron/main.ts` (MODIFY)

Update the existing import at line 101:
```typescript
const { registerAIVideoHandlers, migrateAIVideosToDocuments } = require("./ai-video-save-handler.js");
```

After `registerAIVideoHandlers()` (line 519), add async non-blocking migration call:
```typescript
migrateAIVideosToDocuments().then((result) => {
  if (result.copied > 0) {
    console.log(`[AI Video Migration] Copied ${result.copied} files, skipped ${result.skipped}`);
  }
}).catch((err) => {
  console.error("[AI Video Migration] Failed:", err.message);
});
```

Non-blocking: does not delay app startup.

---

## Subtask 4: Unit tests (30 min)

**Priority:** Medium
**File:** `apps/web/src/lib/__tests__/ai-video-path.test.ts` (NEW)

Test the pure helper functions (path construction and migration logic are tested via their observable behavior). Since the migration uses Node.js `fs` directly and vitest runs in jsdom, tests for the migration function itself go alongside the electron tests.

**File:** `electron/__tests__/ai-video-migration.test.ts` (NEW)

Test cases:
- `getAIVideoDir` returns Documents-based path
- `getLegacyAIVideoDir` returns AppData-based path
- Path sanitization prevents traversal
- Migration returns `{copied: 0}` when no legacy directory exists
- Migration skips files that already exist at destination
- Migration continues on individual file copy errors

---

## Subtask 5: Task documentation (10 min)

**Priority:** Medium
**File:** `docs/task/ai-video-storage-migration.md` (this file)

---

## Summary

| # | Subtask | Time | Key Files |
|---|---------|------|-----------|
| 1 | Update save paths | 15m | `electron/ai-video-save-handler.ts` |
| 2 | Migration function | 30m | `electron/ai-video-save-handler.ts` |
| 3 | Register at startup | 10m | `electron/main.ts` |
| 4 | Unit tests | 30m | `electron/__tests__/ai-video-migration.test.ts` |
| 5 | Task documentation | 10m | `docs/task/ai-video-storage-migration.md` |

**Total: ~1.5 hours**

## Dependencies

- `electron/project-folder-handler.ts` — already defines `media/generated/videos` in REQUIRED_FOLDERS
- `apps/web/src/lib/project-folder-sync.ts` — already detects `media/generated/` for AI_GENERATED folder assignment
- `electron/media-import-handler.ts` — reference pattern for Documents-based path construction

## Verification

1. `bun run build` — no type errors
2. `npx vitest run --config apps/web/vitest.config.ts` — tests pass
3. Manual test:
   - Place a test `.mp4` in `AppData\Roaming\qcut\projects\{id}\ai-videos\`
   - Start `bun run electron:dev`
   - Check console for migration log message
   - Verify file was copied to `Documents\QCut\Projects\{id}\media\generated\videos\`
   - Generate a new AI video — confirm it saves to Documents, not AppData
   - Verify auto-sync picks up the file in Media tab

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Disk space doubles temporarily (old + new copies) | Document in release notes; users can manually delete AppData directory |
| Existing `localPath` refs point to old AppData | Old files remain — refs still work. New saves go to Documents. |
| Auto-sync creates duplicate entries | `findUntrackedFiles()` deduplicates by name+size, catching exact copies |
| Migration fails for some files | Errors logged, not thrown. App starts normally. New videos still go to correct location. |
