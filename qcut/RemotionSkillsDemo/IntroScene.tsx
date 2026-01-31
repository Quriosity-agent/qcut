import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo scale with spring animation
  const logoScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  // Title fade in after logo
  const titleOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [30, 50], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Subtitle fade in
  const subtitleOpacity = interpolate(frame, [50, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0f0f0f",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Remotion Logo */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          marginBottom: 40,
        }}
      >
        <svg width="120" height="120" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0099ff" />
              <stop offset="100%" stopColor="#00ccff" />
            </linearGradient>
          </defs>
          <polygon
            points="20,10 80,50 20,90"
            fill="url(#logoGrad)"
            style={{ filter: "drop-shadow(0 4px 20px rgba(0,153,255,0.4))" }}
          />
        </svg>
      </div>

      {/* Title */}
      <h1
        style={{
          color: "#ffffff",
          fontSize: 72,
          fontWeight: 700,
          fontFamily: "Inter, sans-serif",
          margin: 0,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        Remotion Skills Demo
      </h1>

      {/* Subtitle */}
      <p
        style={{
          color: "#888888",
          fontSize: 28,
          fontFamily: "Inter, sans-serif",
          marginTop: 20,
          opacity: subtitleOpacity,
        }}
      >
        Best practices for video creation in React
      </p>
    </AbsoluteFill>
  );
};
