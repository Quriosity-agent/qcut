# Fix: CLI `getPath` Error & Stale Pipeline Paths

**Priority:** High — blocks all `editor:media:import` operations via CLI and HTTP API
**Estimated time:** ~30 minutes (split into subtasks below)

---

## Problem Summary

Two related issues prevent the native CLI from importing media:

1. **`app.getPath()` undefined in utility process** — `POST /api/claude/media/:projectId/import` returns `Cannot read properties of undefined (reading 'getPath')` because the utility process HTTP server calls `helpers.ts` which depends on Electron's `app` module, unavailable in that context.

2. **Stale pipeline script path** — `package.json` `"pipeline"` script points to `electron/native-pipeline/cli.ts` (old location), but the CLI was moved to `electron/native-pipeline/cli/cli.ts`. Running `bun run pipeline` fails with `Module not found`.

---

## Subtask 1: Fix `app.getPath()` in Utility Process Context

**Time estimate:** ~15 minutes

### Root Cause

`electron/claude/utils/helpers.ts:21` calls `app.getPath("documents")` directly. When the HTTP server runs in the **utility process** (`electron/utility/utility-http-server.ts`), the Electron `app` module is `undefined` or lacks `getPath()`.

### Call Chain

```text
CLI: bun run pipeline editor:media:import
  → editor-api-client.ts:187 — HTTP fetch to localhost:8765
    → utility-http-server.ts — receives request in utility process
      → claude-http-shared-routes.ts:122 — calls importMediaFile()
        → claude-media-handler.ts:134 — calls getMediaPath()
          → helpers.ts:33 — calls getProjectPath()
            → helpers.ts:21 — app.getPath("documents") ❌ CRASH
```

### Relevant Files

| File | Line | Role |
|------|------|------|
| `electron/claude/utils/helpers.ts` | 6, 21 | `app.getPath("documents")` — crash site |
| `electron/claude/handlers/claude-media-handler.ts` | 134 | Calls `getMediaPath()` |
| `electron/claude/http/claude-http-shared-routes.ts` | 119–145 | HTTP route handler for media import |
| `electron/claude/utils/http-router.ts` | 133–155 | Generic error handler masks stack traces |
| `electron/utility/utility-http-server.ts` | 76+ | Utility process HTTP server |
| `electron/utility/utility-process.ts` | 102–106 | Spawns utility process |

### Fix Options

**Option A (Recommended): Fallback path resolution in `helpers.ts`**

Make `getProjectPath()` resilient to missing `app`:

```typescript
// electron/claude/utils/helpers.ts
import { app } from "electron";
import * as os from "os";
import * as path from "path";

function getDocumentsPath(): string {
  try {
    return app.getPath("documents");
  } catch {
    // Fallback for utility process / CLI context
    return path.join(os.homedir(), "Documents");
  }
}

export function getProjectPath(projectId: string): string {
  const documentsPath = getDocumentsPath();
  return path.join(documentsPath, "QCut", "Projects", sanitizeProjectId(projectId));
}
```

**Option B: Pass `documentsPath` from main process to utility process**

In `utility-process.ts`, send the resolved `app.getPath("documents")` as init data. Store it in a module-level variable in `helpers.ts`. More complex but architecturally cleaner.

### Tests

- `bun run pipeline editor:media:import --project-id <id> --source /path/to/file.jpg` should succeed
- `curl -X POST http://127.0.0.1:8765/api/claude/media/<id>/import -d '{"source":"/path/to/file.jpg"}'` should succeed
- `bun run pipeline editor:media:batch-import --project-id <id> --items '[{"path":"/path/to/file.jpg"}]'` should succeed
- Existing main-process paths (IPC handlers) should still work unchanged

---

## Subtask 2: Fix Stale Pipeline Script Path in `package.json`

**Time estimate:** ~5 minutes

### Issue

The CLI was moved from `electron/native-pipeline/cli.ts` to `electron/native-pipeline/cli/cli.ts` but `package.json` was not updated.

### Relevant Files

| File | Line | Current (Stale) | Correct |
|------|------|-----------------|---------|
| `package.json` | 90 | `"pipeline": "bun run electron/native-pipeline/cli.ts"` | `"pipeline": "bun run electron/native-pipeline/cli/cli.ts"` |
| `package.json` | 12 | `"qcut-pipeline": "dist/electron/native-pipeline/cli.js"` | `"qcut-pipeline": "dist/electron/native-pipeline/cli/cli.js"` |

### Fix

```jsonc
// package.json line 12
"qcut-pipeline": "dist/electron/native-pipeline/cli/cli.js"

// package.json line 90
"pipeline": "bun run electron/native-pipeline/cli/cli.ts"
```

### Tests

- `bun run pipeline --help` should print CLI help (not "Module not found")
- `bun run pipeline check-keys` should list API key status
- `bun run pipeline list-models` should list available models

---

## Subtask 3: Fix Stale Paths in SKILL.md and Docs

**Time estimate:** ~10 minutes

### Relevant Files

| File | Line | Issue |
|------|------|-------|
| `.claude/skills/native-cli/SKILL.md` | 57 | `bun run electron/native-pipeline/cli.ts` → should be `cli/cli.ts` |
| `docs/completed/infrastructure/native-cli-usage-guide.md` | 30 | Old CLI path reference |
| `docs/completed/infrastructure/cli-video-agent-audit.md` | 64, 70–72 | Old CLI path references |
| `docs/completed/editor-cli/editor-cli-user-guide.md` | 15 | Old CLI path reference |

### Fix

Search-and-replace `electron/native-pipeline/cli.ts` → `electron/native-pipeline/cli/cli.ts` in all affected files.

### Secondary: Improve Error Handling in HTTP Router

In `electron/claude/utils/http-router.ts` (line 148), the generic catch block only returns `error.message`. Consider also logging the full stack trace to Claude's log:

```typescript
} else {
  const message = error instanceof Error ? error.message : "Internal server error";
  if (error instanceof Error) {
    claudeLog.error("HTTP", `Unhandled: ${error.message}\n${error.stack}`);
  }
  sendJson(res, 500, { success: false, error: message, timestamp: Date.now() });
}
```

---

## Verification Checklist

- [ ] `bun run pipeline --help` works
- [ ] `bun run pipeline editor:health` returns `ok`
- [ ] `bun run pipeline editor:media:import --project-id <id> --source <file>` succeeds
- [ ] `curl POST /api/claude/media/<id>/import` succeeds
- [ ] `bun run pipeline editor:media:batch-import` succeeds
- [ ] IPC-based import (from within Electron renderer) still works
- [ ] `bun run build` succeeds
- [ ] `bun run test` passes
