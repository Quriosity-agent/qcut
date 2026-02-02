/**
 * Dissolve Transition Component
 *
 * A cross-fade/dissolve transition between two scenes.
 *
 * @module lib/remotion/built-in/transitions/dissolve
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
  AbsoluteFill,
} from "remotion";
import { z } from "zod";
import type { RemotionComponentDefinition } from "../../types";

// ============================================================================
// Schema
// ============================================================================

/**
 * Zod schema for Dissolve transition component props
 */
export const DissolveSchema = z.object({
  /** Background color (content B / incoming) */
  backgroundColor: z.string().default("#000000"),
  /** Foreground color (content A / outgoing) */
  foregroundColor: z.string().default("#ffffff"),
  /** Duration of dissolve in frames (uses full duration if not specified) */
  dissolveDuration: z.number().min(1).optional(),
  /** Easing function */
  easing: z
    .enum(["linear", "easeIn", "easeOut", "easeInOut"])
    .default("linear"),
  /** Start delay in frames */
  startDelay: z.number().min(0).default(0),
  /** Dissolve style */
  style: z.enum(["fade", "additive", "dither"]).default("fade"),
  /** Dither pattern size (only for dither style) */
  ditherSize: z.number().min(1).max(50).default(4),
});

export type DissolveProps = z.infer<typeof DissolveSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const dissolveDefaultProps: DissolveProps = {
  backgroundColor: "#000000",
  foregroundColor: "#ffffff",
  easing: "linear",
  startDelay: 0,
  style: "fade",
  ditherSize: 4,
};

// ============================================================================
// Helper Functions
// ============================================================================

function getEasingFunction(easing: string): (t: number) => number {
  switch (easing) {
    case "linear":
      return Easing.linear;
    case "easeIn":
      return Easing.in(Easing.ease);
    case "easeOut":
      return Easing.out(Easing.ease);
    case "easeInOut":
      return Easing.inOut(Easing.ease);
    default:
      return Easing.linear;
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dissolve transition component
 *
 * Creates a cross-fade effect between two scenes.
 */
export const Dissolve: React.FC<Partial<DissolveProps>> = ({
  backgroundColor = dissolveDefaultProps.backgroundColor,
  foregroundColor = dissolveDefaultProps.foregroundColor,
  dissolveDuration,
  easing = dissolveDefaultProps.easing,
  startDelay = dissolveDefaultProps.startDelay,
  style = dissolveDefaultProps.style,
  ditherSize = dissolveDefaultProps.ditherSize,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const easingFn = getEasingFunction(easing);

  // Calculate actual dissolve duration (ensure at least 1 to avoid zero/negative interpolation)
  const actualDuration =
    dissolveDuration ?? Math.max(1, durationInFrames - startDelay);
  const activeFrame = Math.max(0, frame - startDelay);

  // Calculate progress (0 to 1)
  const progress = interpolate(activeFrame, [0, actualDuration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easingFn,
  });

  // Foreground opacity (fading out)
  const foregroundOpacity = 1 - progress;

  // Background opacity (fading in)
  const backgroundOpacity = progress;

  // Generate dither pattern SVG
  const getDitherPattern = () => {
    if (style !== "dither") return;

    // Create a simple dither pattern based on progress
    const threshold = progress;
    const patternId = `dither-${Math.floor(progress * 100)}`;

    return (
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <pattern
            id={patternId}
            width={ditherSize}
            height={ditherSize}
            patternUnits="userSpaceOnUse"
          >
            {/* Simple ordered dither pattern */}
            {Array.from({ length: ditherSize * ditherSize }).map((_, i) => {
              const x = i % ditherSize;
              const y = Math.floor(i / ditherSize);
              // Bayer matrix approximation
              const ditherValue = ditherSize > 1 ? (x ^ y) / (ditherSize - 1) : 0;
              const show = ditherValue < threshold;
              return show ? (
                <rect key={i} x={x} y={y} width={1} height={1} fill="white" />
              ) : null;
            })}
          </pattern>
        </defs>
      </svg>
    );
  };

  return (
    <AbsoluteFill>
      {/* Background (Content B / Incoming) */}
      <AbsoluteFill
        style={{
          backgroundColor,
          opacity: style === "additive" ? 1 : backgroundOpacity,
        }}
      />

      {/* Foreground (Content A / Outgoing) */}
      <AbsoluteFill
        style={{
          backgroundColor: foregroundColor,
          opacity: foregroundOpacity,
          mixBlendMode: style === "additive" ? "screen" : "normal",
        }}
      />

      {/* Dither pattern overlay */}
      {style === "dither" && getDitherPattern()}
    </AbsoluteFill>
  );
};

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Dissolve transition component definition for QCut
 */
export const DissolveDefinition: RemotionComponentDefinition = {
  id: "built-in-dissolve",
  name: "Dissolve",
  description: "Cross-fade transition between two scenes",
  category: "transition",
  durationInFrames: 30,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: DissolveSchema,
  defaultProps: dissolveDefaultProps,
  component: Dissolve as React.ComponentType<Record<string, unknown>>,
  source: "built-in",
  tags: ["transition", "dissolve", "fade", "cross-fade"],
  version: "1.0.0",
  author: "QCut",
};

export default Dissolve;
