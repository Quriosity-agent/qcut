# Auto-Sync Skills to Project Folder

> Make qcut-toolkit skills automatically available in every QCut project so Claude Code can discover them

**Created:** 2026-02-13
**Priority:** Medium — Skills exist but are invisible to Claude Code running in project directories
**Estimated Effort:** ~30 minutes (3 subtasks)

---

## Problem

Skills live in `.claude/skills/` at the repo level, but QCut projects live in `Documents/QCut/Projects/{project-name}/`. When Claude Code runs in the PTY terminal with `cwd` set to a project folder, it cannot see the repo's skills — they're in a completely different directory tree.

**Current state:**
```
~/.claude/skills/          ← personal skills (Claude Code sees these)
repo/.claude/skills/       ← repo skills (only visible when cwd = repo)
Documents/QCut/Projects/   ← project folders (PTY cwd, no skills here)
```

**Desired state:**
```
Documents/QCut/Projects/{project}/
└── .claude/
    └── skills/
        ├── qcut-toolkit/          ← auto-synced
        ├── organize-project/      ← auto-synced
        ├── ffmpeg-skill/          ← auto-synced
        ├── ai-content-pipeline/   ← auto-synced
        └── qcut-api/              ← auto-synced
```

---

## Design Decisions

### When to sync

| Trigger | Pros | Cons |
|---------|------|------|
| On project creation | Clean initial state | Misses updates |
| **On project open** | Always fresh | Slight delay |
| On app startup (all projects) | Everything stays current | Unnecessary I/O |

**Decision:** Sync on project open — runs once when `loadProject()` completes. Minimal overhead, always current.

### Copy vs. symlink

| Approach | Pros | Cons |
|----------|------|------|
| Copy | Works everywhere, self-contained | Gets stale, wastes disk |
| Symlink | Always current, no duplication | Breaks on Windows without admin, breaks if app moves |
| **Copy with version check** | Works everywhere, stays current | Slightly more complex |

**Decision:** Copy with a content hash. A `.skills-hash` file in the project tracks what version was synced. Only re-copy when skills change.

### Where to sync

Sync to `{project}/.claude/skills/` — this is where Claude Code auto-discovers skills. The project-folder panel in QCut UI can also read from this location.

### What to sync

The qcut-toolkit super skill and its 4 sub-skills:

```
qcut-toolkit/SKILL.md
organize-project/SKILL.md, REFERENCE.md
ffmpeg-skill/Skill.md, REFERENCE.md, CONCEPTS.md, ADVANCED.md
ai-content-pipeline/Skill.md, REFERENCE.md, EXAMPLES.md
qcut-api/SKILL.md, REFERENCE.md
```

Total: ~5 folders, ~12 files, ~80KB.

### Source location

| Environment | Skills source path |
|-------------|-------------------|
| Dev (`electron:dev`) | `{repo}/.claude/skills/` |
| Production (packaged) | `{app.getPath('resources')}/skills/` via `extraResources` |

---

## Architecture

```
Project Open
    │
    ▼
loadProject(projectId)
    │
    ▼
syncSkillsToProject(projectId)   ← new Electron IPC handler
    │
    ├── Resolve skills source (repo or bundled resources)
    ├── Hash all skill file contents → newHash
    ├── Read {project}/.skills-hash → existingHash
    ├── If newHash === existingHash → skip (already synced)
    ├── If different → copy skill folders to {project}/.claude/skills/
    └── Write newHash to {project}/.skills-hash
    │
    ▼
PTY terminal spawns with cwd = project folder
    │
    ▼
Claude Code finds .claude/skills/ automatically
```

---

## Subtasks

### Subtask 1: Create skills sync IPC handler

**Files:**
- `electron/claude/claude-skills-sync-handler.ts` (new)
- `electron/claude/index.ts` (register handler)

**Changes:**
1. Create `syncSkillsToProject(projectId)` function:
   - Resolve source path: `app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(__dirname, '../../.claude/skills')`
   - Define skill folders to sync: `['qcut-toolkit', 'organize-project', 'ffmpeg-skill', 'ai-content-pipeline', 'qcut-api']`
   - Hash all source skill files (SHA-256 of concatenated contents)
   - Read `{projectPath}/.skills-hash`, compare with new hash
   - If different: create `{projectPath}/.claude/skills/` dirs, copy files
   - Write new hash to `{projectPath}/.skills-hash`

2. Register IPC handler: `ipcMain.handle('claude:skills:sync', handler)`

3. Add to `setupAllClaudeIPC()` in `index.ts`

**Hashing approach:**
```typescript
import { createHash } from "node:crypto";

function hashSkillFiles(sourceDir: string, folders: string[]): string {
  const hash = createHash("sha256");
  for (const folder of folders) {
    const dir = path.join(sourceDir, folder);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (file.endsWith(".md")) {
        hash.update(fs.readFileSync(path.join(dir, file)));
      }
    }
  }
  return hash.digest("hex");
}
```

**Test:**
- Sync to empty project → skills appear
- Sync again unchanged → no file I/O (hash matches)
- Modify a skill file → re-syncs

---

### Subtask 2: Call sync on project open

**Files:**
- `electron/preload-integrations.ts` (expose IPC)
- `apps/web/src/types/electron.d.ts` (type definition)
- `apps/web/src/stores/project-store.ts` (call after loadProject)

**Changes:**
1. Add to preload: `window.electronAPI.claude.skills.sync(projectId)`
2. Add type: `skills: { sync(projectId: string): Promise<void> }`
3. In `loadProject()`, after successful load:
   ```typescript
   // Sync skills to project folder (non-blocking, fire-and-forget)
   window.electronAPI?.claude?.skills?.sync(projectId).catch((err) => {
     console.warn("[ProjectStore] Skills sync failed:", err);
   });
   ```

**Important:** Fire-and-forget — don't block project loading on skill sync. If sync fails, log a warning but don't break the app.

**Test:**
- Open project → skills appear in project `.claude/skills/`
- Open project without Electron API → no error (graceful skip)

---

### Subtask 3: Bundle skills for production builds

**Files:**
- `package.json` (extraResources config)
- `electron-builder.yml` or equivalent build config

**Changes:**
1. Add skills to `extraResources` in the build config:
   ```json
   "extraResources": [
     {
       "from": ".claude/skills",
       "to": "skills",
       "filter": ["**/*.md"]
     }
   ]
   ```

2. This copies all `.md` files from `.claude/skills/` into `resources/skills/` in the packaged app.

3. The sync handler resolves source based on `app.isPackaged`:
   ```typescript
   const skillsSource = app.isPackaged
     ? path.join(process.resourcesPath, "skills")
     : path.join(app.getAppPath(), ".claude", "skills");
   ```

**Test:**
- Build with `bun run build` → verify `resources/skills/` contains skill files
- Run packaged app → open project → skills synced from bundled source

---

## Files Summary

| File | Change |
|------|--------|
| `electron/claude/claude-skills-sync-handler.ts` | New — sync logic, hashing, copy |
| `electron/claude/index.ts` | Register sync handler |
| `electron/preload-integrations.ts` | Expose `claude.skills.sync()` |
| `apps/web/src/types/electron.d.ts` | Add type for skills sync |
| `apps/web/src/stores/project-store.ts` | Call sync after loadProject |
| `package.json` | Add skills to extraResources |

---

## Unit Tests

| Test Case | File |
|-----------|------|
| Skills copied to empty project | `electron/__tests__/claude-skills-sync.test.ts` |
| Hash match skips re-copy | `electron/__tests__/claude-skills-sync.test.ts` |
| Hash mismatch triggers re-copy | `electron/__tests__/claude-skills-sync.test.ts` |
| Missing source folder handled gracefully | `electron/__tests__/claude-skills-sync.test.ts` |
| Production path resolution works | `electron/__tests__/claude-skills-sync.test.ts` |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Sync slows project open | Fire-and-forget, hash check skips when unchanged |
| Disk space from copies | ~80KB per project, negligible |
| User edits synced skills | Overwritten on next sync — document this behavior |
| Skills source missing in packaged app | Graceful fallback, log warning, don't crash |
| Race condition on rapid project switching | Sync is idempotent, last write wins safely |

---

## Out of Scope

- Syncing user-created custom skills (only qcut-toolkit sub-skills)
- Two-way sync (project → repo)
- UI for managing which skills are synced
- Per-project skill customization
