import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from "remotion";

/**
 * Simple HelloWorld composition for testing.
 * Displays animated text with a spring animation.
 */
export const HelloWorld: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = spring({
    frame,
    fps,
    config: { damping: 200 },
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#1a1a2e",
      }}
    >
      <h1
        style={{
          fontSize: 100,
          fontWeight: "bold",
          color: "white",
          opacity,
        }}
      >
        Hello World
      </h1>
    </AbsoluteFill>
  );
};
