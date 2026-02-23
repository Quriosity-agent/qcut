# win-7 Build Report

**Branch:** `win-7` (based on latest `master` @ `8660b92b`)
**Date:** 2026-02-23
**Result:** ✅ BUILD PASSED

## Build Steps
1. `turbo run build` → 1 task successful, 50s
2. `tsc` (electron) → passed
3. `esbuild preload.ts` → 27.7kb

## Warnings (non-fatal)

### 1. MODULE_TYPELESS_PACKAGE_JSON
- **File:** `apps/web/postcss.config.ts`
- **Issue:** Module type not specified, reparsed as ES module
- **Fix:** Add `"type": "module"` to `apps/web/package.json`

### 2. Dynamic/Static Import Conflicts (×8)
Vite reports modules that are both dynamically and statically imported, preventing chunk splitting:

| Module | Dynamic importers | Static importers |
|--------|------------------|-----------------|
| `playback-store.ts` | `sounds-store.ts` | 18 files |
| `image-edit-client.ts` | `segmentation/index.tsx`, `fal-ai-client-reve.ts` | 5 files |
| `fal-ai-client.ts` | `text2image-store.ts` | 7 files |
| `stickers-store.ts` | `timeline-drag-handlers.ts` | `stickers.tsx` |
| `media-store-loader.ts` | `timeline-store-operations.ts`, `timeline-store.ts` | 4 files |
| `project-store.ts` | 26+ dynamic importers | 30+ static importers |
| `timeline-store.ts` | 14 dynamic importers | 20+ static importers |
| `media-store.ts` | 11 dynamic importers | 7 static importers |

### 3. Large Chunks (>1000 kB)

| Chunk | Size | Gzip |
|-------|------|------|
| `index-D2ne_XqM.js` | 1,879 kB | 483 kB |
| `editor._project_id.lazy-Bm0IdWn3.js` | 1,979 kB | 505 kB |

**Recommendation:** Consider code-splitting via dynamic `import()` or `manualChunks` in Vite config.

## Errors
**None** — build completed successfully.

## Output
- Web: `dist/` (3888 modules transformed, 26.63s)
- Electron preload: `dist/electron/preload.js` (27.7kb, 58ms)
