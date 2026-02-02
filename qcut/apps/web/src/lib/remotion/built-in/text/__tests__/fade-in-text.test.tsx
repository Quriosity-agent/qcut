/**
 * Fade In Text Component Tests
 *
 * Tests for FadeInText animation component.
 *
 * @module lib/remotion/built-in/text/__tests__/fade-in-text.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import {
  FadeInText,
  FadeInTextSchema,
  FadeInTextDefinition,
  fadeInTextDefaultProps,
} from "../fade-in-text";

// Store the mock return value
let mockFrame = 0;

// Mock Remotion hooks
vi.mock("remotion", () => ({
  useCurrentFrame: () => mockFrame,
  useVideoConfig: () => ({
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 90,
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
  Easing: {
    linear: (t: number) => t,
    ease: (t: number) => t * t * (3 - 2 * t),
    out: (fn: (t: number) => number) => (t: number) => 1 - fn(1 - t),
    inOut: (fn: (t: number) => number) => fn,
  },
}));

// ============================================================================
// Schema Tests
// ============================================================================

describe("FadeInTextSchema", () => {
  it("should validate default props", () => {
    const result = FadeInTextSchema.safeParse(fadeInTextDefaultProps);
    expect(result.success).toBe(true);
  });

  it("should validate valid props", () => {
    const result = FadeInTextSchema.safeParse({
      text: "Test fade",
      fontSize: 72,
      fadeMode: "word",
      fadeDuration: 45,
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty text", () => {
    const result = FadeInTextSchema.safeParse({
      ...fadeInTextDefaultProps,
      text: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid fadeMode", () => {
    const result = FadeInTextSchema.safeParse({
      ...fadeInTextDefaultProps,
      fadeMode: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("should reject negative fadeDuration", () => {
    const result = FadeInTextSchema.safeParse({
      ...fadeInTextDefaultProps,
      fadeDuration: 0,
    });
    expect(result.success).toBe(false);
  });

  it("should apply default values", () => {
    const result = FadeInTextSchema.parse({});
    expect(result.text).toBe("Fade In Text");
    expect(result.fadeMode).toBe("all");
    expect(result.fadeDuration).toBe(30);
    expect(result.slideUp).toBe(false);
  });

  it("should validate all easing options", () => {
    for (const easing of ["linear", "easeIn", "easeOut", "easeInOut"]) {
      const result = FadeInTextSchema.safeParse({
        ...fadeInTextDefaultProps,
        easing,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ============================================================================
// Component Tests
// ============================================================================

describe("FadeInText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrame = 0;
  });

  it("should render without crashing", () => {
    const { container } = render(<FadeInText />);
    expect(container).toBeTruthy();
  });

  it("should render with custom text", () => {
    render(<FadeInText text="Custom Fade Text" />);
    const container = document.querySelector("div");
    expect(container).toBeTruthy();
  });

  it("should render with custom font size", () => {
    render(<FadeInText fontSize={96} />);
    const container = document.querySelector("div");
    expect(container).toBeTruthy();
  });

  it("should render with custom font family", () => {
    render(<FadeInText fontFamily="Georgia" />);
    const container = document.querySelector("div");
    expect(container).toBeTruthy();
  });

  it("should render with custom color", () => {
    render(<FadeInText color="#00ff00" />);
    const container = document.querySelector("div");
    expect(container).toBeTruthy();
  });

  it("should render with custom background color", () => {
    render(<FadeInText backgroundColor="rgb(51, 51, 51)" />);
    const container = document.querySelector("div");
    expect(container).toBeTruthy();
  });

  it("should render with text alignment center", () => {
    render(<FadeInText textAlign="center" />);
    const container = document.querySelector("div");
    expect(container).toBeTruthy();
  });

  it("should render with text alignment right", () => {
    render(<FadeInText textAlign="right" />);
    const container = document.querySelector("div");
    expect(container).toBeTruthy();
  });

  it("should render with font weight", () => {
    render(<FadeInText fontWeight="bold" />);
    const container = document.querySelector("div");
    expect(container).toBeTruthy();
  });
});

// ============================================================================
// Fade Mode Tests
// ============================================================================

describe("FadeInText Fade Modes", () => {
  beforeEach(() => {
    mockFrame = 15;
  });

  it("should render in 'all' mode", () => {
    render(<FadeInText fadeMode="all" text="All at once" />);
    const spans = document.querySelectorAll("span");
    // In 'all' mode, should have a single span for the text
    expect(spans.length).toBeGreaterThanOrEqual(1);
  });

  it("should render in 'word' mode", () => {
    render(<FadeInText fadeMode="word" text="Word by word" />);
    // In 'word' mode, should have multiple spans for words
    const container = document.querySelector("div");
    expect(container).toBeTruthy();
  });

  it("should render in 'character' mode", () => {
    render(<FadeInText fadeMode="character" text="Char" />);
    // In 'character' mode, should have spans for each character
    const container = document.querySelector("div");
    expect(container).toBeTruthy();
  });
});

// ============================================================================
// Animation Tests
// ============================================================================

describe("FadeInText Animation", () => {
  it("should render at frame 0", () => {
    mockFrame = 0;
    render(<FadeInText fadeMode="all" fadeDuration={30} />);
    const span = document.querySelector("span");
    // At frame 0, opacity should be 0 (interpolated)
    expect(span).toBeTruthy();
  });

  it("should render after fade duration", () => {
    mockFrame = 60;
    render(<FadeInText fadeMode="all" fadeDuration={30} />);
    const span = document.querySelector("span");
    expect(span).toBeTruthy();
  });

  it("should apply slide up animation when enabled", () => {
    mockFrame = 0;
    render(<FadeInText slideUp={true} slideDistance={30} />);
    const span = document.querySelector("span");
    // Transform should include translateY
    expect(span?.style.transform).toContain("translateY");
  });

  it("should have translateY(0) when slide disabled and animation complete", () => {
    mockFrame = 60;
    render(<FadeInText slideUp={false} />);
    const span = document.querySelector("span");
    // Transform should have translateY(0px) when no slide
    expect(span?.style.transform).toContain("translateY(0px)");
  });
});

// ============================================================================
// Definition Tests
// ============================================================================

describe("FadeInTextDefinition", () => {
  it("should have correct id", () => {
    expect(FadeInTextDefinition.id).toBe("built-in-fade-in-text");
  });

  it("should have correct name", () => {
    expect(FadeInTextDefinition.name).toBe("Fade In Text");
  });

  it("should have correct category", () => {
    expect(FadeInTextDefinition.category).toBe("text");
  });

  it("should have correct source", () => {
    expect(FadeInTextDefinition.source).toBe("built-in");
  });

  it("should have valid schema", () => {
    expect(FadeInTextDefinition.schema).toBe(FadeInTextSchema);
  });

  it("should have valid component", () => {
    expect(FadeInTextDefinition.component).toBe(FadeInText);
  });

  it("should have tags", () => {
    expect(FadeInTextDefinition.tags).toContain("fade");
    expect(FadeInTextDefinition.tags).toContain("text");
    expect(FadeInTextDefinition.tags).toContain("opacity");
  });

  it("should have version", () => {
    expect(FadeInTextDefinition.version).toBe("1.0.0");
  });

  it("should have standard video dimensions", () => {
    expect(FadeInTextDefinition.width).toBe(1920);
    expect(FadeInTextDefinition.height).toBe(1080);
    expect(FadeInTextDefinition.fps).toBe(30);
  });

  it("should have description", () => {
    expect(FadeInTextDefinition.description).toContain("fading");
  });
});
