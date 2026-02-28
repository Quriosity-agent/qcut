# QAgent CLI Dependency Fix Report

## Problem

The qagent CLI fails to start because `@composio/ao-core` (workspace package at `packages/qagent/packages/core/`) cannot be resolved.

**Root cause**: Bun with `node-linker=isolated` does not create standard symlinks for nested workspace packages. Even after adding `packages/qagent/packages/*` to the root `package.json` workspaces array, `bun install` does not link `@composio/ao-core`.

## What We Tried

1. **Dynamic imports with try-catch** (commit `533ba0af`) — CLI starts but team/harness commands are unavailable since the module cannot be loaded at runtime.

2. **Added nested workspace globs to root workspaces** (commit `33915b35`) — Added `packages/qagent/packages/*` and `packages/qagent/packages/plugins/*` to root `package.json` workspaces. `bun install` still doesn't resolve `@composio/ao-core`.

3. **Fresh install on Mac Mini** — Ran `rm -rf node_modules` followed by `bun install` on a clean environment. Same result: `@composio/ao-core` remains unresolved.

4. **node-linker=isolated behavior** — Bun uses `.bun/` internal linking instead of `node_modules` symlinks, which prevents standard workspace resolution for deeply nested packages.

## Tested On

- **Mac Mini** — macOS, M4 Pro, bun 1.3.9
- **WSL** — Ubuntu, bun 1.3.10 — too slow on `/mnt/c` for practical use

## Impact

The following qagent commands are **unavailable** due to the missing dependency:

- `team`
- `harness`
- `start`
- `status`
- `spawn`
- `session`
- `send`
- `review-check`
- `dashboard`
- `open`

Only `init` and `pr-comments` work (except the `pr-comments forward` subcommand, which depends on `@composio/ao-core`).

## Possible Solutions

1. **Relative file path imports** — Change `@composio/ao-core` imports to relative file paths (e.g., `../core/src/index.ts`). Bypasses workspace resolution entirely.

2. **Remove node-linker=isolated for qagent** — Allow standard node_modules symlinks for the qagent subpackage so workspace resolution works normally.

3. **Add bunfig.toml overrides** — Create a `bunfig.toml` in `packages/qagent/` with explicit package overrides to force resolution of `@composio/ao-core`.

4. **Rename and re-register** — Rename `@composio/ao-core` to `@qcut/qagent-core` and properly register it as a top-level workspace package.
