import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const features = [
  { icon: "🎬", title: "Animations", desc: "Spring & interpolate" },
  { icon: "🔤", title: "Typography", desc: "Text effects" },
  { icon: "🎵", title: "Audio", desc: "Sound & music" },
  { icon: "🖼️", title: "Assets", desc: "Images & videos" },
  { icon: "✂️", title: "Transitions", desc: "Scene changes" },
  { icon: "📊", title: "Charts", desc: "Data viz" },
];

const FeatureCard: React.FC<{
  feature: (typeof features)[0];
  index: number;
  frame: number;
  fps: number;
}> = ({ feature, index, frame, fps }) => {
  const delay = index * 8;

  const scale = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const opacity = interpolate(frame - delay, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        backgroundColor: "#1a1a1a",
        borderRadius: 16,
        padding: 30,
        border: "1px solid #333",
        transform: `scale(${Math.max(0, scale)})`,
        opacity: Math.max(0, opacity),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 48 }}>{feature.icon}</span>
      <h3
        style={{
          color: "#ffffff",
          fontSize: 24,
          fontWeight: 600,
          fontFamily: "Inter, sans-serif",
          margin: 0,
        }}
      >
        {feature.title}
      </h3>
      <p
        style={{
          color: "#888",
          fontSize: 16,
          fontFamily: "Inter, sans-serif",
          margin: 0,
        }}
      >
        {feature.desc}
      </p>
    </div>
  );
};

export const FeaturesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title animation
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 20], [-20, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0f0f0f",
        padding: 80,
      }}
    >
      {/* Section Title */}
      <h2
        style={{
          color: "#ffffff",
          fontSize: 48,
          fontWeight: 700,
          fontFamily: "Inter, sans-serif",
          textAlign: "center",
          margin: 0,
          marginBottom: 60,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        Best Practices Included
      </h2>

      {/* Features Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 30,
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        {features.map((feature, index) => (
          <FeatureCard
            key={feature.title}
            feature={feature}
            index={index}
            frame={frame}
            fps={fps}
          />
        ))}
      </div>

      {/* Footer note */}
      <p
        style={{
          color: "#666",
          fontSize: 18,
          fontFamily: "Inter, sans-serif",
          textAlign: "center",
          marginTop: 50,
          opacity: interpolate(frame, [100, 120], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        36 rule files covering every aspect of Remotion development
      </p>
    </AbsoluteFill>
  );
};
