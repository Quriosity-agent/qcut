export const CANVAS_PLAYBACK_SEGMENT_SECONDS = 2;

export function createCanvasPlaybackWindow({
	width,
	height,
	fps,
	frames,
	maxBytes,
}: {
	width: number;
	height: number;
	fps: number;
	frames: number;
	maxBytes: number;
}) {
	if (
		![width, height, frames, maxBytes].every(
			(value) => Number.isSafeInteger(value) && value > 0
		) ||
		!Number.isFinite(fps) ||
		fps <= 0
	)
		throw new Error("Invalid rolling playback dimensions or budget");
	// Reserve for uncompressible RGBA PNGs, scanlines and encoder overhead.
	const frameReservation = Math.ceil(width * height * 4 * 1.01) + 65_536;
	const segmentFrames = Math.min(
		frames,
		Math.max(1, Math.ceil(fps * CANVAS_PLAYBACK_SEGMENT_SECONDS)),
		Math.floor(maxBytes / (3 * frameReservation))
	);
	if (segmentFrames < 1)
		throw new Error("Effect playback cache cannot hold a rolling frame window");
	const segment = ({ frame }: { frame: number }) =>
		Math.floor(frame / segmentFrames);
	const range = ({ index }: { index: number }) => ({
		start: index * segmentFrames,
		end: Math.min(frames, (index + 1) * segmentFrames),
	});
	return {
		segmentFrames,
		segment,
		range,
		at({ frame }: { frame: number }) {
			const index = segment({ frame });
			return {
				start: Math.max(0, (index - 1) * segmentFrames),
				end: Math.min(frames, (index + 2) * segmentFrames),
				segments: [index, index + 1].filter(
					(value) => value * segmentFrames < frames
				),
			};
		},
	};
}
