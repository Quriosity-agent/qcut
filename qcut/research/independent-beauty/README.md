# Independent photo engine for QCut Beauty Lab

This directory is a versioned working-tree snapshot of `donghaozhang/qcut-beauty-standalone`, base commit `24d3dcf179d6c6871d1566725c341358661d98ca`. `source-manifest.json` records the exact imported bytes, source working-tree status, and explicit formatting, schema-hash and test-path adaptations. The generated `src/runtime.ts` replaces the standalone native-dependent root resolver; its hash is also checked. The upstream checkout continues to evolve independently.

The import includes 261 engine, planner, UI model and test files (1,211,533 bytes). It excludes models, captured portrait fixtures, native effect libraries, generated hosts, and rendered images. OpenCV SVD attribution remains under `research/vendor/LICENSE.opencv-svd.txt`.

## Runtime setup

Requires macOS, Xcode command-line tools, Bun, and Python 3.12 with the versions in `research/setup.sh`. Set up the environment with `sh research/independent-beauty/research/setup.sh`. Install the validated model and static-asset payload under `runtime/research`; this payload is not distributed in Git. Each renderer verifies its required assets and models. Missing payloads fail visibly; no native fallback runs.

For this machine's development validation, the ignored `runtime` and `research/.venv` symlinks refer to the existing standalone installation. New machines must provision their own runtime. Override paths with `QCUT_INDEPENDENT_BEAUTY_RUNTIME`, `QCUT_INDEPENDENT_BEAUTY_PYTHON`, and optionally `QCUT_INDEPENDENT_BEAUTY_BUN`.

Packaged builds run `beforePack`, verify source hashes, reject symlinks/private artifact paths and copy only the 262 pinned source files plus their manifest to generated `build/independent-beauty`. Electron Builder copies that curated directory to `resources/independent-beauty`; it does not include the research directory directly. The external runtime defaults to `<QCut userData>/PrivateRuntimes/IndependentBeauty/current` and Python to its `.venv/bin/python`. Bundling rules exclude models, environments, output, caches and compiled hosts. A signed arm64 directory build was produced and its 262 source pins and independent zero/composite rendering were verified with this machine’s external payload. A second unsigned directory package using the generated resource pipeline also rendered both real providers (maximum RGB difference 1 on the composite sample). The signed native host failed to resolve `@rpath/libAGFX.dylib`; packaged window startup and fresh-machine installation remain unverified.

## Interface and scope

Beauty Lab has separate **Render native** and **Render independent** actions. Native invokes the existing `jianyingPortraitAdjustment.render` runtime. Independent uses `beauty-lab:render-independent` and returns provider `qcut-independent-photo-v1`; it runs the canonical original-photo stage chain from this snapshot. The third **Audit hybrid candidate** action retains its separate research protocol and native dependencies.

Independent supports 32 numeric controls and 28 makeup cards, including multiple supported selections in one request. Current scope is a single opaque face photo, maximum edge 1280. Image imports are decoded once at maximum edge 640 for identical input to both providers. Video, per-person edits, manual retouch/body and selected skin-tone resources are not supported by this route. Unsupported active selections block the independent button and show a reason; native remains available.

Changing input or parameters invalidates both results. Rendering one path preserves the other result for the same input. Python and its subprocesses inherit bytecode-writing suppression so packaged source remains unchanged; the rebuilt unsigned package retained exactly its 262 pinned source files plus manifest after a real composite render. Cancel/close terminates independent child processes; stale and cancelled completions never publish pixels. Export contains original, native and independent PNGs, pairwise differences and provenance. Independent PNG bytes are preserved and checked against the receipt rather than re-encoded.

The adapter checks input shape, parameter bounds, provider/request/source identity, exact RGBA and PNG hashes, stage hash continuity, source manifest stability, and absence of native geometry/input/fallback flags. These checks establish execution provenance; they do not establish general native parity.

## Verification

```sh
mkdir -p research/independent-beauty/output
research/independent-beauty/research/.venv/bin/python -B -m unittest discover -s research/independent-beauty/research/tests -q
bun test ./research/independent-beauty/src ./research/independent-beauty/web
bunx vitest run electron/__tests__/beauty-lab-independent.test.ts electron/__tests__/beauty-lab-handler.test.ts apps/web/src/lib/portrait/__tests__/use-beauty-lab-independent.test.tsx apps/web/src/lib/portrait/__tests__/use-beauty-lab.test.tsx apps/web/src/lib/portrait/__tests__/use-beauty-lab-cancel.test.tsx apps/web/src/lib/portrait/__tests__/beauty-lab-export.test.ts apps/web/src/lib/portrait/__tests__/beauty-lab-catalog.test.ts apps/web/src/components/editor/properties-panel/__tests__/beauty-lab-results.test.tsx
bunx esbuild scripts/beauty-lab-photo-probe.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/electron-audits/beauty-lab-photo-probe.cjs
node dist/electron-audits/beauty-lab-photo-probe.cjs <photo> <new-output-directory>
```

Python: 486 passed without skips. Bun snapshot tests: 17 passed. QCut regression, matrix and sequence tests: 340 passed across 13 files (including 18 staging and 15 provenance checks). The expanded verification record is `docs/task/jianying-filter-runtime-research/beauty-kpop8-gap-expansion-2026-10-08.zh-CN.md`; the initial dual-path audit remains a historical record.

When changing imported code, update the manifest deliberately and preserve upstream identity and the adaptation reason. Do not bypass source verification to load an untracked renderer.

## Real-provider batch and sequence probes

`beauty-lab-matrix.ts` runs zero, every numeric positive/signed negative boundary, 28 makeup cards and cross-stage combinations against both genuine providers. The JSON configuration contains `maxEdge` (160–640) and `inputs`, each with unique `id`, `path`, `suite` (`full`, `stress`, `shape`), `synthetic` and `description`. Synthetic shape labels are hypotheses, not human ground truth.

```sh
bunx esbuild scripts/beauty-lab-matrix.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/electron-audits/beauty-lab-matrix.cjs
node dist/electron-audits/beauty-lab-matrix.cjs <configuration.json> <new-output-directory>
# Resume requires identical configuration, source pins, parameters, decoded pixels and recomputed metrics.
node dist/electron-audits/beauty-lab-matrix.cjs <configuration.json> <existing-output-directory> --resume
bunx esbuild scripts/beauty-lab-sequence-probe.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/electron-audits/beauty-lab-sequence-probe.cjs
node dist/electron-audits/beauty-lab-sequence-probe.cjs <numbered-PNG-directory> <new-output-directory> <fps>
```

Use Node 25 for these probes: the native provider requires `node:sqlite`, unavailable in the tested Bun 1.3.9 runtime. Bun still executes the imported planner.

The bounded sequence API processes at most 300 frames with output acknowledgement, strict dimensions/timestamps and cancellation. It is a research utility and is not wired into QCut timeline/export or the independent photo UI. It does not validate tracking or temporal parity.

Current evidence: 124 paired photo renders, 105 within maximum RGB difference 1, 19 residual cases and zero render failures. All 28 single makeup cases passed that bound on one full-suite portrait. A 24-frame real-video sequence completed, maximum RGB difference 9 and mean per-frame RGB MAE 0.0627358. These are scoped sample results, not general product parity.
