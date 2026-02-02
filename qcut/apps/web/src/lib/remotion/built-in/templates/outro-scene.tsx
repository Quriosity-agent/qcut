/**
 * Outro Scene Template Component
 *
 * A professional video outro/end screen template with call-to-action,
 * social links, and subscribe prompts. Perfect for YouTube end screens.
 *
 * @module lib/remotion/built-in/templates/outro-scene
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
 * Zod schema for Outro Scene component props
 */
export const OutroSceneSchema = z.object({
  /** Main title/CTA */
  title: z.string().min(1).default("Thanks for Watching!"),
  /** Subtitle text */
  subtitle: z.string().default("Don't forget to subscribe"),
  /** Channel/brand name */
  channelName: z.string().default("@YourChannel"),
  /** Primary color */
  primaryColor: z.string().default("#ff0050"),
  /** Text color */
  textColor: z.string().default("#ffffff"),
  /** Background color */
  backgroundColor: z.string().default("#0a0a0f"),
  /** Secondary background color (for gradient) */
  backgroundColorSecondary: z.string().default("#1a1a2e"),
  /** Use gradient background */
  useGradient: z.boolean().default(true),
  /** Title font size */
  titleFontSize: z.number().min(24).max(120).default(56),
  /** Subtitle font size */
  subtitleFontSize: z.number().min(12).max(60).default(28),
  /** Channel name font size */
  channelFontSize: z.number().min(12).max(48).default(24),
  /** Font family */
  fontFamily: z.string().default("Inter, sans-serif"),
  /** Layout style */
  layoutStyle: z
    .enum(["centered", "split", "bottom-heavy"])
    .default("centered"),
  /** Show subscribe button */
  showSubscribeButton: z.boolean().default(true),
  /** Subscribe button text */
  subscribeText: z.string().default("SUBSCRIBE"),
  /** Show video placeholders (for end screen elements) */
  showVideoPlaceholders: z.boolean().default(true),
  /** Number of video placeholders */
  placeholderCount: z.number().min(0).max(4).default(2),
  /** Enter animation delay (frames) */
  enterDelay: z.number().min(0).max(60).default(0),
  /** Stagger delay between elements */
  staggerDelay: z.number().min(0).max(20).default(8),
  /** Show social icons */
  showSocialIcons: z.boolean().default(false),
  /** Social icon labels (comma-separated) */
  socialLabels: z.string().default("Twitter,Instagram,TikTok"),
});

export type OutroSceneProps = z.infer<typeof OutroSceneSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const outroSceneDefaultProps: OutroSceneProps = {
  title: "Thanks for Watching!",
  subtitle: "Don't forget to subscribe",
  channelName: "@YourChannel",
  primaryColor: "#ff0050",
  textColor: "#ffffff",
  backgroundColor: "#0a0a0f",
  backgroundColorSecondary: "#1a1a2e",
  useGradient: true,
  titleFontSize: 56,
  subtitleFontSize: 28,
  channelFontSize: 24,
  fontFamily: "Inter, sans-serif",
  layoutStyle: "centered",
  showSubscribeButton: true,
  subscribeText: "SUBSCRIBE",
  showVideoPlaceholders: true,
  placeholderCount: 2,
  enterDelay: 0,
  staggerDelay: 8,
  showSocialIcons: false,
  socialLabels: "Twitter,Instagram,TikTok",
};

// ============================================================================
// Helper Components
// ============================================================================

interface VideoPlaceholderProps {
  index: number;
  progress: number;
  primaryColor: string;
  textColor: string;
  fontFamily: string;
}

const VideoPlaceholder: React.FC<VideoPlaceholderProps> = ({
  index,
  progress,
  primaryColor,
  textColor,
  fontFamily,
}) => {
  const scale = interpolate(progress, [0, 1], [0.8, 1]);
  const opacity = progress;

  return (
    <div
      style={{
        width: 280,
        height: 158,
        backgroundColor: `${primaryColor}22`,
        border: `2px solid ${primaryColor}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      {/* Play Icon */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          backgroundColor: primaryColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: "14px solid white",
            borderTop: "9px solid transparent",
            borderBottom: "9px solid transparent",
            marginLeft: 4,
          }}
        />
      </div>
      <div
        style={{
          color: textColor,
          fontSize: 14,
          fontFamily,
          opacity: 0.7,
        }}
      >
        Video {index + 1}
      </div>
    </div>
  );
};

interface SubscribeButtonProps {
  text: string;
  progress: number;
  primaryColor: string;
  fontFamily: string;
}

const SubscribeButton: React.FC<SubscribeButtonProps> = ({
  text,
  progress,
  primaryColor,
  fontFamily,
}) => {
  const scale = interpolate(progress, [0, 0.6, 1], [0.5, 1.1, 1]);
  const opacity = progress;

  // Pulsing animation after fully visible
  const pulseProgress = progress >= 1 ? 1 : 0;

  return (
    <div
      style={{
        backgroundColor: primaryColor,
        color: "#ffffff",
        padding: "16px 40px",
        borderRadius: 8,
        fontSize: 20,
        fontFamily,
        fontWeight: 700,
        letterSpacing: 2,
        transform: `scale(${scale})`,
        opacity,
        boxShadow: pulseProgress > 0 ? `0 0 20px ${primaryColor}80` : "none",
      }}
    >
      {text}
    </div>
  );
};

interface SocialIconProps {
  label: string;
  progress: number;
  textColor: string;
  fontFamily: string;
}

const SocialIcon: React.FC<SocialIconProps> = ({
  label,
  progress,
  textColor,
  fontFamily,
}) => {
  const translateY = interpolate(progress, [0, 1], [20, 0]);
  const opacity = progress;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        transform: `translateY(${translateY}px)`,
        opacity,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          backgroundColor: `${textColor}22`,
          border: `2px solid ${textColor}44`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
        }}
      >
        {label.charAt(0)}
      </div>
      <div
        style={{
          color: textColor,
          fontSize: 12,
          fontFamily,
          opacity: 0.7,
        }}
      >
        {label}
      </div>
    </div>
  );
};

// ============================================================================
// Component
// ============================================================================

/**
 * Outro Scene template component
 *
 * Creates a professional video outro with CTA and end screen elements.
 */
export const OutroScene: React.FC<Partial<OutroSceneProps>> = ({
  title = outroSceneDefaultProps.title,
  subtitle = outroSceneDefaultProps.subtitle,
  channelName = outroSceneDefaultProps.channelName,
  primaryColor = outroSceneDefaultProps.primaryColor,
  textColor = outroSceneDefaultProps.textColor,
  backgroundColor = outroSceneDefaultProps.backgroundColor,
  backgroundColorSecondary = outroSceneDefaultProps.backgroundColorSecondary,
  useGradient = outroSceneDefaultProps.useGradient,
  titleFontSize = outroSceneDefaultProps.titleFontSize,
  subtitleFontSize = outroSceneDefaultProps.subtitleFontSize,
  channelFontSize = outroSceneDefaultProps.channelFontSize,
  fontFamily = outroSceneDefaultProps.fontFamily,
  layoutStyle = outroSceneDefaultProps.layoutStyle,
  showSubscribeButton = outroSceneDefaultProps.showSubscribeButton,
  subscribeText = outroSceneDefaultProps.subscribeText,
  showVideoPlaceholders = outroSceneDefaultProps.showVideoPlaceholders,
  placeholderCount = outroSceneDefaultProps.placeholderCount,
  enterDelay = outroSceneDefaultProps.enterDelay,
  staggerDelay = outroSceneDefaultProps.staggerDelay,
  showSocialIcons = outroSceneDefaultProps.showSocialIcons,
  socialLabels = outroSceneDefaultProps.socialLabels,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animation helpers
  const getProgress = (delay: number) =>
    spring({
      fps,
      frame: Math.max(0, frame - enterDelay - delay),
      config: { damping: 15, stiffness: 80 },
    });

  // Element animations with stagger
  const titleProgress = getProgress(0);
  const subtitleProgress = getProgress(staggerDelay);
  const channelProgress = getProgress(staggerDelay * 2);
  const buttonProgress = getProgress(staggerDelay * 3);

  // Background styles
  const getBackgroundStyle = (): React.CSSProperties => {
    if (!useGradient) {
      return { backgroundColor };
    }
    return {
      background: `radial-gradient(ellipse at center, ${backgroundColorSecondary}, ${backgroundColor})`,
    };
  };

  // Parse social labels
  const socialItems = socialLabels.split(",").map((s) => s.trim());

  // Layout-specific content rendering
  const renderCenteredLayout = () => (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding: 60,
      }}
    >
      {/* Title */}
      <div
        style={{
          color: textColor,
          fontSize: titleFontSize,
          fontFamily,
          fontWeight: 700,
          textAlign: "center",
          transform: `translateY(${interpolate(titleProgress, [0, 1], [30, 0])}px)`,
          opacity: titleProgress,
        }}
      >
        {title}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div
          style={{
            color: textColor,
            fontSize: subtitleFontSize,
            fontFamily,
            opacity: subtitleProgress * 0.8,
            transform: `translateY(${interpolate(subtitleProgress, [0, 1], [20, 0])}px)`,
            textAlign: "center",
          }}
        >
          {subtitle}
        </div>
      )}

      {/* Subscribe Button */}
      {showSubscribeButton && (
        <div style={{ marginTop: 16 }}>
          <SubscribeButton
            text={subscribeText}
            progress={buttonProgress}
            primaryColor={primaryColor}
            fontFamily={fontFamily}
          />
        </div>
      )}

      {/* Video Placeholders */}
      {showVideoPlaceholders && placeholderCount > 0 && (
        <div
          style={{
            display: "flex",
            gap: 24,
            marginTop: 32,
          }}
        >
          {Array.from({ length: placeholderCount }).map((_, i) => (
            <VideoPlaceholder
              key={i}
              index={i}
              progress={getProgress(staggerDelay * 4 + i * staggerDelay)}
              primaryColor={primaryColor}
              textColor={textColor}
              fontFamily={fontFamily}
            />
          ))}
        </div>
      )}

      {/* Channel Name */}
      <div
        style={{
          color: primaryColor,
          fontSize: channelFontSize,
          fontFamily,
          fontWeight: 600,
          marginTop: 16,
          opacity: channelProgress,
          transform: `translateY(${interpolate(channelProgress, [0, 1], [10, 0])}px)`,
        }}
      >
        {channelName}
      </div>

      {/* Social Icons */}
      {showSocialIcons && (
        <div
          style={{
            display: "flex",
            gap: 32,
            marginTop: 24,
          }}
        >
          {socialItems.map((label, i) => (
            <SocialIcon
              key={label}
              label={label}
              progress={getProgress(staggerDelay * 5 + i * staggerDelay)}
              textColor={textColor}
              fontFamily={fontFamily}
            />
          ))}
        </div>
      )}
    </AbsoluteFill>
  );

  const renderSplitLayout = () => (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "row",
      }}
    >
      {/* Left side - Text content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: 80,
          gap: 20,
        }}
      >
        <div
          style={{
            color: textColor,
            fontSize: titleFontSize,
            fontFamily,
            fontWeight: 700,
            transform: `translateX(${interpolate(titleProgress, [0, 1], [-50, 0])}px)`,
            opacity: titleProgress,
          }}
        >
          {title}
        </div>

        {subtitle && (
          <div
            style={{
              color: textColor,
              fontSize: subtitleFontSize,
              fontFamily,
              opacity: subtitleProgress * 0.8,
              transform: `translateX(${interpolate(subtitleProgress, [0, 1], [-30, 0])}px)`,
            }}
          >
            {subtitle}
          </div>
        )}

        {showSubscribeButton && (
          <div style={{ marginTop: 16 }}>
            <SubscribeButton
              text={subscribeText}
              progress={buttonProgress}
              primaryColor={primaryColor}
              fontFamily={fontFamily}
            />
          </div>
        )}

        <div
          style={{
            color: primaryColor,
            fontSize: channelFontSize,
            fontFamily,
            fontWeight: 600,
            marginTop: 16,
            opacity: channelProgress,
          }}
        >
          {channelName}
        </div>
      </div>

      {/* Right side - Video placeholders */}
      {showVideoPlaceholders && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
          }}
        >
          {Array.from({ length: placeholderCount }).map((_, i) => (
            <VideoPlaceholder
              key={i}
              index={i}
              progress={getProgress(staggerDelay * 2 + i * staggerDelay)}
              primaryColor={primaryColor}
              textColor={textColor}
              fontFamily={fontFamily}
            />
          ))}
        </div>
      )}
    </AbsoluteFill>
  );

  const renderBottomHeavyLayout = () => (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top area - Video placeholders */}
      {showVideoPlaceholders && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 32,
          }}
        >
          {Array.from({ length: placeholderCount }).map((_, i) => (
            <VideoPlaceholder
              key={i}
              index={i}
              progress={getProgress(i * staggerDelay)}
              primaryColor={primaryColor}
              textColor={textColor}
              fontFamily={fontFamily}
            />
          ))}
        </div>
      )}

      {/* Bottom area - Text and CTA */}
      <div
        style={{
          padding: "40px 80px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            color: textColor,
            fontSize: titleFontSize * 0.8,
            fontFamily,
            fontWeight: 700,
            opacity: titleProgress,
            transform: `translateY(${interpolate(titleProgress, [0, 1], [20, 0])}px)`,
          }}
        >
          {title}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
          }}
        >
          {showSubscribeButton && (
            <SubscribeButton
              text={subscribeText}
              progress={buttonProgress}
              primaryColor={primaryColor}
              fontFamily={fontFamily}
            />
          )}
          <div
            style={{
              color: primaryColor,
              fontSize: channelFontSize,
              fontFamily,
              fontWeight: 600,
              opacity: channelProgress,
            }}
          >
            {channelName}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={getBackgroundStyle()}>
      {layoutStyle === "centered" && renderCenteredLayout()}
      {layoutStyle === "split" && renderSplitLayout()}
      {layoutStyle === "bottom-heavy" && renderBottomHeavyLayout()}
    </AbsoluteFill>
  );
};

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Outro Scene template component definition for QCut
 */
export const OutroSceneDefinition: RemotionComponentDefinition = {
  id: "built-in-outro-scene",
  name: "Outro Scene",
  description: "Professional video outro with CTA and end screen elements",
  category: "template",
  durationInFrames: 150,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: OutroSceneSchema,
  defaultProps: outroSceneDefaultProps,
  component: OutroScene as React.ComponentType<Record<string, unknown>>,
  source: "built-in",
  tags: ["template", "outro", "end-screen", "cta", "subscribe", "youtube"],
  version: "1.0.0",
  author: "QCut",
};

export default OutroScene;
