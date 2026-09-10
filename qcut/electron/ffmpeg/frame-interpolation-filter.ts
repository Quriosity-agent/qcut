const MINTERPOLATE_LOOKAHEAD_FRAMES = 2;

function formatFilterNumber({ value }: { value: number }): string {
	return String(Number(value.toFixed(6)));
}

/**
 * minterpolate buffers two trailing frames. Cloned lookahead lets the caller's
 * existing segment-duration boundary retain the complete final frame range.
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
	const lookaheadDuration = formatFilterNumber({
		value: MINTERPOLATE_LOOKAHEAD_FRAMES / outputFps,
	});
	const interpolation =
		mode === "motion-compensated"
			? `minterpolate=fps=${outputFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
			: `minterpolate=fps=${outputFps}:mi_mode=blend`;
	return `tpad=stop_mode=clone:stop_duration=${lookaheadDuration},${interpolation}`;
}
