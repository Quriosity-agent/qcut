/**
 * Slide Text Animation Component
 *
 * Animates text sliding in from a specified direction.
 *
 * @module lib/remotion/built-in/text/slide-text
 */

import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { z } from "zod";
import type { RemotionComponentDefinition } from "../../types";

// ============================================================================
// Schema
// ============================================================================

/**
 * Zod schema for SlideText component props
 */
export const SlideTextSchema = z.object({
  /** Text to display */
  text: z.string().min(1).default("Slide In"),
  /** Font size in pixels */
  fontSize: z.number().min(8).max(200).default(64),
  /** Font family */
  fontFamily: z.string().default("sans-serif"),
  /** Text color */
  color: z.string().default("#ffffff"),
  /** Background color */
  backgroundColor: z.string().default("transparent"),
  /** Slide direction */
  direction: z.enum(["left", "right", "top", "bottom"]).default("left"),
  /** Slide mode */
  slideMode: z.enum(["all", "word", "character"]).default("all"),
  /** Duration of slide in frames */
  slideDuration: z.number().min(1).max(300).default(30),
  /** Delay between elements (in frames) */
  staggerDelay: z.number().min(0).max(30).default(4),
  /** Start delay in frames */
  startDelay: z.number().min(0).default(0),
  /** Easing function */
  easing: z
    .enum(["linear", "easeIn", "easeOut", "easeInOut", "bounce"])
    .default("easeOut"),
  /** Initial offset distance (percentage of container) */
  offsetPercent: z.number().min(0).max(200).default(100),
  /** Text alignment */
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  /** Font weight */
  fontWeight: z.enum(["normal", "bold", "lighter", "bolder"]).default("normal"),
  /** Include fade with slide */
  includeFade: z.boolean().default(true),
  /** Overshoot amount (for bounce) */
  overshoot: z.number().min(0).max(50).default(10),
});

export type SlideTextProps = z.infer<typeof SlideTextSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const slideTextDefaultProps: SlideTextProps = {
  text: "Slide In",
  fontSize: 64,
  fontFamily: "sans-serif",
  color: "#ffffff",
  backgroundColor: "transparent",
  direction: "left",
  slideMode: "all",
  slideDuration: 30,
  staggerDelay: 4,
  startDelay: 0,
  easing: "easeOut",
  offsetPercent: 100,
  textAlign: "center",
  fontWeight: "normal",
  includeFade: true,
  overshoot: 10,
};

// ============================================================================
// Helper Functions
// ============================================================================

function getEasingFunction(
  easing: string,
  overshoot: number
): (t: number) => number {
  switch (easing) {
    case "linear":
      return Easing.linear;
    case "easeIn":
      return Easing.in(Easing.ease);
    case "easeOut":
      return Easing.out(Easing.ease);
    case "easeInOut":
      return Easing.inOut(Easing.ease);
    case "bounce":
      return Easing.out(Easing.back(1 + overshoot / 100));
    default:
      return Easing.out(Easing.ease);
  }
}

function getInitialOffset(
  direction: string,
  offsetPercent: number
): { x: string; y: string } {
  const offset = `${offsetPercent}%`;
  switch (direction) {
    case "left":
      return { x: `-${offset}`, y: "0" };
    case "right":
      return { x: offset, y: "0" };
    case "top":
      return { x: "0", y: `-${offset}` };
    case "bottom":
      return { x: "0", y: offset };
    default:
      return { x: `-${offset}`, y: "0" };
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Slide Text animation component
 *
 * Displays text with slide-in animation from specified direction.
 */
export const SlideText: React.FC<Partial<SlideTextProps>> = ({
  text = slideTextDefaultProps.text,
  fontSize = slideTextDefaultProps.fontSize,
  fontFamily = slideTextDefaultProps.fontFamily,
  color = slideTextDefaultProps.color,
  backgroundColor = slideTextDefaultProps.backgroundColor,
  direction = slideTextDefaultProps.direction,
  slideMode = slideTextDefaultProps.slideMode,
  slideDuration = slideTextDefaultProps.slideDuration,
  staggerDelay = slideTextDefaultProps.staggerDelay,
  startDelay = slideTextDefaultProps.startDelay,
  easing = slideTextDefaultProps.easing,
  offsetPercent = slideTextDefaultProps.offsetPercent,
  textAlign = slideTextDefaultProps.textAlign,
  fontWeight = slideTextDefaultProps.fontWeight,
  includeFade = slideTextDefaultProps.includeFade,
  overshoot = slideTextDefaultProps.overshoot,
}) => {
  const frame = useCurrentFrame();
  const easingFn = getEasingFunction(easing, overshoot);
  const initialOffset = getInitialOffset(direction, offsetPercent);

  // Render function for a single element with animation
  const renderElement = (content: string, index: number, key: string) => {
    const elementStart = startDelay + index * staggerDelay;
    const elementEnd = elementStart + slideDuration;

    // Progress for x/y translation
    const progress = interpolate(frame, [elementStart, elementEnd], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: easingFn,
    });

    // Calculate transform
    const isHorizontal = direction === "left" || direction === "right";
    const translateX = isHorizontal
      ? interpolate(progress, [0, 1], [parseFloat(initialOffset.x), 0])
      : 0;
    const translateY = isHorizontal
      ? 0
      : interpolate(progress, [0, 1], [parseFloat(initialOffset.y), 0]);

    // Opacity animation
    const opacity = includeFade
      ? interpolate(
          frame,
          [elementStart, elementStart + slideDuration / 3],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }
        )
      : 1;

    return (
      <span
        key={key}
        style={{
          display: "inline-block",
          transform: `translate(${translateX}%, ${translateY}%)`,
          opacity,
          whiteSpace: "pre",
        }}
      >
        {content}
      </span>
    );
  };

  // Render based on slide mode
  const renderText = () => {
    if (slideMode === "all") {
      const elementStart = startDelay;
      const elementEnd = elementStart + slideDuration;

      const progress = interpolate(frame, [elementStart, elementEnd], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: easingFn,
      });

      const isHorizontal = direction === "left" || direction === "right";
      const translateX = isHorizontal
        ? interpolate(progress, [0, 1], [parseFloat(initialOffset.x), 0])
        : 0;
      const translateY = isHorizontal
        ? 0
        : interpolate(progress, [0, 1], [parseFloat(initialOffset.y), 0]);

      const opacity = includeFade
        ? interpolate(
            frame,
            [elementStart, elementStart + slideDuration / 3],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }
          )
        : 1;

      return (
        <span
          style={{
            display: "inline-block",
            transform: `translate(${translateX}%, ${translateY}%)`,
            opacity,
          }}
        >
          {text}
        </span>
      );
    }

    if (slideMode === "word") {
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

    if (slideMode === "character") {
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
        overflow: "hidden",
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
 * Slide Text component definition for QCut
 */
export const SlideTextDefinition: RemotionComponentDefinition = {
  id: "built-in-slide-text",
  name: "Slide Text",
  description: "Animates text sliding in from a specified direction",
  category: "text",
  durationInFrames: 90,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: SlideTextSchema,
  defaultProps: slideTextDefaultProps,
  component: SlideText as React.ComponentType<Record<string, unknown>>,
  source: "built-in",
  tags: ["text", "animation", "slide", "motion"],
  version: "1.0.0",
  author: "QCut",
};

export default SlideText;
