# QAgent @composio/ao-core Dependency Fix — Implementation Plan

## Status: Ready for implementation

## Problem Summary

`@composio/ao-core` (at `packages/qagent/packages/core/`) cannot be resolved by Bun due to `node-linker=isolated` in `.npmrc`. This breaks 10 of 12 qagent CLI commands. The root workspace already includes `packages/qagent/packages/*` but Bun's isolated linker does not create symlinks for these nested packages.

---

## Option Evaluation

### Option 1: Relative file path imports
- **Approach**: Replace `from "@composio/ao-core"` with `from "../../core/src/index.js"` in all CLI source files.
- **Pros**: Zero config changes, works regardless of linker strategy.
- **Cons**: Fragile paths that break on directory restructuring. Must change 15+ import sites across CLI, plus all 18 plugins. Does not fix TypeScript declaration resolution. Upstream qagent updates will constantly conflict.
- **Verdict**: **Reject** — too invasive, too fragile, upstream-hostile.

### Option 2: Remove node-linker=isolated for qagent
- **Approach**: Remove `node-linker=isolated` from `.npmrc` or add a qagent-specific override.
- **Pros**: Would allow standard workspace symlinks.
- **Cons**: `.npmrc` is project-wide — removing `node-linker=isolated` affects the entire monorepo. Bun does not support per-directory `.npmrc` overrides. Changing the linker strategy may break other packages or cause `node_modules` bloat. Risky blast radius.
- **Verdict**: **Reject** — project-wide side effects, no scoped override available in Bun.

### Option 3: Add bunfig.toml overrides *(Recommended)*
- **Approach**: Create `packages/qagent/bunfig.toml` with `[install.scopes]` mapping to force `@composio/ao-core` resolution to the local path.
- **Pros**: Scoped to qagent only. No source code changes. No `.npmrc` changes. Bun supports `bunfig.toml` in subdirectories. Works with `node-linker=isolated`.
- **Cons**: Requires testing to confirm Bun respects nested `bunfig.toml` for workspace resolution. If Bun ignores the scope override, falls back to Option 4.
- **Verdict**: **Try first** — lowest risk, smallest change, no source modifications.

### Option 4: Rename to @qcut/qagent-core and re-register
- **Approach**: Rename `@composio/ao-core` → `@qcut/qagent-core`, update all imports, register as a proper top-level workspace package.
- **Pros**: Clean break from upstream naming. Works with any linker. Proper workspace citizen.
- **Cons**: Touches every file that imports `@composio/ao-core` (15+ CLI files, 18 plugins, web package, integration tests). Makes merging upstream qagent updates painful. Large diff.
- **Verdict**: **Last resort** — correct long-term but high cost and upstream divergence.

---

## Recommended Strategy: Option 3 → Option 4 fallback

**Primary**: Try `bunfig.toml` scoped overrides (Option 3).
**Fallback**: If Bun doesn't support scoped path overrides in `bunfig.toml`, use TypeScript path aliases in `tsconfig.base.json` + a `postinstall` symlink script (Option 3b, detailed below).

---

## Step-by-Step Implementation

### Phase 1: bunfig.toml approach (Option 3)

#### Step 1: Create `packages/qagent/bunfig.toml`

```toml
[install]
# Override workspace resolution for @composio scoped packages
# so Bun resolves them from the local packages/ directory
# even under node-linker=isolated

[install.scopes]
"@composio" = { path = "packages" }
```

**File**: `packages/qagent/bunfig.toml` (new file)

#### Step 2: Run bun install and test resolution

```bash
cd packages/qagent
bun install
bun run build
```

If `@composio/ao-core` resolves → Phase 1 is done. Proceed to verification.

If it does NOT resolve → proceed to Phase 2.

### Phase 2: TypeScript paths + postinstall symlink (Option 3b fallback)

If `bunfig.toml` scoped overrides don't work for workspace resolution, use this approach instead.

#### Step 2a: Add path aliases to `packages/qagent/tsconfig.base.json`

**File**: `packages/qagent/tsconfig.base.json`

Add `paths` and `baseUrl` to `compilerOptions`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@composio/ao-core": ["packages/core/src/index.ts"],
      "@composio/ao-core/*": ["packages/core/src/*"]
    },
    // ... existing options
  }
}
```

This fixes TypeScript compilation. Runtime resolution still needs the symlink.

#### Step 2b: Add symlink postinstall script

**File**: `packages/qagent/scripts/link-core.js` (new file)

```js
#!/usr/bin/env node
/**
 * Creates a node_modules symlink for @composio/ao-core → packages/core
 * to work around Bun's node-linker=isolated not resolving nested workspace packages.
 */
import { mkdirSync, symlinkSync, existsSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = join(root, "packages", "core");
const nmDir = join(root, "node_modules", "@composio");
const link = join(nmDir, "ao-core");

if (existsSync(link)) {
  const stat = lstatSync(link);
  if (stat.isSymbolicLink()) process.exit(0); // already linked
}

mkdirSync(nmDir, { recursive: true });
symlinkSync(target, link, "junction"); // junction works on Windows without admin
console.log("Linked @composio/ao-core → packages/core");
```

#### Step 2c: Add postinstall script to `packages/qagent/package.json`

**File**: `packages/qagent/package.json`

Add to `scripts`:
```json
"postinstall": "node scripts/link-core.js"
```

#### Step 2d: Update root qagent:init script

**File**: `package.json` (root)

Change `qagent:init` to ensure the symlink runs:
```json
"qagent:init": "cd packages/qagent && bun install && node scripts/link-core.js && bun run --filter '!@composio/ao-web' build"
```

### Phase 3: Revert the dynamic import workaround

Once `@composio/ao-core` resolves correctly, revert the graceful degradation in the CLI entry point. This is optional — the dynamic import pattern is a good safety net — but the warning message should be silenced.

**File**: `packages/qagent/packages/cli/src/index.ts`

No changes strictly needed. The dynamic import pattern will simply succeed now instead of catching errors. Keep it as-is for resilience.

---

## Files Changed (Summary)

| File | Action | Phase |
|------|--------|-------|
| `packages/qagent/bunfig.toml` | Create | 1 |
| `packages/qagent/tsconfig.base.json` | Add paths (if Phase 2) | 2 |
| `packages/qagent/scripts/link-core.js` | Create (if Phase 2) | 2 |
| `packages/qagent/package.json` | Add postinstall (if Phase 2) | 2 |
| `package.json` (root) | Update qagent:init (if Phase 2) | 2 |

**No CLI source files are modified.** The `@composio/ao-core` import specifier stays the same everywhere.

---

## Verification

### Test 1: Module resolution
```bash
cd packages/qagent
bun run build          # TypeScript compilation succeeds
```

### Test 2: CLI starts with all commands
```bash
bunx qagent --help     # Should list all 12 commands, no warning
```

### Test 3: Core commands work
```bash
bunx qagent init       # Already works
bunx qagent status     # Should work now (was broken)
bunx qagent team       # Should work now (was broken)
```

### Test 4: Root install still works
```bash
cd /path/to/qcut
rm -rf node_modules
bun install
bun run qagent:build   # Full build succeeds
```

### Test 5: Cross-platform (if Phase 2 symlink)
- Windows: `junction` symlinks work without admin privileges
- macOS/Linux: Standard symlinks work

---

## Risk Assessment

### Low Risk
- **bunfig.toml (Phase 1)**: Only affects `packages/qagent/`. If Bun ignores it, nothing changes — current behavior is preserved. No existing code is modified.
- **Dynamic import pattern stays**: Even if resolution fails, the CLI degrades gracefully (current behavior).

### Medium Risk
- **Symlink script (Phase 2)**: Creates `node_modules/@composio/ao-core` symlink inside `packages/qagent/`. This could conflict if Bun's own linker later creates the same path. Mitigated by checking if the link already exists.
- **tsconfig paths (Phase 2)**: Adding `baseUrl` and `paths` could affect import resolution for other packages in the qagent monorepo. Mitigated by scoping paths to only `@composio/ao-core`.

### What Could Break
1. **Other @composio packages**: If `bunfig.toml` scoped override applies to ALL `@composio/*` packages, it could misroute plugin resolution. Test each plugin import.
2. **bun install --frozen-lockfile**: The symlink script runs as postinstall, which is allowed in frozen-lockfile mode. But the `bunfig.toml` change could alter resolution and require lockfile updates.
3. **Upstream qagent merges**: None of these changes touch upstream source files. The `bunfig.toml` and symlink script are qcut-specific additions that won't conflict with upstream changes.
4. **CI environments**: The symlink script must handle both Unix and Windows. Using `junction` type on Windows and default on Unix handles this.

### Rollback
If anything breaks, delete `packages/qagent/bunfig.toml` (Phase 1) or `packages/qagent/scripts/link-core.js` + revert `package.json` changes (Phase 2). The dynamic import fallback in the CLI ensures commands degrade gracefully.
