/**
 * Media overlays in the native export.
 *
 * After the joined picture is cut (and its transitions rendered), one FFmpeg
 * pass draws every overlay clip over it, lowest track first, each only inside
 * its own time range. Each overlay goes through the editor's layer chain on a
 * transparent canvas in RGBA, so its own alpha (VP9 with `alpha_mode=1`
 * decoded by libvpx, ProRes 4444, QuickTime Animation, PNG) and the clip's
 * opacity, transform and blend mode carry into the composite; an opaque clip
 * covers what is under it like picture-in-picture. Only the final encode
 * turns the picture into yuv420p, and the sound is copied untouched.
 *
 * @module electron/claude/handlers/claude-export-handler/media-overlay-pass
 */

import { promises as fsPromises } from "node:fs";
import path from "node:path";
import type { VideoAlphaInfo } from "../../../ffmpeg/video-alpha.js";
import { probeVideoAlpha } from "../../../ffmpeg/video-alpha-probe.js";
import { composePreparedVisualLayers } from "../../../ffmpeg/visual-layer-compositor.js";
import { buildVideoTimelineLayers } from "../../../ffmpeg-video-transform.js";
import { claudeLog } from "../../utils/logger.js";
import {
	mediaOverlayInputArgs,
	mediaOverlayVideoSource,
	overlayFrameWindow,
} from "./media-overlay-source.js";
import { moveFile } from "./move-file.js";
import {
	type ExportSegment,
	HANDLER_NAME,
	type ResolvedExportSettings,
} from "./types.js";
import { parseBitrateForKbps } from "./utils.js";

export interface MediaOverlayInput {
	segment: ExportSegment;
	/** Null for a still, or a file whose alpha could not be read. */
	alpha: VideoAlphaInfo | null;
}

const OUTPUT_LABEL = "media_overlay_out";

/**
 * The FFmpeg command that draws `overlays` over `inputPath` for `duration`
 * seconds (the joined picture's length).
 */
export function buildMediaOverlayPassArgs({
	inputPath,
	outputPath,
	overlays,
	settings,
	duration,
}: {
	inputPath: string;
	outputPath: string;
	overlays: MediaOverlayInput[];
	settings: Pick<
		ResolvedExportSettings,
		"width" | "height" | "fps" | "codec" | "bitrate"
	>;
	duration: number;
}): { args: string[]; filterComplex: string } {
	const inputArgs = ["-y", "-i", inputPath];
	for (const overlay of overlays) {
		inputArgs.push(...mediaOverlayInputArgs(overlay));
	}
	const built = buildVideoTimelineLayers({
		videoSources: overlays.map(({ segment }) =>
			mediaOverlayVideoSource({ segment, fps: settings.fps })
		),
		inputIndexes: overlays.map((_overlay, index) => index + 1),
		width: settings.width,
		height: settings.height,
		fps: settings.fps,
		totalDuration: duration,
	});
	// Each layer gets exactly the frames the preview shows it on (its last
	// frame held if the source runs short, a frame past the clip dropped),
	// and is switched on for those frames only, with half a frame of margin.
	// FFmpeg's own end-of-input timing is left out of it: it ended
	// millisecond-stamped WebM layers a frame or two early and others a
	// frame late.
	const exactSteps: string[] = [];
	const composed = composePreparedVisualLayers({
		baseLabel: "0:v",
		layers: built.layers.map((layer) => {
			const { segment } = overlays[layer.sourceIndex - 1];
			const { firstFrame, frameCount } = overlayFrameWindow({
				startTime: segment.startTime,
				duration: segment.duration,
				fps: settings.fps,
			});
			const exactLabel = `${layer.outputLabel}_exact`;
			exactSteps.push(
				`[${layer.outputLabel}]setpts=PTS-STARTPTS,` +
					"tpad=stop_mode=clone:stop=-1," +
					`trim=end_frame=${frameCount},` +
					`setpts=PTS-STARTPTS+${firstFrame}/${settings.fps}/TB[${exactLabel}]`
			);
			return {
				inputLabel: exactLabel,
				kind: "video" as const,
				trackOrder: layer.trackOrder,
				elementOrder: layer.elementOrder,
				sourceOrder: layer.sourceIndex,
				legacyOrder: 0,
				blendMode: layer.blendMode,
				startTime: (firstFrame - 0.5) / settings.fps,
				endTime: (firstFrame + frameCount - 0.5) / settings.fps,
			};
		}),
		labelPrefix: "media_overlay",
		canvasWidth: settings.width,
		canvasHeight: settings.height,
	});
	const filterComplex = [
		...built.filterSteps,
		...exactSteps,
		...composed.filterSteps,
		`[${composed.outputLabel}]format=yuv420p[${OUTPUT_LABEL}]`,
	].join(";");
	return {
		filterComplex,
		args: [
			...inputArgs,
			"-filter_complex",
			filterComplex,
			"-map",
			`[${OUTPUT_LABEL}]`,
			"-map",
			"0:a?",
			"-c:v",
			settings.codec,
			"-preset",
			"medium",
			"-b:v",
			parseBitrateForKbps({ bitrate: settings.bitrate }),
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"copy",
			"-t",
			String(duration),
			"-movflags",
			"+faststart",
			outputPath,
		],
	};
}

/** Reads each overlay video's alpha; a still needs no decoder choice. */
export async function probeMediaOverlayInputs({
	overlays,
	probe = probeVideoAlpha,
}: {
	overlays: ExportSegment[];
	probe?: typeof probeVideoAlpha;
}): Promise<MediaOverlayInput[]> {
	const known = new Map<string, Promise<VideoAlphaInfo | null>>();
	return Promise.all(
		overlays.map(async (segment) => {
			if (segment.isImage) return { segment, alpha: null };
			let alpha = known.get(segment.sourcePath);
			if (!alpha) {
				alpha = probe({ mediaPath: segment.sourcePath });
				known.set(segment.sourcePath, alpha);
			}
			return { segment, alpha: await alpha };
		})
	);
}

/**
 * Draws `overlays` over the export at `videoOutputPath` in place. A failure
 * restores the picture before the pass and fails the export, naming the clips.
 */
export async function runMediaOverlayPass({
	overlays,
	videoOutputPath,
	tempDir,
	settings,
	duration,
	signal,
	runFFmpegCommand,
	onProgress,
}: {
	overlays: ExportSegment[];
	videoOutputPath: string;
	tempDir: string;
	settings: Pick<
		ResolvedExportSettings,
		"width" | "height" | "fps" | "codec" | "bitrate"
	>;
	duration: number;
	signal: AbortSignal;
	runFFmpegCommand: (options: {
		signal: AbortSignal;
		args: string[];
		estimatedDuration: number;
		onProgress?: (progress: { normalizedProgress: number }) => void;
	}) => Promise<unknown>;
	onProgress?: (normalizedProgress: number) => void;
}): Promise<void> {
	if (overlays.length === 0) return;
	const sourcePath = path.join(tempDir, "video-before-media-overlays.mp4");
	const inputs = await probeMediaOverlayInputs({ overlays });
	const pass = buildMediaOverlayPassArgs({
		inputPath: sourcePath,
		outputPath: videoOutputPath,
		overlays: inputs,
		settings,
		duration,
	});
	claudeLog.info(
		HANDLER_NAME,
		`Drawing ${overlays.length} media overlay(s): ${pass.filterComplex}`
	);
	await moveFile({ from: videoOutputPath, to: sourcePath });
	try {
		await runFFmpegCommand({
			signal,
			args: pass.args,
			estimatedDuration: Math.max(0, duration),
			onProgress: ({ normalizedProgress }) => onProgress?.(normalizedProgress),
		});
	} catch (error) {
		try {
			await fsPromises.unlink(videoOutputPath);
		} catch {
			/* may not exist */
		}
		await moveFile({ from: sourcePath, to: videoOutputPath });
		const clips = overlays
			.map(
				(segment) =>
					`${segment.elementId} (${path.basename(segment.sourcePath)})`
			)
			.join(", ");
		throw new Error(
			`Media overlay export failed for ${clips}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
