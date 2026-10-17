/**
 * Adjustment layers in the native export.
 *
 * The editor grades everything rendered below an adjustment layer. FFmpeg gets
 * the same result as one pass over the concatenated video: each layer's colour
 * filter runs on a copy of the stream, and the copy is composited back over the
 * original only inside the layer's time window (`overlay` with `enable`), with
 * the layer's opacity as the copy's alpha. Layers on lower tracks grade first,
 * matching the preview's stacking order.
 *
 * @module electron/claude/handlers/claude-export-handler/adjustment-layer-pass
 */

import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { buildVideoColorFilter } from "../../../ffmpeg/color-filter.js";
import type { VideoColorSettings } from "../../../ffmpeg/color-settings.js";
import { DEFAULT_VISUAL } from "../../../ffmpeg-video-transform.js";
import type { ClaudeTimeline } from "../../../types/claude-api.js";
import { claudeLog } from "../../utils/logger.js";
import { moveFile } from "./move-file.js";
import { HANDLER_NAME } from "./types.js";

export interface AdjustmentLayer {
	elementId: string;
	trackOrder: number;
	/** Export-timeline seconds. */
	startTime: number;
	endTime: number;
	/** Renderer-resolved grade, normalized by the ffmpeg colour pipeline. */
	color: VideoColorSettings;
	/** 0–1; the graded copy's alpha over the original. */
	opacity: number;
	/**
	 * True when the layer's track sits above every text/sticker track, so it
	 * grades those overlays too and must run after they are drawn.
	 */
	aboveOverlays: boolean;
}

const OVERLAY_ELEMENT_TYPES = new Set([
	"sticker",
	"text",
	"captions",
	"markdown",
]);

/**
 * The adjustment layers the native export grades, lowest track first (the
 * order they apply in). Layers without a grade, hidden, or fully transparent
 * are left out.
 */
export function collectAdjustmentLayers({
	timeline,
}: {
	timeline: ClaudeTimeline;
}): AdjustmentLayer[] {
	let overlayTop = Number.POSITIVE_INFINITY;
	for (const [trackOrder, track] of timeline.tracks.entries()) {
		if (track.hidden) continue;
		if (
			track.elements.some(
				(element) => OVERLAY_ELEMENT_TYPES.has(element.type) && !element.hidden
			)
		) {
			overlayTop = Math.min(overlayTop, trackOrder);
		}
	}
	const layers: AdjustmentLayer[] = [];
	for (const [trackOrder, track] of timeline.tracks.entries()) {
		if (track.hidden) continue;
		for (const element of track.elements) {
			if (element.type !== "adjustment" || element.hidden) continue;
			const color = element.colorSettings;
			if (color === null || typeof color !== "object" || Array.isArray(color)) {
				continue;
			}
			if (
				!Number.isFinite(element.startTime) ||
				!Number.isFinite(element.endTime) ||
				element.endTime <= element.startTime
			) {
				continue;
			}
			const opacity =
				typeof element.opacity === "number" && Number.isFinite(element.opacity)
					? Math.min(1, Math.max(0, element.opacity))
					: 1;
			if (opacity <= 0) continue;
			layers.push({
				elementId: element.id,
				trackOrder,
				startTime: element.startTime,
				endTime: element.endTime,
				color: color as unknown as VideoColorSettings,
				opacity,
				// Without any overlay track there is nothing to wait for.
				aboveOverlays: Number.isFinite(overlayTop) && trackOrder < overlayTop,
			});
		}
	}
	return layers.sort(
		(left, right) =>
			right.trackOrder - left.trackOrder || left.startTime - right.startTime
	);
}

export interface AdjustmentLayerPass {
	args: string[];
	filterComplex: string;
}

/**
 * The FFmpeg command that applies `layers` to `inputPath`, or null when every
 * layer's grade is neutral and the pass would change nothing.
 */
export function buildAdjustmentLayerPass({
	inputPath,
	outputPath,
	layers,
	codec,
	bitrate,
}: {
	inputPath: string;
	outputPath: string;
	layers: AdjustmentLayer[];
	codec: string;
	bitrate: string;
}): AdjustmentLayerPass | null {
	const steps: string[] = [];
	let current = "0:v";
	for (const [index, layer] of layers.entries()) {
		const grade = buildVideoColorFilter({
			visual: { ...DEFAULT_VISUAL, color: layer.color },
		});
		if (!grade) continue;
		const base = `adj_b${index}`;
		const source = `adj_s${index}`;
		const graded = `adj_g${index}`;
		const output = `adj_o${index}`;
		steps.push(`[${current}]split=2[${base}][${source}]`);
		steps.push(`[${source}]${grade}[${graded}]`);
		let top = graded;
		if (layer.opacity < 1) {
			const faded = `adj_a${index}`;
			steps.push(
				`[${graded}]format=rgba,colorchannelmixer=aa=${layer.opacity}[${faded}]`
			);
			top = faded;
		}
		steps.push(
			`[${base}][${top}]overlay=enable='between(t,${layer.startTime},${layer.endTime})'[${output}]`
		);
		current = output;
	}
	if (steps.length === 0) return null;
	const filterComplex = steps.join(";");
	return {
		filterComplex,
		args: [
			"-y",
			"-i",
			inputPath,
			"-filter_complex",
			filterComplex,
			"-map",
			`[${current}]`,
			"-map",
			"0:a?",
			"-c:v",
			codec,
			"-preset",
			"medium",
			"-b:v",
			bitrate,
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"copy",
			"-movflags",
			"+faststart",
			outputPath,
		],
	};
}

/**
 * Re-encodes the export at `videoOutputPath` with the layers applied. On a
 * failure the untouched video is put back first, so a failed job never leaves
 * a half-written output behind, and the error is rethrown: a successful export
 * must never silently drop a visible grade.
 */
export async function runAdjustmentLayerPass({
	layers,
	videoOutputPath,
	tempDir,
	stage,
	codec,
	bitrate,
	estimatedDuration,
	signal,
	runFFmpegCommand,
	onProgress,
}: {
	layers: AdjustmentLayer[];
	videoOutputPath: string;
	tempDir: string;
	stage: "below-overlays" | "above-overlays";
	codec: string;
	bitrate: string;
	estimatedDuration: number;
	signal: AbortSignal;
	runFFmpegCommand: (options: {
		signal: AbortSignal;
		args: string[];
		estimatedDuration: number;
		onProgress?: (progress: { normalizedProgress: number }) => void;
	}) => Promise<unknown>;
	onProgress?: (normalizedProgress: number) => void;
}): Promise<void> {
	const sourcePath = path.join(
		tempDir,
		`concat-before-adjustment-${stage}.mp4`
	);
	const pass = buildAdjustmentLayerPass({
		inputPath: sourcePath,
		outputPath: videoOutputPath,
		layers,
		codec,
		bitrate,
	});
	if (!pass) return;
	claudeLog.info(
		HANDLER_NAME,
		`Applying ${layers.length} adjustment layer(s) ${stage}: ${pass.filterComplex}`
	);
	await moveFile({ from: videoOutputPath, to: sourcePath });
	try {
		await runFFmpegCommand({
			signal,
			args: pass.args,
			estimatedDuration: Math.max(0, estimatedDuration),
			onProgress: ({ normalizedProgress }) => onProgress?.(normalizedProgress),
		});
	} catch (error) {
		try {
			await fsPromises.unlink(videoOutputPath);
		} catch {
			/* may not exist */
		}
		await moveFile({ from: sourcePath, to: videoOutputPath });
		throw new Error(
			`Adjustment layer export failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
