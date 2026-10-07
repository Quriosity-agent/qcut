# Independent photo engine for QCut Beauty Lab

This directory is a versioned working-tree snapshot of `donghaozhang/qcut-beauty-standalone`, base commit `c81c840a2f8d2882055c018acc83bdb0b3649ed6`. `source-manifest.json` records the exact imported bytes, source working-tree status, and two local adaptations in a test file. The generated `src/runtime.ts` replaces the standalone native-dependent root resolver; its hash is also checked. The upstream checkout continues to evolve independently.

The import includes 246 engine, planner, UI model and test files (1,125,824 bytes). It excludes models, captured portrait fixtures, native effect libraries, generated hosts, and rendered images. OpenCV SVD attribution remains under `research/vendor/LICENSE.opencv-svd.txt`.

## Runtime setup

Requires macOS, Xcode command-line tools, Bun, and Python 3.12 with the versions in `research/setup.sh`. Set up the environment with `sh research/independent-beauty/research/setup.sh`. Install the validated model and static-asset payload under `runtime/research`; this payload is not distributed in Git. Each renderer verifies its required assets and models. Missing payloads fail visibly; no native fallback runs.

For this machine's development validation, the ignored `runtime` and `research/.venv` symlinks refer to the existing standalone installation. New machines must provision their own runtime. Override paths with `QCUT_INDEPENDENT_BEAUTY_RUNTIME`, `QCUT_INDEPENDENT_BEAUTY_PYTHON`, and optionally `QCUT_INDEPENDENT_BEAUTY_BUN`.

Packaged builds copy the source tree to `resources/independent-beauty`. The external runtime defaults to `<QCut userData>/PrivateRuntimes/IndependentBeauty/current` and Python to its `.venv/bin/python`. Bundling rules exclude models, environments, output, caches and compiled hosts. Package installation has not been validated in this change.

## Interface and scope

Beauty Lab has separate **Render native** and **Render independent** actions. Native invokes the existing `jianyingPortraitAdjustment.render` runtime. Independent uses `beauty-lab:render-independent` and returns provider `qcut-independent-photo-v1`; it runs the canonical original-photo stage chain from this snapshot. The third **Audit hybrid candidate** action retains its separate research protocol and native dependencies.

Independent supports 30 numeric controls and 28 makeup cards, including multiple supported selections in one request. Current scope is a single opaque face photo, maximum edge 1280. Image imports are decoded once at maximum edge 640 for identical input to both providers. Video, per-person edits, manual retouch/body and selected skin-tone resources are not supported by this route. Unsupported active selections block the independent button and show a reason; native remains available.

Changing input or parameters invalidates both results. Rendering one path preserves the other result for the same input. Cancel/close terminates independent child processes; stale and cancelled completions never publish pixels. Export contains original, native and independent PNGs, pairwise differences and provenance. Independent PNG bytes are preserved and checked against the receipt rather than re-encoded.

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

Python: 436 tests, 435 passed and one explicit skip for a historical portrait geometry fixture not distributed with the engine. Bun snapshot tests: 12 passed. QCut regression tests: 274 passed. Integration tests, real-provider reports and desktop export evidence are detailed in `docs/task/jianying-filter-runtime-research/beauty-kpop8-independent-reuse-audit-2026-10-07.zh-CN.md`.

When changing imported code, update the manifest deliberately and preserve upstream identity and the adaptation reason. Do not bypass source verification to load an untracked renderer.
