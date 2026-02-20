import {
	AbsoluteFill,
	useCurrentFrame,
	useVideoConfig,
	interpolate,
} from "remotion";

/**
 * Test animation composition with rotating and scaling elements.
 * Used for testing more complex Remotion compositions.
 */
export const TestAnimation: React.FC = () => {
	const frame = useCurrentFrame();
	const { durationInFrames } = useVideoConfig();

	const rotation = interpolate(frame, [0, durationInFrames], [0, 360]);

	const scale = interpolate(
		frame,
		[0, durationInFrames / 2, durationInFrames],
		[1, 1.5, 1]
	);

	return (
		<AbsoluteFill
			style={{
				justifyContent: "center",
				alignItems: "center",
				backgroundColor: "#16213e",
			}}
		>
			<div
				style={{
					width: 200,
					height: 200,
					backgroundColor: "#e94560",
					transform: `rotate(${rotation}deg) scale(${scale})`,
					borderRadius: 20,
				}}
			/>
		</AbsoluteFill>
	);
};
