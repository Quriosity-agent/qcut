import type { ExportJobRequest } from "../../../types/claude-api";
import type { ResolvedExportSettings } from "./types.js";
import { findPresetById } from "./presets.js";

export function resolveExportSettings({
	request,
}: {
	request: ExportJobRequest;
}): ResolvedExportSettings {
	try {
		const requestedPresetId = request.preset?.trim() || "youtube-1080p";
		const preset = findPresetById({ presetId: requestedPresetId });
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

		const width =
			s?.width ?? (typeof top.width === "number" ? top.width : preset.width);
		const height =
			s?.height ??
			(typeof top.height === "number" ? top.height : preset.height);
		const bitrate =
			s?.bitrate ??
			(typeof top.bitrate === "string" ? top.bitrate : preset.bitrate);
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
