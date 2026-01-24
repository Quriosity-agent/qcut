/**
 * Bounce Text Animation Component
 *
 * Animates text with a bouncy spring effect, letter by letter.
 *
 * @module lib/remotion/built-in/text/bounce-text
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { z } from "zod";
import type { RemotionComponentDefinition } from "../../types";

// ============================================================================
// Schema
// ============================================================================

/**
 * Zod schema for BounceText component props
 */
export const BounceTextSchema = z.object({
  /** Text to display */
  text: z.string().min(1).default("Bounce!"),
  /** Font size in pixels */
  fontSize: z.number().min(8).max(200).default(72),
  /** Font family */
  fontFamily: z.string().default("sans-serif"),
  /** Text color */
  color: z.string().default("#ffffff"),
  /** Background color */
  backgroundColor: z.string().default("transparent"),
  /** Bounce mode */
  bounceMode: z.enum(["all", "word", "character"]).default("character"),
  /** Delay between elements (in frames) */
  staggerDelay: z.number().min(0).max(30).default(3),
  /** Start delay in frames */
  startDelay: z.number().min(0).default(0),
  /** Spring damping (higher = less bouncy) */
  damping: z.number().min(1).max(100).default(10),
  /** Spring stiffness */
  stiffness: z.number().min(1).max(500).default(100),
  /** Spring mass */
  mass: z.number().min(0.1).max(10).default(0.5),
  /** Bounce direction */
  direction: z.enum(["up", "down", "left", "right"]).default("up"),
  /** Initial offset distance in pixels */
  offsetDistance: z.number().min(0).max(500).default(100),
  /** Text alignment */
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  /** Font weight */
  fontWeight: z.enum(["normal", "bold", "lighter", "bolder"]).default("bold"),
  /** Include scale animation */
  includeScale: z.boolean().default(true),
  /** Initial scale (0-1) */
  initialScale: z.number().min(0).max(2).default(0),
});

export type BounceTextProps = z.infer<typeof BounceTextSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const bounceTextDefaultProps: BounceTextProps = {
  text: "Bounce!",
  fontSize: 72,
  fontFamily: "sans-serif",
  color: "#ffffff",
  backgroundColor: "transparent",
  bounceMode: "character",
  staggerDelay: 3,
  startDelay: 0,
  damping: 10,
  stiffness: 100,
  mass: 0.5,
  direction: "up",
  offsetDistance: 100,
  textAlign: "center",
  fontWeight: "bold",
  includeScale: true,
  initialScale: 0,
};

// ============================================================================
// Helper Functions
// ============================================================================

function getTransformForDirection(
  direction: string,
  offset: number
): { x: number; y: number } {
  switch (direction) {
    case "up":
      return { x: 0, y: offset };
    case "down":
      return { x: 0, y: -offset };
    case "left":
      return { x: offset, y: 0 };
    case "right":
      return { x: -offset, y: 0 };
    default:
      return { x: 0, y: offset };
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Bounce Text animation component
 *
 * Displays text with spring-based bounce animation.
 */
export const BounceText: React.FC<BounceTextProps> = ({
  text = bounceTextDefaultProps.text,
  fontSize = bounceTextDefaultProps.fontSize,
  fontFamily = bounceTextDefaultProps.fontFamily,
  color = bounceTextDefaultProps.color,
  backgroundColor = bounceTextDefaultProps.backgroundColor,
  bounceMode = bounceTextDefaultProps.bounceMode,
  staggerDelay = bounceTextDefaultProps.staggerDelay,
  startDelay = bounceTextDefaultProps.startDelay,
  damping = bounceTextDefaultProps.damping,
  stiffness = bounceTextDefaultProps.stiffness,
  mass = bounceTextDefaultProps.mass,
  direction = bounceTextDefaultProps.direction,
  offsetDistance = bounceTextDefaultProps.offsetDistance,
  textAlign = bounceTextDefaultProps.textAlign,
  fontWeight = bounceTextDefaultProps.fontWeight,
  includeScale = bounceTextDefaultProps.includeScale,
  initialScale = bounceTextDefaultProps.initialScale,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Render function for a single element with animation
  const renderElement = (content: string, index: number, key: string) => {
    const elementFrame = Math.max(0, frame - startDelay - index * staggerDelay);

    // Spring animation progress
    const springProgress = spring({
      fps,
      frame: elementFrame,
      config: {
        damping,
        stiffness,
        mass,
      },
    });

    // Calculate transform based on direction
    const initialOffset = getTransformForDirection(direction, offsetDistance);
    const translateX = interpolate(springProgress, [0, 1], [initialOffset.x, 0]);
    const translateY = interpolate(springProgress, [0, 1], [initialOffset.y, 0]);

    // Scale animation
    const scale = includeScale
      ? interpolate(springProgress, [0, 1], [initialScale, 1])
      : 1;

    // Opacity
    const opacity = interpolate(springProgress, [0, 0.3], [0, 1], {
      extrapolateRight: "clamp",
    });

    return (
      <span
        key={key}
        style={{
          display: "inline-block",
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          opacity,
          whiteSpace: "pre",
        }}
      >
        {content}
      </span>
    );
  };

  // Render based on bounce mode
  const renderText = () => {
    if (bounceMode === "all") {
      const elementFrame = Math.max(0, frame - startDelay);

      const springProgress = spring({
        fps,
        frame: elementFrame,
        config: {
          damping,
          stiffness,
          mass,
        },
      });

      const initialOffset = getTransformForDirection(direction, offsetDistance);
      const translateX = interpolate(springProgress, [0, 1], [initialOffset.x, 0]);
      const translateY = interpolate(springProgress, [0, 1], [initialOffset.y, 0]);
      const scale = includeScale
        ? interpolate(springProgress, [0, 1], [initialScale, 1])
        : 1;
      const opacity = interpolate(springProgress, [0, 0.3], [0, 1], {
        extrapolateRight: "clamp",
      });

      return (
        <span
          style={{
            display: "inline-block",
            transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
            opacity,
          }}
        >
          {text}
        </span>
      );
    }

    if (bounceMode === "word") {
      const words = text.split(" ");
      return words.map((word, i) => (
        <React.Fragment key={`word-${i}`}>
          {renderElement(word, i, `word-${i}`)}
          {i < words.length - 1 && (
            <span style={{ display: "inline-block" }}>&nbsp;</span>
          )}
        </React.Fragment>
      ));
    }

    if (bounceMode === "character") {
      return text.split("").map((char, i) =>
        renderElement(char === " " ? "\u00A0" : char, i, `char-${i}`)
      );
    }

    return text;
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent:
          textAlign === "center"
            ? "center"
            : textAlign === "right"
            ? "flex-end"
            : "flex-start",
        width: "100%",
        height: "100%",
        backgroundColor,
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          fontSize,
          fontFamily,
          color,
          fontWeight,
          textAlign,
          lineHeight: 1.2,
        }}
      >
        {renderText()}
      </div>
    </div>
  );
};

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Bounce Text component definition for QCut
 */
export const BounceTextDefinition: RemotionComponentDefinition = {
  id: "built-in-bounce-text",
  name: "Bounce Text",
  description: "Animates text with a bouncy spring effect",
  category: "text",
  durationInFrames: 90,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: BounceTextSchema,
  defaultProps: bounceTextDefaultProps,
  component: BounceText,
  source: "built-in",
  tags: ["text", "animation", "bounce", "spring", "kinetic"],
  version: "1.0.0",
  author: "QCut",
};

export default BounceText;
