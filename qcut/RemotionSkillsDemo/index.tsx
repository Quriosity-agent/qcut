import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { IntroScene } from "./IntroScene";
import { TypewriterScene } from "./TypewriterScene";
import { FeaturesScene } from "./FeaturesScene";
import { OutroScene } from "./OutroScene";

// Scene durations in frames (at 30fps)
const INTRO_DURATION = 90; // 3s
const TYPEWRITER_DURATION = 150; // 5s
const FEATURES_DURATION = 180; // 6s
const OUTRO_DURATION = 90; // 3s
const TRANSITION_DURATION = 20;

// Total = scenes - transitions overlap
export const REMOTION_SKILLS_DURATION =
  INTRO_DURATION +
  TYPEWRITER_DURATION +
  FEATURES_DURATION +
  OUTRO_DURATION -
  TRANSITION_DURATION * 3;

export const RemotionSkillsDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0f0f0f" }}>
      <TransitionSeries>
        {/* Intro Scene */}
        <TransitionSeries.Sequence durationInFrames={INTRO_DURATION}>
          <IntroScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />

        {/* Typewriter Demo */}
        <TransitionSeries.Sequence durationInFrames={TYPEWRITER_DURATION}>
          <TypewriterScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />

        {/* Features Grid */}
        <TransitionSeries.Sequence durationInFrames={FEATURES_DURATION}>
          <FeaturesScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />

        {/* Outro */}
        <TransitionSeries.Sequence durationInFrames={OUTRO_DURATION}>
          <OutroScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
