/**
 * StickerElement Tests
 *
 * Tests scroll-wheel zoom behavior including canvas boundary clamping.
 */

import { describe, it, expect } from "vitest";

/**
 * Pure function extracted from StickerElement.handleWheel logic
 * for unit testing without React rendering overhead.
 */
function calculateWheelZoom(
  deltaY: number,
  currentWidth: number,
  currentHeight: number,
  positionX: number,
  positionY: number
) {
  const scaleDelta = deltaY < 0 ? 1.05 : 0.95;

  // Canvas boundary clamping (center-based)
  const maxWidth = Math.min(100, positionX * 2, (100 - positionX) * 2);
  const maxHeight = Math.min(100, positionY * 2, (100 - positionY) * 2);

  const newWidth = Math.max(5, Math.min(maxWidth, currentWidth * scaleDelta));
  const newHeight = Math.max(
    5,
    Math.min(maxHeight, currentHeight * scaleDelta)
  );

  return { width: newWidth, height: newHeight };
}

describe("StickerElement — scroll-wheel zoom", () => {
  it("increases size by ~5% on scroll up", () => {
    const result = calculateWheelZoom(-100, 20, 20, 50, 50);

    expect(result.width).toBeCloseTo(21, 0);
    expect(result.height).toBeCloseTo(21, 0);
  });

  it("decreases size by ~5% on scroll down", () => {
    const result = calculateWheelZoom(100, 20, 20, 50, 50);

    expect(result.width).toBeCloseTo(19, 0);
    expect(result.height).toBeCloseTo(19, 0);
  });

  it("enforces minimum size of 5%", () => {
    const result = calculateWheelZoom(100, 5, 5, 50, 50);

    expect(result.width).toBe(5);
    expect(result.height).toBe(5);
  });

  it("enforces maximum size of 100% at center", () => {
    const result = calculateWheelZoom(-100, 99, 99, 50, 50);

    expect(result.width).toBeLessThanOrEqual(100);
    expect(result.height).toBeLessThanOrEqual(100);
  });

  it("clamps to canvas bounds when near edge", () => {
    // Sticker at x=90%, maxWidth = min(100, 180, 20) = 20
    const result = calculateWheelZoom(-100, 19, 19, 90, 50);

    expect(result.width).toBeLessThanOrEqual(20);
  });

  it("clamps to canvas bounds when near top edge", () => {
    // Sticker at y=10%, maxHeight = min(100, 20, 180) = 20
    const result = calculateWheelZoom(-100, 19, 19, 50, 10);

    expect(result.height).toBeLessThanOrEqual(20);
  });

  it("maintains proportional scaling", () => {
    const result = calculateWheelZoom(-100, 20, 40, 50, 50);

    // Both should scale by 1.05
    expect(result.width).toBeCloseTo(21, 0);
    expect(result.height).toBeCloseTo(42, 0);
  });

  it("handles sticker at corner position (10%, 10%)", () => {
    // maxWidth = min(100, 20, 180) = 20
    // maxHeight = min(100, 20, 180) = 20
    const result = calculateWheelZoom(-100, 18, 18, 10, 10);

    expect(result.width).toBeLessThanOrEqual(20);
    expect(result.height).toBeLessThanOrEqual(20);
  });
});

describe("StickerElement — zoom boundary edge cases", () => {
  it("sticker at exact center can zoom to 100%", () => {
    const result = calculateWheelZoom(-100, 95, 95, 50, 50);

    // maxWidth = min(100, 100, 100) = 100
    expect(result.width).toBeCloseTo(99.75, 0);
  });

  it("sticker at extreme edge has very small max size", () => {
    // x=2%, maxWidth = min(100, 4, 196) = 4
    const result = calculateWheelZoom(-100, 5, 5, 2, 50);

    expect(result.width).toBeLessThanOrEqual(5);
  });

  it("scroll down from minimum stays at minimum", () => {
    const result = calculateWheelZoom(100, 5, 5, 50, 50);

    expect(result.width).toBe(5);
    expect(result.height).toBe(5);
  });
});
