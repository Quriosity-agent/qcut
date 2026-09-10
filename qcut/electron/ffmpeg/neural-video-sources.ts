import path from "node:path";
import { getVideoSourceTimelineDuration } from "../ffmpeg-video-transform.js";
import { prepareNeuralInterpolation } from "./neural-frame-interpolation.js";
import type { VideoSource } from "./types.js";

/**
 * Resolves `frameInterpolation: "neural"` sources for the FFmpeg export
 * handler before the timeline graph is built.
 *
 * A `VideoSource.duration` is the media duration; the read window is what is
 * left after both trims, and the output span comes from the same speed
 * resolution the graph uses. The interpolated intermediate replaces the file
 * for exactly that window, so trims collapse to zero and a freeze-frame time,
 * which is in source seconds, shifts with the in-point. Speed curves keep
 * working because their keyframes are timed in project frames, not source
 * frames.
 */
export async function resolveNeuralVideoSources({
	videoSources,
	fps,
	workDir,
	onProgress,
}: {
	videoSources: VideoSource[];
	fps: number;
	workDir: string;
	onProgress?: (progress: number) => void;
}): Promise<VideoSource[]> {
	const neuralIndexes = videoSources.flatMap((source, index) =>
		source.frameInterpolation === "neural" ? [index] : []
	);
	if (neuralIndexes.length === 0) return videoSources;
	const resolved = [...videoSources];
	for (const [position, index] of neuralIndexes.entries()) {
		const source = videoSources[index];
		const trimStart = Math.max(0, source.trimStart ?? 0);
		const readDuration = Math.max(
			1 / Math.max(1, fps),
			source.duration - trimStart - Math.max(0, source.trimEnd ?? 0)
		);
		const outputSpan =
			getVideoSourceTimelineDuration({ source, fps }) -
			Math.max(0, source.freezeFrameDuration ?? 0);
		const { frameInterpolation: _neural, ...rest } = source;
		const prepared = await prepareNeuralInterpolation({
			sourcePath: source.path,
			trimStart,
			readDuration,
			requiredFrames: Math.max(2, Math.ceil(outputSpan * fps)),
			workDir: path.join(workDir, `neural-${index}`),
			onProgress: (progress) =>
				onProgress?.((position + progress) / neuralIndexes.length),
		});
		if (!prepared) {
			resolved[index] = rest;
			continue;
		}
		resolved[index] = {
			...rest,
			path: prepared.path,
			duration: readDuration,
			trimStart: 0,
			trimEnd: 0,
			...(source.freezeFrameTime === undefined
				? {}
				: { freezeFrameTime: Math.max(0, source.freezeFrameTime - trimStart) }),
		};
	}
	return resolved;
}
