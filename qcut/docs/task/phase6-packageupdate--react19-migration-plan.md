# Phase 6 — React 19 Migration Plan

> Created: 2026-02-20
> Branch: TBD (separate from `win-build-update-2`)
> Status: **Planning**

## Overview

Phase 6 covers the remaining major version upgrades that were deferred from earlier phases. The centerpiece is the React 18 → 19 migration, which unlocks several downstream package upgrades.

---

## Compatibility Check Results

### ✅ Confirmed React 19 Compatible

| Package | Current | Latest | peerDependencies | Status |
|---------|---------|--------|-----------------|--------|
| Remotion (all) | 4.0.424 | 4.0.424+ | React 19 supported since 4.0.0 | ✅ Ready |
| react-day-picker | 8.10.1 | 9.13.2 | `react >= 16.8.0` | ✅ Ready |
| react-resizable-panels | 2.1.9 | 4.6.4 | `react ^18.0.0 \|\| ^19.0.0` | ✅ Ready |

### Source References
- Remotion: https://www.remotion.dev/docs/react-19
- react-day-picker: npm peerDependencies `react >= 16.8.0`
- react-resizable-panels: npm peerDependencies `react ^18.0.0 || ^19.0.0`

---

## Upgrade Packages

### Tier 1 — Core (must do together)

| Package | Current | Target | Notes |
|---------|---------|--------|-------|
| react | 18.3.1 | 19.x | Core framework |
| react-dom | 18.3.1 | 19.x | Must match react |
| @types/react | 18.x | 19.x | Must match react |
| @types/react-dom | 18.x | 19.x | Must match react |
| scheduler | 0.23.2 | 0.27.0 | Tied to React internals |

### Tier 2 — Unlocked by React 19

| Package | Current | Target | Notes |
|---------|---------|--------|-------|
| react-day-picker | 8.10.1 | 9.13.2 | Major — API changes, new locale system |
| react-resizable-panels | 2.1.9 | 4.6.4 | Major — explicitly supports React 19 |
| @vitejs/plugin-react | 4.7.0 | 5.x | Major — test with vite |
| Next.js | 15.5.2 | 16.x | Major — requires React 19 |

### Tier 3 — Independent Major Upgrades (can do separately)

| Package | Current | Target | Notes |
|---------|---------|--------|-------|
| Zod | 3.25.76 | 4.x | API changes, affects all schemas |
| @hookform/resolvers | 3.10.0 | 5.x | Tied to zod version |
| recharts | 2.15.4 | 3.x | Chart library major rewrite |
| Vitest | 3.2.4 | 4.x | Test framework major |
| @vitest/coverage-v8 | 3.2.4 | 4.x | Must match vitest |
| @vitest/ui | 3.2.4 | 4.x | Must match vitest |
| vite-tsconfig-paths | 5.1.4 | 6.x | Major |

### Tier 4 — Lint Tooling (separate effort)

| Package | Current | Target | Notes |
|---------|---------|--------|-------|
| @biomejs/biome | 2.1.2 | 2.4.2+ | Previously tested — incompatible with ultracite 5.x |
| ultracite | 5.0.48 | 7.x | Config structure completely changed (extends path, rule keys) |

**Note:** biome 2.4.2 + ultracite 5.x had dozens of unknown rule key errors. ultracite 6.x changed extends from `["ultracite"]` to `["ultracite/react"]`. This needs dedicated investigation.

---

## Recommended Execution Order

### Step 1: React 19 Core
```
react, react-dom, @types/react, @types/react-dom, scheduler
```
- Fix any Ref type errors (Remotion 4.0.236+ handles this)
- Fix any deprecated React API usage (e.g., `defaultProps`, `propTypes`)
- Run build + tests

### Step 2: React Ecosystem Libraries
```
react-day-picker 8 → 9
react-resizable-panels 2 → 4
@vitejs/plugin-react 4 → 5
```
- Each has API changes — update one at a time
- react-day-picker 9 has new CSS imports and locale system
- react-resizable-panels 4 may have prop/API changes

### Step 3: Next.js 16
```
next 15 → 16
```
- Depends on React 19
- May have routing/middleware changes

### Step 4: Zod + Form Resolvers
```
zod 3 → 4
@hookform/resolvers 3 → 5
```
- Zod 4 has different API — audit all `z.` usage across codebase
- @hookform/resolvers must match both react-hook-form and zod versions

### Step 5: Test Framework
```
vitest 3 → 4
@vitest/coverage-v8 3 → 4
@vitest/ui 3 → 4
vite-tsconfig-paths 5 → 6
```

### Step 6: Lint Tooling
```
@biomejs/biome 2.1.2 → latest
ultracite 5 → 7
```
- Requires rewriting biome.jsonc config
- Test lint rules thoroughly

---

## Risk Assessment

| Step | Risk | Effort | Impact |
|------|------|--------|--------|
| React 19 Core | 🟡 Medium | High | Unlocks everything |
| Ecosystem Libs | 🟡 Medium | Medium | API migrations needed |
| Next.js 16 | 🟡 Medium | Medium | Routing changes possible |
| Zod 4 | 🔴 High | High | Touches all schemas/validation |
| Vitest 4 | 🟢 Low | Low | Test infra only |
| Lint Tooling | 🟡 Medium | Medium | Config rewrite |

---

## Pre-Migration Checklist

- [ ] Ensure all Phase 1-5 changes are merged to master
- [ ] Create dedicated branch for React 19 migration
- [ ] Audit codebase for deprecated React 18 patterns:
  - `defaultProps` on function components
  - String refs
  - Legacy context API
  - `ReactDOM.render` (should be `createRoot`)
- [ ] Audit all `z.` Zod usage before Zod 4 migration
- [ ] Check Remotion version ≥ 4.0.236 for React 19 Ref types ✅ (4.0.424)
- [ ] Run full test suite as baseline before starting

---

## CI Validation

CI runs on 3 platforms (ubuntu, windows, macos). Each step should:
1. Build pass on all 3
2. Tests pass (or documented failures)
3. Separate PR per step for easy rollback
