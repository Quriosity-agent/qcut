# Inline QAgent Submodule into QCut Monorepo

**Goal**: Remove the `packages/qagent` git submodule and inline its source code directly into the qcut repository, eliminating the separate repo dependency.

**Current state**: `packages/qagent` is a git submodule pointing to `https://github.com/donghaozhang/agent-orchestrator-setup.git` (branch: main). It's a Bun monorepo with 6 packages, 18 plugins, and a Next.js dashboard.

---

## Why Inline?

- **Single source of truth** — no version drift between qcut and qagent
- **Atomic commits** — changes spanning both qcut and qagent land in one commit
- **Simpler CI** — no submodule init/update steps in workflows
- **Easier contributor onboarding** — `git clone` just works, no `--recursive`
- **Unified dependency management** — one lockfile, one `bun install`

## Risks

- Lose ability to use qagent independently in other repos (mitigated: can always extract later)
- Increased qcut repo size (~150 MB source, 589 MB node_modules excluded by .gitignore)
- Need to merge two sets of git history (or accept a clean break)

---

## Migration Steps

### Phase 1: Prepare (no code changes)

1. **Ensure qagent is on the desired commit**
   ```bash
   cd packages/qagent
   git log --oneline -1   # Record the commit hash
   ```

2. **Back up the submodule remote URL for reference**
   ```
   Remote: https://github.com/donghaozhang/agent-orchestrator-setup.git
   Branch: main
   ```

### Phase 2: Remove the Submodule

3. **Deinit the submodule**
   ```bash
   cd /Users/peter/Desktop/code/qcut   # parent repo root
   git submodule deinit -f qcut/packages/qagent
   ```

4. **Remove from .gitmodules**
   - Edit `/Users/peter/Desktop/code/qcut/.gitmodules`
   - Delete the `[submodule "qcut/packages/qagent"]` section

5. **Remove from git index and staging**
   ```bash
   git rm -f qcut/packages/qagent
   ```

6. **Remove cached submodule metadata**
   ```bash
   rm -rf .git/modules/qcut/packages/agent-orchestrator
   ```

7. **Clean up git config**
   ```bash
   git config --remove-section submodule.qcut/packages/qagent 2>/dev/null || true
   ```

### Phase 3: Add Source Inline

8. **Copy the source back (without .git)**
   - The submodule content was removed in step 5. We need the source files.
   - Option A: Clone fresh and copy (cleanest)
     ```bash
     git clone --depth 1 https://github.com/donghaozhang/agent-orchestrator-setup.git /tmp/qagent-inline
     rm -rf /tmp/qagent-inline/.git
     cp -r /tmp/qagent-inline/ qcut/packages/qagent/
     rm -rf /tmp/qagent-inline
     ```
   - Option B: If you still have a local copy, just remove the `.git` file
     ```bash
     rm qcut/packages/qagent/.git
     ```

9. **Remove submodule-specific files from the inlined copy**
   - Files to delete (no longer needed inside qcut):
     ```
     packages/qagent/.github/          # Has its own CI workflows — conflicts with qcut's
     packages/qagent/.husky/           # qcut has its own husky hooks
     packages/qagent/.changeset/       # qcut manages its own changesets
     packages/qagent/.cursor/          # IDE config
     packages/qagent/.gitleaks.toml    # qcut has its own if needed
     packages/qagent/.prettierrc       # Use qcut's formatter (Biome)
     packages/qagent/.prettierignore   # Same
     packages/qagent/.gitignore        # Merge relevant entries into qcut's root .gitignore
     packages/qagent/LICENSE           # Covered by qcut's license
     ```

10. **Merge .gitignore entries**
    - Review `packages/qagent/.gitignore` for anything qcut's root `.gitignore` doesn't cover
    - Add any missing patterns to the root `.gitignore`

### Phase 4: Integrate into QCut's Workspace

11. **Add qagent packages to qcut's workspace config**
    - Edit `qcut/package.json` workspaces:
      ```json
      "workspaces": [
        "apps/*",
        "packages/auth",
        "packages/db",
        "packages/qagent/packages/*",
        "packages/qagent/packages/plugins/*"
      ]
      ```
    - Alternatively, keep qagent's own workspace resolution by leaving its `package.json` as-is and just adding `"packages/qagent"` to qcut's workspaces.

12. **Decide on dependency strategy**
    - Option A (recommended): Let qagent keep its own `bun install` / `bun run build` via the `qagent:build` / `qagent:init` scripts already in `package.json`. This is the minimal-change approach.
    - Option B: Hoist all qagent dependencies into qcut's root. Requires merging package.json devDependencies and resolving version conflicts. More work, cleaner long-term.

13. **Update qcut scripts** (already done in prior PR, verify)
    ```json
    "qagent:build": "cd packages/qagent && bun run build",
    "qagent:init": "cd packages/qagent && bun install && bun run build",
    "qagent:setup": "bun run submodule:init && bun run qagent:init"
    ```
    - Change `qagent:setup` to remove `submodule:init` dependency:
      ```json
      "qagent:setup": "bun run qagent:init"
      ```

### Phase 5: Update References

14. **Files to update in qcut**
    - `package.json` — remove submodule:init from qagent:setup
    - `CLAUDE.md` — no changes needed (already references `packages/qagent`)
    - `docs/task/migrate-agent-orchestrator-to-bun.md` — update paths
    - `.claude/skills/qagent/SKILL.md` — update setup instructions (remove submodule steps)
    - `agent-orchestrator.yaml` — consider renaming to `qagent.yaml`

15. **Files to update inside packages/qagent**
    - `README.md` — remove "git clone" install instructions, note it's part of qcut
    - `CLAUDE.md` — note it lives inside qcut monorepo
    - `SETUP.md` — update installation to just `cd packages/qagent && bun install && bun run build`

### Phase 6: Verify

16. **Test the build**
    ```bash
    cd qcut/packages/qagent
    bun install
    bun run build
    bun run typecheck
    bun run test
    ```

17. **Test from qcut root**
    ```bash
    cd qcut
    bun run qagent:build
    ```

18. **Verify git status is clean**
    ```bash
    git status   # Should show packages/qagent/ as regular tracked files, no submodule
    git submodule status   # Should only show video-agent-skill
    ```

19. **Test qagent CLI works**
    ```bash
    cd packages/qagent
    bun run dev   # Dashboard
    # In another terminal:
    npx qagent status
    ```

### Phase 7: Commit

20. **Stage and commit**
    ```bash
    git add .gitmodules packages/qagent/ package.json
    git commit -m "refactor: inline qagent submodule into monorepo"
    ```

---

## Key Decision: Preserve Git History?

**Option A — Clean break (recommended)**
- Clone at current commit, drop `.git`, add as regular files
- Pros: Simple, clean, no merge conflicts
- Cons: Lose qagent commit history in qcut repo
- History preserved at: `https://github.com/donghaozhang/agent-orchestrator-setup.git`

**Option B — Merge history with `git subtree`**
```bash
git subtree add --prefix=qcut/packages/qagent \
  https://github.com/donghaozhang/agent-orchestrator-setup.git main --squash
```
- Pros: History appears in `git log`
- Cons: More complex, can cause merge issues

**Recommendation**: Option A. The history is in the upstream repo if ever needed.

---

## Post-Migration Cleanup

- Archive or make private: `donghaozhang/agent-orchestrator-setup` (optional)
- Remove any CI steps that run `git submodule update` for qagent
- Update contributor docs to mention qagent lives at `packages/qagent/`

## Size Impact

| Component | Size |
|-----------|------|
| Source code (TS/TSX) | ~5 MB |
| Scripts & docs | ~2 MB |
| Config files | ~200 KB |
| bun.lock | 162 KB |
| node_modules (gitignored) | 589 MB |
| **Total added to repo** | **~8 MB** |
