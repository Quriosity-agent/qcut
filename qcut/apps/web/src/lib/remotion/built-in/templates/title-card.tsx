/**
 * Title Card Template Component
 *
 * A full-screen title card for chapter breaks, section headers, or emphasis.
 * Features customizable text, backgrounds, and animations.
 *
 * @module lib/remotion/built-in/templates/title-card
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
 * Zod schema for Title Card component props
 */
export const TitleCardSchema = z.object({
  /** Main title text */
  title: z.string().min(1).default("Chapter One"),
  /** Subtitle text */
  subtitle: z.string().default("The Beginning"),
  /** Title color */
  titleColor: z.string().default("#ffffff"),
  /** Subtitle color */
  subtitleColor: z.string().default("#cccccc"),
  /** Background color */
  backgroundColor: z.string().default("#0a0a0f"),
  /** Accent color for decorative elements */
  accentColor: z.string().default("#4361ee"),
  /** Title font size */
  titleFontSize: z.number().min(24).max(200).default(72),
  /** Subtitle font size */
  subtitleFontSize: z.number().min(12).max(100).default(32),
  /** Font family */
  fontFamily: z.string().default("Inter, sans-serif"),
  /** Text alignment */
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  /** Vertical position */
  verticalPosition: z.enum(["top", "center", "bottom"]).default("center"),
  /** Animation style */
  animationStyle: z.enum(["fade", "scale", "slide-up", "slide-down", "blur"]).default("fade"),
  /** Enter animation duration (frames) */
  enterDuration: z.number().min(1).max(60).default(20),
  /** Hold duration (frames) */
  holdDuration: z.number().min(0).max(300).default(60),
  /** Exit animation duration (frames) */
  exitDuration: z.number().min(1).max(60).default(20),
  /** Show decorative line */
  showDecorativeLine: z.boolean().default(true),
  /** Decorative line width */
  lineWidth: z.number().min(20).max(500).default(100),
  /** Decorative line height */
  lineHeight: z.number().min(1).max(10).default(3),
  /** Gap between title and subtitle */
  textGap: z.number().min(0).max(100).default(20),
  /** Title font weight */
  titleFontWeight: z.number().min(100).max(900).default(700),
  /** Subtitle font weight */
  subtitleFontWeight: z.number().min(100).max(900).default(400),
  /** Letter spacing for title */
  titleLetterSpacing: z.number().min(-5).max(20).default(2),
  /** Text transform for title */
  titleTextTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).default("none"),
});

export type TitleCardProps = z.infer<typeof TitleCardSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const titleCardDefaultProps: TitleCardProps = {
  title: "Chapter One",
  subtitle: "The Beginning",
  titleColor: "#ffffff",
  subtitleColor: "#cccccc",
  backgroundColor: "#0a0a0f",
  accentColor: "#4361ee",
  titleFontSize: 72,
  subtitleFontSize: 32,
  fontFamily: "Inter, sans-serif",
  textAlign: "center",
  verticalPosition: "center",
  animationStyle: "fade",
  enterDuration: 20,
  holdDuration: 60,
  exitDuration: 20,
  showDecorativeLine: true,
  lineWidth: 100,
  lineHeight: 3,
  textGap: 20,
  titleFontWeight: 700,
  subtitleFontWeight: 400,
  titleLetterSpacing: 2,
  titleTextTransform: "none",
};

// ============================================================================
// Component
// ============================================================================

/**
 * Title Card template component
 *
 * Creates a full-screen title card with customizable animations.
 */
export const TitleCard: React.FC<TitleCardProps> = ({
  title = titleCardDefaultProps.title,
  subtitle = titleCardDefaultProps.subtitle,
  titleColor = titleCardDefaultProps.titleColor,
  subtitleColor = titleCardDefaultProps.subtitleColor,
  backgroundColor = titleCardDefaultProps.backgroundColor,
  accentColor = titleCardDefaultProps.accentColor,
  titleFontSize = titleCardDefaultProps.titleFontSize,
  subtitleFontSize = titleCardDefaultProps.subtitleFontSize,
  fontFamily = titleCardDefaultProps.fontFamily,
  textAlign = titleCardDefaultProps.textAlign,
  verticalPosition = titleCardDefaultProps.verticalPosition,
  animationStyle = titleCardDefaultProps.animationStyle,
  enterDuration = titleCardDefaultProps.enterDuration,
  holdDuration = titleCardDefaultProps.holdDuration,
  exitDuration = titleCardDefaultProps.exitDuration,
  showDecorativeLine = titleCardDefaultProps.showDecorativeLine,
  lineWidth = titleCardDefaultProps.lineWidth,
  lineHeight = titleCardDefaultProps.lineHeight,
  textGap = titleCardDefaultProps.textGap,
  titleFontWeight = titleCardDefaultProps.titleFontWeight,
  subtitleFontWeight = titleCardDefaultProps.subtitleFontWeight,
  titleLetterSpacing = titleCardDefaultProps.titleLetterSpacing,
  titleTextTransform = titleCardDefaultProps.titleTextTransform,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Calculate animation phases
  const exitStart = enterDuration + holdDuration;

  // Enter animation progress (0 to 1)
  const enterProgress =
    animationStyle === "scale"
      ? spring({
          fps,
          frame,
          config: { damping: 12, stiffness: 80 },
        })
      : interpolate(frame, [0, enterDuration], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });

  // Exit animation progress (1 to 0)
  const exitProgress = interpolate(
    frame,
    [exitStart, exitStart + exitDuration],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    }
  );

  // Combined progress
  const progress = frame >= exitStart ? exitProgress : enterProgress;

  // Calculate transforms based on animation style
  let translateY = 0;
  let scale = 1;
  let opacity = 1;
  let blur = 0;

  switch (animationStyle) {
    case "fade":
      opacity = progress;
      break;
    case "scale":
      scale = interpolate(progress, [0, 1], [0.8, 1]);
      opacity = progress;
      break;
    case "slide-up":
      translateY = interpolate(progress, [0, 1], [50, 0]);
      opacity = progress;
      break;
    case "slide-down":
      translateY = interpolate(progress, [0, 1], [-50, 0]);
      opacity = progress;
      break;
    case "blur":
      blur = interpolate(progress, [0, 1], [20, 0]);
      opacity = progress;
      break;
  }

  // Decorative line animation (delayed)
  const lineProgress = interpolate(
    frame,
    [enterDuration * 0.3, enterDuration],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );
  const lineScale = frame >= exitStart ? progress : lineProgress;

  // Get vertical alignment styles
  const getVerticalStyles = (): React.CSSProperties => {
    switch (verticalPosition) {
      case "top":
        return { justifyContent: "flex-start", paddingTop: 100 };
      case "bottom":
        return { justifyContent: "flex-end", paddingBottom: 100 };
      default:
        return { justifyContent: "center" };
    }
  };

  // Get text alignment styles
  const getAlignItems = (): React.CSSProperties["alignItems"] => {
    switch (textAlign) {
      case "left":
        return "flex-start";
      case "right":
        return "flex-end";
      default:
        return "center";
    }
  };

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: getAlignItems(),
          padding: 60,
          ...getVerticalStyles(),
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: getAlignItems(),
            gap: textGap,
            transform: `translateY(${translateY}px) scale(${scale})`,
            opacity,
            filter: blur > 0 ? `blur(${blur}px)` : "none",
          }}
        >
          {/* Title */}
          <div
            style={{
              color: titleColor,
              fontSize: titleFontSize,
              fontFamily,
              fontWeight: titleFontWeight,
              letterSpacing: titleLetterSpacing,
              textTransform: titleTextTransform,
              textAlign,
              lineHeight: 1.1,
            }}
          >
            {title}
          </div>

          {/* Decorative Line */}
          {showDecorativeLine && (
            <div
              style={{
                width: lineWidth,
                height: lineHeight,
                backgroundColor: accentColor,
                transform: `scaleX(${lineScale})`,
                borderRadius: lineHeight / 2,
              }}
            />
          )}

          {/* Subtitle */}
          {subtitle && (
            <div
              style={{
                color: subtitleColor,
                fontSize: subtitleFontSize,
                fontFamily,
                fontWeight: subtitleFontWeight,
                textAlign,
                lineHeight: 1.3,
                opacity: interpolate(
                  frame,
                  [enterDuration * 0.5, enterDuration],
                  [0, 1],
                  {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }
                ) * (frame >= exitStart ? progress : 1),
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Title Card template component definition for QCut
 */
export const TitleCardDefinition: RemotionComponentDefinition = {
  id: "built-in-title-card",
  name: "Title Card",
  description: "Full-screen title card for chapters and section headers",
  category: "template",
  durationInFrames: 100,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: TitleCardSchema,
  defaultProps: titleCardDefaultProps,
  component: TitleCard,
  source: "built-in",
  tags: ["template", "title", "chapter", "header", "full-screen", "card"],
  version: "1.0.0",
  author: "QCut",
};

export default TitleCard;
