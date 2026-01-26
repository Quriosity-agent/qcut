/**
 * Skills Demo Template Component
 *
 * A terminal-style demo showing the "npx skills add" workflow.
 * Useful for debugging and showcasing terminal animations.
 *
 * @module lib/remotion/built-in/templates/skills-demo
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  AbsoluteFill,
} from "remotion";
import { z } from "zod";
import type { RemotionComponentDefinition } from "../../types";

// ============================================================================
// Schema
// ============================================================================

/**
 * Zod schema for Skills Demo component props
 */
export const SkillsDemoSchema = z.object({
  /** Command to type */
  command: z.string().default("npx skills add remotion-dev/remotion"),
  /** Skill name */
  skillName: z.string().default("Remotion Best Practices"),
  /** Number of rules */
  ruleCount: z.number().default(32),
  /** Terminal background color */
  terminalBg: z.string().default("#FFFFFF"),
  /** Text color */
  textColor: z.string().default("#1D1D1F"),
  /** Path color */
  pathColor: z.string().default("#5856D6"),
  /** Accent color */
  accentColor: z.string().default("#7C3AED"),
  /** Success color */
  successColor: z.string().default("#10B981"),
  /** Typing speed (frames per character) */
  typingSpeed: z.number().min(1).max(10).default(2),
});

export type SkillsDemoProps = z.infer<typeof SkillsDemoSchema>;

// ============================================================================
// Default Props
// ============================================================================

export const skillsDemoDefaultProps: SkillsDemoProps = {
  command: "npx skills add remotion-dev/remotion",
  skillName: "Remotion Best Practices",
  ruleCount: 32,
  terminalBg: "#FFFFFF",
  textColor: "#1D1D1F",
  pathColor: "#5856D6",
  accentColor: "#7C3AED",
  successColor: "#10B981",
  typingSpeed: 2,
};

// ============================================================================
// Constants
// ============================================================================

const WINDOW_BG = "#FFFFFF";
const TITLEBAR_BG = "#E8E8E8";
const TITLEBAR_BORDER = "#D1D1D1";
const CLOSE_BTN = "#FF5F57";
const MINIMIZE_BTN = "#FEBC2E";
const MAXIMIZE_BTN = "#28C840";

// ============================================================================
// Component
// ============================================================================

/**
 * Skills Demo template component
 *
 * Creates a terminal animation showing the skills installation workflow.
 */
export const SkillsDemo: React.FC<Partial<SkillsDemoProps>> = ({
  command = skillsDemoDefaultProps.command,
  skillName = skillsDemoDefaultProps.skillName,
  ruleCount = skillsDemoDefaultProps.ruleCount,
  terminalBg = skillsDemoDefaultProps.terminalBg,
  textColor = skillsDemoDefaultProps.textColor,
  pathColor = skillsDemoDefaultProps.pathColor,
  accentColor = skillsDemoDefaultProps.accentColor,
  successColor = skillsDemoDefaultProps.successColor,
  typingSpeed = skillsDemoDefaultProps.typingSpeed,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Cursor blink animation
  const cursorOpacity = interpolate(
    frame % 30,
    [0, 15, 15.01, 30],
    [1, 1, 0, 0]
  );

  // Simple scale entrance
  const scaleProgress = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 100 },
  });
  const scale = interpolate(scaleProgress, [0, 1], [0.95, 1]);
  const opacity = interpolate(scaleProgress, [0, 1], [0, 1]);

  // === CONVERSATION TIMELINE ===
  const CHAR_SPEED = typingSpeed;

  // Line 1: User types command
  const commandStart = 30;
  const commandChars = Math.floor(Math.max(0, frame - commandStart) / CHAR_SPEED);
  const commandText = command.slice(0, Math.min(commandChars, command.length));
  const commandDone = commandChars >= command.length;
  const commandEndFrame = commandStart + command.length * CHAR_SPEED + 20;

  // Line 2: Agent response - Installing
  const line2Start = commandEndFrame;
  const line2Text = `Installing skill from ${command.split(" ").pop()}...`;
  const line2Chars = Math.floor(Math.max(0, frame - line2Start) / 1);
  const line2Visible = frame >= line2Start;
  const line2Content = line2Text.slice(0, Math.min(line2Chars, line2Text.length));

  // Line 3: Found skill
  const line3Start = line2Start + 50;
  const line3Visible = frame >= line3Start;

  // Line 4: Downloading
  const line4Start = line3Start + 40;
  const line4Visible = frame >= line4Start;

  // Progress bar
  const progressStart = line4Start + 30;
  const progressEnd = progressStart + 60;
  const progressPercent = interpolate(
    frame,
    [progressStart, progressEnd],
    [0, 100],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const progressVisible = frame >= progressStart;

  // Line 5: Success message
  const line5Start = progressEnd + 20;
  const line5Visible = frame >= line5Start;

  // Line 6: Usage hint
  const line6Start = line5Start + 30;
  const line6Visible = frame >= line6Start;

  // Line 7: Agent asks question
  const line7Start = line6Start + 50;
  const line7Text = "Would you like me to explain the available rules?";
  const line7Chars = Math.floor(Math.max(0, frame - line7Start) / 1);
  const line7Visible = frame >= line7Start;
  const line7Content = line7Text.slice(0, Math.min(line7Chars, line7Text.length));

  // Line 8: User response
  const line8Start = line7Start + line7Text.length + 40;
  const line8Command = "yes";
  const line8Chars = Math.floor(Math.max(0, frame - line8Start) / CHAR_SPEED);
  const line8Visible = frame >= line8Start;
  const line8Content = line8Command.slice(0, Math.min(line8Chars, line8Command.length));
  const line8Done = line8Chars >= line8Command.length;

  // Line 9: Agent lists rules
  const line9Start = line8Start + line8Command.length * CHAR_SPEED + 30;
  const line9Visible = frame >= line9Start;

  // Cursor position
  const showCursorOnCommand = !commandDone && frame >= commandStart;
  const showCursorOnLine8 = line8Visible && !line8Done;
  const showCursorAtEnd = line9Visible;

  const rules = ["animations", "timing", "sequencing", "transitions", "audio", "fonts", "3d"];

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(150deg, #E8F4FD 0%, #F5F5F7 50%, #FDF2F8 100%)",
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
      }}
    >
      {/* Static background orbs */}
      <div
        style={{
          position: "absolute",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, transparent 70%)",
          top: "10%",
          left: "10%",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(236, 72, 153, 0.10) 0%, transparent 70%)",
          bottom: "15%",
          right: "15%",
        }}
      />

      {/* Terminal Window */}
      <div
        style={{
          width: 1100,
          height: 700,
          backgroundColor: WINDOW_BG,
          borderRadius: 12,
          boxShadow: "0 22px 70px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          transform: `scale(${scale})`,
          opacity,
        }}
      >
        {/* Title Bar */}
        <div
          style={{
            height: 52,
            backgroundColor: TITLEBAR_BG,
            borderBottom: `1px solid ${TITLEBAR_BORDER}`,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            position: "relative",
          }}
        >
          {/* Window Controls */}
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: CLOSE_BTN,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
              }}
            />
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: MINIMIZE_BTN,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
              }}
            />
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: MAXIMIZE_BTN,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
              }}
            />
          </div>

          {/* Window Title */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "#3D3D3D",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
              }}
            >
              Terminal — zsh — 120×35
            </span>
          </div>
        </div>

        {/* Terminal Content */}
        <div
          style={{
            flex: 1,
            backgroundColor: terminalBg,
            padding: 20,
            fontFamily: "'SF Mono', 'Monaco', 'Menlo', monospace",
            fontSize: 15,
            lineHeight: 1.7,
            overflow: "hidden",
          }}
        >
          {/* Line 1: User command */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ color: pathColor, fontWeight: 500 }}>~/projects</span>
            <span style={{ color: textColor, margin: "0 8px" }}>$</span>
            <span style={{ color: textColor }}>{commandText}</span>
            {showCursorOnCommand && (
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 18,
                  backgroundColor: textColor,
                  opacity: cursorOpacity,
                  marginLeft: 1,
                }}
              />
            )}
          </div>

          {/* Line 2: Installing */}
          {line2Visible && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#007AFF" }}>●</span>
              <span style={{ color: "#6B7280" }}>{line2Content}</span>
            </div>
          )}

          {/* Line 3: Found skill */}
          {line3Visible && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: successColor }}>✓</span>
              <span style={{ color: textColor }}>
                Found skill: <span style={{ color: accentColor, fontWeight: 600 }}>{skillName}</span>
              </span>
            </div>
          )}

          {/* Line 4: Downloading */}
          {line4Visible && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#007AFF" }}>↓</span>
              <span style={{ color: "#6B7280" }}>Downloading {ruleCount} rules and 3 assets...</span>
            </div>
          )}

          {/* Progress bar */}
          {progressVisible && (
            <div style={{ marginTop: 8, marginLeft: 20 }}>
              <div
                style={{
                  width: 300,
                  height: 8,
                  backgroundColor: "#E5E7EB",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${progressPercent}%`,
                    height: "100%",
                    backgroundColor: accentColor,
                    borderRadius: 4,
                  }}
                />
              </div>
              <span style={{ color: "#6B7280", fontSize: 12, marginTop: 4, display: "block" }}>
                {Math.round(progressPercent)}% complete
              </span>
            </div>
          )}

          {/* Line 5: Success */}
          {line5Visible && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: successColor }}>✓</span>
              <span style={{ color: successColor, fontWeight: 600 }}>
                Skill installed successfully!
              </span>
            </div>
          )}

          {/* Line 6: Usage hint */}
          {line6Visible && (
            <div style={{ marginTop: 8, paddingLeft: 20 }}>
              <span style={{ color: "#6B7280" }}>
                You can now use{" "}
                <span
                  style={{
                    backgroundColor: "#F3F4F6",
                    padding: "2px 8px",
                    borderRadius: 4,
                    color: accentColor,
                    fontWeight: 500,
                  }}
                >
                  /remotion-best-practices
                </span>
                {" "}in your conversations
              </span>
            </div>
          )}

          {/* Line 7: Agent question */}
          {line7Visible && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                backgroundColor: "#F9FAFB",
                borderRadius: 8,
                borderLeft: `3px solid ${accentColor}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span
                  style={{
                    backgroundColor: accentColor,
                    color: "white",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Agent
                </span>
              </div>
              <span style={{ color: textColor }}>{line7Content}</span>
            </div>
          )}

          {/* Line 8: User response */}
          {line8Visible && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center" }}>
              <span style={{ color: pathColor, fontWeight: 500 }}>~/projects</span>
              <span style={{ color: textColor, margin: "0 8px" }}>$</span>
              <span style={{ color: textColor }}>{line8Content}</span>
              {showCursorOnLine8 && (
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 18,
                    backgroundColor: textColor,
                    opacity: cursorOpacity,
                    marginLeft: 1,
                  }}
                />
              )}
            </div>
          )}

          {/* Line 9: Agent lists rules */}
          {line9Visible && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                backgroundColor: "#F9FAFB",
                borderRadius: 8,
                borderLeft: `3px solid ${accentColor}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span
                  style={{
                    backgroundColor: accentColor,
                    color: "white",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Agent
                </span>
              </div>
              <span style={{ color: textColor }}>Here are the available rules:</span>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {rules.map((rule, i) => (
                  <span
                    key={rule}
                    style={{
                      backgroundColor: "#EDE9FE",
                      color: accentColor,
                      padding: "4px 10px",
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 500,
                      opacity: interpolate(
                        frame - line9Start - i * 5,
                        [0, 10],
                        [0, 1],
                        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                      ),
                    }}
                  >
                    {rule}
                  </span>
                ))}
                <span style={{ color: "#6B7280", fontSize: 13 }}>...and {ruleCount - rules.length} more</span>
              </div>
              {showCursorAtEnd && (
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 18,
                    backgroundColor: textColor,
                    opacity: cursorOpacity,
                    marginLeft: 4,
                    marginTop: 8,
                  }}
                />
              )}
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
 * Skills Demo template component definition for QCut
 */
export const SkillsDemoDefinition: RemotionComponentDefinition = {
  id: "built-in-skills-demo",
  name: "Skills Demo",
  description: "Terminal animation showing the skills installation workflow",
  category: "template",
  durationInFrames: 540,
  fps: 30,
  width: 1920,
  height: 1080,
  schema: SkillsDemoSchema,
  defaultProps: skillsDemoDefaultProps,
  component: SkillsDemo as React.ComponentType<Record<string, unknown>>,
  source: "built-in",
  tags: ["template", "terminal", "demo", "skills", "cli", "animation"],
  version: "1.0.0",
  author: "QCut",
};

export default SkillsDemo;
