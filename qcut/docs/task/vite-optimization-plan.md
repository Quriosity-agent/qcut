# Vite Build Optimization Plan

**Date:** 2026-02-20
**Status:** Draft
**Build tool:** Vite 7.3.x with Rollup

---

## 1. Warning Summary

### 1.1 Large Chunks (>1000 kB after minification)

| Chunk | Size | Primary Content |
|-------|------|----------------|
| `vendor-motion-*.js` | 2,050 kB | `motion` (framer-motion successor) + `@hello-pangea/dnd` |
| `editor.$project_id.lazy-*.js` | 1,600 kB | Editor page + all statically imported stores/components |

### 1.2 Dynamic/Static Import Conflicts

Vite warns when a module is **both** dynamically imported (via `import()`) and statically imported elsewhere. The static import wins, pulling the module into the parent chunk and defeating code-splitting.

**Affected modules:**
- `playback-store.ts` — dynamic in `lazy-stores.ts`, static in `editor.$project_id.lazy.tsx` (via hooks)
- `project-store.ts` — dynamic in `lazy-stores.ts`, static in `editor.$project_id.lazy.tsx`
- `timeline-store.ts` — dynamic in `lazy-stores.ts`, static in `playback-store.ts` (lazy getter pattern)
- `media-store.ts` — dynamic in `lazy-stores.ts`, static in multiple editor components
- `media-store-loader.ts` — dynamic somewhere, static in editor components
- `stickers-store.ts` — dynamic in `lazy-stores.ts` (via overlay), static in editor
- `stickers-overlay-store.ts` — dynamic in `lazy-stores.ts`, static in editor
- `image-edit-client.ts` — dynamic import attempted, static import in image-edit UI
- `fal-ai-client.ts` — dynamic import attempted, static import in AI feature components

**Root cause:** The `lazy-stores.ts` utility wraps stores in `import()` for code-splitting, but the same stores are directly imported by the editor route and its components via `import { useXStore } from "@/stores/x-store"`. Since the lazy editor route (`editor.$project_id.lazy.tsx`) statically imports them, Rollup merges everything into the single lazy chunk.

### 1.3 Turbo Warning: No Output Files

```text
no output files found for task qcut#build
```

**Root cause:** `turbo.json` specifies `"outputs": [".next/**", "!.next/cache/**"]` — this is a Next.js pattern. The `apps/web` package uses **Vite** and outputs to `dist/`, so Turbo can't find any build artifacts to cache.

---

## 2. Prioritized Action Items

### P0 — Turbo Output Config (5 min, zero risk)

**File:** `turbo.json`

**Change:** Update the `build` task outputs to include Vite's output directory:

```jsonc
"build": {
  "dependsOn": ["^build"],
  "outputs": [
    ".next/**", "!.next/cache/**",  // keep for any Next.js packages
    "dist/**", "!dist/cache/**"     // add for Vite (apps/web)
  ],
  "env": [...]
}
```

**Risk:** None. This only affects Turbo's caching — builds will be properly cached and skipped when inputs haven't changed.

---

### P1 — Reduce `vendor-motion` chunk (2,050 kB → ~200-400 kB)

**Effort:** 2-4 hours | **Risk:** Medium

The `motion` package (v12.x, successor to framer-motion) is bundled entirely because the `manualChunks` rule `id.includes("motion")` captures the whole library. The `motion` package supports tree-shaking but only if specific entry points are used.

#### Option A: Targeted imports (recommended)

Audit all `motion` imports across the codebase. Replace:
```ts
import { motion, AnimatePresence } from "motion/react"
```
with only the specific features used. The `motion` v12 package is modular — unused features should be tree-shaken if imports are precise.

#### Option B: Split motion into its own async chunk

Remove `motion` from `manualChunks` and let it be pulled into the lazy editor chunk naturally. This won't reduce total size but removes a synchronous load on non-editor pages.

```ts
// vite.config.ts — remove from manualChunks:
// id.includes("motion") || id.includes("@hello-pangea/dnd")
```

Then `@hello-pangea/dnd` (drag-and-drop, editor-only) goes into the editor chunk, and `motion` gets tree-shaken per-route.

#### Option C: Replace `@hello-pangea/dnd` with lighter alternative

`@hello-pangea/dnd` is ~100 kB minified. Consider `@dnd-kit` (~30 kB) if DnD is only used for timeline reordering. **Higher effort, higher risk.**

**Recommended:** Option B first (10 min change, immediate improvement), then Option A for further gains.

---

### P2 — Break up the editor lazy chunk (1,600 kB)

**Effort:** 4-8 hours | **Risk:** Medium-High

The editor route is already lazy-loaded via TanStack Router's `createLazyFileRoute`, which is good. But at 1,600 kB it contains the entire editor — all panels, all stores, all features.

#### Step 1: Identify sub-chunks via further lazy loading

Split the editor into feature panels loaded on demand:

```text
editor.$project_id.lazy.tsx (shell: header + panel container, ~100 kB)
├── timeline-panel (lazy)
├── media-panel (lazy)
├── inspector-panel (lazy)
├── ai-features (lazy) — fal-ai-client, image-edit, text2image
├── stickers (lazy) — stickers-store, stickers-overlay
└── export (lazy) — export-store, export-engine
```

**Implementation:** Use `React.lazy()` for each panel layout component:

```tsx
// editor.$project_id.lazy.tsx
const TimelinePanel = React.lazy(() => import("@/components/editor/timeline-panel"));
const MediaPanel = React.lazy(() => import("@/components/editor/media-panel"));
// etc.
```

#### Step 2: Consolidate store import strategy

**This is the key architectural decision.** Currently, two patterns coexist:
1. `lazy-stores.ts` — dynamic `import()` wrappers with caching
2. Direct static imports in components — `import { useXStore } from "@/stores/x-store"`

The static imports in the lazy editor file negate the dynamic imports in `lazy-stores.ts`. **Pick one strategy:**

**Recommended: Keep static imports, remove `lazy-stores.ts`**

Since all stores are needed by the editor (which is already lazy-loaded), the `lazy-stores.ts` abstraction adds complexity without benefit. The stores will be code-split naturally as part of the editor chunk.

If further splitting is desired (P2 Step 1), move store imports into the sub-panels that actually use them:

| Store | Move to panel |
|-------|--------------|
| `playback-store` | timeline-panel |
| `timeline-store` | timeline-panel |
| `media-store` | media-panel |
| `media-store-loader` | media-panel |
| `project-store` | editor shell (needed everywhere) |
| `stickers-store` | stickers-panel (lazy) |
| `stickers-overlay-store` | stickers-panel (lazy) |
| `fal-ai-client` | ai-features-panel (lazy) |
| `image-edit-client` | ai-features-panel (lazy) |

---

### P3 — Resolve dynamic/static import conflicts

**Effort:** 1-2 hours | **Risk:** Low

This is effectively resolved by P2. If P2 is deferred, the quick fix is:

**Option A:** Remove `lazy-stores.ts` entirely — accept that stores are in the editor chunk. The warnings disappear and behavior doesn't change (static imports already win).

**Option B:** Remove static imports from `editor.$project_id.lazy.tsx` and route all store access through `lazy-stores.ts`. This is harder because React hooks can't be async — you'd need wrapper components or a preloading strategy.

**Recommended:** Option A. Delete or deprecate `lazy-stores.ts` unless P2's sub-chunking is implemented.

---

## 3. Specific File Changes

### Change 1: Fix Turbo outputs
**File:** `turbo.json`
```diff
 "build": {
   "dependsOn": ["^build"],
-  "outputs": [".next/**", "!.next/cache/**"],
+  "outputs": [".next/**", "!.next/cache/**", "dist/**"],
```

### Change 2: Split motion from DnD in manualChunks
**File:** `apps/web/vite.config.ts`
```diff
-  if (id.includes("motion") || id.includes("@hello-pangea/dnd")) {
-    return "vendor-motion";
-  }
+  // Only group animation library; let DnD go to editor chunk
+  if (id.includes("node_modules/motion")) {
+    return "vendor-motion";
+  }
```

### Change 3: Remove lazy-stores.ts (if not pursuing sub-chunking)
**File:** `apps/web/src/utils/lazy-stores.ts` — delete or mark deprecated
**Files using it:** Search for `from "@/utils/lazy-stores"` and replace with direct imports.

### Change 4 (if pursuing sub-chunking): Lazy panel imports
**File:** `apps/web/src/routes/editor.$project_id.lazy.tsx`
```diff
-import { DefaultLayout, MediaLayout, InspectorLayout, VerticalPreviewLayout } from "@/components/editor/panel-layouts";
+const DefaultLayout = React.lazy(() => import("@/components/editor/panel-layouts/default"));
+const MediaLayout = React.lazy(() => import("@/components/editor/panel-layouts/media"));
+const InspectorLayout = React.lazy(() => import("@/components/editor/panel-layouts/inspector"));
+const VerticalPreviewLayout = React.lazy(() => import("@/components/editor/panel-layouts/vertical-preview"));
```

---

## 4. Risk Assessment

| Change | Risk | Mitigation |
|--------|------|-----------|
| Turbo outputs | None | Pure config, no behavior change |
| Motion chunk split | Low | Test all animations still work; check no missing imports |
| Remove lazy-stores.ts | Low | Only removes dead code path (static imports already win) |
| Editor sub-chunking | Medium-High | Requires Suspense boundaries; test all panels render; risk of flash-of-loading; may break store cross-dependencies |
| Replace @hello-pangea/dnd | High | API differences; requires full timeline DnD regression testing |

---

## 5. Recommended Execution Order

1. **Turbo fix** — 5 min, ship immediately
2. **Motion chunk refactor** — split manualChunks, audit imports
3. **Remove lazy-stores.ts** — eliminates warnings, simplifies code
4. **Editor sub-chunking** — only if 1,600 kB is still problematic after 1-3
5. **DnD library swap** — only if motion chunk is still >500 kB after tree-shaking

---

## 6. Measurement

After each change, run:
```bash
bun run build
```

Check:
- Chunk sizes in terminal output
- `dist/bundle-analysis.html` (rollup-plugin-visualizer is already configured)
- Verify no new warnings
