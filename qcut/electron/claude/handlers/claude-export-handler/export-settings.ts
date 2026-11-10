import type { ExportJobRequest, ExportPreset } from "../../../types/claude-api";
import { EXPORT_PEAK_CORRECTIONS } from "../../../types/export-audio-validation.js";
import type { ResolvedExportSettings } from "./types.js";
import {
	bitrateForPictureSize,
	FALLBACK_PRESET_ID,
	findPresetById,
	type ProjectPicture,
	projectExportPreset,
} from "./presets.js";

/**
 * A requested picture bitrate in the one form the engine reads ("24Mbps",
 * "2500kbps"). "24Mbps", "24M", "24000kbps" and "24000k" are taken; anything
 * else is refused. It used to be passed on, and what the engine could not
 * read (a bare number, "24M") exported at 8 Mbps without a word.
 */
export function readRequestedBitrate({ value }: { value: unknown }): string {
	const match =
		typeof value === "string"
			? /^\s*(\d+(?:\.\d+)?)\s*(mbps|m|kbps|k)\s*$/i.exec(value)
			: null;
	const kbps = match
		? Math.round(
				Number.parseFloat(match[1]) *
					(match[2].toLowerCase().startsWith("m") ? 1000 : 1)
			)
		: 0;
	if (kbps <= 0) {
		throw new Error(
			`Bitrate must be a string such as "24Mbps" or "8000k" (megabits or kilobits a second), not ${JSON.stringify(value)}`
		);
	}
	return kbps % 1000 === 0 ? `${kbps / 1000}Mbps` : `${kbps}kbps`;
}

/** The named preset, else the project's own picture, else YouTube 1080p. */
function basePreset({
	presetId,
	project,
}: {
	presetId: string | undefined;
	project?: ProjectPicture;
}): ExportPreset | null {
	if (presetId) return findPresetById({ presetId });
	const projectPreset = project ? projectExportPreset({ project }) : null;
	return projectPreset ?? findPresetById({ presetId: FALLBACK_PRESET_ID });
}

/**
 * The export's settings: a named preset, or without one the project's own
 * size and frame rate (`projectExportPreset`), with the request's values
 * over either. Without a project the YouTube 1080p preset stands in.
 */
export function resolveExportSettings({
	request,
	project,
}: {
	request: ExportJobRequest;
	project?: ProjectPicture;
}): ResolvedExportSettings {
	try {
		const requestedPresetId = request.preset?.trim();
		const preset = basePreset({ presetId: requestedPresetId, project });
		if (!preset) {
			throw new Error(`Invalid preset ID: ${requestedPresetId}`);
		}

		const s = request.settings;
		const top = request as Record<string, unknown>;
		const requestedEngine = request.engine ?? "auto";
		// "muxer" pins the renderer's canvas/WebCodecs engine; the renderer
		// route validates it separately, and the native path still rejects it.
		if (!["auto", "native", "cli", "muxer"].includes(requestedEngine)) {
			throw new Error(
				`Export engine '${requestedEngine}' is not available through the CLI API. Use auto, native, cli, or muxer.`
			);
		}

		const format =
			s?.format ??
			(typeof top.format === "string" ? top.format : preset.format);

		// GIF exports use libx264 for the intermediary MP4, then convert
		const codec =
			s?.codec ?? (typeof top.codec === "string" ? top.codec : "libx264");

		const rawGifLoop =
			(s as Record<string, unknown> | undefined)?.gifLoop ?? top.gifLoop;
		const gifLoop = typeof rawGifLoop === "boolean" ? rawGifLoop : undefined;

		// GIF config from request body
		const gifConfig = request.gifConfig;
		const resolvedGifLoop =
			gifLoop ??
			(typeof gifConfig?.loop === "boolean" ? gifConfig.loop : undefined);
		const resolvedFps =
			s?.fps ??
			(typeof top.fps === "number" ? top.fps : undefined) ??
			(format === "gif" && typeof gifConfig?.frameRate === "number"
				? gifConfig.frameRate
				: preset.fps);
		const audioBitrate = request.audioExportConfig?.bitrate ?? 192;
		const audioSampleRate = request.audioExportConfig?.sampleRate ?? 48_000;
		if (![128, 192, 256, 320].includes(audioBitrate)) {
			throw new Error("Audio bitrate must be 128, 192, 256, or 320 kbps");
		}
		if (![44_100, 48_000].includes(audioSampleRate)) {
			throw new Error("Audio sample rate must be 44100 or 48000 Hz");
		}
		if (
			request.peakCorrection !== undefined &&
			!EXPORT_PEAK_CORRECTIONS.includes(request.peakCorrection)
		) {
			throw new Error(
				`Peak correction must be one of ${EXPORT_PEAK_CORRECTIONS.join(", ")}`
			);
		}

		const width =
			s?.width ?? (typeof top.width === "number" ? top.width : preset.width);
		const height =
			s?.height ??
			(typeof top.height === "number" ? top.height : preset.height);
		const requestedBitrate = s?.bitrate ?? top.bitrate;
		// Without a named preset the bitrate goes with the picture's size, so a
		// size given with the request no longer keeps the project's rate.
		const bitrate =
			requestedBitrate !== undefined
				? readRequestedBitrate({ value: requestedBitrate })
				: ((requestedPresetId
						? null
						: bitrateForPictureSize({ width, height })) ?? preset.bitrate);
		const matchesPreset =
			width === preset.width &&
			height === preset.height &&
			resolvedFps === preset.fps &&
			format === preset.format &&
			bitrate === preset.bitrate;

		return {
			engine: "native-cli",
			presetId: matchesPreset ? preset.id : "custom",
			width,
			height,
			fps: resolvedFps,
			format,
			codec,
			bitrate,
			gifLoop: resolvedGifLoop,
			gifQuality:
				typeof gifConfig?.quality === "number" ? gifConfig.quality : undefined,
			audioBitrate,
			audioSampleRate,
			audioChannels: request.audioExportConfig?.channels ?? 2,
			...(request.peakCorrection
				? { peakCorrection: request.peakCorrection }
				: {}),
			...(request.keepTemp === true ? { keepTempFiles: true } : {}),

			// Pass through enhancement configs
			cursorConfig: request.cursorConfig,
			audioConfig: request.audioConfig,
			zoomConfig: request.zoomConfig,
		};
	} catch (error) {
		if (error instanceof Error) {
			throw error;
		}
		throw new Error("Failed to resolve export settings");
	}
}
