/**
 * Transition Components Tests
 *
 * Tests for Wipe, Dissolve, Slide, and Zoom transition components.
 *
 * @module lib/remotion/built-in/transitions/__tests__/transitions.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// Import all components and definitions
import { Wipe, WipeSchema, WipeDefinition, wipeDefaultProps } from "../wipe";

import {
  Dissolve,
  DissolveSchema,
  DissolveDefinition,
  dissolveDefaultProps,
} from "../dissolve";

import {
  Slide,
  SlideSchema,
  SlideDefinition,
  slideDefaultProps,
} from "../slide";

import { Zoom, ZoomSchema, ZoomDefinition, zoomDefaultProps } from "../zoom";

import {
  transitionComponentDefinitions,
  transitionComponentsById,
  getTransitionComponent,
  isTransitionComponent,
} from "../index";

// Store the mock return value
let mockFrame = 15;

// Mock Remotion hooks
vi.mock("remotion", () => ({
  useCurrentFrame: () => mockFrame,
  useVideoConfig: () => ({
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 30,
  }),
  interpolate: (
    value: number,
    inputRange: number[],
    outputRange: number[],
    options?: {
      extrapolateLeft?: string;
      extrapolateRight?: string;
      easing?: (t: number) => number;
    }
  ) => {
    const [inputMin, inputMax] = inputRange;
    const [outputMin, outputMax] = outputRange;
    let progress = (value - inputMin) / (inputMax - inputMin);
    if (options?.extrapolateLeft === "clamp") progress = Math.max(0, progress);
    if (options?.extrapolateRight === "clamp") progress = Math.min(1, progress);
    return outputMin + progress * (outputMax - outputMin);
  },
  spring: () => 0.5,
  Easing: {
    linear: (t: number) => t,
    ease: (t: number) => t,
    cubic: (t: number) => t * t * t,
    out: (fn: (t: number) => number) => (t: number) => 1 - fn(1 - t),
    in: (fn: (t: number) => number) => fn,
    inOut: (fn: (t: number) => number) => fn,
  },
  AbsoluteFill: ({
    children,
    style,
  }: {
    children?: React.ReactNode;
    style?: React.CSSProperties;
  }) => (
    <div data-testid="absolute-fill" style={style}>
      {children}
    </div>
  ),
}));

// ============================================================================
// Wipe Tests
// ============================================================================

describe("Wipe", () => {
  describe("Schema", () => {
    it("should validate default props", () => {
      const result = WipeSchema.safeParse(wipeDefaultProps);
      expect(result.success).toBe(true);
    });

    it("should validate valid props", () => {
      const result = WipeSchema.safeParse({
        direction: "right",
        backgroundColor: "#ff0000",
        edgeSoftness: 20,
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid direction", () => {
      const result = WipeSchema.safeParse({
        ...wipeDefaultProps,
        direction: "diagonal",
      });
      expect(result.success).toBe(false);
    });

    it("should apply default values", () => {
      const result = WipeSchema.parse({});
      expect(result.direction).toBe("left");
      expect(result.easing).toBe("easeInOut");
      expect(result.edgeSoftness).toBe(0);
    });

    it("should validate all directions", () => {
      for (const direction of ["left", "right", "up", "down"]) {
        const result = WipeSchema.safeParse({ direction });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Component", () => {
    beforeEach(() => {
      mockFrame = 15;
    });

    it("should render without crashing", () => {
      const { container } = render(<Wipe />);
      expect(container).toBeTruthy();
    });

    it("should render with custom direction", () => {
      render(<Wipe direction="right" />);
      const fills = document.querySelectorAll("[data-testid='absolute-fill']");
      expect(fills.length).toBeGreaterThan(0);
    });

    it("should render with edge softness", () => {
      render(<Wipe edgeSoftness={50} />);
      const container = document.querySelector("[data-testid='absolute-fill']");
      expect(container).toBeTruthy();
    });
  });

  describe("Definition", () => {
    it("should have correct id", () => {
      expect(WipeDefinition.id).toBe("built-in-wipe");
    });

    it("should have correct category", () => {
      expect(WipeDefinition.category).toBe("transition");
    });

    it("should have wipe tag", () => {
      expect(WipeDefinition.tags).toContain("wipe");
    });
  });
});

// ============================================================================
// Dissolve Tests
// ============================================================================

describe("Dissolve", () => {
  describe("Schema", () => {
    it("should validate default props", () => {
      const result = DissolveSchema.safeParse(dissolveDefaultProps);
      expect(result.success).toBe(true);
    });

    it("should validate valid props", () => {
      const result = DissolveSchema.safeParse({
        style: "additive",
        easing: "easeOut",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid style", () => {
      const result = DissolveSchema.safeParse({
        ...dissolveDefaultProps,
        style: "invalid",
      });
      expect(result.success).toBe(false);
    });

    it("should apply default values", () => {
      const result = DissolveSchema.parse({});
      expect(result.style).toBe("fade");
      expect(result.easing).toBe("linear");
    });

    it("should validate all styles", () => {
      for (const style of ["fade", "additive", "dither"]) {
        const result = DissolveSchema.safeParse({ style });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Component", () => {
    beforeEach(() => {
      mockFrame = 15;
    });

    it("should render without crashing", () => {
      const { container } = render(<Dissolve />);
      expect(container).toBeTruthy();
    });

    it("should render fade style", () => {
      render(<Dissolve style="fade" />);
      const fills = document.querySelectorAll("[data-testid='absolute-fill']");
      expect(fills.length).toBeGreaterThan(0);
    });

    it("should render additive style", () => {
      render(<Dissolve style="additive" />);
      const container = document.querySelector("[data-testid='absolute-fill']");
      expect(container).toBeTruthy();
    });

    it("should render dither style", () => {
      render(<Dissolve style="dither" />);
      const container = document.querySelector("[data-testid='absolute-fill']");
      expect(container).toBeTruthy();
    });
  });

  describe("Definition", () => {
    it("should have correct id", () => {
      expect(DissolveDefinition.id).toBe("built-in-dissolve");
    });

    it("should have correct category", () => {
      expect(DissolveDefinition.category).toBe("transition");
    });

    it("should have dissolve and fade tags", () => {
      expect(DissolveDefinition.tags).toContain("dissolve");
      expect(DissolveDefinition.tags).toContain("fade");
    });
  });
});

// ============================================================================
// Slide Tests
// ============================================================================

describe("Slide", () => {
  describe("Schema", () => {
    it("should validate default props", () => {
      const result = SlideSchema.safeParse(slideDefaultProps);
      expect(result.success).toBe(true);
    });

    it("should validate valid props", () => {
      const result = SlideSchema.safeParse({
        direction: "up",
        animationType: "spring",
        slideOut: false,
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid direction", () => {
      const result = SlideSchema.safeParse({
        ...slideDefaultProps,
        direction: "diagonal",
      });
      expect(result.success).toBe(false);
    });

    it("should apply default values", () => {
      const result = SlideSchema.parse({});
      expect(result.direction).toBe("left");
      expect(result.animationType).toBe("easeOut");
      expect(result.slideOut).toBe(true);
    });

    it("should validate all animation types", () => {
      for (const animationType of ["linear", "easeOut", "spring", "bounce"]) {
        const result = SlideSchema.safeParse({ animationType });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Component", () => {
    beforeEach(() => {
      mockFrame = 15;
    });

    it("should render without crashing", () => {
      const { container } = render(<Slide />);
      expect(container).toBeTruthy();
    });

    it("should render with direction up", () => {
      render(<Slide direction="up" />);
      const fills = document.querySelectorAll("[data-testid='absolute-fill']");
      expect(fills.length).toBeGreaterThan(0);
    });

    it("should render with spring animation", () => {
      render(<Slide animationType="spring" />);
      const container = document.querySelector("[data-testid='absolute-fill']");
      expect(container).toBeTruthy();
    });

    it("should render without slideOut", () => {
      render(<Slide slideOut={false} />);
      const container = document.querySelector("[data-testid='absolute-fill']");
      expect(container).toBeTruthy();
    });
  });

  describe("Definition", () => {
    it("should have correct id", () => {
      expect(SlideDefinition.id).toBe("built-in-slide-transition");
    });

    it("should have correct category", () => {
      expect(SlideDefinition.category).toBe("transition");
    });

    it("should have slide tag", () => {
      expect(SlideDefinition.tags).toContain("slide");
    });
  });
});

// ============================================================================
// Zoom Tests
// ============================================================================

describe("Zoom", () => {
  describe("Schema", () => {
    it("should validate default props", () => {
      const result = ZoomSchema.safeParse(zoomDefaultProps);
      expect(result.success).toBe(true);
    });

    it("should validate valid props", () => {
      const result = ZoomSchema.safeParse({
        zoomType: "out",
        maxScale: 5,
        origin: "top-left",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid zoomType", () => {
      const result = ZoomSchema.safeParse({
        ...zoomDefaultProps,
        zoomType: "invalid",
      });
      expect(result.success).toBe(false);
    });

    it("should apply default values", () => {
      const result = ZoomSchema.parse({});
      expect(result.zoomType).toBe("in");
      expect(result.maxScale).toBe(3);
      expect(result.origin).toBe("center");
    });

    it("should validate all zoom types", () => {
      for (const zoomType of ["in", "out", "through"]) {
        const result = ZoomSchema.safeParse({ zoomType });
        expect(result.success).toBe(true);
      }
    });

    it("should validate all origins", () => {
      for (const origin of [
        "center",
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ]) {
        const result = ZoomSchema.safeParse({ origin });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Component", () => {
    beforeEach(() => {
      mockFrame = 15;
    });

    it("should render without crashing", () => {
      const { container } = render(<Zoom />);
      expect(container).toBeTruthy();
    });

    it("should render zoom in", () => {
      render(<Zoom zoomType="in" />);
      const fills = document.querySelectorAll("[data-testid='absolute-fill']");
      expect(fills.length).toBeGreaterThan(0);
    });

    it("should render zoom out", () => {
      render(<Zoom zoomType="out" />);
      const container = document.querySelector("[data-testid='absolute-fill']");
      expect(container).toBeTruthy();
    });

    it("should render zoom through", () => {
      render(<Zoom zoomType="through" />);
      const container = document.querySelector("[data-testid='absolute-fill']");
      expect(container).toBeTruthy();
    });

    it("should render with custom origin", () => {
      render(<Zoom origin="top-right" />);
      const container = document.querySelector("[data-testid='absolute-fill']");
      expect(container).toBeTruthy();
    });
  });

  describe("Definition", () => {
    it("should have correct id", () => {
      expect(ZoomDefinition.id).toBe("built-in-zoom-transition");
    });

    it("should have correct category", () => {
      expect(ZoomDefinition.category).toBe("transition");
    });

    it("should have zoom tag", () => {
      expect(ZoomDefinition.tags).toContain("zoom");
    });
  });
});

// ============================================================================
// Index Export Tests
// ============================================================================

describe("Transition Components Index", () => {
  it("should export all component definitions", () => {
    expect(transitionComponentDefinitions).toHaveLength(4);
  });

  it("should include all transition components in definitions", () => {
    const ids = transitionComponentDefinitions.map((def) => def.id);
    expect(ids).toContain("built-in-wipe");
    expect(ids).toContain("built-in-dissolve");
    expect(ids).toContain("built-in-slide-transition");
    expect(ids).toContain("built-in-zoom-transition");
  });

  it("should have all definitions in transitionComponentsById map", () => {
    expect(transitionComponentsById.size).toBe(4);
    expect(transitionComponentsById.has("built-in-wipe")).toBe(true);
    expect(transitionComponentsById.has("built-in-dissolve")).toBe(true);
    expect(transitionComponentsById.has("built-in-slide-transition")).toBe(
      true
    );
    expect(transitionComponentsById.has("built-in-zoom-transition")).toBe(true);
  });

  it("getTransitionComponent should return correct definition", () => {
    const wipe = getTransitionComponent("built-in-wipe");
    expect(wipe).toBeDefined();
    expect(wipe?.name).toBe("Wipe");

    const dissolve = getTransitionComponent("built-in-dissolve");
    expect(dissolve).toBeDefined();
    expect(dissolve?.name).toBe("Dissolve");
  });

  it("getTransitionComponent should return undefined for unknown id", () => {
    const unknown = getTransitionComponent("unknown-component");
    expect(unknown).toBeUndefined();
  });

  it("isTransitionComponent should return true for transition components", () => {
    expect(isTransitionComponent("built-in-wipe")).toBe(true);
    expect(isTransitionComponent("built-in-dissolve")).toBe(true);
    expect(isTransitionComponent("built-in-slide-transition")).toBe(true);
    expect(isTransitionComponent("built-in-zoom-transition")).toBe(true);
  });

  it("isTransitionComponent should return false for non-transition components", () => {
    expect(isTransitionComponent("unknown")).toBe(false);
    expect(isTransitionComponent("built-in-typewriter")).toBe(false);
    expect(isTransitionComponent("")).toBe(false);
  });

  it("all definitions should have transition category", () => {
    for (const def of transitionComponentDefinitions) {
      expect(def.category).toBe("transition");
    }
  });

  it("all definitions should be built-in source", () => {
    for (const def of transitionComponentDefinitions) {
      expect(def.source).toBe("built-in");
    }
  });

  it("all definitions should have standard dimensions", () => {
    for (const def of transitionComponentDefinitions) {
      expect(def.width).toBe(1920);
      expect(def.height).toBe(1080);
      expect(def.fps).toBe(30);
    }
  });

  it("all definitions should have valid components", () => {
    for (const def of transitionComponentDefinitions) {
      expect(typeof def.component).toBe("function");
    }
  });

  it("all definitions should have valid schemas", () => {
    for (const def of transitionComponentDefinitions) {
      expect(def.schema).toBeDefined();
      expect(typeof def.schema.safeParse).toBe("function");
    }
  });
});
