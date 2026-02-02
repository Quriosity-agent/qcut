# PR #105 Cross-Machine Merge Conflicts Guide

**PR**: [#105 - feat: Add Claude Code API integration layer](https://github.com/donghaozhang/qcut/pull/105)
**Branch**: `fix/build-dependencies`
**Issue**: Branch compiled on different machine, conflicts with master

## Conflicting Files

| File | Description |
|------|-------------|
| `qcut/apps/web/src/types/electron.d.ts` | TypeScript interface definitions for Electron IPC |
| `qcut/electron/main.ts` | Electron main process with IPC handler setup |
| `qcut/electron/preload.ts` | Preload script exposing APIs to renderer |

## Conflict Pattern

Both branches add new Electron APIs that need to coexist:

| Branch | API Added |
|--------|-----------|
| `fix/build-dependencies` | `claude` - Claude Code integration (media, timeline, project, export, diagnostics) |
| `origin/master` | `remotionFolder` - Remotion folder import (select, scan, bundle, import) |

## Resolution: Keep Both APIs

### 1. `electron.d.ts` - Add both interfaces

```typescript
// After projectFolder interface, add BOTH:

/**
 * Claude Code Integration API
 */
claude?: {
  media: { list, info, import, delete, rename };
  timeline: { export, import, addElement, updateElement, removeElement, ... };
  project: { getSettings, updateSettings, getStats, ... };
  export: { getPresets, recommend };
  diagnostics: { analyze };
};

/**
 * Remotion Folder operations
 */
remotionFolder?: {
  select: () => Promise<RemotionFolderSelectResult>;
  scan: (folderPath: string) => Promise<RemotionFolderScanResult>;
  bundle: (folderPath: string, compositionIds?: string[]) => Promise<RemotionFolderBundleResult>;
  import: (folderPath: string) => Promise<RemotionFolderImportResult>;
  checkBundler: () => Promise<{ available: boolean }>;
  validate: (folderPath: string) => Promise<{ isValid: boolean; error?: string }>;
};
```

### 2. `main.ts` - Add both imports and setup calls

**Imports section (around line 80):**
```typescript
const { setupProjectFolderIPC } = require("./project-folder-handler.js");
const { setupAllClaudeIPC } = require("./claude/index.js");        // FROM fix/build-dependencies
const { setupRemotionFolderIPC } = require("./remotion-folder-handler.js");  // FROM master
```

**Setup section (around line 385):**
```typescript
setupProjectFolderIPC();
setupAllClaudeIPC();           // FROM fix/build-dependencies
setupRemotionFolderIPC();      // FROM master
```

### 3. `preload.ts` - Add both interface definitions and implementations

**Interface section (ElectronAPI interface):**
- Keep `claude?:` interface from `fix/build-dependencies`
- Keep `remotionFolder?:` interface from `master`

**Implementation section (electronAPI object):**
- Keep `claude:` implementation from `fix/build-dependencies`
- Keep `remotionFolder:` implementation from `master`

## Quick Resolution Commands

```bash
# 1. Fetch and start merge
git fetch origin
git merge origin/master

# 2. For each conflicted file, edit to keep BOTH APIs
# Look for <<<<<<< HEAD ... ======= ... >>>>>>> markers
# Keep content from BOTH sides

# 3. Stage and commit
git add apps/web/src/types/electron.d.ts electron/main.ts electron/preload.ts
git commit -m "fix: resolve merge conflicts - keep both claude and remotionFolder APIs"

# 4. Push
git push
```

## Verification After Resolution

```bash
# Type check
cd qcut/apps/web && bun x tsc --noEmit

# Electron TypeScript check
cd qcut && bun x tsc -p electron/tsconfig.json --noEmit

# Lint
bun lint:clean

# Test Electron dev
bun run electron:dev
```

## Cross-Machine Compatibility Notes

1. **Line endings**: Git handles CRLF/LF automatically via `.gitattributes`
2. **Dependencies**: Run `bun install` after merge to sync lock file
3. **Electron compilation**: Run `bun x tsc -p electron/tsconfig.json` to recompile

## Files That Must Stay In Sync

```
electron/main.ts          ←→  Handler imports + setup calls
electron/preload.ts       ←→  Interface + implementation
apps/web/src/types/electron.d.ts  ←→  TypeScript definitions
```

All three files must have matching:
- Method names
- Parameter types
- Return types
