# Auto-Sync Skills to Project Folder

> Make bundled QCut skills automatically available to Claude Code in each project, without breaking existing skill architecture

**Created:** 2026-02-13  
**Revised:** 2026-02-13  
**Priority:** Medium  
**Estimated Effort:** ~45 minutes (4 subtasks)

---

## Problem

Claude Code discovers project-local skills from:

```
{projectRoot}/.claude/skills/
```

But QCut currently stores project skills in:

```
{Documents}/QCut/Projects/{projectId}/skills/
```

So Claude Code running in PTY with `cwd={projectRoot}` cannot discover QCut-managed project skills automatically.

---

## Current Architecture Reality

| Area | Current behavior |
|------|------------------|
| Project skills store | `electron/skills-handler.ts` uses `{project}/skills` as canonical location |
| Bundled defaults | Build pipeline already syncs repo skills into `resources/default-skills` |
| Preload API | Skills APIs exist under `window.electronAPI.skills.*` |
| Claude bridge | Claude IPC API currently has no skills sync endpoint |

**Important constraint:** Do not replace `project/skills` with `project/.claude/skills`. Existing app flows (`skills:list`, import/delete, skill runner) depend on `project/skills`.

---

## Revised Goal

Keep `project/skills` as the canonical app-managed store, and add a managed mirror for Claude discovery:

```
{projectRoot}/
├── skills/                 ← canonical (QCut APIs/UI)
└── .claude/
    └── skills/             ← mirror for Claude Code autodiscovery
```

---

## Design Decisions

### 1) Where sync logic lives

Use `skills` IPC domain, not Claude IPC domain.

Reason:
- Skill syncing is primarily filesystem/project-skill behavior.
- Keeps ownership aligned with `electron/skills-handler.ts`.
- Avoids coupling core project skill logic to Claude-only modules.

### 2) When to sync

Sync after successful `loadProject()` in `apps/web/src/stores/project-store.ts`, fire-and-forget:
- Do not block editor load.
- Log warning on failure; never crash project open.

### 3) Copy strategy

Use copy + hash/manifest, not symlink:
- Works on Windows/macOS/Linux.
- Supports packaged app paths.
- Avoids symlink permission/path portability issues.

### 4) Sync source of truth

Reuse existing bundled pipeline:
- Dev/packaged runtime source: `resources/default-skills`
- Keep repo-to-bundle sync in `scripts/sync-skills.ts`
- Expand bundled skill list to include:
  - `qcut-toolkit`
  - `organize-project`
  - `ffmpeg-skill`
  - `ai-content-pipeline`
  - `qcut-api`

No new `package.json` `extraResources` entry is required if `resources/default-skills` remains the source.

---

## Architecture

```
Project Open
  ↓
loadProject(projectId) succeeds
  ↓
window.electronAPI.skills.syncForClaude(projectId)  (non-blocking)
  ↓
[Main process]
  1) Ensure canonical project skills contain bundled baseline (idempotent)
  2) Mirror canonical project skills -> project/.claude/skills (managed sync)
  3) Persist sync manifest/hash
  ↓
PTY terminal starts in project root
  ↓
Claude Code discovers project/.claude/skills automatically
```

---

## Subtasks

### Subtask 1: Expand bundled skill source list

**File:** `scripts/sync-skills.ts`

Update `BUNDLED_SKILLS` to:
- `qcut-toolkit`
- `organize-project`
- `ffmpeg-skill`
- `ai-content-pipeline`
- `qcut-api`

This keeps `resources/default-skills` aligned with required Claude-facing toolkit skills.

---

### Subtask 2: Add main-process sync handler in Skills domain

**Files:**
- `electron/skills-sync-handler.ts` (new)
- `electron/main.ts` (register setup)

Add IPC handler:
- `ipcMain.handle("skills:syncForClaude", async (_event, projectId) => ...)`

Behavior:
1. Resolve project root: `{Documents}/QCut/Projects/{projectId}`
2. Resolve canonical dir: `{projectRoot}/skills`
3. Resolve mirror dir: `{projectRoot}/.claude/skills`
4. Resolve bundled source:
   - packaged: `path.join(process.resourcesPath, "default-skills")`
   - dev: `path.join(app.getAppPath(), "resources", "default-skills")`
5. Ensure bundled baseline skills exist in canonical dir (copy only required folders)
6. Mirror canonical -> `.claude/skills`
7. Use manifest/hash to skip unchanged copies
8. Return summary `{ synced: boolean, copied: number, skipped: number }`

Safety requirements:
- Validate `projectId` path segment (no traversal).
- Recursive hashing includes relative file path + file content.
- Wrap filesystem ops in `try/catch`; surface controlled errors only.

---

### Subtask 3: Expose and consume sync API

**Files:**
- `electron/preload-integrations.ts`
- `electron/preload-types.ts`
- `apps/web/src/types/electron.d.ts`
- `apps/web/src/stores/project-store.ts`

API addition:
- `window.electronAPI.skills.syncForClaude(projectId: string): Promise<{ synced: boolean; copied: number; skipped: number }>`

Call site:
- After successful project load in `loadProject(id)`, fire-and-forget:

```ts
window.electronAPI?.skills?.syncForClaude?.(id).catch((error) => {
  console.warn("[ProjectStore] skills syncForClaude failed", error);
});
```

---

### Subtask 4: Add tests

**Electron tests:**
- `electron/__tests__/skills-sync-handler.test.ts`

Cases:
1. Empty project -> baseline skills copied to `skills` and mirrored to `.claude/skills`
2. Second sync unchanged -> no recopy (manifest/hash skip)
3. Bundled skill content change -> recopy only changed skill
4. Missing bundled source -> graceful no-op with warning
5. Path traversal in `projectId` rejected safely

**Web/store test:**
- Ensure `project-store` sync call is non-blocking and failure-safe.

---

## Files Summary

| File | Change |
|------|--------|
| `scripts/sync-skills.ts` | Expand bundled skill list |
| `electron/skills-sync-handler.ts` | New sync logic + IPC handler |
| `electron/main.ts` | Register sync handler setup |
| `electron/preload-integrations.ts` | Add `skills.syncForClaude` |
| `electron/preload-types.ts` | Add preload type for sync method |
| `apps/web/src/types/electron.d.ts` | Add renderer type for sync method |
| `apps/web/src/stores/project-store.ts` | Fire-and-forget sync call after project load |
| `electron/__tests__/skills-sync-handler.test.ts` | New sync behavior tests |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Project open slowdown | Fire-and-forget + hash-based skip |
| Divergence between `skills` and `.claude/skills` | Always mirror from canonical `skills` |
| Overwriting user-custom `.claude/skills` content | Only manage folders tracked in manifest |
| Missing bundled files in packaged build | Graceful warning + no crash |
| Rapid project switching | Idempotent sync; per-project manifest |

---

## Out of Scope

- Two-way sync from `.claude/skills` back to canonical `skills`
- Syncing arbitrary user global skills automatically into every project
- UI for selecting per-project sync profile
- Non-markdown assets beyond current skill package format
