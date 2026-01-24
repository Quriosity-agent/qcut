/**
 * Template Components Tests
 *
 * Tests for LowerThird, TitleCard, IntroScene, and OutroScene template components.
 *
 * @module lib/remotion/built-in/templates/__tests__/templates.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// Import all components and definitions
import {
  LowerThird,
  LowerThirdSchema,
  LowerThirdDefinition,
  lowerThirdDefaultProps,
} from "../lower-third";

import {
  TitleCard,
  TitleCardSchema,
  TitleCardDefinition,
  titleCardDefaultProps,
} from "../title-card";

import {
  IntroScene,
  IntroSceneSchema,
  IntroSceneDefinition,
  introSceneDefaultProps,
} from "../intro-scene";

import {
  OutroScene,
  OutroSceneSchema,
  OutroSceneDefinition,
  outroSceneDefaultProps,
} from "../outro-scene";

import {
  templateComponentDefinitions,
  templateComponentsById,
  getTemplateComponent,
  isTemplateComponent,
} from "../index";

// Store the mock return value
let mockFrame = 30;

// Mock Remotion hooks
vi.mock("remotion", () => ({
  useCurrentFrame: () => mockFrame,
  useVideoConfig: () => ({
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 90,
  }),
  interpolate: (value: number, inputRange: number[], outputRange: number[], options?: { extrapolateLeft?: string; extrapolateRight?: string; easing?: (t: number) => number }) => {
    const [inputMin, inputMax] = inputRange;
    const [outputMin, outputMax] = outputRange;
    let progress = (value - inputMin) / (inputMax - inputMin);
    if (options?.extrapolateLeft === "clamp") progress = Math.max(0, progress);
    if (options?.extrapolateRight === "clamp") progress = Math.min(1, progress);
    return outputMin + progress * (outputMax - outputMin);
  },
  spring: () => 0.8,
  Easing: {
    linear: (t: number) => t,
    ease: (t: number) => t,
    cubic: (t: number) => t * t * t,
    out: (fn: (t: number) => number) => (t: number) => 1 - fn(1 - t),
    in: (fn: (t: number) => number) => fn,
    inOut: (fn: (t: number) => number) => fn,
  },
  AbsoluteFill: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="absolute-fill" style={style}>{children}</div>
  ),
}));

// ============================================================================
// LowerThird Tests
// ============================================================================

describe("LowerThird", () => {
  describe("Schema", () => {
    it("should validate default props", () => {
      const result = LowerThirdSchema.safeParse(lowerThirdDefaultProps);
      expect(result.success).toBe(true);
    });

    it("should validate valid props", () => {
      const result = LowerThirdSchema.safeParse({
        primaryText: "Jane Smith",
        secondaryText: "CEO",
        animationStyle: "fade",
        backgroundColor: "#333333",
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty primaryText", () => {
      const result = LowerThirdSchema.safeParse({
        ...lowerThirdDefaultProps,
        primaryText: "",
      });
      expect(result.success).toBe(false);
    });

    it("should apply default values", () => {
      const result = LowerThirdSchema.parse({});
      expect(result.primaryText).toBe("John Doe");
      expect(result.secondaryText).toBe("Software Engineer");
      expect(result.animationStyle).toBe("slide");
    });

    it("should validate all animation styles", () => {
      for (const style of ["slide", "fade", "expand", "typewriter"]) {
        const result = LowerThirdSchema.safeParse({ animationStyle: style });
        expect(result.success).toBe(true);
      }
    });

    it("should validate bottomOffset range", () => {
      const valid = LowerThirdSchema.safeParse({ bottomOffset: 100 });
      expect(valid.success).toBe(true);

      const tooLow = LowerThirdSchema.safeParse({ bottomOffset: -10 });
      expect(tooLow.success).toBe(false);

      const tooHigh = LowerThirdSchema.safeParse({ bottomOffset: 600 });
      expect(tooHigh.success).toBe(false);
    });
  });

  describe("Component", () => {
    beforeEach(() => {
      mockFrame = 30;
    });

    it("should render without crashing", () => {
      const { container } = render(<LowerThird />);
      expect(container).toBeTruthy();
    });

    it("should render with custom text", () => {
      const { getByText } = render(
        <LowerThird primaryText="Test Name" secondaryText="Test Title" />
      );
      expect(getByText("Test Name")).toBeTruthy();
      expect(getByText("Test Title")).toBeTruthy();
    });

    it("should render with fade animation", () => {
      const { container } = render(<LowerThird animationStyle="fade" />);
      expect(container).toBeTruthy();
    });

    it("should render with expand animation", () => {
      const { container } = render(<LowerThird animationStyle="expand" />);
      expect(container).toBeTruthy();
    });

    it("should render with typewriter animation", () => {
      const { container } = render(<LowerThird animationStyle="typewriter" />);
      expect(container).toBeTruthy();
    });

    it("should render without accent bar when disabled", () => {
      const { container } = render(<LowerThird showAccentBar={false} />);
      expect(container).toBeTruthy();
    });

    it("should render without background when disabled", () => {
      const { container } = render(<LowerThird showBackground={false} />);
      expect(container).toBeTruthy();
    });
  });

  describe("Definition", () => {
    it("should have correct id", () => {
      expect(LowerThirdDefinition.id).toBe("built-in-lower-third");
    });

    it("should have correct category", () => {
      expect(LowerThirdDefinition.category).toBe("template");
    });

    it("should have lower-third tag", () => {
      expect(LowerThirdDefinition.tags).toContain("lower-third");
    });
  });
});

// ============================================================================
// TitleCard Tests
// ============================================================================

describe("TitleCard", () => {
  describe("Schema", () => {
    it("should validate default props", () => {
      const result = TitleCardSchema.safeParse(titleCardDefaultProps);
      expect(result.success).toBe(true);
    });

    it("should validate valid props", () => {
      const result = TitleCardSchema.safeParse({
        title: "Chapter Two",
        subtitle: "The Journey",
        animationStyle: "scale",
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty title", () => {
      const result = TitleCardSchema.safeParse({
        ...titleCardDefaultProps,
        title: "",
      });
      expect(result.success).toBe(false);
    });

    it("should apply default values", () => {
      const result = TitleCardSchema.parse({});
      expect(result.title).toBe("Chapter One");
      expect(result.subtitle).toBe("The Beginning");
      expect(result.animationStyle).toBe("fade");
    });

    it("should validate all animation styles", () => {
      for (const style of ["fade", "scale", "slide-up", "slide-down", "blur"]) {
        const result = TitleCardSchema.safeParse({ animationStyle: style });
        expect(result.success).toBe(true);
      }
    });

    it("should validate all vertical positions", () => {
      for (const position of ["top", "center", "bottom"]) {
        const result = TitleCardSchema.safeParse({ verticalPosition: position });
        expect(result.success).toBe(true);
      }
    });

    it("should validate all text alignments", () => {
      for (const align of ["left", "center", "right"]) {
        const result = TitleCardSchema.safeParse({ textAlign: align });
        expect(result.success).toBe(true);
      }
    });

    it("should validate title text transforms", () => {
      for (const transform of ["none", "uppercase", "lowercase", "capitalize"]) {
        const result = TitleCardSchema.safeParse({ titleTextTransform: transform });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Component", () => {
    beforeEach(() => {
      mockFrame = 30;
    });

    it("should render without crashing", () => {
      const { container } = render(<TitleCard />);
      expect(container).toBeTruthy();
    });

    it("should render with custom text", () => {
      const { getByText } = render(
        <TitleCard title="My Title" subtitle="My Subtitle" />
      );
      expect(getByText("My Title")).toBeTruthy();
      expect(getByText("My Subtitle")).toBeTruthy();
    });

    it("should render with scale animation", () => {
      const { container } = render(<TitleCard animationStyle="scale" />);
      expect(container).toBeTruthy();
    });

    it("should render with slide-up animation", () => {
      const { container } = render(<TitleCard animationStyle="slide-up" />);
      expect(container).toBeTruthy();
    });

    it("should render with blur animation", () => {
      const { container } = render(<TitleCard animationStyle="blur" />);
      expect(container).toBeTruthy();
    });

    it("should render without decorative line when disabled", () => {
      const { container } = render(<TitleCard showDecorativeLine={false} />);
      expect(container).toBeTruthy();
    });

    it("should render with different vertical positions", () => {
      const { container: top } = render(<TitleCard verticalPosition="top" />);
      expect(top).toBeTruthy();

      const { container: bottom } = render(<TitleCard verticalPosition="bottom" />);
      expect(bottom).toBeTruthy();
    });
  });

  describe("Definition", () => {
    it("should have correct id", () => {
      expect(TitleCardDefinition.id).toBe("built-in-title-card");
    });

    it("should have correct category", () => {
      expect(TitleCardDefinition.category).toBe("template");
    });

    it("should have title tag", () => {
      expect(TitleCardDefinition.tags).toContain("title");
    });
  });
});

// ============================================================================
// IntroScene Tests
// ============================================================================

describe("IntroScene", () => {
  describe("Schema", () => {
    it("should validate default props", () => {
      const result = IntroSceneSchema.safeParse(introSceneDefaultProps);
      expect(result.success).toBe(true);
    });

    it("should validate valid props", () => {
      const result = IntroSceneSchema.safeParse({
        logoText: "A",
        title: "My Channel",
        tagline: "Quality Content",
        animationStyle: "energetic",
      });
      expect(result.success).toBe(true);
    });

    it("should apply default values", () => {
      const result = IntroSceneSchema.parse({});
      expect(result.logoText).toBe("Q");
      expect(result.title).toBe("Welcome");
      expect(result.animationStyle).toBe("elegant");
    });

    it("should validate all animation styles", () => {
      for (const style of ["elegant", "energetic", "minimal", "dramatic"]) {
        const result = IntroSceneSchema.safeParse({ animationStyle: style });
        expect(result.success).toBe(true);
      }
    });

    it("should validate all logo shapes", () => {
      for (const shape of ["circle", "square", "rounded"]) {
        const result = IntroSceneSchema.safeParse({ logoShape: shape });
        expect(result.success).toBe(true);
      }
    });

    it("should validate all gradient directions", () => {
      for (const direction of ["to-bottom", "to-right", "radial"]) {
        const result = IntroSceneSchema.safeParse({ gradientDirection: direction });
        expect(result.success).toBe(true);
      }
    });

    it("should validate particle count range", () => {
      const valid = IntroSceneSchema.safeParse({ particleCount: 10 });
      expect(valid.success).toBe(true);

      const tooHigh = IntroSceneSchema.safeParse({ particleCount: 25 });
      expect(tooHigh.success).toBe(false);
    });
  });

  describe("Component", () => {
    beforeEach(() => {
      mockFrame = 30;
    });

    it("should render without crashing", () => {
      const { container } = render(<IntroScene />);
      expect(container).toBeTruthy();
    });

    it("should render with custom text", () => {
      const { getByText } = render(
        <IntroScene logoText="X" title="Welcome Back" tagline="New Episode" />
      );
      expect(getByText("X")).toBeTruthy();
      expect(getByText("Welcome Back")).toBeTruthy();
      expect(getByText("New Episode")).toBeTruthy();
    });

    it("should render with energetic animation", () => {
      const { container } = render(<IntroScene animationStyle="energetic" />);
      expect(container).toBeTruthy();
    });

    it("should render with dramatic animation", () => {
      const { container } = render(<IntroScene animationStyle="dramatic" />);
      expect(container).toBeTruthy();
    });

    it("should render with minimal animation", () => {
      const { container } = render(<IntroScene animationStyle="minimal" />);
      expect(container).toBeTruthy();
    });

    it("should render without particles", () => {
      const { container } = render(<IntroScene showParticles={false} />);
      expect(container).toBeTruthy();
    });

    it("should render with different logo shapes", () => {
      const { container: circle } = render(<IntroScene logoShape="circle" />);
      expect(circle).toBeTruthy();

      const { container: square } = render(<IntroScene logoShape="square" />);
      expect(square).toBeTruthy();

      const { container: rounded } = render(<IntroScene logoShape="rounded" />);
      expect(rounded).toBeTruthy();
    });

    it("should render without gradient", () => {
      const { container } = render(<IntroScene useGradient={false} />);
      expect(container).toBeTruthy();
    });
  });

  describe("Definition", () => {
    it("should have correct id", () => {
      expect(IntroSceneDefinition.id).toBe("built-in-intro-scene");
    });

    it("should have correct category", () => {
      expect(IntroSceneDefinition.category).toBe("template");
    });

    it("should have intro tag", () => {
      expect(IntroSceneDefinition.tags).toContain("intro");
    });
  });
});

// ============================================================================
// OutroScene Tests
// ============================================================================

describe("OutroScene", () => {
  describe("Schema", () => {
    it("should validate default props", () => {
      const result = OutroSceneSchema.safeParse(outroSceneDefaultProps);
      expect(result.success).toBe(true);
    });

    it("should validate valid props", () => {
      const result = OutroSceneSchema.safeParse({
        title: "See You Next Time!",
        subtitle: "Like and Subscribe",
        channelName: "@TestChannel",
        layoutStyle: "split",
      });
      expect(result.success).toBe(true);
    });

    it("should apply default values", () => {
      const result = OutroSceneSchema.parse({});
      expect(result.title).toBe("Thanks for Watching!");
      expect(result.subtitle).toBe("Don't forget to subscribe");
      expect(result.layoutStyle).toBe("centered");
    });

    it("should validate all layout styles", () => {
      for (const style of ["centered", "split", "bottom-heavy"]) {
        const result = OutroSceneSchema.safeParse({ layoutStyle: style });
        expect(result.success).toBe(true);
      }
    });

    it("should validate placeholder count range", () => {
      const valid = OutroSceneSchema.safeParse({ placeholderCount: 2 });
      expect(valid.success).toBe(true);

      const tooHigh = OutroSceneSchema.safeParse({ placeholderCount: 5 });
      expect(tooHigh.success).toBe(false);
    });
  });

  describe("Component", () => {
    beforeEach(() => {
      mockFrame = 30;
    });

    it("should render without crashing", () => {
      const { container } = render(<OutroScene />);
      expect(container).toBeTruthy();
    });

    it("should render with custom text", () => {
      const { getByText } = render(
        <OutroScene
          title="Goodbye!"
          subtitle="See you soon"
          channelName="@MyChannel"
        />
      );
      expect(getByText("Goodbye!")).toBeTruthy();
      expect(getByText("See you soon")).toBeTruthy();
      expect(getByText("@MyChannel")).toBeTruthy();
    });

    it("should render with split layout", () => {
      const { container } = render(<OutroScene layoutStyle="split" />);
      expect(container).toBeTruthy();
    });

    it("should render with bottom-heavy layout", () => {
      const { container } = render(<OutroScene layoutStyle="bottom-heavy" />);
      expect(container).toBeTruthy();
    });

    it("should render without subscribe button", () => {
      const { container } = render(<OutroScene showSubscribeButton={false} />);
      expect(container).toBeTruthy();
    });

    it("should render without video placeholders", () => {
      const { container } = render(<OutroScene showVideoPlaceholders={false} />);
      expect(container).toBeTruthy();
    });

    it("should render with social icons", () => {
      const { container } = render(
        <OutroScene showSocialIcons={true} socialLabels="YouTube,Twitter" />
      );
      expect(container).toBeTruthy();
    });

    it("should render with custom placeholder count", () => {
      const { container } = render(<OutroScene placeholderCount={3} />);
      expect(container).toBeTruthy();
    });
  });

  describe("Definition", () => {
    it("should have correct id", () => {
      expect(OutroSceneDefinition.id).toBe("built-in-outro-scene");
    });

    it("should have correct category", () => {
      expect(OutroSceneDefinition.category).toBe("template");
    });

    it("should have outro tag", () => {
      expect(OutroSceneDefinition.tags).toContain("outro");
    });
  });
});

// ============================================================================
// Index Export Tests
// ============================================================================

describe("Template Components Index", () => {
  it("should export all component definitions", () => {
    expect(templateComponentDefinitions).toHaveLength(4);
  });

  it("should include all template components in definitions", () => {
    const ids = templateComponentDefinitions.map((def) => def.id);
    expect(ids).toContain("built-in-lower-third");
    expect(ids).toContain("built-in-title-card");
    expect(ids).toContain("built-in-intro-scene");
    expect(ids).toContain("built-in-outro-scene");
  });

  it("should have all definitions in templateComponentsById map", () => {
    expect(templateComponentsById.size).toBe(4);
    expect(templateComponentsById.has("built-in-lower-third")).toBe(true);
    expect(templateComponentsById.has("built-in-title-card")).toBe(true);
    expect(templateComponentsById.has("built-in-intro-scene")).toBe(true);
    expect(templateComponentsById.has("built-in-outro-scene")).toBe(true);
  });

  it("getTemplateComponent should return correct definition", () => {
    const lowerThird = getTemplateComponent("built-in-lower-third");
    expect(lowerThird).toBeDefined();
    expect(lowerThird?.name).toBe("Lower Third");

    const titleCard = getTemplateComponent("built-in-title-card");
    expect(titleCard).toBeDefined();
    expect(titleCard?.name).toBe("Title Card");

    const intro = getTemplateComponent("built-in-intro-scene");
    expect(intro).toBeDefined();
    expect(intro?.name).toBe("Intro Scene");

    const outro = getTemplateComponent("built-in-outro-scene");
    expect(outro).toBeDefined();
    expect(outro?.name).toBe("Outro Scene");
  });

  it("getTemplateComponent should return undefined for unknown id", () => {
    const unknown = getTemplateComponent("unknown-component");
    expect(unknown).toBeUndefined();
  });

  it("isTemplateComponent should return true for template components", () => {
    expect(isTemplateComponent("built-in-lower-third")).toBe(true);
    expect(isTemplateComponent("built-in-title-card")).toBe(true);
    expect(isTemplateComponent("built-in-intro-scene")).toBe(true);
    expect(isTemplateComponent("built-in-outro-scene")).toBe(true);
  });

  it("isTemplateComponent should return false for non-template components", () => {
    expect(isTemplateComponent("unknown")).toBe(false);
    expect(isTemplateComponent("built-in-typewriter")).toBe(false);
    expect(isTemplateComponent("built-in-wipe")).toBe(false);
    expect(isTemplateComponent("")).toBe(false);
  });

  it("all definitions should have template category", () => {
    for (const def of templateComponentDefinitions) {
      expect(def.category).toBe("template");
    }
  });

  it("all definitions should be built-in source", () => {
    for (const def of templateComponentDefinitions) {
      expect(def.source).toBe("built-in");
    }
  });

  it("all definitions should have standard dimensions", () => {
    for (const def of templateComponentDefinitions) {
      expect(def.width).toBe(1920);
      expect(def.height).toBe(1080);
      expect(def.fps).toBe(30);
    }
  });

  it("all definitions should have valid components", () => {
    for (const def of templateComponentDefinitions) {
      expect(typeof def.component).toBe("function");
    }
  });

  it("all definitions should have valid schemas", () => {
    for (const def of templateComponentDefinitions) {
      expect(def.schema).toBeDefined();
      expect(typeof def.schema.safeParse).toBe("function");
    }
  });

  it("all definitions should have version 1.0.0", () => {
    for (const def of templateComponentDefinitions) {
      expect(def.version).toBe("1.0.0");
    }
  });

  it("all definitions should have QCut as author", () => {
    for (const def of templateComponentDefinitions) {
      expect(def.author).toBe("QCut");
    }
  });
});
