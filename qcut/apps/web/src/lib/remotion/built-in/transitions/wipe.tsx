/**
 * Wipe Transition Component
 *
 * A transition effect that wipes from one side to reveal new content.
 *
 * @module lib/remotion/built-in/transitions/wipe
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
 * Zod schema for Wipe transition component props
 */
export const WipeSchema = z.object({
  /** Direction of the wipe */
  direction: z.enum(["left", "right", "up", "down"]).default("left"),
  /** Background color (what's revealed) */
  backgroundColor: z.string().default("#000000"),
  /** Foreground color (what's being wiped away) */
  foregroundColor: z.string().default("#ffffff"),
  /** Duration of wipe in frames (uses full component duration if not specified) */
  wipeDuration: z.number().min(1).optional(),
  /** Easing function */
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut"]).default("easeInOut"),
  /** Edge softness in pixels (0 = hard edge) */
  edgeSoftness: z.number().min(0).max(200).default(0),
  /** Start delay in frames */
  startDelay: z.number().min(0).default(0),
  /** Show content A (typically outgoing scene) */
  showContentA: z.boolean().default(true),
  /** Show content B (typically incoming scene) */
  showContentB: z.boolean().default(true),
});

export type WipeProps = z.infer<typeof WipeSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const wipeDefaultProps: WipeProps = {
  direction: "left",
  backgroundColor: "#000000",
  foregroundColor: "#ffffff",
  easing: "easeInOut",
  edgeSoftness: 0,
  startDelay: 0,
  showContentA: true,
  showContentB: true,
};

// ============================================================================
// Helper Functions
// ============================================================================

function getEasingFunction(easing: string): ((t: number) => number) {
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
      return Easing.inOut(Easing.ease);
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Wipe transition component
 *
 * Creates a wipe effect from one side to another.
 */
export const Wipe: React.FC<Partial<WipeProps>> = ({
  direction = wipeDefaultProps.direction,
  backgroundColor = wipeDefaultProps.backgroundColor,
  foregroundColor = wipeDefaultProps.foregroundColor,
  wipeDuration,
  easing = wipeDefaultProps.easing,
  edgeSoftness = wipeDefaultProps.edgeSoftness,
  startDelay = wipeDefaultProps.startDelay,
  showContentA = wipeDefaultProps.showContentA,
  showContentB = wipeDefaultProps.showContentB,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const easingFn = getEasingFunction(easing);

  // Calculate actual wipe duration
  const actualDuration = wipeDuration ?? (durationInFrames - startDelay);
  const activeFrame = Math.max(0, frame - startDelay);

  // Calculate progress (0 to 1)
  const progress = interpolate(
    activeFrame,
    [0, actualDuration],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: easingFn,
    }
  );

  // Calculate clip path based on direction
  const getClipPath = (forForeground: boolean) => {
    const p = forForeground ? 1 - progress : progress;
    const soft = edgeSoftness;

    switch (direction) {
      case "left":
        // Wipe from left to right
        return forForeground
          ? `inset(0 ${p * 100}% 0 0)`
          : `inset(0 0 0 ${(1 - p) * 100}%)`;
      case "right":
        // Wipe from right to left
        return forForeground
          ? `inset(0 0 0 ${p * 100}%)`
          : `inset(0 ${(1 - p) * 100}% 0 0)`;
      case "up":
        // Wipe from top to bottom
        return forForeground
          ? `inset(0 0 ${p * 100}% 0)`
          : `inset(${(1 - p) * 100}% 0 0 0)`;
      case "down":
        // Wipe from bottom to top
        return forForeground
          ? `inset(${p * 100}% 0 0 0)`
          : `inset(0 0 ${(1 - p) * 100}% 0)`;
      default:
        return "inset(0)";
    }
  };

  // Calculate gradient for soft edge
  const getGradientMask = () => {
    if (edgeSoftness === 0) return undefined;

    const gradientDir = {
      left: "to right",
      right: "to left",
      up: "to bottom",
      down: "to top",
    }[direction];

    const edgePos = progress * 100;
    const softStart = Math.max(0, edgePos - edgeSoftness / 2);
    const softEnd = Math.min(100, edgePos + edgeSoftness / 2);

    return `linear-gradient(${gradientDir}, black ${softStart}%, transparent ${softEnd}%)`;
  };

  return (
    <AbsoluteFill>
      {/* Background (Content B / Incoming) */}
      {showContentB && (
        <AbsoluteFill
          style={{
            backgroundColor,
          }}
        />
      )}

      {/* Foreground (Content A / Outgoing) with clip */}
      {showContentA && (
        <AbsoluteFill
          style={{
            backgroundColor: foregroundColor,
            clipPath: getClipPath(true),
            WebkitClipPath: getClipPath(true),
            ...(edgeSoftness > 0 && {
              maskImage: getGradientMask(),
              WebkitMaskImage: getGradientMask(),
            }),
          }}
        />
      )}
    </AbsoluteFill>
  );
};

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Wipe transition component definition for QCut
 */
export const WipeDefinition: RemotionComponentDefinition = {
  id: "built-in-wipe",
  name: "Wipe",
  description: "Wipes from one side to reveal new content",
  category: "transition",
  durationInFrames: 30,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: WipeSchema,
  defaultProps: wipeDefaultProps,
  component: Wipe as React.ComponentType<Record<string, unknown>>,
  source: "built-in",
  tags: ["transition", "wipe", "reveal"],
  version: "1.0.0",
  author: "QCut",
};

export default Wipe;
