/**
 * Fade In Text Animation Component
 *
 * Animates text fading in with optional word-by-word or character-by-character effects.
 *
 * @module lib/remotion/built-in/text/fade-in-text
 */

import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { z } from "zod";
import type { RemotionComponentDefinition } from "../../types";

// ============================================================================
// Schema
// ============================================================================

/**
 * Zod schema for FadeInText component props
 */
export const FadeInTextSchema = z.object({
  /** Text to display */
  text: z.string().min(1).default("Fade In Text"),
  /** Font size in pixels */
  fontSize: z.number().min(8).max(200).default(64),
  /** Font family */
  fontFamily: z.string().default("sans-serif"),
  /** Text color */
  color: z.string().default("#ffffff"),
  /** Background color */
  backgroundColor: z.string().default("transparent"),
  /** Fade mode */
  fadeMode: z.enum(["all", "word", "character"]).default("all"),
  /** Duration of fade in frames */
  fadeDuration: z.number().min(1).max(300).default(30),
  /** Delay between elements when using word/character mode (in frames) */
  staggerDelay: z.number().min(0).max(30).default(5),
  /** Start delay in frames */
  startDelay: z.number().min(0).default(0),
  /** Easing function */
  easing: z
    .enum(["linear", "easeIn", "easeOut", "easeInOut"])
    .default("easeOut"),
  /** Text alignment */
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  /** Font weight */
  fontWeight: z.enum(["normal", "bold", "lighter", "bolder"]).default("normal"),
  /** Include vertical movement */
  slideUp: z.boolean().default(false),
  /** Slide distance in pixels */
  slideDistance: z.number().min(0).max(200).default(20),
});

export type FadeInTextProps = z.infer<typeof FadeInTextSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const fadeInTextDefaultProps: FadeInTextProps = {
  text: "Fade In Text",
  fontSize: 64,
  fontFamily: "sans-serif",
  color: "#ffffff",
  backgroundColor: "transparent",
  fadeMode: "all",
  fadeDuration: 30,
  staggerDelay: 5,
  startDelay: 0,
  easing: "easeOut",
  textAlign: "center",
  fontWeight: "normal",
  slideUp: false,
  slideDistance: 20,
};

// ============================================================================
// Helper Functions
// ============================================================================

function getEasingFunction(easing: string): (t: number) => number {
  switch (easing) {
    case "linear":
      return Easing.linear;
    case "easeIn":
      return Easing.ease;
    case "easeOut":
      return Easing.out(Easing.ease);
    case "easeInOut":
      return Easing.inOut(Easing.ease);
    default:
      return Easing.out(Easing.ease);
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Fade In Text animation component
 *
 * Displays text with fade-in animation, supporting various modes.
 */
export const FadeInText: React.FC<Partial<FadeInTextProps>> = ({
  text = fadeInTextDefaultProps.text,
  fontSize = fadeInTextDefaultProps.fontSize,
  fontFamily = fadeInTextDefaultProps.fontFamily,
  color = fadeInTextDefaultProps.color,
  backgroundColor = fadeInTextDefaultProps.backgroundColor,
  fadeMode = fadeInTextDefaultProps.fadeMode,
  fadeDuration = fadeInTextDefaultProps.fadeDuration,
  staggerDelay = fadeInTextDefaultProps.staggerDelay,
  startDelay = fadeInTextDefaultProps.startDelay,
  easing = fadeInTextDefaultProps.easing,
  textAlign = fadeInTextDefaultProps.textAlign,
  fontWeight = fadeInTextDefaultProps.fontWeight,
  slideUp = fadeInTextDefaultProps.slideUp,
  slideDistance = fadeInTextDefaultProps.slideDistance,
}) => {
  const frame = useCurrentFrame();
  const easingFn = getEasingFunction(easing);

  // Calculate active frame after start delay
  const activeFrame = Math.max(0, frame - startDelay);

  // Render function for a single element with animation
  const renderElement = (content: string, index: number, key: string) => {
    const elementStart = index * staggerDelay;
    const elementEnd = elementStart + fadeDuration;

    const opacity = interpolate(
      activeFrame,
      [elementStart, elementEnd],
      [0, 1],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: easingFn,
      }
    );

    const translateY = slideUp
      ? interpolate(
          activeFrame,
          [elementStart, elementEnd],
          [slideDistance, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easingFn,
          }
        )
      : 0;

    return (
      <span
        key={key}
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          display: "inline-block",
          whiteSpace: "pre",
        }}
      >
        {content}
      </span>
    );
  };

  // Render based on fade mode
  const renderText = () => {
    if (fadeMode === "all") {
      const opacity = interpolate(activeFrame, [0, fadeDuration], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: easingFn,
      });

      const translateY = slideUp
        ? interpolate(activeFrame, [0, fadeDuration], [slideDistance, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: easingFn,
          })
        : 0;

      return (
        <span
          style={{
            opacity,
            transform: `translateY(${translateY}px)`,
            display: "inline-block",
          }}
        >
          {text}
        </span>
      );
    }

    if (fadeMode === "word") {
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

    if (fadeMode === "character") {
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
 * Fade In Text component definition for QCut
 */
export const FadeInTextDefinition: RemotionComponentDefinition = {
  id: "built-in-fade-in-text",
  name: "Fade In Text",
  description:
    "Animates text fading in with optional word-by-word or character effects",
  category: "text",
  durationInFrames: 90,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: FadeInTextSchema,
  defaultProps: fadeInTextDefaultProps,
  component: FadeInText as React.ComponentType<Record<string, unknown>>,
  source: "built-in",
  tags: ["text", "animation", "fade", "opacity"],
  version: "1.0.0",
  author: "QCut",
};

export default FadeInText;
