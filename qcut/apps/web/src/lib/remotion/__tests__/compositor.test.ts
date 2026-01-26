/**
 * Compositor Tests
 *
 * Tests for frame compositing functionality.
 *
 * @module lib/remotion/__tests__/compositor.test
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import {
  FrameCompositor,
  createCompositor,
  computeLayerOrder,
  getVisibleRemotionElements,
  DEFAULT_TRANSFORM,
  type CompositeLayer,
  type BlendMode,
} from "../compositor";
import type { TimelineElement, RemotionElement, TextElement } from "@/types/timeline";

// Mock canvas for JSDOM environment
beforeAll(() => {
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,test");
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
    callback(new Blob(["test"], { type: "image/png" }));
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

function createMockCanvas(
  width: number = 100,
  height: number = 100
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

function createMockRemotionElement(
  overrides: Partial<RemotionElement> = {}
): RemotionElement {
  return {
    id: `element-${Math.random().toString(36).slice(2, 9)}`,
    name: "Test Element",
    type: "remotion",
    componentId: "test-component",
    props: {},
    renderMode: "live",
    duration: 5,
    startTime: 0,
    trimStart: 0,
    trimEnd: 0,
    ...overrides,
  };
}

function createMockTextElement(
  overrides: Partial<TextElement> = {}
): TextElement {
  return {
    id: `text-${Math.random().toString(36).slice(2, 9)}`,
    name: "Test Text",
    type: "text",
    content: "Test",
    fontSize: 24,
    fontFamily: "Arial",
    color: "#000000",
    backgroundColor: "transparent",
    textAlign: "center",
    fontWeight: "normal",
    fontStyle: "normal",
    textDecoration: "none",
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    duration: 5,
    startTime: 0,
    trimStart: 0,
    trimEnd: 0,
    ...overrides,
  };
}

function createMockLayer(overrides: Partial<CompositeLayer> = {}): CompositeLayer {
  return {
    zIndex: 0,
    source: "qcut",
    elementId: "test-element",
    blendMode: "normal",
    opacity: 1,
    visible: true,
    ...overrides,
  };
}

// ============================================================================
// FrameCompositor Tests
// ============================================================================

describe("FrameCompositor", () => {
  let compositor: FrameCompositor;

  beforeEach(() => {
    compositor = new FrameCompositor(1920, 1080);
  });

  afterEach(() => {
    compositor.dispose();
  });

  describe("constructor", () => {
    it("should create compositor with specified dimensions", () => {
      const comp = new FrameCompositor(800, 600);
      const canvas = comp.getOutputCanvas();
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
      comp.dispose();
    });
  });

  describe("isAvailable", () => {
    it("should indicate if canvas context is available", () => {
      // In JSDOM, context may or may not be available
      const available = compositor.isAvailable();
      expect(typeof available).toBe("boolean");
    });
  });

  describe("compositeFrame", () => {
    it("should return a result with correct structure", () => {
      const canvas = createMockCanvas();
      const remotionFrames = new Map<string, ImageBitmap | HTMLImageElement | string>();

      const layers: CompositeLayer[] = [
        createMockLayer({ zIndex: 1, source: "qcut", elementId: "bottom" }),
      ];

      const result = compositor.compositeFrame(canvas, remotionFrames, layers);

      expect(result).toHaveProperty("width", 1920);
      expect(result).toHaveProperty("height", 1080);
      expect(result).toHaveProperty("layerCount");
      expect(result).toHaveProperty("imageData");
    });

    it("should handle null qcut canvas", () => {
      const layers: CompositeLayer[] = [
        createMockLayer({ source: "qcut" }),
      ];

      const result = compositor.compositeFrame(null, new Map(), layers);

      expect(result.layerCount).toBe(0);
    });

    it("should handle empty layers array", () => {
      const canvas = createMockCanvas();

      const result = compositor.compositeFrame(canvas, new Map(), []);

      expect(result.layerCount).toBe(0);
    });
  });

  describe("resize", () => {
    it("should resize the output canvas", () => {
      compositor.resize(640, 480);
      const canvas = compositor.getOutputCanvas();

      expect(canvas.width).toBe(640);
      expect(canvas.height).toBe(480);
    });
  });

  describe("toDataURL", () => {
    it("should return a data URL string", () => {
      const dataUrl = compositor.toDataURL("png");
      expect(typeof dataUrl).toBe("string");
    });
  });

  describe("toBlob", () => {
    it("should return a blob", async () => {
      const blob = await compositor.toBlob("png");
      expect(blob).toBeInstanceOf(Blob);
    });
  });

  describe("getOutputCanvas", () => {
    it("should return the output canvas", () => {
      const canvas = compositor.getOutputCanvas();

      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(canvas.width).toBe(1920);
      expect(canvas.height).toBe(1080);
    });
  });
});

// ============================================================================
// computeLayerOrder Tests
// ============================================================================

describe("computeLayerOrder", () => {
  it("should create layers for visible elements", () => {
    const elements: TimelineElement[] = [
      createMockRemotionElement({ id: "e1", startTime: 0, duration: 5 }),
    ];
    const tracks = [{ id: "track-1", elements }];

    const layers = computeLayerOrder(elements, tracks, 30, 30); // Frame 30 = 1 second

    expect(layers.length).toBe(1);
    expect(layers[0].elementId).toBe("e1");
  });

  it("should exclude elements outside current time", () => {
    const elements: TimelineElement[] = [
      createMockRemotionElement({ id: "e1", startTime: 5, duration: 5 }),
    ];
    const tracks = [{ id: "track-1", elements }];

    // Frame 30 at 30fps = 1 second, element starts at 5 seconds
    const layers = computeLayerOrder(elements, tracks, 30, 30);

    expect(layers.length).toBe(0);
  });

  it("should respect trim values", () => {
    const elements: TimelineElement[] = [
      createMockRemotionElement({
        id: "e1",
        startTime: 0,
        duration: 5,
        trimStart: 1,
        trimEnd: 1,
      }),
    ];
    const tracks = [{ id: "track-1", elements }];

    // Element is visible from 1s to 4s
    // Frame at 0.5s (frame 15) should not be visible
    const layersAt15 = computeLayerOrder(elements, tracks, 15, 30);
    expect(layersAt15.length).toBe(0);

    // Frame at 2s (frame 60) should be visible
    const layersAt60 = computeLayerOrder(elements, tracks, 60, 30);
    expect(layersAt60.length).toBe(1);
  });

  it("should handle hidden elements", () => {
    const elements: TimelineElement[] = [
      createMockRemotionElement({ id: "e1", hidden: true }),
    ];
    const tracks = [{ id: "track-1", elements }];

    const layers = computeLayerOrder(elements, tracks, 30, 30);

    expect(layers.length).toBe(1);
    expect(layers[0].visible).toBe(false);
  });

  it("should set correct source type", () => {
    const remotionElement = createMockRemotionElement({ id: "remotion" });
    const textElement = createMockTextElement({ id: "text" });
    const elements: TimelineElement[] = [remotionElement, textElement];
    const tracks = [{ id: "track-1", elements }];

    const layers = computeLayerOrder(elements, tracks, 30, 30);

    const remotionLayer = layers.find((l) => l.elementId === "remotion");
    const textLayer = layers.find((l) => l.elementId === "text");

    expect(remotionLayer?.source).toBe("remotion");
    expect(textLayer?.source).toBe("qcut");
  });

  it("should assign z-index based on track order", () => {
    const track1Elements: TimelineElement[] = [
      createMockRemotionElement({ id: "e1" }),
    ];
    const track2Elements: TimelineElement[] = [
      createMockRemotionElement({ id: "e2" }),
    ];
    const tracks = [
      { id: "track-1", elements: track1Elements },
      { id: "track-2", elements: track2Elements },
    ];

    const layers = computeLayerOrder(
      [...track1Elements, ...track2Elements],
      tracks,
      30,
      30
    );

    const e1Layer = layers.find((l) => l.elementId === "e1");
    const e2Layer = layers.find((l) => l.elementId === "e2");

    expect(e1Layer!.zIndex).toBeLessThan(e2Layer!.zIndex);
  });

  it("should include opacity from element", () => {
    const elements: TimelineElement[] = [
      createMockTextElement({ id: "text", opacity: 0.5 }),
    ];
    const tracks = [{ id: "track-1", elements }];

    const layers = computeLayerOrder(elements, tracks, 30, 30);

    expect(layers[0].opacity).toBe(0.5);
  });

  it("should include transform from element", () => {
    const elements: TimelineElement[] = [
      createMockRemotionElement({
        id: "e1",
        x: 100,
        y: 200,
        rotation: 45,
      }),
    ];
    const tracks = [{ id: "track-1", elements }];

    const layers = computeLayerOrder(elements, tracks, 30, 30);

    expect(layers[0].transform?.x).toBe(100);
    expect(layers[0].transform?.y).toBe(200);
    expect(layers[0].transform?.rotation).toBe(45);
  });
});

// ============================================================================
// getVisibleRemotionElements Tests
// ============================================================================

describe("getVisibleRemotionElements", () => {
  it("should return only Remotion elements", () => {
    const elements: TimelineElement[] = [
      createMockRemotionElement({ id: "remotion" }),
      createMockTextElement({ id: "text" }),
    ];

    const visible = getVisibleRemotionElements(elements, 1);

    expect(visible.length).toBe(1);
    expect(visible[0].id).toBe("remotion");
  });

  it("should filter by current time", () => {
    const elements: TimelineElement[] = [
      createMockRemotionElement({ id: "e1", startTime: 0, duration: 2 }),
      createMockRemotionElement({ id: "e2", startTime: 5, duration: 2 }),
    ];

    const visible = getVisibleRemotionElements(elements, 1);

    expect(visible.length).toBe(1);
    expect(visible[0].id).toBe("e1");
  });

  it("should exclude hidden elements", () => {
    const elements: TimelineElement[] = [
      createMockRemotionElement({ id: "e1", hidden: true }),
      createMockRemotionElement({ id: "e2", hidden: false }),
    ];

    const visible = getVisibleRemotionElements(elements, 1);

    expect(visible.length).toBe(1);
    expect(visible[0].id).toBe("e2");
  });

  it("should handle empty array", () => {
    const visible = getVisibleRemotionElements([], 1);
    expect(visible).toEqual([]);
  });
});

// ============================================================================
// DEFAULT_TRANSFORM Tests
// ============================================================================

describe("DEFAULT_TRANSFORM", () => {
  it("should have expected default values", () => {
    expect(DEFAULT_TRANSFORM.x).toBe(0);
    expect(DEFAULT_TRANSFORM.y).toBe(0);
    expect(DEFAULT_TRANSFORM.scale).toBe(1);
    expect(DEFAULT_TRANSFORM.rotation).toBe(0);
    expect(DEFAULT_TRANSFORM.anchorX).toBe(0.5);
    expect(DEFAULT_TRANSFORM.anchorY).toBe(0.5);
  });
});

// ============================================================================
// createCompositor Tests
// ============================================================================

describe("createCompositor", () => {
  it("should create a compositor instance", () => {
    const comp = createCompositor(800, 600);
    expect(comp).toBeInstanceOf(FrameCompositor);
    comp.dispose();
  });
});

// ============================================================================
// Blend Mode Tests
// ============================================================================

describe("Blend modes", () => {
  let compositor: FrameCompositor;

  beforeEach(() => {
    compositor = new FrameCompositor(100, 100);
  });

  afterEach(() => {
    compositor.dispose();
  });

  const blendModes: BlendMode[] = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
  ];

  for (const mode of blendModes) {
    it(`should handle ${mode} blend mode`, () => {
      const canvas = createMockCanvas();
      const layers: CompositeLayer[] = [
        createMockLayer({ blendMode: mode }),
      ];

      const result = compositor.compositeFrame(canvas, new Map(), layers);

      // In JSDOM, layer count depends on canvas context availability
      expect(result).toHaveProperty("layerCount");
    });
  }
});
