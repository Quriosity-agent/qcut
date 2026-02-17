# Video Agent Skill — Git Submodule Integration Plan

**Date**: 2026-02-17
**Repo**: https://github.com/donghaozhang/video-agent-skill
**Goal**: Add `video-agent-skill` as a git submodule so QCut can leverage its 73 AI models, YAML pipelines, and `aicp` CLI directly from the monorepo.

---

## Context

QCut **already integrates** with the AI Content Pipeline via `electron/ai-pipeline-handler.ts`, which spawns the bundled `aicp` binary. Currently the binary is fetched at build/runtime by `electron/binary-manager.ts`. Adding the source repo as a submodule provides:

- **Editable source** — iterate on models/pipelines without publishing a new binary
- **Shared development** — contributors work on both repos in one workspace
- **Tighter CI** — run `video-agent-skill` tests alongside QCut tests
- **Skill authoring** — expose YAML pipeline templates via QCut's skill system

---

## Task 1 — Add the Git Submodule

**Estimated effort**: < 5 min
**Files touched**: `.gitmodules` (new), `packages/video-agent-skill/` (new)

```bash
# From repo root
git submodule add https://github.com/donghaozhang/video-agent-skill.git packages/video-agent-skill
git commit -m "feat: add video-agent-skill as submodule"
```

**Why `packages/`?**
QCut already uses `packages/` for internal packages (`auth`, `db`). Placing the submodule here keeps the monorepo layout consistent and lets Turborepo discover it.

**Post-add checklist**:
- [ ] Verify `.gitmodules` contains the correct URL and path
- [ ] Add `packages/video-agent-skill` to the root `.gitignore` exclusions if needed
- [ ] Document the submodule init command in the project README

---

## Task 2 — Configure Submodule for Development

**Estimated effort**: 10 min
**Files touched**: `package.json` (root), `.gitmodules`, `turbo.json`

### 2a. Pin to a stable branch/tag

```ini
# .gitmodules
[submodule "packages/video-agent-skill"]
    path = packages/video-agent-skill
    url = https://github.com/donghaozhang/video-agent-skill.git
    branch = main
```

### 2b. Add convenience scripts to root `package.json`

```jsonc
{
  "scripts": {
    "aicp:install": "cd packages/video-agent-skill && pip install -e '.[dev]'",
    "aicp:test": "cd packages/video-agent-skill && python -m pytest tests/ -x --tb=short",
    "aicp:list-models": "cd packages/video-agent-skill && python -m ai_content_pipeline list-models",
    "submodule:init": "git submodule update --init --recursive",
    "submodule:update": "git submodule update --remote packages/video-agent-skill"
  }
}
```

### 2c. Turborepo awareness (optional)

If Turborepo should track the submodule for cache invalidation, add a pipeline entry in `turbo.json`:

```jsonc
{
  "pipeline": {
    "aicp:test": {
      "inputs": ["packages/video-agent-skill/**"],
      "cache": false
    }
  }
}
```

---

## Task 5 — CI/CD Updates

**Estimated effort**: 15 min
**Files touched**: `.github/workflows/`

### 5a. Submodule checkout in CI

Every workflow that clones QCut must add:

```yaml
- uses: actions/checkout@v4
  with:
    submodules: recursive
```

### 5b. Python environment for `aicp` tests

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: "3.10"
- run: pip install -e packages/video-agent-skill[dev]
- run: python -m pytest packages/video-agent-skill/tests/ -x --tb=short
```

### 5c. Binary build coordination

When a new version of `video-agent-skill` is tagged, trigger the PyInstaller binary build and update the binary URL in `binary-manager.ts`.

---

## Task 6 — Documentation & Onboarding

**Estimated effort**: 10 min
**Files touched**: `CLAUDE.md`, `docs/`

### 6a. Update CLAUDE.md project structure

Add `packages/video-agent-skill/` to the directory tree with a brief description.

### 6b. Developer onboarding

Add a section to `docs/` (or README) explaining:

```
## AI Content Pipeline (Submodule)

git submodule update --init --recursive
cd packages/video-agent-skill
pip install -e '.[dev]'
python -m pytest tests/ -x
```

### 6c. API key mapping

Document the key mapping between QCut and `video-agent-skill`:

| QCut env var | video-agent-skill env var | Provider |
|---|---|---|
| `VITE_FAL_API_KEY` | `FAL_KEY` | FAL.ai |
| (new) `GOOGLE_AI_API_KEY` | `GOOGLE_AI_API_KEY` | Google Veo/Imagen |
| (new) `OPENAI_API_KEY` | `OPENAI_API_KEY` | OpenRouter/Sora |
| (new) `ELEVENLABS_API_KEY` | `ELEVENLABS_API_KEY` | ElevenLabs TTS |

---

## Task 7 — Unit Tests

**Estimated effort**: 15 min
**Files touched**: `apps/web/src/lib/ai-video/__tests__/`, `electron/__tests__/`

### 7a. Electron IPC handler tests

**File**: `electron/__tests__/ai-pipeline-handler.test.ts`

- Test environment resolution for bundled binary and system/Python fallbacks
- Test `spawn` is called with correct args for each command type
- Test JSON output parsing from `--json --quiet` flags
- Mock `BinaryManager` and `fs.existsSync`

### 7b. Model registry sync tests

**File**: `scripts/check-submodule.sh` (script behavior validation)

- Test success path when `packages/video-agent-skill/setup.py` exists
- Test failure path when submodule is not initialized
- Verify guidance output includes `git submodule update --init --recursive`

### 7c. Submodule health check

**File**: `scripts/check-submodule.sh`

```bash
#!/bin/bash
# Verify submodule is initialized and on expected branch
if [ ! -f packages/video-agent-skill/setup.py ]; then
  echo "ERROR: video-agent-skill submodule not initialized"
  echo "Run: git submodule update --init --recursive"
  exit 1
fi
echo "Submodule OK"
```

---

## Implementation Order

| Phase | Tasks | Blocking? |
|-------|-------|-----------|
| **Phase 1** | Task 1 (add submodule), Task 2 (configure) | Yes — everything depends on this |
| **Phase 2** | Task 5 (CI), Task 6 (docs) | Can run in parallel |
| **Phase 3** | Task 7 (tests) | Depends on Phase 2 |

**Phase 1 can be completed in < 15 minutes.** Phase 2 is ~25 min. Phase 3 is ~15 min.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Submodule adds clone time | Pin to shallow clone: `git submodule update --depth 1` |
| Python version conflicts | Document `python>=3.10` requirement; use venv |
| Binary vs source drift | CI job compares `aicp --version` from binary and source |
| Large test suite (844 tests) slows CI | Run `aicp:test` only on submodule changes via `paths` filter |
| Submodule branch diverges | Use `branch = main` in `.gitmodules`; periodic `submodule:update` |
