/**
 * Intro Scene Template Component
 *
 * A professional video intro template with logo, title, and tagline animations.
 * Perfect for YouTube videos, presentations, and branded content.
 *
 * @module lib/remotion/built-in/templates/intro-scene
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
 * Zod schema for Intro Scene component props
 */
export const IntroSceneSchema = z.object({
  /** Logo text (or emoji for simple logo) */
  logoText: z.string().default("Q"),
  /** Main title */
  title: z.string().min(1).default("Welcome"),
  /** Tagline/subtitle */
  tagline: z.string().default("Your Story Starts Here"),
  /** Primary color (logo, accents) */
  primaryColor: z.string().default("#4361ee"),
  /** Text color */
  textColor: z.string().default("#ffffff"),
  /** Background color */
  backgroundColor: z.string().default("#0a0a0f"),
  /** Secondary background color (for gradient) */
  backgroundColorSecondary: z.string().default("#1a1a2e"),
  /** Use gradient background */
  useGradient: z.boolean().default(true),
  /** Gradient direction */
  gradientDirection: z.enum(["to-bottom", "to-right", "radial"]).default("radial"),
  /** Logo size */
  logoSize: z.number().min(40).max(300).default(120),
  /** Title font size */
  titleFontSize: z.number().min(24).max(150).default(64),
  /** Tagline font size */
  taglineFontSize: z.number().min(12).max(80).default(28),
  /** Font family */
  fontFamily: z.string().default("Inter, sans-serif"),
  /** Animation style */
  animationStyle: z.enum(["elegant", "energetic", "minimal", "dramatic"]).default("elegant"),
  /** Logo animation delay (frames) */
  logoDelay: z.number().min(0).max(30).default(0),
  /** Title animation delay (frames) */
  titleDelay: z.number().min(0).max(60).default(15),
  /** Tagline animation delay (frames) */
  taglineDelay: z.number().min(0).max(90).default(30),
  /** Show particles/decorations */
  showParticles: z.boolean().default(true),
  /** Particle count */
  particleCount: z.number().min(0).max(20).default(8),
  /** Logo shape */
  logoShape: z.enum(["circle", "square", "rounded"]).default("circle"),
  /** Show logo background */
  showLogoBackground: z.boolean().default(true),
  /** Title font weight */
  titleFontWeight: z.number().min(100).max(900).default(700),
});

export type IntroSceneProps = z.infer<typeof IntroSceneSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const introSceneDefaultProps: IntroSceneProps = {
  logoText: "Q",
  title: "Welcome",
  tagline: "Your Story Starts Here",
  primaryColor: "#4361ee",
  textColor: "#ffffff",
  backgroundColor: "#0a0a0f",
  backgroundColorSecondary: "#1a1a2e",
  useGradient: true,
  gradientDirection: "radial",
  logoSize: 120,
  titleFontSize: 64,
  taglineFontSize: 28,
  fontFamily: "Inter, sans-serif",
  animationStyle: "elegant",
  logoDelay: 0,
  titleDelay: 15,
  taglineDelay: 30,
  showParticles: true,
  particleCount: 8,
  logoShape: "circle",
  showLogoBackground: true,
  titleFontWeight: 700,
};

// ============================================================================
// Helper Components
// ============================================================================

interface ParticleProps {
  index: number;
  frame: number;
  fps: number;
  primaryColor: string;
  animationStyle: string;
}

const Particle: React.FC<ParticleProps> = ({
  index,
  frame,
  fps,
  primaryColor,
  animationStyle,
}) => {
  // Pseudo-random values based on index
  const seed = index * 137.5;
  const angle = (seed % 360) * (Math.PI / 180);
  const distance = 200 + (seed % 150);
  const size = 4 + (index % 4) * 2;
  const delay = index * 3;

  const progress = spring({
    fps,
    frame: Math.max(0, frame - delay),
    config: {
      damping: animationStyle === "energetic" ? 8 : 15,
      stiffness: animationStyle === "energetic" ? 150 : 80,
    },
  });

  const x = Math.cos(angle) * distance * progress;
  const y = Math.sin(angle) * distance * progress;
  const opacity = interpolate(progress, [0, 0.3, 1], [0, 1, 0.6]);

  return (
    <div
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: primaryColor,
        left: "50%",
        top: "50%",
        transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
        opacity,
      }}
    />
  );
};

// ============================================================================
// Component
// ============================================================================

/**
 * Intro Scene template component
 *
 * Creates a professional video intro with logo and text animations.
 */
export const IntroScene: React.FC<Partial<IntroSceneProps>> = ({
  logoText = introSceneDefaultProps.logoText,
  title = introSceneDefaultProps.title,
  tagline = introSceneDefaultProps.tagline,
  primaryColor = introSceneDefaultProps.primaryColor,
  textColor = introSceneDefaultProps.textColor,
  backgroundColor = introSceneDefaultProps.backgroundColor,
  backgroundColorSecondary = introSceneDefaultProps.backgroundColorSecondary,
  useGradient = introSceneDefaultProps.useGradient,
  gradientDirection = introSceneDefaultProps.gradientDirection,
  logoSize = introSceneDefaultProps.logoSize,
  titleFontSize = introSceneDefaultProps.titleFontSize,
  taglineFontSize = introSceneDefaultProps.taglineFontSize,
  fontFamily = introSceneDefaultProps.fontFamily,
  animationStyle = introSceneDefaultProps.animationStyle,
  logoDelay = introSceneDefaultProps.logoDelay,
  titleDelay = introSceneDefaultProps.titleDelay,
  taglineDelay = introSceneDefaultProps.taglineDelay,
  showParticles = introSceneDefaultProps.showParticles,
  particleCount = introSceneDefaultProps.particleCount,
  logoShape = introSceneDefaultProps.logoShape,
  showLogoBackground = introSceneDefaultProps.showLogoBackground,
  titleFontWeight = introSceneDefaultProps.titleFontWeight,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Get animation config based on style
  const getSpringConfig = () => {
    switch (animationStyle) {
      case "energetic":
        return { damping: 8, stiffness: 150 };
      case "minimal":
        return { damping: 20, stiffness: 100 };
      case "dramatic":
        return { damping: 10, stiffness: 60 };
      default: // elegant
        return { damping: 15, stiffness: 80 };
    }
  };

  const springConfig = getSpringConfig();

  // Logo animation
  const logoProgress = spring({
    fps,
    frame: Math.max(0, frame - logoDelay),
    config: springConfig,
  });

  // Title animation
  const titleProgress = spring({
    fps,
    frame: Math.max(0, frame - titleDelay),
    config: springConfig,
  });

  // Tagline animation
  const taglineProgress = spring({
    fps,
    frame: Math.max(0, frame - taglineDelay),
    config: springConfig,
  });

  // Calculate logo transforms
  let logoScale = logoProgress;
  let logoRotation = 0;
  let logoTranslateY = interpolate(logoProgress, [0, 1], [30, 0]);

  if (animationStyle === "dramatic") {
    logoScale = interpolate(logoProgress, [0, 1], [3, 1]);
    logoRotation = interpolate(logoProgress, [0, 1], [180, 0]);
  } else if (animationStyle === "energetic") {
    logoScale = interpolate(logoProgress, [0, 0.5, 1], [0, 1.2, 1]);
  }

  // Calculate title transforms
  const titleOpacity = titleProgress;
  let titleTranslateY = 0;
  let titleTranslateX = 0;

  if (animationStyle === "elegant" || animationStyle === "dramatic") {
    titleTranslateY = interpolate(titleProgress, [0, 1], [30, 0]);
  } else if (animationStyle === "energetic") {
    titleTranslateX = interpolate(titleProgress, [0, 1], [-50, 0]);
  }

  // Calculate tagline transforms
  const taglineOpacity = taglineProgress;
  const taglineTranslateY = interpolate(taglineProgress, [0, 1], [20, 0]);

  // Background styles
  const getBackgroundStyle = (): React.CSSProperties => {
    if (!useGradient) {
      return { backgroundColor };
    }

    switch (gradientDirection) {
      case "to-bottom":
        return {
          background: `linear-gradient(to bottom, ${backgroundColor}, ${backgroundColorSecondary})`,
        };
      case "to-right":
        return {
          background: `linear-gradient(to right, ${backgroundColor}, ${backgroundColorSecondary})`,
        };
      default: // radial
        return {
          background: `radial-gradient(ellipse at center, ${backgroundColorSecondary}, ${backgroundColor})`,
        };
    }
  };

  // Logo shape styles
  const getLogoShapeStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      width: logoSize,
      height: logoSize,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: showLogoBackground ? primaryColor : "transparent",
      color: showLogoBackground ? backgroundColor : primaryColor,
      fontSize: logoSize * 0.5,
      fontFamily,
      fontWeight: 700,
    };

    switch (logoShape) {
      case "square":
        return { ...baseStyle, borderRadius: 0 };
      case "rounded":
        return { ...baseStyle, borderRadius: logoSize * 0.2 };
      default: // circle
        return { ...baseStyle, borderRadius: "50%" };
    }
  };

  return (
    <AbsoluteFill style={getBackgroundStyle()}>
      {/* Particles */}
      {showParticles && (
        <AbsoluteFill>
          {Array.from({ length: particleCount }).map((_, i) => (
            <Particle
              key={i}
              index={i}
              frame={frame}
              fps={fps}
              primaryColor={primaryColor}
              animationStyle={animationStyle}
            />
          ))}
        </AbsoluteFill>
      )}

      {/* Content Container */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 30,
        }}
      >
        {/* Logo */}
        <div
          style={{
            ...getLogoShapeStyle(),
            transform: `scale(${logoScale}) translateY(${logoTranslateY}px) rotate(${logoRotation}deg)`,
            opacity: logoProgress,
          }}
        >
          {logoText}
        </div>

        {/* Title */}
        <div
          style={{
            color: textColor,
            fontSize: titleFontSize,
            fontFamily,
            fontWeight: titleFontWeight,
            transform: `translateY(${titleTranslateY}px) translateX(${titleTranslateX}px)`,
            opacity: titleOpacity,
            textAlign: "center",
          }}
        >
          {title}
        </div>

        {/* Tagline */}
        {tagline && (
          <div
            style={{
              color: textColor,
              fontSize: taglineFontSize,
              fontFamily,
              fontWeight: 400,
              opacity: taglineOpacity * 0.8,
              transform: `translateY(${taglineTranslateY}px)`,
              textAlign: "center",
            }}
          >
            {tagline}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Intro Scene template component definition for QCut
 */
export const IntroSceneDefinition: RemotionComponentDefinition = {
  id: "built-in-intro-scene",
  name: "Intro Scene",
  description: "Professional video intro with logo and text animations",
  category: "template",
  durationInFrames: 90,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: IntroSceneSchema,
  defaultProps: introSceneDefaultProps,
  component: IntroScene as React.ComponentType<Record<string, unknown>>,
  source: "built-in",
  tags: ["template", "intro", "opener", "logo", "branded", "youtube"],
  version: "1.0.0",
  author: "QCut",
};

export default IntroScene;
