import path from "node:path";
import { prepareNeuralInterpolation } from "../../../ffmpeg/neural-frame-interpolation.js";
import type { ExportSegment, ResolvedExportSettings } from "./types.js";

/**
 * Resolves a `frameInterpolation: "neural"` segment before its FFmpeg command
 * is built: the source window is interpolated with RIFE and the segment is
 * rewritten to read the lossless intermediate from its start. Every other
 * segment passes through untouched. When the source already carries enough
 * frames the mode is simply dropped — there is nothing to synthesise.
 */
export async function resolveNeuralInterpolationSegment({
	segment,
	settings,
	tempDir,
	index,
	onProgress,
}: {
	segment: ExportSegment;
	settings: ResolvedExportSettings;
	tempDir: string;
	index: number;
	onProgress?: (progress: number) => void;
}): Promise<ExportSegment> {
	if (segment.frameInterpolation !== "neural" || segment.isImage)
		return segment;
	const { frameInterpolation: _neural, ...rest } = segment;
	const playbackRate = segment.playbackRate ?? 1;
	const prepared = await prepareNeuralInterpolation({
		sourcePath: segment.sourcePath,
		trimStart: segment.trimStart,
		readDuration: segment.duration * playbackRate,
		// Distinct output frames this stretch of timeline will display.
		requiredFrames: Math.max(2, Math.ceil(segment.duration * settings.fps)),
		workDir: path.join(tempDir, `neural-${index}`),
		onProgress,
	});
	if (!prepared) return rest;
	return { ...rest, sourcePath: prepared.path, trimStart: 0 };
}
