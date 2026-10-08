# Independent photo engine for QCut Beauty Lab

This directory is a versioned working-tree snapshot of `donghaozhang/qcut-beauty-standalone`, base commit `24d3dcf179d6c6871d1566725c341358661d98ca`. `source-manifest.json` records the exact imported bytes, source working-tree status, and explicit formatting, schema-hash and test-path adaptations. The generated `src/runtime.ts` replaces the standalone native-dependent root resolver; its hash is also checked. The upstream checkout continues to evolve independently.

The import includes 261 engine, planner, UI model and test files (1,211,533 bytes). It excludes models, captured portrait fixtures, native effect libraries, generated hosts, and rendered images. OpenCV SVD attribution remains under `research/vendor/LICENSE.opencv-svd.txt`.

## Runtime setup

Requires macOS, Xcode tools with Swift and a working Metal device, Bun, and Python 3.12 with the versions in `research/setup.sh`. For development, set up the environment with `sh research/independent-beauty/research/setup.sh`. The local-only model/static payload is not distributed in Git. The independent provider verifies the source-bound external payload profile before reporting available or dispatching a render: 358 files, 68,134,182 bytes across research models/assets, effect packages and two model-weight files. The profile contains relative paths, sizes and SHA-256 fingerprints. Native Frameworks are not required. Missing or modified files fail before rendering, without native fallback. Renderers retain their semantic/model checks.

Readiness also executes Python package/version checks and real CPU ONNX inference, Bun, Swift, and Metal runtime shader compilation. An offline `metal` executable is not required by this pipeline. Probes have bounded execution time and rendering cancellation reaches the probes. This checks the environment's ability to run; photo parity still requires a real render.

`bun scripts/install-independent-beauty-runtime.ts <local payload> <engine source root> <new installation directory> <absolute Python 3.12 executable> <absolute uv executable> <absolute Bun executable>` copies only profile files, creates a fresh venv at its final path, installs the direct pinned dependencies, checks capabilities and writes an installation receipt. It refuses any existing installation or link, preserves source assets, and removes only its new directory after failure. A new packaged installation can use `<QCut userData>/PrivateRuntimes/IndependentBeauty/current`; upgrading an existing installation requires a different destination and explicit runtime/Python overrides. No assets are fetched or uploaded. Python packages come from the configured registry/cache; base Python, uv, Bun and Xcode must already be installed. See [fresh-directory installation evidence](../../docs/task/jianying-filter-runtime-research/beauty-kpop8-fresh-runtime-2026-10-08.zh-CN.md) for commands and limitations.

For this machine's development validation, the ignored `runtime` and `research/.venv` symlinks refer to the existing standalone installation. New machines must provision their own runtime. Override paths with `QCUT_INDEPENDENT_BEAUTY_RUNTIME`, `QCUT_INDEPENDENT_BEAUTY_PYTHON`, and optionally `QCUT_INDEPENDENT_BEAUTY_BUN`.

Packaged builds run `beforePack`, verify source hashes, reject symlinks/private artifact paths and copy only the 262 pinned source files plus their manifest to generated `build/independent-beauty`. Electron Builder copies that curated directory to `resources/independent-beauty`; it does not include the research directory directly. The external runtime defaults to `<QCut userData>/PrivateRuntimes/IndependentBeauty/current` and Python to its `.venv/bin/python`. Bundling rules exclude models, environments, output, caches and compiled hosts. A signed arm64 directory build was produced and its 262 source pins and independent zero/composite rendering were verified with this machine’s external payload. A second unsigned directory package using the generated resource pipeline also rendered both real providers (maximum RGB difference 1 on the composite sample). The initial signed native host failed to resolve `@rpath/libAGFX.dylib`. The subsequent signed package adds an executable-relative RPATH and a verified cache of identical signed host bytes beside an external Frameworks link. Both actual packaged providers rendered all 24 stress cases on four real portraits automatically, without a host override: 23 met the maximum RGB difference 1 bound, one retained a difference of 18. The app seal, cached host signature, all 262 source pins and exact 263 resource files remained intact after rendering. A subsequent signed package fixes a missing production PNG-codec dependency (`pdf-lib`) and was verified through actual window startup, editor photo import, native/independent composite rendering and the UI-exported comparison ZIP. On that single 240×320 portrait, whitening 45, total-face 35, nose 25 and coral-nude lip 40 changed 41,510 pixels relative to the input; native versus independent differed on 31 pixels with maximum RGB difference 1. All 262 source pins, the exact 263 resource files and the strict app signature remained valid. This used a manually linked existing external payload; fresh-machine installation and notarization remain unverified. See `docs/task/jianying-filter-runtime-research/beauty-kpop8-packaged-ui-2026-10-08.zh-CN.md`. See `docs/task/jianying-filter-runtime-research/beauty-kpop8-signed-host-2026-10-08.zh-CN.md`.

A read-only payload CLI is available:

```sh
bun scripts/verify-independent-beauty-runtime.ts <external-runtime> research/independent-beauty
```

It prints the verified profile, file/byte counts and duration, exits nonzero on missing/corrupt payloads, and explicitly does not claim pixels or Python-environment verification. The profile deliberately omits generated hosts, experimental assets and native effect libraries. See `docs/task/jianying-filter-runtime-research/beauty-kpop8-runtime-preflight-2026-10-08.zh-CN.md` for real incomplete/corrupt installation checks and the independent-only runtime render.

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
# Resume requires identical execution identity, configuration, source pins, parameters, pixels and recomputed metrics.
node dist/electron-audits/beauty-lab-matrix.cjs <configuration.json> <existing-output-directory> --resume
bunx esbuild scripts/beauty-lab-sequence-probe.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/electron-audits/beauty-lab-sequence-probe.cjs
node dist/electron-audits/beauty-lab-sequence-probe.cjs <numbered-PNG-directory> <new-output-directory> <fps>
```

Use Node 25 for these probes: the native provider requires `node:sqlite`, unavailable in the tested Bun 1.3.9 runtime. Bun still executes the imported planner.

The bounded sequence API processes at most 300 frames with output acknowledgement, strict dimensions/timestamps and cancellation. It is a research utility and is not wired into QCut timeline/export or the independent photo UI. It does not validate tracking or temporal parity.

Current evidence: 124 paired photo renders, 105 within maximum RGB difference 1, 19 residual cases and zero render failures. All 28 single makeup cases passed that bound on one full-suite portrait. A 24-frame real-video sequence completed, maximum RGB difference 9 and mean per-frame RGB MAE 0.0627358. These are scoped sample results, not general product parity.

## Signed package audit

Run the same matrix with `--packaged-app <app>` inside that app's `Contents/MacOS/QCut AI Video Editor` executable with `ELECTRON_RUN_AS_NODE=1`. Set absolute `QCUT_INDEPENDENT_BEAUTY_RUNTIME` and `QCUT_INDEPENDENT_BEAUTY_PYTHON` paths and remove `QCUT_JIANYING_PORTRAIT_ADJUSTMENT_HOST`. The audit rejects host overrides and a different process executable, loads both providers from that ASAR, and binds resume to archive/executable/host hashes. This checks actual packaged modules with local external payloads; it does not attest signatures, notarization or UI by itself. Verify signatures separately using `codesign --verify --deep --strict` before and after rendering.
