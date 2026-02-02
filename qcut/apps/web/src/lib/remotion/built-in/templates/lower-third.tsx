/**
 * Lower Third Template Component
 *
 * A professional lower third overlay for displaying names, titles, or captions.
 * Commonly used in interviews, presentations, and news broadcasts.
 *
 * @module lib/remotion/built-in/templates/lower-third
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
 * Zod schema for Lower Third component props
 */
export const LowerThirdSchema = z.object({
  /** Primary text (name, title) */
  primaryText: z.string().min(1).default("John Doe"),
  /** Secondary text (subtitle, role) */
  secondaryText: z.string().default("Software Engineer"),
  /** Primary text color */
  primaryColor: z.string().default("#ffffff"),
  /** Secondary text color */
  secondaryColor: z.string().default("#cccccc"),
  /** Background color */
  backgroundColor: z.string().default("#1a1a2e"),
  /** Accent color (for decorative elements) */
  accentColor: z.string().default("#4361ee"),
  /** Animation style */
  animationStyle: z
    .enum(["slide", "fade", "expand", "typewriter"])
    .default("slide"),
  /** Position from bottom (pixels) */
  bottomOffset: z.number().min(0).max(500).default(80),
  /** Position from left (pixels or "center") */
  leftOffset: z.number().min(0).max(1000).default(60),
  /** Primary font size */
  primaryFontSize: z.number().min(12).max(100).default(36),
  /** Secondary font size */
  secondaryFontSize: z.number().min(10).max(80).default(24),
  /** Font family */
  fontFamily: z.string().default("Inter, sans-serif"),
  /** Duration of enter animation (frames) */
  enterDuration: z.number().min(1).max(60).default(15),
  /** Duration of exit animation (frames) */
  exitDuration: z.number().min(1).max(60).default(15),
  /** Show accent bar */
  showAccentBar: z.boolean().default(true),
  /** Accent bar width */
  accentBarWidth: z.number().min(1).max(20).default(4),
  /** Padding inside the lower third */
  padding: z.number().min(0).max(50).default(16),
  /** Border radius */
  borderRadius: z.number().min(0).max(30).default(4),
  /** Show background */
  showBackground: z.boolean().default(true),
  /** Background opacity */
  backgroundOpacity: z.number().min(0).max(1).default(0.9),
});

export type LowerThirdProps = z.infer<typeof LowerThirdSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const lowerThirdDefaultProps: LowerThirdProps = {
  primaryText: "John Doe",
  secondaryText: "Software Engineer",
  primaryColor: "#ffffff",
  secondaryColor: "#cccccc",
  backgroundColor: "#1a1a2e",
  accentColor: "#4361ee",
  animationStyle: "slide",
  bottomOffset: 80,
  leftOffset: 60,
  primaryFontSize: 36,
  secondaryFontSize: 24,
  fontFamily: "Inter, sans-serif",
  enterDuration: 15,
  exitDuration: 15,
  showAccentBar: true,
  accentBarWidth: 4,
  padding: 16,
  borderRadius: 4,
  showBackground: true,
  backgroundOpacity: 0.9,
};

// ============================================================================
// Component
// ============================================================================

/**
 * Lower Third template component
 *
 * Creates a professional lower third overlay for names and titles.
 */
export const LowerThird: React.FC<Partial<LowerThirdProps>> = ({
  primaryText = lowerThirdDefaultProps.primaryText,
  secondaryText = lowerThirdDefaultProps.secondaryText,
  primaryColor = lowerThirdDefaultProps.primaryColor,
  secondaryColor = lowerThirdDefaultProps.secondaryColor,
  backgroundColor = lowerThirdDefaultProps.backgroundColor,
  accentColor = lowerThirdDefaultProps.accentColor,
  animationStyle = lowerThirdDefaultProps.animationStyle,
  bottomOffset = lowerThirdDefaultProps.bottomOffset,
  leftOffset = lowerThirdDefaultProps.leftOffset,
  primaryFontSize = lowerThirdDefaultProps.primaryFontSize,
  secondaryFontSize = lowerThirdDefaultProps.secondaryFontSize,
  fontFamily = lowerThirdDefaultProps.fontFamily,
  enterDuration = lowerThirdDefaultProps.enterDuration,
  exitDuration = lowerThirdDefaultProps.exitDuration,
  showAccentBar = lowerThirdDefaultProps.showAccentBar,
  accentBarWidth = lowerThirdDefaultProps.accentBarWidth,
  padding = lowerThirdDefaultProps.padding,
  borderRadius = lowerThirdDefaultProps.borderRadius,
  showBackground = lowerThirdDefaultProps.showBackground,
  backgroundOpacity = lowerThirdDefaultProps.backgroundOpacity,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  // Calculate animation progress
  const exitStart = durationInFrames - exitDuration;

  // Enter animation progress (0 to 1)
  let enterProgress: number;
  if (animationStyle === "slide") {
    enterProgress = spring({
      fps,
      frame,
      config: { damping: 15, stiffness: 100 },
    });
  } else {
    enterProgress = interpolate(frame, [0, enterDuration], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
  }

  // Exit animation progress (1 to 0)
  const exitProgress = interpolate(
    frame,
    [exitStart, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    }
  );

  // Combined progress (use exit when in exit phase)
  const progress = frame >= exitStart ? exitProgress : enterProgress;

  // Calculate transform based on animation style
  let translateX = 0;
  const translateY = 0;
  let opacity = 1;
  let scaleX = 1;

  switch (animationStyle) {
    case "slide":
      translateX = interpolate(progress, [0, 1], [-200, 0]);
      opacity = progress;
      break;
    case "fade":
      opacity = progress;
      break;
    case "expand":
      scaleX = progress;
      opacity = progress;
      break;
    case "typewriter":
      opacity = 1;
      break;
  }

  // Typewriter effect for text
  const getTypewriterText = (text: string, progress: number) => {
    if (animationStyle !== "typewriter") return text;
    const chars = Math.floor(text.length * progress);
    return text.substring(0, chars);
  };

  const displayPrimaryText = getTypewriterText(primaryText, enterProgress);
  const displaySecondaryText = getTypewriterText(
    secondaryText,
    Math.max(0, (enterProgress - 0.3) / 0.7)
  );

  // Calculate background color with opacity
  const bgColorWithOpacity = showBackground
    ? `${backgroundColor}${Math.round(backgroundOpacity * 255)
        .toString(16)
        .padStart(2, "0")}`
    : "transparent";

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          bottom: bottomOffset,
          left: leftOffset,
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          transform: `translateX(${translateX}px) translateY(${translateY}px) scaleX(${scaleX})`,
          transformOrigin: "left center",
          opacity,
        }}
      >
        {/* Accent Bar */}
        {showAccentBar && (
          <div
            style={{
              width: accentBarWidth,
              backgroundColor: accentColor,
              borderRadius: `${borderRadius}px 0 0 ${borderRadius}px`,
            }}
          />
        )}

        {/* Content */}
        <div
          style={{
            backgroundColor: bgColorWithOpacity,
            padding: `${padding}px ${padding * 1.5}px`,
            borderRadius: showAccentBar
              ? `0 ${borderRadius}px ${borderRadius}px 0`
              : `${borderRadius}px`,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {/* Primary Text */}
          <div
            style={{
              color: primaryColor,
              fontSize: primaryFontSize,
              fontFamily,
              fontWeight: 600,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            {displayPrimaryText}
          </div>

          {/* Secondary Text */}
          {secondaryText && (
            <div
              style={{
                color: secondaryColor,
                fontSize: secondaryFontSize,
                fontFamily,
                fontWeight: 400,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
            >
              {displaySecondaryText}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Lower Third template component definition for QCut
 */
export const LowerThirdDefinition: RemotionComponentDefinition = {
  id: "built-in-lower-third",
  name: "Lower Third",
  description: "Professional lower third overlay for names and titles",
  category: "template",
  durationInFrames: 90,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: LowerThirdSchema,
  defaultProps: lowerThirdDefaultProps,
  component: LowerThird as React.ComponentType<Record<string, unknown>>,
  source: "built-in",
  tags: ["template", "lower-third", "name", "title", "caption", "overlay"],
  version: "1.0.0",
  author: "QCut",
};

export default LowerThird;
