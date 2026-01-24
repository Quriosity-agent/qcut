/**
 * Typewriter Text Animation Component
 *
 * Animates text appearing character by character like a typewriter.
 *
 * @module lib/remotion/built-in/text/typewriter
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from "remotion";
import { z } from "zod";
import type { RemotionComponentDefinition } from "../../types";

// ============================================================================
// Schema
// ============================================================================

/**
 * Zod schema for Typewriter component props
 */
export const TypewriterSchema = z.object({
  /** Text to display */
  text: z.string().min(1).default("Hello, World!"),
  /** Font size in pixels */
  fontSize: z.number().min(8).max(200).default(48),
  /** Font family */
  fontFamily: z.string().default("monospace"),
  /** Text color */
  color: z.string().default("#ffffff"),
  /** Background color (transparent by default) */
  backgroundColor: z.string().default("transparent"),
  /** Typing speed - characters per second */
  typingSpeed: z.number().min(1).max(100).default(20),
  /** Delay before typing starts (in frames) */
  startDelay: z.number().min(0).default(0),
  /** Show blinking cursor */
  showCursor: z.boolean().default(true),
  /** Cursor character */
  cursorChar: z.string().default("|"),
  /** Cursor blink interval in frames */
  cursorBlinkSpeed: z.number().min(1).default(15),
  /** Text alignment */
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  /** Font weight */
  fontWeight: z.enum(["normal", "bold", "lighter", "bolder"]).default("normal"),
  /** Letter spacing in pixels */
  letterSpacing: z.number().default(0),
  /** Line height multiplier */
  lineHeight: z.number().min(0.5).max(3).default(1.2),
});

export type TypewriterProps = z.infer<typeof TypewriterSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const typewriterDefaultProps: TypewriterProps = {
  text: "Hello, World!",
  fontSize: 48,
  fontFamily: "monospace",
  color: "#ffffff",
  backgroundColor: "transparent",
  typingSpeed: 20,
  startDelay: 0,
  showCursor: true,
  cursorChar: "|",
  cursorBlinkSpeed: 15,
  textAlign: "center",
  fontWeight: "normal",
  letterSpacing: 0,
  lineHeight: 1.2,
};

// ============================================================================
// Component
// ============================================================================

/**
 * Typewriter animation component
 *
 * Displays text character by character with an optional blinking cursor.
 */
export const Typewriter: React.FC<TypewriterProps> = ({
  text = typewriterDefaultProps.text,
  fontSize = typewriterDefaultProps.fontSize,
  fontFamily = typewriterDefaultProps.fontFamily,
  color = typewriterDefaultProps.color,
  backgroundColor = typewriterDefaultProps.backgroundColor,
  typingSpeed = typewriterDefaultProps.typingSpeed,
  startDelay = typewriterDefaultProps.startDelay,
  showCursor = typewriterDefaultProps.showCursor,
  cursorChar = typewriterDefaultProps.cursorChar,
  cursorBlinkSpeed = typewriterDefaultProps.cursorBlinkSpeed,
  textAlign = typewriterDefaultProps.textAlign,
  fontWeight = typewriterDefaultProps.fontWeight,
  letterSpacing = typewriterDefaultProps.letterSpacing,
  lineHeight = typewriterDefaultProps.lineHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Calculate frames per character based on typing speed
  const framesPerChar = fps / typingSpeed;

  // Calculate how many characters to show based on current frame
  const activeFrame = Math.max(0, frame - startDelay);
  const charCount = Math.min(
    Math.floor(activeFrame / framesPerChar),
    text.length
  );

  // Get the visible text
  const visibleText = text.slice(0, charCount);

  // Cursor visibility (blinking effect)
  const cursorVisible =
    showCursor && Math.floor(frame / cursorBlinkSpeed) % 2 === 0;

  // Show cursor only while typing or after completion with blink
  const shouldShowCursor = showCursor && (charCount < text.length || cursorVisible);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: textAlign === "center" ? "center" : textAlign === "right" ? "flex-end" : "flex-start",
        width: "100%",
        height: "100%",
        backgroundColor,
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          fontSize,
          fontFamily,
          color,
          fontWeight,
          letterSpacing,
          lineHeight,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          textAlign,
        }}
      >
        {visibleText}
        {shouldShowCursor && (
          <span
            style={{
              opacity: cursorVisible ? 1 : 0,
              transition: "opacity 0.1s",
            }}
          >
            {cursorChar}
          </span>
        )}
      </span>
    </div>
  );
};

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Typewriter component definition for QCut
 */
export const TypewriterDefinition: RemotionComponentDefinition = {
  id: "built-in-typewriter",
  name: "Typewriter",
  description: "Animates text appearing character by character like a typewriter",
  category: "text",
  durationInFrames: 150,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: TypewriterSchema,
  defaultProps: typewriterDefaultProps,
  component: Typewriter,
  source: "built-in",
  tags: ["text", "animation", "typing", "typewriter"],
  version: "1.0.0",
  author: "QCut",
};

export default Typewriter;
