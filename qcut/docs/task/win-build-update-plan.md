# Windows Build Update Plan

> Created: 2026-02-19  
> Branch: `win-build-update`

## Summary

Audit of outdated packages across root and `apps/web`. Categorized by risk level for safe incremental updates.

---

## ✅ Safe to Update (patch/minor, low risk)

These are patch or minor bumps within the same major version. Should be safe to update.

### Root (`package.json`)

| Package | Current | Latest | Notes |
|---------|---------|--------|-------|
| typescript | 5.9.2 | 5.9.3 | Patch |
| turbo | 2.8.0 | 2.8.10 | Patch |
| electron-updater | 6.6.2 | 6.8.3 | Minor, auto-update fixes |
| esbuild | 0.25.8 | 0.25.12 | Patch |
| cross-env | 10.0.0 | 10.1.0 | Minor |
| @playwright/test | 1.55.0 | 1.58.2 | Minor |
| playwright | 1.55.0 | 1.58.2 | Minor |
| rollup-plugin-visualizer | 6.0.3 | 6.0.5 | Patch |
| @types/node | 24.3.1 | 24.10.13 | Patch types |
| @types/react | 18.3.24 | 18.3.28 | Patch types |
| wavesurfer.js | 7.10.1 | 7.12.1 | Minor |
| remotion (all) | 4.0.417 | 4.0.424 | Patch |

### Web (`apps/web/package.json`)

| Package | Current | Latest | Notes |
|---------|---------|--------|-------|
| typescript | 5.9.2 | 5.9.3 | Patch |
| vite | 7.1.3 | 7.3.1 | Minor |
| tailwindcss | 4.1.12 | 4.2.0 | Minor |
| @tailwindcss/postcss | 4.1.12 | 4.2.0 | Minor |
| @tailwindcss/typography | 0.5.16 | 0.5.19 | Patch |
| zustand | 5.0.8 | 5.0.11 | Patch |
| motion | 12.23.12 | 12.34.2 | Minor |
| react-hook-form | 7.62.0 | 7.71.1 | Minor |
| dayjs | 1.11.15 | 1.11.19 | Patch |
| @fal-ai/client | 1.6.2 | 1.9.1 | Minor, AI API updates |
| @babel/parser | 7.28.6 | 7.29.0 | Minor |
| @babel/traverse | 7.28.6 | 7.29.0 | Minor |
| @babel/types | 7.28.6 | 7.29.0 | Minor |
| @tanstack/react-router | 1.131.28 | 1.161.1 | Minor |
| @tanstack/router-plugin | 1.131.28 | 1.161.1 | Minor |
| drizzle-orm | 0.44.5 | 0.44.7 | Patch |
| drizzle-kit | 0.31.4 | 0.31.9 | Patch |
| pg | 8.16.3 | 8.18.0 | Minor |
| tsx | 4.20.5 | 4.21.0 | Minor |
| @aws-sdk/client-s3 | 3.876.0 | 3.993.0 | Minor |
| feed | 5.1.0 | 5.2.0 | Minor |
| botid | 1.5.3 | 1.5.10 | Patch |
| @testing-library/jest-dom | 6.8.0 | 6.9.1 | Minor |
| @testing-library/react | 16.3.0 | 16.3.2 | Patch |
| @types/pg | 8.15.5 | 8.16.0 | Minor types |
| cross-env | 10.0.0 | 10.1.0 | Minor |
| @upstash/ratelimit | 2.0.6 | 2.0.8 | Patch |
| @upstash/redis | 1.35.3 | 1.36.2 | Minor |
| @vercel/analytics | 1.5.0 | 1.6.1 | Minor |
| react-phone-number-input | 3.4.12 | 3.4.14 | Patch |
| @radix-ui/react-separator | 1.1.7 | 1.1.8 | Patch |
| @t3-oss/env-core | 0.13.8 | 0.13.10 | Patch |

---

## ⚠️ Moderate Risk (major version jump or breaking changes possible)

Update carefully, test after each.

| Package | Current | Latest | Risk |
|---------|---------|--------|------|
| electron | 37.4.0 | 40.4.1 | **Major** — Chromium/Node upgrade, test thoroughly |
| electron-builder | 26.0.12 | 26.8.1 | Minor but electron-builder can be finicky |
| @biomejs/biome | 2.1.2 | 2.4.2 | Minor but linting rules may change |
| lucide-react | 0.468.0 | 0.574.0 | Minor (pre-1.0), icon names may change |
| @emnapi/core | 1.4.5 | 1.8.1 | Minor, native module related |
| sonner | 1.7.4 | 2.0.7 | **Major** — toast API may change |
| tailwind-merge | 2.6.0 | 3.5.0 | **Major** — class merge logic may differ |
| dotenv | 16.6.1 | 17.3.1 | **Major** |
| happy-dom | 18.0.1 | 20.6.3 | **Major** — test env |
| jsdom | 26.1.0 | 28.1.0 | **Major** — test env |

---

## 🚫 Do NOT Update (breaking, needs migration)

These require significant code changes or are pinned for compatibility.

| Package | Current | Latest | Reason |
|---------|---------|--------|--------|
| react | 18.3.1 | 19.2.4 | React 19 migration — massive change, Remotion may not support |
| react-dom | 18.3.1 | 19.2.4 | Must match react version |
| @types/react | 18.x | 19.x | Must match react version |
| @types/react-dom | 18.x | 19.x | Must match react version |
| scheduler | 0.23.2 | 0.27.0 | Tied to React internals |
| next | 15.5.2 | 16.1.6 | Major — likely needs React 19 |
| framer-motion | 11.18.2 | 12.34.2 | Major — already have `motion` 12.x, this is legacy |
| zod | 3.25.76 | 4.3.6 | **Major** — API changes, affects all schemas |
| @hookform/resolvers | 3.10.0 | 5.2.2 | Major, tied to react-hook-form + zod version |
| react-resizable-panels | 2.1.9 | 4.6.4 | Major |
| recharts | 2.15.4 | 3.7.0 | Major |
| react-day-picker | 8.10.1 | 9.13.2 | Major |
| @vitejs/plugin-react | 4.7.0 | 5.1.4 | Major, test with vite update |
| @vitest/coverage-v8 | 3.2.4 | 4.0.18 | Major |
| @vitest/ui | 3.2.4 | 4.0.18 | Major |
| vitest | 3.2.4 | 4.0.18 | Major |
| ultracite | 5.0.48 | 7.2.3 | Major |
| @types/jsdom | 21.1.7 | 27.0.0 | Major, tied to jsdom version |
| vite-tsconfig-paths | 5.1.4 | 6.1.1 | Major |

---

## Recommended Update Order

1. **Phase 1 — Safe patches** (low risk, do all at once):
   ```bash
   bun update typescript turbo esbuild cross-env rollup-plugin-visualizer wavesurfer.js @types/node @types/react electron-updater
   bun update --cwd apps/web typescript vite tailwindcss @tailwindcss/postcss @tailwindcss/typography zustand motion react-hook-form dayjs @fal-ai/client drizzle-orm drizzle-kit pg tsx @babel/parser @babel/traverse @babel/types @tanstack/react-router @tanstack/router-plugin
   ```
   Then `bun run build` to verify.

2. **Phase 2 — Remotion bump**:
   ```bash
   bun update remotion @remotion/player @remotion/renderer @remotion/transitions @remotion/zod-types
   bun update --cwd apps/web remotion @remotion/player @remotion/renderer
   ```
   Then `bun run build` to verify.

3. **Phase 3 — Build tooling**:
   - electron-builder 26.0.12 → 26.8.1
   - @playwright/test + playwright 1.55 → 1.58
   - @biomejs/biome 2.1.2 → 2.4.2
   Then full build + test.

4. **Phase 4 — Moderate risk** ✅ COMPLETED (2026-02-20):
   - ✅ lucide-react 0.468.0 → 0.574.0 (no icon renames needed)
   - ✅ sonner 1.7.4 → 2.0.7 (API compatible)
   - ✅ tailwind-merge 2.6.0 → 3.5.0 (build OK)
   - ✅ dotenv 16.6.1 → 17.3.1 (build OK)
   - ✅ happy-dom 18.0.1 → 20.6.3 (build OK)
   - ✅ jsdom 26.1.0 → 28.1.0 (build OK)

5. **Phase 5 — Electron major** (separate PR):
   - electron 37 → 40 (needs thorough testing on Win/Mac/Linux)

6. **Phase 6 — Future** (not now):
   - React 19 migration (big project)
   - Zod 4 migration
   - Vitest 4 migration
