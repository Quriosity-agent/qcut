const MINTERPOLATE_LOOKAHEAD_FRAMES = 2;

function formatFilterNumber({ value }: { value: number }): string {
	return String(Number(value.toFixed(6)));
}

/**
 * minterpolate works on four frames at a time and writes the stretch between
 * the middle two, so a clip's last stretch, from its last frame to its end,
 * is only written once two more frames follow. Copies of the last frame are
 * added for that: two of the clip's own frames, and the length of two
 * output frames on top.
 *
 * The length alone is what this used to add. For a source slower than the
 * timeline, which is what interpolation is for, it is fewer than two frames
 * (one for 12 fps on 24), and the clip then ended on the blend before its
 * last frame unless that frame fell exactly on an output frame. It stays as
 * well, so no stream comes out shorter than it did: the layers that are
 * retimed before they are interpolated end with it.
 */
export function buildDurationPreservingFrameInterpolationFilter({
	mode,
	fps,
}: {
	/** "neural" is resolved before the graph is built (see neural-frame-interpolation.ts). */
	mode?: "none" | "blend" | "motion-compensated" | "neural";
	fps: number;
}): string {
	// A neural segment that reaches graph construction was never prepared;
	// silently exporting it uninterpolated would misrepresent the setting.
	if (mode === "neural") {
		throw new Error(
			"Neural frame interpolation must be resolved before the filter graph is built"
		);
	}
	if (mode !== "blend" && mode !== "motion-compensated") return "";
	if (!Number.isFinite(fps) || fps <= 0) {
		throw new RangeError("fps must be a positive finite number");
	}

	const outputFps = Math.max(1, fps);
	const interpolation =
		mode === "motion-compensated"
			? `minterpolate=fps=${outputFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
			: `minterpolate=fps=${outputFps}:mi_mode=blend`;
	const lookaheadDuration = formatFilterNumber({
		value: MINTERPOLATE_LOOKAHEAD_FRAMES / outputFps,
	});
	return [
		`tpad=stop_mode=clone:stop=${MINTERPOLATE_LOOKAHEAD_FRAMES}`,
		`tpad=stop_mode=clone:stop_duration=${lookaheadDuration}`,
		interpolation,
	].join(",");
}
