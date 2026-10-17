/**
 * Whether a video carries an alpha channel, and how FFmpeg must decode it to
 * keep that channel.
 *
 * Two kinds of source are transparent: a pixel format with an alpha plane
 * (ProRes 4444 `yuva444p12le`, QuickTime Animation `argb`, PNG `rgba`, …),
 * and VP8/VP9 with `alpha_mode=1`, whose alpha travels as side data next to a
 * plain `yuv420p` picture. FFmpeg's own VP8/VP9 decoders drop that side data;
 * only libvpx reads it, so those sources must name the libvpx decoder before
 * `-i`.
 *
 * @module electron/ffmpeg/video-alpha
 */

/** Pixel formats with an alpha plane. */
export const TRANSPARENT_PIXEL_FORMAT =
	/^(?:yuva|gbrap|rgba|bgra|argb|abgr|ya)/;

export interface VideoAlphaInfo {
	codec: string;
	pixelFormat: string;
	/** The stream's `alpha_mode` tag (WebM/Matroska); 0 when absent. */
	alphaMode: number;
	hasAlpha: boolean;
	/** The decoder to name before `-i` so the alpha survives decoding. */
	decoder?: "libvpx" | "libvpx-vp9";
}

/** The ffprobe fields of one video stream this module reads. */
export interface ProbedVideoStream {
	codec_name?: string;
	pix_fmt?: string;
	tags?: Record<string, unknown>;
}

function alphaModeTag(tags: Record<string, unknown> | undefined): number {
	const raw = tags?.alpha_mode ?? tags?.ALPHA_MODE;
	const value = Number(raw);
	return Number.isFinite(value) ? value : 0;
}

/** Reads the alpha facts of a probed video stream. */
export function videoAlphaFromStream({
	stream,
}: {
	stream: ProbedVideoStream;
}): VideoAlphaInfo {
	const codec = stream.codec_name ?? "";
	const pixelFormat = stream.pix_fmt ?? "";
	const alphaMode = alphaModeTag(stream.tags);
	const sideDataAlpha = alphaMode > 0 && (codec === "vp9" || codec === "vp8");
	const hasAlpha = TRANSPARENT_PIXEL_FORMAT.test(pixelFormat) || alphaMode > 0;
	return {
		codec,
		pixelFormat,
		alphaMode,
		hasAlpha,
		...(sideDataAlpha
			? { decoder: codec === "vp9" ? "libvpx-vp9" : "libvpx" }
			: {}),
	};
}

/** Input options that make FFmpeg decode the source with its alpha. */
export function alphaDecoderInputArgs({
	alpha,
}: {
	alpha: Pick<VideoAlphaInfo, "decoder"> | null | undefined;
}): string[] {
	return alpha?.decoder ? ["-c:v", alpha.decoder] : [];
}
