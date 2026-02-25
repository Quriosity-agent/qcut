# Migrate Agent Orchestrator Submodule from pnpm to Bun

**Goal**: Standardize the `packages/agent-orchestrator/` submodule on Bun to match the parent qcut project, eliminating the dual package manager setup.

**Priority**: Long-term maintainability — single toolchain, faster installs, simpler onboarding.

**Estimated effort**: ~45 minutes across 6 subtasks.

---

## Subtask 1: Replace pnpm workspace config with Bun workspaces

**Files to modify:**
- `packages/agent-orchestrator/package.json` — add `"workspaces"` array, remove `"packageManager": "pnpm@9.15.4"`
- `packages/agent-orchestrator/pnpm-workspace.yaml` — **delete**
- `packages/agent-orchestrator/.npmrc` — **delete** (only contains `access=public`, set in publish step instead)

**Changes:**

In `package.json`, replace:
```json
"packageManager": "pnpm@9.15.4"
```

With:
```json
"workspaces": [
  "packages/*",
  "packages/plugins/*"
]
```

**Validation:**
- Run `bun install` — verify all 22 workspace packages are linked
- Confirm `workspace:*` protocol resolves correctly (Bun supports it natively)

---

## Subtask 2: Migrate root scripts from pnpm to Bun

**File to modify:**
- `packages/agent-orchestrator/package.json`

**Script mapping:**

| pnpm command | Bun equivalent |
|---|---|
| `pnpm -r build` | `bun run --filter '*' build` |
| `pnpm --filter @composio/ao-web dev` | `bun run --filter @composio/ao-web dev` |
| `pnpm -r typecheck` | `bun run --filter '*' typecheck` |
| `pnpm -r --filter '!@composio/ao-web' test` | `bun run --filter '!@composio/ao-web' test` |
| `pnpm --filter @composio/ao-integration-tests test:integration` | `bun run --filter @composio/ao-integration-tests test:integration` |
| `pnpm -r clean` | `bun run --filter '*' clean` |
| `pnpm -r --filter '!@composio/ao-web' build && changeset publish` | `bun run --filter '!@composio/ao-web' build && changeset publish` |

**Note on `--filter`**: Bun supports workspace filtering via `bun run --filter`. Verify recursive build order is respected (Bun resolves dependency graph automatically).

**Validation:**
- `bun run build` succeeds for all 22 packages
- `bun run test` passes

---

## Subtask 3: Fix node-pty native rebuild for Bun

**Files to modify:**
- `packages/agent-orchestrator/scripts/rebuild-node-pty.js` — update pnpm-specific path
- `packages/agent-orchestrator/package.json` — keep `postinstall` hook

**Current issue:** The rebuild script hardcodes the pnpm store path:
```text
node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty
```

Bun uses a flat `node_modules` layout. Update to:
```text
node_modules/node-pty
```

**Validation:**
- Run `bun install` — postinstall rebuilds node-pty successfully
- Test terminal functionality (DirectTerminal) works

---

## Subtask 4: Generate Bun lockfile, remove pnpm lockfile

**Files:**
- `packages/agent-orchestrator/pnpm-lock.yaml` — **delete** (230KB)
- `packages/agent-orchestrator/bun.lock` — **generate**
- `packages/agent-orchestrator/.gitignore` — replace `.pnpm-store/` with `bun.lock` (if binary) or keep as-is

**Steps:**
```bash
cd packages/agent-orchestrator
rm pnpm-lock.yaml
bun install
```

**Validation:**
- `bun.lock` is generated
- `bun install` from clean state works (delete `node_modules`, reinstall)

---

## Subtask 5: Update CI/CD workflows

**Files to modify:**
- `packages/agent-orchestrator/.github/workflows/ci.yml`
- `packages/agent-orchestrator/.github/workflows/release.yml`
- `packages/agent-orchestrator/.github/workflows/integration-tests.yml`
- `packages/agent-orchestrator/.github/workflows/security.yml`
- `packages/agent-orchestrator/tests/integration/Dockerfile`

**CI changes (all workflows):**

Replace:
```yaml
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
  with:
    cache: pnpm
- run: pnpm install --frozen-lockfile
```

With:
```yaml
- uses: oven-sh/setup-bun@v2
- run: bun install --frozen-lockfile
```

**Per-workflow script updates:**

| Workflow | pnpm command | Bun equivalent |
|---|---|---|
| ci.yml | `pnpm lint` | `bun run lint` |
| ci.yml | `pnpm -r --filter '!@composio/ao-web' build` | `bun run --filter '!@composio/ao-web' build` |
| ci.yml | `pnpm -r --filter '!@composio/ao-web' typecheck` | `bun run --filter '!@composio/ao-web' typecheck` |
| ci.yml | `pnpm --filter @composio/ao-web build` | `bun run --filter @composio/ao-web build` |
| ci.yml | `pnpm test` | `bun run test` |
| release.yml | `pnpm release` | `bun run release` |
| integration-tests.yml | `pnpm test:integration` | `bun run test:integration` |
| security.yml | `pnpm audit` | `bun pm audit` (if available) or `npx audit-ci` |

**Dockerfile:**
Replace `RUN npm install -g pnpm` with `RUN curl -fsSL https://bun.sh/install | bash`

**Validation:**
- Push to a test branch, confirm CI passes

---

## Subtask 6: Update documentation and parent repo integration

**Files to modify (submodule docs):**
- `packages/agent-orchestrator/CLAUDE.md` — update all commands section
- `packages/agent-orchestrator/README.md` — update quick start / development
- `packages/agent-orchestrator/SETUP.md` — replace pnpm install instructions
- `packages/agent-orchestrator/docs/DEVELOPMENT.md` — replace all pnpm references
- `packages/agent-orchestrator/TROUBLESHOOTING.md` — update node-pty path reference
- `packages/agent-orchestrator/scripts/setup.sh` — replace pnpm with bun

**Files to modify (parent qcut repo):**
- `qcut/package.json` — update `ao:init` script:
  ```json
  "ao:init": "cd packages/agent-orchestrator && bun install && bun run build"
  ```

**Files to modify (submodule source):**
- `packages/agent-orchestrator/start-lifecycle.mjs` — update comment on line 3

**Validation:**
- `bun run ao:setup` from qcut root works end-to-end
- Fresh clone + setup works

---

## Test Plan

| Test | Command | Expected |
|---|---|---|
| Clean install | `rm -rf node_modules && bun install` | All 22 packages linked |
| Full build | `bun run build` | All packages compile |
| Core tests | `bun run test` | Tests pass |
| CLI works | `bunx ao --version` | Prints `0.1.0` |
| Web dev server | `cd packages/web && bun run dev` | Next.js starts |
| node-pty rebuild | Check postinstall output | `spawn-helper` compiles |
| Parent integration | `bun run ao:setup` (from qcut root) | Submodule init + build |
| Integration tests | `bun run test:integration` | Pass |

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `bun run --filter` doesn't respect build order | Bun resolves workspace dependency graph; if issues arise, use `bun run build` in topological order via turbo |
| node-pty native build fails with Bun | Bun uses the same `node-gyp` pipeline; the rebuild script just needs the correct path |
| Next.js dev server incompatibility | Next.js officially supports Bun; the web package should work as-is |
| `changeset publish` requires npm registry auth | Changesets CLI is package-manager-agnostic; works with `bunx changeset publish` |
| `bun pm audit` may not exist | Fall back to `npx audit-ci` or `npm audit` in CI |

---

## Rollback

If migration causes issues:
- Revert the submodule to the pre-migration commit
- Run `git submodule update --init` in qcut to restore
