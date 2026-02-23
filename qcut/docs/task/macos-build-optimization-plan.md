# macOS Release Build Optimization Plan

> **Current state:** macOS build takes **39.7 minutes** (36.5 min in `electron-builder` alone)
> Windows: 8.2 min, Linux: 11.2 min — macOS is **4.8× slower** than Windows.

---

## 1. Root Cause Analysis

| # | Cause | Est. Impact | Evidence |
|---|-------|------------|----------|
| 1 | **`compression: "maximum"` (global default)** | ~25-30 min | Windows overrides to `"store"` and builds in 8.2 min. macOS/Linux inherit `"maximum"` which uses LZMA with highest dictionary size. This is the dominant factor. |
| 2 | **DMG creation** | ~3-5 min | DMG involves copying the app bundle, creating a disk image, and compressing it. Done in addition to ZIP. |
| 3 | **Dual targets (DMG + ZIP)** | ~2-3 min | Each target packages the full app independently. |
| 4 | **Large `asarUnpack` surface** | ~1-2 min | 6 glob patterns unpack sharp, ffmpeg, electron-updater, electron-log, generative-ai, node-pty — all extracted outside asar, increasing total file count to compress. |
| 5 | **`extraResources` duplication** | ~0.5-1 min | `node-pty` and `@google/generative-ai` appear in both `files` (bundled in asar) AND `extraResources` (copied separately). Double the work. |
| 6 | **No electron-builder cache** | ~0.5 min | Electron binary is re-downloaded each CI run. |

### Why Windows is fast
Windows config has `"compression": "store"` — this skips all LZMA compression entirely. The NSIS installer does its own lightweight compression. This single setting accounts for the vast majority of the speed difference.

---

## 2. Quick Wins (Immediate, Low Risk)

### 2.1 ⭐ Set macOS compression to `"store"` or `"normal"`
**Expected savings: 25-30 minutes** (the big one)

```jsonc
// package.json — build.mac
"mac": {
  "compression": "store",  // or "normal" for ~50% smaller at ~5 min cost
  // ... rest unchanged
}
```

**Why it's safe:** The ZIP target is used for auto-updates (`latest-mac.yml` points to the ZIP). `"store"` means no compression inside the app bundle/ZIP, but:
- DMG has its own compression layer (UDZO/UDBZ) applied separately
- ZIP download size increases ~2-3× but macOS apps are typically 150-300 MB — acceptable
- `"normal"` (deflate) is a good middle ground: ~2× faster than `"maximum"`, only ~10-15% larger

**Recommendation:** Start with `"normal"`, benchmark, then consider `"store"` if still slow.

### 2.2 Cache Electron binary download
**Expected savings: 30-60 seconds**

```yaml
# In build-macos job, add before "Build Electron application":
- name: Cache Electron binary
  uses: actions/cache@v4
  with:
    path: ~/Library/Caches/electron
    key: electron-${{ runner.os }}-${{ hashFiles('node_modules/electron/package.json') }}
```

### 2.3 Remove duplicate `node-pty` and `@google/generative-ai` from `extraResources`
**Expected savings: 30-60 seconds**

These modules are already in `files` (bundled into asar) AND in `asarUnpack` (extracted from asar). Having them also in `extraResources` means they're copied a third time.

**Action:** Remove these two entries from `extraResources` if the app reads them from `node_modules` inside the app bundle (check `app.getPath('exe')` vs `process.resourcesPath` usage in code). If they must be in `extraResources`, remove them from `files`/`asarUnpack`.

---

## 3. Medium-Term Optimizations

### 3.1 Build only ZIP, generate DMG separately (or drop DMG)
**Expected savings: 3-5 minutes**

Auto-updater only uses ZIP. DMG is for manual download only. Options:
1. **Drop DMG entirely** — users download ZIP, double-click to mount
2. **Build DMG with `hdiutil` post-build** — faster than electron-builder's DMG creation

```jsonc
// Option 1: ZIP only
"mac": {
  "target": [{ "target": "zip", "arch": ["arm64"] }]
}
```

```yaml
# Option 2: Build DMG manually after electron-builder
- name: Build Electron application
  run: npx electron-builder --mac --publish never -c.mac.target=zip -c.publish.channel=${{ needs.prepare.outputs.channel }}

- name: Create DMG from app bundle
  run: |
    APP_PATH=$(find dist-electron/mac-arm64 -name "*.app" -maxdepth 1)
    hdiutil create -volname "QCut" -srcfolder "$APP_PATH" -ov -format UDZO dist-electron/QCut.dmg
```

### 3.2 Reduce `asarUnpack` surface
**Expected savings: 1-2 minutes**

Review which modules actually need unpacking. Common reasons to unpack:
- Native binaries (sharp, node-pty) — **must unpack**
- Pure JS modules (electron-log, @google/generative-ai) — **should NOT need unpacking**

```jsonc
// Tighter asarUnpack — remove pure-JS modules
"asarUnpack": [
  "**/node_modules/sharp/**/*",
  "**/node_modules/node-pty/**/*"
  // Remove: electron-updater, electron-log, @google/generative-ai, @ffmpeg
  // Test if @ffmpeg has native binaries — if so, keep it
]
```

### 3.3 Use `macos-14` (M1) runner explicitly
**Expected savings: variable (possibly 2-5 minutes)**

`macos-latest` currently maps to `macos-14` (Apple Silicon), but being explicit ensures you get ARM runners which are faster for arm64 builds (no Rosetta overhead).

```yaml
runs-on: macos-14  # Explicitly use Apple Silicon runner
```

### 3.4 Add timing instrumentation to CI
```yaml
- name: Build Electron application
  run: |
    echo "::group::Electron Builder"
    time npx electron-builder --mac --publish never -c.publish.channel=${{ needs.prepare.outputs.channel }}
    echo "::endgroup::"
    ls -lah dist-electron/
```

---

## 4. Long-Term Architectural Improvements

### 4.1 Ship platform-specific native modules via download-on-first-run
Instead of bundling sharp, ffmpeg, node-pty in the app:
- Ship a minimal app bundle
- Download native binaries on first launch (like VS Code does with ripgrep)
- Dramatically reduces app size and build time

### 4.2 Move to `@electron/forge` with makers
electron-forge's maker system is more modular and can be faster for specific targets. However, migration cost is high — only worth it if electron-builder continues to be a bottleneck.

### 4.3 Split the monorepo build
If the web app build (`bun run build`) is deterministic, cache its output:
```yaml
- name: Cache web build
  uses: actions/cache@v4
  with:
    path: apps/web/dist
    key: web-build-${{ hashFiles('apps/web/src/**', 'apps/web/package.json') }}

- name: Build web application
  if: steps.web-cache.outputs.cache-hit != 'true'
  run: bun run build
```

### 4.4 Consider universal binary later
If x64 Mac support is ever needed, use `--arch universal` rather than running two separate builds. But arm64-only is correct for now.

---

## 5. Benchmarking Strategy

### 5.1 Baseline measurement
Create a workflow dispatch for benchmarking without creating releases:

```yaml
# .github/workflows/bench-macos-build.yml
name: Benchmark macOS Build
on: workflow_dispatch
jobs:
  bench:
    runs-on: macos-14
    steps:
      # ... setup steps ...
      - name: Build with timing
        run: |
          START=$(date +%s)
          npx electron-builder --mac --publish never
          END=$(date +%s)
          echo "⏱️ Build took $((END-START)) seconds"
          ls -lah dist-electron/
```

### 5.2 Comparison matrix
Run the benchmark with different compression settings:

| Setting | Expected Time | Expected ZIP Size |
|---------|--------------|-------------------|
| `"maximum"` (current) | ~36 min | baseline |
| `"normal"` | ~8-12 min | +10-15% |
| `"store"` | ~3-5 min | +100-200% |

### 5.3 Track over time
Add build duration to release notes or a `build-metrics.json` artifact.

---

## 6. Implementation Steps

### Phase 1: Compression fix (PR #1) — Expected: 36 min → ~10 min

1. **Edit `package.json`:**
   ```diff
    "mac": {
   +  "compression": "normal",
      "category": "public.app-category.video",
   ```

2. **Add Electron cache to `release.yml`** (macOS job):
   ```yaml
   - name: Cache Electron binary
     uses: actions/cache@v4
     with:
       path: ~/Library/Caches/electron
       key: electron-${{ runner.os }}-${{ hashFiles('node_modules/electron/package.json') }}
   ```

3. **Add build timing:**
   ```yaml
   - name: Build Electron application
     run: |
       time npx electron-builder --mac --publish never -c.publish.channel=${{ needs.prepare.outputs.channel }}
       ls -lah dist-electron/
   ```

4. Tag a pre-release, measure results.

### Phase 2: Cleanup (PR #2) — Expected: ~10 min → ~8 min

1. Remove duplicate `extraResources` entries (node-pty, generative-ai)
2. Trim `asarUnpack` to only native modules
3. Test app functionality thoroughly

### Phase 3: Target optimization (PR #3) — Expected: ~8 min → ~6 min

1. Consider ZIP-only target (drop DMG or build it separately)
2. If keeping DMG, use `hdiutil` directly

### Phase 4: Global compression default (PR #4)

1. Change global `"compression": "maximum"` to `"compression": "normal"`
2. This also speeds up Linux builds (~11 min → ~6-7 min)
3. Keep Windows at `"store"` (already fast)

---

## Summary

| Phase | Change | Time Saved | New Total |
|-------|--------|-----------|-----------|
| Current | — | — | ~40 min |
| Phase 1 | `compression: "normal"` + caching | ~27 min | ~13 min |
| Phase 2 | Remove duplicates, trim asarUnpack | ~2 min | ~11 min |
| Phase 3 | ZIP-only or separate DMG | ~3 min | ~8 min |
| Phase 4 | Global compression default | (Linux benefit) | ~8 min |

**Bottom line:** Changing one line (`compression: "normal"`) should cut macOS build time from ~40 minutes to ~13 minutes. Everything else is incremental.
