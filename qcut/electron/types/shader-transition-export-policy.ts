/**
 * Export policy for GLSL shader transitions (the `gl-*` Transition Lab
 * recipes).
 *
 * FFmpeg cannot run a shader, so a timeline that holds one exports through the
 * renderer's canvas engine — the same choice the editor's own export picker
 * makes — instead of failing in the native CLI path.
 */

interface ShaderTransitionTimeline {
	tracks: Array<{ transitions?: Array<{ type?: string }> | null }>;
}

export function timelineRequiresRendererShaderTransitionExport({
	timeline,
}: {
	timeline: ShaderTransitionTimeline;
}): boolean {
	return timeline.tracks.some((track) =>
		(track.transitions ?? []).some((transition) => transition.type === "shader")
	);
}
