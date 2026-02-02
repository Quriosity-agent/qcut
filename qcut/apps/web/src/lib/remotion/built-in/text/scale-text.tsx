/**
 * Scale Text Animation Component
 *
 * Animates text scaling in with various effects like zoom, pop, and grow.
 *
 * @module lib/remotion/built-in/text/scale-text
 */

import { Fragment, type FC, type ComponentType } from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import { z } from "zod";
import type { RemotionComponentDefinition } from "../../types";

// ============================================================================
// Schema
// ============================================================================

/**
 * Zod schema for ScaleText component props
 */
export const ScaleTextSchema = z.object({
  /** Text to display */
  text: z.string().min(1).default("Scale Up!"),
  /** Font size in pixels */
  fontSize: z.number().min(8).max(200).default(72),
  /** Font family */
  fontFamily: z.string().default("sans-serif"),
  /** Text color */
  color: z.string().default("#ffffff"),
  /** Background color */
  backgroundColor: z.string().default("transparent"),
  /** Scale mode */
  scaleMode: z.enum(["all", "word", "character"]).default("all"),
  /** Animation style */
  animationStyle: z.enum(["zoom", "pop", "grow", "shrink"]).default("pop"),
  /** Duration of animation in frames */
  animationDuration: z.number().min(1).max(300).default(30),
  /** Delay between elements (in frames) */
  staggerDelay: z.number().min(0).max(30).default(3),
  /** Start delay in frames */
  startDelay: z.number().min(0).default(0),
  /** Initial scale (for zoom/grow) */
  initialScale: z.number().min(0).max(5).default(0),
  /** Final scale */
  finalScale: z.number().min(0.1).max(5).default(1),
  /** Overshoot scale (for pop effect) */
  overshootScale: z.number().min(1).max(3).default(1.2),
  /** Spring damping (for spring animations) */
  damping: z.number().min(1).max(100).default(12),
  /** Spring stiffness */
  stiffness: z.number().min(1).max(500).default(200),
  /** Text alignment */
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  /** Font weight */
  fontWeight: z.enum(["normal", "bold", "lighter", "bolder"]).default("bold"),
  /** Include rotation with scale */
  includeRotation: z.boolean().default(false),
  /** Initial rotation in degrees */
  initialRotation: z.number().min(-360).max(360).default(0),
  /** Include fade with scale */
  includeFade: z.boolean().default(true),
});

export type ScaleTextProps = z.infer<typeof ScaleTextSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const scaleTextDefaultProps: ScaleTextProps = {
  text: "Scale Up!",
  fontSize: 72,
  fontFamily: "sans-serif",
  color: "#ffffff",
  backgroundColor: "transparent",
  scaleMode: "all",
  animationStyle: "pop",
  animationDuration: 30,
  staggerDelay: 3,
  startDelay: 0,
  initialScale: 0,
  finalScale: 1,
  overshootScale: 1.2,
  damping: 12,
  stiffness: 200,
  textAlign: "center",
  fontWeight: "bold",
  includeRotation: false,
  initialRotation: 0,
  includeFade: true,
};

// ============================================================================
// Component
// ============================================================================

/**
 * Scale Text animation component
 *
 * Displays text with various scaling animations.
 */
export const ScaleText: FC<Partial<ScaleTextProps>> = ({
  text = scaleTextDefaultProps.text,
  fontSize = scaleTextDefaultProps.fontSize,
  fontFamily = scaleTextDefaultProps.fontFamily,
  color = scaleTextDefaultProps.color,
  backgroundColor = scaleTextDefaultProps.backgroundColor,
  scaleMode = scaleTextDefaultProps.scaleMode,
  animationStyle = scaleTextDefaultProps.animationStyle,
  animationDuration = scaleTextDefaultProps.animationDuration,
  staggerDelay = scaleTextDefaultProps.staggerDelay,
  startDelay = scaleTextDefaultProps.startDelay,
  initialScale = scaleTextDefaultProps.initialScale,
  finalScale = scaleTextDefaultProps.finalScale,
  overshootScale = scaleTextDefaultProps.overshootScale,
  damping = scaleTextDefaultProps.damping,
  stiffness = scaleTextDefaultProps.stiffness,
  textAlign = scaleTextDefaultProps.textAlign,
  fontWeight = scaleTextDefaultProps.fontWeight,
  includeRotation = scaleTextDefaultProps.includeRotation,
  initialRotation = scaleTextDefaultProps.initialRotation,
  includeFade = scaleTextDefaultProps.includeFade,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Calculate scale and other transforms for an element
  const calculateAnimation = (elementIndex: number) => {
    const elementStart = startDelay + elementIndex * staggerDelay;
    const activeFrame = Math.max(0, frame - elementStart);

    let scale: number;
    let rotation: number;
    let opacity: number;

    switch (animationStyle) {
      case "zoom": {
        // Linear zoom in
        const progress = interpolate(
          activeFrame,
          [0, animationDuration],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.ease),
          }
        );
        scale = interpolate(progress, [0, 1], [initialScale, finalScale]);
        break;
      }

      case "pop": {
        // Spring-based pop with overshoot
        const springProgress = spring({
          fps,
          frame: activeFrame,
          config: {
            damping,
            stiffness,
            mass: 0.5,
            overshootClamping: false,
          },
        });
        scale = interpolate(springProgress, [0, 1], [initialScale, finalScale]);
        break;
      }

      case "grow": {
        // Smooth grow with ease-out
        const progress = interpolate(
          activeFrame,
          [0, animationDuration],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          }
        );
        scale = interpolate(progress, [0, 1], [initialScale, finalScale]);
        break;
      }

      case "shrink": {
        // Start big and shrink to final scale
        const progress = interpolate(
          activeFrame,
          [0, animationDuration],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.ease),
          }
        );
        // For shrink, start at overshootScale and shrink to finalScale
        scale = interpolate(progress, [0, 1], [overshootScale, finalScale]);
        break;
      }

      default:
        scale = finalScale;
    }

    // Rotation animation
    rotation = includeRotation
      ? interpolate(activeFrame, [0, animationDuration], [initialRotation, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.ease),
        })
      : 0;

    // Opacity animation
    opacity = includeFade
      ? interpolate(activeFrame, [0, animationDuration / 3], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

    return { scale, rotation, opacity };
  };

  // Render function for a single element with animation
  const renderElement = (content: string, index: number, key: string) => {
    const { scale, rotation, opacity } = calculateAnimation(index);

    return (
      <span
        key={key}
        style={{
          display: "inline-block",
          transform: `scale(${scale}) rotate(${rotation}deg)`,
          opacity,
          whiteSpace: "pre",
          transformOrigin: "center",
        }}
      >
        {content}
      </span>
    );
  };

  // Render based on scale mode
  const renderText = () => {
    if (scaleMode === "all") {
      const { scale, rotation, opacity } = calculateAnimation(0);

      return (
        <span
          style={{
            display: "inline-block",
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            opacity,
            transformOrigin: "center",
          }}
        >
          {text}
        </span>
      );
    }

    if (scaleMode === "word") {
      const words = text.split(" ");
      return words.map((word, i) => (
        <Fragment key={`word-${i}`}>
          {renderElement(word, i, `word-${i}`)}
          {i < words.length - 1 && (
            <span style={{ display: "inline-block" }}>&nbsp;</span>
          )}
        </Fragment>
      ));
    }

    if (scaleMode === "character") {
      return text
        .split("")
        .map((char, i) =>
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
 * Scale Text component definition for QCut
 */
export const ScaleTextDefinition: RemotionComponentDefinition = {
  id: "built-in-scale-text",
  name: "Scale Text",
  description:
    "Animates text scaling in with zoom, pop, grow, or shrink effects",
  category: "text",
  durationInFrames: 90,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: ScaleTextSchema,
  defaultProps: scaleTextDefaultProps,
  component: ScaleText as ComponentType<Record<string, unknown>>,
  source: "built-in",
  tags: ["text", "animation", "scale", "zoom", "pop"],
  version: "1.0.0",
  author: "QCut",
};

export default ScaleText;
