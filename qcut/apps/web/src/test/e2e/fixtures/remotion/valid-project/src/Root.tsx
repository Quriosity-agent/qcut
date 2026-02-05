import { Composition } from "remotion";
import { HelloWorld } from "./HelloWorld";
import { TestAnimation } from "./TestAnimation";

/**
 * Root component for the test Remotion project.
 * Registers all compositions available in this project.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HelloWorld"
        component={HelloWorld}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="TestAnimation"
        component={TestAnimation}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
