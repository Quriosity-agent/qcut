# Subtask 4: Split `electron/preload.ts` (1630 → ~90 + ~300 + ~1240)

**Parent Plan:** [split-top5-large-files-plan.md](./split-top5-large-files-plan.md)
**Estimated Effort:** 30-40 minutes
**Risk Level:** Medium-High — Electron bridge, runtime breakage is silent

---

## Goal

Extract `ElectronAPI` types into `preload-types.ts` and integration-heavy API groups into `preload-integrations.ts`. The `contextBridge.exposeInMainWorld` call and core API groups stay in `preload.ts`.

---

## Files Involved

| File | Action |
|------|--------|
| `electron/preload.ts` | Edit — keep core groups + composition |
| `electron/preload-types.ts` | **Create** — all type definitions |
| `electron/preload-integrations.ts` | **Create** — integration API group builders |
| `apps/web/src/types/electron.d.ts` | Verify — may need import update |

---

## What Moves to `preload-types.ts` (~300 lines)

| Section | Lines (current) | Description |
|---------|-----------------|-------------|
| Supporting types | 21-298 | All type/interface definitions used by ElectronAPI |
| `ElectronAPI` interface | 301-827 | The full API type definition |
| `declare global` block | 1625-1629 | `Window.electronAPI` declaration |
| Re-exports | 1594-1622 | Type exports at bottom of file |

### Key types to move:
- `ThemeSource`, `FileInfo`, `SaveAIVideoResult`
- `ExportSession`, `FalUploadResult`
- `CancelResult`, `ApiKeyConfig`
- `GitHubStarsResponse`, `Skill`
- `MediaImportResult`, `RemotionFolder*` types
- `Changelog`, update event types
- `ElectronAPI` (the master interface)

---

## What Moves to `preload-integrations.ts` (~540 lines)

Integration-heavy API group **builder functions** that return objects to be spread into the main electronAPI object:

| Group | Lines (current) | Method Count |
|-------|-----------------|--------------|
| `ptyTerminal` | 512-541 | 8 methods |
| `skills` | 544-563 | 7 methods |
| `aiPipeline` | 566-625 | 8 methods |
| `mediaImport` | 628-640 | 7 methods |
| `projectFolder` | 643-680 | 4 methods |
| `claude` | 683-756 | 5 sub-groups (~24 methods) |
| `remotionFolder` | 759-777 | 6 methods |
| `updates` | 780-823 | 7 methods |

```typescript
// preload-integrations.ts
import { ipcRenderer } from 'electron';
import type { ElectronAPI } from './preload-types';

export function createPtyTerminalAPI(): ElectronAPI['ptyTerminal'] { ... }
export function createSkillsAPI(): ElectronAPI['skills'] { ... }
export function createAIPipelineAPI(): ElectronAPI['aiPipeline'] { ... }
export function createMediaImportAPI(): ElectronAPI['mediaImport'] { ... }
export function createProjectFolderAPI(): ElectronAPI['projectFolder'] { ... }
export function createClaudeAPI(): ElectronAPI['claude'] { ... }
export function createRemotionFolderAPI(): ElectronAPI['remotionFolder'] { ... }
export function createUpdatesAPI(): ElectronAPI['updates'] { ... }
```

---

## What Stays in `preload.ts` (~790 lines)

| Section | Description |
|---------|-------------|
| Imports | electron, preload-types, preload-integrations |
| Core API groups | `platform`, `file`, `storage`, `theme`, `sounds`, `audio`, `video`, `transcribe`, `ffmpeg`, `apiKeys`, `shell`, `github`, `fal`, `geminiChat` |
| Composition | Assemble `electronAPI` object with core + `...createPtyTerminalAPI()`, etc. |
| `contextBridge.exposeInMainWorld` | Final exposure call |

---

## Implementation Steps

### Step 1: Create `preload-types.ts`

1. Move all type/interface definitions (lines 21-298, 301-827).
2. Move `declare global { interface Window { electronAPI: ElectronAPI } }`.
3. Move type re-exports (lines 1594-1622).
4. Export `ElectronAPI` as named export.

### Step 2: Create `preload-integrations.ts`

1. Import `ipcRenderer` from electron.
2. Import types from `preload-types.ts`.
3. Create one builder function per integration group.
4. Each function returns the exact same object shape currently inline.

```typescript
export function createPtyTerminalAPI(): ElectronAPI['ptyTerminal'] {
  return {
    spawn: (options?) => ipcRenderer.invoke('pty:spawn', options),
    write: (sessionId, data) => ipcRenderer.invoke('pty:write', sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke('pty:resize', sessionId, cols, rows),
    kill: (sessionId) => ipcRenderer.invoke('pty:kill', sessionId),
    killAll: () => ipcRenderer.invoke('pty:kill-all'),
    onData: (callback) => { ipcRenderer.on('pty:data', (_, ...args) => callback(...args)); },
    onExit: (callback) => { ipcRenderer.on('pty:exit', (_, ...args) => callback(...args)); },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('pty:data');
      ipcRenderer.removeAllListeners('pty:exit');
    },
  };
}
```

### Step 3: Update `preload.ts`

1. Replace type imports with `import type { ElectronAPI } from './preload-types'`.
2. Import builders: `import { createPtyTerminalAPI, ... } from './preload-integrations'`.
3. Replace inline integration groups with builder calls.
4. Keep `contextBridge.exposeInMainWorld('electronAPI', electronAPI)`.

### Step 4: Verify `electron.d.ts` compatibility

Check that `apps/web/src/types/electron.d.ts` still resolves correctly. If it imports from `electron/preload.ts`, update to import from `electron/preload-types.ts`.

---

## Verification

```bash
# Type check
bun run check-types

# Existing electron tests
bun x vitest run electron/__tests__/release-notes-handler.test.ts

# Lint
bun lint:clean

# Critical: Smoke test full app — every API group must work
bun run electron:dev
# Test: terminal, skills panel, project folder, claude integration, updates
```

---

## Unit Tests to Add

Create `electron/__tests__/preload-integrations.test.ts`:

| Test Case | What It Validates |
|-----------|-------------------|
| `createPtyTerminalAPI returns all 8 methods` | API shape |
| `createSkillsAPI returns all 7 methods` | API shape |
| `createClaudeAPI returns all 5 sub-groups` | Nested API shape |
| `createUpdatesAPI returns all 7 methods` | API shape |
| `all builder functions are exported` | No missing exports |

> **Note:** These tests mock `ipcRenderer` and validate shape only. Runtime behavior tested via smoke test.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Circular A↔B import between types and runtime | Types in dedicated file; both runtime files import from types only |
| IPC channel strings change | Copy-paste exact strings; no string generation |
| `declare global` in wrong file | Keep in `preload-types.ts` where `ElectronAPI` is defined |
| Electron sandbox restrictions on imports | Preload runs in Node context; imports work normally |
| `contextBridge` only called once | Keep single `exposeInMainWorld` call in `preload.ts` |
| Silent runtime failures (no TS error, but undefined at runtime) | Smoke test every API group manually |
