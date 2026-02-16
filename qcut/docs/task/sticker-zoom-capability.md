# Sticker Zoom/Scale Capability Analysis

## Can We Zoom Stickers? YES

Stickers have full zoom/scale/resize capabilities in QCut.

---

## How Stickers Are Sized

- **Storage format**: Percentage of canvas (0-100%)
- **Default size**: 8% x 8% (`stickers-overlay-store.ts:24`)
- **Minimum**: 5% of canvas
- **Maximum**: 100% of canvas
- **Constraints enforced**: `stickers-overlay-store.ts:266-274`

## Resize Controls

### Interactive Handles (`ResizeHandles.tsx`)

**Corner handles (4):** top-left, top-right, bottom-left, bottom-right
- Allow diagonal resizing with aspect ratio preservation by default
- Hold **Shift** to override aspect ratio for free-form resize

**Edge handles (4):** top, bottom, left, right
- Single-axis resizing
- Only visible when sticker > 15% width AND > 15% height

| Capability | Supported | Details |
|-----------|-----------|---------|
| Free resize | Yes | All 8 handles |
| Proportional resize | Yes | Default for corners, toggle with Shift |
| Non-proportional resize | Yes | Shift+drag overrides aspect ratio |
| Edge handles | Conditional | Visible when sticker > 15% x 15% |
| Boundary constraints | Yes | Min 5%, Max 100%, stays within canvas |
| Real-time feedback | Yes | `requestAnimationFrame` for smooth updates |
| Minimum size | 5% x 5% | Hard constraint |
| Maximum size | 100% x 100% | Hard constraint |

## How Stickers Render in Editor

### StickerCanvas (`StickerCanvas.tsx`)
- Container at z-index 50, absolute positioned over video preview
- Handles drag-and-drop, keyboard shortcuts (Delete, Escape, Undo/Redo)

### StickerElement (`StickerElement.tsx`)
- **Image stickers**: `<img>` with `object-contain`
- **Video stickers**: `<video>` with autoPlay, loop, muted
- **Transform**: `translate(-50%, -50%) rotate(${rotation}deg)` — centers at position point
- **Selection**: z-index 9999 when selected, otherwise uses sticker's zIndex

### ResizeHandles (`ResizeHandles.tsx`)
- White circles (corners) and bars (edges) with hover scale effect
- z-index 10000 to stay above sticker content
- Cursor changes per handle direction

## Export Pipeline (Percentage → Pixels)

### Conversion (`sticker-sources.ts:191-200`)
```typescript
const baseSize = Math.min(canvasWidth, canvasHeight);
const pixelX = (sticker.position.x / 100) * canvasWidth;
const pixelY = (sticker.position.y / 100) * canvasHeight;
const pixelWidth = (sticker.size.width / 100) * baseSize;
const pixelHeight = (sticker.size.height / 100) * baseSize;

// Center → top-left adjustment
const topLeftX = pixelX - pixelWidth / 2;
const topLeftY = pixelY - pixelHeight / 2;
```

### FFmpeg Filters Applied (`sticker-overlay.ts:52-86`)
1. `scale=${width}:${height}` — resize to pixel dimensions
2. `rotate=${rotation}*PI/180:c=none` — if rotation != 0
3. `format=rgba,geq` — if opacity < 1
4. `overlay=x:y:enable='between(t,start,end)'` — position and timing

## Data Model

```typescript
// OverlaySticker (store)
{
  id: string;
  mediaItemId: string;
  position: { x: number; y: number };       // % (0-100)
  size: { width: number; height: number };   // % (0-100)
  rotation: number;                          // degrees (0-360)
  opacity: number;                           // 0-1
  zIndex: number;
  maintainAspectRatio: boolean;
  timing?: { startTime?: number; endTime?: number };
}

// StickerSource (FFmpeg export)
{
  id: string;
  path: string;
  x: number; y: number;           // pixels (top-left)
  width: number; height: number;  // pixels
  startTime: number; endTime: number;
  zIndex: number;
  opacity?: number;
  rotation?: number;
}
```

## What's NOT Supported

- **No camera/viewport zoom**: Stickers scale with video preview container naturally, but there's no independent zoom layer
- **No stretch/skew**: Only proportional transforms (scale, rotate, opacity)
- **No pinch-to-zoom**: Desktop-only resize via drag handles

## Key Files

| Area | File | Key Lines |
|------|------|-----------|
| Size constraints | `stickers-overlay-store.ts` | 266-274 |
| Default size | `stickers-overlay-store.ts` | 24 |
| Aspect ratio logic | `ResizeHandles.tsx` | 99-122 |
| Resize calculation | `ResizeHandles.tsx` | 44-131 |
| Element positioning | `StickerElement.tsx` | 110-121 |
| % → pixel conversion | `sticker-sources.ts` | 191-200 |
| FFmpeg scale/rotate | `sticker-overlay.ts` | 52-86 |
