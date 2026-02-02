/**
 * Slide Transition Component
 *
 * A transition where scenes slide in/out from a direction.
 *
 * @module lib/remotion/built-in/transitions/slide
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
  AbsoluteFill,
} from "remotion";
import { z } from "zod";
import type { RemotionComponentDefinition } from "../../types";

// ============================================================================
// Schema
// ============================================================================

/**
 * Zod schema for Slide transition component props
 */
export const SlideSchema = z.object({
  /** Direction the new content slides in from */
  direction: z.enum(["left", "right", "up", "down"]).default("left"),
  /** Background color (content B / incoming) */
  backgroundColor: z.string().default("#000000"),
  /** Foreground color (content A / outgoing) */
  foregroundColor: z.string().default("#ffffff"),
  /** Duration of slide in frames (uses full duration if not specified) */
  slideDuration: z.number().min(1).optional(),
  /** Animation type */
  animationType: z
    .enum(["linear", "easeOut", "spring", "bounce"])
    .default("easeOut"),
  /** Start delay in frames */
  startDelay: z.number().min(0).default(0),
  /** Whether outgoing content also slides */
  slideOut: z.boolean().default(true),
  /** Spring damping (for spring animation) */
  damping: z.number().min(1).max(100).default(15),
  /** Spring stiffness (for spring animation) */
  stiffness: z.number().min(1).max(500).default(100),
  /** Gap between scenes during slide (in pixels) */
  gap: z.number().min(0).max(100).default(0),
});

export type SlideProps = z.infer<typeof SlideSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const slideDefaultProps: SlideProps = {
  direction: "left",
  backgroundColor: "#000000",
  foregroundColor: "#ffffff",
  animationType: "easeOut",
  startDelay: 0,
  slideOut: true,
  damping: 15,
  stiffness: 100,
  gap: 0,
};

// ============================================================================
// Component
// ============================================================================

/**
 * Slide transition component
 *
 * Creates a sliding effect where scenes move in from a direction.
 */
export const Slide: React.FC<Partial<SlideProps>> = ({
  direction = slideDefaultProps.direction,
  backgroundColor = slideDefaultProps.backgroundColor,
  foregroundColor = slideDefaultProps.foregroundColor,
  slideDuration,
  animationType = slideDefaultProps.animationType,
  startDelay = slideDefaultProps.startDelay,
  slideOut = slideDefaultProps.slideOut,
  damping = slideDefaultProps.damping,
  stiffness = slideDefaultProps.stiffness,
  gap = slideDefaultProps.gap,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height, fps } = useVideoConfig();

  // Calculate actual slide duration
  const actualDuration = slideDuration ?? durationInFrames - startDelay;
  const activeFrame = Math.max(0, frame - startDelay);

  // Calculate progress based on animation type
  let progress: number;

  if (animationType === "spring" || animationType === "bounce") {
    progress = spring({
      fps,
      frame: activeFrame,
      config: {
        damping: animationType === "bounce" ? damping / 2 : damping,
        stiffness,
        mass: 1,
      },
    });
  } else {
    const easingFn =
      animationType === "linear" ? Easing.linear : Easing.out(Easing.cubic);

    progress = interpolate(activeFrame, [0, actualDuration], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: easingFn,
    });
  }

  // Calculate transforms based on direction
  const getTransform = (isIncoming: boolean) => {
    const distance = isIncoming ? 1 - progress : -progress;
    const gapOffset = isIncoming ? -gap : gap;

    switch (direction) {
      case "left":
        // New content slides in from left
        return isIncoming
          ? `translateX(${-100 * distance}%)`
          : `translateX(${100 * progress + (slideOut ? (gapOffset / width) * 100 : 0)}%)`;
      case "right":
        // New content slides in from right
        return isIncoming
          ? `translateX(${100 * distance}%)`
          : `translateX(${-100 * progress - (slideOut ? (gapOffset / width) * 100 : 0)}%)`;
      case "up":
        // New content slides in from top
        return isIncoming
          ? `translateY(${-100 * distance}%)`
          : `translateY(${100 * progress + (slideOut ? (gapOffset / height) * 100 : 0)}%)`;
      case "down":
        // New content slides in from bottom
        return isIncoming
          ? `translateY(${100 * distance}%)`
          : `translateY(${-100 * progress - (slideOut ? (gapOffset / height) * 100 : 0)}%)`;
      default:
        return "none";
    }
  };

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* Foreground (Content A / Outgoing) */}
      {slideOut && (
        <AbsoluteFill
          style={{
            backgroundColor: foregroundColor,
            transform: getTransform(false),
          }}
        />
      )}

      {/* Background (Content B / Incoming) */}
      <AbsoluteFill
        style={{
          backgroundColor,
          transform: getTransform(true),
        }}
      />
    </AbsoluteFill>
  );
};

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Slide transition component definition for QCut
 */
export const SlideDefinition: RemotionComponentDefinition = {
  id: "built-in-slide-transition",
  name: "Slide Transition",
  description: "Slides content in from a direction",
  category: "transition",
  durationInFrames: 30,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: SlideSchema,
  defaultProps: slideDefaultProps,
  component: Slide as React.ComponentType<Record<string, unknown>>,
  source: "built-in",
  tags: ["transition", "slide", "push", "motion"],
  version: "1.0.0",
  author: "QCut",
};

export default Slide;
