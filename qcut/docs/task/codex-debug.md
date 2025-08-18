# Codex Debug Plan — Sticker Export Capture

This guide adds precise, low-noise instrumentation to prove whether stickers affect captured pixels during CLI export and to isolate canvas capture issues.

## Objective
- Prove on the same frame that sticker drawing changes captured PNG data.
- Verify capture uses the same canvas that rendering uses.
- Eliminate timing/flush issues before `toDataURL()`.

## Quick Checklist
- Add pre/post capture hash on the same frame.
- Verify canvas identity, size, and context before capture.
- Force a render flush and await a tick before capturing.
- Probe a few known pixels under stickers pre/post.
- Optionally snapshot pre/post PNGs for a single frame.

## Where To Edit
- `qcut/apps/web/src/…/export-engine-cli.ts` (or your export engine): inside `saveFrameToDisk()` near capture (around lines 506–544 mentioned in STICKER_EXPORT_DEBUG.md).
- `renderStickersToCanvas()` and `renderStickerElementCLI()` are the sticker draw sites.
- `sticker-export-helper.ts` (around line 41) had time filtering changes; keep it as-is while you instrument capture.
- `media-store.ts` (around 362–365) handles SVG data URLs; keep this fix intact.
- `debug-config.ts` controls debug mode; ensure it’s on while testing.

Tip: Match existing log style to keep logs coherent: use `[CLI_STICKER_DEBUG]`, `[STICKER_DRAW]`, and prefix capture lines with `🚨`/`🔧`.

## Minimal Instrumentation (TypeScript)
Paste into the CLI export path where a single frame is rendered and saved (e.g., `saveFrameToDisk(frame)` in `export-engine-cli.ts`). Names may differ — adapt to your engine's entry points (`renderStickersToCanvas`, `renderStickerElementCLI`, etc.). Use your existing `debugLog()` helper if present.

```ts
// --- Debug toggles ---
const DEBUG_STICKER_CAPTURE = true;
const DEBUG_SNAPSHOT_FRAME = 0; // write pre/post PNGs only for this frame

// Compute a short hash directly from the data URL header+prefix
function pngHash(dataUrl: string): string {
  // strip 'data:image/png;base64,' and take first 50 chars for log
  return dataUrl.slice(22, 72);
}

function probePixels(ctx: CanvasRenderingContext2D, points: Array<[number, number]>) {
  return points.map(([x, y]) => ({ x, y, rgba: Array.from(ctx.getImageData(x, y, 1, 1).data) }));
}

async function flushAndYield(ctx: CanvasRenderingContext2D) {
  // Touch pixels to flush pending ops in some runtimes
  ctx.getImageData(0, 0, 1, 1);
  // Prefer rAF in browser/offscreen; fallback to microtask in Node
  await new Promise<void>(resolve => {
    try {
      // @ts-ignore
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else Promise.resolve().then(() => resolve());
    } catch {
      Promise.resolve().then(() => resolve());
    }
  });
}

function sameCanvasDiagnostics(captureCanvas: HTMLCanvasElement | OffscreenCanvas) {
  // If your render path uses a different reference (e.g., this.renderCanvas), compare them here
  try {
    // @ts-ignore - adapt if your code stores a separate render canvas
    const renderCanvas = (typeof this !== 'undefined' && (this as any).canvas) || captureCanvas;
    const sameRef = renderCanvas === captureCanvas;
    const cAny: any = captureCanvas as any;
    const w = (cAny.width ?? 0), h = (cAny.height ?? 0);
    const ctx = (cAny.getContext ? cAny.getContext('2d') : undefined) as CanvasRenderingContext2D | undefined;
    const ctxOk = !!ctx && typeof ctx.drawImage === 'function';
    debugLog(`[CAPTURE] CANVAS_REF same:${sameRef} size:${w}x${h} ctx2d:${ctxOk}`);
  } catch (e) {
    debugLog(`[CAPTURE] CANVAS_REF error: ${String(e)}`);
  }
}

async function saveFrameWithStickerDebug(
  frameIndex: number,
  timeMs: number,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D,
  renderStickersForFrame: (tMs: number) => Promise<void> | void,
  writePng: (fileName: string, dataUrl: string) => Promise<void> | void,
) {
  if (!DEBUG_STICKER_CAPTURE) {
    // Normal path (no extra logging)
    await renderStickersForFrame(timeMs);
    await flushAndYield(ctx);
    const png = (canvas as any).toDataURL ? (canvas as any).toDataURL('image/png', 1.0) : '';
    await writePng(`frame-${String(frameIndex).padStart(4, '0')}.png`, png);
    return;
  }

  sameCanvasDiagnostics(canvas);

  // Pick a couple of points likely covered by stickers (adapt as needed)
  const samplePoints: Array<[number, number]> = [
    [16, 16], [32, 32], [64, 64], [128, 128]
  ];

  // PRE: hash + pixels BEFORE drawing stickers
  const prePixels = probePixels(ctx, samplePoints);
  const preUrl = (canvas as any).toDataURL('image/png', 1.0);
  const preHash = pngHash(preUrl);
  debugLog(`🔧 PRE_STICKER f=${frameIndex} t=${timeMs} hash=${preHash} px=${JSON.stringify(prePixels)}`);

  // Draw stickers for this frame
  await renderStickersForFrame(timeMs);

  // Flush and yield before capture
  await flushAndYield(ctx);

  // POST: hash + pixels AFTER drawing stickers
  const postPixels = probePixels(ctx, samplePoints);
  const postUrl = (canvas as any).toDataURL('image/png', 1.0);
  const postHash = pngHash(postUrl);
  const impact = preHash !== postHash;
  const pixelsChanged = JSON.stringify(prePixels) !== JSON.stringify(postPixels);
  debugLog(`🔧 POST_STICKER f=${frameIndex} t=${timeMs} hash=${postHash} px=${JSON.stringify(postPixels)}`);
  debugLog(`🔧 STICKER_IMPACT f=${frameIndex} hashChanged=${impact} pixelsChanged=${pixelsChanged}`);

  // Optional: one-frame snapshot to disk for visual diff
  if (frameIndex === DEBUG_SNAPSHOT_FRAME) {
    try {
      await writePng(`pre-sticker-f${String(frameIndex).padStart(4, '0')}.png`, preUrl);
      await writePng(`post-sticker-f${String(frameIndex).padStart(4, '0')}.png`, postUrl);
      debugLog(`🔧 SNAPSHOT wrote pre/post PNGs for frame ${frameIndex}`);
    } catch (e) {
      debugLog(`🔧 SNAPSHOT error: ${String(e)}`);
    }
  }

  // Write the post-sticker frame as the export artifact
  await writePng(`frame-${String(frameIndex).padStart(4, '0')}.png`, postUrl);
}
```

### Example integration
Wire the helper where you already render and save frames. This example shows how to adapt existing methods without changing your architecture.

```ts
// Pseudocode from export-engine-cli.ts
async function saveFrameToDisk(frame: number, tMs: number) {
  const canvas = this.canvas; // the canvas used for rendering frames
  const ctx = canvas.getContext('2d')!;

  // Your engine-specific sticker renderer for a frame
  const renderStickersForFrame = async (timeMs: number) => {
    // Existing: your draw/compose routines
    // e.g., await this.renderStickersToCanvas(timeMs);
    // or iterate this.elements and call renderStickerElementCLI(...)
    await this.renderStickersToCanvas(timeMs);
  };

  const writePng = async (fileName: string, dataUrl: string) => {
    // Convert data URL -> Buffer and write using Node fs
    const base64 = dataUrl.split(',')[1];
    const buf = Buffer.from(base64, 'base64');
    await fs.promises.writeFile(path.join(this.framesOutDir, fileName), buf);
  };

  await saveFrameWithStickerDebug(
    frame,
    tMs,
    canvas,
    ctx,
    renderStickersForFrame,
    writePng,
  );

  // Optional: keep legacy single-line frame log for continuity
  const hasStickers = true; // or derive from your sticker query for this frame
  const postDataUrl = (canvas as any).toDataURL('image/png', 1.0);
  const postHash = pngHash(postDataUrl);
  debugLog(`🚨 FRAME ${frame}: Canvas has stickers: ${hasStickers}, Data hash: ${postHash}`);
}
```

## Diagnosing Results
- Same-frame change (pass):
  - `STICKER_IMPACT hashChanged=true` AND/OR `pixelsChanged=true`.
  - Stickers are affecting captured pixels — continue validating per-frame variation across timeline.
- Same-frame no change (fail):
  - Hash and sampled pixels identical → capture path not seeing sticker draws.
  - Check wrong-canvas usage, z-order/clear, global alpha, or draw done to a different context.
- Per-frame no variation:
  - If same-frame passes but cross-frame hashes are identical, your content may be static — verify animation/position/time filters.

## If Capture Is Still Flat
- Wrong canvas: ensure the canvas passed to `toDataURL()` is the same one the sticker renderer draws to. Log and compare references.
- Timing: ensure draw happens before capture. Keep `flushAndYield()` right before capture.
- Clear/overdraw: confirm a clear/compose step isn’t overwriting stickers before capture.
- API path: in Node-canvas, compare `toDataURL('image/png')` vs `toBuffer('image/png')`. In OffscreenCanvas, try `convertToBlob()` and encode via `Buffer`.

Example (Node-canvas):
```ts
const buf = (canvas as any).toBuffer?.('image/png');
if (buf) {
  await fs.promises.writeFile(path.join(this.framesOutDir, `frame-${String(frameIndex).padStart(4,'0')}.png`), buf);
}
```

## One-Frame Visual Truth
For `frame === 0` (or your chosen `DEBUG_SNAPSHOT_FRAME`), open `pre-sticker-*.png` and `post-sticker-*.png` to visually confirm sticker presence. This grounds logs in something human-verifiable.

## Success Criteria
- Pre vs post hash differs on the same frame, and sampled pixels differ under sticker regions.
- Per-frame hashes vary when stickers move/change over time.
- Exported video visibly contains stickers.

## Clean Up
- Remove the debug helper and console logs once verified.
- Keep a tiny `flushAndYield()` near capture if your runtime benefits from it.
