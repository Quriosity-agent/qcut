import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Command scale animation
  const commandScale = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 80 },
  });

  // Text fade in
  const textOpacity = interpolate(frame, [20, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Glow pulse
  const glowIntensity = interpolate(
    Math.sin(frame * 0.1),
    [-1, 1],
    [0.3, 0.6]
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0f0f0f",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Command Box */}
      <div
        style={{
          transform: `scale(${commandScale})`,
          backgroundColor: "#1a1a1a",
          borderRadius: 12,
          padding: "24px 48px",
          border: "1px solid #0099ff",
          boxShadow: `0 0 ${40 * glowIntensity}px rgba(0,153,255,${glowIntensity})`,
        }}
      >
        <code
          style={{
            color: "#0099ff",
            fontSize: 28,
            fontFamily: "monospace",
            fontWeight: 500,
          }}
        >
          npx skills add remotion-dev/skills
        </code>
      </div>

      {/* CTA Text */}
      <p
        style={{
          color: "#ffffff",
          fontSize: 32,
          fontFamily: "Inter, sans-serif",
          marginTop: 40,
          opacity: textOpacity,
        }}
      >
        Get started today
      </p>

      {/* Footer */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          display: "flex",
          gap: 30,
          opacity: textOpacity,
        }}
      >
        <span style={{ color: "#666", fontSize: 18, fontFamily: "Inter, sans-serif" }}>
          remotion.dev
        </span>
        <span style={{ color: "#444" }}>•</span>
        <span style={{ color: "#666", fontSize: 18, fontFamily: "Inter, sans-serif" }}>
          github.com/remotion-dev/skills
        </span>
      </div>
    </AbsoluteFill>
  );
};
