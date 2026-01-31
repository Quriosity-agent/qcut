import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const FULL_TEXT = "Build stunning videos with React components.";
const PAUSE_AFTER = "Build stunning videos";
const CHAR_FRAMES = 3;
const PAUSE_SECONDS = 0.8;
const CURSOR_BLINK_FRAMES = 16;

const getTypedText = ({
  frame,
  fullText,
  pauseAfter,
  charFrames,
  pauseFrames,
}: {
  frame: number;
  fullText: string;
  pauseAfter: string;
  charFrames: number;
  pauseFrames: number;
}): string => {
  const pauseIndex = fullText.indexOf(pauseAfter);
  const preLen =
    pauseIndex >= 0 ? pauseIndex + pauseAfter.length : fullText.length;

  let typedChars = 0;
  if (frame < preLen * charFrames) {
    typedChars = Math.floor(frame / charFrames);
  } else if (frame < preLen * charFrames + pauseFrames) {
    typedChars = preLen;
  } else {
    const postPhase = frame - preLen * charFrames - pauseFrames;
    typedChars = Math.min(
      fullText.length,
      preLen + Math.floor(postPhase / charFrames)
    );
  }
  return fullText.slice(0, typedChars);
};

const Cursor: React.FC<{
  frame: number;
  blinkFrames: number;
}> = ({ frame, blinkFrames }) => {
  const opacity = interpolate(
    frame % blinkFrames,
    [0, blinkFrames / 2, blinkFrames],
    [1, 0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <span
      style={{
        opacity,
        color: "#0099ff",
        marginLeft: 2,
      }}
    >
      |
    </span>
  );
};

export const TypewriterScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pauseFrames = Math.round(fps * PAUSE_SECONDS);

  const typedText = getTypedText({
    frame,
    fullText: FULL_TEXT,
    pauseAfter: PAUSE_AFTER,
    charFrames: CHAR_FRAMES,
    pauseFrames,
  });

  // Label fade in
  const labelOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0f0f0f",
        justifyContent: "center",
        alignItems: "center",
        padding: 100,
      }}
    >
      {/* Section Label */}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 100,
          opacity: labelOpacity,
        }}
      >
        <span
          style={{
            color: "#0099ff",
            fontSize: 18,
            fontFamily: "monospace",
            textTransform: "uppercase",
            letterSpacing: 3,
          }}
        >
          Typewriter Animation
        </span>
      </div>

      {/* Typewriter Text */}
      <div
        style={{
          backgroundColor: "#1a1a1a",
          borderRadius: 16,
          padding: "60px 80px",
          border: "1px solid #333",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <p
          style={{
            color: "#ffffff",
            fontSize: 48,
            fontWeight: 600,
            fontFamily: "Inter, sans-serif",
            margin: 0,
            minHeight: 60,
          }}
        >
          {typedText}
          <Cursor frame={frame} blinkFrames={CURSOR_BLINK_FRAMES} />
        </p>
      </div>

      {/* Code snippet */}
      <div
        style={{
          position: "absolute",
          bottom: 100,
          opacity: interpolate(frame, [60, 80], [0, 0.6], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        <code
          style={{
            color: "#666",
            fontSize: 16,
            fontFamily: "monospace",
          }}
        >
          useCurrentFrame() + string.slice(0, typedChars)
        </code>
      </div>
    </AbsoluteFill>
  );
};
